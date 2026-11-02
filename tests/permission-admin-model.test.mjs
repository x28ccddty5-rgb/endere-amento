import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_APP_ROLES,
  PERMISSION_CATALOG,
} from '../src/constants/permissionCatalog.ts';
import {
  applyRoleChanges,
  applyUserOverrideChanges,
  buildRolePermissionChanges,
  buildUserPermissionChanges,
  createPreviewPermissionMatrix,
  parsePermissionAdminMatrix,
  resolvePermissionAdminMode,
} from '../src/lib/permissionAdminModel.ts';

function serverShapeFromPreview(matrix = createPreviewPermissionMatrix()) {
  return {
    catalog: PERMISSION_CATALOG.map((permission, index) => ({
      permission_key: permission.key,
      module_name: permission.group,
      label: permission.label,
      description: permission.description,
      risk_level: permission.userOverrideAllowed ? 'medium' : 'critical',
      is_admin_only: !permission.userOverrideAllowed,
      user_override_allowed: permission.userOverrideAllowed,
      sort_order: index + 1,
    })),
    role_permissions: ACTIVE_APP_ROLES.flatMap((role) => PERMISSION_CATALOG.map((permission) => ({
      role,
      permission_key: permission.key,
      allowed: matrix.rolePermissions[role][permission.key],
      updated_at: null,
      updated_by: null,
    }))),
    user_overrides: [],
    matrix_status: {
      active_permissions: PERMISSION_CATALOG.length,
      expected_role_permission_rows: PERMISSION_CATALOG.length * ACTIVE_APP_ROLES.length,
      actual_role_permission_rows: PERMISSION_CATALOG.length * ACTIVE_APP_ROLES.length,
      complete: true,
    },
  };
}

test('preview matrix includes exactly five roles and every catalog key', () => {
  const matrix = createPreviewPermissionMatrix();
  assert.deepEqual(Object.keys(matrix.rolePermissions).sort(), [...ACTIVE_APP_ROLES].sort());
  for (const role of ACTIVE_APP_ROLES) {
    assert.equal(Object.keys(matrix.rolePermissions[role]).length, PERMISSION_CATALOG.length);
  }
  assert.equal(matrix.matrixStatus.complete, true);
});

test('parser accepts a complete server matrix with matching catalog metadata', () => {
  const parsed = parsePermissionAdminMatrix(serverShapeFromPreview());
  assert.equal(parsed.matrixStatus.actualRolePermissionRows, 145);
  assert.equal(parsed.rolePermissions.visualizador['stock.launch.view'], true);
  assert.equal(parsed.rolePermissions.visualizador['stock.launch.create'], false);
  assert.equal(parsed.rolePermissions.lideranca['stock.search'], true);
});

test('parser fails closed when matrix status says incomplete', () => {
  const raw = serverShapeFromPreview();
  raw.matrix_status.complete = false;
  assert.throws(() => parsePermissionAdminMatrix(raw), /PERMISSION_MATRIX_INCOMPLETE/);
});

test('parser fails closed when the server catalog has a drifted label', () => {
  const raw = serverShapeFromPreview();
  raw.catalog[0].label = 'Texto divergente';
  assert.throws(() => parsePermissionAdminMatrix(raw), /CATALOG_METADATA_MISMATCH/);
});

test('parser fails closed on a duplicated role-permission row', () => {
  const raw = serverShapeFromPreview();
  raw.role_permissions[1] = { ...raw.role_permissions[0] };
  assert.throws(() => parsePermissionAdminMatrix(raw), /ROLE_PERMISSION_DUPLICATE/);
});

test('parser fails closed on unknown role and on a corrupt override', () => {
  const badRole = serverShapeFromPreview();
  badRole.role_permissions[0].role = 'role_inexistente';
  assert.throws(() => parsePermissionAdminMatrix(badRole), /ROLE_UNKNOWN/);

  const badOverride = serverShapeFromPreview();
  badOverride.user_overrides.push({
    user_id: 'user-1', username: 'old-user', name: 'Old User', role: 'role_inexistente',
    permission_key: 'stock.search', decision: 'allow', updated_at: null, updated_by: null,
  });
  assert.throws(() => parsePermissionAdminMatrix(badOverride), /USER_OVERRIDE_ROLE_NOT_ALLOWED/);
});

