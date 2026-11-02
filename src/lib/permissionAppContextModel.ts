import {
  ACTIVE_APP_ROLES,
  ADMIN_ONLY_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  type KnownAppRole,
  type PermissionKey,
} from "../constants/permissionCatalog.ts";

export type EffectivePermissionMap = Record<PermissionKey, boolean>;

export interface AppPermissionContext {
  userId: string;
  username: string;
  name: string;
  role: KnownAppRole;
  permissions: EffectivePermissionMap;
  matrixComplete: boolean;
  activePermissionCount: number;
}

const ACTIVE_ROLES = new Set<string>(ACTIVE_APP_ROLES);
const ADMIN_ONLY_KEYS = new Set<string>(ADMIN_ONLY_PERMISSION_KEYS);

/** Returns true only when every requested permission is explicitly granted. */
export function arePermissionsGranted(
  permissions: Partial<Record<PermissionKey, boolean>> | null | undefined,
  requiredKeys: readonly PermissionKey[],
): boolean {
  if (!permissions || requiredKeys.length === 0) return false;
  const knownKeys = new Set<string>(PERMISSION_CATALOG.map((item) => item.key));
  if (requiredKeys.some((key) => !knownKeys.has(key))) return false;
  return requiredKeys.every((key) => permissions[key] === true);
}

/** Pure environment guard, kept separate so it can be tested without Vite globals. */
export function resolvePermissionEnforcementEnabled(
  requestedMode: string | undefined,
  isDev: boolean,
  supabaseUrl: string | undefined,
): boolean {
  if ((requestedMode ?? "").trim().toLowerCase() !== "live") return false;

  try {
    const hostname = new URL(supabaseUrl ?? "").hostname.toLowerCase();
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    // Development mode may enable real enforcement only against local Supabase.
    if (isDev) return localHosts.has(hostname);
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: resposta inválida.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label}: valor inválido.`);
  }
  return value;
}

/** Fail-closed parser for public.get_my_app_context(). */
export function parseAppPermissionContext(
  value: unknown,
  expectedUserId: string,
): AppPermissionContext {
  if (!expectedUserId) throw new Error("PERMISSION_CONTEXT_EXPECTED_USER_REQUIRED");

  const root = asRecord(value, "Contexto de permissões");
  const user = asRecord(root.user, "Usuário do contexto");
  const rawPermissions = asRecord(root.permissions, "Permissões efetivas");
  const userId = requiredString(user.id, "ID do usuário");
  if (userId !== expectedUserId) throw new Error("PERMISSION_CONTEXT_USER_MISMATCH");

  const roleText = requiredString(user.role, "Perfil").trim().toLowerCase();
  if (!ACTIVE_ROLES.has(roleText)) {
    throw new Error("PERMISSION_CONTEXT_UNKNOWN_ROLE");
  }

  if (root.matrix_complete !== true) throw new Error("PERMISSION_CONTEXT_MATRIX_INCOMPLETE");
  if (root.active_permission_count !== PERMISSION_CATALOG.length) {
    throw new Error("PERMISSION_CONTEXT_CATALOG_COUNT_MISMATCH");
  }

  const permissions = {} as EffectivePermissionMap;
  for (const definition of PERMISSION_CATALOG) {
    const allowed = rawPermissions[definition.key];
    if (typeof allowed !== "boolean") {
      throw new Error(`PERMISSION_CONTEXT_KEY_MISSING:${definition.key}`);
    }
    // Leadership and other non-admin roles may receive explicitly configured
    // delegable grants. Admin-only permissions remain impossible to grant here.
    if (roleText !== "administrador" && ADMIN_ONLY_KEYS.has(definition.key) && allowed) {
      throw new Error("PERMISSION_CONTEXT_ADMIN_ONLY_GRANT");
    }
    permissions[definition.key] = allowed;
  }

  return {
    userId,
    username: requiredString(user.username, "Login"),
    name: typeof user.name === "string" ? user.name : "",
    role: roleText as KnownAppRole,
    permissions,
    matrixComplete: true,
    activePermissionCount: PERMISSION_CATALOG.length,
  };
}
