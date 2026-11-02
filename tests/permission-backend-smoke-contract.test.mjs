import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const script = fs.readFileSync(new URL('../scripts/Test-PermissionBackend.mjs', import.meta.url), 'utf8');

test('backend smoke refuses to run against any nonlocal URL or non-55321 port', () => {
  assert.match(script, /\['127\.0\.0\.1', 'localhost', '::1'\]/);
  assert.match(script, /parsed\.port !== '55321'/);
});

test('backend smoke reads only the local permission test env file', () => {
  assert.match(script, /\.env\.permission-test\.local/);
  assert.doesNotMatch(script, /\.env\.production|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/);
});

test('non-admin write probes have empty changes arrays and cannot commit a grant', () => {
  assert.match(script, /p_target_role: 'apoio', p_changes: \[\]/);
  assert.match(script, /p_target_user_id: rafael\.id, p_changes: \[\]/);
});

test('effective permission is compared with the persisted matrix and override', () => {
  assert.match(script, /reports\.export/);
  assert.match(script, /matrix\.role_permissions/);
  assert.match(script, /matrix\.user_overrides/);
  assert.match(script, /context\.permissions\['reports\.export'\] === expectedExport/);
});

test('checks helper consistency, unknown-key denial, and administrative RPC denial', () => {
  assert.match(script, /has_app_permission/);
  assert.match(script, /__permission_key_unknown__/);
  assert.match(script, /PERMISSION_ADMIN_REQUIRED/);
  assert.match(script, /get_permission_admin_matrix/);
});

test('does not print tokens or the local API key', () => {
  assert.doesNotMatch(script, /console\.(?:log|info|error)\([^\n]*(?:result\.data\.access_token|rafaelSession\.token|admin\.token|apiKey)\b/i);
  assert.match(script, /return \{ token: result\.data\.access_token/);
});
