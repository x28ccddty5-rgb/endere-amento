import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8');
const app = read('src/App.tsx');
const catalog = read('src/constants/permissionCatalog.ts');
const panel = read('src/components/PermissionManagementPanel.tsx');
const mobile = read('src/components/mobile/MobileShell.tsx');
const projection = read('src/lib/stockSearchExportProjection.ts');
const migration = read('docs/sql/migrations/20261031150000_permission_read_scope_alignment.sql');
const verify = read('docs/sql/20261031150000_permission_read_scope_alignment_verify.sql');
const rollback = read('docs/sql/rollback/20261031150000_permission_read_scope_alignment_rollback.sql');
const applyRunner = read('scripts/Apply-Audit03ReadScopeAlignment-ToLocalIntegration.ps1');
const matrix = read('docs/seguranca/Matriz-Permissoes-v1.2.md');
const testRunner = read('scripts/Test-Audit03ReadScopeAlignment-LocalIntegration.ps1');

test('all five roles have stock.search by default and the former detail key is hidden, not deleted', () => {
  assert.match(catalog, /key: \"stock\.search\"[\s\S]*?lideranca: true/);
  assert.match(catalog, /key: \"stock\.details\.view\",[\s\S]*?isDeprecated: true/);
  assert.match(panel, /PERMISSION_CATALOG\.filter\(\(permission\) => !\(\"isDeprecated\" in permission && permission\.isDeprecated\)\)/);
  assert.equal((catalog.match(/key: \"/g) ?? []).length, 29);
});

test('the App reads all 14 slots fields but only stock.search grants SELECT through the final RLS migration', () => {
  assert.match(app, /select\(\"id,estoque,modulo,posicao,referencia,descricao,saldo,dataChacote,ultimaData,ultimaHora,ultimoResponsavel,galpao,restricao,observacao\"\)/);
  const slotsPolicy = migration.match(/CREATE POLICY slots_select_permission_catalog[\s\S]*?;/)?.[0] ?? '';
  assert.match(slotsPolicy, /has_app_permission\('stock\.search'\)/);
  assert.doesNotMatch(slotsPolicy, /stock\.details\.view|dashboard\.view|divergences\.resolve|map\.view/);
  assert.match(migration, /has_column_privilege\('authenticated'/);
  assert.match(migration, /v_column_count <> 14/);
  assert.doesNotMatch(migration, /REVOKE[^;]*ON TABLE public\.slots|REVOKE SELECT ON TABLE public\.slots/i);
});

test('filters remain local frontend calculations and are no longer permission-scoped', () => {
  assert.match(app, /const filteredSlots = useMemo\(/);
  assert.match(mobile, /const searchResults = useMemo\(/);
  assert.match(app, /const showStockDetailsInSearch = true/);
  assert.match(app, /const showSlotMetadataInSearch = true/);
  assert.doesNotMatch(app, /canUseAppPermissionForUi\(\"stock\.details\.view\"\)/);
  assert.doesNotMatch(app, /canUseAppPermissionForUi\(\"map\.metadata\.edit\"\).*show/);
});

test('Excel and PDF use one fixed operational projection and never export the technical ID', () => {
  assert.match(projection, /Saldo_Pecas/);
  assert.match(projection, /Ultimo_Responsavel/);
  assert.match(projection, /Galpao/);
  assert.match(projection, /Restricao/);
  assert.match(projection, /Observacao/);
  assert.doesNotMatch(projection, /slot\.id|\bID:/);
  assert.match(app, /requestReportExportPermission\(\[\"stock\.search\"\]\)/);
});

test('slots Realtime is one shared channel across dependent tabs and mutations fail closed while stale', () => {
  assert.equal((app.match(/\.channel\(\"slots-search-live\"\)/g) ?? []).length, 1);
  assert.match(app, /SLOT_DATA_ACTIVE_TABS/);
  assert.match(app, /shouldSyncSlotsForActiveTab/);
  assert.match(app, /slotsRealtimeStatusRef\.current !== \"ready\"/);
  assert.match(app, /snapshot\.source === \"remote_complete\" && channelConnected/);
  assert.match(app, /const INITIAL_LOAD_COOLDOWN_MS = 30_000/);
});

test('permission dependencies are enforced centrally in backend and returned app context', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.has_app_permission\(p_permission_key text\)/);
  assert.match(migration, /'stock\.launch\.create', 'stock\.transfer\.create'[\s\S]*?'divergences\.view'/);
  assert.match(migration, /v_dependency_keys := ARRAY\['stock\.search', 'divergences\.view'\]/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_my_app_context\(\)/);
  assert.match(migration, /v_permissions ->> 'stock\.search'/);
  assert.match(migration, /v_permissions ->> 'divergences\.view'/);
  assert.match(verify, /A03_READ_SCOPE_VERIFY_PERMISSION_DEPENDENCIES_INVALID/);
  assert.match(rollback, /Restaura o helper central anterior/);
  assert.match(rollback, /Restore the prior app context payload/);
});


test('permission context reloads on JWT refresh so Realtime cached RLS is reevaluated', () => {
  assert.match(app, /supabase\.auth\.onAuthStateChange/);
  assert.match(app, /event === "TOKEN_REFRESHED" \\|\\| event === "SIGNED_IN"/);
  assert.match(app, /permissionContextRevision/);
  assert.match(app, /permissionContextRevision\]\)/);
  assert.match(matrix, /autorização RLS do Postgres Changes durante a conexão WebSocket/);
  assert.match(matrix, /não encerra instantaneamente um canal já conectado/);
});

test('divergences Realtime and direct reads require view, separate from resolve', () => {
  assert.equal((app.match(/\.channel\(\"divergencias-live\"\)/g) ?? []).length, 1);
  assert.match(app, /canUseAppPermissionForUi\(\"divergences\.view\"\)/);
  const policy = migration.match(/CREATE POLICY divergencias_select_permission_catalog[\s\S]*?;/)?.[0] ?? '';
  assert.match(policy, /has_app_permission\('divergences\.view'\)/);
  assert.doesNotMatch(policy, /divergences\.resolve/);
});

test('migration, verification, rollback and PowerShell runners are local-only and guarded', () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(migration, /permission_change_audit/);
  assert.match(verify, /BEGIN TRANSACTION READ ONLY/);
  assert.match(verify, /ROLLBACK;/);
  assert.match(rollback, /CREATE POLICY slots_select_permission_catalog/);
  assert.match(rollback, /has_app_permission\('stock\.details\.view'\)/);
  assert.match(applyRunner, /ConfirmApplyLocal/);
  assert.match(applyRunner, /supabase_db_enderecamento-integracao-local/);
  assert.doesNotMatch(applyRunner, /supabase db push|supabase link|vercel --prod|https:\/\//i);
  assert.match(testRunner, /BEGIN TRANSACTION READ ONLY/);
});
