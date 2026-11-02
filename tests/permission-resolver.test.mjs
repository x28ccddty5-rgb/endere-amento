import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ACTIVE_APP_ROLES,
  ADMIN_ONLY_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  isKnownPermissionKey,
  normalizeKnownAppRole,
} from '../src/constants/permissionCatalog.ts';
import {
  buildEffectivePermissionMap,
  canExportScope,
  canUsePermission,
  evaluatePermission,
} from '../src/lib/permissionResolver.ts';

const keys = PERMISSION_CATALOG.map((permission) => permission.key);
const override = (key, value) => ({ [key]: value });
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const matrixCsv = readFileSync(path.join(currentDir, '../docs/seguranca/Matriz-Permissoes-v1.2.csv'), 'utf8').replace(/^\uFEFF/, '');
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const parseLine = (line) => {
    const fields = [];
    let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quoted && char === '"' && line[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { fields.push(value); value = ''; }
      else value += char;
    }
    fields.push(value);
    return fields;
  };
  const headers = parseLine(lines.shift());
  return lines.map((line) => Object.fromEntries(headers.map((header, i) => [header, parseLine(line)[i] ?? ''])));
}
const matrixRows = parseCsv(matrixCsv);
const matrixByKey = new Map(matrixRows.map((row) => [row.permission_key, row]));

test('catálogo tem chaves únicas e a permissão de abrir lançamentos separa-se da gravação', () => {
  assert.equal(keys.length, 29);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(isKnownPermissionKey('stock.launch.view'));
  assert.notEqual(
    canUsePermission('visualizador', 'stock.launch.view'),
    canUsePermission('visualizador', 'stock.launch.create'),
  );
});

test('catálogo TypeScript e matriz CSV têm exatamente as mesmas chaves e decisões-base para os cinco perfis', () => {
  assert.equal(matrixRows.length, PERMISSION_CATALOG.length);
  assert.deepEqual([...matrixByKey.keys()].sort(), [...keys].sort());
  const roleMap = { administrator: 'administrador', support: 'apoio', production: 'producao', viewer: 'visualizador', leadership: 'lideranca' };
  for (const permission of PERMISSION_CATALOG) {
    const row = matrixByKey.get(permission.key);
    for (const [column, role] of Object.entries(roleMap)) {
      assert.equal(row[column], permission.defaults[role] ? 'Permitido' : 'Negado', `${permission.key}/${role}`);
    }
    assert.equal(row.user_override.startsWith('Sim'), permission.userOverrideAllowed, `${permission.key}/delegabilidade`);
  }
});

test('Liderança integra os cinco perfis ativos e tem Pesquisa de Estoque como acesso-base', () => {
  assert.deepEqual(ACTIVE_APP_ROLES, ['administrador', 'apoio', 'producao', 'visualizador', 'lideranca']);
  assert.equal(normalizeKnownAppRole('Liderança'), 'lideranca');
  assert.equal(normalizeKnownAppRole(' role-inexistente '), null);
});

test('Administrador mantém acesso a todas as chaves conhecidas e não pode se bloquear por override', () => {
  for (const key of keys) {
    assert.equal(canUsePermission('administrador', key), true, key);
    assert.equal(canUsePermission('administrador', key, override(key, 'deny')), true, key);
  }
});

test('Apoio tem acesso-base operacional, mas não dashboard, exportação ou manutenção administrativa', () => {
  for (const key of [
    'stock.search', 'stock.details.view', 'stock.launch.view', 'stock.launch.create',
    'stock.transfer.create', 'stock.batch.process', 'history.view', 'divergences.view',
    'divergences.resolve', 'map.view', 'consultor.use',
  ]) assert.equal(canUsePermission('apoio', key), true, key);
  for (const key of [
    'dashboard.view', 'reports.export', 'stock.physical_correction', 'products.view',
    'products.create', 'products.edit', 'database.view', 'warehouse.layout.view',
  ]) assert.equal(canUsePermission('apoio', key), false, key);
});

test('Produção fica restrita a pesquisa, exportação do escopo permitido e Consultor IA', () => {
  assert.equal(canUsePermission('producao', 'stock.search'), true);
  assert.equal(canUsePermission('producao', 'reports.export'), true);
  assert.equal(canUsePermission('producao', 'consultor.use'), true);
  for (const key of [
    'dashboard.view', 'stock.details.view', 'stock.launch.view', 'stock.launch.create',
    'stock.transfer.create', 'stock.batch.process', 'stock.physical_correction',
    'history.view', 'divergences.view', 'divergences.resolve', 'products.view',
    'map.view', 'database.view', 'configuration.view',
  ]) assert.equal(canUsePermission('producao', key), false, key);
});

test('Visualizador vê módulos de consulta, inclusive a tela de lançamentos, mas não executa mutações', () => {
  for (const key of [
    'dashboard.view', 'stock.search', 'stock.details.view', 'stock.launch.view',
    'history.view', 'divergences.view', 'products.view', 'map.view',
    'warehouse.layout.view', 'consultor.use', 'reports.export', 'database.view',
    'configuration.view',
  ]) assert.equal(canUsePermission('visualizador', key), true, key);
  for (const key of [
    'stock.launch.create', 'stock.transfer.create', 'stock.batch.process',
    'stock.physical_correction', 'divergences.resolve', 'products.create',
    'products.edit', 'products.import_bulk', 'products.delete_deactivate',
    'map.metadata.edit', 'warehouse.layout.manage', 'database.manage',
    'users.view', 'users.manage', 'permissions.manage', 'configuration.manage',
  ]) assert.equal(canUsePermission('visualizador', key), false, key);
});

