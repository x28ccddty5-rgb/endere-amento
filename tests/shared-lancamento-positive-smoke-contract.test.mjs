import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(resolve(root, 'docs/sql/20261029020000_shared_lancamento_positive_functional_smoke.sql'), 'utf8');
const runner = readFileSync(resolve(root, 'scripts/Test-SharedLancamentoPositive-LocalIntegration.ps1'), 'utf8');

test('positive smoke is one rollback-only transaction and is bound to the known synthetic product and empty E1 module', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /ROLLBACK;[\s\S]*?PASS_SHARED_BATCH_POSITIVE_SMOKE_ROLLED_BACK_NO_PERSISTENT_DATA/);
  assert.match(sql, /TEST-CUTOVER-001/);
  assert.match(sql, /v_module constant text := '1'/);
  assert.match(sql, /POSITIVE_SMOKE_ABORT_E1_MODULE_1_NOT_EMPTY/);
  assert.match(sql, /POSITIVE_SMOKE_ABORT_E1_MODULE_1_NOT_ACTIVE/);
  assert.match(sql, /POSITIVE_SMOKE_ABORT_SHARED_DRAFT_NOT_EMPTY/);
  assert.match(sql, /POSITIVE_SMOKE_ABORT_TEST_IDENTIFIERS_ALREADY_EXIST/);
  assert.doesNotMatch(sql, /\b(?:TRUNCATE\s+public\.(?:slots|history|divergencias)|DELETE\s+FROM\s+public\.(?:slots|history|divergencias)|UPDATE\s+public\.(?:slots|history|divergencias))\b/i);
});

test('positive smoke sends one canonical Entrada through the shared batch RPC and B7.1 launch writer', () => {
  assert.match(sql, /'quantidade', '1'[\s\S]*?'tipo', 'Entrada'/);
  assert.match(sql, /'id', v_slot_id[\s\S]*?'referencia', v_sku[\s\S]*?'saldo', 1/);
  assert.match(sql, /'id', v_history_id[\s\S]*?'quantidade', 1[\s\S]*?'tipo', 'Entrada'[\s\S]*?'slot_id', v_slot_id/);
  assert.match(sql, /process_shared_lancamento_draft_batch_atomic\([\s\S]*?jsonb_build_array\(v_slot_payload\)[\s\S]*?jsonb_build_array\(v_history_payload\)/);
  assert.match(sql, /coalesce\(\(v_stock_result->>'slots_written'\)\:\:bigint, -1\) <> 1/);
  assert.match(sql, /coalesce\(\(v_stock_result->>'history_written'\)\:\:bigint, -1\) <> 1/);
  assert.match(sql, /coalesce\(\(v_stock_result->>'divergencias_written'\)\:\:bigint, -1\) <> 0/);
  assert.match(sql, /coalesce\(\(v_stock_result->>'scopes_locked'\)\:\:bigint, 0\) <> 1/);
});

test('positive smoke proves history, batch idempotency, processed archive and unchanged final state on retry', () => {
  assert.match(sql, /h\.\"dataLancamento\" = v_date/);
  assert.match(sql, /h\.\"quemLancou\" = v_actor_name/);
  assert.match(sql, /POSITIVE_SMOKE_HISTORY_EVENT_MISSING_OR_INVALID/);
  assert.match(sql, /v_retry_result := public\.process_shared_lancamento_draft_batch_atomic/);
  assert.match(sql, /v_retry_result->>'already_processed'[\s\S]*?IS NOT TRUE/);
  assert.match(sql, /a\.disposition = 'processed'/);
  assert.match(sql, /POSITIVE_SMOKE_IDEMPOTENCY_CHANGED_BUSINESS_STATE/);
  assert.match(sql, /POSITIVE_SMOKE_IDEMPOTENCY_CHANGED_INTERNAL_STATE/);
  assert.match(sql, /POSITIVE_SMOKE_DRAFT_FINAL_STATE_INVALID/);
  assert.match(sql, /generation_id = :'baseline_generation_id'::uuid/);
  assert.match(sql, /revision = :'baseline_revision'::bigint/);
});

test('runner targets only the pinned local integration container and never manages its lifecycle or remote Supabase', () => {
  assert.match(runner, /supabase_db_enderecamento-integracao-local/);
  assert.match(runner, /enderecamento-integracao-local/);
  assert.match(runner, /c:\\testes\\enderecamento_integracao_local/i);
  assert.match(runner, /SHARED_RPC_SET\|true/);
  assert.match(runner, /TYPED_LAUNCH_WRITER\|true/);
  assert.match(runner, /SYNTHETIC_PRODUCT\|true/);
  assert.match(runner, /E1_MODULE_1_EMPTY\|true/);
  assert.match(runner, /E1_MODULE_1_ACTIVE\|true/);
  assert.match(runner, /PASS_SHARED_BATCH_POSITIVE_SMOKE_ROLLED_BACK_NO_PERSISTENT_DATA/);
  assert.doesNotMatch(runner, /docker\s+(?:start|stop|restart|rm|run)\b/i);
  assert.doesNotMatch(runner, /supabase\s+(?:db\s+reset|migration\s+up|start|stop|link|db\s+push)\b/i);
});

test('authenticated application role never directly reads internal batch/archive tables', () => {
  const authenticatedBlock = sql.match(/SET LOCAL ROLE authenticated;[\s\S]*?DO \$positive_smoke\$[\s\S]*?\$positive_smoke\$;/)?.[0];
  assert.ok(authenticatedBlock, 'authenticated positive smoke block must exist');
  assert.doesNotMatch(authenticatedBlock, /\b(?:FROM|JOIN)\s+public\.(?:lancamento_batch_runs|lancamento_draft_archive_lines|lancamento_draft_lines)\b/i);
  assert.match(sql, /RESET ROLE;[\s\S]*?DO \$archive_verify\$[\s\S]*?FROM public\.lancamento_batch_runs[\s\S]*?FROM public\.lancamento_draft_archive_lines/);
  assert.match(sql, /PASS_SHARED_BATCH_IDEMPOTENCY\|batch_records=1\|archive_processed=1/);
});
