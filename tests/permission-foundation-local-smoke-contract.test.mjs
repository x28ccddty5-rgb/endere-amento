import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const scriptPath = path.resolve('scripts/Test-PermissionFoundation-LocalIntegration.ps1');
const script = fs.readFileSync(scriptPath, 'utf8');

test('targets only the known local integration container and Docker labels', () => {
  assert.match(script, /supabase_db_enderecamento-integracao-local/);
  assert.match(script, /enderecamento-integracao-local/);
  assert.match(script, /c:\\testes\\enderecamento_integracao_local/i);
  assert.match(script, /docker inspect/);
  assert.match(script, /State\.Running/);
  assert.doesNotMatch(script, /supabase\.co|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('checks B1 seed counts and existence of all B1/B2 RPCs before testing', () => {
  assert.match(script, /CATALOG_COUNT/);
  assert.match(script, /ROLE_ROWS/);
  assert.match(script, /DISTINCT_ROLE_ROWS/);
  assert.match(script, /'29'/);
  assert.match(script, /'116'/);
  assert.match(script, /save_role_permission_changes\(text,jsonb\)/);
  assert.match(script, /save_user_permission_overrides\(uuid,jsonb\)/);
});

test('runs permission checks under authenticated role with local identity claims', () => {
  assert.match(script, /SET LOCAL ROLE authenticated/);
  assert.match(script, /SET LOCAL request\.jwt\.claim\.sub/);
  assert.match(script, /get_my_app_context\(\)/);
  assert.match(script, /get_permission_admin_matrix\(\)/);
  assert.match(script, /has_app_permission\('stock\.search'\)/);
});

test('expects administrative RPCs to deny production profile before a valid write can happen', () => {
  assert.match(script, /PERMISSION_ADMIN_REQUIRED/);
  assert.match(script, /save_role_permission_changes\('apoio', '\[\]'::jsonb\)/);
  assert.match(script, /save_user_permission_overrides\('\$adminId'::uuid, '\[\]'::jsonb\)/);
  assert.match(script, /ROLLBACK/);
});

test('is read-only apart from empty denied calls; does not modify policies or container lifecycle', () => {
  assert.doesNotMatch(script, /ALTER\s+TABLE|CREATE\s+FUNCTION|DROP\s+|GRANT\s+|REVOKE\s+/i);
  assert.doesNotMatch(script, /docker (start|stop|restart|rm|compose)/i);
  assert.match(script, /não testa login GoTrue/i);
});
