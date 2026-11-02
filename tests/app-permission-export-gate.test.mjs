import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSION_CATALOG } from '../src/constants/permissionCatalog.ts';
import {
  arePermissionsGranted,
  parseAppPermissionContext,
  resolvePermissionEnforcementEnabled,
} from '../src/lib/permissionAppContextModel.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const keys = PERMISSION_CATALOG.map((item) => item.key);
const context = ({ userId = 'user-1', role = 'apoio', overrides = {} } = {}) => ({
  user: { id: userId, username: 'teste', name: 'Usuário Teste', role },
  permissions: Object.fromEntries(
    PERMISSION_CATALOG.map((item) => [item.key, overrides[item.key] ?? item.defaults[role] ?? false]),
  ),
  matrix_complete: true,
  active_permission_count: PERMISSION_CATALOG.length,
});

test('enforcement stays off by default; dev may activate only against local Supabase', () => {
  assert.equal(resolvePermissionEnforcementEnabled(undefined, true, 'http://127.0.0.1:55321'), false);
  assert.equal(resolvePermissionEnforcementEnabled('live', true, 'http://127.0.0.1:55321'), true);
  assert.equal(resolvePermissionEnforcementEnabled('live', true, 'https://example.supabase.co'), false);
  assert.equal(resolvePermissionEnforcementEnabled('preview', true, 'http://127.0.0.1:55321'), false);
  assert.equal(resolvePermissionEnforcementEnabled('live', false, 'https://example.supabase.co'), true);
});

test('scoped report gate requires reports.export plus every module permission and fails closed', () => {
  assert.equal(arePermissionsGranted({ 'reports.export': true, 'stock.search': true }, ['reports.export', 'stock.search']), true);
  assert.equal(arePermissionsGranted({ 'reports.export': true, 'history.view': false }, ['reports.export', 'history.view']), false);
  assert.equal(arePermissionsGranted({ 'reports.export': true }, ['reports.export', 'stock.search']), false);
  assert.equal(arePermissionsGranted(null, ['reports.export']), false);
  assert.equal(arePermissionsGranted({ 'reports.export': true }, []), false);
});

test('context parser validates identity, complete matrix and every catalog key', () => {
  const parsed = parseAppPermissionContext(context(), 'user-1');
  assert.equal(parsed.permissions['reports.export'], false);
  assert.equal(Object.keys(parsed.permissions).length, keys.length);
  assert.equal(parsed.matrixComplete, true);
  assert.throws(() => parseAppPermissionContext(context(), 'other-user'), /USER_MISMATCH/);
  assert.throws(() => parseAppPermissionContext({ ...context(), matrix_complete: false }, 'user-1'), /MATRIX_INCOMPLETE/);
});

test('missing or non-boolean permissions fail closed', () => {
  const missing = context();
  delete missing.permissions['reports.export'];
  assert.throws(() => parseAppPermissionContext(missing, 'user-1'), /KEY_MISSING:reports\.export/);

  const invalid = context();
  invalid.permissions['reports.export'] = 'true';
  assert.throws(() => parseAppPermissionContext(invalid, 'user-1'), /KEY_MISSING:reports\.export/);
});

test('Liderança aceita a matriz configurável, mas nunca recebe permissões exclusivas de Administrador', () => {
  const denied = context({ role: 'lideranca' });
  const parsedDenied = parseAppPermissionContext(denied, 'user-1');
  assert.equal(parsedDenied.role, 'lideranca');
  assert.equal(parsedDenied.permissions['reports.export'], false);

  const configured = context({ role: 'lideranca', overrides: { 'stock.search': true } });
  assert.equal(parseAppPermissionContext(configured, 'user-1').permissions['stock.search'], true);

  const invalidAdminGrant = context({ role: 'lideranca', overrides: { 'permissions.manage': true } });
  assert.throws(() => parseAppPermissionContext(invalidAdminGrant, 'user-1'), /ADMIN_ONLY_GRANT/);
});

