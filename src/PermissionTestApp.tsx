import React, { FormEvent, useState } from "react";
import { ShieldCheck, LogOut, AlertTriangle, LoaderCircle } from "lucide-react";
import type { AppUser } from "./components/AdminUsersManagement.tsx";
import { PermissionManagementPanel } from "./components/PermissionManagementPanel.tsx";
import { getPermissionAdminMode } from "./lib/permissionAdminService.ts";
import { supabase } from "./lib/supabase.ts";

const MODE = getPermissionAdminMode();
const EXPECTED_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const ROLE_LABEL: Record<string, AppUser["role"]> = {
  administrador: "Administrador",
  lideranca: "Liderança",
  apoio: "Apoio",
  producao: "Produção",
  visualizador: "Visualizador",
};

type TestProfile = { id: string; username: string; name: string; email: string; role: string };

function asTestUsers(value: unknown): AppUser[] {
  if (!Array.isArray(value)) throw new Error("A lista de usuários de teste tem formato inválido.");
  return value.map((item): AppUser => {
    if (!item || typeof item !== "object") throw new Error("Perfil local inválido.");
    const profile = item as TestProfile;
    const role = ROLE_LABEL[String(profile.role ?? "").toLowerCase()];
    if (!profile.id || !profile.username || !profile.name || !profile.email || !role) {
      throw new Error("Perfil local incompleto ou com papel desconhecido.");
    }
    return { id: profile.id, username: profile.username, name: profile.name, email: profile.email, role };
  });
}

function getLocalApiLabel(): string {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).origin; }
  catch { return "URL inválida"; }
}

const PermissionTestApp: React.FC = () => {
  const [email, setEmail] = useState("admin-permissoes@local.test");
  const [password, setPassword] = useState("");
  const [users, setUsers] = useState<AppUser[]>([]);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let isLocalApi = false;
  try { isLocalApi = EXPECTED_LOCAL_HOSTS.has(new URL(import.meta.env.VITE_SUPABASE_URL).hostname.toLowerCase()); }
  catch { isLocalApi = false; }

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (MODE !== "live" || !isLocalApi) {
      setError("A página de teste foi bloqueada porque o Supabase configurado não é local. Nenhuma chamada foi enviada.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (authError || !authData.user) throw new Error("Login local não concluído. Confira o e-mail e a senha de teste.");

      const { data, error: usersError } = await supabase.rpc("permission_test_list_users");
      if (usersError) {
        await supabase.auth.signOut();
        throw new Error("A conta não foi autorizada a abrir o painel local, ou o sandbox não foi preparado corretamente.");
      }
      setUsers(asTestUsers(data));
      setSignedInEmail(authData.user.email ?? email.trim());
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao entrar no sandbox local.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try { await supabase.auth.signOut(); }
    finally {
      setUsers([]);
      setSignedInEmail(null);
      setPassword("");
      setError(null);
      setBusy(false);
    }
  };

  if (MODE !== "live" || !isLocalApi) {
    return <main className="mx-auto my-12 max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-6 text-slate-900">
      <div className="flex items-center gap-3"><AlertTriangle className="h-7 w-7 text-amber-700" /><h1 className="text-xl font-bold">Sandbox de permissões bloqueado</h1></div>
      <p className="mt-3 text-sm">Esta página só funciona quando VITE_SUPABASE_URL aponta para localhost/127.0.0.1 e o modo de teste está explicitamente ativo.</p>
      <p className="mt-2 break-all font-mono text-xs">URL detectada: {getLocalApiLabel()}</p>
      <p className="mt-3 text-sm font-semibold">Nenhuma RPC de leitura ou gravação foi chamada.</p>
    </main>;
  }

  return <main className="mx-auto min-h-screen max-w-[1600px] p-4 md:p-6">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex gap-3"><ShieldCheck className="mt-1 h-7 w-7 text-emerald-700" /><div>
        <h1 className="text-lg font-bold text-emerald-950">Sandbox local — permissões configuráveis</h1>
        <p className="mt-1 text-sm text-emerald-900">Ambiente isolado. Alterações persistem somente no Supabase local de teste; não é o projeto remoto.</p>
        <p className="mt-1 font-mono text-xs text-emerald-900">API: {getLocalApiLabel()}</p>
      </div></div>
      {signedInEmail && <button type="button" onClick={handleLogout} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50"><LogOut className="h-4 w-4" /> Sair de {signedInEmail}</button>}
    </header>

    {!signedInEmail ? <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-bold text-slate-900">Entrar como Administrador de teste</h2>
      <p className="mt-1 text-sm text-slate-600">Use somente as credenciais temporárias descritas no documento do sandbox.</p>
      <form onSubmit={handleLogin} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-slate-700">E-mail local
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm font-medium text-slate-700">Senha local
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Entrar no sandbox</button>
      </form>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </section> : <>
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <PermissionManagementPanel users={users} mode="live" />
    </>}
  </main>;
};

export default PermissionTestApp;
