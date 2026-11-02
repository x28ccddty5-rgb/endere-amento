import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../scripts/Diagnose-PermissionIntegration.ps1', import.meta.url), 'utf8');

test('diagnostic targets only the existing local integration container', () => {
  assert.match(script, /supabase_db_enderecamento-integracao-local/);
  assert.match(script, /docker exec \$dbContainer psql -U postgres -d postgres/);
  assert.match(script, /Nenhuma alteracao foi feita/);
});

test('diagnostic is read-only and does not start, stop, reset or push Supabase', () => {
  assert.doesNotMatch(script, /\bsupabase\s+(?:start|stop|db\s+reset|db\s+push|link)\b/i);
  assert.doesNotMatch(script, /\bdocker\s+(?:run|stop|rm|compose\s+down|restart)\b/i);
  assert.doesNotMatch(script, /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|GRANT\s+|REVOKE\s+)\b/i);
});

test('diagnostic checks core write routes and permission foundation without assuming tables exist', () => {
  for (const table of ['profiles','slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions','occupancy_history','permission_catalog','role_permissions','user_permission_overrides','permission_change_audit']) {
    assert.ok(script.includes(`'${table}'`) || script.includes(`'public.${table}`), `missing check for ${table}`);
  }
  for (const fn of ['apply_stock_mutation_atomic','apply_stock_mutation_atomic_with_deletes','process_shared_lancamento_draft_batch_atomic','resolve_stock_divergence_atomic','zero_physical_divergence_address_atomic','save_warehouse_layout_atomic','save_warehouse_positions_atomic']) {
    assert.ok(script.includes(fn), `missing check for ${fn}`);
  }
});
