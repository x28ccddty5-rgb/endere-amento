import { supabase } from "./supabase";
import {
  parsePermissionAdminMatrix,
  type ConfigurableRole,
  type PermissionAdminMatrix,
  type RolePermissionChange,
  type UserPermissionChange,
  resolvePermissionAdminMode,
} from "./permissionAdminModel.ts";

export async function loadPermissionAdminMatrix(): Promise<PermissionAdminMatrix> {
  const { data, error } = await supabase.rpc("get_permission_admin_matrix");
  if (error) {
    throw new Error("Não foi possível carregar a matriz de permissões. Nenhuma alteração foi aplicada.");
  }
  return parsePermissionAdminMatrix(data);
}

export async function saveRolePermissionChanges(
  role: ConfigurableRole,
  changes: readonly RolePermissionChange[],
): Promise<void> {
  if (changes.length === 0) return;
  const { data, error } = await supabase.rpc("save_role_permission_changes", {
    p_target_role: role,
    p_changes: changes,
  });
  if (error || !data || typeof data !== "object" || (data as { ok?: unknown }).ok !== true) {
    throw new Error("Não foi possível salvar as permissões do perfil. Nenhuma confirmação de gravação foi recebida.");
  }
}

export async function saveUserPermissionOverrides(
  userId: string,
  changes: readonly UserPermissionChange[],
): Promise<void> {
  if (!userId) throw new Error("Selecione um usuário válido.");
  if (changes.length === 0) return;
  const { data, error } = await supabase.rpc("save_user_permission_overrides", {
    p_target_user_id: userId,
    p_changes: changes,
  });
  if (error || !data || typeof data !== "object" || (data as { ok?: unknown }).ok !== true) {
    throw new Error("Não foi possível salvar as exceções individuais. Nenhuma confirmação de gravação foi recebida.");
  }
}

export type PermissionAdminMode = "preview" | "live" | "off";

/**
 * Localhost defaults to a non-writing preview. Even an accidental `live` flag
 * cannot call a remote Supabase project from Vite dev; live mode is allowed in
 * dev only when the configured API is local. Production stays off unless
 * explicitly enabled during the coordinated release.
 */
export function getPermissionAdminMode(): PermissionAdminMode {
  const requestedMode = (import.meta.env.VITE_PERMISSION_ADMIN_MODE ?? "").trim().toLowerCase();
  if (!import.meta.env.DEV) return requestedMode === "live" ? "live" : "off";
  if (requestedMode !== "live") return "preview";

  try {
    const host = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.toLowerCase();
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    return localHosts.has(host) ? "live" : "preview";
  } catch {
    return "preview";
  }
}
