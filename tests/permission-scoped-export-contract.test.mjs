import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const canonicalPath = 'docs/sql/migrations/20261028050000_permission_scoped_check.sql';
const sandboxPath = 'docs/seguranca/permission-sandbox/supabase/migrations/20261028050000_permission_scoped_check.sql';
const catalogSource = read('src/constants/permissionCatalog.ts');
const catalogKeys = new Set([...catalogSource.matchAll(/key:\s*"([^"]+)"/g)].map((match) => match[1]));

test('scoped authorization migration is byte-for-byte identical in canonical and isolated sandbox paths', () => {
  assert.equal(read(canonicalPath), read(sandboxPath));
});

test('batched permission RPC has bounded input, rejects duplicates/unknown keys, and requires authenticated identity', () => {
  const sql = read(canonicalPath);
  assert.match(sql, /CREATE FUNCTION public\.has_app_permissions\(p_permission_keys text\[\]\)/);
  assert.match(sql, /auth\.uid\(\) IS NULL/);
  assert.match(sql, /v_input_count < 1 OR v_input_count > 8/);
  assert.match(sql, /v_distinct_count <> v_input_count/);
  assert.match(sql, /LEFT JOIN public\.permission_catalog pc/);
  assert.match(sql, /public\.has_app_permission\(supplied\.permission_key\)/);
  assert.match(sql, /SET search_path = ''/);
});

test('scope-check RPC is executable only by authenticated and does not mutate permission data', () => {
  const sql = read(canonicalPath);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.has_app_permissions\(text\[\]\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.has_app_permissions\(text\[\]\) TO authenticated/);
  assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE public\.|DELETE FROM|ALTER TABLE|DROP TABLE)\b/i);
});

test('preflight requires complete B1 catalog and four active role matrices without rewriting seeds', () => {
  const sql = read(canonicalPath);
  assert.match(sql, /v_catalog_count <> 29/);
  assert.match(sql, /v_role_rows <> 116/);
  assert.match(sql, /v_role_distinct <> 4/);
  assert.match(sql, /v_known_roles <> 4/);
  assert.doesNotMatch(sql, /INSERT INTO public\.role_permissions/);
  assert.doesNotMatch(sql, /UPDATE public\.role_permissions/);
});

test('verify script checks security settings and leaves base matrix untouched', () => {
  const verify = read('docs/sql/20261028050000_permission_scoped_check_verify.sql');
  assert.match(verify, /has_function_privilege\('authenticated'/);
  assert.match(verify, /has_function_privilege\('anon'/);
  assert.match(verify, /v_catalog_count <> 29/);
  assert.match(verify, /v_role_rows <> 116/);
});

test('rollback drops only the new function without CASCADE or removing data', () => {
  const rollback = read('docs/sql/rollback/20261028050000_rollback_permission_scoped_check.sql');
  assert.match(rollback, /DROP FUNCTION public\.has_app_permissions\(text\[\]\)/);
  assert.doesNotMatch(rollback, /CASCADE|DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('all declared scopes refer to known catalog keys', () => {
  const scopes = [
    'reports.export', 'stock.search', 'history.view', 'divergences.view',
    'dashboard.view', 'consultor.use', 'products.view',
  ];
  for (const key of scopes) assert.ok(catalogKeys.has(key), `catalog key missing: ${key}`);
});

test('smoke script tests expected allow/deny scopes for admin, Viewer, Support and Production, then rolls back', () => {
  const smoke = read('docs/sql/20261028050000_permission_scoped_check_smoke_test.psql');
  for (const email of [
    'admin-permissoes@local.test', 'rafael-permissoes@local.test',
    'producao-permissoes@local.test', 'visualizador-permissoes@local.test',
  ]) assert.ok(smoke.includes(email), `test account missing: ${email}`);
  assert.match(smoke, /SCOPED_CHECK_APOIO_EXPORT_EXPECTED_FALSE/);
  assert.match(smoke, /SCOPED_CHECK_PRODUCTION_HISTORY_EXPORT_EXPECTED_FALSE/);
  assert.match(smoke, /SCOPED_CHECK_VIEWER_DASHBOARD_DETAILS_EXPECTED_TRUE/);
  assert.match(smoke, /ROLLBACK/);
});

test('search export is fixed and uses stock.search with reports.export for every user', () => {
  const app = read('src/App.tsx');
  for (const handler of ['handleExportarEnderecamento', 'handleExportarEnderecamentoPDF']) {
    const start = app.indexOf(`const ${handler} =`);
    assert.notEqual(start, -1, `handler missing: ${handler}`);
    const next = app.indexOf('\n  const ', start + 10);
    const body = app.slice(start, next === -1 ? undefined : next);
    assert.match(body, /requestReportExportPermission\(\[\"stock\.search\"\]\)/);
    assert.doesNotMatch(body, /stock\.details\.view|includeStockDetails/);
  }
  const projection = read('src/lib/stockSearchExportProjection.ts');
  assert.match(projection, /Saldo_Pecas/);
  assert.match(projection, /Ultimo_Responsavel/);
  assert.match(projection, /Observacao/);
  assert.match(projection, /nunca inclui o identificador técnico/i);
  assert.doesNotMatch(projection, /includeStockDetails|ID:/);
});

// Prevent drift between UI handlers and per-module authorization scopes.
test('App export handlers and components use the proper module scope', () => {
  const app = read('src/App.tsx');
  const handlers = [
        ['handleExportarHistorico', ['history.view']],
    ['handleExportCSV', ['divergences.view']],
    ['handlePrintDivergenciais', ['divergences.view']],
    ['handleExportConsolidationPDF', ['products.view', 'stock.search']],
    ['handleExportConsultorExecutivePdf', ['consultor.use']],
  ];
  for (const [handler, requiredKeys] of handlers) {
    const start = app.indexOf(`const ${handler} =`);
    assert.notEqual(start, -1, `handler missing: ${handler}`);
    const next = app.indexOf('\n  const ', start + 10);
    const body = app.slice(start, next === -1 ? undefined : next);
    const call = body.match(/requestReportExportPermission\(\[([^\]]+)\]\)/);
    assert.ok(call, `${handler}: missing scoped guard`);
    for (const key of requiredKeys) assert.ok(call[1].includes(`"${key}"`), `${handler}: missing ${key}`);
  }
  assert.match(app, /requestReportExportPermission=\{\(\) => requestReportExportPermission\(\["dashboard\.view"\]\)\}/);
  assert.match(app, /requestReportExportPermission=\{\(\) => requestReportExportPermission\(\["divergences\.view"\]\)\}/);
});