test('override allow libera permissão delegável individualmente', () => {
  assert.equal(canUsePermission('apoio', 'dashboard.view', override('dashboard.view', 'allow')), true);
  assert.equal(canUsePermission('apoio', 'stock.physical_correction', override('stock.physical_correction', 'allow')), true);
  assert.equal(canUsePermission('apoio', 'products.create', override('products.create', 'allow')), true);
});

test('override deny revoga permissão permitida pelo perfil', () => {
  assert.equal(canUsePermission('apoio', 'stock.launch.create', override('stock.launch.create', 'deny')), false);
  assert.equal(canUsePermission('visualizador', 'dashboard.view', override('dashboard.view', 'deny')), false);
});

test('dependências de leitura bloqueiam telas e RPCs mesmo quando a permissão de ação está concedida', () => {
  assert.equal(canUsePermission('apoio', 'dashboard.view', { 'stock.search': 'deny' }), false);
  assert.equal(canUsePermission('apoio', 'map.view', { 'stock.search': 'deny' }), false);
  assert.equal(canUsePermission('apoio', 'divergences.view', { 'stock.search': 'deny' }), false);
  assert.equal(canUsePermission('apoio', 'stock.launch.create', { 'stock.search': 'deny' }), false);
  assert.equal(canUsePermission('apoio', 'stock.launch.create', { 'divergences.view': 'deny' }), false);
  assert.equal(canUsePermission('apoio', 'stock.transfer.create', { 'divergences.view': 'deny' }), false);
  assert.equal(canUsePermission('apoio', 'divergences.resolve', { 'divergences.view': 'deny' }), false);
  assert.equal(canUsePermission('apoio', 'history.view', { 'stock.search': 'deny' }), true);
  assert.equal(canUsePermission('administrador', 'stock.launch.create', {
    'stock.search': 'deny', 'divergences.view': 'deny',
  }), true);
});

test('override inherit volta à decisão-base do perfil', () => {
  assert.equal(canUsePermission('apoio', 'stock.launch.create', override('stock.launch.create', 'inherit')), true);
  assert.equal(canUsePermission('apoio', 'dashboard.view', override('dashboard.view', 'inherit')), false);
});

test('permissões administrativas e mutações críticas não aceitam override individual', () => {
  assert.ok(ADMIN_ONLY_PERMISSION_KEYS.length > 0);
  for (const key of ADMIN_ONLY_PERMISSION_KEYS) {
    assert.equal(canUsePermission('apoio', key, override(key, 'allow')), false, key);
    assert.equal(canUsePermission('visualizador', key, override(key, 'allow')), false, key);
  }
});

test('Liderança começa com Pesquisa liberada e as demais permissões negadas, mantendo overrides delegáveis', () => {
  assert.equal(canUsePermission('lideranca', 'stock.search'), true);
  for (const key of keys.filter((key) => key !== 'stock.search')) assert.equal(canUsePermission('lideranca', key), false, key);
  assert.equal(canUsePermission('lideranca', 'stock.search', override('stock.search', 'allow')), true);
  assert.equal(canUsePermission('lideranca', 'stock.search', override('stock.search', 'deny')), false);
  for (const key of ADMIN_ONLY_PERMISSION_KEYS) {
    assert.equal(canUsePermission('lideranca', key, override(key, 'allow')), false, key);
  }
});

test('perfil ou permissão desconhecidos falham fechados', () => {
  assert.equal(canUsePermission('misterioso', 'stock.search'), false);
  assert.equal(canUsePermission('apoio', 'permission.root'), false);
  assert.deepEqual(evaluatePermission('??', 'stock.search'), { allowed: false, reason: 'unknown_role' });
  assert.deepEqual(evaluatePermission('apoio', 'permission.root'), { allowed: false, reason: 'unknown_permission' });
});

test('override inválido falha fechado, sem recorrer à permissão-base', () => {
  assert.equal(canUsePermission('apoio', 'stock.launch.create', override('stock.launch.create', 'maybe')), false);
  assert.equal(evaluatePermission('apoio', 'stock.launch.create', 'maybe').reason, 'invalid_override');
});

test('exportação exige grant de exportação e autorização do escopo de dados', () => {
  assert.equal(canExportScope('producao', 'stock.search'), true);
  assert.equal(canExportScope('producao', 'history.view'), false);
  assert.equal(canExportScope('apoio', 'history.view'), false);
  assert.equal(canExportScope('visualizador', 'history.view'), true);
  assert.equal(canExportScope('visualizador', 'users.view'), false);
  assert.equal(canExportScope('visualizador', 'stock.launch.create'), false);
  assert.equal(canExportScope('visualizador', 'consultor.use'), false);
  assert.equal(canExportScope('visualizador', 'unknown.scope'), false);
});

test('mapa de permissões efetivas sempre contém todas as chaves conhecidas', () => {
  const result = buildEffectivePermissionMap('apoio', { 'stock.physical_correction': 'allow' });
  assert.deepEqual(Object.keys(result).sort(), [...keys].sort());
  assert.equal(result['stock.physical_correction'], true);
  assert.equal(result['warehouse.layout.manage'], false);
});
