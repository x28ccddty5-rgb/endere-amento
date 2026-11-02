import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const sandbox = "docs/seguranca/permission-sandbox";

test("permission sandbox is a separate local Supabase project on non-default ports", () => {
  const config = read(`${sandbox}/supabase/config.toml`);
  assert.match(config, /project_id\s*=\s*"enderecamento-permission-test"/);
  assert.match(config, /port\s*=\s*55321/);
  assert.match(config, /port\s*=\s*55433/);
  assert.match(config, /\[realtime\]\s*\nenabled\s*=\s*false/s);
  assert.match(config, /\[storage\]\s*\nenabled\s*=\s*false/s);
  assert.match(config, /\[analytics\]\s*\nenabled\s*=\s*false/s);
  assert.match(config, /\[edge_runtime\]\s*\nenabled\s*=\s*false/s);
  // Public signup stays disabled; email/password sign-in remains enabled.
  // This avoids the CLI mapping bug where auth.email.enable_signup=false disables the provider.
  const authSection = config.split("[auth]")[1]?.split(/\n\[/, 1)[0] ?? "";
  const emailSection = config.split("[auth.email]")[1]?.split(/\n\[/, 1)[0] ?? "";
  assert.match(authSection, /^enable_signup\s*=\s*false$/m);
  assert.match(emailSection, /^enable_signup\s*=\s*true$/m);
});

test("sandbox B1/B2 migrations are byte-for-byte copies of the reviewed canonical SQL", () => {
  assert.equal(
    read(`${sandbox}/supabase/migrations/20261028010000_permission_foundation.sql`),
    read("docs/sql/migrations/20261028010000_permission_foundation.sql"),
  );
  assert.equal(
    read(`${sandbox}/supabase/migrations/20261028020000_permission_admin_write_rpcs.sql`),
    read("docs/sql/migrations/20261028020000_permission_admin_write_rpcs.sql"),
  );
});

test("local fixture includes five configurable profiles and no production data", () => {
  const sql = read(`${sandbox}/supabase/migrations/20261028000000_permission_sandbox_profiles.sql`);
  assert.match(sql, /lideranca-teste/);
  assert.match(sql, /rafael-teste/);
  assert.match(sql, /ON TABLE public\.profiles FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.(slots|history|divergencias)/i);
  assert.match(sql, /LOCAL-ONLY FIXTURE/i);
});

test("main app can read only the authenticated user's own sandbox profile", () => {
  const sql = read(`${sandbox}/supabase/migrations/20261028040000_permission_test_app_profile_access.sql`);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS full_name text/i);
  assert.match(sql, /GRANT SELECT\s*\(id, username, name, full_name, role\)\s*ON TABLE public\.profiles TO authenticated/i);
  assert.match(sql, /CREATE POLICY profiles_select_own[\s\S]*FOR SELECT[\s\S]*TO authenticated[\s\S]*USING \(id = \(SELECT auth\.uid\(\)\)\)/i);
  assert.doesNotMatch(sql, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\b[\s\S]*?ON TABLE public\.profiles TO authenticated/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
});

test("test-only profile listing RPC validates the authenticated administrator and is not in main migrations", () => {
  const sql = read(`${sandbox}/supabase/migrations/20261028030000_permission_test_list_users.sql`);
  assert.match(sql, /v_actor_role IS DISTINCT FROM 'administrador'/);
  assert.match(sql, /SET search_path = ''/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.permission_test_list_users\(\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.permission_test_list_users\(\) TO authenticated/);
  assert.equal(read("supabase/functions/admin-users/index.ts").includes("permission_test_list_users"), false);
});

test("test page blocks remote endpoints and uses local-only live mode guard", () => {
  const app = read("src/PermissionTestApp.tsx");
  assert.match(app, /getPermissionAdminMode\(\)/);
  assert.match(app, /EXPECTED_LOCAL_HOSTS/);
  assert.match(app, /MODE !== "live" \|\| !isLocalApi/);
  assert.match(app, /permission_test_list_users/);
  assert.match(app, /PermissionManagementPanel users=\{users\} mode="live"/);
  assert.match(read("permission-test.html"), /permission-test-main\.tsx/);
});

test("setup script never saves the service-role key and writes only local API environment", () => {
  const ps = read("scripts/Start-PermissionSandbox.ps1");
  assert.match(ps, /55321/);
  assert.match(ps, /db reset --local --yes/);
  assert.match(ps, /API_URL/);
  assert.match(ps, /ANON_KEY/);
  assert.match(ps, /SERVICE_ROLE_KEY/);
  assert.match(ps, /Host -notin @\("localhost", "127.0.0.1", "::1"\)/);
  assert.match(ps, /VITE_SUPABASE_URL=\$ApiUrl/);
  assert.match(ps, /VITE_SUPABASE_ANON_KEY=\$AnonKey/);
  assert.doesNotMatch(ps, /VITE_SUPABASE_SERVICE_ROLE_KEY/);
  assert.ok(ps.includes('DO `$verify`$'), 'PowerShell must emit a valid PostgreSQL dollar-quoted DO block');
  assert.ok(ps.includes('`$verify`$;'), 'PowerShell DO block terminator must be escaped correctly');
  assert.match(ps, /requiredPorts = @\(55321, 55433, 55323\)/, 'sandbox must fail before startup when its ports are occupied');
  assert.match(ps, /existingApi/, 'rerun must recognize this already-started local sandbox without stopping unrelated services');
});

test("sandbox B9 migration is an exact copy of the reviewed canonical SQL", () => {
  assert.equal(
    read(`${sandbox}/supabase/migrations/20261030110000_permission_lideranca_configuravel.sql`),
    read("docs/sql/migrations/20261030110000_permission_lideranca_configuravel.sql"),
  );

  const setup = read("scripts/Start-PermissionSandbox.ps1");
  assert.match(setup, /20261030110000_permission_lideranca_configuravel\.sql/);
  assert.match(setup, /lideranca-teste/);

  const backend = read("scripts/Test-PermissionBackend.mjs");
  assert.match(backend, /actual_role_permission_rows === 145/);
});

test("sandbox instructions forbid linking, pushing or running against remote Supabase", () => {
  const doc = read(`${sandbox}/../Permission-Sandbox-README.md`);
  assert.match(doc, /Não use[\s\S]*supabase db push/);
  assert.match(doc, /não prova[\s\S]*botões\/mutações operacionais/);
});

test("startup checks exact sandbox container mappings before treating an existing stack as live", () => {
  const ps = read("scripts/Start-PermissionSandbox.ps1");
  assert.match(ps, /docker ps --format ".*\{\{\.Names\}\}.*\{\{\.Ports\}\}"/);
  assert.match(ps, /supabase_db_enderecamento-permission-test/);
  assert.match(ps, /supabase_kong_enderecamento-permission-test/);
  assert.match(ps, /supabase_studio_enderecamento-permission-test/);
  assert.match(ps, /55433->5432\/tcp/);
  assert.match(ps, /55321->8000\/tcp/);
  assert.match(ps, /55323->3000\/tcp/);
  assert.doesNotMatch(ps, /\$existingStatus = & \$SupabaseCli status -o env/);
  assert.match(ps, /partial state|estado parcial do sandbox/i);
});

test("sandbox test password is generated randomly per local run, not hard-coded", () => {
  const setup = read("scripts/Start-PermissionSandbox.ps1");
  const instructions = read(`${sandbox}/../Permission-Sandbox-README.md`);
  assert.match(setup, /RandomNumberGenerator\]::Create\(\)/);
  assert.match(setup, /GetBytes\(\$bytes\)/);
  assert.match(setup, /\$TestPassword = New-SandboxTestPassword/);
  assert.doesNotMatch(setup, /LocalPermissao!2026/);
  assert.doesNotMatch(instructions, /LocalPermissao!2026/);
  assert.match(instructions, /senha aleatória exibida uma única vez/i);
});
