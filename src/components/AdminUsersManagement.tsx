import React, { useState, FormEvent } from "react";
import { UserPlus, Users, Trash2, ShieldAlert } from "lucide-react";

export interface AppUser {
  username: string;
  name: string;
  password?: string;
  role: "Administrador" | "Liderança" | "Apoio" | "Produção" | "Visualizador";
}

interface AdminUsersManagementProps {
  users: AppUser[];
  currentUser: AppUser | null;
  onRegisterUser: (newUser: AppUser) => void;
  onDeleteUser: (username: string) => void;
}

export const AdminUsersManagement: React.FC<AdminUsersManagementProps> = ({
  users,
  currentUser,
  onRegisterUser,
  onDeleteUser,
}) => {
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<AppUser["role"]>("Apoio");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const username = newUserUsername.trim().toLowerCase();
    const name = newUserName.trim();
    const password = newUserPassword;

    if (!username || !name || !password) {
      alert("Por favor, preencha todos os campos do cadastro.");
      return;
    }

    if (users.some((u) => u.username.toLowerCase() === username)) {
      alert("Este login de usuário já está cadastrado.");
      return;
    }

    onRegisterUser({
      username,
      name,
      password,
      role: newUserRole,
    });

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
          Gerencie os perfis de acesso logístico (Administrador, Liderança, Apoio, Produção e Visualizador).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Register Form */}
        <form onSubmit={handleSubmit} className="lg:col-span-1 bg-slate-50 border border-slate-200 p-5 rounded-xl space-y-4 font-sans h-fit">
          <span className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5 mb-2">
            <UserPlus className="w-4 h-4 text-blue-600 font-bold" />
            Novo Perfil Funcional
          </span>

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
              onChange={(e) => setNewUserRole(e.target.value as any)}
              className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold focus:outline-none text-slate-800"
            >
              <option value="Administrador">Administrador (Total + Moderação)</option>
              <option value="Liderança">Liderança (Filtra tudo / Sem avançado)</option>
              <option value="Apoio">Apoio (Lança, pesquisa, histórico, divs)</option>
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

        {/* Users Listing */}
        <div className="lg:col-span-3 space-y-3 font-sans">
          <span className="text-xs font-bold text-slate-500 block">Usuários Cadastrados ({users.length}):</span>
          
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[9px] tracking-wider">
                    <th className="p-3.5 px-4">Usuário / Login</th>
                    <th className="p-3.5 px-4">Nome de Operação</th>
                    <th className="p-3.5 px-4 text-center">Nível Logístico</th>
                    <th className="p-3.5 px-4 text-center">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {users.map((u) => (
                    <tr key={u.username} className="hover:bg-slate-50">
                      <td className="p-3 px-4 font-mono font-bold text-slate-850">{u.username}</td>
                      <td className="p-3 px-4 text-slate-600 font-bold">{u.name}</td>
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

          {/* Description of permission bounds */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-3">
            {[
              { r: "Administrador", desc: "Acesso irrestrito a todos os recursos, controle avançado de rede e aprovação de divergências." },
              { r: "Liderança", desc: "Acompanha dashboards, pesquisa, histórico e divergências. Não acessa usuários e nem modo avançado." },
              { r: "Apoio", desc: "Foco integral no abastecimento e baixas lógicas (Lançamento, Pesquisa, Histórico e divergência)." },
              { r: "Produção", desc: "Permissões restritas unicamente à aba de Pesquisa de Referências para suporte físico." },
              { r: "Visualizador", desc: "Visualiza de forma estática quase todas as abas. Bloqueado para alterar ou lançar qualquer dado." }
            ].map(rules => (
              <div key={rules.r} className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg text-[10px] leading-relaxed">
                <span className="font-extrabold text-slate-755 text-slate-800 block mb-1 underline">{rules.r}</span>
                <span className="text-slate-450 font-medium block">{rules.desc}</span>
              </div>
            ))}
          </div>

        </div>

      </div>
    </div>
  );
};
