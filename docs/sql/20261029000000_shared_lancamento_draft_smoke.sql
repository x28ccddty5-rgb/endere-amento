-- Template de smoke local somente de autorização/contrato.
-- O runner substitui __ADMIN_ID__ e __PRODUCTION_ID__ por IDs lidos do clone local.
-- Não insere, atualiza ou exclui dados de negócio. Todas as sessões terminam em ROLLBACK.

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '__PRODUCTION_ID__', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub','__PRODUCTION_ID__','role','authenticated')::text, true);
DO $production$
DECLARE r jsonb;
BEGIN
  r := public.get_shared_lancamento_draft();
  IF r->>'code' IS DISTINCT FROM 'OPERATION_NOT_ALLOWED' THEN RAISE EXCEPTION 'SHARED_DRAFT_PRODUCTION_VIEW_NOT_DENIED: %', r; END IF;

  r := public.upsert_shared_lancamento_draft_lines(NULL, '[]'::jsonb);
  IF r->>'code' IS DISTINCT FROM 'OPERATION_NOT_ALLOWED' THEN RAISE EXCEPTION 'SHARED_DRAFT_PRODUCTION_UPSERT_NOT_DENIED: %', r; END IF;

  r := public.delete_shared_lancamento_draft_line(NULL, '', NULL);
  IF r->>'code' IS DISTINCT FROM 'OPERATION_NOT_ALLOWED' THEN RAISE EXCEPTION 'SHARED_DRAFT_PRODUCTION_DELETE_NOT_DENIED: %', r; END IF;

  r := public.clear_shared_lancamento_draft(NULL, NULL);
  IF r->>'code' IS DISTINCT FROM 'OPERATION_NOT_ALLOWED' THEN RAISE EXCEPTION 'SHARED_DRAFT_PRODUCTION_CLEAR_NOT_DENIED: %', r; END IF;

  r := public.get_shared_lancamento_batch_result(gen_random_uuid());
  IF r->>'code' IS DISTINCT FROM 'OPERATION_NOT_ALLOWED' THEN RAISE EXCEPTION 'SHARED_DRAFT_PRODUCTION_BATCH_RESULT_NOT_DENIED: %', r; END IF;

  r := public.process_shared_lancamento_draft_batch_atomic(
    NULL, NULL, NULL, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ARRAY[]::text[]
  );
  IF r->>'code' IS DISTINCT FROM 'OPERATION_NOT_ALLOWED' THEN RAISE EXCEPTION 'SHARED_DRAFT_PRODUCTION_BATCH_PROCESS_NOT_DENIED: %', r; END IF;

  RAISE NOTICE 'PASS_SHARED_DRAFT_PRODUCTION_DENIED_ALL_SIX_RPCS';
END;
$production$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '__ADMIN_ID__', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub','__ADMIN_ID__','role','authenticated')::text, true);
DO $admin$
DECLARE r jsonb;
BEGIN
  r := public.get_shared_lancamento_draft();
  IF COALESCE((r->>'success')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'SHARED_DRAFT_ADMIN_READ_FAILED: %', r; END IF;

  r := public.upsert_shared_lancamento_draft_lines(NULL, '[]'::jsonb);
  IF r->>'code' IS DISTINCT FROM 'INVALID_DRAFT_LINES_PAYLOAD' THEN RAISE EXCEPTION 'SHARED_DRAFT_ADMIN_UPSERT_DID_NOT_REACH_VALIDATION: %', r; END IF;

  r := public.delete_shared_lancamento_draft_line(NULL, '', NULL);
  IF r->>'code' IS DISTINCT FROM 'INVALID_DRAFT_LINE_DELETE' THEN RAISE EXCEPTION 'SHARED_DRAFT_ADMIN_DELETE_DID_NOT_REACH_VALIDATION: %', r; END IF;

  r := public.clear_shared_lancamento_draft(NULL, NULL);
  IF r->>'code' IS DISTINCT FROM 'INVALID_DRAFT_CLEAR' THEN RAISE EXCEPTION 'SHARED_DRAFT_ADMIN_CLEAR_DID_NOT_REACH_VALIDATION: %', r; END IF;

  r := public.get_shared_lancamento_batch_result(gen_random_uuid());
  IF r->>'code' IS DISTINCT FROM 'BATCH_NOT_FOUND' THEN RAISE EXCEPTION 'SHARED_DRAFT_ADMIN_BATCH_RESULT_INVALID: %', r; END IF;

  r := public.process_shared_lancamento_draft_batch_atomic(
    NULL, NULL, NULL, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ARRAY[]::text[]
  );
  IF r->>'code' IS DISTINCT FROM 'INVALID_SHARED_DRAFT_BATCH_PAYLOAD' THEN RAISE EXCEPTION 'SHARED_DRAFT_ADMIN_PROCESS_DID_NOT_REACH_VALIDATION: %', r; END IF;

  RAISE NOTICE 'PASS_SHARED_DRAFT_ADMIN_PERMISSION_GATES_AND_VALIDATION';
END;
$admin$;
ROLLBACK;

SELECT 'PASS_SHARED_DRAFT_SMOKE_NO_DATA_MUTATED' AS result;
