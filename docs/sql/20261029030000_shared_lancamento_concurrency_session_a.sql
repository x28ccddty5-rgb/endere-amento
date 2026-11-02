-- SESSION A: sole processing transaction for the controlled same-batch race.
-- LOCAL PostgreSQL 17 integration clone only. The runner starts Session B while
-- this transaction is sleeping with the shared draft control row still locked.
\set ON_ERROR_STOP on
SET application_name = 'shared_batch_concurrency_a';
BEGIN;
SET LOCAL statement_timeout = '35s';
SET LOCAL lock_timeout = '8s';

SELECT set_config('test.shared_concurrency.admin_id', :'admin_id', true);
SELECT set_config('test.shared_concurrency.baseline_generation_id', :'baseline_generation_id', true);
SELECT set_config('test.shared_concurrency.baseline_revision', :'baseline_revision', true);
SELECT set_config('test.shared_concurrency.product_description', (
  SELECT min(btrim(descricao)) FROM public.products
  WHERE upper(btrim(referencia)) = 'TEST-CUTOVER-001'
), true);
SELECT set_config('test.shared_concurrency.actor_name', (
  SELECT btrim(name) FROM public.profiles WHERE id = :'admin_id'::uuid
), true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin_id', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'admin_id', 'role', 'authenticated')::text,
  true
);

DO $session_a$
DECLARE
  v_generation_id uuid := current_setting('test.shared_concurrency.baseline_generation_id')::uuid;
  v_baseline_revision bigint := current_setting('test.shared_concurrency.baseline_revision')::bigint;
  v_sku constant text := 'TEST-CUTOVER-001';
  v_module constant text := '1';
  v_line_id constant text := 'ROW-SHARED-CONCURRENCY-001';
  v_slot_id constant text := '1-1-TEST-CUTOVER-001';
  v_history_id constant text := 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH';
  v_batch_id constant uuid := 'b7a10000-0000-4000-8000-000000000002'::uuid;
  v_product_description text := current_setting('test.shared_concurrency.product_description');
  v_actor_name text := current_setting('test.shared_concurrency.actor_name');
  v_date text := to_char(current_date, 'YYYY-MM-DD');
  v_hour constant text := '12:00';
  v_initial_snapshot jsonb;
  v_upsert_result jsonb;
  v_snapshot jsonb;
  v_row_data jsonb;
  v_slot_payload jsonb;
  v_history_payload jsonb;
  v_process_result jsonb;
  v_stock_result jsonb;
  v_revision bigint;
  v_next_generation_id uuid;
  v_slot_count bigint;
  v_history_count bigint;
  v_divergence_count bigint;
