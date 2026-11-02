import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CircleHelp,
  Info,
  LoaderCircle,
  LockKeyhole,
  Save,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import {
  PERMISSION_CATALOG,
  normalizeKnownAppRole,
  type PermissionKey,
  type PermissionOverride,
} from "../constants/permissionCatalog.ts";
import type { AppUser } from "./AdminUsersManagement.tsx";
import {
  applyRoleChanges,
  applyUserOverrideChanges,
  buildRolePermissionChanges,
  buildUserPermissionChanges,
  createPreviewPermissionMatrix,
  isConfigurableRole,
  type ConfigurableRole,
  type PermissionAdminMatrix,
  type PermissionValueMap,
} from "../lib/permissionAdminModel.ts";
import {
  loadPermissionAdminMatrix,
  saveRolePermissionChanges,
  saveUserPermissionOverrides,
  type PermissionAdminMode,
} from "../lib/permissionAdminService.ts";

const ROLE_OPTIONS: Array<{ value: ConfigurableRole; label: string; description: string }> = [
  { value: "apoio", label: "Apoio", description: "Equipe de estoque e operação" },
  { value: "producao", label: "Produção", description: "Consulta de SKU/endereço e Consultor IA" },
  { value: "visualizador", label: "Visualizador", description: "Consulta ampla, sem executar operações" },
  { value: "lideranca", label: "Liderança", description: "Perfil configurável; Pesquisa de Estoque liberada por padrão, demais permissões sob gestão do Administrador" },
];

const PERMISSION_GROUP_ORDER = [
  "Dashboard",
  "Pesquisa de estoque",
  "Lançamentos",
  "Histórico",
  "Divergências",
  "Produtos e SKUs",
  "Mapa do estoque",
  "Estrutura do estoque",
  "Consultor IA",
  "Exportações",
  "Base de dados",
  "Usuários e permissões",
  "Configurações",
];

function normalizeUserRole(user: AppUser) {
  return normalizeKnownAppRole(user.role);
}

function isEligibleOverrideUser(user: AppUser): boolean {
  const role = normalizeUserRole(user);
  return Boolean(user.id && role && isConfigurableRole(role));
}

