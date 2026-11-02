import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scriptBytes = readFileSync(new URL('../scripts/Export-PermissionMutationInventory.ps1', import.meta.url));
const script = scriptBytes.toString('utf8').replace(/^\uFEFF/, '');
const doc = readFileSync(new URL('../docs/seguranca/Exportar-Contratos-Mutacoes.md', import.meta.url), 'utf8');

test('inventory PowerShell script is UTF-8 BOM compatible with Windows PowerShell 5.1 and ASCII-only', () => {
  assert.deepEqual([...scriptBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok([...script].every(ch => ch.codePointAt(0) < 128), 'PowerShell script body must remain ASCII-only');
});

test('inventory targets only the exact already-running local integration container', () => {
  assert.match(script, /supabase_db_enderecamento-integracao-local/);
  assert.match(script, /Where-Object \{ \$_ -eq \$targetContainerName \}/);
  assert.match(script, /Pare aqui\. O script nao iniciara outro ambiente/);
});

test('inventory only executes read-only catalog queries and does not mutate/start/reset/push', () => {
  assert.match(script, /pg_get_functiondef/);
  assert.match(script, /pg_policies/);
  assert.doesNotMatch(script, /\b(INSERT INTO|UPDATE\s+public\.|DELETE FROM|CREATE\s+(TABLE|FUNCTION|POLICY)|ALTER TABLE|DROP\s+(TABLE|FUNCTION)|db reset|db push|supabase start|supabase stop)\b/i);
  assert.match(doc, /somente leitura/i);
});

test('inventory gathers exact overload signatures, RLS policies, direct DML grants and trigger contracts', () => {
  for (const token of ['apply_stock_mutation_atomic', 'zero_physical_divergence_address_atomic', 'process_shared_lancamento_draft_batch_atomic', 'role_table_grants', 'pg_get_triggerdef', 'permission_catalog']) {
    assert.ok(script.includes(token), `missing audit item: ${token}`);
  }
});
