import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(resolve(root, 'scripts/Inspect-SharedLaunchContract-LocalIntegration.ps1'), 'utf8');
const sql = script.slice(script.indexOf("$sql=@'"), script.indexOf("\n'@\n$rows="));
test('targets only the known local integration container and exact Docker labels', () => {
  assert.match(script, /supabase_db_enderecamento-integracao-local/);
  assert.match(script, /enderecamento-integracao-local/);
  assert.match(script, /c:\\testes\\enderecamento_integracao_local/i);
  assert.match(script, /State\.Running -ne \$true/);
});
test('is read-only and has no migration, DDL, DML, permission, or container lifecycle commands', () => {
  assert.match(script, /SOMENTE LEITURA/);
  assert.doesNotMatch(script, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REVOKE|GRANT)\s+(?:TABLE|FUNCTION|POLICY|INDEX|TRIGGER|ON|INTO|ALL|EXECUTE|[A-Z])/i);
  assert.doesNotMatch(script, /docker\s+(?:start|stop|restart|rm|run)\b/i);
  assert.doesNotMatch(script, /supabase\s+(?:db\s+reset|migration\s+up|start|stop)\b/i);
});
test('inspects the full shared-draft table and RPC family', () => {
  for (const name of ['lancamento_drafts','lancamento_draft_legacy_quarantine','lancamento_draft_control','lancamento_draft_lines','lancamento_draft_archive_lines','lancamento_batch_runs']) assert.ok(sql.includes(`('${name}')`), name);
  for (const name of ['get_shared_lancamento_draft','upsert_shared_lancamento_draft_lines','delete_shared_lancamento_draft_line','clear_shared_lancamento_draft','get_shared_lancamento_batch_result','process_shared_lancamento_draft_batch_atomic']) assert.ok(sql.includes(name), name);
});
test('reports typed/legacy stock writer properties and external callers', () => {
  assert.match(sql, /STOCK_WRITER/);
  assert.match(sql, /authenticated_exec/);
  assert.match(sql, /STOCK_OPERATION_TYPE_REQUIRED/);
  assert.match(sql, /WRITER_CALLER/);
});
test('checks the exact PostgreSQL 17 local database and never changes project state', () => {
  assert.match(script, /current_database\(\).*current_setting\('server_version'\)/);
  assert.match(script, /postgres\\\|17/);
  assert.match(script, /READ_ONLY_COMPLETE\|true/);
  assert.match(script, /does not execute|Não executa migrations\/DDL\/DML/i);
});
