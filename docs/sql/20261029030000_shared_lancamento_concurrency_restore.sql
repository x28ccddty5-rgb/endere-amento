-- Restore only the exact synthetic same-batch concurrency test rows.
-- Run as postgres against the pinned LOCAL integration clone only.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
SELECT set_config('test.shared_concurrency.baseline_generation_id', :'baseline_generation_id', true);
SELECT set_config('test.shared_concurrency.baseline_revision', :'baseline_revision', true);
SELECT set_config('test.shared_concurrency.baseline_next_sequence', :'baseline_next_sequence', true);
SELECT set_config('test.shared_concurrency.baseline_updated_by', :'baseline_updated_by', true);
SELECT set_config('test.shared_concurrency.baseline_updated_at', :'baseline_updated_at', true);
SELECT set_config('test.shared_concurrency.baseline_batch_count', :'baseline_batch_count', true);
SELECT set_config('test.shared_concurrency.baseline_archive_count', :'baseline_archive_count', true);
SELECT set_config('test.shared_concurrency.expected_post_generation_id', :'expected_post_generation_id', true);

DO $safe_restore$
DECLARE
  v_slots bigint;
  v_history bigint;
  v_divergences bigint;
  v_batches bigint;
  v_archives bigint;
  v_archive_processed bigint;
  v_active_lines bigint;
  v_total_batches bigint;
  v_total_archives bigint;
  v_base_batches bigint := current_setting('test.shared_concurrency.baseline_batch_count')::bigint;
  v_base_archives bigint := current_setting('test.shared_concurrency.baseline_archive_count')::bigint;
  v_control public.lancamento_draft_control%ROWTYPE;
  v_base_generation uuid := current_setting('test.shared_concurrency.baseline_generation_id')::uuid;
  v_base_revision bigint := current_setting('test.shared_concurrency.baseline_revision')::bigint;
  v_base_sequence bigint := current_setting('test.shared_concurrency.baseline_next_sequence')::bigint;
  v_base_updated_by uuid := nullif(current_setting('test.shared_concurrency.baseline_updated_by'), 'NULL')::uuid;
  v_base_updated_at timestamptz := current_setting('test.shared_concurrency.baseline_updated_at')::timestamp AT TIME ZONE 'UTC';
  v_expected_post_generation uuid := nullif(current_setting('test.shared_concurrency.expected_post_generation_id'), 'NONE')::uuid;
