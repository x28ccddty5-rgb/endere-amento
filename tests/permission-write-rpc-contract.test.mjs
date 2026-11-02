import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PERMISSION_CATALOG } from '../src/constants/permissionCatalog.ts';

const migration = await readFile(new URL('../docs/sql/migrations/20261028020000_permission_admin_write_rpcs.sql', import.meta.url), 'utf8');
const verifySql = await readFile(new URL('../docs/sql/20261028020000_permission_write_rpcs_verify.sql', import.meta.url), 'utf8');
const smokeSql = await readFile(new URL('../docs/sql/20261028020000_permission_write_rpcs_smoke_test.psql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../docs/sql/rollback/20261028020000_rollback_permission_write_rpcs.sql', import.meta.url), 'utf8');
const foundation = await readFile(new URL('../docs/sql/migrations/20261028010000_permission_foundation.sql', import.meta.url), 'utf8');

const writeRpcNames = ['save_role_permission_changes', 'save_user_permission_overrides'];

test('migration preflight requires the completed B1 foundation before creating write RPCs', () => {
  assert.match(migration, /PERMISSION_B2_REQUIRES_COMPLETE_B1_FOUNDATION/);
  assert.match(migration, /PERMISSION_B2_REQUIRES_COMPLETE_B1_MATRIX/);
  assert.match(migration, /PERMISSION_B2_REQUIRES_B1_AUTHORIZATION_HELPER/);
});

test('migration declares only the two expected permission write RPCs', () => {
  for (const name of writeRpcNames) assert.match(migration, new RegExp(`CREATE FUNCTION public\\.${name}\\(`));
  assert.equal((migration.match(/CREATE FUNCTION public\./g) ?? []).length, 2);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
});

test('both RPCs require authenticated administrator context in the backend', () => {
  for (const name of writeRpcNames) {
    const start = migration.indexOf(`CREATE FUNCTION public.${name}(`);
    const next = migration.indexOf('CREATE FUNCTION public.', start + 1);
    const block = migration.slice(start, next === -1 ? migration.length : next);
    assert.match(block, /v_actor_id uuid := auth\.uid\(\)/);
    assert.match(block, /SECURITY DEFINER/);
    assert.match(block, /SET search_path = ''/);
    assert.match(block, /v_actor_role <> 'administrador'/);
    assert.match(block, /public\.has_app_permission\('permissions\.manage'\)/);
  }
});

test('role writes cannot edit administrator or grant access to legacy Liderança', () => {
  assert.match(migration, /v_target_role NOT IN \('apoio', 'producao', 'visualizador'\)/);
  assert.match(migration, /PERMISSION_TARGET_ROLE_NOT_CONFIGURABLE/);
  assert.match(migration, /IF v_is_admin_only AND v_new_allowed THEN/);
  assert.match(migration, /PERMISSION_ADMIN_ONLY_CANNOT_BE_GRANTED_TO_ROLE/);
});

test('individual override writes cannot target admin or legacy roles', () => {
  assert.match(migration, /v_target_role NOT IN \('apoio', 'producao', 'visualizador'\)/);
  assert.match(migration, /PERMISSION_TARGET_USER_ROLE_NOT_DELEGABLE/);
  assert.match(migration, /IF v_new_decision <> 'inherit' AND \(v_is_admin_only OR NOT v_override_allowed\) THEN/);
  assert.match(migration, /PERMISSION_OVERRIDE_NOT_DELEGABLE/);
});

test('batch payloads are bounded, strict-shaped, unique and reject unknown permissions', () => {
  assert.equal((migration.match(/v_input_count < 1 OR v_input_count > 29/g) ?? []).length, 2);
  assert.equal((migration.match(/PERMISSION_CHANGE_BATCH_SIZE_INVALID/g) ?? []).length, 2);
  assert.equal((migration.match(/PERMISSION_DUPLICATE_KEYS_IN_BATCH/g) ?? []).length, 2);
  assert.equal((migration.match(/PERMISSION_KEY_UNKNOWN_OR_INACTIVE/g) ?? []).length, 2);
  assert.match(migration, /PERMISSION_CHANGE_ITEM_INVALID/);
  assert.match(migration, /PERMISSION_OVERRIDE_ITEM_INVALID/);
});

test('role matrix must be complete before changing either role or user permissions', () => {
  assert.match(migration, /PERMISSION_ROLE_MATRIX_INCOMPLETE/);
  assert.match(migration, /PERMISSION_TARGET_ROLE_MATRIX_INCOMPLETE/);
  assert.match(migration, /v_active_catalog_count <> 29/);
});

