import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const quickCorrection = await readFile(new URL('../src/lib/mapQuickCorrection.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../docs/sql/migrations/20261028090000_typed_stock_mutation_rpcs.sql', import.meta.url), 'utf8');
const verifySql = await readFile(new URL('../docs/sql/20261028090000_typed_stock_mutation_rpcs_verify.sql', import.meta.url), 'utf8');
const smokeSql = await readFile(new URL('../docs/sql/20261028090000_typed_stock_mutation_rpcs_smoke.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../docs/sql/rollback/20261028090000_rollback_typed_stock_mutation_rpcs.sql', import.meta.url), 'utf8');
const runner = await readFile(new URL('../scripts/Apply-TypedStockMutation-ToLocalIntegration.ps1', import.meta.url), 'utf8');

test('App labels the five callsites by launch, transfer, correction, or shared batch', () => {
  assert.match(app, /undefined,\s*"launch",\s*\);/);
  assert.match(app, /undefined,\s*"transfer",\s*\);/);
  assert.match(app, /undefined,\s*"physical_correction",\s*\);/);
  assert.match(app, /"stock\.batch\.process"/);
  assert.match(app, /"stock\.launch\.create"/);
});

test('map quick correction marks all history rows and preserves the strict E1 audit contract', () => {
  assert.match(quickCorrection, /naturezaTransacao:\s*\"correcao_fisica\" as const/);
  assert.match(quickCorrection, /saldoAnterior,/);
  assert.match(quickCorrection, /saldoFinal,/);
  assert.match(quickCorrection, /correcaoId:\s*correctionId/);
  assert.match(migration, /PHYSICAL_CORRECTION_AUDIT_MARKER_REQUIRED/);
});

test('client rechecks the intent-specific permission before any write path', () => {
  assert.match(app, /const operationPermission: PermissionKey = operationType === "transfer"[\s\S]*?"stock\.physical_correction"[\s\S]*?"stock\.launch\.create"/);
  assert.match(app, /requestAppMutationPermission\(operationPermission, operationLabel\)/);
  assert.match(app, /p_operation_type:\s*operationType/);
});

test('typed RPC overloads check permission in SECURITY DEFINER with empty search_path', () => {
  assert.match(migration, /CREATE FUNCTION public\.apply_stock_mutation_atomic\([^;]+p_operation_type text\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path TO ''/);
  assert.match(migration, /CREATE FUNCTION public\.apply_stock_mutation_atomic_with_deletes\([^;]+p_operation_type text\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path TO ''/);
  for (const key of ['stock.launch.create','stock.transfer.create','stock.physical_correction']) {
    assert.ok(migration.includes(`PERMISSION_DENIED:${key}`), `missing ${key} gate`);
    assert.ok(migration.includes(`public.has_app_permission('${key}') IS DISTINCT FROM TRUE`), `not fail-closed for ${key}`);
  }
});

test('server allows multi-address normal launches, limits physical correction scope, and validates exact transfer shape', () => {
  assert.match(migration, /IF p_operation_type = 'physical_correction' AND v_operation_scope_count > 1 THEN[\s\S]*?SINGLE_SCOPE_OPERATION_REQUIRED/);
  assert.doesNotMatch(migration, /IF p_operation_type IN \('launch', 'physical_correction'\) AND v_operation_scope_count > 1/);
  assert.match(migration, /TRANSFER_PAYLOAD_SHAPE_INVALID/);
  assert.match(migration, /TRANSFER_CANNOT_CHANGE_DIVERGENCES/);
  assert.match(migration, /PHYSICAL_CORRECTION_CANNOT_RESOLVE_DIVERGENCES/);
  assert.match(migration, /p_expected_slots, v_staged_slots, p_expected_divergencias, p_divergencias, p_history, p_operation_type/);
});

test('preflight blocks shared-batch and unreviewed external legacy callers, and requires B6 prerequisites', () => {
  assert.match(migration, /B7_1_REQUIRES_B6_1_B6_2A/);
  assert.match(migration, /B7_1_SHARED_BATCH_RPC_REQUIRES_RECONCILIATION/);
  assert.match(migration, /B7_1_EXTERNAL_LEGACY_WRITER_CALLERS_PRESENT/);
  assert.match(runner, /SHARED_BATCH_RPC/);
  assert.match(runner, /EXTERNAL_LEGACY_CALLERS/);
});

test('post-migration caller scan excludes all four known writer overloads to avoid counting typed-delete delegation as legacy use', () => {
  assert.match(runner, /p\.oid IS DISTINCT FROM to_regprocedure\('public\.apply_stock_mutation_atomic\(jsonb,jsonb,jsonb,jsonb,jsonb\)'\)::oid/);
  assert.match(runner, /p\.oid IS DISTINCT FROM to_regprocedure\('public\.apply_stock_mutation_atomic_with_deletes\(jsonb,jsonb,jsonb,jsonb,jsonb,text\[\]\)'\)::oid/);
  assert.match(runner, /p\.oid IS DISTINCT FROM to_regprocedure\('public\.apply_stock_mutation_atomic\(jsonb,jsonb,jsonb,jsonb,jsonb,text\)'\)::oid/);
  assert.match(runner, /p\.oid IS DISTINCT FROM to_regprocedure\('public\.apply_stock_mutation_atomic_with_deletes\(jsonb,jsonb,jsonb,jsonb,jsonb,text\[\],text\)'\)::oid/);
  assert.match(runner, /Detalhes dos chamadores externos das assinaturas legadas/);
  assert.match(runner, /LEGACY_CALLER\|/);
});

test('old untyped signatures fail closed and cannot be invoked by authenticated clients', () => {
  assert.match(migration, /STOCK_OPERATION_TYPE_REQUIRED/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.apply_stock_mutation_atomic\(jsonb,jsonb,jsonb,jsonb,jsonb\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.apply_stock_mutation_atomic_with_deletes\(jsonb,jsonb,jsonb,jsonb,jsonb,text\[\]\) FROM PUBLIC, anon, authenticated/);
});

test('smoke exercises all three denials for Produção and payload-validation reach for Admin without writes', () => {
  assert.match(smokeSql, /PASS_PRODUCTION_STOCK_MUTATIONS_DENIED/);
  assert.match(smokeSql, /PASS_ADMIN_REACHED_PAYLOAD_VALIDATION/);
  assert.equal((smokeSql.match(/ROLLBACK;/g) ?? []).length, 2);
  assert.equal((smokeSql.match(/apply_stock_mutation_atomic_with_deletes\(/g) ?? []).length, 6);
  assert.match(verifySql, /B7_1_DELETE_PERMISSION_GATES_MISSING/);
  assert.doesNotMatch(smokeSql, /INSERT INTO|UPDATE public\.(slots|history|divergencias)|DELETE FROM/i);
});

test('verification preserves permission matrix and checks function ACL/search_path; rollback notes application dependency', () => {
  assert.match(verifySql, /v_catalog <> 29 OR v_roles <> 116 OR v_distinct <> 116/);
  assert.match(verifySql, /B7_1_LEGACY_UNTYPED_WRITER_STILL_EXECUTABLE/);
  assert.match(rollback, /First roll back src\/App\.tsx/);
  assert.match(rollback, /DROP FUNCTION public\.apply_stock_mutation_atomic\(jsonb,jsonb,jsonb,jsonb,jsonb,text\)/);
  assert.match(rollback, /GRANT EXECUTE ON FUNCTION public\.apply_stock_mutation_atomic\(jsonb,jsonb,jsonb,jsonb,jsonb\) TO authenticated/);
});
test('every PL/pgSQL function body is terminated as a complete SQL statement', () => {
  const closers = [...migration.matchAll(/^\$function\$;?$/gm)].map((match) => match[0]);
  assert.equal(closers.length, 4, 'expected two typed writers and two fail-closed legacy stubs');
  assert.ok(closers.every((line) => line === '$function$;'), 'each closing dollar-quote must be followed by a SQL statement semicolon');
});


test('verification orders by catalog columns rather than applying casts to the output alias', () => {
  assert.match(verifySql, /ORDER BY proname, oid;/);
  assert.doesNotMatch(verifySql, /ORDER BY proname, signature::text/);
});

test('runner resumes a fully committed B7.1 state without replaying the migration', () => {
  assert.match(runner, /\$typedBaseExists = \$v\.TYPED_BASE -eq 'true'/);
  assert.match(runner, /\$typedDeleteExists = \$v\.TYPED_DELETE -eq 'true'/);
  assert.match(runner, /if\(\$typedBaseExists -ne \$typedDeleteExists\).*?Estado parcial inesperado/s);
  assert.match(runner, /Digite exatamente VERIFICAR B7\.1 TIPADO LOCAL/);
  assert.match(runner, /if\(\$alreadyApplied\)[\s\S]*?Verificar migration B7\.1/);
  assert.match(runner, /A migration será IGNORADA/);
});