BEGIN
  IF coalesce(btrim(v_product_description), '') = '' OR coalesce(btrim(v_actor_name), '') = '' THEN
    RAISE EXCEPTION 'CONCURRENCY_A_ABORT_PRODUCT_OR_ADMIN_PROFILE_INVALID';
  END IF;

  v_initial_snapshot := public.get_shared_lancamento_draft();
  IF coalesce((v_initial_snapshot->>'success')::boolean, false) IS NOT TRUE
     OR (v_initial_snapshot->>'generation_id')::uuid IS DISTINCT FROM v_generation_id
     OR (v_initial_snapshot->>'revision')::bigint IS DISTINCT FROM v_baseline_revision
     OR jsonb_array_length(coalesce(v_initial_snapshot->'lines', '[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'CONCURRENCY_A_ABORT_SHARED_DRAFT_BASELINE_CHANGED: %', v_initial_snapshot;
  END IF;

  v_row_data := jsonb_build_object(
    'id', v_line_id,
    'data', v_date,
    'estoque', '1',
    'modulo', v_module,
    'posicao', '',
    'referencia', v_sku,
    'quantidade', '1',
    'tipo', 'Entrada',
    'dataChacote', '',
    'hora', v_hour,
    'responsavel', v_actor_name,
    'galpao', '3',
    'restricao', 'nenhuma',
    'observacao', 'TESTE DE CONCORRENCIA SINTETICO - NAO E ESTOQUE REAL'
  );

  v_upsert_result := public.upsert_shared_lancamento_draft_lines(
    v_generation_id,
    jsonb_build_array(jsonb_build_object('line_id', v_line_id, 'row_data', v_row_data))
  );
  IF coalesce((v_upsert_result->>'success')::boolean, false) IS NOT TRUE
     OR coalesce((v_upsert_result->>'revision')::bigint, -1) <> v_baseline_revision + 1 THEN
    RAISE EXCEPTION 'CONCURRENCY_A_DRAFT_UPSERT_FAILED: %', v_upsert_result;
  END IF;

  v_snapshot := public.get_shared_lancamento_draft();
  IF coalesce((v_snapshot->>'success')::boolean, false) IS NOT TRUE
     OR (v_snapshot->>'generation_id')::uuid IS DISTINCT FROM v_generation_id
     OR coalesce((v_snapshot->>'revision')::bigint, -1) <> v_baseline_revision + 1
     OR jsonb_array_length(coalesce(v_snapshot->'lines', '[]'::jsonb)) <> 1
     OR v_snapshot->'lines'->0->>'line_id' IS DISTINCT FROM v_line_id
     OR v_snapshot->'lines'->0->'row_data' IS DISTINCT FROM v_row_data THEN
    RAISE EXCEPTION 'CONCURRENCY_A_DRAFT_SNAPSHOT_INVALID: %', v_snapshot;
  END IF;
  v_revision := (v_snapshot->>'revision')::bigint;

  v_slot_payload := jsonb_build_object(
    'id', v_slot_id,
    'estoque', '1',
    'modulo', v_module,
    'posicao', '',
    'referencia', v_sku,
    'descricao', v_product_description,
    'saldo', 1,
    'dataChacote', '',
    'ultimaData', v_date,
    'ultimaHora', v_hour,
    'ultimoResponsavel', v_actor_name,
    'galpao', '3',
    'restricao', 'nenhuma',
    'observacao', 'TESTE DE CONCORRENCIA SINTETICO - NAO E ESTOQUE REAL'
  );

  v_history_payload := jsonb_build_object(
    'id', v_history_id,
    'dataLancamento', v_date,
    'quemLancou', v_actor_name,
    'data', v_date,
    'estoque', '1',
    'modulo', v_module,
    'posicao', '',
    'referencia', v_sku,
    'quantidade', 1,
    'tipo', 'Entrada',
    'dataChacote', '',
    'hora', v_hour,
    'responsavel', v_actor_name,
    'galpao', '3',
    'observacao', 'TESTE DE CONCORRENCIA SINTETICO - NAO E ESTOQUE REAL',
    'slot_id', v_slot_id,
    'restricao', 'nenhuma'
  );

  v_process_result := public.process_shared_lancamento_draft_batch_atomic(
    v_batch_id,
    v_generation_id,
    v_revision,
    v_snapshot->'lines',
    jsonb_build_object('processed_count', 1, 'divergence_count', 0, 'source', 'shared_lancamento_concurrency_smoke'),
    '[]'::jsonb,
    jsonb_build_array(v_slot_payload),
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_array(v_history_payload),
    ARRAY[]::text[]
  );

  IF coalesce((v_process_result->>'success')::boolean, false) IS NOT TRUE
     OR coalesce((v_process_result->>'already_processed')::boolean, false) IS TRUE
     OR coalesce((v_process_result->>'archived_count')::bigint, -1) <> 1 THEN
    RAISE EXCEPTION 'CONCURRENCY_A_BATCH_PROCESS_FAILED: %', v_process_result;
  END IF;
  v_next_generation_id := nullif(v_process_result->>'next_generation_id', '')::uuid;
  IF v_next_generation_id IS NULL OR v_next_generation_id = v_generation_id THEN
    RAISE EXCEPTION 'CONCURRENCY_A_NEXT_GENERATION_INVALID: %', v_process_result;
  END IF;
  v_stock_result := v_process_result->'stock_result';
  IF coalesce((v_stock_result->>'success')::boolean, false) IS NOT TRUE
     OR coalesce((v_stock_result->>'slots_written')::bigint, -1) <> 1
     OR coalesce((v_stock_result->>'history_written')::bigint, -1) <> 1
     OR coalesce((v_stock_result->>'divergencias_written')::bigint, -1) <> 0
     OR coalesce((v_stock_result->>'scopes_locked')::bigint, 0) <> 1 THEN
    RAISE EXCEPTION 'CONCURRENCY_A_TYPED_WRITER_RESULT_INVALID: %', v_stock_result;
  END IF;

  SELECT count(*) INTO v_slot_count FROM public.slots WHERE id = v_slot_id AND saldo = 1;
  SELECT count(*) INTO v_history_count FROM public.history
  WHERE id = v_history_id AND slot_id = v_slot_id AND quantidade = 1 AND tipo = 'Entrada';
  SELECT count(*) INTO v_divergence_count FROM public.divergencias
  WHERE estoque = '1' AND modulo = v_module;
  IF v_slot_count <> 1 OR v_history_count <> 1 OR v_divergence_count <> 0 THEN
    RAISE EXCEPTION 'CONCURRENCY_A_BUSINESS_STATE_INVALID|slots=%|history=%|divergences=%',
      v_slot_count, v_history_count, v_divergence_count;
  END IF;

  RAISE NOTICE 'PASS_CONCURRENCY_SESSION_A_PROCESSED|batch_id=%|revision=%|next_generation=%|saldo=1|history=1|backend_pid=%',
    v_batch_id, v_revision, v_next_generation_id, pg_backend_pid();
END;
$session_a$;

-- Hold the transaction and its control-row lock long enough for Session B to
-- enter the same RPC and be observed waiting behind this session.
SELECT pg_sleep(20);
COMMIT;
SELECT 'SESSION_A_COMMITTED|b7a10000-0000-4000-8000-000000000002';
