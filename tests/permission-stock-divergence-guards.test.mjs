import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../docs/sql/migrations/20261030100000_permission_stock_divergence_guards.sql', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

 test('physical correction RPCs use the configurable permission catalog', () => {
  const main = migration.split('CREATE OR REPLACE FUNCTION public.reconcile_physical_address_atomic(')[1]?.split('$function$;')[0] ?? '';
  const deletes = migration.split('CREATE OR REPLACE FUNCTION public.reconcile_physical_address_atomic_with_deletes(')[1]?.split('$function$;')[0] ?? '';
  assert.match(main, /has_app_permission\('stock\.physical_correction'\)/);
  assert.match(main, /has_app_permission\('divergences\.resolve'\)/);
  assert.match(deletes, /has_app_permission\('stock\.physical_correction'\)/);
  assert.match(deletes, /has_app_permission\('divergences\.resolve'\)/);
  assert.doesNotMatch(main, /has_app_role\(/);
  assert.doesNotMatch(deletes, /has_app_role\(/);
});

test('divergence resolver is SECURITY DEFINER and checks the delegated resolve permission', () => {
  const resolver = migration.split('CREATE OR REPLACE FUNCTION public.resolve_stock_divergence_atomic(')[1]?.split('$function$;')[0] ?? '';
  assert.match(resolver, /SECURITY DEFINER/);
  assert.match(resolver, /SET search_path TO ''/);
  assert.match(resolver, /has_app_permission\('divergences\.resolve'\)/);
  assert.doesNotMatch(resolver, /has_app_role\(/);
});

test('CASE operands in PL/pgSQL comparisons are explicitly parenthesized', () => {
  assert.doesNotMatch(migration, /IS DISTINCT FROM\s+CASE\s+WHEN/i);
  assert.equal((migration.match(/IS DISTINCT FROM\s+\(CASE\s+WHEN/gi) ?? []).length, 2);
});

test('migration preflight checks the dependencies required by physical zero', () => {
  assert.match(migration, /stock_address_lock_key\(text,text,text\)/);
  assert.match(migration, /lock_stock_address_key\(text\)/);
  assert.match(migration, /physical_corrections/);
  assert.match(migration, /warehouse_layout_positions/);
  assert.match(migration, /warehouse_layout/);
});

test('zero-address RPC is a dedicated SECURITY DEFINER transaction with explicit confirmation and locks', () => {
  const zero = migration.split('CREATE OR REPLACE FUNCTION public.zero_physical_divergence_address_atomic(')[1]?.split('$function$;')[0] ?? '';
  assert.match(zero, /SECURITY DEFINER/);
  assert.match(zero, /SET search_path TO ''/);
  assert.match(zero, /p_physical_zero_confirmed IS DISTINCT FROM TRUE/);
  assert.match(zero, /has_app_permission\('stock\.physical_correction'\)/);
  assert.match(zero, /has_app_permission\('divergences\.resolve'\)/);
  assert.match(zero, /lock_stock_address_key/);
  assert.match(zero, /INSERT INTO public\.physical_corrections/);
  assert.match(zero, /INSERT INTO public\.history/);
  assert.match(zero, /DELETE FROM public\.slots/);
  assert.match(zero, /UPDATE public\.divergencias/);
  assert.match(zero, /PHYSICAL_ZERO_HISTORY_SET_MISMATCH/);
  assert.match(zero, /'effective_date', to_char\(v_existing_created_at AT TIME ZONE 'America\/Sao_Paulo'/);
  assert.match(zero, /'effective_time', to_char\(v_existing_created_at AT TIME ZONE 'America\/Sao_Paulo'/);
  assert.match(zero, /'actor_name', \(SELECT c\.created_by_name FROM public\.physical_corrections/);
});

test('migration limits RPC execution to authenticated and does not revoke table DML or rewrite RLS', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.resolve_stock_divergence_atomic[^;]+FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.resolve_stock_divergence_atomic[^;]+TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.zero_physical_divergence_address_atomic[^;]+TO authenticated/);
  assert.doesNotMatch(migration, /REVOKE (?:INSERT|UPDATE|DELETE|ALL) ON TABLE/i);
  assert.doesNotMatch(migration, /DROP POLICY|CREATE POLICY|ALTER TABLE/i);
});

test('mobile physical zero checks both configurable permissions before the RPC path', () => {
  const start = app.indexOf('const handleMobileResolveDivergencia');
  const end = app.indexOf('const occupiedPalletsE1', start);
  const handler = app.slice(start, end);
  const physical = handler.indexOf('requestAppMutationPermission("stock.physical_correction"');
  const resolve = handler.indexOf('requestAppMutationPermission("divergences.resolve"');
  const rpc = handler.indexOf('supabase.rpc("zero_physical_divergence_address_atomic"');
  assert.ok(start >= 0 && end > start);
  assert.ok(physical >= 0 && resolve > physical && rpc > resolve);
});
