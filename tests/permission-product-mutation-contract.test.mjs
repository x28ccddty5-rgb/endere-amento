import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("src/App.tsx");
const panel = read("src/components/BaseDeDadosPanel.tsx");
const migration = read("docs/sql/migrations/20261028060000_permission_product_mutations.sql");
const rollback = read("docs/sql/rollback/20261028060000_rollback_permission_product_mutations.sql");

test("App rechecks product permissions server-side immediately before each mutation", () => {
  assert.match(app, /checkCurrentAppPermission/);
  assert.match(app, /requestAppMutationPermission\("products\.create"/);
  assert.match(app, /requestAppMutationPermission\("products\.edit"/);
  assert.match(app, /requestAppMutationPermission\("products\.delete_deactivate"/);
});

test("Base de Dados uses independent create, edit and delete permissions", () => {
  assert.match(panel, /canUsePermission\("products\.create"\)/);
  assert.match(panel, /canUsePermission\("products\.edit"\)/);
  assert.match(panel, /canUsePermission\("products\.delete_deactivate"\)/);
  assert.match(panel, /\{canEditProduct && <button/);
  assert.equal((panel.match(/\{canDeleteProduct && <button/g) ?? []).length, 2);
});

test("RLS checks each product mutation permission and fails closed on unexpected write policies", () => {
  assert.match(migration, /PERMISSION_PRODUCTS_PREFLIGHT_FOUNDATION_MISSING/);
  assert.match(migration, /PERMISSION_PRODUCTS_PREFLIGHT_UNEXPECTED_WRITE_POLICY/);
  assert.match(migration, /WITH CHECK \(public\.has_app_permission\('products\.create'\)\)/);
  assert.match(migration, /USING \(public\.has_app_permission\('products\.edit'\)\)/);
  assert.match(migration, /WITH CHECK \(public\.has_app_permission\('products\.edit'\)\)/);
  assert.match(migration, /USING \(public\.has_app_permission\('products\.delete_deactivate'\)\)/);
  assert.doesNotMatch(migration, /REVOKE\s+(?:INSERT|UPDATE|DELETE|ALL).*products/i);
  assert.doesNotMatch(migration, /DROP POLICY IF EXISTS products_select_authenticated/);
});

test("rollback restores the original legacy write policy names and scope", () => {
  assert.match(rollback, /CREATE POLICY products_insert_management/);
  assert.match(rollback, /CREATE POLICY products_update_management/);
  assert.match(rollback, /CREATE POLICY products_delete_management/);
  assert.match(rollback, /administrador.*lideranca/s);
});