test('changes that alter state append an audit record with the actor, target and effective diff', () => {
  assert.equal((migration.match(/INSERT INTO public\.permission_change_audit/g) ?? []).length, 2);
  assert.match(migration, /actor_id, actor_username, actor_role, target_type, target_role, target_snapshot, changes/);
  assert.match(migration, /target_user_id, target_snapshot, changes/);
  assert.match(migration, /'from', v_old_allowed/);
  assert.match(migration, /'to', v_new_allowed/);
  assert.match(migration, /'from', v_old_decision/);
  assert.match(migration, /'to', v_new_decision/);
  assert.equal((migration.match(/IF pg_catalog\.jsonb_array_length\(v_effective_changes\) > 0 THEN/g) ?? []).length, 2);
});

test('inherit removes an override; unchanged decisions do not generate duplicate audit events', () => {
  assert.match(migration, /IF v_new_decision = 'inherit' THEN\s+DELETE FROM public\.user_permission_overrides/);
  assert.match(migration, /IF v_old_decision IS DISTINCT FROM v_new_decision THEN/);
  assert.match(migration, /IF v_old_allowed IS DISTINCT FROM v_new_allowed THEN/);
});

test('client execution is granted only to authenticated and denied to anon', () => {
  for (const name of writeRpcNames) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+ FROM PUBLIC, anon;`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+ TO authenticated;`));
  }
  assert.match(migration, /PERMISSION_WRITE_RPC_ANON_EXECUTE_MUST_BE_DENIED/);
  assert.match(migration, /PERMISSION_WRITE_RPC_AUTHENTICATED_EXECUTE_MISSING/);
});

test('new migration does not alter stock RPCs, RLS policies, permissions tables or role seeds', () => {
  assert.doesNotMatch(migration, /ALTER\s+TABLE\s+public\.(slots|history|divergencias|profiles)\b/i);
  assert.doesNotMatch(migration, /CREATE\s+POLICY|DROP\s+POLICY|ALTER\s+POLICY/i);
  assert.doesNotMatch(migration, /CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE\s+/i);
  assert.doesNotMatch(migration, /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.(apply_stock_mutation_atomic|reconcile_physical_address_atomic)/i);
  assert.match(foundation, /CREATE TABLE public\.permission_change_audit/);
});

test('verification checks RPC security and preserves the B1 base matrix', () => {
  assert.match(verifySql, /v_rpc_count <> 2/);
  assert.match(verifySql, /v_catalog_count <> 29 OR v_role_rows <> 116/);
  assert.match(verifySql, /has_function_privilege\('anon'/);
  assert.match(verifySql, /permission_change_audit/);
});

test('smoke test asserts a temporary admin change/restore, denies invalid cases, and rolls back', () => {
  assert.match(smokeSql, /SMOKE_TEST_ADMIN_CHANGE_DID_NOT_CHANGE_ONE_PERMISSION/);
  assert.match(smokeSql, /SMOKE_TEST_ADMIN_RESTORE_DID_NOT_CHANGE_ONE_PERMISSION/);
  assert.match(smokeSql, /SMOKE_TEST_FAILED_NON_ADMIN_CHANGED_ROLE_MATRIX/);
  assert.match(smokeSql, /SMOKE_TEST_FAILED_LEGACY_USER_OVERRIDE_WAS_ACCEPTED/);
  assert.match(smokeSql, /RESET ROLE;\s*ROLLBACK;/);
});

test('rollback drops only the two new RPCs without CASCADE or dropping data', () => {
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.save_role_permission_changes\(text, jsonb\)/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.save_user_permission_overrides\(uuid, jsonb\)/);
  assert.doesNotMatch(rollback, /DROP\s+FUNCTION[^;]*\bCASCADE\b/i);
  assert.doesNotMatch(rollback, /DROP TABLE|TRUNCATE|DELETE FROM|DROP POLICY/i);
  assert.match(rollback, /PERMISSION_FOUNDATION_MUST_REMAIN_INTACT/);
});

test('permission catalog keys used by the TypeScript contract are present in the foundation SQL', () => {
  for (const permission of PERMISSION_CATALOG) {
    assert.ok(foundation.includes(`'${permission.key}'`), `missing SQL seed for ${permission.key}`);
  }
});
