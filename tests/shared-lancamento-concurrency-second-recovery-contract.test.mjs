import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(root, 'docs/sql/20261030000000_shared_lancamento_concurrency_recovery_second_run.sql'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'scripts/Restore-SharedLancamentoConcurrency-SecondFailedRun-LocalIntegration.ps1'), 'utf8');

test('recovery is pinned to the exact local PG17 integration container and labels', () => {
  assert.match(runner, /supabase_db_enderecamento-integracao-local/);
  assert.match(runner, /enderecamento-integracao-local/);
  assert.match(runner, /c:\\testes\\enderecamento_integracao_local/);
  assert.match(runner, /RESTAURAR SEGUNDA TENTATIVA DE CONCORRENCIA LOCAL/);
  assert.doesNotMatch(runner, /supabase\s+(?:db\s+push|link|start|stop|db\s+reset)/i);
});

test('recovery requires the exact second-attempt control baseline and no active test sessions', () => {
  assert.match(sql, /1e80bd22-9918-4522-bda3-68bced42bd3e/);
  assert.match(sql, /2026-10-30 02:40:32\.789691\+00/);
  assert.match(sql, /RECOVERY_ABORT_CONCURRENCY_SESSION_STILL_ACTIVE/);
  assert.match(runner, /SESSIONS\|0/);
});

test('recovery deletes only the exact synthetic slot, history, batch and archive row', () => {
  for (const token of [
    '1-1-TEST-CUTOVER-001', 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH',
    'b7a10000-0000-4000-8000-000000000002', 'ROW-SHARED-CONCURRENCY-001'
  ]) assert.ok(sql.includes(token), `missing ${token}`);
  assert.match(sql, /DELETE FROM public\.lancamento_draft_archive_lines/);
  assert.match(sql, /DELETE FROM public\.lancamento_batch_runs/);
  assert.match(sql, /DELETE FROM public\.history/);
  assert.match(sql, /DELETE FROM public\.slots/);
  assert.doesNotMatch(sql, /DELETE FROM public\.divergencias/);
});

test('recovery restores the exact pre-attempt generation and valid timestamp', () => {
  assert.match(sql, /generation_id = '2cee16e6-6480-4bea-9bbf-fa27aceecddf'/);
  assert.match(sql, /updated_at = '2026-10-30 02:32:50\.896128\+00'::timestamptz/);
  assert.match(runner, /VERIFY_CONTROL\|2cee16e6-6480-4bea-9bbf-fa27aceecddf\|0\|1\|NULL\|2026-10-30 02:32:50\.896128/);
});

test('runner captures psql stderr separately and trusts its native exit code', () => {
  assert.match(runner, /Start-Process/);
  assert.match(runner, /RedirectStandardOutput/);
  assert.match(runner, /RedirectStandardError/);
  assert.match(runner, /process\.ExitCode/);
});

test('runner independently verifies zero synthetic records and zero table counts after commit', () => {
  assert.match(runner, /VERIFY_SYNTHETIC\|0\|0\|0\|0\|0\|0/);
  assert.match(runner, /VERIFY_TABLES\|0\|0\|0/);
  assert.match(runner, /PASS_SECOND_CONCURRENCY_ATTEMPT_RECOVERED/);
});
