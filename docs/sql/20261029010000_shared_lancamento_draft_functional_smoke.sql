-- Functional integration smoke for the shared launch batch.
-- LOCAL integration database only.
-- A single canonical synthetic E1 slot is inserted before switching to the
-- authenticated Administrator context. One intentionally blank draft line is
-- then processed through the real shared-batch RPC and B7.1 typed stock writer.
-- The synthetic slot, draft mutations, batch record and archive are all rolled
-- back together. No operational stock row is selected or modified.

BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '5s';

-- Build exactly one isolated E1 scope in this transaction. E1 has no warehouse
-- layout activation dependency in the typed writer; its canonical slot identity
-- and complete persisted snapshot are still validated by the real RPC.
DO $fixture_setup$
DECLARE
  v_module text := '987654321';
  v_sku text := 'TEST_SHARED_BATCH_' || upper(replace(gen_random_uuid()::text, '-', ''));
  v_slot_id text;
  v_fixture jsonb;
BEGIN
  v_slot_id := '1-' || v_module || '-' || v_sku;

  IF EXISTS (
    SELECT 1 FROM public.slots AS s
    WHERE s.estoque = '1' AND s.modulo = v_module
  ) THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_ABORT_SYNTHETIC_MODULE_ALREADY_IN_USE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.history AS h
    WHERE h.estoque = '1' AND h.modulo = v_module
  ) OR EXISTS (
    SELECT 1 FROM public.divergencias AS d
    WHERE d.estoque = '1' AND d.modulo = v_module
  ) THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_ABORT_SYNTHETIC_MODULE_HAS_AUDIT_DATA';
  END IF;
  IF EXISTS (SELECT 1 FROM public.slots AS s WHERE s.id = v_slot_id) THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_ABORT_SYNTHETIC_SLOT_ID_ALREADY_EXISTS';
  END IF;

  INSERT INTO public.slots AS inserted (
    id, estoque, modulo, posicao, referencia, descricao, saldo, galpao, restricao
  ) VALUES (
    v_slot_id, '1', v_module, '', v_sku,
    'FIXTURE TEMPORARIA — TESTE FUNCIONAL LOTE COMPARTILHADO',
    0, '3', 'nenhuma'
  )
  RETURNING to_jsonb(inserted) INTO v_fixture;

  PERFORM set_config('test.shared_lancamento_fixture_id', v_slot_id, true);
  PERFORM set_config('test.shared_lancamento_fixture_module', v_module, true);
  PERFORM set_config('test.shared_lancamento_fixture_snapshot', v_fixture::text, true);
  RAISE NOTICE 'PASS_SYNTHETIC_E1_FIXTURE_CREATED|module=%|slot_id=%|saldo=0|transaction_only=true', v_module, v_slot_id;
END;
$fixture_setup$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin_id', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'admin_id', 'role', 'authenticated')::text,
  true
);

DO $functional_smoke$
DECLARE
  v_initial_snapshot jsonb;
  v_upsert_result jsonb;
  v_snapshot jsonb;
  v_process_result jsonb;
  v_retry_result jsonb;
  v_batch_result jsonb;
  v_final_snapshot jsonb;
  v_generation_id uuid;
  v_initial_revision bigint;
  v_next_generation_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_line_id text := 'TEST_SHARED_BATCH_' || replace(gen_random_uuid()::text, '-', '');
  v_row_data jsonb;
  v_module text := current_setting('test.shared_lancamento_fixture_module');
  v_fixture_id text := current_setting('test.shared_lancamento_fixture_id');
  v_fixture_snapshot jsonb := current_setting('test.shared_lancamento_fixture_snapshot')::jsonb;
  v_slots_before jsonb;
  v_slots_after jsonb;
  v_divergences_before jsonb;
  v_divergences_after jsonb;
  v_history_before bigint;
  v_history_after bigint;
  v_stock_result jsonb;
