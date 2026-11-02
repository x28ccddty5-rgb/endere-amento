import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sessionA = readFileSync(resolve(root, 'docs/sql/20261029030000_shared_lancamento_concurrency_session_a.sql'), 'utf8');
const sessionB = readFileSync(resolve(root, 'docs/sql/20261029030000_shared_lancamento_concurrency_session_b.sql'), 'utf8');
const restore = readFileSync(resolve(root, 'docs/sql/20261029030000_shared_lancamento_concurrency_restore.sql'), 'utf8');
const runner = readFileSync(resolve(root, 'scripts/Test-SharedLancamentoConcurrency-LocalIntegration.ps1'), 'utf8');
const recoveryRunner = readFileSync(resolve(root, 'scripts/Restore-SharedLancamentoConcurrency-LocalIntegration.ps1'), 'utf8');
const recoverySql = readFileSync(resolve(root, 'docs/sql/20261029030000_shared_lancamento_concurrency_recovery_failed_run.sql'), 'utf8');

test('Session A processes one positive synthetic launch and deliberately holds its transaction lock', () => {
  assert.match(sessionA, /BEGIN;/);
  assert.match(sessionA, /SET LOCAL ROLE authenticated/);
  assert.match(sessionA, /upsert_shared_lancamento_draft_lines/);
  assert.match(sessionA, /process_shared_lancamento_draft_batch_atomic/);
  assert.doesNotMatch(sessionA, /apply_stock_mutation_atomic/i);
  assert.match(sessionA, /slots_written'[\s\S]*?<> 1/);
  assert.match(sessionA, /history_written'[\s\S]*?<> 1/);
  assert.match(sessionA, /SELECT pg_sleep\(20\);[\s\S]*?COMMIT;/);
  assert.match(sessionA, /PASS_CONCURRENCY_SESSION_A_PROCESSED/);
  assert.match(sessionA, /backend_pid=%[\s\S]*?pg_backend_pid\(\)/);
  assert.match(sessionA, /next_generation_id/);
});

test('Session B retries the same batch identity and requires already_processed without a second payload', () => {
  assert.match(sessionB, /SET LOCAL ROLE authenticated/);
  assert.match(sessionB, /b7a10000-0000-4000-8000-000000000002/);
  assert.match(sessionB, /process_shared_lancamento_draft_batch_atomic/);
  assert.match(sessionB, /v_result->>'already_processed'[\s\S]*?IS NOT TRUE/);
  assert.match(sessionB, /'\[\]'::jsonb/);
  assert.match(sessionB, /PASS_CONCURRENCY_SESSION_B_ALREADY_PROCESSED/);
});

test('runner proves Session B is blocked specifically by Session A before A can commit', () => {
  assert.match(runner, /pg_blocking_pids\(b\.pid\)/);
  assert.match(runner, /wait_event_type = 'Lock'/);
  assert.match(runner, /shared_batch_concurrency_a/);
  assert.match(runner, /shared_batch_concurrency_b/);
  assert.match(runner, /PASS_CONCURRENCY_SESSION_B_BLOCKED_BY_A/);
});

test('runner targets only the pinned local PG17 integration container and uses bounded waits', () => {
  assert.match(runner, /supabase_db_enderecamento-integracao-local/);
  assert.match(runner, /enderecamento-integracao-local/);
  assert.match(runner, /c:\\testes\\enderecamento_integracao_local/i);
  assert.match(runner, /for \(\$attempt = 0; -not \$aMarkerMatch\.Success -and \$attempt -lt 60; \$attempt\+\+\)[\s\S]*?Start-Sleep -Milliseconds 200/);
  assert.match(runner, /wait_event = 'PgSleep'/);
  assert.match(runner, /PASS_CONCURRENCY_SESSION_A_PROCESSED[\s\S]*?backend_pid=\(\[0-9\]\+\)/);
  assert.match(runner, /query ILIKE '%pg_sleep\(20\)%'/);
  assert.match(runner, /SESSION_A_DIAGNOSTIC/);
  assert.match(runner, /\$probeResult = [\s\S]*?return \(\$probeResult -in @\('t', 'true'\)\)/);
  assert.match(runner, /YYYY-MM-DD HH24:MI:SS\.US/);
  assert.match(runner, /\$\{Label\}: a sessão terminou antes da condição esperada/);
  assert.doesNotMatch(runner, /\"\$Label:/);
  assert.match(runner, /WaitForExit\(25000\)/);
  assert.match(runner, /WaitForExit\(40000\)/);
  assert.doesNotMatch(runner, /Stop-Process/);
  assert.match(runner, /noActiveTestSessionsSql/);
  assert.match(runner, /SHARED_RPC_SET\|true/);
  assert.match(runner, /TYPED_WRITERS\|true/);
  assert.match(runner, /-f '\/tmp\/shared-lancamento-concurrency-restore\.sql'/);
  assert.doesNotMatch(runner, /docker\s+(?:start|stop|restart|rm|run)\b/i);
  assert.doesNotMatch(runner, /supabase\s+(?:db\s+reset|migration\s+up|start|stop|link|db\s+push)\b/i);
});

test('cleanup removes only the exact synthetic IDs and restores the full shared control baseline', () => {
  assert.match(runner, /MOV-ROW-SHARED-CONCURRENCY-001-SYNTH/);
  assert.match(runner, /1-1-TEST-CUTOVER-001/);
  assert.match(runner, /ROW-SHARED-CONCURRENCY-001/);
  assert.match(runner, /b7a10000-0000-4000-8000-000000000002/);
  assert.match(restore, /generation_id = v_base_generation/);
  assert.match(restore, /revision = v_base_revision/);
  assert.match(restore, /next_sequence = v_base_sequence/);
  assert.match(restore, /updated_by = v_base_updated_by/);
  assert.match(restore, /updated_at = v_base_updated_at/);
  assert.match(restore, /v_control\.generation_id = v_expected_post_generation/);
  assert.match(runner, /expected_post_generation_id/);
  assert.match(restore, /v_total_batches = v_base_batches \+ 1/);
  assert.match(restore, /v_total_archives = v_base_archives \+ 1/);
  assert.match(runner, /baseline_batch_count/);
  assert.match(runner, /baseline_archive_count/);
  assert.match(restore, /CONCURRENCY_SAFE_RESTORE_ABORT_UNEXPECTED_STATE/);
  assert.match(restore, /PASS_CONCURRENCY_CLONE_RESTORED_TO_BASELINE/);
  assert.match(restore, /v_total_batches = v_base_batches \+ 1/);
  assert.match(restore, /v_total_archives = v_base_archives \+ 1/);
  assert.match(restore, /CONCURRENCY_SAFE_RESTORE_ABORT_UNEXPECTED_STATE/);
  assert.match(runner, /PASS_CONCURRENCY_CLONE_RESTORED_TO_BASELINE/);
});


test('failed-run recovery is pinned to the local clone and restores only the known synthetic state', () => {
  assert.match(recoveryRunner, /supabase_db_enderecamento-integracao-local/);
  assert.match(recoveryRunner, /RESTAURAR CLONE CONCORRENCIA LOCAL/);
  assert.match(recoveryRunner, /com\.docker\.compose\.project/);
  assert.match(recoverySql, /RECOVERY_ABORT_CONTROL_STATE_CHANGED/);
  assert.match(recoverySql, /RECOVERY_ABORT_SYNTHETIC_SLOT_MISMATCH/);
  assert.match(recoverySql, /RECOVERY_ABORT_SYNTHETIC_HISTORY_MISMATCH/);
  assert.match(recoverySql, /DELETE FROM public\.slots[\s\S]*?1-1-TEST-CUTOVER-001/);
  assert.match(recoverySql, /DELETE FROM public\.history[\s\S]*?MOV-ROW-SHARED-CONCURRENCY-001-SYNTH/);
  assert.match(recoverySql, /generation_id = '2cee16e6-6480-4bea-9bbf-fa27aceecddf'/);
  assert.match(recoverySql, /updated_at = clock_timestamp\(\)/);
  assert.doesNotMatch(recoverySql, /DELETE FROM public\.divergencias/);
});


test('recovery runner treats psql NOTICE stderr as output and validates native exit code', () => {
  assert.match(recoveryRunner, /previousErrorActionPreference/);
  assert.match(recoveryRunner, /ErrorActionPreference = 'Continue'/);
  assert.match(recoveryRunner, /2>&1/);
  assert.match(recoveryRunner, /\$code = \$LASTEXITCODE/);
  assert.match(recoveryRunner, /PASS_CONCURRENCY_FAILED_RUN_RECOVERED/);
});
