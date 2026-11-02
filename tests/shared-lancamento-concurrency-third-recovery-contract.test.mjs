import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(resolve(root, 'docs/sql/20261030010000_shared_lancamento_concurrency_recovery_third_run.sql'), 'utf8');
const runner = readFileSync(resolve(root, 'scripts/Restore-SharedLancamentoConcurrency-ThirdRun-LocalIntegration.ps1'), 'utf8');

test('recovery is pinned to the exact third-run control generation and timestamp', () => {
  assert.match(sql, /46d5a50c-1d49-4603-ac87-2880d8017117/);
  assert.match(sql, /2026-10-30 02:49:46\.003848\+00/);
  assert.match(sql, /2cee16e6-6480-4bea-9bbf-fa27aceecddf/);
});

test('recovery refuses active test sessions and mismatched synthetic records', () => {
  assert.match(sql, /RECOVERY_ABORT_CONCURRENCY_SESSION_STILL_ACTIVE/);
  assert.match(sql, /RECOVERY_ABORT_SYNTHETIC_SLOT_MISMATCH/);
  assert.match(sql, /RECOVERY_ABORT_SYNTHETIC_HISTORY_MISMATCH/);
  assert.match(sql, /RECOVERY_ABORT_TABLE_BASELINE_CHANGED/);
});

test('recovery deletes only the four exact synthetic record identities and never divergences', () => {
  assert.match(sql, /DELETE FROM public\.lancamento_draft_archive_lines[\s\S]*?ROW-SHARED-CONCURRENCY-001/);
  assert.match(sql, /DELETE FROM public\.lancamento_batch_runs[\s\S]*?b7a10000-0000-4000-8000-000000000002/);
  assert.match(sql, /DELETE FROM public\.history[\s\S]*?MOV-ROW-SHARED-CONCURRENCY-001-SYNTH/);
  assert.match(sql, /DELETE FROM public\.slots[\s\S]*?1-1-TEST-CUTOVER-001/);
  assert.doesNotMatch(sql, /DELETE FROM public\.divergencias/);
});

test('recovery restores logical control baseline and refreshes updated_at', () => {
  assert.match(sql, /generation_id = '2cee16e6-6480-4bea-9bbf-fa27aceecddf'/);
  assert.match(sql, /revision = 0/);
  assert.match(sql, /next_sequence = 1/);
  assert.match(sql, /updated_by = NULL/);
  assert.match(sql, /updated_at = clock_timestamp\(\)/);
});

test('runner is pinned to the local PG17 integration container and checks exact preflight state', () => {
  assert.match(runner, /supabase_db_enderecamento-integracao-local/);
  assert.match(runner, /enderecamento-integracao-local/);
  assert.match(runner, /c:\\testes\\enderecamento_integracao_local/i);
  assert.match(runner, /SESSIONS\|0/);
  assert.match(runner, /SYNTHETIC\|1\|1\|0\|1\|1\|0/);
  assert.match(runner, /CONTROL\|46d5a50c-1d49-4603-ac87-2880d8017117/);
});

test('runner uses explicit confirmation, native exit code, and independent post-recovery verification', () => {
  assert.match(runner, /RESTAURAR TERCEIRA TENTATIVA DE CONCORRENCIA LOCAL/);
  assert.match(runner, /\$process\.ExitCode -ne 0/);
  assert.match(runner, /VERIFY_SYNTHETIC\|0\|0\|0\|0\|0\|0/);
  assert.match(runner, /VERIFY_CONTROL\|2cee16e6-6480-4bea-9bbf-fa27aceecddf\|0\|1\|NULL\|true/);
  assert.match(runner, /VERIFY_TABLE_COUNTS\|0\|0\|0/);
  assert.match(runner, /PASS_THIRD_CONCURRENCY_ATTEMPT_RECOVERED/);
});