test('Liderança tem Pesquisa liberada como base e permite configurar as demais permissões', () => {
  const matrix = createPreviewPermissionMatrix();
  assert.equal(matrix.rolePermissions.lideranca['stock.search'], true);
  for (const permission of PERMISSION_CATALOG.filter((item) => item.key !== 'stock.search')) {
    assert.equal(matrix.rolePermissions.lideranca[permission.key], false, permission.key);
  }
  const current = matrix.rolePermissions.lideranca;
  const draft = { ...current, 'dashboard.view': true };
  assert.deepEqual(buildRolePermissionChanges('lideranca', current, draft), [
    { permission_key: 'dashboard.view', allowed: true },
  ]);

  const raw = serverShapeFromPreview();
  raw.user_overrides.push({
    user_id: 'leader-user', username: 'leader', name: 'Leader', role: 'lideranca',
    permission_key: 'stock.search', decision: 'allow', updated_at: null, updated_by: null,
  });
  const parsed = parsePermissionAdminMatrix(raw);
  assert.equal(parsed.userOverrides['leader-user']['stock.search'], 'allow');
});

test('parser fails closed if a non-delegable permission is enabled for a non-admin role', () => {
  const raw = serverShapeFromPreview();
  const row = raw.role_permissions.find((item) => item.role === 'apoio' && item.permission_key === 'products.import_bulk');
  row.allowed = true;
  assert.throws(() => parsePermissionAdminMatrix(raw), /ADMIN_ONLY_GRANT_IN_MATRIX/);
});

test('role payload contains only changed keys and never grants admin-only actions', () => {
  const matrix = createPreviewPermissionMatrix();
  const current = matrix.rolePermissions.apoio;
  const draft = { ...current, 'dashboard.view': true };
  assert.deepEqual(buildRolePermissionChanges('apoio', current, draft), [
    { permission_key: 'dashboard.view', allowed: true },
  ]);

  const invalid = { ...current, 'products.import_bulk': true };
  assert.throws(() => buildRolePermissionChanges('apoio', current, invalid), /ADMIN_ONLY_PERMISSION_CANNOT_BE_GRANTED/);
});

test('role payload rejects administrator as a configurable target', () => {
  const matrix = createPreviewPermissionMatrix();
  assert.throws(
    () => buildRolePermissionChanges('administrador', matrix.rolePermissions.administrador, matrix.rolePermissions.administrador),
    /PERMISSION_TARGET_ROLE_NOT_CONFIGURABLE/,
  );
});

test('user payload sends only changed overrides and supports restoring inheritance', () => {
  const current = { 'dashboard.view': 'deny', 'stock.search': 'allow' };
  const draft = { 'dashboard.view': 'inherit', 'stock.search': 'allow', 'consultor.use': 'deny' };
  assert.deepEqual(buildUserPermissionChanges(current, draft), [
    { permission_key: 'dashboard.view', decision: 'inherit' },
    { permission_key: 'consultor.use', decision: 'deny' },
  ]);
});

test('user payload rejects attempts to override non-delegable permissions', () => {
  assert.throws(
    () => buildUserPermissionChanges({}, { 'products.import_bulk': 'allow' }),
    /USER_OVERRIDE_NOT_DELEGABLE/,
  );
});

test('applying user override changes adds and then removes the exception', () => {
  const matrix = createPreviewPermissionMatrix();
  const withOverride = applyUserOverrideChanges(matrix, 'user-1', [
    { permission_key: 'dashboard.view', decision: 'allow' },
  ]);
  assert.equal(withOverride.userOverrides['user-1']['dashboard.view'], 'allow');
  const inherited = applyUserOverrideChanges(withOverride, 'user-1', [
    { permission_key: 'dashboard.view', decision: 'inherit' },
  ]);
  assert.equal(inherited.userOverrides['user-1'], undefined);
});

test('applying profile changes does not mutate the prior matrix', () => {
  const original = createPreviewPermissionMatrix();
  const changedDraft = { ...original.rolePermissions.apoio, 'dashboard.view': true };
  const updated = applyRoleChanges(original, 'apoio', changedDraft);
  assert.equal(original.rolePermissions.apoio['dashboard.view'], false);
  assert.equal(updated.rolePermissions.apoio['dashboard.view'], true);
});

test('local dev defaults to preview and cannot enable live calls against remote production URL', () => {
  assert.equal(resolvePermissionAdminMode(undefined, true, 'https://project.supabase.co'), 'preview');
  assert.equal(resolvePermissionAdminMode('live', true, 'https://project.supabase.co'), 'preview');
  assert.equal(resolvePermissionAdminMode('live', true, 'http://127.0.0.1:54321'), 'live');
  assert.equal(resolvePermissionAdminMode(undefined, false, 'https://project.supabase.co'), 'off');
  assert.equal(resolvePermissionAdminMode('live', false, 'https://project.supabase.co'), 'live');
  assert.equal(resolvePermissionAdminMode('off', true, 'http://127.0.0.1:54321'), 'off');
});
