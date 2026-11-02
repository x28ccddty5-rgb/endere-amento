import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

const catalogTs = read('src/constants/permissionCatalog.ts');
const migration = read('docs/sql/migrations/20261028010000_permission_foundation.sql');
const preflight = read('docs/sql/20261028010000_permission_foundation_preflight.sql');
const verifySql = read('docs/sql/20261028010000_permission_foundation_verify.sql');
const rollback = read('docs/sql/rollback/20261028010000_rollback_permission_foundation.sql');

function parseTypeScriptCatalog(source) {
  const pattern = /\{\s*key: "([^"]+)",\s*(?:isDeprecated: true,\s*)?group: "([^"]+)",\s*label: "([^"]+)",\s*description: "([^"]+)",\s*userOverrideAllowed: (true|false),\s*defaults: \{ administrador: (true|false), apoio: (true|false), producao: (true|false), visualizador: (true|false), lideranca: (true|false) \},\s*\}/gs;
  return [...source.matchAll(pattern)].map((match) => ({
    key: match[1],
    group: match[2],
    label: match[3],
    description: match[4],
    overrideAllowed: match[5] === 'true',
    defaults: {
      administrador: match[6] === 'true',
      apoio: match[7] === 'true',
      producao: match[8] === 'true',
      visualizador: match[9] === 'true',
      lideranca: match[10] === 'true',
    },
  }));
}

function parseSqlSeedRows(statementBody) {
  const pattern = /^\s*\('([^']+)',\s*'([^']+)',\s*(TRUE|FALSE)\),?\s*$/gm;
  return [...statementBody.matchAll(pattern)].map((match) => ({
    role: match[1],
    permissionKey: match[2],
    allowed: match[3] === 'TRUE',
  }));
}

function withoutSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

const tsCatalog = parseTypeScriptCatalog(catalogTs);
const catalogSeedMatch = migration.match(/INSERT INTO public\.permission_catalog\s*\([\s\S]*?\)\s*VALUES\n([\s\S]*?\);)\s*\n\s*INSERT INTO public\.role_permissions/i);
const roleSeedMatch = migration.match(/INSERT INTO public\.role_permissions\s*\(role, permission_key, allowed\)\s*VALUES\n([\s\S]*?);/i);
assert.ok(catalogSeedMatch, 'migration must contain the permission catalog seed');
assert.ok(roleSeedMatch, 'migration must contain the role permission seed');
const catalogSeed = catalogSeedMatch[1];
const roleSeed = roleSeedMatch[1];

const sqlCatalogRows = [...catalogSeed.matchAll(/^\s*\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(TRUE|FALSE),\s*(TRUE|FALSE),\s*(TRUE|FALSE),\s*(\d+)\)[,;]?\s*$/gm)].map((m) => ({
  key: m[1], group: m[2], label: m[3], description: m[4], risk: m[5],
  adminOnly: m[6] === 'TRUE', overrideAllowed: m[7] === 'TRUE', active: m[8] === 'TRUE', sortOrder: Number(m[9]),
}));
const sqlRoleRows = parseSqlSeedRows(roleSeed);

test('migration catalog has all 29 unique keys from the TypeScript contract', () => {
  assert.equal(tsCatalog.length, 29);
  assert.equal(sqlCatalogRows.length, 29);
  assert.equal(new Set(sqlCatalogRows.map((row) => row.key)).size, 29);
  assert.deepEqual(sqlCatalogRows.map((row) => row.key).sort(), tsCatalog.map((row) => row.key).sort());
});

test('catalog metadata, override flags, labels and descriptions match the TypeScript contract', () => {
  const sqlByKey = new Map(sqlCatalogRows.map((row) => [row.key, row]));
  for (const source of tsCatalog) {
    const seeded = sqlByKey.get(source.key);
    assert.ok(seeded, `missing catalog seed: ${source.key}`);
    assert.equal(seeded.group, source.group, `${source.key}: module`);
    assert.equal(seeded.label, source.label, `${source.key}: label`);
    if (!['stock.search', 'stock.details.view'].includes(source.key)) {
      assert.equal(seeded.description, source.description, `${source.key}: description`);
    }
    assert.equal(seeded.overrideAllowed, source.overrideAllowed, `${source.key}: override flag`);
    assert.equal(seeded.adminOnly, !source.overrideAllowed, `${source.key}: admin-only flag`);
    assert.equal(seeded.active, true, `${source.key}: active flag`);
  }
});

test('base matrix has exactly 116 unique grants and agrees with TypeScript defaults', () => {
  assert.equal(sqlRoleRows.length, 116);
  const roles = ['administrador', 'apoio', 'producao', 'visualizador'];
  assert.equal(new Set(sqlRoleRows.map(({ role, permissionKey }) => `${role}|${permissionKey}`)).size, 116);
  assert.deepEqual([...new Set(sqlRoleRows.map((row) => row.role))].sort(), [...roles].sort());
  const typeByKey = new Map(tsCatalog.map((entry) => [entry.key, entry]));
  for (const row of sqlRoleRows) {
    const source = typeByKey.get(row.permissionKey);
    assert.ok(source, `role seed references unknown key ${row.permissionKey}`);
    assert.equal(row.allowed, source.defaults[row.role], `${row.role}/${row.permissionKey}`);
  }
});

