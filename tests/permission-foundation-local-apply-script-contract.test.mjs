import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../scripts/Apply-PermissionFoundation-ToLocalIntegration.ps1', import.meta.url), 'utf8');

test('targets only the known local integration container and expected Docker labels', () => {
  assert.match(script, /\$TargetContainer\s*=\s*'supabase_db_enderecamento-integracao-local'/);
  assert.match(script, /\$ExpectedComposeProject\s*=\s*'enderecamento-integracao-local'/);
  assert.match(script, /com\.supabase\.cli\.workdir/);
  assert.match(script, /Stop-Safely "O script não vai iniciá-lo|O script não vai iniciá-lo/);
});

test('validates required prerequisites and blocks partial/repeated installs', () => {
  for (const key of ['PROFILES_TABLE', 'AUTH_UID', 'ANON_ROLE', 'AUTHENTICATED_ROLE', 'PROFILE_COLUMNS', 'ADMIN_COUNT', 'LEGACY_LEADER_COUNT', 'UNKNOWN_ROLE_COUNT']) {
    assert.ok(script.includes(key), `missing guard ${key}`);
  }
  assert.match(script, /PERMISSION_TABLES_EXIST/);
  assert.match(script, /PERMISSION_FUNCTIONS_EXIST/);
  assert.match(script, /não é idempotente/);
});

test('requires literal confirmation before applying migrations in order B1 then B2', () => {
  assert.match(script, /APLICAR B1 B2 LOCAL/);
  const confirmation = script.indexOf("if ($confirmation -cne 'APLICAR B1 B2 LOCAL')");
  const b1 = script.indexOf("'docs/sql/migrations/20261028010000_permission_foundation.sql') 'Aplicar migration B1'");
  const verifyB1 = script.indexOf("'docs/sql/20261028010000_permission_foundation_verify.sql') 'Verificar B1'");
  const b2 = script.indexOf("'docs/sql/migrations/20261028020000_permission_admin_write_rpcs.sql') 'Aplicar migration B2'");
  const verifyB2 = script.indexOf("'docs/sql/20261028020000_permission_write_rpcs_verify.sql') 'Verificar B2'");
  assert.ok(confirmation > 0 && confirmation < b1);
  assert.ok(b1 < verifyB1 && verifyB1 < b2 && b2 < verifyB2);
});

test('does not touch stock table policies, grants, production endpoints, or container lifecycle', () => {
  assert.doesNotMatch(script, /supabase\.co|https:\/\//i);
  assert.doesNotMatch(script, /docker\s+(start|restart|stop|rm)\b/i);
  assert.doesNotMatch(script, /REVOKE\s+(INSERT|UPDATE|DELETE)|DROP\s+POLICY|CREATE\s+POLICY/i);
});


test('resolves ProjectRoot after parameter binding instead of evaluating PSScriptRoot in a default expression', () => {
  assert.match(script, /param\(\s*\[string\]\$ProjectRoot\s*\)/);
  assert.doesNotMatch(script, /\$ProjectRoot\s*=\s*\(Split-Path\s+-Parent\s+\$PSScriptRoot\)/);
  assert.match(script, /if \(\[string\]::IsNullOrWhiteSpace\(\$ProjectRoot\)\)/);
  assert.match(script, /\$ProjectRoot = Split-Path -Parent \$scriptDirectory/);
  assert.match(script, /\[System\.IO\.Path\]::GetFullPath\(\$ProjectRoot\)/);
});
