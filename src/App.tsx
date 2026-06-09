import { useState, useEffect, FormEvent } from "react";
import { supabase } from './lib/supabase';
import { 
  getInitialWarehouseSlots, 
  getInitialHistory, 
  getInitialDivergencias,
  processLancamentosInSequence,
  validateLancamentoRow,
  generateId
} from "./data/mockStorage";
import { 
  WarehouseSlot, 
  HistoricoMov, 
  Divergencia, 
  LancamentoRow, 
  AppMode, 
  Product 
} from "./types";
import { PRODUCT_CATALOG, findProductInList } from "./data/products";
import { DashboardCards } from "./components/DashboardCards";
import { InteractiveMapa } from "./components/InteractiveMapa";
import { AdminUsersManagement, AppUser } from "./components/AdminUsersManagement";
import { AisleStoragePanel } from "./components/AisleStoragePanel";
import { DivergenciasPanel } from "./components/DivergenciasPanel";
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

const loadSlotsFromSupabase = async (): Promise<WarehouseSlot[]> => {
  const { data, error } = await supabase
    .from("slots")
    .select("*");

  if (error) {
    console.error("Erro ao carregar slots:", error);
    return [];
  }

  return (data as WarehouseSlot[]) || [];
};

const saveSlotsToSupabase = async (slotsData: WarehouseSlot[]) => {
  console.log("SALVANDO SLOTS:", slotsData);

  const { data, error } = await supabase
    .from("slots")
    .upsert(slotsData)
    .select();

  console.log("UPSERT DATA:", data);
  console.log("UPSERT ERROR:", error);

  if (error) {
    console.error("Erro ao salvar slots:", error);
  }
};

const refreshSlotsFromSupabase = async () => {
  const data = await loadSlotsFromSupabase();
  setSlots(data);
};

const loadHistoryFromSupabase = async (): Promise<HistoricoMov[]> => {
  const { data, error } = await supabase
    .from("history")
    .select("*");

  if (error) {
    console.error("Erro ao carregar histórico:", error);
    return [];
  }

  return (data as HistoricoMov[]) || [];
};

const saveHistoryToSupabase = async (
  historyData: HistoricoMov[]
) => {
  console.log("SALVANDO HISTORY:", historyData);

  const { data, error } = await supabase
    .from("history")
    .upsert(historyData)
    .select();

  console.log("HISTORY DATA:", data);
  console.log("HISTORY ERROR:", error);

  if (error) {
    console.error("Erro ao salvar histórico:", error);
  }
};

const loadDivergenciasFromSupabase = async (): Promise<Divergencia[]> => {
  const { data, error } = await supabase
    .from("divergencias")
    .select("*");

  if (error) {
    console.error("Erro ao carregar divergências:", error);
    return [];
  }

  return (data as Divergencia[]) || [];
};

const saveDivergenciasToSupabase = async (
  divergenciasData: Divergencia[]
) => {
  const { error } = await supabase
    .from("divergencias")
    .upsert(divergenciasData);

  if (error) {
    console.error("Erro ao salvar divergências:", error);
  }
};

export default function App() {
  // --- USER AUTHENTICATION & SECURITY STATE ---
  const [users, setUsers] = useState<AppUser[]>(() => {
    const saved = localStorage.getItem("eb_users");
    if (saved) return JSON.parse(saved);
    const initial: AppUser[] = [
      { username: "adm", password: "math2308", name: "Administrador Geral", role: "Administrador" }
    ];
    localStorage.setItem("eb_users", JSON.stringify(initial));
    return initial;
  });

  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    const saved = sessionStorage.getItem("eb_current_user");
    if (saved) return JSON.parse(saved);
    return null;
  });

  // Login Form input state
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const handleLoginSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLoginError("");

    const matched = users.find(
      u => u.username.toLowerCase() === loginUsername.trim().toLowerCase() && u.password === loginPassword
    );

    if (matched) {
      const sessUser = { username: matched.username, name: matched.name, role: matched.role };
      setCurrentUser(sessUser);
      setOperator(matched.name); // Set global log responsibility identifier
      sessionStorage.setItem("eb_current_user", JSON.stringify(sessUser));
      setLoginUsername("");
      setLoginPassword("");
    } else {
      setLoginError("Usuário ou senha incorretos.");
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem("eb_current_user");
    setActiveTab("dashboard");
  };
  const loadUsersFromSupabase = async () => {
  const { data, error } = await supabase
    .from('users')
    .select('*');

  if (error) {
    console.error('Erro ao carregar usuários:', error);
    return;
  }

  if (data && data.length > 0) {
    const formattedUsers = data.map(user => ({
      username: user.username,
      password: user.password,
      name: user.name,
      role: user.role
    }));

    setUsers(formattedUsers);
  }
};

useEffect(() => {
  loadUsersFromSupabase();
  loadProductsFromSupabase();
}, []);

useEffect(() => {
  const loadSlots = async () => {
    const data = await loadSlotsFromSupabase();
    setSlots(data);
  };

    loadSlots();
}, []);
  
  useEffect(() => {
  const loadHistory = async () => {
    const data = await loadHistoryFromSupabase();
    setHistory(data);
  };
  
   loadHistory();
  }, []);