test('Visualizador can view launch screen without receiving launch mutation permission', () => {
  const rows = new Map(sqlRoleRows.map((row) => [`${row.role}|${row.permissionKey}`, row.allowed]));
  assert.equal(rows.get('visualizador|stock.launch.view'), true);
  assert.equal(rows.get('visualizador|stock.launch.create'), false);
  assert.equal(rows.get('apoio|stock.launch.create'), true);
  assert.equal(rows.get('producao|stock.launch.create'), false);
});

test('migration keeps existing stock policies and RPCs untouched', () => {
  assert.doesNotMatch(migration, /\b(?:CREATE|ALTER|DROP)\s+POLICY\b/i);
  assert.doesNotMatch(migration, /FUNCTION\s+public\.(?:apply_stock_mutation_atomic|apply_stock_mutation_atomic_with_deletes|reconcile_physical_address_atomic|save_warehouse_layout_atomic)/i);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+)?public\.(?:slots|history|divergencias)\b/i);
});

test('all authorization tables have RLS enabled and direct client ACLs revoked', () => {
  for (const table of ['permission_catalog', 'role_permissions', 'user_permission_overrides', 'permission_change_audit']) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'));
    assert.match(migration, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`, 'i'));
  }
});

test('security-definer RPCs pin search_path and have explicit authenticated-only execute grants', () => {
  for (const fn of ['has_app_permission', 'get_my_app_context', 'get_permission_admin_matrix']) {
    const functionStart = migration.indexOf(`CREATE FUNCTION public.${fn}`);
    assert.notEqual(functionStart, -1, `missing function ${fn}`);
    const functionEnd = migration.indexOf('$function$;', functionStart) + '$function$;'.length;
    const definition = migration.slice(functionStart, functionEnd);
    assert.match(definition, /SECURITY DEFINER/i, `${fn}: security definer`);
    assert.match(definition, /SET search_path = ''/i, `${fn}: pinned search_path`);
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`, 'i'));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`, 'i'));
  }
  assert.match(migration, /APP_CONTEXT_PERMISSION_MATRIX_INCOMPLETE/);
  assert.match(migration, /PERMISSION_ADMIN_REQUIRED/);
  assert.match(migration, /RETURN FALSE/);
});

test('read-only preflight has no data or schema mutations', () => {
  const executable = withoutSqlComments(preflight);
  assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/i);
  assert.match(preflight, /legacy_lideranca_profiles/i);
  assert.match(preflight, /unknown_role_profiles/i);
  assert.doesNotMatch(migration, /PERMISSION_PREFLIGHT_LEGACY_LIDERANCA_USERS/);
  assert.match(migration, /legacy role is not granted implicitly/i);
  assert.match(migration, /v_role NOT IN \('apoio', 'producao', 'visualizador'\)[\s\S]*?RETURN FALSE/i);
  assert.match(preflight, /anon_role_exists/i);
  assert.match(preflight, /authenticated_role_exists/i);
  assert.match(preflight, /auth_uid_function_exists/i);
  assert.match(preflight, /required_profile_columns_exist/i);
  assert.match(migration, /PERMISSION_PREFLIGHT_SUPABASE_ROLES_MISSING/);
  assert.match(migration, /PERMISSION_PREFLIGHT_AUTH_UID_MISSING/);
  assert.match(migration, /PERMISSION_PREFLIGHT_PROFILE_COLUMNS_MISSING/);
});

test('legacy Liderança can remain during transition but has no new permission grants', () => {
  assert.match(migration, /'administrador', 'lideranca', 'apoio', 'producao', 'visualizador'/i);
  assert.match(migration, /WHEN v_role NOT IN \('apoio', 'producao', 'visualizador'\) THEN FALSE/i);
  assert.match(migration, /v_role NOT IN \('apoio', 'producao', 'visualizador'\)/i);
  assert.doesNotMatch(roleSeed, /lideranca/i);
});

test('post-migration SQL verifies seed counts, RLS and direct access privileges', () => {
  assert.match(verifySql, /Expected 29 active keys/);
  assert.match(verifySql, /Expected 116 explicit role rows/);
  assert.match(verifySql, /has_table_privilege\('authenticated'/);
  assert.match(verifySql, /has_function_privilege\('anon'/);
});

test('rollback refuses existing overrides/audit changes and verifies seeded content before dropping', () => {
  assert.match(rollback, /ROLLBACK_BLOCKED_PERMISSION_DATA_EXISTS/);
  assert.match(rollback, /ROLLBACK_BLOCKED_ROLE_MATRIX_CONTENT_CHANGED/);
  assert.match(rollback, /ROLLBACK_BLOCKED_CATALOG_CONTENT_CHANGED/);
  assert.match(rollback, /DROP TABLE public\.permission_change_audit/);
  assert.doesNotMatch(rollback, /DROP TABLE public\.(?:slots|history|divergencias|profiles|products)/i);
});
