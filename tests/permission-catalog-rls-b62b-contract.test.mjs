import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "docs/sql/migrations/20261031130000_permission_catalog_rls_b62b.sql",
);
const sql = readFileSync(migrationPath, "utf8");

function policy(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(new RegExp(`CREATE POLICY ${escaped}[\\s\\S]*?;`, "i"));
  assert.ok(match, `policy ${name} must exist in migration`);
  return match[0];
}

test("B6.2B is transactional and validates the permission catalog and prerequisites", () => {
  assert.match(sql, /^-- Auditoria 03[\s\S]*?BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /B62B_PREFLIGHT_PERMISSION_KEYS_MISSING/);
  assert.match(sql, /public\.permission_catalog/);
  assert.match(sql, /public\.has_app_permission\(text\)/);
});

test("all six operational SELECT policies use configurable permission checks, not role lists", () => {
  const expected = [
    ["slots_select_permission_catalog", ["dashboard.view", "stock.search", "stock.details.view", "stock.launch.view", "stock.launch.create", "stock.transfer.create", "stock.batch.process", "stock.physical_correction", "divergences.resolve", "map.view", "map.metadata.edit", "consultor.use"]],
    ["history_select_permission_catalog", ["history.view"]],
    ["divergencias_select_permission_catalog", ["divergences.view", "divergences.resolve"]],
    ["products_select_permission_catalog", ["products.view", "products.create", "products.edit", "products.import_bulk", "products.delete_deactivate", "stock.search", "stock.details.view", "stock.launch.view", "stock.launch.create", "stock.transfer.create", "stock.batch.process", "consultor.use"]],
    ["warehouse_layout_select_permission_catalog", ["warehouse.layout.view", "warehouse.layout.manage", "map.view", "dashboard.view", "stock.physical_correction"]],
    ["warehouse_layout_positions_select_permission_catalog", ["warehouse.layout.view", "warehouse.layout.manage", "map.view", "dashboard.view", "stock.physical_correction"]],
  ];

  for (const [name, keys] of expected) {
    const definition = policy(name);
    assert.match(definition, /FOR SELECT\s+TO authenticated/i);
    assert.match(definition, /USING\s*\(/i);
    assert.match(definition, /has_app_permission/i);
    assert.doesNotMatch(definition, /has_app_role/i);
    for (const key of keys) {
      assert.ok(definition.includes(`'${key}'`), `${name} must include ${key}`);
    }
  }
});

test("all legacy role-only SELECT policies are replaced", () => {
  for (const name of [
    "slots_select_authenticated",
    "history_select_authenticated",
    "divergencias_select_authenticated",
    "products_select_authenticated",
    "warehouse_layout_select_authenticated",
    "warehouse_layout_positions_select_authenticated",
  ]) {
    assert.match(sql, new RegExp(`DROP POLICY IF EXISTS ${name}`, "i"));
  }
});

test("direct DML is removed from stock and physical-layout tables", () => {
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON TABLE[\s\S]*public\.slots[\s\S]*public\.history[\s\S]*public\.divergencias[\s\S]*public\.warehouse_layout[\s\S]*public\.warehouse_layout_positions[\s\S]*FROM PUBLIC, anon, authenticated/i);
  for (const name of [
    "slots_insert_operations",
    "slots_update_operations",
    "history_insert_operations",
    "divergencias_insert_operations",
    "divergencias_update_operations",
    "warehouse_layout_insert_admin",
    "warehouse_layout_update_admin",
    "warehouse_layout_positions_insert_admin",
    "warehouse_layout_positions_update_admin",
  ]) {
    assert.match(sql, new RegExp(`DROP POLICY IF EXISTS ${name}`, "i"));
  }
});

test("products direct writers are preserved under the three granular permission policies", () => {
  const directDmlRevoke = sql.match(/REVOKE INSERT, UPDATE, DELETE ON TABLE[\s\S]*?FROM PUBLIC, anon, authenticated;/i);
  assert.ok(directDmlRevoke, "DML revoke statement must exist");
  assert.doesNotMatch(directDmlRevoke[0], /public\.products/i);
  for (const name of [
    "products_insert_permission",
    "products_update_permission",
    "products_delete_permission",
  ]) {
    assert.match(sql, new RegExp(name));
  }
  assert.match(sql, /B62B_POSTFLIGHT_PRODUCTS_DIRECT_WRITERS_CHANGED/);
  assert.match(sql, /B62B_POSTFLIGHT_PRODUCTS_PERMISSION_POLICIES_INVALID/);
});

test("metadata RPC revokes PUBLIC and anon while keeping authenticated EXECUTE", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.update_slot_metadata_atomic\(jsonb,jsonb\) FROM PUBLIC, anon/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.update_slot_metadata_atomic\(jsonb,jsonb\) TO authenticated/i);
  assert.match(sql, /B62B_POSTFLIGHT_METADATA_RPC_ACL_INVALID/);
});