useEffect(() => {
  const loadDivergencias = async () => {
    const data = await loadDivergenciasFromSupabase();
    setDivergencias(data);
  };

  loadDivergencias();
}, []);
  
  // --- DYNAMIC REGISTERED CUSTOM PRODUCTS STATE ---
  const [productsList, setProductsList] = useState<Product[]>([]);

  const loadProductsFromSupabase = async () => {
  const { data, error } = await supabase
    .from("products")
    .select("*");

  if (error) {
    console.error("Erro ao carregar produtos:", error);
    return;
  }

  if (data) {
    setProductsList(
      data.map((p: any) => ({
        referencia: p.referencia,
        descricao: p.descricao
      }))
    );
  }
};
  
  // Save changes to custom references list
  const registerNewProduct = async (ref: string, desc: string): Promise<boolean> => {
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
        descricao: desc.trim()
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

  // User Administration callbacks
  const handleRegisterUser = async (newUser: AppUser) => {

  const { error } = await supabase
    .from("users")
    .insert([
      {
        username: newUser.username,
        password: newUser.password,
        name: newUser.name,
        role: newUser.role
      }
    ]);

  if (error) {
    console.error(error);
    alert("Erro ao salvar usuário.");
    return;
  }

  loadUsersFromSupabase();

  alert("Usuário cadastrado com sucesso!");
};

  const handleDeleteUser = async (username: string) => {

  console.log("Tentando excluir:", username);

  const { data, error } = await supabase
    .from("users")
    .delete()
    .eq("username", username);

  console.log("DELETE DATA:", data);
  console.log("DELETE ERROR:", error);

  if (error) {
    alert("Erro ao excluir usuário.");
    return;
  }

  await loadUsersFromSupabase();

  alert("Usuário excluído com sucesso!");
};

  // --- CORE SYSTEM DATA PERSISTENCE ---
  const [slots, setSlots] = useState<WarehouseSlot[]>([]);

  const [history, setHistory] = useState<HistoricoMov[]>([]);

  const [divergencias, setDivergencias] = useState<Divergencia[]>([]);

  const [appMode, setAppMode] = useState<AppMode>(() => {
    const saved = localStorage.getItem("eb_mode");
    return (saved as AppMode) || "basico";
  });

  const [activeTab, setActiveTab] = useState<string>("pesquisa");

  // Save changes to localStorage on modifier updates
  useEffect(() => {
  saveSlotsToSupabase(slots);
  }, [slots]);

  useEffect(() => {
  saveHistoryToSupabase(history);
}, [history]);

  useEffect(() => {
  saveDivergenciasToSupabase(divergencias);
}, [divergencias]);

  useEffect(() => {
    localStorage.setItem("eb_mode", appMode);
  }, [appMode]);

  // --- SYSTEM LOG OPERATOR RESPONSIBLES ---
  const [operator, setOperator] = useState(() => {
    if (currentUser) return currentUser.name;
    return "Administrador Geral";
  });
  const [launchDate, setLaunchDate] = useState("2026-06-09");

  // --- FILTERED VIEWS ---
  // Product Search Coordinates (Pesquisa Produtos) Filters
  const [searchRef, setSearchRef] = useState("");
  const [searchDesc, setSearchDesc] = useState("");
  const [filterEstoque, setFilterEstoque] = useState("");
  const [searchModulo, setSearchModulo] = useState("");
  const [searchPosicao, setSearchPosicao] = useState("");

  // Base Products Catalog Filters
  const [baseSearch, setBaseSearch] = useState("");

  // History Log Filters
  const [histSearchSku, setHistSearchSku] = useState("");
  const [histFilterEstoque, setHistFilterEstoque] = useState("E1");
  const [histFilterModulo, setHistFilterModulo] = useState("");
  const [histFilterPosicao, setHistFilterPosicao] = useState("");

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
  const [selectedLaunchType, setSelectedLaunchType] = useState<"unitario" | "lote">("unitario");

  const matchedUnitProduct = productsList.find(
    (p) => p.referencia.toUpperCase() === unitSku.trim().toUpperCase()
  );

  // --- LANÇAMENTO (TABULAR BATCH LEDGER) ---
  const [lancamentoRows, setLancamentoRows] = useState<LancamentoRow[]>([]);

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

const addLancamentoRow = () => {
  const defaultRow: LancamentoRow = {
    id: `ROW-${generateId()}`,
    data: launchDate,
    estoque: "1",
    modulo: "",
    posicao: "",
    referencia: "",
    quantidade: "",
    tipo: "Entrada",
    dataChacote: "",
    hora: new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    }),
    responsavel: operator
  };

  setLancamentoRows(prev => [...prev, defaultRow]);
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
  console.log(
    "Filtro:",
    filtroSkuLote,
    "Linha:",
    row.referencia
  );

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
  const handleLancarLote = () => {
    // Perform validators for each active field
    const activeData = lancamentoRows.filter(r => r.referencia.trim() !== "");
    if (activeData.length === 0) {
      alert("Por favor, preencha pelo menos um lançamento contendo código SKU válido.");
      return;
    }

    // Capture errors
    let allErrors: string[] = [];
    activeData.forEach((row, index) => {
      const rowErrors = validateLancamentoRow(row, index + 1, productsList, appMode === "avancado");
      allErrors = [...allErrors, ...rowErrors];
    });

    if (allErrors.length > 0) {
      // Build a beautiful visual blocker list of errors
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

    setSlots(updatedSlots);
    setHistory([...newHistory, ...history]);
    setDivergencias([...newDivergencias, ...divergencias]);

    // Show dynamic feedback popup
    alert(`Lote processado!\n✔️ ${processedCount} movimentações consolidadas de modo sequencial.\n⚠️ ${errorCount} divergências identificadas e enviadas para revisão.`);

    // Clear grid
    setLancamentoRows([]);
  };

  const handleUnitaryLaunch = async (type: "Entrada" | "Saída") => {
    if (!hasAccess("Operador")) {
      alert("Seu nível de permissão jurídica (Consulta) não permite efetuar lançamentos lógicos.");
      return;
    }

    const estVal = unitEstoque;
    const cleanCorredor = unitCorredor.trim().toUpperCase().replace(/^[RM]/i, "");
    let cleanSku = unitSku.trim().toUpperCase();
    if (cleanSku.startsWith("S")) cleanSku = cleanSku.slice(1);

    if (!cleanCorredor || !cleanSku || !unitQuantidade || Number(unitQuantidade) <= 0) {
      alert("Por favor, preencha corretamente o Estoque, Nº Corredor, Referência SKU e Quantidade.");
      return;
    }

    const product = productsList.find(p => p.referencia.toUpperCase() === cleanSku);
    if (!product) {
      alert(`Código SKU "${cleanSku}" não está registrado na Base de dados.`);
      return;
    }

    const qty = Number(unitQuantidade);
    const posVal = (estVal === "1" || !unitPosicao || unitPosicao.trim() === "") ? "" : unitPosicao.trim().toUpperCase();

    // Locate existing slot matching estoque, modulo, and posicao
    const slotIdx = slots.findIndex((s) => {
    if (estVal === "1") {
      return (
        s.estoque === estVal &&
        s.modulo === cleanCorredor &&
        s.referencia === cleanSku
      );
    }
  
    return (
      s.estoque === estVal &&
      s.modulo === cleanCorredor &&
      s.posicao === posVal
    );
  });

    let updatedSlots = [...slots];
    let targetSlot: WarehouseSlot;

    if (slotIdx === -1) {
      if (type === "Saída") {
        alert("Não é possível realizar saída de um endereço vazio ou inexistente.");
        return;
      }
      targetSlot = {
        id: `${estVal}-${cleanCorredor}-${posVal}`,
        estoque: estVal,
        modulo: cleanCorredor,
        posicao: posVal,
        referencia: product.referencia,
        descricao: product.descricao,
        saldo: qty,
        dataChacote: unitChacote || (posVal === "" ? "Corredor" : ""),
        ultimaData: launchDate,
        ultimaHora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        ultimoResponsavel: operator,
      };
      updatedSlots.push(targetSlot);
    } else {
      targetSlot = { ...slots[slotIdx] };

      if (type === "Entrada") {
        if (targetSlot.referencia !== "" && targetSlot.referencia.toUpperCase() !== cleanSku) {
          // If occupied by a different SKU, ask for overwrite confirm
          const overwrite = confirm(
            `O endereço ${cleanCorredor} [Posição: ${posVal || "Corredor"}] do Estoque ${estVal} está ocupado por ${targetSlot.referencia} (${targetSlot.descricao}). Deseja sobrescrever para o novo SKU "${cleanSku}"?`
          );
          if (!overwrite) return;
          targetSlot.referencia = product.referencia;
          targetSlot.descricao = product.descricao;
          targetSlot.saldo = qty;
        } else {
          targetSlot.referencia = product.referencia;
          targetSlot.descricao = product.descricao;
          targetSlot.saldo += qty;
        }
      } else {
        // Saída
        if (targetSlot.referencia !== cleanSku) {
          alert(`Tentativa de saída do item "${cleanSku}" em posição ocupada por "${targetSlot.referencia}".`);
          return;
        }
        if (targetSlot.saldo < qty) {
          alert(`Saldo de estoque insuficiente! Saldo atual: ${targetSlot.saldo} pçs.`);
          return;
        }
        targetSlot.saldo -= qty;
        if (targetSlot.saldo === 0) {
          targetSlot.referencia = "";
          targetSlot.descricao = "";
        }
      }

      if (unitChacote) {
        targetSlot.dataChacote = unitChacote;
      } else if (posVal === "" && !targetSlot.dataChacote) {
        targetSlot.dataChacote = "Corredor";
      }

      targetSlot.ultimaData = launchDate;
      targetSlot.ultimaHora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      targetSlot.ultimoResponsavel = operator;
      updatedSlots = updatedSlots.map((s) => (s.id === targetSlot.id ? targetSlot : s));
    }

    await saveSlotsToSupabase(updatedSlots);

    const data = await loadSlotsFromSupabase();
    setSlots(data);

    // Create history record
    const newMovement: HistoricoMov = {
      id: `MOV-${generateId()}`,
      dataLancamento: launchDate,
      quemLancou: currentUser?.name || "Sistema",
      data: launchDate,
      estoque: estVal,
      modulo: cleanCorredor,
      posicao: posVal,
      referencia: product.referencia,
      quantidade: qty,
      tipo: type,
      dataChacote: unitChacote || (posVal === "" ? "Corredor" : ""),
      hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      responsavel: operator,
    };

    setHistory([newMovement, ...history]);

    // Clear inputs
    setUnitCorredor("");
    setUnitPosicao("");
    setUnitSku("");
    setUnitQuantidade("");
    setUnitChacote("");

    alert(`Lançamento de ${type} consolidado no endereço ${cleanCorredor}${posVal ? ` (Posição ${posVal})` : " (Corredor)"} do Estoque ${estVal}.`);
  };

  // Manual Excel paste parser updated to handle E1, E2, E3
  const handleImportExcelData = () => {
    if (!bulkText.trim()) {
      setBulkFeedback("Espaço por colar em branco.");
      return;
    }

    const lines = bulkText.split("\n").filter(l => l.trim() !== "");
    const newRows: LancamentoRow[] = [];

    lines.forEach((line) => {
      const cols = line.split(/[;\t]/);
      if (cols.length >= 3) {
        const refRaw = cols[0]?.trim().toUpperCase();
        const qtyRaw = cols[1]?.trim();
        const typeRaw = cols[2]?.trim().toLowerCase();
        
        let estVal = cols[3]?.trim().toUpperCase() || "E1";
        if (!["E1", "E2", "E3"].includes(estVal)) estVal = "E1";

        let modRaw = cols[4]?.trim() || (estVal === "E1" ? "11" : "1");
        const modVal = modRaw.replace(/\D/g, "");
        const posVal = estVal === "E1" ? "" : cols[5]?.trim().toUpperCase() || "A1";

        if (refRaw) {
          newRows.push({
            id: `ROW-${generateId()}`,
            data: launchDate,
            estoque: estVal,
            modulo: modVal,
            posicao: posVal,
            referencia: refRaw,
            quantidade: parseInt(qtyRaw) || 100,
            tipo: typeRaw.includes("sai") || typeRaw.includes("baixa") ? "Saída" : "Entrada",
            dataChacote: cols[6]?.trim() || "",
            hora: cols[7]?.trim() || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            responsavel: cols[8]?.trim() || operator
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
    const headers = "Referencia SKU;Quantidade;Tipo;Estoque;Modulo/Rua;Posicao;Data Chacote;Hora;Responsavel";
    const exampleRow = `092;1500;Entrada;E1;11;;;${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })};${operator}`;
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(`${headers}\n${exampleRow}`);
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", "layout_porto_brasil.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  const handleExportarHistorico = () => {
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
      "Responsavel_Operacional"
    ];

    const rows = history.map(h => [
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
      h.responsavel
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
    link.setAttribute("download", `historico_movimentacoes_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearAllOperationalData = () => {
    if (confirm("Tem certeza que deseja apagar todo o endereçamento, histórico de movimentações e divergências? Os usuários cadastrados e base de produtos catalogados permanecerão intactos.")) {
      setSlots([]);
      setHistory([]);
      setDivergencias([]);
      localStorage.setItem("eb_slots_clean_v1", JSON.stringify([]));
      localStorage.setItem("eb_history_clean_v1", JSON.stringify([]));
      localStorage.setItem("eb_divergencias_clean_v1", JSON.stringify([]));
      alert("Todos os dados operacionais foram limpos!");
    }
  };

  const handleLimparPlanilhasZerarEnderecamento = () => {
    // Primeira de duas confirmações
    if (confirm("Confirmação 1 de 2: Tem certeza de que deseja LIMPAR A PLANILHA e resetar todo o endereçamento dos estoques? Todos os saldos e localizações serão esvaziados.")) {
      // Segunda de duas confirmações
      if (confirm("Confirmação 2 de 2 (CRÍTICA): Esta ação é definitiva e removerá todos os paletes e registros operacionais cadastrados no sistema. Deseja prosseguir com o reset total dos estoques?")) {
        setSlots([]);
        setHistory([]);
        setDivergencias([]);
        localStorage.setItem("eb_slots_clean_v1", JSON.stringify([]));
        localStorage.setItem("eb_history_clean_v1", JSON.stringify([]));
        localStorage.setItem("eb_divergencias_clean_v1", JSON.stringify([]));
        alert("O endereçamento foi completamente zerado!");
      }
    }
  };

  const handleDeleteHistoryItem = (id: string) => {
    if (confirm(`Tem certeza que deseja apagar permanentemente o registro de movimentação ${id} do histórico?`)) {
      const updated = history.filter(h => h.id !== id);
      setHistory(updated);
      localStorage.setItem("eb_history_clean_v1", JSON.stringify(updated));
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
    setSearchModulo("");
    setSearchPosicao("");
  };

  // --- COMPILATING SYSTEM VIEWS ---
  const filteredSlots = slots.filter(s => {
    const matchesRef = searchRef
  ? s.referencia.toLowerCase() === searchRef.toLowerCase()
  : true;
    const matchesDesc = searchDesc ? s.descricao.toLowerCase().includes(searchDesc.toLowerCase()) : true;
    
    // Normalize both for flawless comparison
    const normFilterEst = filterEstoque ? filterEstoque.replace("E", "") : "";
    const matchesEstoque = normFilterEst ? s.estoque.replace("E", "") === normFilterEst : true;

    const matchesModulo = searchModulo 
      ? s.modulo.replace(/^[RM]/i, "").includes(searchModulo.replace(/^[RM]/i, "")) 
      : true;

    const matchesPosicao = searchPosicao 
      ? (
          s.posicao.replace(/^[RMG]/i, "").toUpperCase().includes(searchPosicao.replace(/^[RMG]/i, "").toUpperCase()) ||
          (searchPosicao.trim().toLowerCase() === "corredor" && s.posicao === "") ||
          (s.posicao === "" && "corredor".includes(searchPosicao.trim().toLowerCase()))
        )
      : true;

    return matchesRef && matchesDesc && matchesEstoque && matchesModulo && matchesPosicao;
  });

  const filteredBaseProducts = productsList.filter(p => 
    p.referencia.toLowerCase().includes(baseSearch.toLowerCase()) ||
    p.descricao.toLowerCase().includes(baseSearch.toLowerCase())
  );

  // --- CONVERSATIONAL AI MODEL CO-PILOT ---
  const [chatMessages, setChatMessages] = useState([
    { 
      sender: "system", 
      text: "Olá! Sou o Assistente Inteligente de Estoque da Porto Brasil. Como as versões Básica e Avançada estão interligadas, monitoro o layout físico de E1, E2, E3 em tempo real. Me pergunte coisas como:\n- 'Qual o item mais estocado?'\n- 'Existem divergências em aberto?'\n- 'Indique uma vaga para colocar 111'" 
    }
  ]);
  const [chatInput, setChatInput] = useState("");

  const handleSendChatMessage = () => {
    if (!chatInput.trim()) return;

    const userMessage = chatInput.trim();
    setChatMessages(prev => [...prev, { sender: "user", text: userMessage }]);
    setChatInput("");

    setTimeout(() => {
      let responseText = "";
      const lower = userMessage.toLowerCase();

      if (lower.includes("item") || lower.includes("produto") || lower.includes("mais estocado") || lower.includes("maior saldo")) {
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
                  placeholder="Ex: adm"
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
              className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg p-3 text-xs font-bold transition shadow shadow-blue-600/20 uppercase"
            >
              Acessar Painel
            </button>
          </form>
        </div>

      </div>
    );
  }

  // Helper validation roles and permissions check
  const hasAccess = (requiredLevel: "Administrador" | "Operador" | "Consulta"): boolean => {
    if (!currentUser) return false;
    const role = currentUser.role;

    if (role === "Administrador") return true;

    if (requiredLevel === "Administrador") {
      // Only Admin can manage users or perform administrative overrides
      return false;
    }

    if (requiredLevel === "Operador") {
      // Admin and Apoio have permission to do launches, corridor inputs, and write items
      return role === "Apoio";
    }

    if (requiredLevel === "Consulta") {
      // Everyone else has at least viewing access
      return true;
    }

    return false;
  };

  const canAccessTab = (tab: string): boolean => {
    if (!currentUser) return false;
    const role = currentUser.role;

    // Endereço Corredor is restricted to Advanced Mode only
    if (tab === "corredor" && appMode !== "avancado") {
      return false;
    }

    // Admin has access to everything
    if (role === "Administrador") return true;

    // Produção only searches items
    if (role === "Produção") {
      return tab === "endereçamento";
    }

    // Liderança sees all except user administration & advanced twins/AI mode
    if (role === "Liderança") {
      return !["users", "mapa", "ai"].includes(tab);
    }

    // Apoio sees all except user administration & advanced twins/AI mode
    if (role === "Apoio") {
      return !["users", "mapa", "ai"].includes(tab);
    }

    // Visualizador can see all tabs except user administration, but edit fields are locked or read-only
    if (role === "Visualizador") {
      return tab !== "users";
    }

    return false;
  };

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
                {activeTab === "dashboard" &&
                (currentUser.role === "Administrador" ||
                 currentUser.role === "Lideranca" ||
                 currentUser.role === "Visualizador") && (
                  <Dashboard />
              )} 
                  ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
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
          {currentUser?.perfil === "Administrador" &&
           (canAccessTab("mapa") || canAccessTab("ai")) && (
            <>
              <span className="text-[9px] text-slate-500 font-extrabold block pt-4 pb-1.5 px-4 uppercase tracking-wider">Avançado & Controle</span>

              {canAccessTab("mapa") &&
             currentUser?.perfil === "Administrador" && (
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
                onChange={(e) => setLaunchDate(e.target.value)}
                className="bg-white border border-slate-300 rounded px-1.5 py-0.5 font-bold text-slate-755 text-slate-800 text-xs focus:outline-none"
              />
              <span className="text-slate-455 font-bold uppercase text-[9px] ml-1">Responsável:</span>
              <input 
                type="text"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                className="bg-white border border-slate-300 rounded px-1.5 py-0.5 max-w-[120px] font-bold text-slate-800 text-xs focus:outline-none"
              />
            </div>
          </div>
        </header>

        {/* COMPONENT TAB CONTAINER WRAPPER */}
        <div className="p-6 flex-1 space-y-6">
          
          {/* TAB 1: DASHBOARD VIEW */}
          {activeTab === "dashboard" &&
           (
             currentUser?.perfil === "Administrador" ||
             currentUser?.perfil === "Lideranca" ||
             currentUser?.perfil === "Visualizador"
           ) && (
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
                      if (!hasAccess("Operador")) {
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
              <DashboardCards slots={slots} history={history} divergencias={divergencias} appMode={appMode} />

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
                      {["E1", "E2", "E3"].map(est => {
                        const total = est === "E1" ? 22 : est === "E2" ? 1720 : 1344;
                        const occupied = slots.filter(s => s.estoque === est && s.saldo > 0).length;
                        const pct = total > 0 ? (occupied / total) * 100 : 0;
                        return (
                          <div key={est} className="flex items-center gap-3">
                            <span className="w-20 text-slate-600 font-bold block shrink-0">Estoque {est.replace("E", "")}</span>
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
                    {currentUser?.role === "Administrador" && (
                      <button 
                        onClick={handleLimparPlanilhasZerarEnderecamento}
                        className="text-xs text-red-650 text-red-700 hover:text-red-850 bg-red-50 hover:bg-red-100 border border-red-200 transition font-black cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg uppercase tracking-wider font-sans whitespace-nowrap"
                        title="Zerar todo o endereçamento físico (Requer 2 confirmações)"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-600 animate-pulse" />
                        Limpar Planilha
                      </button>
                    )}
                    {(
                      currentUser?.perfil === "Administrador" ||
                      currentUser?.perfil === "Lideranca"
                    ) && (
                    <button 
                      onClick={handleExportarEnderecamento}
                      className="text-xs text-indigo-600 hover:text-indigo-800 transition font-bold cursor-pointer flex items-center gap-1.5 font-sans uppercase tracking-wider text-[11px]"
                    >
                      <Download className="w-3.5 h-3.5 text-indigo-500" />
                      Exportar Endereçamento (CSV)
                    </button>
                    <button 
                      onClick={handleClearSlotsFilter}
                      className="text-xs text-slate-400 hover:text-blue-600 transition font-medium cursor-pointer font-sans uppercase tracking-wider text-[11px]"
                    >
                      Limpar Filtros
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {appMode === "basico" ? (
                    <>
                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Buscar SKU</label>
                        <input 
                          type="text" 
                          value={searchRef}
                          onChange={(e) => setSearchRef(e.target.value)}
                          placeholder="EX: 092"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase font-mono font-bold"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Estoque</label>
                        <select
                          value={filterEstoque}
                          onChange={(e) => setFilterEstoque(e.target.value)}
                          className="w-full border border-slate-300 bg-white rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                        >
                          <option value="">Todos</option>
                          <option value="E1">1</option>
                          <option value="E2">2</option>
                          <option value="E3">3</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Módulo / Rua</label>
                        <input 
                          type="text" 
                          value={searchModulo}
                          onChange={(e) => setSearchModulo(e.target.value)}
                          placeholder="Ex: 11"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase font-mono font-bold"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Posição</label>
                        <input 
                          type="text" 
                          value={searchPosicao}
                          onChange={(e) => setSearchPosicao(e.target.value)}
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
                          onChange={(e) => setSearchRef(e.target.value)}
                          placeholder="Ex: 092, 132"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase font-mono font-bold"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-455 font-bold block uppercase mb-1">Descrição Produto</label>
                        <input 
                          type="text" 
                          value={searchDesc}
                          onChange={(e) => setSearchDesc(e.target.value)}
                          placeholder="Ex: RASO, COUP, ETC"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Estoque</label>
                        <select
                          value={filterEstoque}
                          onChange={(e) => setFilterEstoque(e.target.value)}
                          className="w-full border border-slate-300 bg-white rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                        >
                          <option value="">Todos (E1, E2, E3)</option>
                          <option value="E1">Estoque 1 (E1)</option>
                          <option value="E2">Estoque 2 (E2)</option>
                          <option value="E3">Estoque 3 (E3)</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Stats header */}
              <div className="flex justify-between items-center bg-slate-100 text-slate-600 text-xs px-4 py-2 border border-slate-200 rounded-lg font-medium">
                <span>Total de <strong>{filteredSlots.length}</strong> endereços correspondendo aos filtros inseridos.</span>
                <span>Saldo físico total localizado: <strong>{filteredSlots.reduce((acc, s) => acc + s.saldo, 0).toLocaleString()} pçs</strong></span>
              </div>

              {/* Data Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600 uppercase text-[10px] tracking-wider border-b border-slate-200">
                        <th className="py-3 px-4 font-bold font-mono">Estoque</th>
                        <th className="py-3 px-4 font-bold">Módulo / Rua</th>
                        <th className="py-3 px-4 font-bold">Posição</th>
                        <th className="py-3 px-4 font-bold font-mono text-center">Referência SKU</th>
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
                        filteredSlots.map((s) => {
                          const isOccupied = s.saldo > 0;
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
                              <td className="py-3 px-4 truncate max-w-[200px]">
                                {isOccupied ? s.descricao : <span className="text-slate-300 italic font-normal">Vaga desocupada</span>}
                              </td>
                              <td className="py-3 px-4 text-right font-black pr-6">
                                {isOccupied ? (
                                  <span className={`${s.saldo >= 1000 ? 'text-indigo-600' : 'text-slate-800'}`}>{s.saldo.toLocaleString()} pçs</span>
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
                          <td colSpan={11} className="py-20 text-center text-slate-400 font-medium bg-slate-50">
                            Nenhum endereço correspondente aos filtros de pesquisa inseridos.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: LANÇAMENTO EM LOTE (Travas validator spreadsheet) */}
          {activeTab === "lançamento" && (
            <div className="space-y-6">
              
              {/* If advanced mode, offer a toggle between Lançamento Unitário and Lançamento em Lote */}
              {appMode === "avancado" && (
                <div className="flex bg-slate-100 p-1.5 rounded-xl max-w-lg border border-slate-200">
                  <button
                    onClick={() => setSelectedLaunchType("unitario")}
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
                          placeholder="Ex: 11/04, NT"
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-bold uppercase focus:outline-none text-slate-800 font-mono"
                        />
                      </div>

                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => handleUnitaryLaunch("Entrada")}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 text-xs font-bold transition shadow-xs cursor-pointer uppercase text-center font-bold"
                        >
                          Entrada
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUnitaryLaunch("Saída")}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 text-xs font-bold transition shadow-xs cursor-pointer uppercase text-center font-bold"
                        >
                          Saída
                        </button>
                      </div>
                    </div>
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

                    <div className="overflow-x-auto">
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
                      onClick={handleLancarLote}
                      className="bg-indigo-600 hover:bg-indigo-750 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-5 py-2 text-xs font-bold transition shadow-sm uppercase tracking-wider cursor-pointer"
                    >
                      Lançar Lote Completo
                    </button>
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
                        onClick={handleImportExcelData}
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
                  <div className="min-w-[1100px] border border-slate-350 rounded-xl overflow-hidden bg-slate-50 shadow-inner">
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
                                  type="date" 
                                  value={row.data}
                                  onChange={(e) => updateRowField(row.id, "data", e.target.value)}
                                  className="w-full border border-slate-300 rounded p-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                />
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
                                  className="w-full border border-slate-300 rounded p-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                />
                              </td>

                              {/* Hora */}
                              <td className="py-2 px-2.5">
                                <input 
                                  type="text" 
                                  value={row.hora}
                                  onChange={(e) => updateRowField(row.id, "hora", e.target.value)}
                                  className="w-full border border-slate-300 rounded p-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono text-center"
                                />
                              </td>

                              {/* Responsável log */}
                              <td className="py-2 px-2.5">
                                <input 
                                  type="text" 
                                  value={row.responsavel}
                                  onChange={(e) => updateRowField(row.id, "responsavel", e.target.value)}
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
            const filteredHistory = history.filter((h) => {
              if (histSearchSku.trim()) {
                let cleanIn = histSearchSku.trim().toUpperCase();
                if (cleanIn.startsWith("S")) cleanIn = cleanIn.slice(1);
                let cleanH = h.referencia.toUpperCase();
                if (cleanH.startsWith("S")) cleanH = cleanH.slice(1);
                if (!cleanH.includes(cleanIn)) return false;
              }
              if (histFilterEstoque) {
                const cleanH = h.estoque.replace("E", "");
                const cleanF = histFilterEstoque.replace("E", "");
                if (cleanH !== cleanF) return false;
              }
              if (histFilterModulo.trim()) {
                const cleanH = h.modulo.replace(/^[RM]/i, "");
                const cleanF = histFilterModulo.trim().replace(/^[RM]/i, "");
                if (!cleanH.includes(cleanF)) return false;
              }
              if (histFilterPosicao.trim()) {
                const cleanH = h.posicao.replace(/^[RMG]/i, "").toUpperCase();
                const cleanF = histFilterPosicao.trim().replace(/^[RMG]/i, "").toUpperCase();
                const matchesCorredorText = "CORREDOR".includes(cleanF) || cleanF === "";
                const isCorredorH = h.posicao === "";
                
                if (isCorredorH && matchesCorredorText) {
                  // Keep match
                } else if (!cleanH.includes(cleanF)) {
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
                    <button
                      onClick={handleExportarHistorico}
                      className="bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-lg px-4 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer uppercase tracking-wider font-sans whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5 text-indigo-600" />
                      Exportar Histórico
                    </button>
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
                        <option value="E1">1</option>
                        <option value="E2">2</option>
                        <option value="E3">3</option>
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

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-605 uppercase text-[10px] tracking-wider font-bold">
                          <th className="py-3.5 px-4">Cod Mov</th>
                          <th className="py-3.5 px-4">Data Registro</th>
                          <th className="py-3.5 px-4">Efetuado por</th>
                          <th className="py-3.5 px-4 font-mono">Estoque</th>
                          <th className="py-3.5 px-4">Módulo / Rua</th>
                          <th className="py-3.5 px-4">Posição</th>
                          <th className="py-3.5 px-4 font-mono text-center">Referência</th>
                          <th className="py-3.5 px-4 text-right">Quantidade</th>
                          <th className="py-3.5 px-4 text-center">Tipo</th>
                          <th className="py-3.5 px-4 font-mono">Data Chacote</th>
                          <th className="py-3.5 px-4">Responsável Físico</th>
                          <th className="py-3.5 px-4">Hora</th>
                          {currentUser?.role === "Administrador" && (
                            <th className="py-3.5 px-4 text-center text-red-605 font-bold font-sans">Ações</th>
                          )}
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
                              <td className="py-3 px-4 font-mono text-slate-500">{h.hora}</td>
                              {currentUser?.role === "Administrador" && (
                                <td className="py-3 px-4 text-center">
                                  <button
                                    onClick={() => handleDeleteHistoryItem(h.id)}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition cursor-pointer flex items-center justify-center mx-auto"
                                    title="Excluir esta linha do histórico"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={currentUser?.role === "Administrador" ? 13 : 12} className="py-20 text-center text-slate-400 font-semibold bg-slate-50">
                              Nenhuma movimentação registrada no histórico local correspondendo aos filtros.
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
              onUpdateDivergencias={setDivergencias}
              onUpdateSlots={setSlots}
              onAddHistory={(newHist) => setHistory([...newHist, ...history])}
              hasAccess={hasAccess}
            />
          )}

          {/* TAB 6: BASE DE DADOS (References List and registering new ones) */}
          {activeTab === "base" && (
            <BaseDeDadosPanel
              productsList={productsList}
              slots={slots}
              onRegisterProduct={registerNewProduct}
              hasAccess={hasAccess}
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
              onUpdateSlots={setSlots}
              onAddHistory={(newHist) => setHistory([...newHist, ...history])}
              hasAccess={hasAccess}
            />
          )}

          {/* TAB 8: GÊMEO DIGITAL (Interactive visual twin) */}
          {activeTab === "mapa" && (
            <div className="space-y-6">
              <InteractiveMapa 
                slots={slots} 
                productsList={productsList}
                onQuickUpdateSlot={(updated) => {
                  setSlots(slots.map(s => s.id === updated.id ? updated : s));
                  
                  // Keep history
                  const logId = `MOV-${generateId()}`;
                  const updateHistory: HistoricoMov = {
                    id: logId,
                    dataLancamento: new Date().toLocaleDateString("pt-BR"),
                    quemLancou: operator,
                    data: new Date().toLocaleDateString("pt-BR"),
                    estoque: updated.estoque,
                    modulo: updated.modulo,
                    posicao: updated.posicao,
                    referencia: updated.referencia || "RECONCILIADO",
                    quantidade: updated.saldo,
                    tipo: "Entrada",
                    dataChacote: updated.dataChacote,
                    hora: updated.ultimaHour || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                    responsavel: updated.ultimoResponsavel
                  };
                  setHistory([updateHistory, ...history]);
                }}
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
                    Atalhos de dúvidas recorrentes que nossa inteligência lê do estoque de louças:
                  </p>

                  <div className="space-y-2 text-[11px] font-sans">
                    <button
                      onClick={() => setChatInput("Qual é o produto mais estocado no endereçamento?")}
                      className="w-full text-left bg-white hover:bg-slate-100 p-2 border border-slate-200 rounded-lg transition font-bold text-slate-700"
                    >
                      📦 Qual item mais estocado?
                    </button>
                    <button
                      onClick={() => setChatInput("Quais são as divergências em aberto nesse momento?")}
                      className="w-full text-left bg-white hover:bg-slate-100 p-2 border border-slate-200 rounded-lg transition font-bold text-slate-700"
                    >
                      ⚠️ Divergências em aberto?
                    </button>
                    <button
                      onClick={() => setChatInput("Indique uma vaga para colocar 111")}
                      className="w-full text-left bg-white hover:bg-slate-100 p-2 border border-slate-200 rounded-lg transition font-bold text-slate-700"
                    >
                      💡 Vaga recomendada para 111?
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

              {currentUser?.role === "Administrador" && (
                <div className="bg-red-50 border border-red-250 rounded-xl p-5 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4 font-sans">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-red-800 flex items-center gap-1.5 uppercase tracking-wider">
                      <ShieldAlert className="w-4 h-4 text-red-600" />
                      Manutenção do Sistema (Limpar Dados Operacionais)
                    </h4>
                    <p className="text-xs text-red-600 font-medium leading-relaxed max-w-2xl">
                      Esvazie completamente os estoques endereçados, o log de histórico de movimentações lógicas e todos os relatórios de divergências abertos ou fechados. O cadastro de usuários e a base de produtos continuarão intactos. Utilizado para reiniciar o ciclo operacional com saldo zerado.
                    </p>
                  </div>
                  <button
                    onClick={handleClearAllOperationalData}
                    className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4.5 py-2.5 text-xs font-bold transition shadow-sm cursor-pointer uppercase font-extrabold text-center border border-red-600 hover:border-red-700 whitespace-nowrap"
                  >
                    Excluir todos os registros
                  </button>
                </div>
              )}
            </div>
          )}

        </div>

      </main>

    </div>
  );
}