test('every App report export requires the global grant and its module scope before generating output', () => {
  const app = read('src/App.tsx');
  const requiredHandlers = [
        ['handleExportarHistorico', ['history.view']],
    ['handleExportCSV', ['divergences.view']],
    ['handlePrintDivergenciais', ['divergences.view']],
    ['handleExportConsolidationPDF', ['products.view', 'stock.search']],
    ['handleExportConsultorExecutivePdf', ['consultor.use']],
  ];
  for (const [handler, requiredKeys] of requiredHandlers) {
    const start = app.indexOf(`const ${handler} =`);
    assert.notEqual(start, -1, `handler missing: ${handler}`);
    const next = app.indexOf('\n  const ', start + 10);
    const body = app.slice(start, next === -1 ? undefined : next);
    const call = body.match(/requestReportExportPermission\(\[([^\]]+)\]\)/);
    assert.ok(call, `${handler}: scoped permission guard missing`);
    for (const key of requiredKeys) assert.ok(call[1].includes(`\"${key}\"`), `${handler}: missing scope ${key}`);
  }
});

test('stock search exports use one fixed 12-field projection and require only the search/export grants', () => {
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
  assert.match(projection, /Ultimo_Responsavel/);
  assert.match(projection, /Observacao/);
  assert.match(projection, /identificador técnico do banco/);
  assert.doesNotMatch(projection, /includeStockDetails|ID:/);
});

test('export actions in dashboard, SKU analysis and divergence panel are gated and hidden without permission', () => {
  const dashboard = read('src/components/DashboardCards.tsx');
  const skuDrawer = read('src/components/SkuAnalysisDrawer.tsx');
  const divergence = read('src/components/DivergenciasPanel.tsx');

  for (const [name, source] of [
    ['DashboardCards', dashboard],
    ['SkuAnalysisDrawer', skuDrawer],
    ['DivergenciasPanel', divergence],
  ]) {
    assert.match(source, /canExportReports &&/, `${name}: export button should be hidden when denied`);
    assert.match(source, /requestReportExportPermission\(\)/, `${name}: export action must check permission`);
  }
});


test('App binds export components to their actual data scopes and a single batched RPC', () => {
  const app = read('src/App.tsx');
  const service = read('src/lib/appPermissionService.ts');
  assert.match(app, /canExportReports=\{canExportDashboardDetails\}/);
  for (const handler of ['handleExportarEnderecamento', 'handleExportarEnderecamentoPDF']) {
    const start = app.indexOf(`const ${handler} =`);
    const next = app.indexOf('\n  const ', start + 10);
    const body = app.slice(start, next === -1 ? undefined : next);
    assert.match(body, /requestReportExportPermission\(\[\"stock\.search\"\]\)/);
    assert.doesNotMatch(body, /stock\.details\.view|includeStockDetails/);
  }
  assert.match(app, /requestReportExportPermission=\{\(\) => requestReportExportPermission\(\[\"dashboard\.view\"\]\)\}/);
  assert.match(app, /canExportReports=\{canExportDivergences\}/);
  assert.match(app, /requestReportExportPermission=\{\(\) => requestReportExportPermission\(\[\"divergences\.view\"\]\)\}/);
  assert.match(service, /supabase\.rpc\(\s*\"has_app_permissions\"/);
  assert.match(service, /permissionKeys\.length > 8/);
  assert.match(app, /arePermissionsGranted\(appPermissionContext\.permissions, requiredKeys\)/);
});

test('the unguarded layout XLSX is a static synthetic import template, not a live-data export', () => {
  const app = read('src/App.tsx');
  const start = app.indexOf('const handleExportarLayout =');
  assert.notEqual(start, -1);
  const next = app.indexOf('\n  const handleExportarEnderecamento', start);
  const body = app.slice(start, next);
  assert.match(app, /Static import-layout template with synthetic example values only/);
  assert.match(body, /SKU: \"23101G\"/);
  assert.doesNotMatch(body, /filteredSlots\.map|history\.map|divergencias\.map|productsList\.map/);
});
