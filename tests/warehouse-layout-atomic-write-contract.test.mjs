import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

const layout = read("../src/lib/warehouseLayout.ts");
const positions = read("../src/lib/warehousePositions.ts");
const app = read("../src/App.tsx");
const types = read("../src/types.ts");
const adminUsers = read("../supabase/functions/admin-users/index.ts");

test("warehouse module saves use the atomic RPC and submit only changed rows", () => {
  assert.match(layout, /save_warehouse_layout_atomic/);
  assert.match(layout, /p_expected_layout:\s*expectedPayload/);
  assert.match(layout, /p_layout:\s*payload/);
  assert.match(layout, /const changedEntries = entries\.filter/);
  assert.doesNotMatch(layout, /\.from\(["']warehouse_layout["']\)\s*\.upsert\(/);
});

test("warehouse position saves use the atomic RPC and submit only changed rows", () => {
  assert.match(positions, /save_warehouse_positions_atomic/);
  assert.match(positions, /p_expected_positions:\s*expectedPayload/);
  assert.match(positions, /p_positions:\s*payload/);
  assert.match(positions, /const changedEntries = entries\.filter/);
  assert.doesNotMatch(positions, /\.from\(["']warehouse_layout_positions["']\)\s*\.upsert\(/);
});

test("App passes the loaded state as the optimistic concurrency snapshot", () => {
  assert.match(app, /saveWarehouseLayout\(entries,\s*warehouseLayout\)/);
  assert.match(app, /saveWarehousePositions\(entries,\s*warehousePositions\)/);
});

test("layout snapshots carry updated_at and updated_by for exact server comparison", () => {
  assert.match(types, /interface WarehouseLayoutEntry[\s\S]*?updatedBy\?: string \| null/);
  assert.match(types, /interface WarehousePositionConfig[\s\S]*?updatedBy\?: string \| null/);
  assert.match(layout, /updated_at:\s*previous\.updatedAt/);
  assert.match(layout, /updated_by:\s*previous\.updatedBy \?\? null/);
  assert.match(positions, /updated_at:\s*previous\.updatedAt/);
  assert.match(positions, /updated_by:\s*previous\.updatedBy \?\? null/);
});

test("admin-users Edge Function accepts Liderança after the B9 permission matrix was installed", () => {
  const allowedRoles = adminUsers.match(/const allowedRoles = \[([\s\S]*?)\]/);
  assert.ok(allowedRoles, "allowedRoles must remain explicit in the server function");
  assert.match(allowedRoles[1], /["']lideranca["']/);
});
