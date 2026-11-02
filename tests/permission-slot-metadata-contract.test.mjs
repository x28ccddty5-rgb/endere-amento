import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("src/App.tsx");
const rpcMigration = read("docs/sql/migrations/20261028070000_permission_slot_metadata_atomic.sql");
const rpcVerify = read("docs/sql/20261028070000_permission_slot_metadata_verify.sql");
const rollback = read("docs/sql/rollback/20261028070000_rollback_permission_slot_metadata_atomic.sql");

test("mobile slot metadata mutation rechecks map.metadata.edit and uses narrow RPC", () => {
  assert.match(app, /requestAppMutationPermission\("map\.metadata\.edit", "editar metadados do mapa"\)/);
  assert.match(app, /rpc\("update_slot_metadata_atomic"/);
  assert.doesNotMatch(app, /\.from\("slots"\)\s*\.upsert\(slotsData\)/);
  assert.match(app, /p_metadata:\s*metadata/);
  assert.match(app, /Nenhum saldo ou SKU foi alterado por este fluxo/);
});

test("unused standalone history writer is removed so history cannot be appended outside stock transactions", () => {
  assert.doesNotMatch(app, /\.from\("history"\)\s*\.insert/);
  assert.doesNotMatch(app, /appendHistoryToSupabase/);
  assert.doesNotMatch(app, /const appendHistory = async/);
});

test("RPC fails closed, checks exact permission, and updates metadata columns only", () => {
  assert.match(rpcMigration, /public\.has_app_permission\('map\.metadata\.edit'\) IS DISTINCT FROM TRUE/);
  assert.match(rpcMigration, /FOR UPDATE/);
  assert.match(rpcMigration, /SLOT_METADATA_CONFLICT/);
  assert.match(rpcMigration, /SET "dataChacote" = p_metadata/);
  assert.match(rpcMigration, /galpao = p_metadata/);
  assert.match(rpcMigration, /restricao = p_metadata/);
  assert.match(rpcMigration, /observacao = p_metadata/);
  assert.doesNotMatch(rpcMigration, /SET\s+saldo\s*=|SET\s+referencia\s*=|SET\s+descricao\s*=/i);
  assert.match(rpcMigration, /REVOKE ALL ON FUNCTION public\.update_slot_metadata_atomic/);
  assert.match(rpcMigration, /GRANT EXECUTE ON FUNCTION public\.update_slot_metadata_atomic.*TO authenticated/s);
});

test("RPC verify queries function privileges and metadata permission", () => {
  assert.match(rpcVerify, /rpc_exists/);
  assert.match(rpcVerify, /current_user_can_edit_map_metadata/);
  assert.match(rpcVerify, /slots_update_still_open_before_b/);
});

test("direct table DML revocation is deliberately deferred until operational RPC contracts are reconciled", () => {
  const doc = read("docs/seguranca/FaseB6-2-Metadados-Slot.md");
  assert.match(doc, /Não revogar ainda o DML direto em `slots`/);
  assert.doesNotMatch(rpcMigration, /REVOKE\s+(?:INSERT|UPDATE|DELETE|ALL).*TABLE public\.slots/i);
});

test("RPC removal rollback documents application rollback dependency", () => {
  assert.match(rollback, /reverta o App\.tsx/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.update_slot_metadata_atomic/);
});
