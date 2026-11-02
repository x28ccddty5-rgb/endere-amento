import {
  ADMIN_ONLY_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  getPermissionDefinition,
  normalizeKnownAppRole,
  type PermissionKey,
  type PermissionOverride,
} from "../constants/permissionCatalog.ts";

export type PermissionOverrides = Partial<Record<PermissionKey, PermissionOverride>>;

export type PermissionDecisionReason =
  | "administrator"
  | "unknown_permission"
  | "unknown_role"
  | "admin_only"
  | "override_allow"
  | "override_deny"
  | "override_not_delegable"
  | "invalid_override"
  | "role_default"
  | "dependency_denied";

export interface PermissionDecisionResult {
  allowed: boolean;
  reason: PermissionDecisionReason;
}

const adminOnly = new Set<string>(ADMIN_ONLY_PERMISSION_KEYS);
const exportableScopes = new Set<string>([
  "dashboard.view",
  "stock.search",
  "history.view",
  "divergences.view",
  "products.view",
  "map.view",
  "warehouse.layout.view",
  "database.view",
  "configuration.view",
]);

/**
 * Resolve a permission using the approved precedence model.
 * This is a pure local rule engine; it does not fetch data or replace backend checks.
 */
const permissionDependencies: Partial<Record<PermissionKey, PermissionKey[]>> = {
  "dashboard.view": ["stock.search"],
  "stock.launch.view": ["stock.search"],
  "stock.launch.create": ["stock.search", "divergences.view"],
  "stock.transfer.create": ["stock.search", "divergences.view"],
  "stock.batch.process": ["stock.search", "divergences.view"],
  "stock.physical_correction": ["stock.search", "divergences.view"],
  "divergences.view": ["stock.search"],
  "divergences.resolve": ["stock.search", "divergences.view"],
  "products.view": ["stock.search"],
  "products.create": ["stock.search"],
  "products.edit": ["stock.search"],
  "map.view": ["stock.search"],
  "map.metadata.edit": ["stock.search"],
  "warehouse.layout.view": ["stock.search"],
  "consultor.use": ["stock.search"],
};

function evaluateBasePermission(
  roleInput: string | null | undefined,
  keyInput: string,
  override?: PermissionOverride | string | null,
): PermissionDecisionResult {
  const definition = getPermissionDefinition(keyInput);
  if (!definition) return { allowed: false, reason: "unknown_permission" };

  const role = normalizeKnownAppRole(roleInput);
  if (!role) return { allowed: false, reason: "unknown_role" };

  if (role === "administrador") {
    return { allowed: true, reason: "administrator" };
  }

  if (adminOnly.has(keyInput)) {
    return { allowed: false, reason: "admin_only" };
  }

  if (override === "allow") {
    if (!definition.userOverrideAllowed) {
      return { allowed: false, reason: "override_not_delegable" };
    }
    return { allowed: true, reason: "override_allow" };
  }

  if (override === "deny") {
    if (!definition.userOverrideAllowed) {
      return { allowed: false, reason: "override_not_delegable" };
    }
    return { allowed: false, reason: "override_deny" };
  }

  if (override !== undefined && override !== null && override !== "inherit") {
    return { allowed: false, reason: "invalid_override" };
  }

  return {
    allowed: definition.defaults[role],
    reason: "role_default",
  };
}

export function evaluatePermission(
  roleInput: string | null | undefined,
  keyInput: string,
  override?: PermissionOverride | string | null,
  overrides: PermissionOverrides = {},
): PermissionDecisionResult {
  const base = evaluateBasePermission(roleInput, keyInput, override);
  if (!base.allowed) return base;

  for (const dependency of permissionDependencies[keyInput as PermissionKey] ?? []) {
    const dependencyDecision = evaluateBasePermission(
      roleInput,
      dependency,
      overrides[dependency],
    );
    if (!dependencyDecision.allowed) {
      return { allowed: false, reason: "dependency_denied" };
    }
  }

  return base;
}

export function canUsePermission(
  role: string | null | undefined,
  key: string,
  overrides: PermissionOverrides = {},
): boolean {
  return evaluatePermission(role, key, overrides[key as PermissionKey], overrides).allowed;
}

/**
 * Export is allowed only when the user has the general export grant AND the
 * specific data scope grant. It never makes another module readable by itself.
 */
export function canExportScope(
  role: string | null | undefined,
  scopeKey: string,
  overrides: PermissionOverrides = {},
): boolean {
  if (!canUsePermission(role, "reports.export", overrides)) return false;
  if (!exportableScopes.has(scopeKey) || !getPermissionDefinition(scopeKey)) return false;
  return canUsePermission(role, scopeKey, overrides);
}

export function buildEffectivePermissionMap(
  role: string | null | undefined,
  overrides: PermissionOverrides = {},
): Record<PermissionKey, boolean> {
  const result = {} as Record<PermissionKey, boolean>;
  for (const definition of PERMISSION_CATALOG) {
    result[definition.key] = canUsePermission(role, definition.key, overrides);
  }
  return result;
}
