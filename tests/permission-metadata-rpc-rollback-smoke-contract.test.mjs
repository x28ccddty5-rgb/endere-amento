import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = fs.readFileSync(path.join(root, 'scripts/Test-PermissionMetadataRpc-LocalIntegration.ps1'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'docs/sql/20261028070000_permission_slot_metadata_rollback_smoke.sql'), 'utf8');


test('uses a JSON row key for case-sensitive dataChacote in PowerShell preflight SQL', () => {
  assert.match(runner, /to_jsonb\(s\)->>'dataChacote'/);
  assert.doesNotMatch(runner, /coalesce\(s\.\"dataChacote\"::text/);
  assert.match(runner, /RPC-METADATA-SMOKE-V2-JSON-KEY/);
});

test('targets only the known local integration container and exact Docker labels', () => {
  assert.match(runner, /supabase_db_enderecamento-integracao-local/);
  assert.match(runner, /enderecamento-integracao-local/);
  assert.match(runner, /c:\\testes\\enderecamento_integracao_local/);
  assert.match(runner, /docker inspect/);
  assert.match(runner, /State\.Running/);
  assert.doesNotMatch(runner, /supabase\.co|db\.[a-z0-9]+\.supabase\.co/i);
  assert.doesNotMatch(runner, /docker (start|restart|stop|rm)\b/i);
});

test('requires foundation, migration, a valid sample slot, and literal confirmation', () => {
  assert.match(runner, /CATALOG/);
  assert.match(runner, /METADATA_RPC/);
  assert.match(runner, /ELIGIBLE_SLOTS/);
  assert.match(runner, /TESTAR RPC METADADOS COM ROLLBACK LOCAL/);
});

test('tests denial for production and a successful administrator metadata update', () => {
  assert.match(sql, /PASS_PRODUCTION_DENIED/);
  assert.match(sql, /PERMISSION_DENIED:map\.metadata\.edit/);
  assert.match(sql, /PASS_ADMIN_METADATA_UPDATED/);
  assert.match(sql, /SLOT_METADATA_UPDATED/);
});

test('asserts only metadata fields change and all writes are rolled back', () => {
  assert.match(sql, /to_jsonb\(v_after\) - ARRAY\['dataChacote','galpao','restricao','observacao'\]/);
  assert.match(sql, /PASS_NON_METADATA_FIELDS_UNCHANGED/);
  assert.match(sql, /PASS_MARKER_VISIBLE_BEFORE_ROLLBACK/);
  assert.match(sql, /ROLLBACK;/);
  assert.match(runner, /MARKER_COUNT_AFTER_ROLLBACK/);
});

test('does not revoke DML grants, alter policies, or mutate stock outside RPC', () => {
  assert.doesNotMatch(runner + sql, /REVOKE\s+INSERT|REVOKE\s+UPDATE|DROP POLICY|ALTER POLICY|apply_stock_mutation_atomic|DELETE FROM\s+public\.slots/i);
  assert.match(sql, /update_slot_metadata_atomic/);
});
