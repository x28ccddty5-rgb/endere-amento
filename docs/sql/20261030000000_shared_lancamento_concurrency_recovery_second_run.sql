-- Recovery for the SECOND failed local concurrency attempt.
-- LOCAL PG17 integration clone only. This is not a migration.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

DO $safe_recovery$
DECLARE
  v_control public.lancamento_draft_control%ROWTYPE;
  v_count bigint;
  v_rows bigint;
  v_active_sessions bigint;
BEGIN
  SELECT count(*) INTO v_active_sessions
  FROM pg_stat_activity
  WHERE application_name IN ('shared_batch_concurrency_a', 'shared_batch_concurrency_b')
    AND pid <> pg_backend_pid();
  IF v_active_sessions <> 0 THEN
    RAISE EXCEPTION 'RECOVERY_ABORT_CONCURRENCY_SESSION_STILL_ACTIVE|count=%', v_active_sessions;
  END IF;

  SELECT * INTO v_control
  FROM public.lancamento_draft_control
  WHERE singleton IS TRUE
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECOVERY_ABORT_CONTROL_ROW_MISSING'; END IF;

  -- Exact state observed after the second failed attempt.
  IF v_control.generation_id <> '1e80bd22-9918-4522-bda3-68bced42bd3e'::uuid
     OR v_control.revision <> 0
     OR v_control.next_sequence <> 1
     OR v_control.updated_by IS DISTINCT FROM '01f519c5-108b-4706-a10b-e8782f4fe079'::uuid
     OR v_control.updated_at <> '2026-10-30 02:40:32.789691+00'::timestamptz THEN
    RAISE EXCEPTION 'RECOVERY_ABORT_CONTROL_STATE_CHANGED|generation=%|revision=%|sequence=%|updated_by=%|updated_at=%',
      v_control.generation_id, v_control.revision, v_control.next_sequence,
      v_control.updated_by, v_control.updated_at;
  END IF;

  SELECT count(*) INTO v_count FROM public.slots
  WHERE id = '1-1-TEST-CUTOVER-001'
    AND estoque = '1' AND modulo = '1' AND coalesce(posicao, '') = ''
    AND referencia = 'TEST-CUTOVER-001' AND saldo = 1;
  IF v_count <> 1 THEN RAISE EXCEPTION 'RECOVERY_ABORT_SYNTHETIC_SLOT_MISMATCH|count=%', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.history
  WHERE id = 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH'
    AND estoque = '1' AND modulo = '1' AND coalesce(posicao, '') = ''
    AND referencia = 'TEST-CUTOVER-001'
    AND slot_id = '1-1-TEST-CUTOVER-001'
    AND quantidade = 1 AND tipo = 'Entrada';
  IF v_count <> 1 THEN RAISE EXCEPTION 'RECOVERY_ABORT_SYNTHETIC_HISTORY_MISMATCH|count=%', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.lancamento_batch_runs
  WHERE batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid;
  IF v_count <> 1 THEN RAISE EXCEPTION 'RECOVERY_ABORT_BATCH_RUN_MISMATCH|count=%', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.lancamento_draft_archive_lines
  WHERE line_id = 'ROW-SHARED-CONCURRENCY-001'
    AND batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid
    AND disposition = 'processed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'RECOVERY_ABORT_ARCHIVE_MISMATCH|count=%', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.divergencias
  WHERE estoque = '1' AND modulo = '1';
  IF v_count <> 0 THEN RAISE EXCEPTION 'RECOVERY_ABORT_UNEXPECTED_DIVERGENCE|count=%', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.slots
  WHERE estoque = '1' AND modulo = '1';
  IF v_count <> 1 THEN RAISE EXCEPTION 'RECOVERY_ABORT_UNEXPECTED_SLOT_IN_MODULE|count=%', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.history
  WHERE estoque = '1' AND modulo = '1';
  IF v_count <> 1 THEN RAISE EXCEPTION 'RECOVERY_ABORT_UNEXPECTED_HISTORY_IN_MODULE|count=%', v_count; END IF;

  IF (SELECT count(*) FROM public.lancamento_batch_runs) <> 1
     OR (SELECT count(*) FROM public.lancamento_draft_archive_lines) <> 1
     OR EXISTS (SELECT 1 FROM public.lancamento_draft_lines) THEN
    RAISE EXCEPTION 'RECOVERY_ABORT_TABLE_BASELINE_CHANGED';
  END IF;

  -- Remove only the four verified synthetic records from this failed attempt.
  DELETE FROM public.lancamento_draft_archive_lines
  WHERE line_id = 'ROW-SHARED-CONCURRENCY-001'
    AND batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'RECOVERY_ABORT_ARCHIVE_DELETE_COUNT|count=%', v_rows; END IF;

  DELETE FROM public.lancamento_batch_runs
  WHERE batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'RECOVERY_ABORT_BATCH_DELETE_COUNT|count=%', v_rows; END IF;

  DELETE FROM public.history
  WHERE id = 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'RECOVERY_ABORT_HISTORY_DELETE_COUNT|count=%', v_rows; END IF;

  DELETE FROM public.slots
  WHERE id = '1-1-TEST-CUTOVER-001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'RECOVERY_ABORT_SLOT_DELETE_COUNT|count=%', v_rows; END IF;

  -- Restore the exact shared-control baseline captured immediately BEFORE
  -- the second attempt. This timestamp is valid and does not need refreshing.
  UPDATE public.lancamento_draft_control
  SET generation_id = '2cee16e6-6480-4bea-9bbf-fa27aceecddf'::uuid,
      revision = 0,
      next_sequence = 1,
      updated_by = NULL,
      updated_at = '2026-10-30 02:32:50.896128+00'::timestamptz
  WHERE singleton IS TRUE
    AND generation_id = '1e80bd22-9918-4522-bda3-68bced42bd3e'::uuid
    AND revision = 0
    AND next_sequence = 1
    AND updated_by = '01f519c5-108b-4706-a10b-e8782f4fe079'::uuid
    AND updated_at = '2026-10-30 02:40:32.789691+00'::timestamptz;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECOVERY_ABORT_CONTROL_RESTORE_FAILED'; END IF;

  RAISE NOTICE 'PASS_CONCURRENCY_SECOND_FAILED_RUN_RECOVERED|exact_synthetic_ids_only=true|control_baseline_restored=true';