BEGIN
  -- Confirm the synthetic fixture is visible to the authenticated operator and
  -- is byte-for-byte equivalent to the owner-created row snapshot.
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb)
    INTO v_slots_before
  FROM public.slots AS s
  WHERE s.id = v_fixture_id;

  IF v_slots_before IS DISTINCT FROM jsonb_build_array(v_fixture_snapshot)
     OR jsonb_array_length(v_slots_before) <> 1 THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_ABORT_FIXTURE_NOT_VISIBLE_OR_SNAPSHOT_MISMATCH';
  END IF;

  -- The isolated E1 scope must be empty of prior audit data.
  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id), '[]'::jsonb)
    INTO v_divergences_before
  FROM public.divergencias AS d
  WHERE d.estoque = '1' AND d.modulo = v_module AND coalesce(d.posicao, '') = '';

  SELECT count(*) INTO v_history_before
  FROM public.history AS h
  WHERE h.estoque = '1' AND h.modulo = v_module AND coalesce(h.posicao, '') = '';

  IF jsonb_array_length(v_divergences_before) <> 0 OR v_history_before <> 0 THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_ABORT_SYNTHETIC_SCOPE_NOT_EMPTY';
  END IF;

  -- Do not process or archive any pre-existing shared-draft content.
  v_initial_snapshot := public.get_shared_lancamento_draft();
  IF coalesce((v_initial_snapshot->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_INITIAL_DRAFT_READ_FAILED: %', v_initial_snapshot;
  END IF;
  IF jsonb_array_length(coalesce(v_initial_snapshot->'lines', '[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_ABORT_ACTIVE_DRAFT_NOT_EMPTY';
  END IF;

  v_row_data := jsonb_build_object(
    'id', v_line_id,
    'data', '',
    'estoque', '1',
    'modulo', '',
    'posicao', '',
    'referencia', '',
    'quantidade', '',
    'tipo', '',
    'dataChacote', '',
    'hora', '',
    'responsavel', '',
    'galpao', '3',
    'restricao', 'nenhuma',
    'observacao', ''
  );

  v_upsert_result := public.upsert_shared_lancamento_draft_lines(
    (v_initial_snapshot->>'generation_id')::uuid,
    jsonb_build_array(jsonb_build_object('line_id', v_line_id, 'row_data', v_row_data))
  );
  IF coalesce((v_upsert_result->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_SYNTHETIC_LINE_UPSERT_FAILED: %', v_upsert_result;
  END IF;

  v_snapshot := public.get_shared_lancamento_draft();
  IF coalesce((v_snapshot->>'success')::boolean, false) IS NOT TRUE
     OR jsonb_array_length(coalesce(v_snapshot->'lines', '[]'::jsonb)) <> 1
     OR v_snapshot->'lines'->0->>'line_id' IS DISTINCT FROM v_line_id THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_SNAPSHOT_AFTER_UPSERT_INVALID: %', v_snapshot;
  END IF;

  v_generation_id := (v_snapshot->>'generation_id')::uuid;
  v_initial_revision := (v_snapshot->>'revision')::bigint;

  -- Process one intentionally blank/ignored line. The unchanged synthetic E1
  -- snapshot ensures the normal B7.1 typed writer is called with operation
  -- type 'launch'; it validates the real scope and locks it without stock writes.
  v_process_result := public.process_shared_lancamento_draft_batch_atomic(
    v_batch_id,
    v_generation_id,
    v_initial_revision,
    v_snapshot->'lines',
    jsonb_build_object('synthetic_functional_smoke', true, 'expected_business_writes', 0),
    v_slots_before,
    v_slots_before,
    v_divergences_before,
    v_divergences_before,
    '[]'::jsonb,
    ARRAY[]::text[]
  );

  IF coalesce((v_process_result->>'success')::boolean, false) IS NOT TRUE
     OR coalesce((v_process_result->>'already_processed')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_BATCH_PROCESS_FAILED: %', v_process_result;
  END IF;
  IF coalesce((v_process_result->>'archived_count')::bigint, -1) <> 1 THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_ARCHIVE_COUNT_INVALID: %', v_process_result;
  END IF;

  v_stock_result := v_process_result->'stock_result';
  IF coalesce((v_stock_result->>'success')::boolean, false) IS NOT TRUE
     OR coalesce((v_stock_result->>'slots_written')::bigint, -1) <> 0
     OR coalesce((v_stock_result->>'history_written')::bigint, -1) <> 0
     OR coalesce((v_stock_result->>'divergencias_written')::bigint, -1) <> 0
     OR coalesce((v_stock_result->>'scopes_locked')::bigint, 0) <> 1 THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_TYPED_LAUNCH_WRITER_RESULT_INVALID: %', v_stock_result;
  END IF;

  -- Same batch identity and original generation/revision must be acknowledged
  -- without executing stock mutation a second time.
  v_retry_result := public.process_shared_lancamento_draft_batch_atomic(
    v_batch_id,
    v_generation_id,
    v_initial_revision,
    v_snapshot->'lines',
    jsonb_build_object('synthetic_functional_smoke', true, 'expected_business_writes', 0),
    v_slots_before,
    v_slots_before,
    v_divergences_before,
    v_divergences_before,
    '[]'::jsonb,
    ARRAY[]::text[]
  );
  IF coalesce((v_retry_result->>'success')::boolean, false) IS NOT TRUE
     OR coalesce((v_retry_result->>'already_processed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_IDEMPOTENCY_RETRY_FAILED: %', v_retry_result;
  END IF;

  v_batch_result := public.get_shared_lancamento_batch_result(v_batch_id);
  IF coalesce((v_batch_result->>'success')::boolean, false) IS NOT TRUE
     OR v_batch_result->>'batch_id' IS DISTINCT FROM v_batch_id::text
     OR coalesce((v_batch_result->>'already_processed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_BATCH_RESULT_LOOKUP_FAILED: %', v_batch_result;
  END IF;

  v_final_snapshot := public.get_shared_lancamento_draft();
  IF coalesce((v_final_snapshot->>'success')::boolean, false) IS NOT TRUE
     OR (v_final_snapshot->>'generation_id')::uuid IS NOT DISTINCT FROM v_generation_id
     OR coalesce((v_final_snapshot->>'revision')::bigint, -1) <> 0
     OR jsonb_array_length(coalesce(v_final_snapshot->'lines', '[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_DRAFT_FINAL_STATE_INVALID: %', v_final_snapshot;
  END IF;
  v_next_generation_id := (v_final_snapshot->>'generation_id')::uuid;

  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb)
    INTO v_slots_after
  FROM public.slots AS s
  WHERE s.id = v_fixture_id;

  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id), '[]'::jsonb)
    INTO v_divergences_after
  FROM public.divergencias AS d
  WHERE d.estoque = '1' AND d.modulo = v_module AND coalesce(d.posicao, '') = '';

  SELECT count(*) INTO v_history_after
  FROM public.history AS h
  WHERE h.estoque = '1' AND h.modulo = v_module AND coalesce(h.posicao, '') = '';

  IF v_slots_after IS DISTINCT FROM v_slots_before
     OR v_divergences_after IS DISTINCT FROM v_divergences_before
     OR v_history_after IS DISTINCT FROM v_history_before THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_BUSINESS_DATA_CHANGED';
  END IF;

  RAISE NOTICE 'PASS_SHARED_BATCH_FUNCTIONAL_NOOP_AND_IDEMPOTENCY';
  RAISE NOTICE 'TEST_MODULE|%|TEST_BATCH|%|NEXT_GENERATION|%', v_module, v_batch_id, v_next_generation_id;
  RAISE NOTICE 'PASS_TYPED_LAUNCH_WRITER|scopes_locked=%|slots_written=0|history_written=0|divergencias_written=0', v_stock_result->>'scopes_locked';
  RAISE NOTICE 'PASS_DRAFT_FINALIZED|archived_count=1|active_lines=0|revision=0';
  RAISE NOTICE 'PASS_STOCK_SNAPSHOTS_UNCHANGED|history_count=%', v_history_after;

  -- Expose only the generated IDs to a separate owner-role verification block.
  PERFORM set_config('test.shared_lancamento_batch_id', v_batch_id::text, true);
  PERFORM set_config('test.shared_lancamento_line_id', v_line_id, true);
END;
$functional_smoke$;

-- Internal batch/archive tables are intentionally inaccessible to authenticated.
-- Switch back to the local database owner only for read-only verification.
RESET ROLE;
DO $archive_verify$
DECLARE
  v_batch_id uuid := current_setting('test.shared_lancamento_batch_id')::uuid;
  v_line_id text := current_setting('test.shared_lancamento_line_id');
  v_archive_count bigint;
  v_ignored_count bigint;
  v_batch_count bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE a.disposition = 'ignored')
    INTO v_archive_count, v_ignored_count
  FROM public.lancamento_draft_archive_lines AS a
  WHERE a.batch_id = v_batch_id AND a.line_id = v_line_id;

  SELECT count(*) INTO v_batch_count
  FROM public.lancamento_batch_runs AS r
  WHERE r.batch_id = v_batch_id;

  IF v_archive_count <> 1 OR v_ignored_count <> 1 OR v_batch_count <> 1 THEN
    RAISE EXCEPTION 'FUNCTIONAL_SMOKE_ARCHIVE_OR_BATCH_RECORD_INVALID|archive=%|ignored=%|batch=%',
      v_archive_count, v_ignored_count, v_batch_count;
  END IF;

  RAISE NOTICE 'PASS_DRAFT_ARCHIVED_AS_IGNORED|lines=1|batch_records=1';
END;
$archive_verify$;

ROLLBACK;
SELECT 'PASS_SHARED_BATCH_FUNCTIONAL_SMOKE_ROLLED_BACK_NO_PERSISTENT_DATA' AS result;
