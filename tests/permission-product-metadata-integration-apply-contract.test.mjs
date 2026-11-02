import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const script = readFileSync(resolve('scripts/Apply-PermissionProductAndMetadata-ToLocalIntegration.ps1'), 'utf8');
const b61 = readFileSync(resolve('docs/sql/migrations/20261028060000_permission_product_mutations.sql'), 'utf8');
const b62 = readFileSync(resolve('docs/sql/migrations/20261028070000_permission_slot_metadata_atomic.sql'), 'utf8');

test('targets only the known local integration container and expected Docker labels', () => {
  assert.match(script, /supabase_db_enderecamento-integracao-local/);
  assert.match(script, /enderecamento-integracao-local/);
  assert.match(script, /c:\\\\testes\\\\enderecamento_integracao_local|c:\\testes\\enderecamento_integracao_local/i);
  assert.match(script, /docker inspect/);
  assert.match(script, /\$confirmation -cne 'APLICAR B6\.1 B6\.2A LOCAL'/);
});

test('requires complete B1/B2, expected role matrix, and clean pre-migration policy state', () => {
  assert.match(script, /CATALOG_COUNT.*29|CATALOG_COUNT/);
  assert.match(script, /ROLE_ROWS.*116|ROLE_ROWS/);
  assert.match(script, /PRODUCT_LEGACY_POLICIES/);
  assert.match(script, /PRODUCT_PERMISSION_POLICIES/);
  assert.match(script, /PRODUCT_UNEXPECTED_WRITE_POLICIES/);
  assert.match(script, /SLOT_REQUIRED_COLUMNS/);
  assert.match(script, /METADATA_RPC_EXISTS/);
  assert.match(script, /METADATA_RPC_STATE\|true\|true\|true/);
});

test('handles native psql stderr safely and trusts process exit code rather than NOTICE text', () => {
  assert.match(script, /\$previousErrorActionPreference = \$ErrorActionPreference/);
  assert.match(script, /\$ErrorActionPreference = 'Continue'/);
  assert.match(script, /\$exitCode = \$LASTEXITCODE/);
  assert.match(script, /PostgreSQL NOTICE\/WARNING/);
});

test('resumes only from a fully applied B6.1 state and never reapplies it', () => {
  assert.match(script, /\$B61AlreadyApplied = \$true/);
  assert.match(script, /\$legacyProductPolicies -eq 0 -and \$permissionProductPolicies -eq 3/);
  assert.match(script, /Estado parcial ou inesperado de B6\.1/);
  assert.match(script, /if \(-not \$B61AlreadyApplied\)/);
  assert.match(script, /B6\.1 já está aplicada integralmente; pulando reexecução da migration/);
});

test('applies B6.1 before B6.2A and verifies each stage', () => {
  const p1 = script.indexOf('20261028060000_permission_product_mutations.sql\')');
  const p2 = script.indexOf('20261028070000_permission_slot_metadata_atomic.sql\')');
  assert.ok(p1 >= 0 && p2 > p1);
  assert.match(script, /Validar estado final das policies products/);
  assert.match(script, /Verificação SQL B6\.2A/);
});

test('does not revoke DML grants or touch operational stock transactions', () => {
  assert.match(script, /Não serão revogados grants\/DML de slots, history, divergencias ou produtos/);
  assert.doesNotMatch(script, /REVOKE\s+(INSERT|UPDATE|DELETE|ALL)\s+ON\s+(public\.)?(slots|history|divergencias|products)/i);
  assert.doesNotMatch(script, /docker (start|restart|stop|rm)\b/i);
});

test('runs only empty-payload authorization checks in rolled-back transactions', () => {
  assert.match(script, /update_slot_metadata_atomic\('\{\}'::jsonb, '\{\}'::jsonb\)/);
  assert.match(script, /PERMISSION_DENIED:map\.metadata\.edit/);
  assert.match(script, /INVALID_SLOT_METADATA_PAYLOAD/);
  assert.match(script, /ROLLBACK;/);
});

test('product migration preserves read policy and gates each write permission independently', () => {
  assert.match(b61, /has_app_permission\('products\.create'\)/);
  assert.match(b61, /has_app_permission\('products\.edit'\)/);
  assert.match(b61, /has_app_permission\('products\.delete_deactivate'\)/);
  assert.match(script, /products_select_authenticated/);
  assert.doesNotMatch(b61, /DROP POLICY IF EXISTS products_select_authenticated/);
});

test('metadata RPC restricts fields and checks map.metadata.edit before writing', () => {
  assert.match(b62, /has_app_permission\('map\.metadata\.edit'\)/);
  assert.match(b62, /SET "dataChacote" = p_metadata ->> 'dataChacote'/);
  assert.match(b62, /SET "dataChacote" = p_metadata ->> 'dataChacote',[\s\S]*galpao = p_metadata ->> 'galpao',[\s\S]*restricao = p_metadata ->> 'restricao',[\s\S]*observacao = p_metadata ->> 'observacao'/);
  assert.match(b62, /REVOKE ALL ON FUNCTION public\.update_slot_metadata_atomic\(jsonb, jsonb\) FROM PUBLIC/);
});