function roleLabel(role: ConfigurableRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

interface PermissionManagementPanelProps {
  users: AppUser[];
  mode: PermissionAdminMode;
}

export const PermissionManagementPanel: React.FC<PermissionManagementPanelProps> = ({ users, mode }) => {
  const [matrix, setMatrix] = useState<PermissionAdminMatrix | null>(() =>
    mode === "preview" ? createPreviewPermissionMatrix() : null,
  );
  const [loading, setLoading] = useState(mode === "live");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState<ConfigurableRole>("apoio");
  const [editorMode, setEditorMode] = useState<"role" | "user">("role");
  const [roleDraft, setRoleDraft] = useState<PermissionValueMap | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [overrideDraft, setOverrideDraft] = useState<Partial<Record<PermissionKey, PermissionOverride>>>({});

  useEffect(() => {
    if (mode === "preview") {
      setMatrix(createPreviewPermissionMatrix());
      setLoading(false);
      setLoadError(null);
      return;
    }
    if (mode !== "live") return;

    let active = true;
    setLoading(true);
    setLoadError(null);
    loadPermissionAdminMatrix()
      .then((loaded) => {
        if (active) setMatrix(loaded);
      })
      .catch((error: unknown) => {
        if (active) {
          setMatrix(null);
          setLoadError(errorMessage(error));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [mode]);

  useEffect(() => {
    if (!matrix) {
      setRoleDraft(null);
      return;
    }
    setRoleDraft({ ...matrix.rolePermissions[selectedRole] });
  }, [matrix, selectedRole]);

  const eligibleUsers = useMemo(
    () => users.filter(isEligibleOverrideUser).sort((a, b) => a.username.localeCompare(b.username, "pt-BR")),
    [users],
  );

  useEffect(() => {
    if (!eligibleUsers.length) {
      setSelectedUserId("");
      setOverrideDraft({});
      return;
    }
    if (!eligibleUsers.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(eligibleUsers[0].id ?? "");
    }
  }, [eligibleUsers, selectedUserId]);

  useEffect(() => {
    if (!matrix || !selectedUserId) {
      setOverrideDraft({});
      return;
    }
    const existing = matrix.userOverrides[selectedUserId] ?? {};
    const draft: Partial<Record<PermissionKey, PermissionOverride>> = {};
    for (const definition of PERMISSION_CATALOG) {
      draft[definition.key] = definition.userOverrideAllowed
        ? existing[definition.key] ?? "inherit"
        : "inherit";
    }
    setOverrideDraft(draft);
  }, [matrix, selectedUserId]);

  const filteredCatalog = useMemo(() => {
    const value = search.trim().toLocaleLowerCase("pt-BR");
    const visibleCatalog = PERMISSION_CATALOG.filter((permission) => !("isDeprecated" in permission && permission.isDeprecated));
    if (!value) return visibleCatalog;
    return visibleCatalog.filter((permission) =>
      `${permission.group} ${permission.label} ${permission.description}`.toLocaleLowerCase("pt-BR").includes(value),
    );
  }, [search]);

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, typeof PERMISSION_CATALOG[number][]>();
    for (const group of PERMISSION_GROUP_ORDER) {
      const entries = filteredCatalog.filter((permission) => permission.group === group);
      if (entries.length) groups.set(group, entries);
    }
    for (const permission of filteredCatalog) {
      if (!groups.has(permission.group)) groups.set(permission.group, []);
      if (!PERMISSION_GROUP_ORDER.includes(permission.group)) groups.get(permission.group)!.push(permission);
    }
    return [...groups.entries()];
  }, [filteredCatalog]);

  const roleChanges = useMemo(() => {
    if (!matrix || !roleDraft) return [];
    try {
      return buildRolePermissionChanges(selectedRole, matrix.rolePermissions[selectedRole], roleDraft);
    } catch {
      return [];
    }
  }, [matrix, roleDraft, selectedRole]);

  const selectedUser = eligibleUsers.find((user) => user.id === selectedUserId) ?? null;
  const selectedUserRole = selectedUser ? normalizeUserRole(selectedUser) : null;
  const userChanges = useMemo(() => {
    if (!matrix || !selectedUserId) return [];
    try {
      return buildUserPermissionChanges(matrix.userOverrides[selectedUserId] ?? {}, overrideDraft);
    } catch {
      return [];
    }
  }, [matrix, overrideDraft, selectedUserId]);

  const selectEditorMode = (nextMode: "role" | "user") => {
    const dirty = editorMode === "role" ? roleChanges.length > 0 : userChanges.length > 0;
    if (dirty && !window.confirm("Há alterações não salvas nesta seção. Descartar essas alterações?")) return;
    if (dirty && matrix) {
      if (editorMode === "role") {
        setRoleDraft({ ...matrix.rolePermissions[selectedRole] });
      } else if (selectedUserId) {
        const existing = matrix.userOverrides[selectedUserId] ?? {};
        const draft: Partial<Record<PermissionKey, PermissionOverride>> = {};
        for (const definition of PERMISSION_CATALOG) {
          draft[definition.key] = definition.userOverrideAllowed
            ? existing[definition.key] ?? "inherit"
            : "inherit";
        }
        setOverrideDraft(draft);
      }
    }
    setMessage(null);
    setSearch("");
    setEditorMode(nextMode);
  };

  const selectRole = (nextRole: ConfigurableRole) => {
    if (roleChanges.length > 0 && !window.confirm("Há alterações de perfil não salvas. Descartar essas alterações?")) return;
    setMessage(null);
    setSelectedRole(nextRole);
  };

  const selectUser = (nextUserId: string) => {
    if (userChanges.length > 0 && !window.confirm("Há exceções individuais não salvas. Descartar essas alterações?")) return;
    setMessage(null);
    setSelectedUserId(nextUserId);
  };

  const saveRole = async () => {
    if (!matrix || !roleDraft || roleChanges.length === 0 || saving) return;
    setSaving(true);
    setMessage(null);
    setLoadError(null);
    try {
      if (mode === "preview") {
        setMatrix(applyRoleChanges(matrix, selectedRole, roleDraft));
        setMessage(`Prévia atualizada para ${roleLabel(selectedRole)}. Nada foi gravado no banco.`);
      } else {
        await saveRolePermissionChanges(selectedRole, roleChanges);
        setMatrix(applyRoleChanges(matrix, selectedRole, roleDraft));
        setMessage(`${roleChanges.length} permissão(ões) de ${roleLabel(selectedRole)} salva(s) e auditada(s).`);
      }
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveUserOverrides = async () => {
    if (!matrix || !selectedUserId || userChanges.length === 0 || saving) return;
    setSaving(true);
    setMessage(null);
    setLoadError(null);
    try {
      if (mode === "preview") {
        setMatrix(applyUserOverrideChanges(matrix, selectedUserId, userChanges));
        setMessage("Prévia individual atualizada nesta sessão. Nada foi gravado no banco.");
      } else {
        await saveUserPermissionOverrides(selectedUserId, userChanges);
        setMatrix(applyUserOverrideChanges(matrix, selectedUserId, userChanges));
        setMessage(`${userChanges.length} exceção(ões) individual(is) salva(s) e auditada(s).`);
      }
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const refreshLiveMatrix = async () => {
    if (mode !== "live" || loading || saving) return;
    setLoading(true);
    setLoadError(null);
    setMessage(null);
    try {
      const loaded = await loadPermissionAdminMatrix();
      setMatrix(loaded);
    } catch (error) {
      setLoadError(errorMessage(error));
      setMatrix(null);
    } finally {
      setLoading(false);
    }
  };

  const matrixReady = Boolean(matrix && matrix.matrixStatus.complete);

  return (
    <section className="space-y-5 font-sans">
      {mode === "preview" && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <Info className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-bold">Prévia local — sem gravação</p>
            <p className="mt-1 text-xs leading-relaxed">
              A matriz exibida usa os valores-base do catálogo do código. Nenhuma RPC de permissões é chamada e os botões de salvar alteram somente esta sessão. O modo real fica bloqueado no localhost enquanto a URL do Supabase for remota.
            </p>
          </div>
        </div>
      )}

      {mode === "live" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-bold">Matriz do banco</p>
              <p className="mt-1 text-xs">A gravação é feita pelas RPCs administrativas e validada novamente no backend.</p>
            </div>
          </div>
          <button type="button" onClick={refreshLiveMatrix} disabled={loading || saving} className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-bold hover:bg-blue-100 disabled:opacity-50">
            Atualizar matriz
          </button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}
      {message && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
          <LoaderCircle className="h-5 w-5 animate-spin" /> Carregando a matriz uma única vez...
        </div>
      ) : !matrixReady ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-bold text-slate-800">Matriz indisponível ou incompleta</p>
              <p className="mt-1 text-xs leading-relaxed">A administração permanece bloqueada. Não será exibida uma matriz parcial como se estivesse válida.</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Permissões configuráveis</h3>
            <p className="mt-1 text-sm text-slate-500">29 ações do catálogo · 5 perfis-base · exceções individuais auditadas</p>
          </div>

          <PermissionEditorBody
            matrix={matrix}
            editorMode={editorMode}
            onSelectEditorMode={selectEditorMode}
            roleDraft={roleDraft}
            setRoleDraft={setRoleDraft}
            overrideDraft={overrideDraft}
            setOverrideDraft={setOverrideDraft}
            selectedRole={selectedRole}
            selectedUser={selectedUser}
            selectedUserId={selectedUserId}
            selectedUserRole={selectedUserRole && isConfigurableRole(selectedUserRole) ? selectedUserRole : null}
            eligibleUsers={eligibleUsers}
            groupedPermissions={groupedPermissions}
            search={search}
            setSearch={setSearch}
            saving={saving}
            roleChangesCount={roleChanges.length}
            userChangesCount={userChanges.length}
            onSelectRole={selectRole}
            onSelectUser={selectUser}
            onSaveRole={saveRole}
            onSaveUserOverrides={saveUserOverrides}
          />
        </>
      )}
    </section>
  );
};

interface PermissionEditorBodyProps {
  matrix: PermissionAdminMatrix;
  editorMode: "role" | "user";
  onSelectEditorMode: (mode: "role" | "user") => void;
  roleDraft: PermissionValueMap | null;
  setRoleDraft: React.Dispatch<React.SetStateAction<PermissionValueMap | null>>;
  overrideDraft: Partial<Record<PermissionKey, PermissionOverride>>;
  setOverrideDraft: React.Dispatch<React.SetStateAction<Partial<Record<PermissionKey, PermissionOverride>>>>;
  selectedRole: ConfigurableRole;
  selectedUser: AppUser | null;
  selectedUserId: string;
  selectedUserRole: ConfigurableRole | null;
  eligibleUsers: AppUser[];
  groupedPermissions: Array<[string, typeof PERMISSION_CATALOG[number][]]>;
  search: string;
  setSearch: (value: string) => void;
  saving: boolean;
  roleChangesCount: number;
  userChangesCount: number;
  onSelectRole: (role: ConfigurableRole) => void;
  onSelectUser: (id: string) => void;
  onSaveRole: () => Promise<void>;
  onSaveUserOverrides: () => Promise<void>;
}

const PermissionEditorBody: React.FC<PermissionEditorBodyProps> = ({
  matrix,
  editorMode,
  onSelectEditorMode,
  roleDraft,
  setRoleDraft,
  overrideDraft,
  setOverrideDraft,
  selectedRole,
  selectedUser,
  selectedUserId,
  selectedUserRole,
  eligibleUsers,
  groupedPermissions,
  search,
  setSearch,
  saving,
  roleChangesCount,
  userChangesCount,
  onSelectRole,
  onSelectUser,
  onSaveRole,
  onSaveUserOverrides,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onSelectEditorMode("role")} className={`rounded-full border px-4 py-2 text-xs font-bold ${editorMode === "role" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
          Permissões por perfil
        </button>
        <button type="button" onClick={() => onSelectEditorMode("user")} className={`rounded-full border px-4 py-2 text-xs font-bold ${editorMode === "user" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
          Exceções por usuário
        </button>
        <div className="min-w-48 flex-1">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar módulo ou permissão..." className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" aria-label="Buscar permissões" />
        </div>
      </div>

      {editorMode === "role" ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {ROLE_OPTIONS.map((option) => (
              <button key={option.value} type="button" onClick={() => onSelectRole(option.value)} className={`rounded-xl border p-3 text-left transition ${selectedRole === option.value ? "border-blue-300 bg-blue-50 ring-1 ring-blue-200" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                <span className="block text-sm font-bold text-slate-900">{option.label}</span>
                <span className="mt-1 block text-xs text-slate-500">{option.description}</span>
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-slate-900">Perfil: {roleLabel(selectedRole)}</p>
                <p className="mt-0.5 text-xs text-slate-500">O Administrador mantém acesso total e não pode ser editado aqui.</p>
              </div>
              <button type="button" onClick={onSaveRole} disabled={saving || roleChangesCount === 0 || !roleDraft} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar {roleChangesCount ? `(${roleChangesCount})` : "alterações"}
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {groupedPermissions.map(([group, items]) => (
                <div key={group}>
                  <h4 className="bg-slate-50/70 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500">{group}</h4>
                  {items.map((permission) => {
                    const allowed = roleDraft?.[permission.key] ?? false;
                    const locked = !permission.userOverrideAllowed;
                    return (
                      <label key={permission.key} className={`flex items-start justify-between gap-4 px-4 py-3 ${locked ? "bg-slate-50/50" : "hover:bg-slate-50"}`}>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                            {permission.label}
                            {locked && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500"><LockKeyhole className="h-3 w-3" /> Exclusiva do Administrador</span>}
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-slate-500">{permission.description}</span>
                          <span className="mt-1 block font-mono text-[10px] text-slate-400">{permission.key}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 pt-1">
                          <span className={`text-[10px] font-bold ${allowed ? "text-emerald-700" : "text-slate-400"}`}>{allowed ? "Permitido" : "Negado"}</span>
                          <input type="checkbox" checked={allowed} disabled={saving || locked || !roleDraft} onChange={(event) => setRoleDraft((previous) => previous ? { ...previous, [permission.key]: event.target.checked } : previous)} className="h-4 w-4 rounded border-slate-300 accent-blue-600 disabled:cursor-not-allowed" aria-label={`${permission.label}: ${allowed ? "permitido" : "negado"}`} />
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
              <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />
              <span>As alterações valem para o perfil-base. Exceções individuais continuam prevalecendo, exceto para permissões exclusivas do Administrador.</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-end">
              <div>
                <label htmlFor="permission-user-select" className="mb-1.5 block text-xs font-bold text-slate-700">Usuário</label>
                <select id="permission-user-select" value={selectedUserId} onChange={(event) => onSelectUser(event.target.value)} disabled={!eligibleUsers.length || saving} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400">
                  {eligibleUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.username} · {user.role}</option>)}
                </select>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                {selectedUser ? (
                  <><span className="font-bold text-slate-900">{selectedUser.name}</span><span className="mx-2 text-slate-300">|</span>Perfil-base: <strong>{selectedUser.role}</strong><p className="mt-1">Herdar aplica o perfil-base; Permitir/Negar cria uma exceção individual. Apenas o Administrador pode alterar esta configuração.</p></>
                ) : "Não há usuários elegíveis para receber exceções individuais."}
              </div>
            </div>
          </div>

          {selectedUser && selectedUserRole ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">Exceções de {selectedUser.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">O acesso final combina perfil-base e decisão individual.</p>
                </div>
                <button type="button" onClick={onSaveUserOverrides} disabled={saving || userChangesCount === 0} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar {userChangesCount ? `(${userChangesCount})` : "alterações"}
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {groupedPermissions.map(([group, items]) => (
                  <div key={group}>
                    <h4 className="bg-slate-50/70 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500">{group}</h4>
                    {items.map((permission) => {
                      const decision = overrideDraft[permission.key] ?? "inherit";
                      const locked = !permission.userOverrideAllowed;
                      const originalDecision = matrix.userOverrides[selectedUserId]?.[permission.key] ?? "inherit";
                      const isPending = decision !== originalDecision;
                      const draftEffective = locked ? false : decision === "allow" ? true : decision === "deny" ? false : matrix.rolePermissions[selectedUserRole][permission.key];
                      return (
                        <div key={permission.key} className={`grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_210px] md:items-center ${locked ? "bg-slate-50/50" : "hover:bg-slate-50"}`}>
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">{permission.label}{locked && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500"><LockKeyhole className="h-3 w-3" /> Não delegável</span>}</p>
                            <p className="mt-1 text-xs leading-relaxed text-slate-500">{permission.description}</p>
                            <p className="mt-1 text-[10px] text-slate-400">Perfil-base: {matrix.rolePermissions[selectedUserRole][permission.key] ? "Permitido" : "Negado"} · Acesso no rascunho: <span className={draftEffective ? "font-bold text-emerald-700" : "font-bold text-slate-500"}>{draftEffective ? "Permitido" : "Negado"}</span>{isPending ? " · alteração pendente" : ""}</p>
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Decisão individual</label>
                            <select value={decision} disabled={saving || locked} onChange={(event) => setOverrideDraft((previous) => ({ ...previous, [permission.key]: event.target.value as PermissionOverride }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100">
                              <option value="inherit">Herdar do perfil</option>
                              <option value="allow">Permitir individualmente</option>
                              <option value="deny">Negar individualmente</option>
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="flex items-start gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Permissões administrativas críticas e operações não delegáveis não podem ser liberadas individualmente, mesmo pelo Administrador.</span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nenhum usuário de Apoio, Produção, Visualizador ou Liderança com identificador válido está disponível para configurar.</div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <span>Perfis editáveis: {ROLE_OPTIONS.map((option) => option.label).join(", ")}. Administrador mantém acesso total; após o corte da Fase C, Liderança recebe Pesquisa de Estoque como acesso-base e pode ter outras permissões configuradas pelo Administrador.</span>
        <span className="inline-flex items-center gap-1"><LockKeyhole className="h-3.5 w-3.5" /> {PERMISSION_CATALOG.filter((item) => !item.userOverrideAllowed).length} permissões administrativas não delegáveis</span>
      </div>
    </div>
  );
};
