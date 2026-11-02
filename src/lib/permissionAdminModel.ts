import {
  ACTIVE_APP_ROLES,
  PERMISSION_CATALOG,
  type ActiveAppRole,
  type PermissionKey,
  type PermissionOverride,
} from "../constants/permissionCatalog.ts";

export type ConfigurableRole = Exclude<ActiveAppRole, "administrador">;
export type PermissionAdminMode = "preview" | "live" | "off";

/** Resolve UI mode without consulting browser globals; safe to unit-test. */
export function resolvePermissionAdminMode(
  requestedMode: string | undefined,
  isDev: boolean,
  supabaseUrl: string | undefined,
): PermissionAdminMode {
  const requested = (requestedMode ?? "").trim().toLowerCase();
  if (requested === "off") return "off";
  if (!isDev) return requested === "live" ? "live" : "off";
  if (requested !== "live") return "preview";

  try {
    const hostname = new URL(supabaseUrl ?? "").hostname.toLowerCase();
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    return localHosts.has(hostname) ? "live" : "preview";
  } catch {
    return "preview";
  }
}

export type StoredUserOverride = Exclude<PermissionOverride, "inherit">;
export type PermissionCatalogItem = (typeof PERMISSION_CATALOG)[number];
export type PermissionValueMap = Record<PermissionKey, boolean>;
export type RolePermissionMap = Record<ActiveAppRole, PermissionValueMap>;
export type UserOverrideMap = Record<string, Partial<Record<PermissionKey, StoredUserOverride>>>;

export interface PermissionAdminMatrix {
  catalog: readonly PermissionCatalogItem[];
  rolePermissions: RolePermissionMap;
  userOverrides: UserOverrideMap;
  matrixStatus: {
    activePermissions: number;
    expectedRolePermissionRows: number;
    actualRolePermissionRows: number;
    complete: boolean;
  };
}

export interface RolePermissionChange {
  permission_key: PermissionKey;
  allowed: boolean;
}

export interface UserPermissionChange {
  permission_key: PermissionKey;
  decision: PermissionOverride;
}

const CONFIGURABLE_ROLES: readonly ConfigurableRole[] = ["apoio", "producao", "visualizador", "lideranca"];
const KNOWN_ROLES = new Set<string>(ACTIVE_APP_ROLES);
const KNOWN_KEYS = new Set<string>(PERMISSION_CATALOG.map((item) => item.key));
const EXPECTED_PERMISSION_COUNT = PERMISSION_CATALOG.length;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: formato inválido.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}: lista inválida.`);
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}: valor booleano inválido.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}: texto inválido.`);
  return value;
}

export function createPreviewPermissionMatrix(): PermissionAdminMatrix {
  const rolePermissions = {} as RolePermissionMap;
  for (const role of ACTIVE_APP_ROLES) {
    const values = {} as PermissionValueMap;
    for (const item of PERMISSION_CATALOG) values[item.key] = item.defaults[role];
    rolePermissions[role] = values;
  }

  return {
    catalog: PERMISSION_CATALOG,
    rolePermissions,
    userOverrides: {},
    matrixStatus: {
      activePermissions: EXPECTED_PERMISSION_COUNT,
      expectedRolePermissionRows: EXPECTED_PERMISSION_COUNT * ACTIVE_APP_ROLES.length,
      actualRolePermissionRows: EXPECTED_PERMISSION_COUNT * ACTIVE_APP_ROLES.length,
      complete: true,
    },
  };
}

/**
 * Validates the JSON returned by get_permission_admin_matrix. A partial or
 * mismatched response is rejected rather than displayed as if it were secure.
 */
