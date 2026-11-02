import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIVE_APP_ROLES, PERMISSION_CATALOG } from '../src/constants/permissionCatalog.ts';
import { createPreviewPermissionMatrix } from '../src/lib/permissionAdminModel.ts';

const migration = await readFile(new URL('../docs/sql/migrations/20261030110000_permission_lideranca_configuravel.sql', import.meta.url), 'utf8');
const verify = await readFile(new URL('../docs/sql/20261030110000_permission_lideranca_verify.sql', import.meta.url), 'utf8');
const readScopeMigration = await readFile(new URL('../docs/sql/migrations/20261031150000_permission_read_scope_alignment.sql', import.meta.url), 'utf8');
const catalog = await readFile(new URL('../src/constants/permissionCatalog.ts', import.meta.url), 'utf8');
const resolver = await readFile(new URL('../src/lib/permissionResolver.ts', import.meta.url), 'utf8');
const adminModel = await readFile(new URL('../src/lib/permissionAdminModel.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/PermissionManagementPanel.tsx', import.meta.url), 'utf8');
const usersAdmin = await readFile(new URL('../src/components/AdminUsersManagement.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const adminUsersEdge = await readFile(new URL('../supabase/functions/admin-users/index.ts', import.meta.url), 'utf8');

test('Liderança pode ser cadastrada pela interface e aceita pelo backend', () => {
  assert.match(usersAdmin, /<option value="Liderança">Liderança \(Permissões configuráveis\)<\/option>/);
  assert.match(usersAdmin, /r: "Liderança", desc: "Perfil configurável\. Pesquisa de Estoque liberada por padrão; demais permissões continuam configuráveis pelo Administrador\."/);
  assert.doesNotMatch(usersAdmin, /Liderança \(legado\)/);
  assert.match(app, /Liderança:\s*"lideranca"/);
  assert.match(adminUsersEdge, /const allowedRoles = \[[\s\S]*?"lideranca"[\s\S]*?\]/);
});

test('Liderança é um dos cinco perfis ativos', () => {
  assert.deepEqual(ACTIVE_APP_ROLES, ['administrador', 'apoio', 'producao', 'visualizador', 'lideranca']);
  assert.equal(PERMISSION_CATALOG.length, 29);
});

test('Pesquisa começa liberada para Liderança e as outras 28 permissões permanecem negadas', () => {
  const matrix = createPreviewPermissionMatrix();
  assert.equal(matrix.rolePermissions.lideranca['stock.search'], true);
  for (const item of PERMISSION_CATALOG.filter((item) => item.key !== 'stock.search')) assert.equal(matrix.rolePermissions.lideranca[item.key], false, item.key);
  assert.match(adminModel, /"visualizador", "lideranca"/);
  assert.match(panel, /value: "lideranca", label: "Liderança"/);
});

test('SQL seed is fail-closed and validates complete 145-row matrix', () => {
  assert.match(migration, /SELECT 'lideranca', pc\.permission_key, FALSE/);
  assert.match(migration, /v_role_row_count <> 145/);
  assert.match(migration, /v_leadership_allowed_count <> 0/);
  assert.match(migration, /v_role_count <> 5/);
});

test('server helper and app context honor Liderança matrix and delegable overrides', () => {
  assert.match(migration, /v_role NOT IN \('apoio', 'producao', 'visualizador', 'lideranca'\)/);
  assert.match(migration, /WHEN v_role NOT IN \('lideranca', 'apoio', 'producao', 'visualizador'\) THEN FALSE/);
  assert.match(migration, /v_active_count \* 5/);
  assert.match(migration, /v_target_role NOT IN \('apoio', 'producao', 'visualizador', 'lideranca'\)/);
  assert.match(resolver, /return \{\s*allowed: definition\.defaults\[role\]/s);
  assert.doesNotMatch(resolver, /legacy_role_no_grants/);
});

test('admin-only permissions remain protected from role grants and individual overrides', () => {
  assert.match(migration, /IF v_is_admin_only AND v_new_allowed THEN/);
  assert.match(migration, /v_is_admin_only OR NOT v_override_allowed/);
  assert.match(catalog, /key: \"stock\.search\"[\s\S]*?defaults: \{ administrador: true, apoio: true, producao: true, visualizador: true, lideranca: true \}/);
  assert.match(readScopeMigration, /UPDATE public\.role_permissions[\s\S]*?SET allowed = TRUE[\s\S]*?WHERE role = 'lideranca'[\s\S]*?permission_key = 'stock\.search'/);
});

test('historical B9 verification remains read-only and documents its original all-denied seed', () => {
  assert.match(verify, /BEGIN TRANSACTION READ ONLY/);
  assert.match(verify, /WHERE rp\.role = 'lideranca'/);
  assert.match(verify, /ROLLBACK/);
  assert.match(verify, /B9_FUNCTION_SECURITY_VERIFY_FAILED/);
  assert.match(verify, /secure_function_count/);
  assert.doesNotMatch(verify, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|GRANT|REVOKE)\b/i);
});
