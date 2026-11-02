-- Recover only the exact synthetic rows committed by the latest local concurrency attempt.
-- LOCAL PG17 integration clone only. Not a migration; never use against production.
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

  -- Exact control state independently observed after the latest A/B attempt.
  IF v_control.generation_id <> '46d5a50c-1d49-4603-ac87-2880d8017117'::uuid
     OR v_control.revision <> 0
     OR v_control.next_sequence <> 1
     OR v_control.updated_by IS DISTINCT FROM '01f519c5-108b-4706-a10b-e8782f4fe079'::uuid
     OR v_control.updated_at <> '2026-10-30 02:49:46.003848+00'::timestamptz THEN
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

  -- Delete only the four exact synthetic records proven above.
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

  -- Restore logical baseline fields. Refresh updated_at because the runner output
  -- supplied no independently captured pre-run timestamp for this latest attempt.
  UPDATE public.lancamento_draft_control
  SET generation_id = '2cee16e6-6480-4bea-9bbf-fa27aceecddf'::uuid,
      revision = 0,
      next_sequence = 1,
      updated_by = NULL,
      updated_at = clock_timestamp()
  WHERE singleton IS TRUE
    AND generation_id = '46d5a50c-1d49-4603-ac87-2880d8017117'::uuid
    AND revision = 0
    AND next_sequence = 1
    AND updated_by = '01f519c5-108b-4706-a10b-e8782f4fe079'::uuid
    AND updated_at = '2026-10-30 02:49:46.003848+00'::timestamptz;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECOVERY_ABORT_CONTROL_RESTORE_FAILED'; END IF;

  RAISE NOTICE 'PASS_CONCURRENCY_THIRD_RUN_RECOVERED|exact_synthetic_ids_only=true|control_logical_baseline_restored=true|updated_at_refreshed=true';
END;
$safe_recovery$;
COMMIT;

SELECT 'VERIFY_SYNTHETIC|' ||
 (SELECT count(*)::text FROM public.slots WHERE id='1-1-TEST-CUTOVER-001') || '|' ||
 (SELECT count(*)::text FROM public.history WHERE id='MOV-ROW-SHARED-CONCURRENCY-001-SYNTH') || '|' ||
 (SELECT count(*)::text FROM public.divergencias WHERE estoque='1' AND modulo='1') || '|' ||
 (SELECT count(*)::text FROM public.lancamento_batch_runs WHERE batch_id='b7a10000-0000-4000-8000-000000000002'::uuid) || '|' ||
 (SELECT count(*)::text FROM public.lancamento_draft_archive_lines WHERE line_id='ROW-SHARED-CONCURRENCY-001') || '|' ||
 (SELECT count(*)::text FROM public.lancamento_draft_lines);

SELECT 'VERIFY_CONTROL|' || generation_id::text || '|' || revision::text || '|' || next_sequence::text || '|' ||
 coalesce(updated_by::text,'NULL') || '|' || (updated_at IS NOT NULL)::text
FROM public.lancamento_draft_control WHERE singleton IS TRUE;

SELECT 'VERIFY_TABLE_COUNTS|' ||
 (SELECT count(*)::text FROM public.lancamento_batch_runs) || '|' ||
 (SELECT count(*)::text FROM public.lancamento_draft_archive_lines) || '|' ||
 (SELECT count(*)::text FROM public.lancamento_draft_lines);

SELECT 'VERIFY_MODULE_1|' ||
 (SELECT count(*)::text FROM public.slots WHERE estoque='1' AND modulo='1') || '|' ||
 (SELECT count(*)::text FROM public.history WHERE estoque='1' AND modulo='1') || '|' ||
 (SELECT count(*)::text FROM public.divergencias WHERE estoque='1' AND modulo='1');
