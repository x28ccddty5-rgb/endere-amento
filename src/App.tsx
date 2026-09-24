import { useState, useEffect, useMemo, useRef, FormEvent, KeyboardEvent } from "react";
import { calcularPaletes } from "./lib/palletUtils";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { supabase } from './lib/supabase';
import { 
  processLancamentosInSequence,
  processTransferenciaPosicao,
  validateLancamentoRow,
  generateId
} from "./data/mockStorage";
import { 
  WarehouseSlot, 
  HistoricoMov, 
  Divergencia, 
  LancamentoRow, 
  AppMode, 
  Product,
  Galpao,
  Restricao
} from "./types";
import { PRODUCT_CATALOG, findProductInList } from "./data/products";
import { normalizeRole, canExecuteOperations, isAdmin, isReadOnlyRole } from "./constants/permissions";
import { DashboardCards } from "./components/DashboardCards";
import { InteractiveMapa } from "./components/InteractiveMapa";
import { AdminUsersManagement, AppUser } from "./components/AdminUsersManagement";
import { AisleStoragePanel } from "./components/AisleStoragePanel";
import { DivergenciasPanel } from "./components/DivergenciasPanel";
import { MobileShell } from "./components/mobile/MobileShell";
import { readOfflineSnapshot, saveOfflineSnapshot } from "./lib/offlineCache";
import { getPhysicalAddressKey } from "./lib/slotUtils";
import { BaseDeDadosPanel } from "./components/BaseDeDadosPanel";
import { 
  LayoutDashboard, 
  Search, 
  PlusCircle, 
  History, 
  AlertOctagon, 
  Database, 
  Map, 
  Bot, 
  ShieldAlert, 
  Printer, 
  FileSpreadsheet, 
  Check, 
  Trash2, 
  Upload, 
  Download, 
  Sparkles, 
  Info,
  Lock,
  User,
  LogOut,
  Users,
  UserPlus
} from "lucide-react";

const HISTORY_PAGE_SIZE = 1000;
const HISTORY_DASHBOARD_DAYS = 60;
const PRODUCT_SEARCH_PAGE_SIZE = 100;

interface LancamentoDraftRecord {
  user_id: string;
  rows: LancamentoRow[];
  updated_at: string;
}

const loadLancamentoDraftFromSupabase = async (
  userId: string
): Promise<LancamentoRow[] | null> => {
  const { data, error } = await supabase
    .from("lancamento_drafts")
    .select("rows,updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Erro ao carregar rascunho de lançamento:", error);
    return null;
  }

  if (!data) return [];
  if (!Array.isArray(data.rows)) {
    console.warn("Rascunho de lançamento ignorado: formato inválido.");
    return [];
  }

  return data.rows as LancamentoRow[];
};

const saveLancamentoDraftToSupabase = async (
  userId: string,
  rows: LancamentoRow[]
): Promise<boolean> => {
  const draft: LancamentoDraftRecord = {
    user_id: userId,
    rows,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("lancamento_drafts")
    .upsert(draft, { onConflict: "user_id" });

  if (error) {
    console.error("Erro ao salvar rascunho de lançamento:", error);
    return false;
  }

  return true;
};

const deleteLancamentoDraftFromSupabase = async (
  userId: string
): Promise<boolean> => {
  const { error } = await supabase
    .from("lancamento_drafts")
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.error("Erro ao excluir rascunho de lançamento:", error);
    return false;
  }

  return true;
};

const getTodayIsoDate = (): string => new Date().toISOString().slice(0, 10);

const getIsoDateDaysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

let slotsLoadPromise: Promise<WarehouseSlot[]> | null = null;

const loadSlotsFromSupabase = (): Promise<WarehouseSlot[]> => {
  if (slotsLoadPromise) return slotsLoadPromise;

  slotsLoadPromise = (async (): Promise<WarehouseSlot[]> => {
    let allData: any[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("slots")
        .select("id,estoque,modulo,posicao,referencia,descricao,saldo,dataChacote,ultimaData,ultimaHora,ultimoResponsavel,galpao,restricao,observacao")
        .range(from, from + HISTORY_PAGE_SIZE - 1);

      if (error) {
        console.error("Erro ao carregar slots:", error);
        const cached = await readOfflineSnapshot<WarehouseSlot[]>("slots");
        return cached ?? [];
      }

      if (!data || data.length === 0) break;

      allData = [...allData, ...data];

      if (data.length < HISTORY_PAGE_SIZE) break;

      from += HISTORY_PAGE_SIZE;
    }

    const result = allData as WarehouseSlot[];
    await saveOfflineSnapshot("slots", result);
    return result;
  })();

  slotsLoadPromise.then(
    () => {
      slotsLoadPromise = null;
    },
    () => {
      slotsLoadPromise = null;
    }
  );

  return slotsLoadPromise;
};

/**
 * Persiste somente os slots que realmente mudaram.
 * O banco continua sendo a fonte oficial; o React mantém apenas o estado da tela.
 */
const saveSlotsToSupabase = async (slotsData: WarehouseSlot[]): Promise<boolean> => {
  if (slotsData.length === 0) return true;

  slotsLoadPromise = null;

  const { error } = await supabase
    .from("slots")
    .upsert(slotsData);

  if (error) {
    console.error("Erro ao salvar slots:", error);
    return false;
  }

  return true;
};

interface HistoryLoadOptions {
  startDate?: string;
  endDate?: string;
}

const mapHistoryRowFromSupabase = (row: any): HistoricoMov => {
  const { slot_id, slotId: legacySlotId, ...rest } = row ?? {};

  return {
    ...rest,
    slotId: slot_id ?? legacySlotId ?? undefined,
  } as HistoricoMov;
};

const mapHistoryRowsForSupabase = (rows: HistoricoMov[]) =>
  rows.map(({ slotId, ...row }) => ({
    ...row,
    slot_id: slotId ?? null,
  }));

/**
 * Carrega histórico por período, paginado para não depender do limite padrão do Supabase.
 * Sem período, mantém o comportamento de buscar todos os registros apenas quando isso
 * for explicitamente necessário (ex.: exportação "Tudo").
 */
const loadHistoryFromSupabaseUncached = async (
  options: HistoryLoadOptions = {}
): Promise<HistoricoMov[]> => {
  let allData: any[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from("history")
      .select("id,dataLancamento,quemLancou,data,estoque,modulo,posicao,referencia,quantidade,tipo,dataChacote,hora,responsavel,galpao,observacao,slot_id,restricao")
      .order("data", { ascending: false })
      .order("hora", { ascending: false })
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (options.startDate) {
      query = query.gte("data", options.startDate);
    }

    if (options.endDate) {
      query = query.lte("data", options.endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Erro ao carregar histórico:", error);
      const cached = await readOfflineSnapshot<HistoricoMov[]>("history");
      return cached ?? [];
    }

    if (!data || data.length === 0) break;

    allData = [...allData, ...data];

    if (data.length < HISTORY_PAGE_SIZE) break;

    from += HISTORY_PAGE_SIZE;
  }

  const result = allData.map(mapHistoryRowFromSupabase);
  await saveOfflineSnapshot("history", result);
  return result;
};

/**
 * Histórico é append-only. Nunca reenviamos o histórico inteiro para o banco.
 */
const historyLoadPromises = new globalThis.Map<string, Promise<HistoricoMov[]>>();

const loadHistoryFromSupabase = (
  options: HistoryLoadOptions = {}
): Promise<HistoricoMov[]> => {
  const key = `${options.startDate ?? ""}|${options.endDate ?? ""}`;
  const existing = historyLoadPromises.get(key);
  if (existing) return existing;

  const promise = loadHistoryFromSupabaseUncached(options);
  historyLoadPromises.set(key, promise);

  promise.then(
    () => {
      if (historyLoadPromises.get(key) === promise) {
        historyLoadPromises.delete(key);
      }
    },
    () => {
      if (historyLoadPromises.get(key) === promise) {
        historyLoadPromises.delete(key);
      }
    }
  );

  return promise;
};

let latestHistoryLoadPromise: Promise<HistoricoMov | null> | null = null;

const loadLatestHistoryRecord = (): Promise<HistoricoMov | null> => {
  if (latestHistoryLoadPromise) return latestHistoryLoadPromise;

  latestHistoryLoadPromise = (async (): Promise<HistoricoMov | null> => {
    const { data, error } = await supabase
      .from("history")
      .select("id,dataLancamento,quemLancou,data,estoque,modulo,posicao,referencia,quantidade,tipo,dataChacote,hora,responsavel,galpao,observacao,slot_id,restricao")
      .lte("data", getTodayIsoDate())
      .order("data", { ascending: false })
      .order("hora", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Erro ao carregar última movimentação:", error);
      return null;
    }

    return data ? mapHistoryRowFromSupabase(data) : null;
  })();

  latestHistoryLoadPromise.then(
    () => {
      latestHistoryLoadPromise = null;
    },
    () => {
      latestHistoryLoadPromise = null;
    }
  );

  return latestHistoryLoadPromise;
};

const appendHistoryToSupabase = async (
  historyData: HistoricoMov[]
): Promise<boolean> => {
  if (historyData.length === 0) return true;

  const { error } = await supabase
    .from("history")
    .insert(mapHistoryRowsForSupabase(historyData));

  if (error) {
    console.error("Erro ao inserir histórico:", error);
    return false;
  }

  return true;
};

let divergenciasLoadPromise: Promise<Divergencia[]> | null = null;

const mapDivergenciaRowFromSupabase = (row: any) => {
  const { slot_id, slotId: legacySlotId, ...rest } = row ?? {};

  return {
    ...rest,
    slotId: slot_id ?? legacySlotId ?? undefined,
  };
};

const mapDivergenciasForSupabase = (rows: Divergencia[]) =>
  rows.map(({ slotId, ...row }) => ({
    ...row,
    slot_id: slotId ?? null,
  }));

const normalizeDivergenciaRow = (row: any): Divergencia | null => {
  const rawStatus = String(row?.status ?? "").trim().toLowerCase();

  let status: Divergencia["status"];
  if (rawStatus === "aberta") {
    status = "Aberta";
  } else if (rawStatus === "corrigida") {
    status = "Corrigida";
  } else {
    console.warn("Divergência ignorada por status inválido:", row);
    return null;
  }

  return {
    ...mapDivergenciaRowFromSupabase(row),
    status,
  } as Divergencia;
};

const loadDivergenciasFromSupabase = (): Promise<Divergencia[]> => {
  if (divergenciasLoadPromise) return divergenciasLoadPromise;

  divergenciasLoadPromise = (async (): Promise<Divergencia[]> => {
    let allData: any[] = [];
    let from = 0;

    while (true) {
      // Carregamos todas as divergências, não somente "Aberta".
      // Isso evita perder registros por diferença de caixa/espaços no status
      // e também permite que o painel mostre o histórico de corrigidas.
      const { data, error } = await supabase
        .from("divergencias")
        .select("*")
        .range(from, from + HISTORY_PAGE_SIZE - 1);

      if (error) {
        console.error("Erro ao carregar divergências:", error);

        const cached = await readOfflineSnapshot<Divergencia[]>("divergencias");
        return (cached ?? [])
          .map(normalizeDivergenciaRow)
          .filter((div): div is Divergencia => Boolean(div));
      }

      if (!data || data.length === 0) break;

      allData = [...allData, ...data];

      if (data.length < HISTORY_PAGE_SIZE) break;

      from += HISTORY_PAGE_SIZE;
    }

    const result = allData
      .map(normalizeDivergenciaRow)
      .filter((div): div is Divergencia => Boolean(div));

    await saveOfflineSnapshot("divergencias", result);
    return result;
  })();

  divergenciasLoadPromise.then(
    () => {
      divergenciasLoadPromise = null;
    },
    () => {
      divergenciasLoadPromise = null;
    }
  );

  return divergenciasLoadPromise;
};

const saveDivergenciasToSupabase = async (
  divergenciasData: Divergencia[]
): Promise<boolean> => {
  if (divergenciasData.length === 0) return true;

  divergenciasLoadPromise = null;

  const { error } = await supabase
    .from("divergencias")
    .upsert(mapDivergenciasForSupabase(divergenciasData));

  if (error) {
    console.error("Erro ao salvar divergências:", error);
    return false;
  }

  return true;
};


export default function App() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Mobile é uma experiência própria da mesma aplicação, não um segundo sistema.
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const handleChange = (event: MediaQueryListEvent) => setIsMobileViewport(event.matches);
    setIsMobileViewport(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  // --- USER AUTHENTICATION & SECURITY STATE ---
  const [users, setUsers] = useState<AppUser[]>([]);

  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  // Login Form input state
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<string>("endereçamento");

  const getAppRole = (role: string): AppUser["role"] => {
    switch (role.trim().toLowerCase()) {
      case "administrador":
        return "Administrador";
      case "lideranca":
      case "liderança":
        return "Liderança";
      case "apoio":
        return "Apoio";
      case "producao":
      case "produção":
        return "Produção";
      case "visualizador":
        return "Visualizador";
      default:
        throw new Error(`Role de perfil inválida: ${role}`);
    }
  };

  const loadCurrentAuthUser = async () => {
    if (authLoadPromiseRef.current) {
      await authLoadPromiseRef.current;
      return;
    }

    const promise = (async () => {
      setAuthLoading(true);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError || !sessionData.session) {
        setAuthUserId(null);
        setCurrentUser(null);
        setAuthLoading(false);
        return;
      }

      const userId = sessionData.session.user.id;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("username,name,role")
        .eq("id", userId)
        .single();

      if (profileError || !profile) {
        console.error("Erro ao carregar perfil autenticado:", profileError);
        await supabase.auth.signOut();
        setAuthUserId(null);
        setCurrentUser(null);
        setAuthLoading(false);
        return;
      }

      try {
        const sessUser: AppUser = {
          username: profile.username,
          name: profile.name,
          role: getAppRole(profile.role)
        };

        setAuthUserId(userId);
        setCurrentUser(sessUser);
      } catch (error) {
        console.error("Perfil autenticado possui role inválida:", error);
        await supabase.auth.signOut();
        setAuthUserId(null);
        setCurrentUser(null);
      }

      setAuthLoading(false);
    })();

    authLoadPromiseRef.current = promise;

    try {
      await promise;
    } finally {
      if (authLoadPromiseRef.current === promise) {
        authLoadPromiseRef.current = null;
      }
    }
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError("");

    const identifier = loginUsername.trim();

    if (!identifier || !loginPassword) {
      setLoginError("Informe o e-mail, usuário ou nome e a senha.");
      return;
    }

    setAuthLoading(true);

    try {
      let authUserId: string | null = null;

      if (identifier.includes("@")) {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: identifier,
          password: loginPassword
        });

        if (authError || !authData.user) {
          console.error("Erro no login Supabase Auth:", authError);
          setLoginError("Usuário ou senha incorretos.");
          return;
        }

        authUserId = authData.user.id;
      } else {
        const { data, error } = await supabase.functions.invoke("login-by-identifier", {
          body: {
            identifier,
            password: loginPassword
          },
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          }
        });

        if (error || !data?.session || !data?.user?.id) {
          console.error("Erro no login por usuário/nome:", error);
          setLoginError(
            data?.error || "Usuário ou senha incorretos."
          );
          return;
        }

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        });

        if (sessionError) {
          console.error("Erro ao estabelecer sessão do login:", sessionError);
          setLoginError("Não foi possível estabelecer a sessão.");
          return;
        }

        authUserId = data.user.id;
      }

      if (!authUserId) {
        setLoginError("Não foi possível identificar a conta autenticada.");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("username,name,role")
        .eq("id", authUserId)
        .single();

      if (profileError || !profile) {
        console.error("Erro ao carregar perfil após login:", profileError);
        await supabase.auth.signOut();
        setAuthUserId(null);
        setCurrentUser(null);
        setLoginError("A conta foi autenticada, mas o perfil de acesso não foi encontrado.");
        return;
      }

      const sessUser: AppUser = {
        username: profile.username,
        name: profile.name,
        role: getAppRole(profile.role)
      };

      setAuthUserId(authUserId);
      setCurrentUser(sessUser);
      setLoginUsername("");
      setLoginPassword("");
    } catch (error) {
      console.error("Erro inesperado durante o login:", error);
      await supabase.auth.signOut();
      setAuthUserId(null);
      setCurrentUser(null);
      setLoginError("Não foi possível concluir o login.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Erro ao encerrar sessão:", error);
    }

    setAuthUserId(null);
    setCurrentUser(null);
    setLancamentoRows([]);
    setActiveTab("dashboard");
  };
  const authLoadPromiseRef = useRef<Promise<void> | null>(null);
  const usersLoadPromiseRef = useRef<Promise<AppUser[]> | null>(null);
  const productsLoadPromiseRef = useRef<Promise<Product[] | null> | null>(null);

  const loadUsersFromSupabase = async () => {
    if (!isAdmin(currentUser?.role)) {
      setUsers([]);
      setUsersLoading(false);
      return;
    }

    if (usersLoadPromiseRef.current) {
      const cachedUsers = await usersLoadPromiseRef.current;
      setUsers(cachedUsers);
      setUsersLoading(false);
      return;
    }

    setUsersLoading(true);

    const promise = (async (): Promise<AppUser[]> => {
      const { error, data } = await supabase.functions.invoke("admin-users", {
        body: { operation: "list" }
      });

      if (error || !data?.users) {
        console.error("Erro ao carregar usuários administrativos:", error);
        return [];
      }

      return data.users.map((user: {
        email?: string;
        username: string;
        name: string;
        role: string;
      }) => ({
        email: user.email,
        username: user.username,
        name: user.name,
        role: getAppRole(user.role)
      }));
    })();

    usersLoadPromiseRef.current = promise;

    try {
      const formattedUsers = await promise;
      setUsers(formattedUsers);
    } finally {
      if (usersLoadPromiseRef.current === promise) {
        usersLoadPromiseRef.current = null;
      }
      setUsersLoading(false);
    }
  };

useEffect(() => {
  loadCurrentAuthUser();
}, []);

useEffect(() => {
  if (!currentUser || !isAdmin(currentUser.role)) {
    setUsers([]);
    setUsersLoading(false);
    return;
  }

  loadUsersFromSupabase();
}, [currentUser]);

useEffect(() => {
  if (!authUserId) return;

  const loadSlots = async () => {
    const data = await loadSlotsFromSupabase();
    setSlots(data);
  };

  loadSlots();
}, [authUserId]);

useEffect(() => {
  if (activeTab !== "dashboard" && activeTab !== "histórico" && activeTab !== "ai") {
    return;
  }

  const loadHistory = async () => {
    const data = await loadHistoryFromSupabase({
      startDate: getIsoDateDaysAgo(HISTORY_DASHBOARD_DAYS),
      endDate: getTodayIsoDate()
    });

    // Mantém o indicador de "última movimentação" do Dashboard mesmo
    // quando o último movimento aconteceu há mais de 30 dias.
    const latest = await loadLatestHistoryRecord();
    const merged = latest && !data.some(item => item.id === latest.id)
      ? [latest, ...data]
      : data;

    setHistory(merged);
  };

  loadHistory();
}, [activeTab]);

useEffect(() => {
  if (!currentUser) return;

  const loadDivergencias = async () => {
    const data = await loadDivergenciasFromSupabase();
    setDivergencias(data);
  };

  loadDivergencias();
}, [currentUser]);

  // --- DYNAMIC REGISTERED CUSTOM PRODUCTS STATE ---
  const [productsList, setProductsList] = useState<Product[]>([]);

  const loadProductsFromSupabase = async () => {
    if (productsLoadPromiseRef.current) {
      const cachedProducts = await productsLoadPromiseRef.current;
      if (cachedProducts) {
        setProductsList(cachedProducts);
      }
      return;
    }

    const promise = (async (): Promise<Product[]> => {
      const { data, error } = await supabase
        .from("products")
        .select("referencia,descricao,paletizacao");

      if (error) {
        console.error("Erro ao carregar produtos:", error);
        const cached = await readOfflineSnapshot<Product[]>("products");
        return cached ?? [];
      }

      const result = (data ?? []).map((p: any) => ({
        referencia: p.referencia,
        descricao: p.descricao,
        paletizacao: Number(p.paletizacao || 0)
      }));
      await saveOfflineSnapshot("products", result);
      return result;
    })();

    productsLoadPromiseRef.current = promise;

    try {
      const loadedProducts = await promise;
      if (loadedProducts) {
        setProductsList(loadedProducts);
      }
    } finally {
      if (productsLoadPromiseRef.current === promise) {
        productsLoadPromiseRef.current = null;
      }
    }
  };

  // Carrega o catálogo somente nas telas que realmente dependem dele.
  // Isso preserva a otimização de carregamento sem deixar Base de Dados,
  // Pesquisa, Lançamento ou as telas operacionais sem as referências.
  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const tabsRequiringProducts = [
      "dashboard",
      "endereçamento",
      "lançamento",
      "divergências",
      "base",
      "corredor",
      "mapa",
      "ai"
    ];

    if (tabsRequiringProducts.includes(activeTab)) {
      loadProductsFromSupabase();
    }
  }, [activeTab, currentUser]);

  // Save changes to custom references list
  const registerNewProduct = async (
    ref: string,
    desc: string,
    paletizacao: number
  ): Promise<boolean> => {
    
  const code = ref.trim().toUpperCase();

  if (!code || !desc.trim()) return false;

  if (productsList.some(p => p.referencia.toUpperCase() === code)) {
    alert(`Produto com Referência ${code} já está cadastrado.`);
    return false;
  }

  const { error } = await supabase
    .from("products")
    .insert([
      {
        referencia: code,
        descricao: desc.trim(),
        paletizacao
      }
    ]);

  if (error) {
    console.error(error);
    alert("Erro ao salvar produto.");
    return false;
  }

  await loadProductsFromSupabase();

  alert("Produto cadastrado com sucesso!");
  return true;
};

    const updateProduct = async (
  referencia: string,
  descricao: string,
  paletizacao: number
): Promise<boolean> => {

  const { error } = await supabase
    .from("products")
    .update({
      descricao: descricao.trim(),
      paletizacao
    })
    .eq("referencia", referencia);

  if (error) {
    console.error(error);
    alert("Erro ao atualizar produto.");
    return false;
  }

  await loadProductsFromSupabase();

  alert("Produto atualizado com sucesso!");
  return true;
};