test("migration postflight fails closed if role-based policies or direct DML remain", () => {
  assert.match(sql, /B62B_POSTFLIGHT_ROLE_BASED_SELECT_POLICY_REMAINS/);
  assert.match(sql, /B62B_POSTFLIGHT_DIRECT_WRITE_POLICY_REMAINS/);
  assert.match(sql, /B62B_POSTFLIGHT_AUTHENTICATED_DIRECT_DML_REMAINS/);
  assert.match(sql, /B62B_POSTFLIGHT_PERMISSION_SELECT_POLICIES_INVALID/);
});


const applyRunnerPath = resolve(
  process.cwd(),
  "scripts/Apply-PermissionCatalogRlsB62B-ToLocalIntegration.ps1",
);
const rlsRunnerPath = resolve(
  process.cwd(),
  "scripts/Test-PermissionCatalogRlsB62B-LocalIntegration.ps1",
);
const applyRunner = readFileSync(applyRunnerPath, "utf8");
const rlsRunner = readFileSync(rlsRunnerPath, "utf8");

test("PowerShell runners transport multiline SQL as files instead of native -c arguments", () => {
  assert.match(applyRunner, /docker cp[\s\S]*?psql @PsqlArguments/i);
  assert.match(applyRunner, /"-f", \$ContainerSqlPath/);
  assert.doesNotMatch(applyRunner, /-c\s+\$MigrationSql/i);
  assert.match(applyRunner, /finally[\s\S]*?rm -f \$ContainerSqlPath/i);

  assert.match(rlsRunner, /function Invoke-LocalPsqlFile/i);
  assert.match(rlsRunner, /docker cp[\s\S]*?"-f", \$ContainerSqlPath/i);
  assert.doesNotMatch(rlsRunner, /-c\s+\$(?:MatrixSql|ProfilesSql|CountsSql|Sql)\b/i);
  assert.match(rlsRunner, /finally[\s\S]*?rm -f \$ContainerSqlPath/i);
});

test("RLS PowerShell runner uses safe variable delimiters in interpolated diagnostics", () => {
  assert.ok(rlsRunner.includes('para ${Role}: $($Values.Count) colunas.'));
  assert.doesNotMatch(rlsRunner, /\$Role:/);
});


test("RLS runner simulates all five role matrices with one existing no-override profile and rolls back each test", () => {
  assert.match(rlsRunner, /FROM public\.profiles p[\s\S]*?NOT EXISTS[\s\S]*?FROM public\.user_permission_overrides upo[\s\S]*?WHERE upo\.user_id = p\.id/i);
  assert.match(rlsRunner, /UPDATE public\.profiles[\s\S]*?SET role = '\$Role'[\s\S]*?WHERE id = '\$TestUserId'::uuid/i);
  assert.match(rlsRunner, /B62B_RLS_ROLE_FIXTURE_PROFILE_NOT_UPDATED/);
  assert.match(rlsRunner, /SET LOCAL ROLE authenticated/);
  assert.match(rlsRunner, /SET LOCAL "request\.jwt\.claim\.sub" = '\$TestUserId'/);
  assert.match(rlsRunner, /ROLLBACK;/);
  assert.doesNotMatch(rlsRunner, /\$MissingRoles|Cinco perfis encontrados/);
  assert.match(rlsRunner, /foreach \(\$Role in \$ExpectedRoles\)/);
});

test("RLS runner validates the exact local Docker/Supabase clone and PostgreSQL 17", () => {
  assert.match(rlsRunner, /com\.docker\.compose\.project/);
  assert.match(rlsRunner, /com\.supabase\.cli\.project/);
  assert.match(rlsRunner, /com\.supabase\.cli\.workdir/);
  assert.match(rlsRunner, /State\.Running/);
  assert.match(rlsRunner, /current_setting\('server_version'\)/);
  assert.match(rlsRunner, /postgres\\\|17/);
});

test("RLS runner refuses to proceed unless the applied B6.2B policies and ACL are confirmed", () => {
  assert.match(rlsRunner, /PREFLIGHT RLS B6\.2B JA APLICADA/);
  assert.match(rlsRunner, /slots_select_permission_catalog/);
  assert.match(rlsRunner, /history_select_permission_catalog/);
  assert.match(rlsRunner, /has_app_role/);
  assert.match(rlsRunner, /has_table_privilege/);
  assert.match(rlsRunner, /products_insert_permission/);
  assert.match(rlsRunner, /has_function_privilege/);
  assert.match(rlsRunner, /6\|6\|0\|0\|1\|3\|0\|1/);
  assert.match(rlsRunner, /29\|145\|5/);
});

test("RLS runner verifies that both the history fixture and original profile role were rolled back", () => {
  assert.match(rlsRunner, /B62B_RLS_HISTORY_FIXTURE_PERSISTED/);
  assert.match(rlsRunner, /B62B_RLS_PROFILE_ROLE_NOT_RESTORED/);
  assert.match(rlsRunner, /OriginalRole/);
  assert.match(rlsRunner, /ProfilePostflightRoles/);
});
