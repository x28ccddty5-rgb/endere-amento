import { supabase } from "./supabase";
import type { PermissionKey } from "../constants/permissionCatalog.ts";
import {
  parseAppPermissionContext,
  resolvePermissionEnforcementEnabled,
  type AppPermissionContext,
} from "./permissionAppContextModel.ts";

export function isAppPermissionEnforcementEnabled(): boolean {
  return resolvePermissionEnforcementEnabled(
    import.meta.env.VITE_PERMISSION_ENFORCEMENT_MODE,
    import.meta.env.DEV,
    import.meta.env.VITE_SUPABASE_URL,
  );
}

export async function loadMyAppPermissionContext(expectedUserId: string): Promise<AppPermissionContext> {
  const { data, error } = await supabase.rpc("get_my_app_context" as never, {} as never);
  if (error) throw new Error(`PERMISSION_CONTEXT_LOAD_FAILED: ${error.message}`);
  return parseAppPermissionContext(data, expectedUserId);
}

/** Rechecks the permission against PostgreSQL immediately before an export starts. */
export async function checkCurrentAppPermission(permissionKey: PermissionKey): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "has_app_permission" as never,
    { p_permission_key: permissionKey } as never,
  );
  if (error) throw new Error(`PERMISSION_CHECK_FAILED: ${error.message}`);
  if (typeof data !== "boolean") throw new Error("PERMISSION_CHECK_INVALID_RESPONSE");
  return data;
}


/** Checks several required permissions in one server round-trip. Unknown keys and
 * incomplete/error responses fail closed in the database function and here. */
export async function checkCurrentAppPermissions(permissionKeys: readonly PermissionKey[]): Promise<boolean> {
  if (permissionKeys.length < 1 || permissionKeys.length > 8) {
    throw new Error("PERMISSION_CHECK_INVALID_KEY_COUNT");
  }
  const uniqueKeys = new Set(permissionKeys);
  if (uniqueKeys.size !== permissionKeys.length) {
    throw new Error("PERMISSION_CHECK_DUPLICATE_KEYS");
  }

  const { data, error } = await supabase.rpc(
    "has_app_permissions" as never,
    { p_permission_keys: [...permissionKeys] } as never,
  );
  if (error) throw new Error(`PERMISSION_CHECK_FAILED: ${error.message}`);
  if (typeof data !== "boolean") throw new Error("PERMISSION_CHECK_INVALID_RESPONSE");
  return data;
}