const deleteProduct = async (
  referencia: string
): Promise<boolean> => {

  const confirmDelete = window.confirm(
    `Excluir referência ${referencia}?`
  );

  if (!confirmDelete) return false;

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("referencia", referencia);

  if (error) {
    console.error(error);
    alert("Erro ao excluir produto.");
    return false;
  }

  await loadProductsFromSupabase();

  alert("Produto excluído com sucesso!");
  return true;
};
  
  // User Administration callbacks
  const handleRegisterUser = async (newUser: AppUser): Promise<boolean> => {
    if (!isAdmin(currentUser?.role)) {
      alert("Apenas o Administrador pode cadastrar usuários.");
      return false;
    }

    if (!newUser.email?.trim()) {
      alert("Informe o e-mail do usuário.");
      return false;
    }

    const roleMap: Record<AppUser["role"], string> = {
      Administrador: "administrador",
      Liderança: "lideranca",
      Apoio: "apoio",
      Produção: "producao",
      Visualizador: "visualizador"
    };

    const { error, data } = await supabase.functions.invoke("admin-users", {
      body: {
        operation: "create",
        email: newUser.email.trim().toLowerCase(),
        username: newUser.username,
        name: newUser.name,
        password: newUser.password,
        role: roleMap[newUser.role]
      }
    });

    if (error || !data?.user) {
      console.error("Erro ao criar usuário administrativo:", error);
      alert(data?.error || "Erro ao salvar usuário.");
      return false;
    }

    await loadUsersFromSupabase();
    return true;
  };

  const handleDeleteUser = async (username: string): Promise<boolean> => {
    if (!isAdmin(currentUser?.role)) {
      alert("Apenas o Administrador pode excluir usuários.");
      return false;
    }

    if (username === currentUser?.username) {
      alert("A conta atualmente conectada não pode ser excluída.");
      return false;
    }

    if (username === "adm") {
      alert("A conta administrativa principal é protegida.");
      return false;
    }

    if (!window.confirm(`Excluir o perfil "${username}"? Esta ação não pode ser desfeita pela interface.`)) {
      return false;
    }

    const { error, data } = await supabase.functions.invoke("admin-users", {
      body: {
        operation: "delete",
        username
      }
    });

    if (error || !data?.success) {
      console.error("Erro ao excluir usuário administrativo:", error);
      alert(data?.error || "Erro ao excluir usuário.");
      return false;
    }

    await loadUsersFromSupabase();
    return true;
  };

  // --- CORE SYSTEM DATA PERSISTENCE ---
  const [slots, setSlots] = useState<WarehouseSlot[]>([]);

  const [history, setHistory] = useState<HistoricoMov[]>([]);

  const [divergencias, setDivergencias] = useState<Divergencia[]>([]);

  /**
   * Atualiza e persiste somente os slots novos/alterados.
   * Isso mantém o Supabase como fonte oficial sem reenviar toda a tabela.
   */
  const persistSlotsUpdate = async (updatedSlots: WarehouseSlot[]): Promise<boolean> => {
    const previousById = new globalThis.Map(slots.map(slot => [slot.id, slot]));
    const changedSlots = updatedSlots.filter(slot => {
      const previous = previousById.get(slot.id);
      return !previous || JSON.stringify(previous) !== JSON.stringify(slot);
    });

    const saved = await saveSlotsToSupabase(changedSlots);

    if (saved) {
      setSlots(updatedSlots);
      await saveOfflineSnapshot("slots", updatedSlots);
    }

    return saved;
  };

  const appendHistory = async (newMovements: HistoricoMov[]): Promise<boolean> => {
    if (newMovements.length === 0) return true;

    const saved = await appendHistoryToSupabase(newMovements);

    if (saved) {
      const nextHistory = [...newMovements, ...history];
      setHistory(nextHistory);
      await saveOfflineSnapshot("history", nextHistory);

      setHistoryQueryRows(prev => {
        if (!prev) return prev;
        const inSelectedPeriod = newMovements.filter(
          movement =>
            movement.data >= histDateStart &&
            movement.data <= histDateEnd
        );
        return [...inSelectedPeriod, ...prev];
      });
    }

    return saved;
  };

  const persistDivergenciasUpdate = async (
    updatedDivergencias: Divergencia[]
  ): Promise<boolean> => {
    const previousById = new globalThis.Map(divergencias.map(div => [div.id, div]));
    const changed = updatedDivergencias.filter(div => {
      const previous = previousById.get(div.id);
      return !previous || JSON.stringify(previous) !== JSON.stringify(div);
    });

    const saved = await saveDivergenciasToSupabase(changed);

    if (saved) {
      setDivergencias(updatedDivergencias);
      await saveOfflineSnapshot("divergencias", updatedDivergencias);
    }

    return saved;
  };

  const handleMobileResolveDivergencia = async (
    div: Divergencia,
    action: "sobrescrever" | "descartar",
    skuValue: string,
    quantity: number,
    dataChacoteValue: string
  ): Promise<boolean> => {
    if (!currentUser || !canExecuteOperations(currentUser.role)) {
      alert("Seu perfil não possui permissão para corrigir divergências.");
      return false;
    }

    const currentDiv = divergencias.find(item => item.id === div.id);
    if (!currentDiv || currentDiv.status !== "Aberta") {
      alert("Esta divergência não está mais aberta. Atualize a tela antes de tentar novamente.");
      return false;
    }

    const updatedSlots = [...slots];
    const targetDate = getTodayIsoDate();
    const currentHour = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const correctedBy = currentUser.name || operator;

    let cleanSku = "";
    let product: Product | undefined;

    if (action === "sobrescrever") {
      cleanSku = skuValue.trim().toUpperCase();
      if (cleanSku.startsWith("S")) cleanSku = cleanSku.slice(1);

      if (!cleanSku) {
        alert("Informe o SKU que está fisicamente no endereço.");
        return false;
      }

      if (!Number.isFinite(quantity) || quantity < 0) {
        alert("Informe um saldo físico válido.");
        return false;
      }

      product = productsList.find(item => {
        const reference = item.referencia.trim().toUpperCase();
        return reference === cleanSku ||
          (reference.startsWith("S") && reference.slice(1) === cleanSku);
      });

      if (!product) {
        alert(`Código SKU "${cleanSku}" não cadastrado na Base de Dados de Referências.`);
        return false;
      }
    }

    const normalizedEstoque = currentDiv.estoque.replace(/^E/, "");
    const normalizedModulo = currentDiv.modulo.replace(/^[RM]/i, "");
    const normalizedPosicao = currentDiv.posicao || "";
    const targetSlotIdx = currentDiv.slotId
      ? updatedSlots.findIndex(slot => slot.id === currentDiv.slotId)
      : updatedSlots.findIndex(slot =>
          slot.estoque === normalizedEstoque &&
          slot.modulo === normalizedModulo &&
          slot.posicao === normalizedPosicao &&
          (
            currentDiv.refAtual === "Vazio" ||
            !currentDiv.refAtual ||
            slot.referencia.toUpperCase() === currentDiv.refAtual.toUpperCase()
          ) &&
          (slot.restricao || "nenhuma") === (currentDiv.restricao || slot.restricao || "nenhuma")
        );

    let effectiveSlotId: string | undefined =
      targetSlotIdx >= 0 ? updatedSlots[targetSlotIdx].id : currentDiv.slotId;

    if (action === "sobrescrever" && targetSlotIdx === -1) {
      if (normalizedEstoque === "1") {
        const e1Index = updatedSlots.findIndex(slot =>
          slot.estoque === "1" &&
          slot.modulo === normalizedModulo &&
          slot.referencia.toUpperCase() === cleanSku
        );
        if (e1Index >= 0) {
          effectiveSlotId = updatedSlots[e1Index].id;
        }
      } else {
        const restriction = currentDiv.restricao || "nenhuma";
        const addressId = `${normalizedEstoque}-${normalizedModulo}-${normalizedPosicao}`;
        const itemId = `${addressId}::ITEM::${cleanSku}::${restriction}`;
        const reusableIndex = updatedSlots.findIndex(slot =>
          slot.estoque === normalizedEstoque &&
          slot.modulo === normalizedModulo &&
          slot.posicao === normalizedPosicao &&
          slot.saldo === 0 &&
          slot.id.includes("::ITEM::")
        );

        if (reusableIndex >= 0) {
          effectiveSlotId = updatedSlots[reusableIndex].id;
        } else {
          updatedSlots.push({
            id: itemId,
            estoque: normalizedEstoque,
            modulo: normalizedModulo,
            posicao: normalizedPosicao,
            referencia: "",
            descricao: "",
            saldo: 0,
            dataChacote: "",
            ultimaData: "",
            ultimaHora: "",
            ultimoResponsavel: "",
            galpao: currentDiv.restricao === "autorizacao" ? "12" : "3",
            restricao: restriction,
            observacao: "",
          });
          effectiveSlotId = itemId;
        }
      }
    }

    const resolvedSlotIdx = effectiveSlotId
      ? updatedSlots.findIndex(slot => slot.id === effectiveSlotId)
      : -1;

    if (action === "descartar") {
      if (resolvedSlotIdx >= 0) {
        updatedSlots[resolvedSlotIdx] = {
          ...updatedSlots[resolvedSlotIdx],
          referencia: "",
          descricao: "",
          saldo: 0,
          dataChacote: "",
          observacao: "",
          ultimaData: targetDate,
          ultimaHora: currentHour,
          ultimoResponsavel: correctedBy,
        };
      }
    } else if (resolvedSlotIdx >= 0) {
      updatedSlots[resolvedSlotIdx] = {
        ...updatedSlots[resolvedSlotIdx],
        referencia: product!.referencia,
        descricao: product!.descricao,
        saldo: quantity,
        dataChacote: dataChacoteValue.trim(),
        galpao: currentDiv.restricao === "autorizacao"
          ? "12"
          : (updatedSlots[resolvedSlotIdx].galpao || "3"),
        restricao: currentDiv.restricao || updatedSlots[resolvedSlotIdx].restricao || "nenhuma",
        ultimaData: targetDate,
        ultimaHora: currentHour,
        ultimoResponsavel: correctedBy,
      };
    }

    const updatedDivergencias = divergencias.map(item => {
      const sameItem =
        item.status === "Aberta" &&
        (
          (currentDiv.slotId && item.slotId === currentDiv.slotId) ||
          (!currentDiv.slotId &&
            item.estoque === currentDiv.estoque &&
            item.modulo === currentDiv.modulo &&
            item.posicao === currentDiv.posicao)
        );

      if (!sameItem) return item;

      return {
        ...item,
        status: "Corrigida" as const,
        refNova: action === "descartar" ? "" : (product?.referencia || cleanSku),
        saldoFinal: action === "descartar" ? 0 : quantity,
        dataCorrecao: targetDate,
        corrigidoPor: correctedBy,
        slotId: effectiveSlotId || item.slotId,
        restricao: currentDiv.restricao || item.restricao,
        observacao:
          `${item.observacao || "Divergência gerada durante a operação."} ` +
          `Correção física registrada por ${correctedBy}.`,
      };
    });

    if (action === "sobrescrever" && resolvedSlotIdx < 0) {
      alert(
        `Não foi possível localizar ou criar o item da posição ${currentDiv.estoque}-${currentDiv.modulo}-${currentDiv.posicao || "Rua"}.`
      );
      return false;
    }

    const slotsSaved = await persistSlotsUpdate(updatedSlots);
    if (!slotsSaved) {
      alert("Não foi possível salvar a correção do item.");
      return false;
    }

    const newLog: HistoricoMov = {
      id: `CORR-${generateId()}`,
      dataLancamento: targetDate,
      quemLancou: correctedBy,
      data: targetDate,
      estoque: currentDiv.estoque,
      modulo: currentDiv.modulo,
      posicao: currentDiv.posicao,
      referencia: action === "descartar" ? "" : (product?.referencia || cleanSku),
      quantidade: action === "descartar" ? 0 : quantity,
      tipo: action === "descartar" ? "Saída" : "Entrada",
      dataChacote: action === "descartar" ? "" : (dataChacoteValue.trim() || "Reconciliação"),
      hora: currentHour,
      responsavel: correctedBy,
      observacao: `Correção de divergência: ${currentDiv.id}`,
      slotId: effectiveSlotId,
      restricao: currentDiv.restricao || (resolvedSlotIdx >= 0 ? (updatedSlots[resolvedSlotIdx].restricao || "nenhuma") : "nenhuma"),
    };

    const historySaved = await appendHistory([newLog]);
    if (!historySaved) {
      alert(
        "O endereço foi corrigido, mas o registro de auditoria não pôde ser gravado. " +
        "Verifique a conexão antes de repetir a operação."
      );
      return false;
    }

    const divergenciasSaved = await persistDivergenciasUpdate(updatedDivergencias);
    if (!divergenciasSaved) {
      alert(
        "A correção e o histórico foram salvos, mas o status da divergência não pôde ser atualizado. " +
        "Verifique a conexão antes de repetir a operação."
      );
      return false;
    }

    alert(`Divergência ${currentDiv.id} corrigida com sucesso.`);
    return true;
  };

  const occupiedPalletsE1 = useMemo(() => {
    const productsByReference = new globalThis.Map<string, Product>(
      productsList.map(product => [product.referencia, product])
    );

    return slots
      .filter(
        s =>
          s.estoque === "1" &&
          s.referencia &&
          s.saldo > 0
      )
      .reduce((total, slot) => {
        const produto = productsByReference.get(slot.referencia);

        if (!produto?.paletizacao) {
          return total;
        }

        return total + calcularPaletes(slot.saldo, produto.paletizacao);
      }, 0);
  }, [slots, productsList]);
  
  const [appMode, setAppMode] = useState<AppMode>(() => {
    const saved = localStorage.getItem("eb_mode");
    return (saved as AppMode) || "basico";
  });

  
  // Persistência explícita: evita gravar listas inteiras a cada render/alteração de estado.

  useEffect(() => {
    localStorage.setItem("eb_mode", appMode);
  }, [appMode]);

  // --- SYSTEM LOG OPERATOR RESPONSIBLES ---
  const operator = currentUser?.name || "Administrador Geral";
  const launchDate = new Date().toISOString().split("T")[0];

  // --- FILTERED VIEWS ---
  // Product Search Coordinates (Pesquisa Produtos) Filters
  const [searchRef, setSearchRef] = useState("");
  const [searchDesc, setSearchDesc] = useState("");
  const [filterEstoque, setFilterEstoque] = useState("");
  const [filterGalpao, setFilterGalpao] = useState("");
  const [searchObservacao, setSearchObservacao] = useState("");
  const [searchModulo, setSearchModulo] = useState("");
  const [searchPosicao, setSearchPosicao] = useState("");
  const [searchPage, setSearchPage] = useState(1);

  const [somenteAcimaPaletizacao, setSomenteAcimaPaletizacao] = useState(false);

  // Base Products Catalog Filters
  const [baseSearch, setBaseSearch] = useState("");

  // History Log Filters
  const [histSearchSku, setHistSearchSku] = useState("");
  const [histFilterEstoque, setHistFilterEstoque] = useState("");
  const [histFilterModulo, setHistFilterModulo] = useState("");
  const [histFilterPosicao, setHistFilterPosicao] = useState("");

  // Histórico da tela: por padrão mostra somente hoje. Períodos maiores são
  // consultados sob demanda para não carregar o banco inteiro no navegador.
  const [histDateStart, setHistDateStart] = useState(getTodayIsoDate());
  const [histDateEnd, setHistDateEnd] = useState(getTodayIsoDate());
  const [historyQueryRows, setHistoryQueryRows] = useState<HistoricoMov[] | null>(null);
  const [historyQueryLoading, setHistoryQueryLoading] = useState(false);
  const [historyExportAll, setHistoryExportAll] = useState(false);
  const [historyExportLoading, setHistoryExportLoading] = useState(false);

  const handleHistoryPeriodSearch = async () => {
    if (!histDateStart || !histDateEnd) {
      alert("Informe a data inicial e a data final.");
      return;
    }

    if (histDateStart > histDateEnd) {
      alert("A data inicial não pode ser maior que a data final.");
      return;
    }

    setHistoryQueryLoading(true);
    try {
      const data = await loadHistoryFromSupabase({
        startDate: histDateStart,
        endDate: histDateEnd
      });
      setHistoryQueryRows(data);
    } finally {
      setHistoryQueryLoading(false);
    }
  };

  const clearHistoryPeriodQuery = () => {
    setHistDateStart(getTodayIsoDate());
    setHistDateEnd(getTodayIsoDate());
    setHistoryQueryRows(null);
  };

  // New product register state helper
  const [newProdRef, setNewProdRef] = useState("");
  const [newProdDesc, setNewProdDesc] = useState("");

  // States for Unitary Launch in Advanced Mode
  const [unitEstoque, setUnitEstoque] = useState<string>("1");
  const [unitCorredor, setUnitCorredor] = useState<string>("");
  const [unitPosicao, setUnitPosicao] = useState<string>("");
  const [unitSku, setUnitSku] = useState<string>("");
  const [unitQuantidade, setUnitQuantidade] = useState<number | "">("");
  const [unitChacote, setUnitChacote] = useState<string>("");
  const [unitGalpao, setUnitGalpao] = useState<Galpao>("3");
  const [unitRestricao, setUnitRestricao] = useState<Restricao>("nenhuma");
  const [unitObservacao, setUnitObservacao] = useState<string>("");
  const [selectedLaunchType, setSelectedLaunchType] = useState<"unitario" | "lote">("unitario");

  const matchedUnitProduct = productsList.find(
    (p) => p.referencia.toUpperCase() === unitSku.trim().toUpperCase()
  );

  // --- LANÇAMENTO (TABULAR BATCH LEDGER) ---
  const [lancamentoRows, setLancamentoRows] = useState<LancamentoRow[]>(() => {
    try {
      const saved = localStorage.getItem("eb_lancamento_draft_v1");
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error("Erro ao recuperar rascunho de lançamento:", error);
      return [];
    }
  });
  const [lancamentoDraftReady, setLancamentoDraftReady] = useState(false);

  // Rascunho local: protege o preenchimento contra F5/atualização da página.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        if (lancamentoRows.length > 0) {
          localStorage.setItem(
            "eb_lancamento_draft_v1",
            JSON.stringify(lancamentoRows)
          );
        } else {
          localStorage.removeItem("eb_lancamento_draft_v1");
        }
      } catch (error) {
        console.error("Erro ao salvar rascunho local de lançamento:", error);
      }
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [lancamentoRows]);

  // O Supabase passa a ser o rascunho compartilhado por usuário. O localStorage
  // continua como proteção rápida para F5/offline e para a transição inicial.
  useEffect(() => {
    let cancelled = false;

    if (!authUserId) {
      setLancamentoDraftReady(false);
      return () => {
        cancelled = true;
      };
    }

    setLancamentoDraftReady(false);

    const hydrateDraft = async () => {
      const remoteRows = await loadLancamentoDraftFromSupabase(authUserId);
      if (cancelled) return;

      if (remoteRows === null) {
        // Falha de leitura não apaga o rascunho local existente.
        setLancamentoDraftReady(true);
        return;
      }

      if (remoteRows.length > 0) {
        setLancamentoRows(remoteRows);
      } else if (lancamentoRows.length > 0) {
        // Migra o rascunho local existente para a conta autenticada na primeira
        // abertura após esta funcionalidade ser habilitada.
        await saveLancamentoDraftToSupabase(authUserId, lancamentoRows);
      } else {
        setLancamentoRows([]);
      }

      if (!cancelled) {
        setLancamentoDraftReady(true);
      }
    };

    void hydrateDraft();

    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  useEffect(() => {
    if (!authUserId || !lancamentoDraftReady) return;

    const timeout = window.setTimeout(() => {
      if (lancamentoRows.length === 0) {
        void deleteLancamentoDraftFromSupabase(authUserId);
        return;
      }

      void saveLancamentoDraftToSupabase(authUserId, lancamentoRows);
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [authUserId, lancamentoDraftReady, lancamentoRows]);

  const clearLancamentoDraft = () => {
    if (lancamentoRows.length === 0) return;
    if (!confirm("Limpar o rascunho atual do lançamento? Os dados ainda não lançados serão perdidos.")) {
      return;
    }
    setLancamentoRows([]);
  };

  // Bulk Excel import panel state
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkFeedback, setBulkFeedback] = useState("");

  const [filtroSkuLote, setFiltroSkuLote] = useState("");
  const [filtroModuloLote, setFiltroModuloLote] = useState("");
  const [filtroPosicaoLote, setFiltroPosicaoLote] = useState("");
  const [filtroEstoqueLote, setFiltroEstoqueLote] = useState("");
  const [filtroLinhaLote, setFiltroLinhaLote] = useState("");
  
  // Real-time product lookup
  const getProductDesc = (ref: string) => {
    const prod = findProductInList(ref, productsList);
    return prod ? prod.descricao : "";
  };

const lancamentoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const responsavelInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const addLancamentoRow = () => {
    const rowId = `ROW-${generateId()}`;
    const defaultRow: LancamentoRow = {
      id: rowId,
      data: launchDate,
      estoque: "1",
      modulo: "",
      posicao: "",
      referencia: "",
      quantidade: "",
      tipo: "Entrada",
      dataChacote: "",
      hora: "",
      responsavel: "",
      galpao: "3",
      restricao: "nenhuma",
      observacao: ""
    };

    setLancamentoRows(prev => [...prev, defaultRow]);

    // Aguarda a nova linha ser renderizada antes de devolver o foco ao primeiro campo.
    window.setTimeout(() => {
      lancamentoInputRefs.current[rowId]?.focus();
    }, 0);

    return rowId;
  };

  const handleLancamentoInputKeyDown = (
    event: KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    event.stopPropagation();
    addLancamentoRow();
  };

  const getPreviousResponsaveis = (rowId: string): string[] => {
    const rowIndex = lancamentoRows.findIndex(row => row.id === rowId);
    if (rowIndex <= 0) return [];

    return Array.from(
      new Set(
        lancamentoRows
          .slice(0, rowIndex)
          .map(row => row.responsavel.trim())
          .filter(Boolean)
      )
    );
  };

  const handleResponsavelChange = (rowId: string, value: string) => {
    const previousResponsaveis = getPreviousResponsaveis(rowId);
    const normalizedValue = value.trim().toLocaleLowerCase("pt-BR");

    if (normalizedValue) {
      const matches = previousResponsaveis.filter(name =>
        name.toLocaleLowerCase("pt-BR").startsWith(normalizedValue)
      );

      // Só completa automaticamente quando existe uma única correspondência.
      // Assim, "Jo" não escolhe arbitrariamente entre "João" e "José".
      if (
        matches.length === 1 &&
        matches[0].toLocaleLowerCase("pt-BR") !== normalizedValue
      ) {
        const completedValue = matches[0];
        updateRowField(rowId, "responsavel", completedValue);

        // Mantém o trecho digitado selecionado para que o próximo caractere
        // possa continuar a edição normalmente.
        window.setTimeout(() => {
          const input = responsavelInputRefs.current[rowId];
          if (input) {
            input.focus();
            input.setSelectionRange(value.length, completedValue.length);
          }
        }, 0);
        return;
      }
    }

    updateRowField(rowId, "responsavel", value);
  };
  
  const removeLancamentoRow = (id: string) => {
    if (lancamentoRows.length === 1) {
  setLancamentoRows([]);
  return;
}
    setLancamentoRows(lancamentoRows.filter(r => r.id !== id));
  };

  const updateRowField = (id: string, field: keyof LancamentoRow, value: any) => {
    setLancamentoRows(prev => prev.map(row => {
      if (row.id === id) {
        // Automatically translate stock type to uppercase
        let nextValue = value;
        if (field === "referencia") nextValue = value.toUpperCase();
        if (field === "modulo") nextValue = value.replace(/\D/g, "");
        if (field === "posicao") nextValue = value.toUpperCase();
        
        const updated = { ...row, [field]: nextValue };

        // Clean positions if E1 is selected
        if (field === "estoque" && nextValue === "E1") {
          updated.posicao = "";
          updated.modulo = "11";
        } else if (field === "estoque" && (nextValue === "E2" || nextValue === "E3")) {
          updated.modulo = "1";
          updated.posicao = "A1";
        }
        return updated;
      }
      return row;
    }));
  };

const lancamentoRowsFiltradas = lancamentoRows.filter((row) => {
const numeroLinha = lancamentoRows.indexOf(row) + 1;

if (
  filtroLinhaLote &&
  !numeroLinha.toString().includes(filtroLinhaLote)
) {
  return false;
}  
  if (filtroSkuLote) {
  if (
    row.referencia.toUpperCase() !== filtroSkuLote.toUpperCase()
  ) {
    return false;
  }
}

  if (
    filtroModuloLote &&
    !row.modulo.includes(filtroModuloLote)
  ) {
    return false;
  }

  if (
    filtroPosicaoLote &&
    !row.posicao.toUpperCase().includes(filtroPosicaoLote.toUpperCase())
  ) {
    return false;
  }

  if (
    filtroEstoqueLote &&
    row.estoque !== filtroEstoqueLote
  ) {
    return false;
  }

  return true;
});
  
  // Automated Suggestion of empty slot matching SKU
  const handleAutoSuggestSlot = (id: string, ref: string) => {
    if (!ref.trim()) return;
    const compatibleSlot = slots.find(s => 
      (s.referencia === "" && s.saldo === 0) || 
      (s.referencia === ref.toUpperCase())
    );
    if (compatibleSlot) {
      updateRowField(id, "estoque", compatibleSlot.estoque);
      updateRowField(id, "modulo", compatibleSlot.modulo);
      updateRowField(id, "posicao", compatibleSlot.posicao);
    }
  };

  // Executing batch launches with Travas (blocking validators)
  const handleLancarLote = async () => {
    // Perform validators for each active field
    const activeData = lancamentoRows.filter(r => r.referencia.trim() !== "");
    if (activeData.length === 0) {
      alert("Por favor, preencha pelo menos um lançamento contendo código SKU válido.");
      return;
    }

    try {
      // Capture errors
      let allErrors: string[] = [];
      activeData.forEach((row, index) => {
        const rowErrors = validateLancamentoRow(row, index + 1, productsList, appMode === "avancado", slots);
        allErrors = [...allErrors, ...rowErrors];

        // A hora pertence à movimentação registrada na folha.
        // Ela pode ficar vazia durante o preenchimento, mas deve estar
        // completa e válida no momento do lançamento do lote.
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.hora.trim())) {
          allErrors.push(
            `Linha ${index + 1}: a hora da movimentação deve estar no formato HH:mm (ex.: 08:30).`
          );
        }

        const rowGalpao = row.galpao || "3";
        const rowRestricao = rowGalpao === "12" ? "autorizacao" : (row.restricao || "nenhuma");

        if (rowGalpao === "12" && row.restricao !== "autorizacao") {
          allErrors.push(
            `Linha ${index + 1}: Galpão 12 exige Restrição = Solicitar autorização.`
          );
        }

        if (row.tipo === "Entrada" && ["E2", "E3"].includes(row.estoque)) {
          const estVal = row.estoque.replace(/^E/, "");
          const modVal = row.modulo.replace(/^[RM]/i, "");
          const addressSlots = slots.filter(
            slot =>
              slot.estoque === estVal &&
              slot.modulo === modVal &&
              slot.posicao === row.posicao &&
              slot.saldo > 0 &&
              Boolean(slot.referencia)
          );

          const rowRef = row.referencia.trim().toUpperCase();
          const hasExactItem = addressSlots.some(
            slot =>
              slot.referencia.toUpperCase() === rowRef &&
              (slot.restricao || "nenhuma") === rowRestricao
          );
          const hasNormal = addressSlots.some(
            slot => (slot.restricao || "nenhuma") === "nenhuma"
          );
          const hasRestricted = addressSlots.some(
            slot => (slot.restricao || "nenhuma") !== "nenhuma"
          );

          if (
            (rowRestricao === "nenhuma" && addressSlots.length > 0 && !hasExactItem) ||
            (rowRestricao === "nenhuma" && hasRestricted) ||
            (rowRestricao !== "nenhuma" && hasNormal)
          ) {
            allErrors.push(
              rowRestricao === "nenhuma"
                ? `Linha ${index + 1}: a posição já possui outro item. ` +
                  "Estoque normal sem restrição não pode compartilhar a posição com outro SKU."
                : `Linha ${index + 1}: a posição já possui estoque sem restrição. ` +
                  "Não é permitido misturar paletes normais e restritos na mesma posição."
            );
          }
        }

      });
      if (allErrors.length > 0) {
        alert(`O lote contém inconsistências de validação e não pôde ser lançado:\n\n${allErrors.slice(0, 10).join("\n")}${allErrors.length > 10 ? `\n...e mais ${allErrors.length - 10} travas violadas.` : ""}`);
        return;
      }

      const {
        updatedSlots,
        newHistory,
        newDivergencias,
        processedCount,
        errorCount
      } = processLancamentosInSequence(activeData, slots, operator, launchDate, divergencias, productsList, appMode === "avancado");

      const updatedDivergencias = [...newDivergencias, ...divergencias];

      // Quando há divergência, ela é registrada antes da alteração física.
      // Assim, se a segunda persistência falhar, a posição continua protegida
      // pela divergência aberta em vez de ficar alterada sem registro.
      if (newDivergencias.length > 0) {
        const divergenciasSaved = await persistDivergenciasUpdate(updatedDivergencias);
        if (!divergenciasSaved) {
          alert(
            "O lote não foi concluído porque as divergências não puderam ser registradas no Supabase. " +
            "Os dados preenchidos foram preservados no rascunho. Não repita a operação antes de verificar a conexão."
          );
          return;
        }
      }

      // Persistência incremental: somente o que foi alterado é enviado ao Supabase.
      const slotsSaved = await persistSlotsUpdate(updatedSlots);
      if (!slotsSaved) {
        alert(
          newDivergencias.length > 0
            ? "As divergências foram registradas, mas não foi possível atualizar os endereços no Supabase. A posição permanece protegida para revisão e os dados do lote foram preservados."
            : "O lote não foi concluído porque não foi possível salvar os endereços no Supabase. Os dados preenchidos foram preservados no rascunho."
        );
        return;
      }

      const historySaved = await appendHistory(newHistory);
      if (!historySaved) {
        // O endereço já foi salvo. Recarregamos para manter a tela fiel ao banco.
        const latestSlots = await loadSlotsFromSupabase();
        setSlots(latestSlots);
        alert(
          "Os endereços foram salvos, mas o histórico não pôde ser gravado. " +
          "Os dados preenchidos foram preservados no rascunho; não repita a operação antes de verificar a conexão."
        );
        return;
      }

      alert(`Lote processado!\n✔️ ${processedCount} movimentações consolidadas de modo sequencial.\n⚠️ ${errorCount} divergências identificadas e enviadas para revisão.`);

      // Clear grid only after all persistent writes succeeded.
      setLancamentoRows([]);
    } catch (error) {
      console.error("Erro inesperado ao processar lote:", error);
      alert(
        "O lote não foi concluído por causa de um erro inesperado. " +
        "Os dados preenchidos foram preservados no rascunho para nova tentativa."
      );
    }
  };
  const handleUnitaryLaunch = async (
    type: "Entrada" | "Saída",
    mobileData?: {
      estoque: string;
      modulo: string;
      posicao: string;
      sku: string;
      quantidade: number;
      dataChacote: string;
      galpao: Galpao;
      restricao: Restricao;
      observacao: string;
    }
  ): Promise<boolean> => {
    if (!hasAccess("operador")) {
      alert("Seu perfil não possui permissão para efetuar lançamentos.");
      return false;
    }

    const estVal = (mobileData?.estoque ?? unitEstoque).trim().toUpperCase().replace(/^E/, "");
    const cleanCorredor = (mobileData?.modulo ?? unitCorredor).trim().toUpperCase().replace(/^[RM]/i, "");
    let cleanSku = (mobileData?.sku ?? unitSku).trim().toUpperCase();
    if (cleanSku.startsWith("S")) cleanSku = cleanSku.slice(1);

    const hora = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });
    const sourcePosition = mobileData?.posicao ?? unitPosicao;
    const posVal =
      estVal === "1" || !sourcePosition || sourcePosition.trim() === ""
        ? ""
        : sourcePosition.trim().toUpperCase();

    const row: LancamentoRow = {
      id: `UNIT-${generateId()}`,
      data: launchDate,
      estoque: estVal,
      modulo: cleanCorredor,
      posicao: posVal,
      referencia: cleanSku,
      quantidade: mobileData?.quantidade ?? Number(unitQuantidade),
      tipo: type,
      dataChacote: mobileData?.dataChacote ?? unitChacote,
      hora,
      responsavel: operator,
      galpao: mobileData?.galpao ?? unitGalpao,
      restricao: mobileData?.restricao ?? unitRestricao,
      observacao: mobileData?.observacao ?? unitObservacao
    };

    const errors = validateLancamentoRow(
      row,
      1,
      productsList,
      appMode === "avancado",
      slots
    );

    if (errors.length > 0) {
      alert(`O lançamento não pôde ser realizado:\n\n${errors.join("\n")}`);
      return false;
    }

    if (type === "Entrada" && (estVal === "2" || estVal === "3")) {
      const addressSlots = slots.filter(
        slot =>
          slot.estoque === estVal &&
          slot.modulo === cleanCorredor &&
          slot.posicao === posVal &&
          slot.saldo > 0 &&
          Boolean(slot.referencia)
      );

      const requestedRestricao = row.restricao || "nenhuma";
      const hasExactItem = addressSlots.some(
        slot =>
          slot.referencia.toUpperCase() === cleanSku &&
          (slot.restricao || "nenhuma") === requestedRestricao
      );
      const hasNormal = addressSlots.some(
        slot => (slot.restricao || "nenhuma") === "nenhuma"
      );
      const hasRestricted = addressSlots.some(
        slot => (slot.restricao || "nenhuma") !== "nenhuma"
      );

      if (
        (requestedRestricao === "nenhuma" && addressSlots.length > 0 && !hasExactItem) ||
        (requestedRestricao === "nenhuma" && hasRestricted) ||
        (requestedRestricao !== "nenhuma" && hasNormal)
      ) {
        alert(
          requestedRestricao === "nenhuma"
            ? "A posição já possui outro item. Estoque normal sem restrição não pode compartilhar a posição com outro SKU."
            : "Não é permitido misturar paletes normais e restritos na mesma posição."
        );
        return false;
      }
    }

    const {
      updatedSlots,
      newHistory,
      newDivergencias,
      processedCount
    } = processLancamentosInSequence(
      [row],
      slots,
      operator,
      launchDate,
      divergencias,
      productsList,
      appMode === "avancado"
    );

    if (processedCount === 0 && newDivergencias.length === 0) {
      alert("O lançamento não gerou nenhuma alteração. Verifique os dados informados.");
      return false;
    }

    if (newDivergencias.length > 0) {
      const updatedDivergencias = [...newDivergencias, ...divergencias];
      const divergenciasSaved = await persistDivergenciasUpdate(updatedDivergencias);
      if (!divergenciasSaved) {
        alert(
          "A divergência foi identificada, mas não pôde ser registrada no Supabase. " +
          "Os dados preenchidos foram preservados para nova tentativa. Verifique a conexão antes de repetir a operação."
        );
        return false;
      }

      const slotsSaved = await persistSlotsUpdate(updatedSlots);
      if (!slotsSaved) {
        alert(
          "A divergência foi registrada, mas não foi possível limpar a posição no Supabase. " +
          "A posição permanece protegida para revisão. Não repita a operação antes de verificar a conexão."
        );
        return false;
      }

      setUnitCorredor("");
      setUnitPosicao("");
      setUnitSku("");
      setUnitQuantidade("");
      setUnitChacote("");
      setUnitGalpao("3");
      setUnitRestricao("nenhuma");
      setUnitObservacao("");
      alert(
        `A movimentação gerou ${newDivergencias.length} divergência(s) para revisão. ` +
        "A posição foi limpa e bloqueada até a correção."
      );
      // Retorna sucesso para o MobileShell limpar seu estado local do formulário.
      return true;
    }

    const slotsSaved = await persistSlotsUpdate(updatedSlots);
    if (!slotsSaved) {
      alert("O lançamento não foi concluído porque não foi possível salvar o endereço no Supabase.");
      return false;
    }

    if (newHistory.length > 0) {
      const historySaved = await appendHistory(newHistory);
      if (!historySaved) {
        const latestSlots = await loadSlotsFromSupabase();
        setSlots(latestSlots);
        alert(
          "O endereço foi salvo, mas o histórico não pôde ser registrado. " +
          "Não repita a operação antes de verificar a conexão com o Supabase."
        );
        return false;
      }
    }

    setUnitCorredor("");
    setUnitPosicao("");
    setUnitSku("");
    setUnitQuantidade("");
    setUnitChacote("");
    setUnitGalpao("3");
    setUnitRestricao("nenhuma");
    setUnitObservacao("");

    alert(
      `Lançamento de ${type} consolidado no endereço ` +
      `${cleanCorredor}${posVal ? ` (Posição ${posVal})` : " (Corredor)"}.`
    );

    return true;
  };

  const handleTransferPosition = async (
    sourceId: string,
    destinationId: string,
    observation = ""
  ): Promise<boolean> => {
    if (!hasAccess("operador")) {
      alert("Seu perfil não possui permissão para transferir posições.");
      return false;
    }

    if (!navigator.onLine) {
      alert("A transferência exige conexão com o Supabase. A operação offline ainda não está habilitada para escrita.");
      return false;
    }

    const result = processTransferenciaPosicao(
      sourceId,
      destinationId,
      slots,
      operator,
      launchDate
    );

    if (result.processedCount === 0) {
      alert(
        "A transferência não pôde ser realizada. " +
        "Verifique se a origem possui estoque e se o destino está vazio e cadastrado."
      );
      return false;
    }

    const historyWithObservation = result.newHistory.map(item => ({
      ...item,
      observacao: observation.trim(),
    }));

    const slotsSaved = await persistSlotsUpdate(result.updatedSlots);
    if (!slotsSaved) {
      alert("A transferência não foi concluída porque não foi possível salvar as posições no Supabase.");
      return false;
    }

    const historySaved = await appendHistory(historyWithObservation);
    if (!historySaved) {
      const latestSlots = await loadSlotsFromSupabase();
      setSlots(latestSlots);
      alert(
        "As posições foram atualizadas, mas o histórico não pôde ser registrado. " +
        "Não repita a operação antes de verificar a conexão."
      );
      return false;
    }

    alert("Transferência concluída. SKU, saldo e data de chacote foram preservados.");
    return true;
  };

  // Manual Excel paste parser updated to handle E1, E2, E3
  const handleImportExcelData = () => {
    if (!bulkText.trim()) {
      setBulkFeedback("Espaço por colar em branco.");
      return;
    }

    const lines = bulkText.split("\n").filter(l => l.trim() !== "");
    const dataLines = lines.filter(
  line =>
    !line
      .toLowerCase()
      .includes("linha")
);
    const newRows: LancamentoRow[] = [];

    dataLines.forEach((line) => {
      const cols = line.split(/[;\t]/);
      if (cols.length >= 3) {
        // Layout novo exportado pelo Excel

        let estVal = `E${cols[2]?.trim()}`.toUpperCase();
        
        if (!["E1", "E2", "E3"].includes(estVal))
          estVal = "E1";
        
        const modRaw = cols[3]?.trim() || "1";
        const modVal = modRaw.replace(/\D/g, "");
        
        const posVal =
          estVal === "E1"
            ? ""
            : cols[4]?.trim().toUpperCase() || "A1";
        
        const refRaw = cols[5]?.trim().toUpperCase();
        let dataLancamento = launchDate;

if (cols[1]?.trim()) {
  const partes = cols[1].trim().split("/");

  if (partes.length === 3) {
    dataLancamento =
      `${partes[2]}-${partes[1]}-${partes[0]}`;
  }
}
        const qtyRaw = cols[7]?.trim().replace(/\./g, "");
        
        const typeRaw =
  cols[8]?.trim().toLowerCase() || "entrada";
        
        const tipoNormalizado = typeRaw
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

const dataChacote =
  cols[9]?.trim() || "";

const hora =
  cols[10]?.trim() ||
  new Date().toLocaleTimeString(
    "pt-BR",
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  );

const responsavel =
  cols[11]?.trim() || operator;

const galpaoRaw = cols[12]?.trim() || "3";
const galpao = galpaoRaw === "12" ? "12" : "3";
const restricaoRaw = cols[13]?.trim().toLowerCase() || "nenhuma";
const restricao =
  galpao === "12"
    ? "autorizacao"
    : ["nenhuma", "teste", "autorizacao", "outra"].includes(restricaoRaw)
      ? restricaoRaw
      : "nenhuma";
const observacao = cols[14]?.trim() || "";

if (refRaw) {
  newRows.push({
    id: `ROW-${generateId()}`,
    data: dataLancamento,
    estoque: estVal,
    modulo: modVal,
    posicao: posVal,
    referencia: refRaw,
    quantidade: parseInt(qtyRaw) || 100,
    tipo:
      tipoNormalizado === "saida" ||
      tipoNormalizado.includes("saida") ||
      tipoNormalizado.includes("baixa")
        ? "Saída"
        : "Entrada",
    dataChacote,
    hora,
    responsavel,
    galpao,
    restricao,
    observacao,
  });
}
      }
    });

    if (newRows.length > 0) {
      setLancamentoRows(newRows);
      setBulkFeedback(`Sucesso! ${newRows.length} lançamentos importados com êxito para a planilha de lote.`);
      setBulkText("");
      setTimeout(() => {
        setShowBulkImport(false);
        setBulkFeedback("");
      }, 2000);
    } else {
      setBulkFeedback("Falha no parser. O formato deve ser: Referência [Tab ou Semicolon] Quantidade [Tab] Tipo.");
    }
  };

  const handleExportarLayout = () => {
  const data = [
    {
      Linha: 1,
      Data_Lancamento: new Date().toLocaleDateString("pt-BR"),
      Estoque: 3,
      Rua: 26,
      Posicao: "A1",
      SKU: "23101G",
      Descricao: "",
      Quant_PCS: 360,
      Tipo: "Entrada",
      Data_Chacote: "",
      Hora: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      Responsavel: operator,
      Galpao: "3",
      Restricao: "nenhuma",
      Observacao: "",
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(data);

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "Lançamentos"
  );

  XLSX.writeFile(
    workbook,
    "layout_porto_brasil.xlsx"
  );
};

  const handleExportarEnderecamento = () => {
    const headers = [
      "ID",
      "Estoque",
      "Modulo_Rua",
      "Posicao",
      "Referencia_SKU",
      "Descricao_Produto",
      "Saldo_Pecas",
      "Data_Chacote",
      "Ultima_Movimentacao_Data",
      "Ultima_Movimentacao_Hora",
      "Ultimo_Responsavel"
    ];
    
    const rows = slots.map(s => [
      s.id,
      `E${s.estoque}`,
      s.modulo,
      s.posicao || "Corredor",
      s.referencia || "",
      s.descricao || "",
      String(s.saldo),
      s.dataChacote || "",
      s.ultimaData || "",
      s.ultimaHora || "",
      s.ultimoResponsavel || ""
    ]);

    const csvContent = [
      headers.join(";"),
      ...rows.map(row => 
        row.map(val => {
          const cleanVal = val === null || val === undefined ? "" : String(val).replace(/"/g, '""');
          return `"${cleanVal}"`;
        }).join(";")
      )
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `enderecamento_porto_brasil_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

    
    const handleExportarEnderecamentoPDF = () => {

        const doc = new jsPDF({
          orientation: "landscape"
        });
      
        doc.setFontSize(18);
        doc.text("PORTO BRASIL", 14, 15);
      
        doc.setFontSize(11);
        doc.text("Relatório de Endereçamento", 14, 23);
      
        doc.setFontSize(8);
        doc.text(
          `Gerado em ${new Date().toLocaleString("pt-BR")}`,
          14,
          30
        );
      
        autoTable(doc, {
          startY: 38,

        didParseCell: (data) => {

        if (data.section !== "body") return;
      
        const slot = filteredSlots[data.row.index];
      
        const produto = productsList.find(
          p => p.referencia === slot.referencia
        );
      
        const acimaPaletizacao =
          produto?.paletizacao &&
          slot.saldo > produto.paletizacao;
      
        if (acimaPaletizacao) {
          data.cell.styles.fillColor = [219, 234, 254];
        }
      },
          
          head: [[
            "Estoque",
            "Módulo",
            "Posição",
            "SKU",
            "Descrição",
            "Saldo",
            "Data Chacote",
            "Última Mov.",
            "Responsável"
          ]],
      
          body: filteredSlots.map((s) => [
            s.estoque,
            s.modulo,
            s.posicao || "-",
            s.referencia || "-",
            s.descricao || "-",
            s.saldo.toLocaleString(),
            s.dataChacote || "-",
            s.ultimaData || "-",
            s.ultimoResponsavel || "-"
          ]),
      
          styles: {
            fontSize: 7,
            cellPadding: 2
          },
      
          headStyles: {
            fillColor: [37, 99, 235],
            fontStyle: "bold"
          },
      
          columnStyles: {
            4: { cellWidth: 70 }, // descrição
          }
        });
      
        doc.save(
          `Enderecamento_${new Date()
            .toISOString()
            .slice(0, 10)}.pdf`
        );
      };
  
  const handleExportarHistorico = async () => {
    if (!historyExportAll && (!histDateStart || !histDateEnd || histDateStart > histDateEnd)) {
      alert("Selecione um período válido para exportação.");
      return;
    }

    setHistoryExportLoading(true);

    try {
      const exportData = await loadHistoryFromSupabase(
        historyExportAll
          ? {}
          : {
              startDate: histDateStart,
              endDate: histDateEnd
            }
      );

      if (exportData.length === 0) {
        alert("Nenhuma movimentação encontrada para o período selecionado.");
        return;
      }

      const headers = [
        "ID_Movimento",
        "Data_Lancamento_Sistema",
        "Quem_Lancou",
        "Data_Operacional",
        "Hora_Operacional",
        "Estoque",
        "Modulo_Rua",
        "Posicao",
        "Referencia_SKU",
        "Quantidade_Pecas",
        "Tipo_Movimento",
        "Data_Chacote",
        "Responsavel_Operacional",
        "Galpao",
        "Observacao"
      ];

      const rows = exportData.map(h => [
        h.id,
        h.dataLancamento,
        h.quemLancou,
        h.data,
        h.hora,
        `E${h.estoque}`,
        h.modulo,
        h.posicao || "Corredor",
        h.referencia,
        String(h.quantidade),
        h.tipo,
        h.dataChacote || "",
        h.responsavel,
        h.galpao || "3",
        h.observacao || ""
      ]);

      const csvContent = [
        headers.join(";"),
        ...rows.map(row =>
          row.map(val => {
            const cleanVal = val === null || val === undefined
              ? ""
              : String(val).replace(/"/g, '""');
            return `"${cleanVal}"`;
          }).join(";")
        )
      ].join("\n");

      const blob = new Blob(["\uFEFF" + csvContent], {
        type: "text/csv;charset=utf-8;"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = historyExportAll
        ? `historico_movimentacoes_completo_${getTodayIsoDate()}.csv`
        : `historico_movimentacoes_${histDateStart}_a_${histDateEnd}.csv`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Erro ao exportar histórico:", error);
      alert("Não foi possível exportar o histórico. Verifique a conexão com o Supabase.");
    } finally {
      setHistoryExportLoading(false);
    }
  };

  // --- DIVERGÊNCIAS CORRECTION ---
  const [selectedDivergênciaId, setSelectedDivergênciaId] = useState<string | null>(null);
  const [resolveAction, setResolveAction] = useState<string>("sobrescrever");
  const [resolveQty, setResolveQty] = useState<number>(0);
  const [resolveAlternativeSlot, setResolveAlternativeSlot] = useState<string>("");

  const openCorrectionDialog = (div: Divergencia) => {
    setSelectedDivergênciaId(div.id);
    setResolveQty(Math.abs(div.movimentacao));
    // Focus recommended vacant slots
    const firstFree = slots.find(s => s.estoque === div.estoque && s.saldo === 0);
    if (firstFree) {
      setResolveAlternativeSlot(`${firstFree.modulo} - ${firstFree.posicao}`);
    } else {
      setResolveAlternativeSlot("");
    }
  };

  // Action manual corrector tool
  const handleResolveDivergência = () => {
    if (!selectedDivergênciaId) return;

    const div = divergencias.find(d => d.id === selectedDivergênciaId);
    if (!div) return;

    const updatedSlots = [...slots];
    const updatedDivs = divergencias.map(d => {
      if (d.id === selectedDivergênciaId) {
        return {
          ...d,
          status: "Corrigida" as const,
          dataCorrecao: new Date().toLocaleDateString("pt-BR"),
          corrigidoPor: operator,
          observacao: `Ajuste efetuado por correção manual pelo operador ${operator}. Ação: ${resolveAction.toUpperCase()}`
        };
      }
      return d;
    });

    const targetPos = div.estoque === "E1" ? "" : div.posicao;

    if (resolveAction === "sobrescrever") {
      const target = updatedSlots.find(s => 
        s.estoque === div.estoque && 
        s.modulo === div.modulo && 
        s.posicao === targetPos
      );
      if (target) {
        const prod = productsList.find(p => p.referencia.toUpperCase() === div.refNova.toUpperCase());
        target.referencia = div.refNova;
        target.descricao = prod ? prod.descricao : "Sku Reajustado";
        target.saldo = resolveQty;
        target.ultimaData = new Date().toLocaleDateString("pt-BR");
        target.ultimoResponsavel = operator;
      }
    } else if (resolveAction === "realocar") {
      const parts = resolveAlternativeSlot.split(" - ");
      const mod = parts[0]?.trim();
      const pos = div.estoque === "E1" ? "" : parts[1]?.trim();

      const target = updatedSlots.find(s => 
        s.estoque === div.estoque && 
        s.modulo === mod && 
        s.posicao === pos
      );
      if (target) {
        const prod = productsList.find(p => p.referencia.toUpperCase() === div.refNova.toUpperCase());
        target.referencia = div.refNova;
        target.descricao = prod ? prod.descricao : "Sku Realocado";
        target.saldo = resolveQty;
        target.ultimaData = new Date().toLocaleDateString("pt-BR");
        target.ultimoResponsavel = operator;
      }
    } else if (resolveAction === "descartar") {
      const target = updatedSlots.find(s => 
        s.estoque === div.estoque && 
        s.modulo === div.modulo && 
        s.posicao === targetPos
      );
      if (target) {
        target.referencia = "";
        target.descricao = "";
        target.saldo = 0;
        target.dataChacote = "";
      }
    }

    setSlots(updatedSlots);
    setDivergencias(updatedDivs);

    // Save adjustment record in history logs
    const compensationHistory: HistoricoMov = {
      id: `MOV-${generateId()}`,
      dataLancamento: new Date().toLocaleDateString("pt-BR"),
      quemLancou: operator,
      data: new Date().toLocaleDateString("pt-BR"),
      estoque: div.estoque,
      modulo: div.modulo,
      posicao: targetPos,
      referencia: div.refNova,
      quantidade: resolveQty,
      tipo: "Entrada",
      dataChacote: "",
      hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      responsavel: operator
    };
    setHistory([compensationHistory, ...history]);

    setSelectedDivergênciaId(null);
    alert("Divergência resolvida com êxito! O saldo físico lógico de armazenagem foi corrigido.");
  };

  const handleExportCSV = () => {
    const headers = "Data Divergência;Tipo Divergência;Estoque;Módulo;Posição;Ref Atual;Ref Nova;Saldo Lógico;Movimentação Intentada;Saldo Final;Responsável;Status\n";
    const rowsCSV = divergencias.map(d => 
      `"${d.dataDivergencia}";"${d.tipoDivergencia}";"${d.estoque}";"${d.modulo}";"${d.posicao}";"${d.refAtual}";"${d.refNova}";"${d.saldoAntes}";"${d.movimentacao}";"${d.saldoFinal}";"${d.responsavel}";"${d.status}"`
    ).join("\n");

    const blob = new Blob(["\uFEFF" + headers + rowsCSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Divergencias_Enderecamento_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintDivergenciais = () => {
    window.print();
  };

  const handleClearSlotsFilter = () => {
    setSearchRef("");
    setSearchDesc("");
    setFilterEstoque("");
    setFilterGalpao("");
    setSearchObservacao("");
    setSearchModulo("");
    setSearchPosicao("");
    setSearchPage(1);
  };

  // --- COMPILATING SYSTEM VIEWS ---
  const productsByReference = useMemo(
    () => new globalThis.Map(productsList.map(product => [product.referencia, product])),
    [productsList]
  );

  const filteredSlots = useMemo(() => {
    const normalizedSearchRef = searchRef.trim().toLowerCase();
    const normalizedSearchDesc = searchDesc.trim().toLowerCase();
    const normFilterEst = filterEstoque ? filterEstoque.replace("E", "") : "";
    const normalizedFilterGalpao = filterGalpao.trim();
    const normalizedSearchObservacao = searchObservacao.trim().toLowerCase();
    const normalizedSearchModulo = searchModulo.replace(/^[RM]/i, "");
    const normalizedSearchPosicao = searchPosicao.replace(/^[RMG]/i, "").toUpperCase();
    const normalizedSearchPosicaoText = searchPosicao.trim().toLowerCase();

    return slots.filter(s => {
      const matchesRef = normalizedSearchRef
        ? s.referencia.toLowerCase() === normalizedSearchRef
        : true;

      const matchesDesc = normalizedSearchDesc
        ? s.descricao.toLowerCase().includes(normalizedSearchDesc)
        : true;

      const matchesEstoque = normFilterEst
        ? s.estoque.replace("E", "") === normFilterEst
        : true;

      const matchesGalpao = normalizedFilterGalpao
        ? String(s.galpao || "3") === normalizedFilterGalpao
        : true;

      const matchesObservacao = normalizedSearchObservacao
        ? String(s.observacao || "").toLowerCase().includes(normalizedSearchObservacao)
        : true;

      const matchesModulo = normalizedSearchModulo
        ? s.modulo.replace(/^[RM]/i, "").includes(normalizedSearchModulo)
        : true;

      const matchesPosicao = normalizedSearchPosicao
        ? (
            s.posicao.replace(/^[RMG]/i, "").toUpperCase().includes(normalizedSearchPosicao) ||
            (normalizedSearchPosicaoText === "corredor" && s.posicao === "") ||
            (s.posicao === "" && "corredor".includes(normalizedSearchPosicaoText))
          )
        : true;

      if (somenteAcimaPaletizacao) {
        const produto = productsByReference.get(s.referencia);

        if (!produto?.paletizacao || s.saldo <= produto.paletizacao) {
          return false;
        }
      }

      return (
        matchesRef &&
        matchesDesc &&
        matchesEstoque &&
        matchesGalpao &&
        matchesObservacao &&
        matchesModulo &&
        matchesPosicao
      );
    });
  }, [
    slots,
    productsByReference,
    searchRef,
    searchDesc,
    filterEstoque,
    filterGalpao,
    searchObservacao,
    searchModulo,
    searchPosicao,
    somenteAcimaPaletizacao
  ]);

  const filteredSlotsTotalSaldo = useMemo(
    () => filteredSlots.reduce((acc, s) => acc + s.saldo, 0),
    [filteredSlots]
  );

  const totalSearchPages = Math.max(
    1,
    Math.ceil(filteredSlots.length / PRODUCT_SEARCH_PAGE_SIZE)
  );

  const effectiveSearchPage = Math.min(searchPage, totalSearchPages);

  const paginatedFilteredSlots = useMemo(() => {
    const start = (effectiveSearchPage - 1) * PRODUCT_SEARCH_PAGE_SIZE;
    return filteredSlots.slice(start, start + PRODUCT_SEARCH_PAGE_SIZE);
  }, [filteredSlots, effectiveSearchPage]);

  const filteredBaseProducts = productsList.filter(p => 
    p.referencia.toLowerCase().includes(baseSearch.toLowerCase()) ||
    p.descricao.toLowerCase().includes(baseSearch.toLowerCase())
  );

    const handleExportConsolidationPDF = () => {
  console.log("jsPDF teste:", jsPDF);
      
  const doc = new jsPDF();

  let y = 20;

  doc.setFontSize(16);
  doc.text("PORTO BRASIL", 10, y);

  y += 10;

  doc.setFontSize(14);
  doc.text("PLANO DE CONSOLIDACAO", 10, y);

  y += 10;

  doc.setFontSize(10);
  doc.text(
    `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    10,
    y
  );

  y += 15;

  const opportunities: any[] = [];

  const skuMap: Record<
    string,
    {
      saldo: number;
      descricao: string;
      posicoes: WarehouseSlot[];
    }
  > = {};

  slots.forEach(slot => {

    if (!slot.referencia || slot.saldo <= 0)
      return;

    if (!skuMap[slot.referencia]) {

      skuMap[slot.referencia] = {
        saldo: 0,
        descricao: slot.descricao,
        posicoes: []
      };

    }

    skuMap[slot.referencia].saldo += slot.saldo;

    skuMap[slot.referencia].posicoes.push(slot);

  });

  Object.entries(skuMap).forEach(
    ([sku, data]) => {

      if (data.posicoes.length < 2)
        return;

      const produto =
        productsList.find(
          p => p.referencia === sku
        );
      
      if (!produto?.paletizacao)
        return;
      
      const posicoesNecessarias =
        Math.ceil(
          data.saldo / produto.paletizacao
        );
      
      const posicoesAtuais =
        data.posicoes.length;
      
      const ganho =
        posicoesAtuais -
        posicoesNecessarias;
      
      if (ganho > 0) {
      
        opportunities.push({
          sku,
          descricao: data.descricao,
          saldo: data.saldo,
          capacidade: produto.paletizacao,
          posicoes: data.posicoes,
          posicoesNecessarias,
          ganho
        });
      
      }
    }
  );
  
  opportunities.forEach(
    (item, index) => {

     const sorted =
      [...item.posicoes].sort(
        (a, b) => b.saldo - a.saldo
      );
    
    const destinos =
      sorted.slice(
        0,
        item.posicoesNecessarias
      );
    
    const origens =
      sorted.slice(
        item.posicoesNecessarias
      );
    
    const destinosComCapacidade =
      destinos.map(d => ({
        slot: d,
        livre:
          item.capacidade - d.saldo,
        saldoFinal:
          d.saldo
      }));
    
    const movimentacoes: string[] = [];
    
    origens.forEach(origem => {
    
      let restante =
        origem.saldo;
    
      destinosComCapacidade.forEach(
        destino => {
    
          if (
            restante <= 0 ||
            destino.livre <= 0
          )
            return;
    
          const mover =
            Math.min(
              restante,
              destino.livre
            );
    
          movimentacoes.push(
            `Mover ${mover.toLocaleString("pt-BR")} peças de E${origem.estoque} M${origem.modulo} ${origem.posicao} para E${destino.slot.estoque} M${destino.slot.modulo} ${destino.slot.posicao}`
          );
    
          restante -= mover;
    
          destino.livre -= mover;
    
          destino.saldoFinal += mover;
    
        }
      );
    
    });

      if (y > 260) {

        doc.addPage();

        y = 20;

      }

      doc.setFont(
        "helvetica",
        "bold"
      );
      
      doc.setFontSize(12);
      
      doc.text(
        `${index + 1}) SKU ${item.sku}`,
        10,
        y
      );

      doc.line(
        10,
        y,
        200,
        y
      );
      
      y += 6;
      
      doc.setFont(
        "helvetica",
        "normal"
      );

      y += 6;

      doc.text(
        item.descricao,
        10,
        y
      );

      y += 6;

      doc.text(
        `Saldo Total: ${item.saldo.toLocaleString("pt-BR")}`,
        10,
        y
      );
      
      y += 6;
      
      doc.text(
        `Paletizacao: ${item.capacidade}`,
        10,
        y
      );
      
      y += 6;
      
      doc.text(
        `Posicoes atuais: ${item.posicoes.length}`,
        10,
        y
      );
      
      y += 6;
      
      doc.text(
        `Posicoes necessarias: ${item.posicoesNecessarias}`,
        10,
        y
      );
      
      y += 8;
      
     doc.setFont(
        "helvetica",
        "bold"
      );
      
      doc.text(
        "MOVIMENTACOES",
        10,
        y
      );
      
      doc.setFont(
        "helvetica",
        "normal"
      );
      
      y += 6;
      
      movimentacoes.forEach(m => {
      
        doc.text(
          m,
          15,
          y
        );
      
        y += 6;
      
      });
      
      y += 3;
      
      doc.setFont(
        "helvetica",
        "bold"
      );
      
      doc.text(
        "POSICOES LIBERADAS",
        10,
        y
      );
      
      doc.setFont(
        "helvetica",
        "normal"
      );
      
      y += 6;
      
      origens.forEach(o => {
      
        doc.text(
          `E${o.estoque} M${o.modulo} ${o.posicao}`,
          15,
          y
        );
      
        y += 6;
      
      });
      
      doc.setFont(
        "helvetica",
        "bold"
      );
      
      doc.text(
        `GANHO ESTIMADO: +${item.ganho} POSICOES`,
        10,
        y
      );
      
      doc.setFont(
        "helvetica",
        "normal"
      );
      
      y += 8;

      doc.line(
        10,
        y,
        200,
        y
      );
      
      y += 8;
      
      y += 6;

    }
  );

  doc.save(
    `Plano_Consolidacao_${
      new Date()
        .toISOString()
        .slice(0,10)
    }.pdf`
  );

};
    
  // --- CONVERSATIONAL AI MODEL CO-PILOT ---
  const [chatMessages, setChatMessages] = useState([
    { 
      sender: "system", 
      text: "Olá! Sou o Assistente Inteligente de Estoque da Porto Brasil. Como as versões Básica e Avançada estão interligadas, monitoro o layout físico de E1, E2, E3 em tempo real. Me pergunte coisas como:\n- 'Qual o item mais estocado?'\n- 'Existem divergências em aberto?'\n- 'Indique uma vaga para colocar 111'" 
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [recommendationQueue, setRecommendationQueue] = useState<string[]>([]);

  const formatMobileSlot = (slot: WarehouseSlot): string =>
    `E${slot.estoque} • M${slot.modulo}${slot.posicao ? ` • ${slot.posicao}` : ""}`;

  const findSkuInChatText = (text: string): string | null => {
    const normalizeReference = (value: string) => {
      const clean = value.trim().toUpperCase();
      return clean.startsWith("S") ? clean.slice(1) : clean;
    };

    const normalizedText = text.toUpperCase();
    const normalizedReferences = productsList.map(product => ({
      reference: product.referencia,
      normalized: normalizeReference(product.referencia),
    }));

    const byReference = normalizedReferences.find(({ reference, normalized }) =>
      normalizedText.includes(reference.toUpperCase()) ||
      normalizedText.includes(normalized)
    );
    if (byReference) return byReference.reference;

    const byDescription = productsList.find(product =>
      product.descricao && normalizedText.includes(product.descricao.toUpperCase())
    );
    if (byDescription) return byDescription.referencia;

    const tokens = normalizedText.match(/[A-Z0-9]{4,}/g) || [];
    const byToken = tokens.find(token =>
      normalizedReferences.some(({ normalized }) => normalized === normalizeReference(token))
    );

    return byToken
      ? normalizedReferences.find(({ normalized }) => normalized === normalizeReference(byToken))?.reference || null
      : null;
  };

  const handleNextRecommendation = () => {
    const next = recommendationQueue[0];
    if (!next) return;
    setRecommendationQueue(prev => prev.slice(1));
    setChatMessages(messages => [...messages, { sender: "system", text: next }]);
  };

  const handleSendChatMessage = (messageOverride?: string) => {
    const userMessage = (messageOverride ?? chatInput).trim();
    if (!userMessage) return;
    setChatMessages(prev => [...prev, { sender: "user", text: userMessage }]);
    setChatInput("");

    setTimeout(() => {
      let responseText = "";
      
      const lower = userMessage.toLowerCase().trim();

      if (lower === "próximo" || lower === "proximo" || lower === "outra opção" || lower === "outra opcao") {
        if (recommendationQueue.length > 0) {
          const [next, ...rest] = recommendationQueue;
          setRecommendationQueue(rest);
          responseText = next;
        } else {
          responseText = "Não há outra recomendação pendente. Faça uma nova pergunta para recalcular as opções.";
        }
      } else if (
        lower.includes("melhor local") ||
        lower.includes("melhor posição") ||
        lower.includes("melhor posicao") ||
        lower.includes("onde armazenar") ||
        lower.includes("onde devo armazenar") ||
        lower.includes("local para armazenar") ||
        Boolean(findSkuInChatText(userMessage) && (
          /^s?[a-z0-9-]{4,}$/i.test(userMessage.replace(/\s+/g, "")) ||
          lower.includes("onde fica") ||
          lower.includes("posição") ||
          lower.includes("posicao")
        ))
      ) {
        const skuRecommendation = findSkuInChatText(userMessage);

        if (!skuRecommendation) {
          responseText = "Informe o SKU ou a descrição do produto para eu calcular a melhor posição de armazenamento.";
        } else {
          const product = productsList.find(
            item => item.referencia.toUpperCase() === skuRecommendation.toUpperCase()
          );
          const requestedQtyMatch = userMessage.match(/(\d[\d.]*)\s*(?:pç|pçs|peças|pecas|unidades|un)/i);
          const requestedQty = requestedQtyMatch
            ? Number(requestedQtyMatch[1].replace(/\./g, ""))
            : 1;
          const requestedType =
            /gaiola|aranha/i.test(userMessage) ? "3" :
            /palete/i.test(userMessage) ? "2" :
            null;

          const exitsLast7Days = history.filter(item => {
            const movementDate = new Date(item.data);
            const daysAgo = (Date.now() - movementDate.getTime()) / 86400000;
            return (
              item.referencia.toUpperCase() === skuRecommendation.toUpperCase() &&
              item.tipo === "Saída" &&
              daysAgo >= 0 &&
              daysAgo <= 7
            );
          }).length;

          const candidates = slots
            .filter(slot => {
              if (slot.estoque === "1") return false;
              if (requestedType && slot.estoque !== requestedType) return false;
              if (slot.saldo > 0 && slot.referencia.toUpperCase() !== skuRecommendation.toUpperCase()) return false;
              if (product?.paletizacao && slot.saldo + requestedQty > product.paletizacao) return false;
              return true;
            })
            .map(slot => {
              const sameSku = slot.referencia.toUpperCase() === skuRecommendation.toUpperCase() && slot.saldo > 0;
              const free = slot.saldo === 0;
              let score = 0;
              if (sameSku) score += 100;
              if (free) score += 35;
              if (product?.paletizacao) {
                const remaining = product.paletizacao - slot.saldo - requestedQty;
                score += Math.max(0, 25 - Math.min(25, Math.abs(remaining)));
              }
              score += Math.min(20, exitsLast7Days * 2);
              if (requestedType === slot.estoque) score += 20;
              return { slot, score, sameSku, free };
            })
            .sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              return Number(a.slot.modulo) - Number(b.slot.modulo);
            });

          if (candidates.length === 0) {
            responseText = `Não encontrei uma posição válida para ${skuRecommendation} com os critérios atuais.`;
          } else {
            const [best, ...alternatives] = candidates;
            const reasons = [
              best.sameSku ? "consolida o SKU em uma posição que já possui o item" : "posição disponível para receber o item",
              product?.paletizacao ? `respeita a paletização cadastrada de ${product.paletizacao} pçs` : "não há paletização cadastrada para limitar a capacidade",
              exitsLast7Days > 0 ? `${exitsLast7Days} saída(s) do SKU nos últimos 7 dias` : "não há saídas recentes registradas para o SKU",
              best.slot.estoque === "2" ? "estrutura de palete (Estoque 2)" : "estrutura de gaiola/aranha (Estoque 3)",
            ];

            responseText =
              `MELHOR POSIÇÃO PARA ${skuRecommendation}\n\n` +
              `${formatMobileSlot(best.slot)}\n` +
              `${best.slot.descricao || product?.descricao || "Produto"}\n\n` +
              `Critérios considerados:\n• ${reasons.join("\n• ")}\n\n` +
              `A recomendação usa somente o estado registrado do estoque.`;

            setRecommendationQueue(
              alternatives.slice(0, 4).map((candidate, index) =>
                `PRÓXIMA OPÇÃO ${index + 2}\n\n${formatMobileSlot(candidate.slot)}\n${candidate.slot.descricao || product?.descricao || "Produto"}\n\nSaldo atual: ${candidate.slot.saldo.toLocaleString("pt-BR")} pçs.`
              )
            );
          }
        }
      } else if (
        lower.includes("melhor palete") ||
        lower.includes("melhor palete para separ") ||
        lower.includes("qual palete") ||
        lower.includes("separação") ||
        lower.includes("separacao")
      ) {
        const skuRecommendation = findSkuInChatText(userMessage);

        if (!skuRecommendation) {
          responseText = "Informe o SKU ou a descrição do produto para eu selecionar o melhor palete.";
        } else {
          const requestedQtyMatch = userMessage.match(/(\d[\d.]*)\s*(?:pç|pçs|peças|pecas|unidades|un)/i);
          const requestedQty = requestedQtyMatch
            ? Number(requestedQtyMatch[1].replace(/\./g, ""))
            : 1;

          const candidates = slots
            .filter(slot =>
              slot.referencia.toUpperCase() === skuRecommendation.toUpperCase() &&
              slot.saldo > 0 &&
              slot.estoque === "2"
            )
            .map(slot => {
              const chacoteTime = slot.dataChacote
                ? new Date(slot.dataChacote).getTime()
                : Number.MAX_SAFE_INTEGER;
              return {
                slot,
                enough: slot.saldo >= requestedQty,
                chacoteTime: Number.isFinite(chacoteTime) ? chacoteTime : Number.MAX_SAFE_INTEGER,
              };
            })
            .sort((a, b) => {
              if (a.enough !== b.enough) return a.enough ? -1 : 1;
              if (a.chacoteTime !== b.chacoteTime) return a.chacoteTime - b.chacoteTime;
              return b.slot.saldo - a.slot.saldo;
            });

          if (candidates.length === 0) {
            responseText = `Não encontrei paletes com saldo do SKU ${skuRecommendation}.`;
          } else {
            const [best, ...alternatives] = candidates;
            responseText =
              `MELHOR PALETE PARA SEPARAÇÃO\n\n` +
              `${formatMobileSlot(best.slot)}\n` +
              `SKU ${best.slot.referencia} • ${best.slot.saldo.toLocaleString("pt-BR")} pçs\n` +
              `Data de chacote: ${best.slot.dataChacote || "não registrada"}\n\n` +
              `Critérios: FIFO pela data de chacote registrada + quantidade disponível.\n` +
              `${best.enough ? "Atende a quantidade solicitada." : "Não atende integralmente a quantidade solicitada; veja a próxima opção."}\n\n` +
              `Se a condição física estiver diferente do sistema, use Próximo.`;

            setRecommendationQueue(
              alternatives.slice(0, 4).map((candidate, index) =>
                `PRÓXIMA OPÇÃO ${index + 2}\n\n${formatMobileSlot(candidate.slot)}\nSKU ${candidate.slot.referencia} • ${candidate.slot.saldo.toLocaleString("pt-BR")} pçs\nData de chacote: ${candidate.slot.dataChacote || "não registrada"}`
              )
            );
          }
        }
      } else if (
        lower.includes("remont") ||
        lower.includes("consolidar") ||
        lower.includes("liberar posição") ||
        lower.includes("liberar posicao")
      ) {
        const requestedSku = findSkuInChatText(userMessage);
        const grouped: Record<string, WarehouseSlot[]> = {};

        slots.forEach(slot => {
          if (
            slot.referencia &&
            slot.saldo > 0 &&
            (!requestedSku || slot.referencia.toUpperCase() === requestedSku.toUpperCase())
          ) {
            if (!grouped[slot.referencia]) grouped[slot.referencia] = [];
            grouped[slot.referencia].push(slot);
          }
        });

        const candidates = Object.entries(grouped)
          .filter(([, itemSlots]) => itemSlots.length > 1)
          .map(([skuKey, itemSlots]) => {
            const product = productsList.find(p => p.referencia.toUpperCase() === skuKey.toUpperCase());
            const capacity = product?.paletizacao || 0;
            const total = itemSlots.reduce((sum, slot) => sum + slot.saldo, 0);
            const required = capacity > 0 ? Math.ceil(total / capacity) : itemSlots.length;
            return {
              sku: skuKey,
              slots: itemSlots,
              gain: Math.max(0, itemSlots.length - required),
              capacity,
            };
          })
          .filter(item => item.gain > 0 || Boolean(requestedSku))
          .sort((a, b) => b.gain - a.gain);

        if (candidates.length === 0) {
          responseText = "Não encontrei uma oportunidade clara de remontagem/consolidação com os dados registrados.";
        } else {
          const best = candidates[0];
          const ordered = [...best.slots].sort((a, b) => b.saldo - a.saldo);
          const destinationCount = best.capacity > 0
            ? Math.max(1, Math.ceil(ordered.reduce((sum, slot) => sum + slot.saldo, 0) / best.capacity))
            : Math.max(1, ordered.length - best.gain);
          const destinations = ordered.slice(0, destinationCount);
          const origins = ordered.slice(destinationCount);

          responseText =
            `MELHOR OPORTUNIDADE DE REMONTAGEM\n\n` +
            `SKU ${best.sku}\n` +
            `${best.slots[0].descricao}\n\n` +
            `Posições atuais: ${best.slots.length}\n` +
            `Posições necessárias: ${destinations.length}\n` +
            `Potencial de liberação: ${best.gain} posição(ões)\n\n` +
            `Priorize manter:\n${destinations.map(slot => `• ${formatMobileSlot(slot)} — ${slot.saldo.toLocaleString("pt-BR")} pçs`).join("\n")}\n\n` +
            `Candidatas à liberação:\n${origins.length > 0 ? origins.map(slot => `• ${formatMobileSlot(slot)} — ${slot.saldo.toLocaleString("pt-BR")} pçs`).join("\n") : "Nenhuma posição adicional foi calculada."}`;

          setRecommendationQueue([]);
        }
      } else if (
      lower.includes("pulverizado")
    ) {


  const skuMap: Record<
    string,
    {
      posicoes: number;
      saldo: number;
      descricao: string;
      locais: string[];
    }
  > = {};

  slots.forEach(slot => {

    if (!slot.referencia || slot.saldo <= 0)
      return;

    if (!skuMap[slot.referencia]) {

      skuMap[slot.referencia] = {
        posicoes: 0,
        saldo: 0,
        descricao: slot.descricao,
        locais: []
      };

    }
    
    skuMap[slot.referencia].posicoes += 1;

    skuMap[slot.referencia].saldo +=
      slot.saldo;

    skuMap[slot.referencia].locais.push(
      `E${slot.estoque} • M${slot.modulo} • ${slot.posicao}`
    );

  });
    
    const maisPulverizado =
      Object.entries(skuMap)
        .sort(
          (a, b) =>
            b[1].posicoes -
            a[1].posicoes
        )[0];
  
    if (maisPulverizado) {
  
      const [
        sku,
        dados
      ] = maisPulverizado;

      const estoques = new Set<string>();

      const modulos = new Set<string>();
      
      let e2Count = 0;
      let e3Count = 0;
      
      slots.forEach(slot => {
      
        if (
          slot.referencia === sku &&
          slot.saldo > 0
        ) {
      
          estoques.add(slot.estoque);
      
          modulos.add(
            `${slot.estoque}-${slot.modulo}`
          );
      
          if (slot.estoque === "2")
            e2Count++;
      
          if (slot.estoque === "3")
            e3Count++;
      
        }
      
      });
      
     responseText =

        `SKU mais pulverizado\n\n` +
      
        `${sku}\n` +
      
        `${dados.descricao}\n\n` +
      
        `Posições: ${dados.posicoes}\n` +
      
        `Módulos envolvidos: ${modulos.size}\n` +
      
        `Saldo total: ${dados.saldo.toLocaleString()} peças\n\n` +
      
        `Distribuição:\n` +
      
        `E2 → ${e2Count} posições\n` +
      
        `E3 → ${e3Count} posições\n\n` +
      
        `Impacto:\n` +
      
        `Alta dispersão operacional para inventários e movimentações.`;
  
    } else {
  
      responseText =
        "Nenhum SKU encontrado.";
  
    }
  
  }
        else if (
  lower.includes("liberar espaço")
) {

  const opportunities: any[] = [];

  const skuMap: Record<
    string,
    {
      saldo: number;
      descricao: string;
      posicoes: WarehouseSlot[];
    }
  > = {};

  slots.forEach(slot => {

    if (!slot.referencia || slot.saldo <= 0)
      return;

    if (!skuMap[slot.referencia]) {

      skuMap[slot.referencia] = {
        saldo: 0,
        descricao: slot.descricao,
        posicoes: []
      };

    }
    
        skuMap[slot.referencia].saldo +=
          slot.saldo;
    
        skuMap[slot.referencia].posicoes.push(
          slot
        );
    
      });
    
     Object.entries(skuMap).forEach(
      ([sku, data]) => {
    
        if (data.posicoes.length < 2)
          return;
    
        const produto =
          productsList.find(
            p => p.referencia === sku
          );
    
        if (!produto?.paletizacao)
          return;
    
        const posicoesNecessarias =
          Math.ceil(
            data.saldo /
            produto.paletizacao
          );
    
        const posicoesAtuais =
          data.posicoes.length;
    
        const ganho =
          posicoesAtuais -
          posicoesNecessarias;
    
        if (ganho > 0) {
    
          opportunities.push({
            sku,
            descricao: data.descricao,
            saldo: data.saldo,
            capacidade:
              produto.paletizacao,
            posicoes:
              data.posicoes,
            posicoesNecessarias,
            ganho
          });
    
        }
    
      }
    );
    
    opportunities.sort(
      (a, b) => b.ganho - a.ganho
    );
          
    if (opportunities.length === 0) {

        responseText =
          "Nenhuma oportunidade de consolidação foi encontrada.";
      
      } else {
      
        const totalLiberacoes =
          opportunities.reduce(
            (acc, item) =>
              acc + item.ganho,
            0
          );
        
        responseText =
          `ANÁLISE DE CONSOLIDAÇÃO\n\n` +
        
          `Oportunidades encontradas: ${opportunities.length}\n\n` +
        
          `Potencial total: +${totalLiberacoes} posições\n\n` +
        
          `Top oportunidades:\n\n` +
        
          opportunities
            .slice(0, 10)
            .map(
              (item, index) =>
        
                `${index + 1}º SKU ${item.sku}\n` +
                `${item.descricao}\n` +
                `Ganho: +${item.ganho} posições\n`
            )
            .join("\n");
      
        }
      
      }

        else if (
      lower.includes("plano")
    ) {
    
      const opportunities: any[] = [];
    
      const skuMap: Record<
        string,
        {
          saldo: number;
          descricao: string;
          posicoes: WarehouseSlot[];
        }
      > = {};
    
      slots.forEach(slot => {
    
        if (!slot.referencia || slot.saldo <= 0)
          return;
    
        if (!skuMap[slot.referencia]) {
    
          skuMap[slot.referencia] = {
            saldo: 0,
            descricao: slot.descricao,
            posicoes: []
          };
    
        }
    
        skuMap[slot.referencia].saldo += slot.saldo;
    
        skuMap[slot.referencia].posicoes.push(slot);
    
      });
    
      Object.entries(skuMap).forEach(
        ([sku, data]) => {
      
          if (data.posicoes.length < 2)
            return;
      
          const produto =
            productsList.find(
              p => p.referencia === sku
            );
      
          if (!produto?.paletizacao)
            return;
      
          const posicoesNecessarias =
            Math.ceil(
              data.saldo /
              produto.paletizacao
            );
      
          const posicoesAtuais =
            data.posicoes.length;
      
          const ganho =
            posicoesAtuais -
            posicoesNecessarias;
      
          if (ganho > 0) {
      
            opportunities.push({
              sku,
              descricao: data.descricao,
              saldo: data.saldo,
              capacidade:
                produto.paletizacao,
              posicoes:
                data.posicoes,
              posicoesNecessarias,
              ganho
            });
      
          }
      
        }
      );
    
      if (opportunities.length === 0) {
    
        responseText =
          "Nenhuma oportunidade de consolidação encontrada.";
    
      } else {
    
        responseText =
          `PLANO DE CONSOLIDAÇÃO\n\n`;
    
        opportunities.forEach(
          (item, index) => {
    
            const sorted =
            [...item.posicoes].sort(
              (a, b) => b.saldo - a.saldo
            );
          
          const destinos =
            sorted.slice(
              0,
              item.posicoesNecessarias
            );
          
          const origens =
            sorted.slice(
              item.posicoesNecessarias
            );
          
          const destinosComCapacidade =
            destinos.map(d => ({
              slot: d,
              livre:
                item.capacidade - d.saldo,
              saldoFinal:
                d.saldo
            }));
          
          const movimentacoes: string[] = [];
          
          origens.forEach(origem => {
          
            let restante =
              origem.saldo;
          
            destinosComCapacidade.forEach(
              destino => {
          
                if (
                  restante <= 0 ||
                  destino.livre <= 0
                )
                  return;
          
                const mover =
                  Math.min(
                    restante,
                    destino.livre
                  );
          
                movimentacoes.push(
          
                  `Mover ${mover.toLocaleString("pt-BR")} peças de ` +
                  `E${origem.estoque} M${origem.modulo} ${origem.posicao} ` +
                  `para ` +
                  `E${destino.slot.estoque} M${destino.slot.modulo} ${destino.slot.posicao}`
          
                );
          
                restante -= mover;
          
                destino.livre -= mover;
          
                destino.saldoFinal += mover;
          
              }
            );
          
          });
    
           responseText +=

            `${index + 1}) SKU ${item.sku}\n` +
          
            `${item.descricao}\n\n` +
          
            `Saldo total: ${item.saldo.toLocaleString("pt-BR")}\n` +
          
            `Paletização: ${item.capacidade}\n\n` +
          
            `Posições atuais: ${item.posicoes.length}\n` +
          
            `Posições necessárias: ${item.posicoesNecessarias}\n\n` +
            
             `Posições destino:\n` +

            destinosComCapacidade
              .map(
                d =>
            
                  `• E${d.slot.estoque} M${d.slot.modulo} ${d.slot.posicao}` +
                  ` → Saldo final: ${d.saldoFinal}`
              )
              .join("\n") +
            
            `\n\nPlano de movimentação:\n\n` +
  
             movimentacoes.join("\n") +

            `\n\nPosições liberadas:\n` +

            origens
              .map(
                o =>
                  `✓ E${o.estoque} M${o.modulo} ${o.posicao}`
              )
              .join("\n") +
             
              `\n\nGanho estimado: +${item.ganho} posição(ões)\n\n` +
    
              `----------------------------\n\n`;
    
          }
        );
    
      }
    
    }
          
      else if (lower.includes("item") || lower.includes("produto") || lower.includes("mais estocado") || lower.includes("maior saldo")) {
        const activeItemMap: Record<string, { qty: number, desc: string }> = {};
        slots.forEach(s => {
          if (s.saldo > 0) {
            activeItemMap[s.referencia] = {
              qty: (activeItemMap[s.referencia]?.qty || 0) + s.saldo,
              desc: s.descricao
            };
          }
        });

        const sorted = Object.entries(activeItemMap).sort((a,b) => b[1].qty - a[1].qty);
        if (sorted.length > 0) {
          responseText = `O produto mais estocado logicamente no sistema é o SKU **${sorted[0][0]}** (${sorted[0][1].desc}) com **${sorted[0][1].qty.toLocaleString()} peças** no total, divididas e consolidadas nas estruturas físicas.`;
        } else {
          responseText = "Não existem produtos com saldo em estoque neste momento.";
        }
      } else if (lower.includes("diverg") || lower.includes("erro") || lower.includes("aberto")) {
        const abertas = divergencias.filter(d => d.status === "Aberta");
        if (abertas.length > 0) {
          responseText = `Possuímos atualmente **${abertas.length} divergências em aberto**. Segue o resumo das localizações:\n\n` +
            abertas.map(a => `• **${a.tipoDivergencia}** em: *${a.estoque} • Módulo ${a.modulo} • Gaveta: ${a.posicao || "Rua"}* (SKU: ${a.refNova})`).join("\n");
        } else {
          responseText = "Excelente! Todas as divergências foram resolvidas e sincronizadas com a base física.";
        }
      } else if (lower.includes("indique") || lower.includes("recomenda") || lower.includes("livre") || lower.includes("colocar")) {
        // Find a vacant slot
        const emptySlot = slots.find(s => s.saldo === 0);
        if (emptySlot) {
          responseText = `Recomendo utilizar o local **Estoque ${emptySlot.estoque} • Módulo ${emptySlot.modulo} ${emptySlot.posicao ? `• Posição ${emptySlot.posicao}` : "" }** para armazenamento, pois está atualmente livre e possui excelente face física para manobras de paletes.`;
        } else {
          responseText = "Todas as vagas representativas estão ocupadas. Por favor, libere espaços consolidando saldos no E1 ou E2.";
        }
      } else {
        responseText = `Entendido. Registrei sua solicitação operacional. O lote sequencial ativo no momento está mapeado e pronto para consolidação lógica. Você pode consultar o Gêmeo Digital ou me enviar novas perguntas.`;
      }

      setChatMessages(prev => [...prev, { sender: "system", text: responseText }]);
    }, 600);
  };


  // --- LOCK SCREEN CONDITIONAL RENDERING ON NOT LOGGED IN ---
  if (!currentUser) {
    return (
      <div className="h-screen w-full bg-slate-900 flex items-center justify-center p-4" id="login-container">
        
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl space-y-6">
          <div className="text-center space-y-1.5">
            <div className="w-12 h-12 bg-blue-600 rounded-xl mx-auto flex items-center justify-center text-white text-xl font-black shadow-md border border-blue-500">
              PB
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white uppercase pt-2">Porto Brasil Cerâmica</h1>
            <p className="text-xs text-slate-400 font-medium font-sans">Controle Físico e Lógico de Endereçamento</p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="text-[10px] text-slate-400 font-black tracking-wider uppercase block mb-1">Nome de Usuário</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="E-mail, usuário ou nome"
                  required
                  className="w-full bg-slate-950 text-white border border-slate-700 rounded-lg p-3 text-xs pl-9 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                />
                <User className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 font-black tracking-wider uppercase block mb-1">Senha de Segurança</label>
              <div className="relative">
                <input 
                  type="password" 
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Insira a senha"
                  required
                  className="w-full bg-slate-950 text-white border border-slate-700 rounded-lg p-3 text-xs pl-9 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                />
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
              </div>
            </div>

            {loginError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-2.5 rounded-lg text-xs font-semibold text-center leading-normal">
                {loginError}
              </div>
            )}

            <button 
              type="submit"
              disabled={authLoading}
              className="w-full bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 text-white rounded-lg p-3 text-xs font-bold transition shadow shadow-blue-600/20 uppercase"
            >
              {authLoading ? "Autenticando..." : "Acessar Painel"}
            </button>
          </form>
        </div>

      </div>
    );
  }

  const role = normalizeRole(currentUser.role);
  const isReadOnly = isReadOnlyRole(currentUser.role);
  const canAccessBatchLaunch = canExecuteOperations(currentUser.role);
  const canExecuteBatchLaunch = canExecuteOperations(currentUser.role);

  const hasAccess = (requiredLevel: "administrador" | "operador" | "consulta"): boolean => {
    if (!currentUser) return false;

    if (requiredLevel === "administrador") {
      return isAdmin(currentUser.role);
    }

    if (requiredLevel === "operador") {
      return canExecuteOperations(currentUser.role);
    }

    return true;
  };

  const canAccessTab = (tab: string): boolean => {
    if (!currentUser) return false;

    if (tab === "corredor" && appMode !== "avancado") {
      return false;
    }

    switch (role) {
      case "administrador":
        return true;
      case "lideranca":
        return ["dashboard", "endereçamento", "lançamento", "histórico", "divergências", "base"].includes(tab);
      case "apoio":
        return ["endereçamento", "lançamento", "histórico", "divergências"].includes(tab);
      case "producao":
        return ["endereçamento", "lançamento", "histórico", "divergências"].includes(tab);
      case "visualizador":
        return ["dashboard", "endereçamento", "lançamento", "histórico", "divergências", "base"].includes(tab);
      default:
        return false;
    }
  };

  const mobileActiveTab = (
    ["endereçamento", "lançamento", "divergências", "histórico", "ai"] as const
  ).includes(activeTab as any)
    ? activeTab
    : "endereçamento";

  if (isMobileViewport) {
    return (
      <MobileShell
        currentUser={currentUser}
        operator={operator}
        slots={slots}
        productsList={productsList}
        history={historyQueryRows ?? history}
        divergencias={divergencias}
        online={isOnline}
        canExecute={canExecuteOperations(currentUser.role)}
        activeTab={mobileActiveTab}
        onTabChange={tab => setActiveTab(tab)}
        onUnitaryLaunch={handleUnitaryLaunch}
        onTransferPosition={handleTransferPosition}
        onResolveDivergencia={handleMobileResolveDivergencia}
        chatMessages={chatMessages}
        chatInput={chatInput}
        onChatInputChange={setChatInput}
        onSendChatMessage={handleSendChatMessage}
        recommendationAvailable={recommendationQueue.length > 0}
        onNextRecommendation={handleNextRecommendation}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="h-screen w-full bg-[#f8fafc] text-slate-800 font-sans overflow-hidden border-8 border-slate-200 flex flex-col md:flex-row antialiased">
      
      {/* SIDEBAR NAVIGATION MAIN SYSTEM */}
      <aside className="w-full md:w-56 bg-slate-900 text-white flex flex-col h-full shrink-0 no-print">
        
        {/* App Title Header Banner */}
        <div className="p-4 border-b border-slate-800 flex items-center space-x-2.5">
          <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center font-bold text-white shadow shadow-blue-500/20">P</div>
          <div className="leading-tight">
            <span className="block font-black text-xs tracking-tight text-white uppercase">Porto Brasil</span>
            <span className="text-[9px] text-[#4dd0e1] block font-extrabold uppercase">Base Integrada v3.0</span>
          </div>
        </div>

        {/* Dynamic Navigation Menu */}
        <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto">
          <span className="text-[9px] text-slate-500 font-extrabold block pb-1.5 px-4 uppercase tracking-wider">Módulos Logísticos</span>
          
          {canAccessTab("dashboard") && (

              <button
            onClick={() => setActiveTab("dashboard")}
            className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
              activeTab === "dashboard"
                ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400"
                : "hover:bg-slate-800 text-slate-350"
            }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span>DASHBOARD</span>
            </button>
          )}

          {canAccessTab("endereçamento") && (
            <button
              onClick={() => setActiveTab("endereçamento")}
              className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "endereçamento" 
                  ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                  : "hover:bg-slate-800 text-slate-350"
              }`}
            >
              <Search className="w-4 h-4 shrink-0" />
              <span>PESQUISA PRODUTOS</span>
            </button>
          )}

          {canAccessTab("lançamento") && (
            <button
              onClick={() => setActiveTab("lançamento")}
              className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "lançamento" 
                  ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                  : "hover:bg-slate-800 text-slate-350"
              }`}
            >
              <PlusCircle className="w-4 h-4 shrink-0" />
              <span>LANÇAMENTO</span>
            </button>
          )}

          {canAccessTab("corredor") && (
            <button
              onClick={() => setActiveTab("corredor")}
              className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "corredor" 
                  ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                  : "hover:bg-slate-800 text-slate-350"
              }`}
            >
              <Map className="w-4 h-4 shrink-0" />
              <span>ENDEREÇO CORREDOR</span>
            </button>
          )}

          {canAccessTab("histórico") && (
            <button
              onClick={() => setActiveTab("histórico")}
              className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "histórico" 
                  ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                  : "hover:bg-slate-800 text-slate-350"
              }`}
            >
              <History className="w-4 h-4 shrink-0" />
              <span>HISTÓRICO</span>
            </button>
          )}

          {canAccessTab("divergências") && (
            <button
              onClick={() => setActiveTab("divergências")}
              className={`w-full flex items-center justify-between px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "divergências" 
                  ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                  : "hover:bg-slate-800 text-slate-350"
              }`}
            >
              <span className="flex items-center space-x-3">
                <AlertOctagon className="w-4 h-4 shrink-0" />
                <span>DIVERGÊNCIAS</span>
              </span>
              {divergencias.filter(d => d.status === "Aberta").length > 0 && (
                <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                  {divergencias.filter(d => d.status === "Aberta").length}
                </span>
              )}
            </button>
          )}

          {canAccessTab("base") && (
            <button
              onClick={() => setActiveTab("base")}
              className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "base" 
                  ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                  : "hover:bg-slate-800 text-slate-350"
              }`}
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>BASE DE DADOS</span>
            </button>
          )}

          {/* Render advanced sections if any advanced tab is accessible */}
          {(canAccessTab("mapa") || canAccessTab("ai")) && (
            <>
              <span className="text-[9px] text-slate-500 font-extrabold block pt-4 pb-1.5 px-4 uppercase tracking-wider">Avançado & Controle</span>

              {canAccessTab("mapa") && (
                 <button
                  onClick={() => {
                    setAppMode("avancado");
                    setActiveTab("mapa");
                  }}
                  className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                    activeTab === "mapa" 
                      ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                      : "hover:bg-slate-800 text-slate-350"
                  }`}
                >
                  <Map className="w-4 h-4 shrink-0" />
                  <span>GÊMEO DIGITAL</span>
                </button>
              )}

              {canAccessTab("ai") && (
                <button
                  onClick={() => {
                    setAppMode("avancado");
                    setActiveTab("ai");
                  }}
                  className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                    activeTab === "ai" 
                      ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                      : "hover:bg-slate-800 text-slate-350"
                  }`}
                >
                  <Bot className="w-4 h-4 shrink-0" />
                  <span>CONSULTOR IA</span>
                </button>
              )}
            </>
          )}

          {/* Admin exclusive users tab */}
          {canAccessTab("users") && (
            <button
              onClick={() => setActiveTab("users")}
              className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "users" 
                  ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                  : "hover:bg-slate-800 text-slate-350"
              }`}
            >
              <Users className="w-4 h-4 shrink-0 text-slate-400" />
              <span>CONTROLE DE USUÁRIOS</span>
            </button>
          )}

        </nav>

        {/* Linked Version Selector */}
        <div className="p-4 border-t border-slate-800">
          <div className="text-[9px] text-slate-500 uppercase font-extrabold mb-1.5 tracking-wider">Acesso de Versão</div>
          <div className="flex bg-slate-950 rounded-lg p-0.5 border border-slate-800">
            <button
              onClick={() => setAppMode("basico")}
              className={`flex-1 py-1 text-[9px] rounded font-bold transition uppercase ${
                appMode === "basico" 
                  ? "bg-slate-800 text-white" 
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Básico
            </button>
            <button
              onClick={() => setAppMode("avancado")}
              className={`flex-1 py-1 text-[9px] rounded font-bold transition uppercase ${
                appMode === "avancado" 
                  ? "bg-slate-800 text-white" 
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Avançado
            </button>
          </div>
        </div>

        {/* Sidebar user profile indicator footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950 text-[11px] leading-tight space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center font-bold text-white text-[10px]">
                {currentUser.username[0].toUpperCase()}
              </div>
              <div className="truncate max-w-[100px]">
                <span className="font-extrabold text-slate-200 block text-xs truncate leading-none">{currentUser.name}</span>
                <span className="text-[9px] text-slate-450 block font-semibold pt-0.5">{currentUser.role}</span>
              </div>
            </div>
            
            <button 
              onClick={handleLogout}
              title="Desconectar do terminal de endereçamento"
              className="p-1 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </aside>

      {/* PRIMARY WORKSPACE */}
      <main className="flex-1 flex flex-col overflow-y-auto pb-10">
        
        {/* UPPER STATUS BAR HEADER */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 no-print shrink-0 shadow-2xs">
          <div className="flex items-center space-x-3">
            <h1 className="text-sm font-black text-slate-700 font-sans tracking-tight uppercase">Módulo de Estoque • Porto Brasil</h1>
            {appMode === "avancado" && (
              <span className="bg-sky-50 text-sky-800 text-[9px] font-black px-2 py-0.5 rounded border border-sky-200 uppercase">
                Gêmeo Digital Sincronizado
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[11px] text-slate-400 font-mono italic hover:text-blue-600 block">GALPÃO DE LOGÍSTICA ATIVO</span>
            
            {/* Operator configurations */}
            <div className="flex items-center gap-1.5 p-1 text-[11px]">
              <span className="text-slate-450 font-bold uppercase text-[9px]">Data Lançamento: </span>
              <input 
                type="date"
                value={launchDate}
                disabled
                className="bg-white border border-slate-300 rounded px-1.5 py-0.5 font-bold text-slate-755 text-slate-800 text-xs focus:outline-none"
              />
              <span className="text-slate-455 font-bold uppercase text-[9px] ml-1">Responsável:</span>
              <input 
                type="text"
                value={operator}
                disabled
                className="bg-white border border-slate-300 rounded px-1.5 py-0.5 max-w-[120px] font-bold text-slate-800 text-xs focus:outline-none"
              />
            </div>
          </div>
        </header>

        {/* COMPONENT TAB CONTAINER WRAPPER */}
        <div className="p-6 flex-1 space-y-6">
          
          {/* TAB 1: DASHBOARD VIEW */}
            {activeTab === "dashboard" && canAccessTab("dashboard") && (
              <div className="space-y-6">
              
              {/* Linked versions feedback info */}
              <div className="bg-slate-800 rounded-xl p-5 text-white bg-linear-to-r from-slate-900 to-slate-800 shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border border-slate-700">
                <div>
                  <h3 className="text-md font-extrabold uppercase tracking-wide">Fábrica Integrada • Porto Brasil Cerâmica</h3>
                  <p className="text-xs text-slate-300 max-w-2xl mt-1 leading-normal font-medium">
                    Plataforma de endereçamento integrada de dados lógicos. A versão básica e a versão avançada estão conectadas: os lançamentos e as correções do módulo de divergências atualizam o Gêmeo Digital em tempo real.
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => {
                      if (!hasAccess("operador")) {
                        alert("Permissão necessária. Sendo conta 'Consulta' você não pode lançar registros.");
                        return;
                      }
                      setActiveTab("lançamento");
                    }}
                    className="bg-white text-slate-900 hover:bg-slate-100 px-4 py-2 rounded-lg text-xs font-black transition shadow cursor-pointer uppercase"
                  >
                    Efetuar Lançamentos
                  </button>
                  <button
                    onClick={() => setAppMode(appMode === "basico" ? "avancado" : "basico")}
                    className="bg-slate-700 hover:bg-slate-650 border border-slate-600 text-white px-4 py-2 rounded-lg text-xs font-black transition cursor-pointer uppercase"
                  >
                    {appMode === "basico" ? "Ativar Modo Avançado" : "Ativar Modo Básico"}
                  </button>
                </div>
              </div>

              {/* Stat dashboard component */}
              <DashboardCards
                slots={slots}
                history={history}
                divergencias={divergencias}
                productsList={productsList}
                occupiedPalletsE1={occupiedPalletsE1}
                appMode={appMode}
                canPerformActions={canExecuteOperations(currentUser?.role)}
              />

              {/* Graphic indicators */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Physical shelf occupancy gauge */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] text-blue-600 font-bold block uppercase mb-1">Capacidade de Ocupação</span>
                    <h4 className="text-md font-black text-slate-800 uppercase tracking-tight">Ocupação por Estoque</h4>
                    <p className="text-xs text-slate-400 mt-1 mb-4 leading-normal">
                      Vagas ocupadas fisicamente por setor de armazenagem do Galpão.
                    </p>

                    <div className="space-y-4 pt-1 font-mono text-xs">
                      {["1", "2", "3"].map(est => {
                
                        let total = 0;
                        let occupied = 0;
                        
                        if (est === "1") {
                          total = 657;
                          occupied = occupiedPalletsE1;
                        }
                        
                        if (est === "2") {
                          total = 1373;
                          occupied = new Set(
                            slots
                              .filter(s => s.estoque === "2" && s.saldo > 0)
                              .map(getPhysicalAddressKey)
                          ).size;
                        }
                        
                        if (est === "3") {
                          total = 1288;
                          occupied = new Set(
                            slots
                              .filter(s => s.estoque === "3" && s.saldo > 0)
                              .map(getPhysicalAddressKey)
                          ).size;
                        }
                        
                        const pct = total > 0 ? (occupied / total) * 100 : 0;
                
                        return (
                          <div key={est} className="flex items-center gap-3">
                            <span className="w-20 text-slate-600 font-bold block shrink-0"> Estoque {est}</span>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
                              <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${Math.max(1, pct)}%` }}></div>
                            </div>
                            <span className="w-24 text-right text-slate-500 text-[10px]">{occupied} de {total}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setAppMode("avancado");
                      setActiveTab("mapa");
                    }}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition rounded-lg py-2.5 mt-6 border border-slate-250 shadow-xs uppercase tracking-wider"
                  >
                    Visualizar Gêmeo Digital (2D)
                  </button>
                </div>

                {/* AI advisor Teaser */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] text-amber-600 font-bold block uppercase mb-1">Diagnóstico IA</span>
                    <h4 className="text-md font-black text-slate-800 uppercase tracking-tight">Sugestão de Endereço</h4>
                    <p className="text-xs text-slate-400 mt-1 mb-4 leading-normal">
                      Algoritmo inteligente integrado monitorando vagas vazias e divergência de palete.
                    </p>

                    <div className="bg-amber-50/70 border border-amber-200/50 p-4 rounded-xl text-xs text-amber-900 space-y-1.5 font-sans leading-normal">
                      <span className="font-bold flex items-center gap-1.5 text-amber-850">
                        <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                        Consolidação Recomendada:
                      </span>
                      <p>Há registros com referências e descrições idênticas pulverizadas em gavetas diferentes. Recomenda-se realizar consolidação no **Estoque E2 Módulo M100** para resgatar paletes livres.</p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setAppMode("avancado");
                      setActiveTab("ai");
                    }}
                    className="w-full bg-amber-500/10 border border-amber-200 text-amber-820 hover:bg-amber-500/25 text-amber-800 text-xs font-black transition rounded-lg py-2.5 mt-6 uppercase tracking-wider"
                  >
                    Conversar com Diagnóstico IA
                  </button>
                </div>

              </div>

            </div>
          )}

          {/* TAB 2: PESQUISA PRODUTOS (Endereçamento search grid) */}
          {activeTab === "endereçamento" && (
            <div className="space-y-6">
              
              {/* Filter coordinates */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Filtro de Logística e Endereçamento</h3>
                  <div className="flex items-center gap-4">
                    {(
                      isAdmin(currentUser?.role) ||
                      normalizeRole(currentUser?.role) === "lideranca"
                    ) && (
                    <button 
                      onClick={handleExportarEnderecamento}
                      className="text-xs text-indigo-600 hover:text-indigo-800 transition font-bold cursor-pointer flex items-center gap-1.5 font-sans uppercase tracking-wider text-[11px]"
                    >
                      <Download className="w-3.5 h-3.5 text-indigo-500" />
                      Exportar Endereçamento (CSV)
                    </button>
                  )}
                    <button 
                      onClick={handleClearSlotsFilter}
                      className="text-xs text-slate-400 hover:text-blue-600 transition font-medium cursor-pointer font-sans uppercase tracking-wider text-[11px]"
                    >
                      Limpar Filtros
                    </button>
                    <button
                      onClick={handleExportarEnderecamentoPDF}
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-xs font-bold"
                    >
                      Exportar PDF
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
                  {appMode === "basico" ? (
                    <>
                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Buscar SKU</label>
                        <input 
                          type="text" 
                          value={searchRef}
                          onChange={(e) => { setSearchRef(e.target.value); setSearchPage(1); }}
                          placeholder="EX: 092"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase font-mono font-bold"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Estoque</label>
                        <select
                          value={filterEstoque}
                          onChange={(e) => { setFilterEstoque(e.target.value); setSearchPage(1); }}
                          className="w-full border border-slate-300 bg-white rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                        >
                          <option value="">Todos</option>
                          <option value="E1">1</option>
                          <option value="E2">2</option>
                          <option value="E3">3</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={somenteAcimaPaletizacao}
                          onChange={(e) => {
                            setSomenteAcimaPaletizacao(e.target.checked);
                            setSearchPage(1);
                          }}
                        />
                      
                        <label className="text-xs font-bold text-indigo-600">
                          Apenas acima da paletização
                        </label>
                      </div>
                      
                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Módulo / Rua</label>
                        <input 
                          type="text" 
                          value={searchModulo}
                          onChange={(e) => { setSearchModulo(e.target.value); setSearchPage(1); }}
                          placeholder="Ex: 11"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase font-mono font-bold"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Posição</label>
                        <input 
                          type="text" 
                          value={searchPosicao}
                          onChange={(e) => { setSearchPosicao(e.target.value); setSearchPage(1); }}
                          placeholder="Ex: A1"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase font-mono font-bold"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Local Geral</label>
                        <input 
                          type="text" 
                          value="GALPAO" 
                          disabled
                          className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs font-bold font-mono text-slate-500"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Referência SKU</label>
                        <input 
                          type="text" 
                          value={searchRef}
                          onChange={(e) => { setSearchRef(e.target.value); setSearchPage(1); }}
                          placeholder="Ex: 092, 132"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase font-mono font-bold"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-455 font-bold block uppercase mb-1">Descrição Produto</label>
                        <input 
                          type="text" 
                          value={searchDesc}
                          onChange={(e) => { setSearchDesc(e.target.value); setSearchPage(1); }}
                          placeholder="Ex: RASO, COUP, ETC"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Estoque</label>
                        <select
                          value={filterEstoque}
                          onChange={(e) => { setFilterEstoque(e.target.value); setSearchPage(1); }}
                          className="w-full border border-slate-300 bg-white rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                        >
                          <option value="">Todos (E1, E2, E3)</option>
                          <option value="E1">Estoque 1 (E1)</option>
                          <option value="E2">Estoque 2 (E2)</option>
                          <option value="E3">Estoque 3 (E3)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Galpão</label>
                        <select
                          value={filterGalpao}
                          onChange={(e) => { setFilterGalpao(e.target.value); setSearchPage(1); }}
                          className="w-full border border-slate-300 bg-white rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                        >
                          <option value="">Todos</option>
                          <option value="3">Galpão 3</option>
                          <option value="12">Galpão 12</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Observação</label>
                        <input
                          type="text"
                          value={searchObservacao}
                          onChange={(e) => { setSearchObservacao(e.target.value); setSearchPage(1); }}
                          placeholder="Buscar observação"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Stats header */}
              <div className="flex justify-between items-center bg-slate-100 text-slate-600 text-xs px-4 py-2 border border-slate-200 rounded-lg font-medium">
                <span>Total de <strong>{filteredSlots.length}</strong> endereços correspondendo aos filtros inseridos.</span>
                <span>Saldo físico total localizado: <strong>{filteredSlotsTotalSaldo.toLocaleString()} pçs</strong></span>
              </div>

              {/* Data Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto overflow-y-auto max-h-[650px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600 uppercase text-[10px] tracking-wider border-b border-slate-200">
                        <th className="py-3 px-4 font-bold font-mono">Estoque</th>
                        <th className="py-3 px-4 font-bold">Módulo / Rua</th>
                        <th className="py-3 px-4 font-bold">Posição</th>
                        <th className="py-3 px-4 font-bold font-mono text-center">Referência SKU</th>
                        <th className="py-3 px-4 font-bold text-center">Restrição</th>
                        <th className="py-3 px-4 font-bold">Descrição do Item</th>
                        <th className="py-3 px-4 font-bold text-right">Saldo Logístico (pçs)</th>
                        <th className="py-3 px-4 font-bold">Data Chacote</th>
                        <th className="py-3 px-4 font-bold">Última data de movimentação</th>
                        <th className="py-3 px-4 font-bold">Última hora de movimentação</th>
                        <th className="py-3 px-4 font-bold">Responsável</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {filteredSlots.length > 0 ? (
                        paginatedFilteredSlots.map((s) => {
                          const isOccupied = s.saldo > 0;
                        
                          const produto = productsByReference.get(s.referencia);
                        
                          const acimaPaletizacao =
                            produto?.paletizacao &&
                            s.saldo > produto.paletizacao;
                        
                          return (
                            <tr key={s.id} className="hover:bg-slate-50 border-b border-slate-100">
                              <td className="py-3 px-4 font-black text-blue-600 font-mono">{s.estoque.replace("E", "")}</td>
                              <td className="py-3 px-4 font-bold font-mono text-slate-800">{s.modulo.replace(/^[RM]/i, "")}</td>
                              <td className="py-3 px-4 font-bold font-mono text-slate-700">{s.posicao || "—"}</td>
                              <td className="py-3 px-4 text-center">
                                {isOccupied ? (
                                  <span className="bg-blue-50 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded font-mono border border-blue-200">
                                    {s.referencia}
                                  </span>
                                ) : (
                                  <span className="text-slate-300 font-bold block">—</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {isOccupied ? (
                                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${
                                    (s.restricao || "nenhuma") === "nenhuma"
                                      ? "bg-slate-50 text-slate-600 border-slate-200"
                                      : (s.restricao || "") === "teste"
                                        ? "bg-orange-50 text-orange-700 border-orange-200"
                                        : (s.restricao || "") === "autorizacao"
                                          ? "bg-red-50 text-red-700 border-red-200"
                                          : "bg-purple-50 text-purple-700 border-purple-200"
                                  }`}>
                                    {s.restricao || "nenhuma"}
                                  </span>
                                ) : (
                                  <span className="text-slate-300 font-bold block">—</span>
                                )}
                              </td>
                              <td className="py-3 px-4 truncate max-w-[200px]">
                                {isOccupied ? s.descricao : <span className="text-slate-300 italic font-normal">Vaga desocupada</span>}
                              </td>
                             <td className="py-3 px-4 text-right font-black pr-6">
                              {isOccupied ? (
                                <span
                                  className={
                                    acimaPaletizacao
                                      ? "text-indigo-600"
                                      : "text-slate-800"
                                  }
                                >
                                  {s.saldo.toLocaleString()} pçs
                                </span>
                              ) : (
                                <span className="text-slate-300 font-normal">—</span>
                              )}
                            </td>
                              <td className="py-3 px-4 font-mono text-slate-550">{isOccupied ? (s.dataChacote || "—") : "—" }</td>
                              <td className="py-3 px-4 font-mono text-slate-500">{isOccupied ? s.ultimaData : "—"}</td>
                              <td className="py-3 px-4 font-mono text-slate-500">{isOccupied ? s.ultimaHora : "—"}</td>
                              <td className="py-3 px-4 text-slate-705 font-bold">{isOccupied ? s.ultimoResponsavel : "—"}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={12} className="py-20 text-center text-slate-400 font-medium bg-slate-50">
                            Nenhum endereço correspondente aos filtros de pesquisa inseridos.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {filteredSlots.length > 0 && (
                <div className="flex flex-col gap-3 border border-slate-200 rounded-xl bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs font-medium text-slate-500">
                    Mostrando{" "}
                    <strong className="text-slate-700">
                      {(effectiveSearchPage - 1) * PRODUCT_SEARCH_PAGE_SIZE + 1}
                    </strong>
                    {" "}a{" "}
                    <strong className="text-slate-700">
                      {Math.min(
                        effectiveSearchPage * PRODUCT_SEARCH_PAGE_SIZE,
                        filteredSlots.length
                      )}
                    </strong>
                    {" "}de{" "}
                    <strong className="text-slate-700">{filteredSlots.length}</strong>
                    {" "}endereços
                  </div>

                  <div className="flex items-center gap-1 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setSearchPage(page => Math.max(1, page - 1))}
                      disabled={effectiveSearchPage === 1}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50"
                    >
                      Anterior
                    </button>

                    {Array.from({ length: totalSearchPages }, (_, index) => index + 1)
                      .filter(page =>
                        page === 1 ||
                        page === totalSearchPages ||
                        Math.abs(page - effectiveSearchPage) <= 2
                      )
                      .map((page, index, visiblePages) => {
                        const previousPage = visiblePages[index - 1];
                        const showEllipsis = previousPage && page - previousPage > 1;

                        return (
                          <span key={page} className="flex items-center gap-1">
                            {showEllipsis && (
                              <span className="px-1 text-xs text-slate-400">…</span>
                            )}
                            <button
                              type="button"
                              onClick={() => setSearchPage(page)}
                              className={`min-w-8 rounded-lg border px-2 py-1.5 text-xs font-bold ${
                                page === effectiveSearchPage
                                  ? "border-indigo-600 bg-indigo-600 text-white"
                                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              {page}
                            </button>
                          </span>
                        );
                      })}

                    <button
                      type="button"
                      onClick={() =>
                        setSearchPage(page => Math.min(totalSearchPages, page + 1))
                      }
                      disabled={effectiveSearchPage === totalSearchPages}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50"
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* TAB 3: LANÇAMENTO EM LOTE (Travas validator spreadsheet) */}
          {activeTab === "lançamento" && (
            <div className="space-y-6">
              
              {/* If advanced mode, offer a toggle between Lançamento Unitário and Lançamento em Lote */}
              {appMode === "avancado" && (
                <div className="flex bg-slate-100 p-1.5 rounded-xl max-w-lg border border-slate-200">
                  <button
                    onClick={() => !isReadOnly && setSelectedLaunchType("unitario")}
                    disabled={isReadOnly}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider ${
                      selectedLaunchType === "unitario"
                        ? "bg-white text-indigo-700 shadow-sm border border-slate-200/55"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <PlusCircle className="w-3.5 h-3.5 text-indigo-500" />
                    Lançamento Unitário (Igual Corredor)
                  </button>
                  <button
                    onClick={() => setSelectedLaunchType("lote")}
                    disabled={!canAccessBatchLaunch}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider ${
                      selectedLaunchType === "lote"
                        ? "bg-white text-indigo-700 shadow-sm border border-slate-200/55"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-500" />
                    Lançamento em Lote (Excel)
                  </button>
                </div>
              )}

              {appMode === "avancado" && selectedLaunchType === "unitario" ? (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                  {/* Left Column - Form exactly styled like AisleStoragePanel */}
                  <div className="lg:col-span-1 bg-white border border-slate-200 p-5 rounded-xl shadow-xs space-y-4 h-fit">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5 pb-2 border-b border-slate-100">
                      <PlusCircle className="w-4 h-4 text-indigo-600" />
                      Lançador Operacional
                    </span>

                    {isReadOnly ? (
                    <div className="space-y-3">
                      <div className="border border-red-200 bg-red-50 rounded-lg p-4">
                        <p className="text-xs font-bold text-red-700 leading-relaxed">
                          Apenas contas Administrador podem realizar movimentações de estoque.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 font-sans">
                      
                      <div>
                        <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">Selecionar Estoque</label>
                        <select
                          value={unitEstoque}
                          onChange={(e) => setUnitEstoque(e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold text-slate-800 focus:outline-none"
                        >
                          <option value="1">1</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">Nº Corredor / Rua</label>
                        <input
                          type="text"
                          value={unitCorredor}
                          onChange={(e) => setUnitCorredor(e.target.value)}
                          placeholder="Ex: 11"
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono text-slate-800"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">
                          Posição {unitEstoque === "1" ? "(Inativa E1)" : "(Opcional Corredor)"}
                        </label>
                        <input
                          type="text"
                          value={unitEstoque === "1" ? "" : unitPosicao}
                          disabled={unitEstoque === "1"}
                          onChange={(e) => setUnitPosicao(e.target.value)}
                          placeholder={unitEstoque === "1" ? "SEM POSIÇÃO" : "Ex: A1, B3"}
                          className={`w-full border rounded p-2 text-xs font-bold uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono ${
                            unitEstoque === "1" ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed" : "bg-white text-slate-800 border-slate-300"
                          }`}
                        />
                        {unitEstoque !== "1" && (
                          <span className="text-[9px] text-slate-400 block mt-1 leading-tight">
                            Deixe vazio para armazenar no Corredor (Vão livre)
                          </span>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-455 block font-bold mb-1 uppercase">Código SKU (Referência)</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={unitSku}
                            onChange={(e) => setUnitSku(e.target.value)}
                            placeholder="Ex: 21401G"
                            className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-black uppercase tracking-wide focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono text-slate-800"
                          />
                          {matchedUnitProduct && (
                            <span className="absolute right-2.5 top-2.5 text-emerald-500 animate-pulse">
                              <Sparkles className="w-3.5 h-3.5 text-amber-500 font-extrabold" title="Produto cadastrado!" />
                            </span>
                          )}
                        </div>
                        {matchedUnitProduct ? (
                          <span className="text-[10px] text-emerald-600 font-bold block mt-1 leading-tight truncate">
                            ✓ {matchedUnitProduct.descricao}
                          </span>
                        ) : unitSku.trim() ? (
                          <span className="text-[10px] text-red-500 font-bold block mt-1 leading-tight">
                            ✗ SKU não cadastrado
                          </span>
                        ) : null}
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">Quantidade (Peças)</label>
                        <input
                          type="number"
                          value={unitQuantidade}
                          onChange={(e) => setUnitQuantidade(e.target.value === "" ? "" : Math.max(1, parseInt(e.target.value)))}
                          placeholder="Ex: 500"
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-mono font-bold text-slate-800 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">Data Chacote (Opcional)</label>
                        <input
                          type="text"
                          value={unitChacote}
                          onChange={(e) => setUnitChacote(e.target.value)}
                          placeholder="DD/MM/AAAA"
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold uppercase focus:outline-none text-slate-800 font-mono"
                          inputMode="numeric"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">Galpão</label>
                        <select
                          value={unitGalpao}
                          onChange={(e) => {
                            const value = e.target.value as Galpao;
                            setUnitGalpao(value);
                            if (value === "12") setUnitRestricao("autorizacao");
                          }}
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold text-slate-800 focus:outline-none"
                        >
                          <option value="3">Galpão 3</option>
                          <option value="12">Galpão 12</option>
                        </select>
                        {unitGalpao === "12" && (
                          <span className="mt-1 block text-[9px] font-black uppercase text-red-600">
                            🔴 Solicitar autorização
                          </span>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">Restrição</label>
                        <select
                          value={unitGalpao === "12" ? "autorizacao" : unitRestricao}
                          onChange={(e) => setUnitRestricao(e.target.value as Restricao)}
                          disabled={unitGalpao === "12"}
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold text-slate-800 focus:outline-none disabled:bg-slate-100"
                        >
                          <option value="nenhuma">Nenhuma</option>
                          <option value="teste">Teste — não separar</option>
                          <option value="autorizacao">Solicitar autorização</option>
                          <option value="outra">Outra restrição</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 block font-bold mb-1 uppercase">Observação</label>
                        <textarea
                          value={unitObservacao}
                          onChange={(e) => setUnitObservacao(e.target.value)}
                          placeholder="Observação do palete/movimentação"
                          rows={2}
                          className="w-full resize-none rounded border border-slate-300 bg-white p-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                           disabled={isReadOnly}
                          onClick={() => !isReadOnly && handleUnitaryLaunch("Entrada")}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 text-xs font-bold transition shadow-xs cursor-pointer uppercase text-center font-bold"
                        >
                          Entrada
                        </button>
                        <button
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => !isReadOnly && handleUnitaryLaunch("Saída")}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 text-xs font-bold transition shadow-xs cursor-pointer uppercase text-center font-bold"
                        >
                          Saída
                        </button>
                      </div>
                    </div>
                    )}
                  </div>

                  {/* Right Column - Slots listing or active sessional slots */}
                  <div className="lg:col-span-3 bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-slate-100">
                      <div>
                        <h4 className="text-sm font-bold text-slate-800">Situação Real-time das Posições</h4>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Lista geral dos endereços físicos e posições em vão livre para consulta instantânea do operador.
                        </p>
                      </div>
                      <div className="text-xs text-slate-500 font-mono font-bold">
                        Regras de corredor ativas para Estoques E2 e E3.
                      </div>
                    </div>

                    <div className="overflow-x-auto overflow-y-auto max-h-[650px]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-200 text-slate-500 uppercase text-[9px] tracking-wider font-bold">
                            <th className="py-2.5 px-3 w-16">Estoque</th>
                            <th className="py-2.5 px-3">Módulo / Rua</th>
                            <th className="py-2.5 px-3">Posição</th>
                            <th className="py-2.5 px-3 text-center">Referência</th>
                            <th className="py-2.5 px-3">Descrição Produto</th>
                            <th className="py-2.5 px-3 text-right">Saldo (pçs)</th>
                            <th className="py-2.5 px-3 text-center font-mono">Último Operador</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700 font-medium font-bold">
                          {slots.slice(0, 150).map((s) => {
                            const isOccupied = s.saldo > 0;
                            return (
                              <tr key={s.id} className="hover:bg-slate-50 border-b border-slate-100">
                                <td className="py-2.5 px-3 font-bold text-blue-600 font-mono">E{s.estoque}</td>
                                <td className="py-2.5 px-3 font-bold font-mono text-slate-800">RM{s.modulo}</td>
                                <td className="py-2.5 px-3 font-mono font-bold text-slate-600">
                                  {s.posicao === "" ? (
                                    <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200/50 px-1.5 py-0.5 rounded font-sans uppercase font-bold">Corredor</span>
                                  ) : (
                                    s.posicao
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-center font-bold font-mono text-xs">
                                  {isOccupied ? (
                                    <span className="bg-blue-50 text-blue-800 px-1.5 py-0.5 rounded border border-blue-100 font-black">
                                      {s.referencia}
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-[11px] truncate max-w-[200px]" title={s.descricao}>
                                  {s.descricao || <span className="text-slate-350 italic font-mono">Posição vazia</span>}
                                </td>
                                <td className={`py-2.5 px-3 text-right font-bold ${isOccupied ? "text-slate-800" : "text-slate-350"}`}>
                                  {s.saldo.toLocaleString()} pçs
                                </td>
                                <td className="py-2.5 px-3 text-center text-[10px] text-slate-400 font-mono truncate max-w-[120px]">
                                  {s.ultimoResponsavel || "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
                  
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100 mb-6 font-sans">
                    <div>
                      <h3 className="text-md font-bold text-slate-850">
                        Painel de Lançamento em Lote (Travas Ativas)
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Ficha simplificada para lançar múltiplos paletes. Preenchimentos de Módulo e Coordenadas com travas seguras em tempo real.
                      </p>
                    </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleExportarLayout}
                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" /> 
                      Exportar Layout
                    </button>
                    <button
                      onClick={() => setShowBulkImport(!showBulkImport)}
                      className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-lg px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" /> 
                      {showBulkImport ? "Ocultar Colagem Rápida" : "Colar do Excel / CSV"}
                    </button>
                    <button
                      onClick={() => canExecuteBatchLaunch && handleLancarLote()}
                      disabled={!canExecuteBatchLaunch}
                      className="bg-indigo-600 hover:bg-indigo-750 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-5 py-2 text-xs font-bold transition shadow-sm uppercase tracking-wider cursor-pointer"
                    >
                      Lançar Lote Completo
                    </button>
                    {lancamentoRows.length > 0 && (
                      <button
                        onClick={clearLancamentoDraft}
                        className="bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-lg px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Limpar rascunho
                      </button>
                    )}
                  </div>
                </div>

                {/* BULK IMPORT TEXTAREA */}
                {showBulkImport && (
                  <div className="bg-indigo-50/50 rounded-xl p-5 border border-indigo-200/50 mb-6 space-y-4">
                    <span className="text-xs font-black text-indigo-900 flex items-center gap-1.5 uppercase">
                      <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                      Importar do Excel (Semicolons ou Tabs)
                    </span>
                    <p className="text-xs text-slate-500 leading-normal font-medium max-w-3xl">
                      Cole linhas copiadas da planilha. O parser preencherá colunas: **Código SKU**, **Quantidade**, **Tipo [Entrada/Saída]**, **Estoque [E1/E2/E3]**, **Módulo [Rua ou Módulo]**, **Gaveta [Somente E2/E3]**.
                    </p>

                    <textarea
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      placeholder="Cole colunas do Excel aqui..."
                      className="w-full h-24 bg-white border border-slate-300 rounded-lg p-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                    />

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => canExecuteBatchLaunch && handleImportExcelData()}
                        disabled={!canExecuteBatchLaunch}
                        className="bg-indigo-650 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-xs font-bold transition shadow-sm"
                      >
                        Carregar Lançamentos
                      </button>
                      <span className="text-xs font-bold text-indigo-700">{bulkFeedback}</span>
                    </div>
                  </div>
                )}

                {/* TABULAR ENTRY SYSTEM WITH ADVANCED DYNAMIC LAYOUT FIELD CORRECTIONS */}
                <div className="overflow-x-auto pt-2">
                  <div className="min-w-[1550px] border border-slate-350 rounded-xl overflow-hidden bg-slate-50 shadow-inner">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 text-[10px] uppercase font-bold tracking-wider">
                            <th className="w-20 text-center">
                              <div className="flex flex-col gap-1">
                                <span>#</span>
                            
                                <input
                                  value={filtroLinhaLote}
                                  onChange={(e) => setFiltroLinhaLote(e.target.value)}
                                  placeholder="Linha"
                                  className="w-full border rounded p-1 text-xs bg-white"
                                />
                              </div>
                            </th>
                            <th className="py-2.5 px-3 w-32">Data do Lançamento</th>
                            <th className="py-2.5 px-3 w-28">Galpão</th>
                            <th className="py-2.5 px-3 w-36">
                                <div className="flex flex-col gap-1">
                                  <span>Estoque</span>
                              
                                  <select
                                    value={filtroEstoqueLote}
                                    onChange={(e) => setFiltroEstoqueLote(e.target.value)}
                                    className="w-full border rounded p-1 text-xs bg-white"
                                  >
                                    <option value="">Todos</option>
                                    <option value="E1">1</option>
                                    <option value="E2">2</option>
                                    <option value="E3">3</option>
                                  </select>
                                </div>
                              </th>
                            <th className="py-2.5 px-3 w-32">
                                <div className="flex flex-col gap-1">
                                  <span>Módulo / Rua</span>
                              
                                  <input
                                    value={filtroModuloLote}
                                    onChange={(e) => setFiltroModuloLote(e.target.value)}
                                    placeholder="Rua"
                                    className="w-full border rounded p-1 text-xs bg-white"
                                  />
                                </div>
                              </th>
                            <th className="py-2.5 px-3 w-32">
                                <div className="flex flex-col gap-1">
                                  <span>Posição</span>
                              
                                  <input
                                    value={filtroPosicaoLote}
                                    onChange={(e) => setFiltroPosicaoLote(e.target.value)}
                                    placeholder="A1"
                                    className="w-full border rounded p-1 text-xs bg-white"
                                  />
                                </div>
                              </th>
                            <th className="py-2.5 px-3 w-40 font-mono">
                                <div className="flex flex-col gap-1">
                                  <span>Produto SKU</span>
                              
                                  <input
                                    value={filtroSkuLote}
                                    onChange={(e) => setFiltroSkuLote(e.target.value)}
                                    placeholder="SKU"
                                    className="w-full border rounded p-1 text-xs bg-white"
                                  />
                                </div>
                              </th>
                            <th className="py-2.5 px-3">Descrição (Auxiliar)</th>
                            <th className="py-2.5 px-3 w-28 text-right">Quant. (pçs)</th>
                            <th className="py-2.5 px-3 w-32 text-center">Tipo</th>
                            <th className="py-2.5 px-3 w-32">Data Chacote</th>
                            <th className="py-2.5 px-3 w-24">Hora</th>
                            <th className="py-2.5 px-3 w-32">Responsável</th>
                            <th className="py-2.5 px-3 w-36">Restrição</th>
                            <th className="py-2.5 px-3 w-48">Observação</th>
                            <th className="py-2.5 px-2 w-12 text-center">Remover</th>
                          </tr>

                        </thead>
                      <tbody className="divide-y divide-slate-150">
                        {lancamentoRowsFiltradas.map((row, index) => {
                          const isE1 = row.estoque === "E1";
                          const desc = getProductDesc(row.referencia);
                        
                          return (
                            <tr key={row.id} className="bg-white hover:bg-slate-50 transition-colors">
                              <td className="py-2 px-2 text-center font-bold text-slate-600">
                              {index + 1}
                            </td>
                              {/* Data Lançamento */}
                              <td className="py-2 px-2.5">
                                <input 
                                  ref={(element) => { lancamentoInputRefs.current[row.id] = element; }}
                                  type="date" 
                                  value={row.data}
                                  onChange={(e) => updateRowField(row.id, "data", e.target.value)}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className="w-full border border-slate-300 rounded p-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                />
                              </td>

                              {/* Galpão */}
                              <td className="py-2 px-2.5">
                                <select
                                  value={row.galpao || "3"}
                                  onChange={(e) => {
                                    const nextGalpao = e.target.value as Galpao;
                                    updateRowField(row.id, "galpao", nextGalpao);
                                    if (nextGalpao === "12") {
                                      updateRowField(row.id, "restricao", "autorizacao");
                                    }
                                  }}
                                  className="w-full border border-slate-300 rounded p-1 text-xs bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none font-bold"
                                >
                                  <option value="3">3</option>
                                  <option value="12">12</option>
                                </select>
                              </td>

                              {/* Estoque selector E1, E2, E3 */}
                              <td className="py-2 px-2.5 font-bold">
                                <select
                                  value={row.estoque}
                                  onChange={(e) => updateRowField(row.id, "estoque", e.target.value)}
                                  className="w-full border border-slate-300 rounded p-1 text-xs bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none font-bold"
                                >
                                  <option value="E1">1</option>
                                  <option value="E2">2</option>
                                  <option value="E3">3</option>
                                </select>
                              </td>

                              {/* Modulo / Rua value */}
                              <td className="py-2 px-2.5">
                                <input 
                                  type="text" 
                                  value={row.modulo}
                                  placeholder={isE1 ? "1 a 22" : "1 a 172"}
                                  onChange={(e) => updateRowField(row.id, "modulo", e.target.value)}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className="w-full border border-slate-300 rounded p-1 text-xs uppercase focus:ring-1 focus:ring-indigo-500 focus:outline-none font-bold font-mono"
                                />
                              </td>

                              {/* Posicao (Disabled for E1, required for E2/E3) */}
                              <td className="py-2 px-2.5">
                                <input 
                                  type="text" 
                                  value={isE1 ? "SEM POSI" : row.posicao}
                                  disabled={isE1}
                                  placeholder={isE1 ? "SEM POSI" : "Ex: A1, B1"}
                                  onChange={(e) => updateRowField(row.id, "posicao", e.target.value)}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className={`w-full border rounded p-1 text-xs uppercase focus:ring-1 focus:ring-indigo-500 focus:outline-none font-bold font-mono ${
                                    isE1 ? "bg-slate-105 border-slate-200 text-slate-400" : "bg-white border-slate-300"
                                  }`}
                                />
                              </td>

                              {/* Produto SKU with suggestion shortcut */}
                              <td className="py-2 px-2.5">
                                <div className="relative flex items-center">
                                  <input 
                                    type="text" 
                                    value={row.referencia}
                                    placeholder="SKU"
                                    onChange={(e) => updateRowField(row.id, "referencia", e.target.value)}
                                    onKeyDown={handleLancamentoInputKeyDown}
                                    className="w-full border border-slate-300 rounded p-1 text-xs uppercase focus:ring-1 focus:ring-indigo-500 focus:outline-none pr-6 font-bold font-mono"
                                  />
                                  {row.referencia.trim() !== "" && (
                                    <button
                                      onClick={() => handleAutoSuggestSlot(row.id, row.referencia)}
                                      title="Autossugerir melhor vaga livre correspondente"
                                      className="absolute right-1 p-1 text-slate-400 hover:text-indigo-600 transition"
                                    >
                                      <Sparkles className="w-3 h-3 text-amber-500" />
                                    </button>
                                  )}
                                </div>
                              </td>

                              {/* Real-time description label */}
                              <td className="py-2 px-2.5">
                                <span className="text-[11px] text-slate-550 block truncate max-w-[180px] font-semibold">
                                  {desc || <span className="text-red-400 italic font-mono">Não cadastrado</span>}
                                </span>
                              </td>

                              {/* Quantidade em peças */}
                              <td className="py-2 px-2.5 text-right">
                                <input 
                                  type="number" 
                                  value={row.quantidade}
                                  onChange={(e) => updateRowField(row.id, "quantidade", e.target.value === "" ? "" : parseInt(e.target.value))}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className="w-full border border-slate-300 rounded p-1 text-xs text-right pr-0.5 font-bold focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                />
                              </td>

                              {/* Type Entrada / Saída */}
                              <td className="py-2 px-2.5">
                                <select
                                  value={row.tipo}
                                  onChange={(e) => updateRowField(row.id, "tipo", e.target.value)}
                                  className={`w-full border rounded p-1 text-[11px] focus:outline-none font-extrabold ${
                                    row.tipo === "Entrada" 
                                      ? "bg-emerald-50 border-emerald-300 text-emerald-800" 
                                      : "bg-red-50 border-red-300 text-red-800"
                                  }`}
                                >
                                  <option value="Entrada">Entrada</option>
                                  <option value="Saída">Saída</option>
                                </select>
                              </td>

                              {/* dataChacote: optional */}
                              <td className="py-2 px-2.5">
                                <input 
                                  type="text" 
                                  value={row.dataChacote}
                                  placeholder="opcional / NT"
                                  onChange={(e) => updateRowField(row.id, "dataChacote", e.target.value)}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className="w-full border border-slate-300 rounded p-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                />
                              </td>

                              {/* Hora */}
                              <td className="py-2 px-2.5">
                                <input 
                                  type="text" 
                                  value={row.hora}
                                  placeholder="HH:mm"
                                  maxLength={5}
                                  inputMode="numeric"
                                  pattern="(?:[01]\\d|2[0-3]):[0-5]\\d"
                                  onChange={(e) => {
                                    const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                                    const formattedHora =
                                      digits.length > 2
                                        ? `${digits.slice(0, 2)}:${digits.slice(2)}`
                                        : digits;
                                    updateRowField(row.id, "hora", formattedHora);
                                  }}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className="w-full border border-slate-300 rounded p-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono text-center"
                                />
                              </td>

                              {/* Responsável da movimentação */}
                              <td className="py-2 px-2.5">
                                <input
                                  ref={(element) => { responsavelInputRefs.current[row.id] = element; }}
                                  type="text"
                                  value={row.responsavel}
                                  placeholder="Responsável"
                                  list={`responsaveis-${row.id}`}
                                  autoComplete="off"
                                  onChange={(e) => handleResponsavelChange(row.id, e.target.value)}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className="w-full border border-slate-300 rounded p-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                />
                                <datalist id={`responsaveis-${row.id}`}>
                                  {getPreviousResponsaveis(row.id).map((nome) => (
                                    <option key={nome} value={nome} />
                                  ))}
                                </datalist>
                              </td>

                              {/* Restrição */}
                              <td className="py-2 px-2.5">
                                <select
                                  value={row.galpao === "12" ? "autorizacao" : (row.restricao || "nenhuma")}
                                  onChange={(e) => updateRowField(row.id, "restricao", e.target.value as Restricao)}
                                  disabled={row.galpao === "12"}
                                  className="w-full border border-slate-300 rounded p-1 text-xs bg-white disabled:bg-slate-100 disabled:text-slate-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none font-bold"
                                >
                                  <option value="nenhuma">Nenhuma</option>
                                  <option value="teste">Teste — não separar</option>
                                  <option value="autorizacao">Solicitar autorização</option>
                                  <option value="outra">Outra restrição</option>
                                </select>
                              </td>

                              {/* Observação */}
                              <td className="py-2 px-2.5">
                                <input
                                  type="text"
                                  value={row.observacao || ""}
                                  placeholder="Observação"
                                  onChange={(e) => updateRowField(row.id, "observacao", e.target.value)}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className="w-full border border-slate-300 rounded p-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                />
                              </td>

                              {/* Remove button */}
                              <td className="py-2 px-2 text-center">
                                <button
                                  onClick={() => removeLancamentoRow(row.id)}
                                  className="p-1 hover:text-red-700 text-slate-400 rounded transition cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Submissão controller */}
                <div className="flex justify-between items-center pt-6 border-t border-slate-100 mt-6 border-dashed font-sans">
                  <div className="text-[11px] text-slate-400 flex items-center pr-4 font-semibold">
                    * Travas ativas: Modulos de E1 (R1-R22); E2 (M1-M172); E3 (M1-M112). Posições requeridas para E2 (A1-E2) e E3 (A1-F2).
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={addLancamentoRow}
                      className="bg-slate-800 hover:bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
                    >
                      <PlusCircle className="w-3.5 h-3.5" /> Inserir Linha
                    </button>
                  </div>
                </div>

              </div>

              )}

            </div>
          )}

          {/* TAB 4: HISTÓRICO */}
          {activeTab === "histórico" && (() => {
            const historyForView = historyQueryRows ?? history.filter(
              h => h.data >= histDateStart && h.data <= histDateEnd
            );

            const filteredHistory = historyForView.filter((h) => {

                if (histSearchSku.trim()) {
                  let cleanIn = histSearchSku.trim().toUpperCase();
              
                  if (cleanIn.startsWith("S")) {
                    cleanIn = cleanIn.slice(1);
                  }
              
                  let cleanH = String(h.referencia || "").toUpperCase();
              
                  if (cleanH.startsWith("S")) {
                    cleanH = cleanH.slice(1);
                  }
              
                  if (!cleanH.includes(cleanIn)) {
                    return false;
                  }
                }
              
               if (histFilterEstoque) {

                const cleanH = String(h.estoque).trim();
                const cleanF = String(histFilterEstoque).trim();
              
                if (cleanH !== cleanF) {
                  return false;
                }
              }
              
                if (histFilterModulo.trim()) {
              
                  const cleanH = String(h.modulo || "")
                    .replace(/^[RM]/i, "");
              
                  const cleanF = histFilterModulo
                    .trim()
                    .replace(/^[RM]/i, "");
              
                  if (!cleanH.includes(cleanF)) {
                    return false;
                  }
                }
              
                if (histFilterPosicao.trim()) {
              
                  const cleanH = String(h.posicao || "")
                    .replace(/^[RMG]/i, "")
                    .toUpperCase();
              
                  const cleanF = histFilterPosicao
                    .trim()
                    .replace(/^[RMG]/i, "")
                    .toUpperCase();
              
                  if (!cleanH.includes(cleanF)) {
                    return false;
                  }
                }
              
                return true;
              });

            return (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
                  <div className="pb-3 border-b border-slate-100 flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-md font-bold text-slate-800">Log Temporal de Movimentações</h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Registro contínuo e ordenado para auditoria e controle de estoque do galpão Porto Brasil.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase cursor-pointer">
                        <input
                          type="checkbox"
                          checked={historyExportAll}
                          onChange={(e) => setHistoryExportAll(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        Todo histórico
                      </label>
                      <button
                        onClick={handleExportarHistorico}
                        disabled={historyExportLoading}
                        className="bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60 border border-indigo-200 text-indigo-700 rounded-lg px-4 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer uppercase tracking-wider font-sans whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5 text-indigo-600" />
                        {historyExportLoading ? "Exportando..." : "Exportar Histórico"}
                      </button>
                    </div>
                  </div>

                  {/* Período da consulta */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs font-sans">
                    <div>
                      <label className="text-[10px] text-slate-400 block font-bold mb-1 uppercase">De</label>
                      <input
                        type="date"
                        value={histDateStart}
                        onChange={(e) => {
                          setHistDateStart(e.target.value);
                          setHistoryQueryRows(null);
                        }}
                        className="w-full bg-white border border-slate-300 rounded p-1.5 font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block font-bold mb-1 uppercase">Até</label>
                      <input
                        type="date"
                        value={histDateEnd}
                        onChange={(e) => {
                          setHistDateEnd(e.target.value);
                          setHistoryQueryRows(null);
                        }}
                        className="w-full bg-white border border-slate-300 rounded p-1.5 font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex items-end gap-2 lg:col-span-2">
                      <button
                        onClick={handleHistoryPeriodSearch}
                        disabled={historyQueryLoading}
                        className="bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider"
                      >
                        {historyQueryLoading ? "Consultando..." : "Consultar período"}
                      </button>
                      <button
                        onClick={clearHistoryPeriodQuery}
                        className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider"
                      >
                        Hoje
                      </button>
                    </div>
                    <div className="flex items-end">
                      <span className="text-[10px] text-slate-400 font-semibold leading-tight">
                        A tela carrega somente o período consultado. O exportador consulta o Supabase diretamente.
                      </span>
                    </div>
                  </div>

                  {/* Filtros de Pesquisa */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs font-sans">
                    <div>
                      <label className="text-[10px] text-slate-400 block font-bold mb-1 uppercase">Buscar SKU</label>
                      <input 
                        type="text"
                        placeholder="Ex: 092"
                        value={histSearchSku}
                        onChange={(e) => setHistSearchSku(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded p-1.5 font-bold font-mono text-slate-800 uppercase focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block font-bold mb-1 uppercase">Estoque</label>
                      <select
                        value={histFilterEstoque}
                        onChange={(e) => setHistFilterEstoque(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded p-1.5 font-bold text-slate-800 focus:outline-none"
                      >
                        <option value="">Todos</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block font-bold mb-1 uppercase">Módulo / Rua</label>
                      <input 
                        type="text"
                        placeholder="Ex: 11"
                        value={histFilterModulo}
                        onChange={(e) => setHistFilterModulo(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded p-1.5 font-bold font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block font-bold mb-1 uppercase">Posição</label>
                      <input 
                        type="text"
                        placeholder="Ex: A1"
                        value={histFilterPosicao}
                        onChange={(e) => setHistFilterPosicao(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded p-1.5 font-bold font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto overflow-y-auto max-h-[650px]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-605 uppercase text-[10px] tracking-wider font-bold">
                          <th className="py-3.5 px-4">Cod Mov</th>
                          <th className="py-3.5 px-4">Data Registro</th>
                          <th className="py-3.5 px-4">Efetuado por</th>
                          <th className="py-3.5 px-4 font-mono">Estoque</th>
                          <th className="py-3.5 px-4">Galpão</th>
                          <th className="py-3.5 px-4">Módulo / Rua</th>
                          <th className="py-3.5 px-4">Posição</th>
                          <th className="py-3.5 px-4 font-mono text-center">Referência</th>
                          <th className="py-3.5 px-4 text-right">Quantidade</th>
                          <th className="py-3.5 px-4 text-center">Tipo</th>
                          <th className="py-3.5 px-4 font-mono">Data Chacote</th>
                          <th className="py-3.5 px-4">Responsável Físico</th>
                          <th className="py-3.5 px-4">Observação</th>
                          <th className="py-3.5 px-4">Hora</th>

                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                        {filteredHistory.length > 0 ? (
                          filteredHistory.map((h) => (
                            <tr key={h.id} className="hover:bg-slate-50 border-b border-slate-100">
                              <td className="py-3 px-4 font-bold text-blue-600">{h.id}</td>
                              <td className="py-3 px-4 font-mono text-slate-500">{h.dataLancamento}</td>
                              <td className="py-3 px-4 text-slate-800">{h.quemLancou}</td>
                              <td className="py-3 px-4 font-black text-slate-850 font-mono">{h.estoque.replace("E", "")}</td>
                              <td className="py-3 px-4 font-bold text-slate-800">{h.galpao || "3"}</td>
                              <td className="py-3 px-4 font-bold font-mono text-slate-800">{h.modulo.replace(/^[RM]/i, "")}</td>
                              <td className="py-3 px-4 font-bold font-mono text-slate-700">{h.posicao || "—"}</td>
                              <td className="py-3 px-4 text-center">
                                <span className="bg-slate-100 text-slate-800 text-[10px] font-bold px-2 py-0.5 rounded font-mono border border-slate-200">
                                  {h.referencia}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-black pr-6">{h.quantidade.toLocaleString()} pçs</td>
                              <td className="py-3 px-4 text-center animate-fade-in">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                  h.tipo === "Entrada" 
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                                    : "bg-red-50 text-red-700 border-red-100"
                                }`}>
                                  {h.tipo}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-mono text-slate-500">{h.dataChacote || "—"}</td>
                              <td className="py-3 px-4 font-bold text-slate-650">{h.responsavel}</td>
                              <td className="py-3 px-4 max-w-[260px] truncate text-slate-500">{h.observacao || "—"}</td>
                              <td className="py-3 px-4 font-mono text-slate-500">{h.hora}</td>

                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={13} className="py-20 text-center text-slate-400 font-semibold bg-slate-50">
                              Nenhuma movimentação registrada no Supabase corresponde aos filtros selecionados.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TAB 5: DIVERGÊNCIAS (Admin corrective reviewer) */}
          {activeTab === "divergências" && (
            <DivergenciasPanel
              divergencias={divergencias}
              slots={slots}
              productsList={productsList}
              currentUser={currentUser}
              operator={operator}
              launchDate={launchDate}
              onUpdateDivergencias={persistDivergenciasUpdate}
              onUpdateSlots={persistSlotsUpdate}
              onAddHistory={appendHistory}
              hasAccess={hasAccess}
            />
          )}

          {/* TAB 6: BASE DE DADOS (References List and registering new ones) */}
          {activeTab === "base" && (
           <BaseDeDadosPanel
             productsList={productsList}
              slots={slots}
              onRegisterProduct={registerNewProduct}
              onUpdateProduct={updateProduct}
              onDeleteProduct={deleteProduct}
              hasAccess={hasAccess}
              currentUser={currentUser}
          />
          )}

          {/* TAB 7: ENDEREÇO CORREDOR */}
          {activeTab === "corredor" && (
            <AisleStoragePanel
              slots={slots}
              productsList={productsList}
              currentUser={currentUser}
              operator={operator}
              launchDate={launchDate}
              onUpdateSlots={persistSlotsUpdate}
              onAddHistory={appendHistory}
              hasAccess={hasAccess}
            />
          )}

          {/* TAB 8: GÊMEO DIGITAL */}
          {activeTab === "mapa" && (
            <div className="space-y-6">
              
          <InteractiveMapa
            slots={slots}
            onQuickUpdateSlot={async (updated) => {
              const slotsSaved = await persistSlotsUpdate(
                slots.map(s => s.id === updated.id ? updated : s)
              );

              if (!slotsSaved) {
                alert("Não foi possível salvar a alteração do endereço no Supabase.");
                return;
              }

                  // Keep history
                  const logId = `MOV-${generateId()}`;
                  const updateHistory: HistoricoMov = {
                    id: logId,
                    dataLancamento: getTodayIsoDate(),
                    quemLancou: operator,
                    data: getTodayIsoDate(),
                    estoque: updated.estoque,
                    modulo: updated.modulo,
                    posicao: updated.posicao,
                    referencia: updated.referencia || "RECONCILIADO",
                    quantidade: updated.saldo,
                    tipo: "Entrada",
                    dataChacote: updated.dataChacote,
                    hora: updated.ultimaHora || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                    responsavel: updated.ultimoResponsavel
                  };
                  const historySaved = await appendHistory([updateHistory]);
                  if (!historySaved) {
                    alert("O endereço foi salvo, mas o registro de reconciliação não pôde ser gravado no histórico.");
                  }
                }}
              productsList={productsList}
              currentUser={currentUser}
              />
            </div>
          )}

          {/* TAB 9: IA CONSULTOR (AI dialogue workspace chat) */}
          {activeTab === "ai" && (
            <div className="space-y-6">
              
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col md:flex-row gap-6 items-stretch">
                
                {/* Chat section */}
                <div className="flex-1 border border-slate-300 rounded-xl flex flex-col h-[420px] overflow-hidden shadow-inner bg-slate-50 font-sans">
                  
                  <div className="bg-slate-900 border-b border-slate-950 p-4 font-sans text-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping mr-1"></div>
                      <div>
                        <span className="font-bold text-xs block uppercase">Consultor Inteligente • Porto Brasil</span>
                        <span className="text-[10px] text-indigo-300 block">Sincronizado aos Estoques E1, E2, E3</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs leading-normal font-medium">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`p-3 max-w-xs md:max-w-md rounded-xl shadow-xs whitespace-pre-wrap ${
                          msg.sender === "user" 
                            ? "bg-slate-800 text-white rounded-br-none" 
                            : "bg-white border border-slate-200 text-slate-800 rounded-bl-none font-medium"
                        }`}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 bg-white border-t border-slate-200 flex gap-2">
                    <input 
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendChatMessage()}
                      placeholder="Qual SKU está mais estocado? Indique posições livres..."
                      className="flex-1 bg-slate-50 border border-slate-350 rounded-lg p-2 text-xs focus:outline-none"
                    />
                    <button
                      onClick={handleSendChatMessage}
                      className="bg-indigo-600 hover:bg-indigo-750 bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer"
                    >
                      Enviar
                    </button>
                  </div>

                </div>

                {/* Quick questions recommendations block in chat */}
                <div className="w-full md:w-64 border border-slate-200 rounded-xl p-5 bg-slate-50 space-y-4">
                  <span className="text-[10px] text-indigo-605 text-indigo-600 font-extrabold block uppercase tracking-wider font-sans">Sugestão de Diálogos</span>
                  <p className="text-xs text-slate-400 leading-normal font-medium">
                    Perguntas estratégicas para análise operacional e tomada de decisão:
                  </p>

                  <div className="space-y-2 text-[11px] font-sans">
                    <button
                    onClick={() => setChatInput("Qual SKU está mais pulverizado?")}
                    className="w-full text-left bg-white hover:bg-slate-100 p-2 border border-slate-200 rounded-lg transition font-bold text-slate-700"
                  >
                    📦 SKU mais pulverizado
                  </button>
                  
                  <button
                    onClick={() => setChatInput("Onde posso liberar espaço?")}
                    className="w-full text-left bg-white hover:bg-slate-100 p-2 border border-slate-200 rounded-lg transition font-bold text-slate-700"
                  >
                    📊 Onde posso liberar espaço?
                  </button>
                  
                  <button
                  onClick={() => setChatInput("Gerar plano de consolidação")}
                  className="w-full text-left bg-white hover:bg-slate-100 p-2 border border-slate-200 rounded-lg transition font-bold text-slate-700"
                >
                  📄 Gerar plano de consolidação
                </button>

                    <button
                  onClick={handleExportConsolidationPDF}
                  className="w-full text-left bg-white hover:bg-slate-100 p-2 border border-slate-200 rounded-lg transition font-bold text-slate-700"
                >
                  🖨️ Exportar plano PDF
                </button>
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* TAB 10: CONTROLE DE USUÁRIOS */}
          {activeTab === "users" && (
            <div className="space-y-6">
              <AdminUsersManagement
                users={users}
                currentUser={currentUser}
                onRegisterUser={handleRegisterUser}
                onDeleteUser={handleDeleteUser}
              />

            </div>
          )}

        </div>

      </main>

    </div>
  );
}