export function parsePermissionAdminMatrix(value: unknown): PermissionAdminMatrix {
  const root = asRecord(value, "Matriz de permissões");
  const rawCatalog = requireArray(root.catalog, "Catálogo");
  const rawRolePermissions = requireArray(root.role_permissions, "Permissões por perfil");
  const rawOverrides = requireArray(root.user_overrides, "Exceções individuais");
  const status = asRecord(root.matrix_status, "Estado da matriz");

  if (rawCatalog.length !== EXPECTED_PERMISSION_COUNT) {
    throw new Error("CATALOG_COUNT_MISMATCH");
  }

  const serverCatalogByKey = new Map<string, Record<string, unknown>>();
  for (const rowValue of rawCatalog) {
    const row = asRecord(rowValue, "Item do catálogo");
    const key = requireString(row.permission_key, "Chave de permissão");
    if (serverCatalogByKey.has(key)) throw new Error("CATALOG_DUPLICATE_KEY");
    serverCatalogByKey.set(key, row);
  }

  if (serverCatalogByKey.size !== KNOWN_KEYS.size || [...KNOWN_KEYS].some((key) => !serverCatalogByKey.has(key))) {
    throw new Error("CATALOG_KEY_MISMATCH");
  }

  for (const [index, definition] of PERMISSION_CATALOG.entries()) {
    const row = serverCatalogByKey.get(definition.key)!;
    // Descriptions are explanatory copy, not authorization metadata. They can
    // be aligned in a later database release without invalidating the matrix.
    // Keep the structural and delegation metadata strict because those fields
    // affect how the administrator may configure permissions.
    if (
      row.module_name !== definition.group ||
      row.label !== definition.label ||
      typeof row.description !== "string" ||
      !row.description.trim() ||
      row.user_override_allowed !== definition.userOverrideAllowed ||
      row.is_admin_only !== !definition.userOverrideAllowed ||
      row.sort_order !== index + 1
    ) {
      throw new Error(`CATALOG_METADATA_MISMATCH:${definition.key}`);
    }
  }

  const rawStatusCount = status.active_permissions;
  const rawExpectedRows = status.expected_role_permission_rows;
  const rawActualRows = status.actual_role_permission_rows;
  const statusComplete = status.complete === true;
  if (
    rawStatusCount !== EXPECTED_PERMISSION_COUNT ||
    rawExpectedRows !== EXPECTED_PERMISSION_COUNT * ACTIVE_APP_ROLES.length ||
    rawActualRows !== EXPECTED_PERMISSION_COUNT * ACTIVE_APP_ROLES.length ||
    !statusComplete
  ) {
    throw new Error("PERMISSION_MATRIX_INCOMPLETE");
  }

  if (rawRolePermissions.length !== rawExpectedRows) throw new Error("ROLE_PERMISSION_ROW_COUNT_MISMATCH");
  const rolePermissions = {} as RolePermissionMap;
  const seenRoleKeys = new Set<string>();
  for (const role of ACTIVE_APP_ROLES) rolePermissions[role] = {} as PermissionValueMap;

  for (const rowValue of rawRolePermissions) {
    const row = asRecord(rowValue, "Permissão por perfil");
    const role = requireString(row.role, "Perfil");
    const key = requireString(row.permission_key, "Chave de permissão");
    if (!KNOWN_ROLES.has(role)) throw new Error(`ROLE_UNKNOWN:${role}`);
    if (!KNOWN_KEYS.has(key)) throw new Error(`PERMISSION_UNKNOWN:${key}`);
    const compoundKey = `${role}\u0000${key}`;
    if (seenRoleKeys.has(compoundKey)) throw new Error("ROLE_PERMISSION_DUPLICATE");
    seenRoleKeys.add(compoundKey);
    const allowed = requireBoolean(row.allowed, `Permissão ${role}/${key}`);
    rolePermissions[role as ActiveAppRole][key as PermissionKey] = allowed;
  }

  for (const role of ACTIVE_APP_ROLES) {
    for (const definition of PERMISSION_CATALOG) {
      if (typeof rolePermissions[role][definition.key] !== "boolean") {
        throw new Error(`ROLE_PERMISSION_MISSING:${role}/${definition.key}`);
      }
      if (role !== "administrador" && !definition.userOverrideAllowed && rolePermissions[role][definition.key]) {
        throw new Error(`ADMIN_ONLY_GRANT_IN_MATRIX:${role}/${definition.key}`);
      }
    }
  }

  const userOverrides: UserOverrideMap = {};
  const seenUserKeys = new Set<string>();
  for (const rowValue of rawOverrides) {
    const row = asRecord(rowValue, "Exceção individual");
    const userId = requireString(row.user_id, "ID do usuário");
    const role = requireString(row.role, "Perfil do usuário");
    const key = requireString(row.permission_key, "Chave de permissão");
    const decision = requireString(row.decision, "Decisão da exceção");
    if (!CONFIGURABLE_ROLES.includes(role as ConfigurableRole)) throw new Error(`USER_OVERRIDE_ROLE_NOT_ALLOWED:${role}`);
    if (!KNOWN_KEYS.has(key)) throw new Error(`USER_OVERRIDE_PERMISSION_UNKNOWN:${key}`);
    const definition = PERMISSION_CATALOG.find((item) => item.key === key)!;
    if (!definition.userOverrideAllowed || !["allow", "deny"].includes(decision)) {
      throw new Error(`USER_OVERRIDE_NOT_DELEGABLE:${key}`);
    }
    const compoundKey = `${userId}\u0000${key}`;
    if (seenUserKeys.has(compoundKey)) throw new Error("USER_OVERRIDE_DUPLICATE");
    seenUserKeys.add(compoundKey);
    (userOverrides[userId] ??= {})[key as PermissionKey] = decision as StoredUserOverride;
  }

  return {
    catalog: PERMISSION_CATALOG,
    rolePermissions,
    userOverrides,
    matrixStatus: {
      activePermissions: rawStatusCount as number,
      expectedRolePermissionRows: rawExpectedRows as number,
      actualRolePermissionRows: rawActualRows as number,
      complete: statusComplete,
    },
  };
}