END;
$safe_recovery$;
COMMIT;

SELECT
  'RECOVERY_VERIFY|' ||
  (SELECT count(*)::text FROM public.slots WHERE id = '1-1-TEST-CUTOVER-001') || '|' ||
  (SELECT count(*)::text FROM public.history WHERE id = 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH') || '|' ||
  (SELECT count(*)::text FROM public.divergencias WHERE estoque = '1' AND modulo = '1') || '|' ||
  (SELECT count(*)::text FROM public.lancamento_batch_runs WHERE batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid) || '|' ||
  (SELECT count(*)::text FROM public.lancamento_draft_archive_lines WHERE line_id = 'ROW-SHARED-CONCURRENCY-001') || '|' ||
  (SELECT count(*)::text FROM public.lancamento_draft_lines);

SELECT
  'CONTROL_VERIFY|' || generation_id::text || '|' || revision::text || '|' || next_sequence::text || '|' ||
  coalesce(updated_by::text, 'NULL') || '|' || to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')
FROM public.lancamento_draft_control
WHERE singleton IS TRUE;

SELECT CASE WHEN
  generation_id = '2cee16e6-6480-4bea-9bbf-fa27aceecddf'::uuid
  AND revision = 0 AND next_sequence = 1 AND updated_by IS NULL
  AND updated_at = '2026-10-30 02:32:50.896128+00'::timestamptz
THEN 'PASS_CONCURRENCY_SECOND_RUN_CONTROL_BASELINE_RESTORED'
ELSE 'FAIL_CONCURRENCY_SECOND_RUN_CONTROL_BASELINE_NOT_RESTORED'
END AS result
FROM public.lancamento_draft_control
WHERE singleton IS TRUE;