BEGIN
  SELECT * INTO v_control FROM public.lancamento_draft_control WHERE singleton IS TRUE;
  SELECT count(*) INTO v_slots FROM public.slots WHERE id = '1-1-TEST-CUTOVER-001';
  SELECT count(*) INTO v_history FROM public.history WHERE id = 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH';
  SELECT count(*) INTO v_divergences FROM public.divergencias WHERE estoque = '1' AND modulo = '1';
  SELECT count(*) INTO v_batches FROM public.lancamento_batch_runs WHERE batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid;
  SELECT count(*), count(*) FILTER (WHERE disposition = 'processed')
    INTO v_archives, v_archive_processed
  FROM public.lancamento_draft_archive_lines
  WHERE line_id = 'ROW-SHARED-CONCURRENCY-001'
    AND batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid;
  SELECT count(*) INTO v_active_lines FROM public.lancamento_draft_lines;
  SELECT count(*) INTO v_total_batches FROM public.lancamento_batch_runs;
  SELECT count(*) INTO v_total_archives FROM public.lancamento_draft_archive_lines;

  -- If Session A never committed, the database must still match the exact
  -- baseline. No cleanup DML is required in that failure path.
  IF v_slots = 0 AND v_history = 0 AND v_divergences = 0 AND v_batches = 0
     AND v_archives = 0 AND v_active_lines = 0
     AND v_total_batches = v_base_batches AND v_total_archives = v_base_archives
     AND v_control.generation_id = v_base_generation
     AND v_control.revision = v_base_revision
     AND v_control.next_sequence = v_base_sequence
     AND v_control.updated_by IS NOT DISTINCT FROM v_base_updated_by
     AND v_control.updated_at = v_base_updated_at THEN
    RAISE NOTICE 'PASS_CONCURRENCY_CLEANUP_NOT_NEEDED|state_already_at_baseline=true';
  -- If Session A committed, cleanup is allowed only when every synthetic row
  -- and the global table-count delta match this test exactly. Any concurrent
  -- external activity causes an abort instead of touching unrelated data.
  ELSIF v_slots = 1 AND v_history = 1 AND v_divergences = 0 AND v_batches = 1
     AND v_archives = 1 AND v_archive_processed = 1 AND v_active_lines = 0
     AND v_total_batches = v_base_batches + 1 AND v_total_archives = v_base_archives + 1
     AND v_expected_post_generation IS NOT NULL
     AND v_control.generation_id = v_expected_post_generation
     AND v_control.revision = 0 AND v_control.next_sequence = 1 THEN
    DELETE FROM public.history WHERE id = 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH';
    DELETE FROM public.slots WHERE id = '1-1-TEST-CUTOVER-001';
    DELETE FROM public.lancamento_draft_archive_lines
      WHERE line_id = 'ROW-SHARED-CONCURRENCY-001'
        AND batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid;
    DELETE FROM public.lancamento_batch_runs
      WHERE batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid;
    UPDATE public.lancamento_draft_control
    SET generation_id = v_base_generation,
        revision = v_base_revision,
        next_sequence = v_base_sequence,
        updated_by = v_base_updated_by,
        updated_at = v_base_updated_at
    WHERE singleton IS TRUE
      AND generation_id = v_control.generation_id
      AND revision = 0
      AND next_sequence = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONCURRENCY_SAFE_RESTORE_CONTROL_UPDATE_FAILED'; END IF;
    RAISE NOTICE 'PASS_CONCURRENCY_SYNTHETIC_ROWS_REMOVED|exact_test_ids_only=true';
  ELSE
    RAISE EXCEPTION 'CONCURRENCY_SAFE_RESTORE_ABORT_UNEXPECTED_STATE|slots=%|history=%|divergences=%|batches=%|archives=%|processed=%|active_lines=%|total_batches=%|base_batches=%|total_archives=%|base_archives=%|generation=%|revision=%|sequence=%',
      v_slots, v_history, v_divergences, v_batches, v_archives, v_archive_processed,
      v_active_lines, v_total_batches, v_base_batches, v_total_archives, v_base_archives,
      v_control.generation_id, v_control.revision, v_control.next_sequence;
  END IF;
END;
$safe_restore$;
COMMIT;

SELECT CASE WHEN
  NOT EXISTS (SELECT 1 FROM public.slots WHERE id = '1-1-TEST-CUTOVER-001')
  AND NOT EXISTS (SELECT 1 FROM public.history WHERE id = 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH')
  AND NOT EXISTS (SELECT 1 FROM public.divergencias WHERE estoque = '1' AND modulo = '1')
  AND NOT EXISTS (SELECT 1 FROM public.lancamento_batch_runs WHERE batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.lancamento_draft_archive_lines WHERE line_id = 'ROW-SHARED-CONCURRENCY-001')
  AND NOT EXISTS (SELECT 1 FROM public.lancamento_draft_lines)
  AND EXISTS (
    SELECT 1 FROM public.lancamento_draft_control
    WHERE singleton IS TRUE
      AND generation_id = :'baseline_generation_id'::uuid
      AND revision = :'baseline_revision'::bigint
      AND next_sequence = :'baseline_next_sequence'::bigint
      AND updated_by IS NOT DISTINCT FROM nullif(:'baseline_updated_by', 'NULL')::uuid
      AND updated_at = (:'baseline_updated_at'::timestamp AT TIME ZONE 'UTC')
  )
  AND (SELECT count(*) FROM public.lancamento_batch_runs) = :'baseline_batch_count'::bigint
  AND (SELECT count(*) FROM public.lancamento_draft_archive_lines) = :'baseline_archive_count'::bigint
THEN 'PASS_CONCURRENCY_CLONE_RESTORED_TO_BASELINE'
ELSE 'FAIL_CONCURRENCY_CLONE_NOT_RESTORED'
END AS result;
