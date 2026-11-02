import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'docs/sql/migrations/20261029000000_shared_lancamento_draft_permission_compat.sql'), 'utf8');
const verify = readFileSync(resolve(root, 'docs/sql/20261029000000_shared_lancamento_draft_verify.sql'), 'utf8');
const smoke = readFileSync(resolve(root, 'docs/sql/20261029000000_shared_lancamento_draft_smoke.sql'), 'utf8');
const runner = readFileSync(resolve(root, 'scripts/Apply-SharedLancamentoDraft-ToLocalIntegration.ps1'), 'utf8');
const historical = readFileSync(resolve(root, 'docs/sql/20261024_shared_lancamento_draft.sql'), 'utf8');

test('compatibility migration is local-only and requires the permission foundation plus B7.1 typed writers', () => {
  assert.match(migration, /NÃO executar em Supabase Cloud\/produção/i);
  assert.match(migration, /has_app_permission\(text\)/);
  assert.match(migration, /apply_stock_mutation_atomic\(jsonb,jsonb,jsonb,jsonb,jsonb,text\)/);
  assert.match(migration, /apply_stock_mutation_atomic_with_deletes\(jsonb,jsonb,jsonb,jsonb,jsonb,text\[\],text\)/);
  assert.match(migration, /COMPATIBILITY_PREFLIGHT_FAILED/);
});

test('all six shared RPCs use the intended granular permission gates', () => {
  const functions = [
    ['get_shared_lancamento_draft', 'stock.launch.view'],
    ['upsert_shared_lancamento_draft_lines', 'stock.launch.create'],
    ['delete_shared_lancamento_draft_line', 'stock.launch.create'],
    ['clear_shared_lancamento_draft', 'stock.launch.create', 'stock.batch.process'],
    ['get_shared_lancamento_batch_result', 'stock.batch.process'],
    ['process_shared_lancamento_draft_batch_atomic', 'stock.launch.create', 'stock.batch.process'],
  ];
  for (const [name, ...keys] of functions) {
    const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
    assert.notEqual(start, -1, `missing ${name}`);
    const end = migration.indexOf('$function$;', start);
    assert.notEqual(end, -1, `unterminated ${name}`);
    const body = migration.slice(start, end);
    assert.doesNotMatch(body, /has_app_role/);
    for (const key of keys) assert.ok(body.includes(key), `${name} missing ${key}`);
  }
  assert.doesNotMatch(migration, /has_app_role/);
});

test('batch processing calls only B7.1 typed stock writers with explicit launch type', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.process_shared_lancamento_draft_batch_atomic');
  const end = migration.indexOf('$function$;', start);
  const body = migration.slice(start, end);
  assert.match(body, /apply_stock_mutation_atomic_with_deletes\([\s\S]*?v_normal_delete_slot_ids, 'launch'\s*\)/);
  assert.match(body, /apply_stock_mutation_atomic\([\s\S]*?v_normal_history, 'launch'\s*\)/);
  assert.doesNotMatch(body, /apply_stock_mutation_atomic_with_deletes\([\s\S]*?v_normal_delete_slot_ids\s*\)/);
  assert.doesNotMatch(body, /apply_stock_mutation_atomic\([\s\S]*?v_normal_history\s*\)/);
});

test('historical concurrency, idempotency, archive, and batch-lock logic are preserved', () => {
  for (const token of [
    'lancamento_draft_control', 'lancamento_draft_lines', 'lancamento_draft_archive_lines',
    'lancamento_batch_runs', 'DRAFT_GENERATION_CONFLICT', 'DRAFT_REVISION_CONFLICT',
    'BATCH_IDEMPOTENCY_KEY_COLLISION', 'DRAFT_SNAPSHOT_MISMATCH',
    'FOR UPDATE', 'FOR SHARE', 'stock_address_lock_key',
    'SHARED_DRAFT_BATCH_ATOMIC_FAILED', 'ON CONFLICT (user_id) DO NOTHING',
  ]) {
    assert.ok(migration.includes(token), `migration missing preserved contract: ${token}`);
    assert.ok(historical.includes(token), `historical source missing baseline contract: ${token}`);
  }
});

test('RPC grants remain authenticated-only and internal tables remain inaccessible directly', () => {
  assert.match(migration, /REVOKE ALL ON TABLE public\.lancamento_draft_control FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.process_shared_lancamento_draft_batch_atomic[\s\S]*FROM PUBLIC, anon, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.process_shared_lancamento_draft_batch_atomic[\s\S]*TO authenticated/);
  assert.match(verify, /SHARED_DRAFT_RPC_SIGNATURE_SET_INVALID/);
  assert.match(verify, /has_table_privilege\('authenticated'/);
  assert.match(verify, /has_function_privilege\('anon'/);
  assert.match(verify, /has_function_privilege\('service_role'/);
  assert.match(verify, /SHARED_DRAFT_IDENTITY_HELPER_EXPOSED/);
});

test('local smoke blocks Production, proves Administrator reaches validation, and rolls back', () => {
  assert.match(smoke, /PASS_SHARED_DRAFT_PRODUCTION_DENIED_ALL_SIX_RPCS/);
  assert.match(smoke, /PASS_SHARED_DRAFT_ADMIN_PERMISSION_GATES_AND_VALIDATION/);
  assert.match(smoke, /ROLLBACK;/);
  assert.doesNotMatch(smoke, /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i);
  assert.match(runner, /supabase_db_enderecamento-integracao-local/);
  assert.match(runner, /c:\\testes\\enderecamento_integracao_local/i);
  assert.match(runner, /APLICAR LOTE COMPARTILHADO LOCAL/);
  assert.doesNotMatch(runner, /docker\s+(?:start|stop|restart|rm|run)\b/i);
  assert.doesNotMatch(runner, /supabase\s+(?:db\s+reset|migration\s+up|start|stop)\b/i);
});

test('runner dependency preflight SQL closes the scalar subquery exactly once', () => {
  assert.match(runner, /WHERE c\.column_name IS NULL\)::text;/);
  assert.doesNotMatch(runner, /WHERE c\.column_name IS NULL\)\)::text;/);
});
