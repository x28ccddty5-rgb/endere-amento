-- SESSION B: concurrent retry using the same batch ID, generation and revision.
-- The runner must observe this backend blocked by Session A before A commits.
\set ON_ERROR_STOP on
SET application_name = 'shared_batch_concurrency_b';
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '25s';

SELECT set_config('test.shared_concurrency.admin_id', :'admin_id', true);
SELECT set_config('test.shared_concurrency.generation_id', :'baseline_generation_id', true);
SELECT set_config('test.shared_concurrency.expected_revision', :'expected_revision', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin_id', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'admin_id', 'role', 'authenticated')::text,
  true
);

DO $session_b$
DECLARE
  v_batch_id constant uuid := 'b7a10000-0000-4000-8000-000000000002'::uuid;
  v_generation_id uuid := current_setting('test.shared_concurrency.generation_id')::uuid;
  v_expected_revision bigint := current_setting('test.shared_concurrency.expected_revision')::bigint;
  v_result jsonb;
BEGIN
  -- Empty payload arrays are intentional: if Session B reaches the post-lock
  -- branch, it must return the committed batch before inspecting the snapshot.
  v_result := public.process_shared_lancamento_draft_batch_atomic(
    v_batch_id,
    v_generation_id,
    v_expected_revision,
    '[]'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    ARRAY[]::text[]
  );

  IF coalesce((v_result->>'success')::boolean, false) IS NOT TRUE
     OR coalesce((v_result->>'already_processed')::boolean, false) IS NOT TRUE
     OR v_result->>'batch_id' IS DISTINCT FROM v_batch_id::text
     OR (v_result->>'generation_id')::uuid IS DISTINCT FROM v_generation_id
     OR coalesce((v_result->>'draft_revision')::bigint, -1) <> v_expected_revision THEN
    RAISE EXCEPTION 'CONCURRENCY_B_IDEMPOTENT_RETRY_FAILED: %', v_result;
  END IF;

  RAISE NOTICE 'PASS_CONCURRENCY_SESSION_B_ALREADY_PROCESSED|batch_id=%|no_second_write=true', v_batch_id;
END;
$session_b$;

COMMIT;
SELECT 'SESSION_B_COMMITTED|already_processed=true';