export function buildRolePermissionChanges(
  role: ConfigurableRole,
  current: PermissionValueMap,
  draft: PermissionValueMap,
): RolePermissionChange[] {
  if (!CONFIGURABLE_ROLES.includes(role)) throw new Error("PERMISSION_TARGET_ROLE_NOT_CONFIGURABLE");
  const changes: RolePermissionChange[] = [];
  for (const definition of PERMISSION_CATALOG) {
    const before = current[definition.key];
    const after = draft[definition.key];
    if (typeof before !== "boolean" || typeof after !== "boolean") throw new Error("PERMISSION_DRAFT_INCOMPLETE");
    if (before === after) continue;
    if (!definition.userOverrideAllowed && after) throw new Error(`ADMIN_ONLY_PERMISSION_CANNOT_BE_GRANTED:${definition.key}`);
    changes.push({ permission_key: definition.key, allowed: after });
  }
  return changes;
}

export function buildUserPermissionChanges(
  current: Partial<Record<PermissionKey, StoredUserOverride>>,
  draft: Partial<Record<PermissionKey, PermissionOverride>>,
): UserPermissionChange[] {
  const changes: UserPermissionChange[] = [];
  for (const definition of PERMISSION_CATALOG) {
    const before = current[definition.key] ?? "inherit";
    const after = draft[definition.key] ?? "inherit";
    if (before === after) continue;
    if (!definition.userOverrideAllowed) throw new Error(`USER_OVERRIDE_NOT_DELEGABLE:${definition.key}`);
    changes.push({ permission_key: definition.key, decision: after });
  }
  return changes;
}

export function applyRoleChanges(
  matrix: PermissionAdminMatrix,
  role: ConfigurableRole,
  draft: PermissionValueMap,
): PermissionAdminMatrix {
  return {
    ...matrix,
    rolePermissions: {
      ...matrix.rolePermissions,
      [role]: { ...draft },
    },
  };
}

export function applyUserOverrideChanges(
  matrix: PermissionAdminMatrix,
  userId: string,
  changes: readonly UserPermissionChange[],
): PermissionAdminMatrix {
  const userOverrides: UserOverrideMap = {
    ...matrix.userOverrides,
    [userId]: { ...(matrix.userOverrides[userId] ?? {}) },
  };
  const target = userOverrides[userId];
  for (const change of changes) {
    if (change.decision === "inherit") delete target[change.permission_key];
    else target[change.permission_key] = change.decision;
  }
  if (Object.keys(target).length === 0) delete userOverrides[userId];
  return { ...matrix, userOverrides };
}

export function isConfigurableRole(role: string): role is ConfigurableRole {
  return CONFIGURABLE_ROLES.includes(role as ConfigurableRole);
}
