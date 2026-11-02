import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = 'docs/sql/migrations/20261101010000_permission_scoped_check_five_role_alignment.sql';
const verifyPath = 'docs/sql/20261101010000_permission_scoped_check_five_role_alignment_verify.sql';
const rollbackPath = 'docs/sql/rollback/20261101010000_rollback_permission_scoped_check_five_role_alignment.sql';

const [migration, verify, rollback] = await Promise.all([
  readFile(resolve(migrationPath), 'utf8'),
  readFile(resolve(verifyPath), 'utf8'),
  readFile(resolve(rollbackPath), 'utf8'),
]);

test('scoped permission RPC preflights the current five-role 29x5 matrix', () => {
  assert.match(migration, /v_catalog_count <> 29/);
  assert.match(migration, /v_role_rows <> 145/);
  assert.match(migration, /v_role_distinct <> 5/);
  assert.match(migration, /'lideranca'/);
  assert.match(migration, /FIVE_ROLE_PER_ROLE_COUNT_INVALID/);
  assert.match(migration, /FIVE_ROLE_DUPLICATE_GRANTS/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.has_app_permissions\(p_permission_keys text\[\]\)/);
});

test('scoped permission RPC is bounded, fail-closed and callable only by authenticated', () => {
  assert.match(migration, /auth\.uid\(\) IS NULL/);
  assert.match(migration, /v_input_count < 1 OR v_input_count > 8/);
  assert.match(migration, /v_distinct_count <> v_input_count/);
  assert.match(migration, /LEFT JOIN public\.permission_catalog pc/);
  assert.match(migration, /public\.has_app_permission\(supplied\.permission_key\)/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.has_app_permissions\(text\[\]\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.has_app_permissions\(text\[\]\) TO authenticated/);
});

test('verification expects 145 grants and checks definer/search_path/ACL', () => {
  assert.match(verify, /v_catalog_count <> 29 OR v_role_rows <> 145 OR v_role_distinct <> 5/);
  assert.match(verify, /search_path=""/);
  assert.match(verify, /authenticated_can_execute/);
  assert.match(verify, /anon_can_execute/);
});

test('rollback only removes the exact RPC and does not cascade', () => {
  assert.match(rollback, /DROP FUNCTION public\.has_app_permissions\(text\[\]\)/);
  assert.doesNotMatch(rollback, /CASCADE|DROP TABLE|DELETE FROM|TRUNCATE/i);
});
