import React, { useState, FormEvent } from "react";
import { KeyRound, UserPlus, Users, Trash2, RefreshCw, LoaderCircle } from "lucide-react";
import { PermissionManagementPanel } from "./PermissionManagementPanel.tsx";
import { getPermissionAdminMode } from "../lib/permissionAdminService.ts";

export interface AppUser {
  id?: string;
  email?: string;
  username: string;
  name: string;
  password?: string;
  role: "Administrador" | "Liderança" | "Apoio" | "Produção" | "Visualizador";
}

interface AdminUsersManagementProps {
  users: AppUser[];
  usersLoading: boolean;
  usersLoadError: string | null;
  onReloadUsers: () => void;
  currentUser: AppUser | null;
  onRegisterUser: (newUser: AppUser) => Promise<boolean>;
  onDeleteUser: (username: string) => Promise<boolean>;
}

export const AdminUsersManagement: React.FC<AdminUsersManagementProps> = ({
  users,
  usersLoading,
  usersLoadError,
  onReloadUsers,
  currentUser,
  onRegisterUser,
  onDeleteUser,
}) => {
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<AppUser["role"]>("Apoio");
  const [managementSection, setManagementSection] = useState<"users" | "permissions">("users");
  const permissionAdminMode = getPermissionAdminMode();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const email = newUserEmail.trim().toLowerCase();
    const username = newUserUsername.trim().toLowerCase();
    const name = newUserName.trim();
    const password = newUserPassword;

    if (!email || !username || !name || !password) {
      alert("Por favor, preencha todos os campos do cadastro.");
      return;
    }

    if (users.some((u) => u.username.toLowerCase() === username)) {
      alert("Este login de usuário já está cadastrado.");
      return;
    }

    const success = await onRegisterUser({
      email,
      username,
      name,
      password,
      role: newUserRole,
    });

    if (!success) return;

    setNewUserEmail("");
    setNewUserUsername("");
    setNewUserName("");
    setNewUserPassword("");
    alert(`Usuário "${name}" cadastrado com sucesso.`);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
      <div className="pb-3 border-b border-slate-100 mb-6 font-sans">
        <h3 className="text-md font-bold text-slate-800 flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-600" />
          Controle de Usuários e Permissões de Acesso
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Gerencie usuários e configure os acessos por perfil ou por exceção individual.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setManagementSection("users")}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition ${managementSection === "users" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/70"}`}
        >
          <Users className="h-4 w-4" /> Usuários
        </button>
        {permissionAdminMode !== "off" && currentUser?.role === "Administrador" && (
          <button
            type="button"
            onClick={() => setManagementSection("permissions")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition ${managementSection === "permissions" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/70"}`}
          >
            <KeyRound className="h-4 w-4" /> Permissões
          </button>
        )}
      </div>

      {managementSection === "users" ? (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <form onSubmit={handleSubmit} className="lg:col-span-1 bg-slate-50 border border-slate-200 p-5 rounded-xl space-y-4 font-sans h-fit">
          <span className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5 mb-2">
            <UserPlus className="w-4 h-4 text-blue-600 font-bold" />
            Novo Perfil Funcional
          </span>

          <div>
            <label className="text-[10px] text-slate-500 block font-bold mb-1 uppercase">E-mail de Acesso</label>
            <input
              type="email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder="Ex: usuario@portobrasil.com.br"
              required
              className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block font-bold mb-1 uppercase">Login de Usuário</label>
            <input
              type="text"
              value={newUserUsername}
              onChange={(e) => setNewUserUsername(e.target.value)}
              placeholder="Ex: math_apoio"
              required
              className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block font-bold mb-1 uppercase">Nome Completo</label>
            <input
              type="text"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              placeholder="Ex: Matheus Apoio"
              required
              className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block font-bold mb-1 uppercase">Senha Secreta</label>
            <input
              type="password"
              value={newUserPassword}
              onChange={(e) => setNewUserPassword(e.target.value)}
              placeholder="Digite a senha"
              required
              className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block font-bold mb-1 uppercase">Nível / Papel (Permissões)</label>
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as AppUser["role"])}
              className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold focus:outline-none text-slate-800"
            >
              <option value="Administrador">Administrador (Acesso total)</option>
              <option value="Liderança">Liderança (Permissões configuráveis)</option>
              <option value="Apoio">Apoio (Operação do estoque)</option>
              <option value="Produção">Produção (Apenas Consulta Ref)</option>
              <option value="Visualizador">Visualizador (Somente visualiza todas abas)</option>
            </select>
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg p-2.5 text-xs font-bold transition shadow uppercase tracking-wider cursor-pointer"
          >
            Adicionar Membro
          </button>
        </form>

        <div className="lg:col-span-3 space-y-3 font-sans">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-500 block">
              {usersLoading
                ? "Carregando usuários..."
                : usersLoadError
                  ? "Não foi possível confirmar a lista de usuários"
                  : `Usuários Cadastrados (${users.length}):`}
            </span>
            {usersLoadError && (
              <button
                type="button"
                onClick={onReloadUsers}
                disabled={usersLoading}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[9px] tracking-wider">
                    <th className="p-3.5 px-4">Usuário / Login</th>
                    <th className="p-3.5 px-4">Nome de Operação</th>
                    <th className="p-3.5 px-4">E-mail</th>
                    <th className="p-3.5 px-4 text-center">Nível Logístico</th>
                    <th className="p-3.5 px-4 text-center">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {usersLoading ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-xs text-slate-500">
                        <span className="inline-flex items-center gap-2">
                          <LoaderCircle className="h-4 w-4 animate-spin" /> Consultando usuários no ambiente conectado...
                        </span>
                      </td>
                    </tr>
                  ) : usersLoadError && users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-xs text-amber-800">
                        {usersLoadError}
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-xs text-slate-500">
                        Nenhum usuário cadastrado neste ambiente.
                      </td>
                    </tr>
                  ) : users.map((u) => (
                    <tr key={u.username} className="hover:bg-slate-50">
                      <td className="p-3 px-4 font-mono font-bold text-slate-850">{u.username}</td>
                      <td className="p-3 px-4 text-slate-600 font-bold">{u.name}</td>
                      <td className="p-3 px-4 text-slate-500">{u.email || "-"}</td>
                      <td className="p-3 px-4 text-center">
                        <span className={`text-[9px] font-black px-2 py-0.5 border rounded-full uppercase ${
                          u.role === "Administrador"
                            ? "bg-purple-50 text-purple-700 border-purple-200"
                            : u.role === "Liderança"
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : u.role === "Apoio"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : u.role === "Produção"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-slate-100 text-slate-700 border-slate-200"
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-3 px-4 text-center">
                        {u.username === "adm" ? (
                          <span className="text-[10px] italic text-slate-400 font-semibold">Sistema Protegido</span>
                        ) : u.username === currentUser?.username ? (
                          <span className="text-[10px] italic text-slate-400 font-semibold">Sua conta atual</span>
                        ) : (
                          <button
                            onClick={() => onDeleteUser(u.username)}
                            className="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-700 p-1 px-2.5 rounded transition text-[10px] font-bold border border-slate-200 hover:border-red-200 flex items-center justify-center gap-1 mx-auto cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Excluir perfil
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-3">
            {[
              { r: "Administrador", desc: "Acesso irrestrito a todos os recursos, controle avançado de rede e aprovação de divergências." },
              { r: "Liderança", desc: "Perfil configurável. Pesquisa de Estoque liberada por padrão; demais permissões continuam configuráveis pelo Administrador." },
              { r: "Apoio", desc: "Foco integral no abastecimento e baixas lógicas (Lançamento, Pesquisa, Histórico e divergência)." },
              { r: "Produção", desc: "Permissões restritas unicamente à aba de Pesquisa de Referências para suporte físico." },
              { r: "Visualizador", desc: "Visualiza de forma estática quase todas as abas. Bloqueado para alterar ou lançar qualquer dado." }
            ].map((rules) => (
              <div key={rules.r} className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg text-[10px] leading-relaxed">
                <span className="font-extrabold text-slate-800 block mb-1 underline">{rules.r}</span>
                <span className="text-slate-450 font-medium block">{rules.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      ) : (
        <PermissionManagementPanel users={users} mode={permissionAdminMode === "off" ? "preview" : permissionAdminMode} />
      )}
    </div>
  );
};
