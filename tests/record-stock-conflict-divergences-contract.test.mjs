import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../docs/sql/migrations/20261031120000_record_stock_conflict_divergences_atomic.sql', import.meta.url), 'utf8');
const verify = readFileSync(new URL('../docs/sql/20261031120000_record_stock_conflict_divergences_verify.sql', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../docs/sql/20261031120000_record_stock_conflict_divergences_smoke.sql', import.meta.url), 'utf8');

test('conflict-only divergence route uses only the server RPC, not direct table DML', () => {
  assert.match(app, /record_stock_conflict_divergences_atomic/);
  assert.match(app, /p_operation_type:\s*operationType/);
  assert.match(app, /p_divergencias:\s*mapDivergenciasForSupabase\(newDivergencesOnly\)/);
  assert.doesNotMatch(app, /saveDivergenciasToSupabase/);
  assert.doesNotMatch(app, /\.from\(["']divergencias["']\)[\s\S]{0,180}\.upsert\(/);
});

test('server RPC maps each stock operation to its configurable permission and fails closed', () => {
  assert.match(migration, /WHEN 'launch' THEN 'stock\.launch\.create'/);
  assert.match(migration, /WHEN 'transfer' THEN 'stock\.transfer\.create'/);
  assert.match(migration, /WHEN 'physical_correction' THEN 'stock\.physical_correction'/);
  assert.match(migration, /has_app_permission\(v_permission_key\) IS DISTINCT FROM TRUE/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO ''/);
});

test('RPC inserts only open divergences, preserves idempotency, and never writes stock/history', () => {
  assert.match(migration, /v_new_divergencia\.status IS DISTINCT FROM 'Aberta'/);
  assert.match(migration, /INSERT INTO public\.divergencias/);
  assert.match(migration, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(migration, /DIVERGENCE_ID_CONFLICT/);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+INTO\s+public\.(?:slots|history)\b/i);
  assert.match(verify, /RPC_CHECK\|/);
  assert.match(verify, /RLS_UNCHANGED/);
  assert.match(smoke, /PASS_CONFLICT_DIVERGENCE_INSERTED/);
  assert.match(smoke, /PASS_CONFLICT_DIVERGENCE_IDEMPOTENT/);
  assert.match(smoke, /PASS_CONFLICT_DIVERGENCE_PERMISSION_ENFORCED/);
  assert.match(smoke, /ROLLBACK;/);
});
