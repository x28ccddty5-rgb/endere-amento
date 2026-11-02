import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(resolve(root, 'docs/sql/20261029010000_shared_lancamento_draft_functional_smoke.sql'), 'utf8');
const runner = readFileSync(resolve(root, 'scripts/Test-SharedLancamentoDraft-LocalIntegration.ps1'), 'utf8');

test('functional smoke creates only an isolated canonical E1 fixture inside one transaction', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /ROLLBACK;\s*SELECT 'PASS_SHARED_BATCH_FUNCTIONAL_SMOKE_ROLLED_BACK_NO_PERSISTENT_DATA'/);
  assert.match(sql, /v_module text := '987654321'/);
  assert.match(sql, /v_sku text := 'TEST_SHARED_BATCH_'.*gen_random_uuid\(\)/);
  assert.match(sql, /s\.estoque = '1' AND s\.modulo = v_module/);
  assert.match(sql, /INSERT INTO public\.slots AS inserted/);
  assert.match(sql, /v_slot_id, '1', v_module, '', v_sku[\s\S]*?0, '3', 'nenhuma'/);
  assert.match(sql, /RETURNING to_jsonb\(inserted\) INTO v_fixture/);
  assert.match(sql, /set_config\('test\.shared_lancamento_fixture_snapshot'/);
  assert.doesNotMatch(sql, /\b(?:UPDATE\s+public\.slots|DELETE\s+FROM\s+public\.slots|TRUNCATE\s+public\.slots)\b/i);
});

test('functional smoke authenticates the Administrator and uses the fixture as the complete B7.1 snapshot', () => {
  assert.ok(sql.indexOf('$fixture_setup$;') < sql.indexOf('SET LOCAL ROLE authenticated'));
  assert.match(sql, /v_slots_before IS DISTINCT FROM jsonb_build_array\(v_fixture_snapshot\)/);
  assert.match(sql, /process_shared_lancamento_draft_batch_atomic\([\s\S]*?v_slots_before,[\s\S]*?v_slots_before/);
  assert.match(sql, /'expected_business_writes', 0/);
  assert.match(sql, /'slots_written'\)::bigint, -1\) <> 0/);
  assert.match(sql, /'history_written'\)::bigint, -1\) <> 0/);
  assert.match(sql, /'divergencias_written'\)::bigint, -1\) <> 0/);
  assert.match(sql, /'scopes_locked'\)::bigint, 0\) <> 1/);
});

test('functional smoke verifies batch idempotency, draft finalization and unchanged business snapshots', () => {
  assert.match(sql, /v_process_result->>'already_processed'\)::boolean, false\) IS TRUE/);
  assert.match(sql, /v_retry_result->>'already_processed'\)::boolean, false\) IS NOT TRUE/);
  assert.match(sql, /FUNCTIONAL_SMOKE_IDEMPOTENCY_RETRY_FAILED/);
  assert.match(sql, /FUNCTIONAL_SMOKE_DRAFT_FINAL_STATE_INVALID/);
  assert.match(sql, /RESET ROLE;[\s\S]*?FROM public\.lancamento_draft_archive_lines/);
  assert.match(sql, /count\(\*\) FILTER \(WHERE a\.disposition = 'ignored'\)/);
  assert.match(sql, /FROM public\.lancamento_batch_runs[\s\S]*?v_batch_count <> 1/);
  assert.match(sql, /v_slots_after IS DISTINCT FROM v_slots_before/);
  assert.match(sql, /v_divergences_after IS DISTINCT FROM v_divergences_before/);
  assert.match(sql, /v_history_after IS DISTINCT FROM v_history_before/);
  assert.match(runner, /supabase_db_enderecamento-integracao-local/);
  assert.match(runner, /c:\\testes\\enderecamento_integracao_local/i);
  assert.doesNotMatch(runner, /docker\s+(?:start|stop|restart|rm|run)\b/i);
  assert.doesNotMatch(runner, /supabase\s+(?:db\s+reset|migration\s+up|start|stop)\b/i);
});
