import { useState, useEffect, useMemo, useRef, FormEvent, KeyboardEvent } from "react";
import { calcularPaletes } from "./lib/palletUtils";
import {
  buildStoragePlans,
  buildSeparationPlan,
  buildRemontagemPlan,
  buildStrategyAnalysis,
  buildChacoteQuantityAnalysis,
  isPhysicalPositionActive,
  parseChacoteDate,
} from "./lib/consultorEngine";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { supabase } from './lib/supabase';
import type { PermissionKey } from "./constants/permissionCatalog.ts";
import { createStockSearchSpreadsheetRow, createStockSearchPdfRow, getStockSearchPdfHeaders } from "./lib/stockSearchExportProjection";
import {
  checkCurrentAppPermission,
  checkCurrentAppPermissions,
  isAppPermissionEnforcementEnabled,
  loadMyAppPermissionContext,
} from "./lib/appPermissionService.ts";
import { arePermissionsGranted, type AppPermissionContext } from "./lib/permissionAppContextModel.ts";
import { guardedSupabaseRequest } from './lib/supabaseRequestGuard';
import { enqueueLancamentoDraftWrite } from './lib/lancamentoDraftQueue';
import {
  buildSharedDraftSyncPlan,
  isBlankLancamentoDraftRow,
  normalizeLancamentoDraftRow,
  parseSharedLancamentoDraftSnapshot,
  type SharedLancamentoDraftLine,
  type SharedLancamentoDraftSnapshot,
} from "./lib/sharedLancamentoDraft";
import { findCorroboratedDivergenceSlot } from "./lib/divergenceResolution";
import { buildMapQuickCorrectionPlan, isMapQuickCorrectionSnapshotCurrent } from "./lib/mapQuickCorrection";
import { buildZeroPhysicalAddressPlan, ZeroPhysicalAddressPlanError } from "./lib/zeroPhysicalAddressPlan";
import { 
  processLancamentosInSequence,
  processTransferenciaPosicao,
  validateLancamentoRow,
  canRecordDivergenceOnlyScope,
  getSlotIdentityMismatch,
  getAuxiliarySlotIdentity,
  isBasePhysicalSlotAtOwnAddress,
  generateId
} from "./data/mockStorage";
import { 
  WarehouseSlot, 
  HistoricoMov, 
  Divergencia, 
  LancamentoRow, 
  Product,
  Galpao,
  Restricao,
  WarehouseLayoutEntry,
  WarehousePositionConfig
} from "./types";
import { PRODUCT_CATALOG, findProductInList } from "./data/products";
import { normalizeRole, canExecuteOperations, isAdmin, isReadOnlyRole } from "./constants/permissions";
import { DashboardCards } from "./components/DashboardCards";
import { StockBalanceHistoryPanel } from "./components/StockBalanceHistoryPanel";
import { InteractiveMapa } from "./components/InteractiveMapa";
import { AdminUsersManagement, AppUser } from "./components/AdminUsersManagement";
import { DivergenciasPanel } from "./components/DivergenciasPanel";
import { MobileShell } from "./components/mobile/MobileShell";
import { readOfflineSnapshot, saveOfflineSnapshot } from "./lib/offlineCache";
import { BaseDeDadosPanel } from "./components/BaseDeDadosPanel";
import { WarehouseLayoutPanel } from "./components/WarehouseLayoutPanel";
import { getDefaultE1Layout, getE1CapacityMap, getE1TotalCapacity, loadWarehouseLayout, saveWarehouseLayout } from "./lib/warehouseLayout";
import { deleteWarehouseModule, deleteWarehousePosition, loadWarehousePositions, saveWarehousePositions } from "./lib/warehousePositions";
import { 
  LayoutDashboard,
  PlusCircle,
  PackageSearch,
  PackagePlus,
  ClipboardList,
  TriangleAlert,
  Boxes,
  Warehouse,
  MapPinned,
  BrainCircuit,

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
  UserPlus,
  Settings2
} from "lucide-react";

const HISTORY_PAGE_SIZE = 1000;
const MAX_READ_PAGES = 50; // Limite defensivo: no máximo 50 páginas (50.000 registros) por carga.
const HISTORY_DASHBOARD_DAYS = 60;
const PRODUCT_SEARCH_PAGE_SIZE = 100;

const CONSULTOR_QUICK_QUESTIONS = {
  "Operação e Endereçamento": [
    ["📍", "Onde devo armazenar este SKU?"],
    ["📦", "Onde separar este SKU?"],
    ["🔄", "Onde devo remontar este SKU?"],
    ["💡", "Qual a melhor estratégia para organizar este SKU?"],
    ["📊", "Qual a concentração atual deste SKU?"],
  ],
  "Qualidade e Chacote": [
    ["📅", "Quantas peças tenho por chacote até 07/2026?"],
    ["📆", "Quantas peças tenho entre 01/07/2026 e 31/07/2026?"],
    ["🔎", "Quantas peças tenho do SKU 23101G até julho de 2026?"],
    ["🗓️", "Quantas peças do SKU 23101G tenho de 01/07/2026 até 31/07/2026?"],
  ],
  "PCP e Planejamento": [
    ["📈", "Qual a situação geral do estoque hoje?"],
    ["🏭", "Qual a capacidade e tendência do estoque?"],
    ["⏳", "Quais SKUs estão sem rotatividade há mais de 30 dias?"],
    ["🏆", "Quais os 5 itens mais estocados?"],
  ],
  "Diretoria e Gestão": [
    ["🧭", "Faça um resumo executivo do setor."],
    ["⚠️", "Existem divergências em aberto?"],
    ["📊", "Quais são os principais riscos do estoque hoje?"],
    ["📌", "Quais são os principais pontos de atenção do setor?"],
  ],
} as const;

const LANCAMENTO_DRAFT_LOCAL_KEY = "eb_lancamento_draft_v1";
const LANCAMENTO_DRAFT_LEGACY_QUARANTINE_KEY = "eb_lancamento_draft_legacy_quarantine_v1";
const LANCAMENTO_BATCH_PENDING_KEY = "eb_lancamento_batch_pending_v1";

const hasUnresolvedBatchMarker = (): boolean => {
  try {
    return localStorage.getItem(LANCAMENTO_BATCH_PENDING_KEY) !== null;
  } catch {
    // Failing to read the idempotency guard is not permission to start a new batch.
    return true;
  }
};

interface SharedDraftMeta {
  generationId: string | null;
  revision: number;
}

type StockMutationOperation = "launch" | "transfer" | "physical_correction";

interface SharedDraftBatchContext {
  batchId: string;
  generationId: string;
  expectedRevision: number;
  inputRows: SharedLancamentoDraftLine[];
  resultSummary: Record<string, number | string | boolean>;
}

interface SharedDraftRpcResult {
  success?: boolean;
  code?: string;
  message?: string;
  conflict?: boolean;
  [key: string]: unknown;
}

const loadSharedLancamentoDraftFromSupabase = async (): Promise<SharedLancamentoDraftSnapshot> => {
  const { data, error } = await supabase.rpc("get_shared_lancamento_draft" as never, {} as never);
  if (error) throw new Error(`Não foi possível carregar o rascunho compartilhado: ${error.message}`);
  return parseSharedLancamentoDraftSnapshot(data);
};

const invokeSharedDraftRpc = async (
  functionName: string,
  args: Record<string, unknown>,
): Promise<SharedDraftRpcResult> => {
  const { data, error } = await supabase.rpc(functionName as never, args as never);
  if (error) throw new Error(`${functionName}: ${error.message}`);
  const result = data && typeof data === "object" ? data as SharedDraftRpcResult : null;
  if (!result || result.success !== true) {
    const code = String(result?.code ?? "SHARED_DRAFT_RPC_FAILED");
    const message = String(result?.message ?? code);
    const errorResult = new Error(`${code}: ${message}`) as Error & { code?: string; conflict?: boolean };
    errorResult.code = code;
    errorResult.conflict = result?.conflict === true;
    throw errorResult;
  }
  return result;
};

const isSharedDraftConflict = (error: unknown): boolean => {
  const item = error as { code?: string; message?: string; conflict?: boolean } | null;
  return item?.conflict === true || /DRAFT_(?:LINE|GENERATION|REVISION|SNAPSHOT)|BATCH_GENERATION_CONFLICT/i.test(
    `${item?.code ?? ""} ${item?.message ?? ""}`,
  );
};

const newOperationUuid = (): string => {
  const nativeUuid = globalThis.crypto?.randomUUID?.();
  if (nativeUuid) return nativeUuid;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const newLancamentoDraftLineId = (): string => `ROW-${newOperationUuid()}`;

const getTodayIsoDate = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatDateMask = (value: string): string => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const formatStoredDateForInput = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return value;
};

const normalizeDateInputValue = (value: string): string => {
  const formatted = formatDateMask(value);
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(formatted)) return formatted;

  const [day, month, year] = formatted.split("/");
  return `${year}-${month}-${day}`;
};

const formatChacoteMask = (value: string): string => {
  const clean = value.trim().toUpperCase();
  if (/^N(T)?$/.test(clean)) return clean;

  const digits = clean.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const normalizeTypedMovementType = (
  value: string,
  current: LancamentoRow["tipo"]
): LancamentoRow["tipo"] => {
  const normalized = value
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!normalized) return "";
  if (normalized.startsWith("E")) return "Entrada";
  if (normalized.startsWith("S") || normalized.startsWith("A")) return "Saída";
  return current;
};


const SLOT_DATA_ACTIVE_TABS = new Set([
  "dashboard",
  "endereçamento",
  "lançamento",
  "divergências",
  "base",
  "configuracao",
  "mapa",
  "ai",
]);

const DIVERGENCE_DATA_ACTIVE_TABS = new Set([
  "dashboard",
  "lançamento",
  "divergências",
  "mapa",
  "ai",
]);

const getIsoDateDaysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return getTodayIsoDate(date);
};

type SlotsSnapshotSource = "remote_complete" | "offline_cache";
interface SlotsSnapshotLoadResult {
  rows: WarehouseSlot[];
  source: SlotsSnapshotSource;
}

const slotsLoadPromises = new Map<string, Promise<SlotsSnapshotLoadResult>>();

const loadSlotsFromSupabase = (
  cacheScope: string,
  authorizationFingerprint: string,
): Promise<SlotsSnapshotLoadResult> => {
  const cacheKey = `${cacheScope}:${authorizationFingerprint}`;
  const existing = slotsLoadPromises.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<SlotsSnapshotLoadResult> => {
    const allData: any[] = [];
    let from = 0;
    let paginationComplete = false;

    for (let page = 0; page < MAX_READ_PAGES; page += 1) {
      const response = await guardedSupabaseRequest(`slots.list:${from}`, () =>
        supabase
          .from("slots")
          .select("id,estoque,modulo,posicao,referencia,descricao,saldo,dataChacote,ultimaData,ultimaHora,ultimoResponsavel,galpao,restricao,observacao")
          .order("id", { ascending: true })
          .range(from, from + HISTORY_PAGE_SIZE - 1),
        "slots.list",
      );
      const { data, error } = response;

      if (error) {
        if (!response.blocked) console.error("Erro ao carregar slots:", error);
        return {
          rows: (await readOfflineSnapshot<WarehouseSlot[]>(
            "slots", cacheScope, authorizationFingerprint,
          )) ?? [],
          source: "offline_cache",
        };
      }

      if (!data || data.length === 0) {
        paginationComplete = true;
        break;
      }

      allData.push(...data);

      if (data.length < HISTORY_PAGE_SIZE) {
        paginationComplete = true;
        break;
      }

      from += HISTORY_PAGE_SIZE;
    }

    if (!paginationComplete) {
      console.error(`Carga de slots interrompida no limite de ${MAX_READ_PAGES} páginas; evitando consultas sem fim.`);
      return {
        rows: (await readOfflineSnapshot<WarehouseSlot[]>(
          "slots", cacheScope, authorizationFingerprint,
        )) ?? [],
        source: "offline_cache",
      };
    }

    const result = allData as WarehouseSlot[];
    await saveOfflineSnapshot("slots", result, cacheScope, authorizationFingerprint);
    return { rows: result, source: "remote_complete" };
  })();

  slotsLoadPromises.set(cacheKey, promise);
  void promise.then(
    () => {
      if (slotsLoadPromises.get(cacheKey) === promise) slotsLoadPromises.delete(cacheKey);
    },
    () => {
      if (slotsLoadPromises.get(cacheKey) === promise) slotsLoadPromises.delete(cacheKey);
    },
  );

  return promise;
};

interface HistoryLoadOptions {
  startDate?: string;
  endDate?: string;
}

// slot_id é um vínculo auxiliar para navegação do histórico; não é usado para
// calcular saldos. Detectamos compatibilidade da coluna uma vez por sessão para
// que um schema antigo não quebre todas as consultas/gravações de history.
let historySlotIdColumnSupported: boolean | null = null;

const isMissingSlotIdColumnError = (error: unknown): boolean => {
  const item = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  const code = String(item?.code ?? "").toUpperCase();
  const message = `${item?.message ?? ""} ${item?.details ?? ""} ${item?.hint ?? ""}`;
  return /slot_id/i.test(message) && (
    code === "42703" || code === "PGRST204" || code === "PGRST205" ||
    /column .*slot_id.*does not exist|slot_id.*schema cache|could not find .*slot_id/i.test(message)
  );
};

const historySelectColumns = (includeSlotId: boolean): string =>
  "id,dataLancamento,quemLancou,data,estoque,modulo,posicao,referencia,quantidade,tipo,dataChacote,hora,responsavel,galpao,observacao" +
  (includeSlotId ? ",slot_id" : "") +
  ",restricao,naturezaTransacao,saldoAnterior,saldoFinal,correcaoId";

const mapHistoryRowFromSupabase = (row: any): HistoricoMov => {
  const { slot_id, slotId: legacySlotId, ...rest } = row ?? {};

  return {
    ...rest,
    slotId: slot_id ?? legacySlotId ?? undefined,
  } as HistoricoMov;
};

const mapHistoryRowsForSupabase = (rows: HistoricoMov[]) =>
  rows.map(({ slotId, ...row }) => {
    if (historySlotIdColumnSupported === false) return row;
    const normalizedSlotId = typeof slotId === "string" ? slotId.trim() : "";
    return { ...row, slot_id: normalizedSlotId || null };
  });

const normalizeHistoricalStock = (value: string): string =>
  String(value ?? "").trim().toUpperCase().replace(/^E/i, "");

const normalizeHistoricalModule = (value: string): string => {
  const raw = String(value ?? "").trim().toUpperCase().replace(/^[RM]/i, "");
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
};

const normalizeHistoricalPosition = (value: string): string =>
  String(value ?? "").trim().toUpperCase();

const normalizeHistoricalRestriction = (value?: string): string => {
  const restriction = String(value ?? "nenhuma").trim().toLowerCase();
  return ["teste", "autorizacao", "outra"].includes(restriction) ? restriction : "nenhuma";
};

/**
 * A history record may legitimately refer to an auxiliary item row that was
 * removed when its saldo reached zero. Retain the historical ID only when the
 * ID's encoded address and (for auxiliary rows) SKU/restriction still match the
 * movement itself; otherwise drop the optional link, never the movement.
 */
const historicalSlotIdMatchesMovement = (movement: HistoricoMov, slotId: string): boolean => {
  const estoque = normalizeHistoricalStock(movement.estoque);
  const module = normalizeHistoricalModule(movement.modulo);
  const position = normalizeHistoricalPosition(movement.posicao || "");

  if (estoque === "1") {
    const parts = slotId.split("-");
    if (parts.length < 3) return false;
    const idStock = normalizeHistoricalStock(parts[0]);
    const idModule = normalizeHistoricalModule(parts[1]);
    const idSku = parts.slice(2).join("-").trim().toUpperCase();
    return idStock === estoque && idModule === module &&
      idSku === String(movement.referencia || "").trim().toUpperCase();
  }

  if (estoque !== "2" && estoque !== "3") return false;
  const marker = "::ITEM::";
  const markerIndex = slotId.indexOf(marker);
  const addressId = markerIndex >= 0 ? slotId.slice(0, markerIndex) : slotId;
  const addressParts = addressId.split("-");
  if (addressParts.length < 3) return false;

  const idStock = normalizeHistoricalStock(addressParts[0]);
  const idModule = normalizeHistoricalModule(addressParts[1]);
  const idPosition = normalizeHistoricalPosition(addressParts.slice(2).join("-"));
  if (idStock !== estoque || idModule !== module || idPosition !== position) return false;

  if (markerIndex < 0) return true; // A base ID names the physical address.
  const [encodedSku = "", encodedRestriction = "", ...extra] = slotId.slice(markerIndex + marker.length).split("::");
  if (!encodedSku.trim() || !encodedRestriction.trim() || extra.length > 0) return false;
  return encodedSku.trim().toUpperCase() === String(movement.referencia || "").trim().toUpperCase() &&
    normalizeHistoricalRestriction(encodedRestriction) === normalizeHistoricalRestriction(movement.restricao);
};

/** Remove stale/incorrect optional links; never drops the movement itself. */
const validateHistorySlotLinks = (
  rows: HistoricoMov[],
  knownSlotIds: Set<string>,
): HistoricoMov[] => {
  let invalidCount = 0;
  const validated = rows.map(movement => {
    const slotId = typeof movement.slotId === "string" ? movement.slotId.trim() : "";
    if (slotId && !knownSlotIds.has(slotId) && !historicalSlotIdMatchesMovement(movement, slotId)) {
      invalidCount += 1;
      return { ...movement, slotId: undefined };
    }
    return { ...movement, slotId: slotId || undefined };
  });

  if (invalidCount > 0) {
    console.warn(
      `${invalidCount} movimentação(ões) serão gravadas sem slot_id porque o ID não corresponde ao endereço/SKU/restrição da movimentação.`
    );
  }
  return validated;
};

/**
 * Carrega histórico por período, paginado para não depender do limite padrão do Supabase.
 * Sem período, mantém o comportamento de buscar todos os registros apenas quando isso
 * for explicitamente necessário (ex.: exportação "Tudo").
 */
const loadHistoryFromSupabaseUncached = async (
  options: HistoryLoadOptions,
  cacheScope: string,
  authorizationFingerprint: string,
): Promise<HistoricoMov[]> => {
  const allData: any[] = [];
  let from = 0;
  let paginationComplete = false;

  for (let page = 0; page < MAX_READ_PAGES; page += 1) {
    const includeSlotId = historySlotIdColumnSupported !== false;
    const buildHistoryQuery = (withSlotId: boolean) => {
      let query = supabase
        .from("history")
        .select(historySelectColumns(withSlotId))
        .order("data", { ascending: false })
        .order("hora", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + HISTORY_PAGE_SIZE - 1);
      if (options.startDate) query = query.gte("data", options.startDate);
      if (options.endDate) query = query.lte("data", options.endDate);
      return query;
    };

    let usedSlotIdColumn = includeSlotId;
    let response = await guardedSupabaseRequest(
      includeSlotId
        ? `history.list:${options.startDate ?? ""}:${options.endDate ?? ""}:${from}`
        : `history.list.without-slot-id:${options.startDate ?? ""}:${options.endDate ?? ""}:${from}`,
      () => buildHistoryQuery(includeSlotId),
      includeSlotId ? "history.list.with-slot-id" : "history.list.without-slot-id",
    );

    if (response.error && includeSlotId && isMissingSlotIdColumnError(response.error)) {
      historySlotIdColumnSupported = false;
      usedSlotIdColumn = false;
      console.warn("A coluna history.slot_id não existe no schema atual. O histórico será carregado sem esse vínculo opcional.");
      response = await guardedSupabaseRequest(
        `history.list.without-slot-id:${options.startDate ?? ""}:${options.endDate ?? ""}:${from}`,
        () => buildHistoryQuery(false),
        "history.list.without-slot-id",
      );
    }

    const { data, error } = response;
    if (error) {
      if (!response.blocked) console.error("Erro ao carregar histórico:", error);
      return (await readOfflineSnapshot<HistoricoMov[]>(
        "history", cacheScope, authorizationFingerprint,
      )) ?? [];
    }
    if (usedSlotIdColumn) historySlotIdColumnSupported = true;

    if (!data || data.length === 0) {
      paginationComplete = true;
      break;
    }

    allData.push(...data);

    if (data.length < HISTORY_PAGE_SIZE) {
      paginationComplete = true;
      break;
    }

    from += HISTORY_PAGE_SIZE;
  }

  if (!paginationComplete) {
    console.error(`Carga de histórico interrompida no limite de ${MAX_READ_PAGES} páginas; evitando consultas sem fim. Usando o cache autorizado desta sessão.`);
    return (await readOfflineSnapshot<HistoricoMov[]>(
      "history", cacheScope, authorizationFingerprint,
    )) ?? [];
  }

  const result = allData.map(mapHistoryRowFromSupabase);
  await saveOfflineSnapshot("history", result, cacheScope, authorizationFingerprint);
  return result;
};

/**
 * Histórico é append-only. Nunca reenviamos o histórico inteiro para o banco.
 */
const historyLoadPromises = new globalThis.Map<string, Promise<HistoricoMov[]>>();

const loadHistoryFromSupabase = (
  options: HistoryLoadOptions,
  cacheScope: string,
  authorizationFingerprint: string,
): Promise<HistoricoMov[]> => {
  const key = `${cacheScope}|${authorizationFingerprint}|${options.startDate ?? ""}|${options.endDate ?? ""}`;
  const existing = historyLoadPromises.get(key);
  if (existing) return existing;

  const promise = loadHistoryFromSupabaseUncached(options, cacheScope, authorizationFingerprint);
  historyLoadPromises.set(key, promise);

  promise.then(
    () => {
      if (historyLoadPromises.get(key) === promise) historyLoadPromises.delete(key);
    },
    () => {
      if (historyLoadPromises.get(key) === promise) historyLoadPromises.delete(key);
    },
  );

  return promise;
};

const latestHistoryLoadPromises = new Map<string, Promise<HistoricoMov | null>>();

const loadLatestHistoryRecord = (
  cacheScope: string,
  authorizationFingerprint: string,
): Promise<HistoricoMov | null> => {
  const cacheKey = `${cacheScope}:${authorizationFingerprint}`;
  const existing = latestHistoryLoadPromises.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<HistoricoMov | null> => {
    const includeSlotId = historySlotIdColumnSupported !== false;
    const buildLatestHistoryQuery = (withSlotId: boolean) =>
      supabase
        .from("history")
        .select(historySelectColumns(withSlotId))
        .lte("data", getTodayIsoDate())
        .order("data", { ascending: false })
        .order("hora", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

    let usedSlotIdColumn = includeSlotId;
    let response = await guardedSupabaseRequest(
      includeSlotId ? "history.latest" : "history.latest.without-slot-id",
      () => buildLatestHistoryQuery(includeSlotId),
      includeSlotId ? "history.latest.with-slot-id" : "history.latest.without-slot-id",
    );

    if (response.error && includeSlotId && isMissingSlotIdColumnError(response.error)) {
      historySlotIdColumnSupported = false;
      usedSlotIdColumn = false;
      console.warn("A coluna history.slot_id não existe no schema atual. A última movimentação será carregada sem esse vínculo opcional.");
      response = await guardedSupabaseRequest(
        "history.latest.without-slot-id",
        () => buildLatestHistoryQuery(false),
        "history.latest.without-slot-id",
      );
    }

    const { data, error } = response;
    if (error) {
      if (!response.blocked) console.error("Erro ao carregar última movimentação:", error);
      return null;
    }
    if (usedSlotIdColumn) historySlotIdColumnSupported = true;

    return data ? mapHistoryRowFromSupabase(data) : null;
  })();

  latestHistoryLoadPromises.set(cacheKey, promise);
  void promise.then(
    () => {
      if (latestHistoryLoadPromises.get(cacheKey) === promise) latestHistoryLoadPromises.delete(cacheKey);
    },
    () => {
      if (latestHistoryLoadPromises.get(cacheKey) === promise) latestHistoryLoadPromises.delete(cacheKey);
    },
  );

  return promise;
};

// Normaliza o vínculo opcional de endereço entre o modelo da aplicação e o schema SQL.
const mapDivergenciaRowFromSupabase = (row: any): Divergencia => {
  const { slot_id, slotId: legacySlotId, ...rest } = row ?? {};

  return {
    ...rest,
    slotId: slot_id ?? legacySlotId ?? undefined,
  } as Divergencia;
};

// As RPCs de mutação recebem o nome SQL slot_id; a aplicação mantém slotId.
const mapDivergenciasForSupabase = (rows: Divergencia[]) =>
  rows.map(({ slotId, ...row }) => {
    const normalizedSlotId = typeof slotId === "string" ? slotId.trim() : "";
    return { ...row, slot_id: normalizedSlotId || null };
  });

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

/**
 * O lançamento em lote exige snapshots atuais e completos do banco.
 * Estas leituras não aceitam cache offline nem Promise compartilhada; a
 * paginação tem limite defensivo e interrompe o lote diante de falha/incompletude.
 */
const loadFreshSlotsForBatch = async (): Promise<WarehouseSlot[]> => {
  const rows: WarehouseSlot[] = [];
  let from = 0;
  let complete = false;

  for (let page = 0; page < MAX_READ_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("slots")
      .select("id,estoque,modulo,posicao,referencia,descricao,saldo,dataChacote,ultimaData,ultimaHora,ultimoResponsavel,galpao,restricao,observacao")
      .order("id", { ascending: true })
      .range(from, from + HISTORY_PAGE_SIZE - 1);
    if (error) throw new Error(`Falha ao atualizar o estoque para o lote: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("O Supabase não confirmou a leitura completa do estoque para o lote.");
    rows.push(...data as WarehouseSlot[]);
    if (data.length < HISTORY_PAGE_SIZE) {
      complete = true;
      break;
    }
    from += HISTORY_PAGE_SIZE;
  }

  if (!complete) throw new Error(`A leitura do estoque atingiu o limite defensivo de ${MAX_READ_PAGES} páginas; o lote foi cancelado.`);
  return rows;
};

const loadFreshDivergenciasForBatch = async (): Promise<Divergencia[]> => {
  const rawRows: unknown[] = [];
  let from = 0;
  let complete = false;

  for (let page = 0; page < MAX_READ_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("divergencias")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + HISTORY_PAGE_SIZE - 1);
    if (error) throw new Error(`Falha ao atualizar as divergências para o lote: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("O Supabase não confirmou a leitura completa das divergências para o lote.");
    rawRows.push(...data);
    if (data.length < HISTORY_PAGE_SIZE) {
      complete = true;
      break;
    }
    from += HISTORY_PAGE_SIZE;
  }

  if (!complete) throw new Error(`A leitura das divergências atingiu o limite defensivo de ${MAX_READ_PAGES} páginas; o lote foi cancelado.`);
  const normalized = rawRows.map(normalizeDivergenciaRow);
  if (normalized.some(row => row === null)) {
    throw new Error("Há divergências com status inválido no banco. O lote foi interrompido para não processar com um snapshot incompleto.");
  }
  return normalized as Divergencia[];
};

interface DivergenciasSnapshotLoadResult {
  rows: Divergencia[];
  source: "remote_complete" | "offline_cache";
}

const divergenciasLoadPromises = new Map<string, Promise<DivergenciasSnapshotLoadResult>>();

const loadDivergenciasFromSupabase = (
  cacheScope: string,
  authorizationFingerprint: string,
): Promise<DivergenciasSnapshotLoadResult> => {
  const cacheKey = `${cacheScope}:${authorizationFingerprint}`;
  const existing = divergenciasLoadPromises.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<DivergenciasSnapshotLoadResult> => {
    const allData: any[] = [];
    let from = 0;
    let paginationComplete = false;

    for (let page = 0; page < MAX_READ_PAGES; page += 1) {
      // Carregamos todas as divergências, não somente "Aberta".
      // Isso mantém o histórico, mas limita cada carga para evitar paginação infinita.
      const response = await guardedSupabaseRequest(`divergencias.list:${from}`, () =>
        supabase
          .from("divergencias")
          .select("*")
          .order("id", { ascending: true })
          .range(from, from + HISTORY_PAGE_SIZE - 1),
        "divergencias.list",
      );
      const { data, error } = response;

      if (error) {
        if (!response.blocked) console.error("Erro ao carregar divergências:", error);
        const cached = await readOfflineSnapshot<Divergencia[]>(
          "divergencias", cacheScope, authorizationFingerprint,
        );
        return {
          rows: (cached ?? [])
            .map(normalizeDivergenciaRow)
            .filter((div): div is Divergencia => Boolean(div)),
          source: "offline_cache",
        };
      }

      if (!data || data.length === 0) {
        paginationComplete = true;
        break;
      }

      allData.push(...data);

      if (data.length < HISTORY_PAGE_SIZE) {
        paginationComplete = true;
        break;
      }

      from += HISTORY_PAGE_SIZE;
    }

    if (!paginationComplete) {
      console.error(`Carga de divergências interrompida no limite de ${MAX_READ_PAGES} páginas; evitando paginação infinita.`);
      const cached = await readOfflineSnapshot<Divergencia[]>(
        "divergencias", cacheScope, authorizationFingerprint,
      );
      return {
        rows: (cached ?? [])
          .map(normalizeDivergenciaRow)
          .filter((div): div is Divergencia => Boolean(div)),
        source: "offline_cache",
      };
    }

    const result = allData
      .map(normalizeDivergenciaRow)
      .filter((div): div is Divergencia => Boolean(div));

    await saveOfflineSnapshot("divergencias", result, cacheScope, authorizationFingerprint);
    return { rows: result, source: "remote_complete" };
  })();

  divergenciasLoadPromises.set(cacheKey, promise);
  void promise.then(
    () => {
      if (divergenciasLoadPromises.get(cacheKey) === promise) divergenciasLoadPromises.delete(cacheKey);
    },
    () => {
      if (divergenciasLoadPromises.get(cacheKey) === promise) divergenciasLoadPromises.delete(cacheKey);
    },
  );

  return promise;
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
  const sessionDataGenerationRef = useRef(0);

  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  // Permission enforcement is opt-in during rollout and can run in development only
  // against the local Supabase sandbox. The normal localhost -> production setup stays unchanged.
  const permissionEnforcementEnabled = isAppPermissionEnforcementEnabled();
  const [appPermissionContext, setAppPermissionContextState] = useState<AppPermissionContext | null>(null);
  const appPermissionContextRef = useRef<AppPermissionContext | null>(null);
  const setAppPermissionContext = (context: AppPermissionContext | null) => {
    appPermissionContextRef.current = context;
    setAppPermissionContextState(context);
  };
  const [permissionContextStatus, setPermissionContextStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [permissionContextError, setPermissionContextError] = useState<string | null>(null);
  const [permissionContextRevision, setPermissionContextRevision] = useState(0);

  // Realtime caches the table RLS decision for the lifetime of a WebSocket.
  // Supabase sends the renewed JWT to Realtime on TOKEN_REFRESHED; reload the
  // app permission context on the same event so UI and Realtime authorization
  // converge without adding a permission channel or polling.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        setPermissionContextRevision(current => current + 1);
      } else if (event === "SIGNED_OUT") {
        setAuthUserId(null);
        setCurrentUser(null);
        setAppPermissionContext(null);
        setPermissionContextStatus("idle");
        setPermissionContextError(null);
        setPermissionContextRevision(current => current + 1);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;

    if (!permissionEnforcementEnabled) {
      setAppPermissionContext(null);
      setPermissionContextStatus("idle");
      setPermissionContextError(null);
      return () => { active = false; };
    }

    if (!authUserId) {
      setAppPermissionContext(null);
      setPermissionContextStatus("idle");
      setPermissionContextError(null);
      return () => { active = false; };
    }

    const hasReusablePermissionContext =
      appPermissionContextRef.current?.userId === authUserId;

    if (!hasReusablePermissionContext) {
      setAppPermissionContext(null);
      setPermissionContextStatus("loading");
    } else {
      setPermissionContextStatus("ready");
    }

    setPermissionContextError(null);

    loadMyAppPermissionContext(authUserId)
      .then((context) => {
        if (!active) return;
        setAppPermissionContext(context);
        setPermissionContextStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Falha desconhecida ao carregar permissões.";
        console.error("Não foi possível carregar o contexto de permissões; exportações serão bloqueadas.", message);
        setAppPermissionContext(null);
        setPermissionContextStatus("error");
        setPermissionContextError(message);
      });

    return () => { active = false; };
  }, [authUserId, permissionEnforcementEnabled, permissionContextRevision]);

  const canUseAppPermissionForUi = (permissionKey: PermissionKey): boolean => {
    if (!permissionEnforcementEnabled) return true;
    return (
      permissionContextStatus === "ready" &&
      appPermissionContext?.userId === authUserId &&
      appPermissionContext.permissions[permissionKey] === true
    );
  };
  // Presentation only: the authorized stock-search scope contains every field.
  // These flags preserve the existing desktop/mobile layouts and are not grants.
  const showStockDetailsInSearch = true;
  const showSlotMetadataInSearch = true;

  // A cached snapshot is reusable only by the same authenticated user with the
  // exact same effective permission matrix. A changed/revoked permission therefore
  // invalidates the offline fallback without deleting another user's cache.
  const offlineCacheScope = authUserId ?? "unauthenticated";
  const offlineCacheAuthorizationFingerprint = permissionEnforcementEnabled
    ? permissionContextStatus === "ready" &&
      appPermissionContext?.userId === authUserId &&
      appPermissionContext
      ? Object.keys(appPermissionContext.permissions)
          .sort()
          .map((key) => `${key}:${appPermissionContext.permissions[key as PermissionKey] ? "1" : "0"}`)
          .join("|")
      : "permission-context-unavailable"
    : "legacy-unrestricted";

  const canExportWithScope = (...scopeKeys: PermissionKey[]): boolean => {
    if (!permissionEnforcementEnabled) return true;
    if (
      permissionContextStatus !== "ready" ||
      !appPermissionContext ||
      appPermissionContext.userId !== authUserId
    ) return false;
    return arePermissionsGranted(appPermissionContext.permissions, ["reports.export", ...scopeKeys]);
  };

  const canExportStockSearch = canExportWithScope("stock.search");
  const canExportHistory = canExportWithScope("history.view");
  const canExportDivergences = canExportWithScope("divergences.view");
  const canExportDashboardDetails = canExportWithScope("dashboard.view");
  const canExportConsultor = canExportWithScope("consultor.use");

  /** Rechecks the mutation permission in PostgreSQL immediately before writing. */
  const requestAppMutationPermission = async (
    permissionKey: PermissionKey,
    actionLabel: string,
  ): Promise<boolean> => {
    if (!permissionEnforcementEnabled) return true;

    if (
      !authUserId ||
      permissionContextStatus !== "ready" ||
      !appPermissionContext ||
      appPermissionContext.userId !== authUserId
    ) {
      alert(`Não foi possível validar as permissões da sessão. ${actionLabel} foi bloqueado; atualize o aplicativo e tente novamente.`);
      return false;
    }

    if (!arePermissionsGranted(appPermissionContext.permissions, [permissionKey])) {
      alert(`Seu perfil não possui permissão para ${actionLabel.toLowerCase()}.`);
      return false;
    }

    try {
      const allowed = await checkCurrentAppPermission(permissionKey);
      if (allowed) return true;

      setAppPermissionContext(null);
      setPermissionContextStatus("error");
      setPermissionContextError("PERMISSION_MUTATION_REJECTED");
      alert(`A permissão para ${actionLabel.toLowerCase()} foi negada pelo banco. Atualize a sessão antes de tentar novamente.`);
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida ao validar a permissão.";
      console.error(`Verificação de permissão para ${actionLabel.toLowerCase()} falhou; operação bloqueada.`, message);
      setAppPermissionContext(null);
      setPermissionContextStatus("error");
      setPermissionContextError(message);
      alert(`Não foi possível confirmar sua permissão para ${actionLabel.toLowerCase()}. A operação foi bloqueada por segurança.`);
      return false;
    }
  };

  const requestReportExportPermission = async (scopeKeys: readonly PermissionKey[]): Promise<boolean> => {
    if (!permissionEnforcementEnabled) return true;

    if (
      !authUserId ||
      permissionContextStatus !== "ready" ||
      !appPermissionContext ||
      appPermissionContext.userId !== authUserId
    ) {
      alert("Não foi possível validar as permissões desta sessão. A exportação foi bloqueada; atualize o aplicativo e tente novamente.");
      return false;
    }

    const requiredKeys = Array.from(new Set<PermissionKey>(["reports.export", ...scopeKeys]));
    if (!arePermissionsGranted(appPermissionContext.permissions, requiredKeys)) {
      alert("Seu perfil não possui permissão para exportar dados deste módulo ou consultar todos os dados necessários.");
      return false;
    }

    try {
      // One database round-trip checks the global export grant and the module/data scope.
      const allowed = await checkCurrentAppPermissions(requiredKeys);
      if (!allowed) {
        // Backend denial while the cached context says otherwise means stale/inconsistent auth state.
        // Block sensitive exports until login/session refresh rather than guessing which key changed.
        setAppPermissionContext(null);
        setPermissionContextStatus("error");
        setPermissionContextError("PERMISSION_SCOPE_REJECTED");
        alert("Uma permissão necessária foi negada ou mudou. Atualize a sessão antes de exportar novamente.");
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida ao validar as permissões.";
      console.error("Verificação das permissões de exportação falhou; operação bloqueada.", message);
      setAppPermissionContext(null);
      setPermissionContextStatus("error");
      setPermissionContextError(message);
      alert("Não foi possível confirmar suas permissões de exportação. A operação foi bloqueada por segurança.");
      return false;
    }
  };

  // Login Form input state
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoadError, setUsersLoadError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<string>("endereçamento");
  const [historyContentTab, setHistoryContentTab] = useState<"movements" | "daily">("movements");

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
    const requestGeneration = sessionDataGenerationRef.current;
    if (!isAdmin(currentUser?.role)) {
      if (requestGeneration === sessionDataGenerationRef.current) {
        setUsers([]);
        setUsersLoading(false);
        setUsersLoadError(null);
      }
      return;
    }

    if (usersLoadPromiseRef.current) {
      try {
        const cachedUsers = await usersLoadPromiseRef.current;
        if (requestGeneration === sessionDataGenerationRef.current) {
          setUsers(cachedUsers);
          setUsersLoadError(null);
        }
      } catch (error) {
        console.error("Erro ao carregar usuários administrativos:", error);
        if (requestGeneration === sessionDataGenerationRef.current) {
          setUsersLoadError("Não foi possível carregar a lista de usuários. Tente novamente.");
        }
      } finally {
        if (requestGeneration === sessionDataGenerationRef.current) {
          setUsersLoading(false);
        }
      }
      return;
    }

    setUsersLoading(true);
    setUsersLoadError(null);

    const promise = (async (): Promise<AppUser[]> => {
      const { error, data } = await supabase.functions.invoke("admin-users", {
        body: { operation: "list" }
      });

      if (error) throw error;
      if (!data || !Array.isArray(data.users)) {
        throw new Error("Resposta inválida ao consultar a lista administrativa de usuários.");
      }

      return data.users.map((user: {
        id: string;
        email?: string;
        username: string;
        name: string;
        role: string;
      }) => ({
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: getAppRole(user.role)
      }));
    })();

    usersLoadPromiseRef.current = promise;

    try {
      const formattedUsers = await promise;
      if (requestGeneration === sessionDataGenerationRef.current) {
        setUsers(formattedUsers);
        setUsersLoadError(null);
      }
    } catch (error) {
      console.error("Erro ao carregar usuários administrativos:", error);
      if (requestGeneration === sessionDataGenerationRef.current) {
        setUsersLoadError("Não foi possível carregar a lista de usuários. Tente novamente.");
      }
    } finally {
      if (usersLoadPromiseRef.current === promise) {
        usersLoadPromiseRef.current = null;
      }
      if (requestGeneration === sessionDataGenerationRef.current) {
        setUsersLoading(false);
      }
    }
  };

useEffect(() => {
  loadCurrentAuthUser();
}, []);

const shouldSyncSlotsForActiveTab = SLOT_DATA_ACTIVE_TABS.has(activeTab);
const canReadCompleteSlots = !permissionEnforcementEnabled || (
  permissionContextStatus === "ready" && canUseAppPermissionForUi("stock.search")
);

useEffect(() => {
  if (!authUserId || !currentUser || !shouldSyncSlotsForActiveTab) {
    slotsRealtimeStatusRef.current = "inactive";
    return;
  }
  if (!canReadCompleteSlots) {
    updateSlotsState(() => []);
    slotsRealtimeStatusRef.current = permissionContextStatus === "ready" ? "denied" : "syncing";
    return;
  }
  slotsRealtimeStatusRef.current = "syncing";

  let active = true;
  let initialLoadComplete = false;
  let loadGeneration = 0;
  let initialLoadInFlight = false;
  let lastInitialLoadAt = 0;
  let channelConnected = false;
  let hadConnectionError = false;
  let resyncAfterLoad = false;
  let reconnectResyncTimer: ReturnType<typeof setTimeout> | null = null;
  const INITIAL_LOAD_COOLDOWN_MS = 30_000;
  const changesDuringInitialLoad = new Map<string, WarehouseSlot | null>();
  const pendingSlotChanges = new Map<string, WarehouseSlot | null>();
  let slotFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleOfflineSnapshot = () => {
    if (snapshotTimer !== null) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      if (active) void saveOfflineSnapshot("slots", slotsRef.current, offlineCacheScope, offlineCacheAuthorizationFingerprint);
    }, 250);
  };

  const flushPendingSlotChanges = () => {
    slotFlushTimer = null;
    if (!active || pendingSlotChanges.size === 0) return;

    const pending = new Map(pendingSlotChanges);
    pendingSlotChanges.clear();

    updateSlotsState(current => {
      const byId = new Map(current.map(slot => [slot.id, slot]));
      for (const [id, incoming] of pending) {
        if (incoming === null) byId.delete(id);
        else byId.set(id, incoming);
      }
      return Array.from(byId.values());
    });
    scheduleOfflineSnapshot();
  };

  const startInitialLoad = (reason: "initial" | "fallback" | "reconnect" = "initial") => {
    if (!active) return;
    if (initialLoadInFlight) {
      if (reason === "reconnect") resyncAfterLoad = true;
      return;
    }

    if (reason === "reconnect" && lastInitialLoadAt > 0) {
      const remaining = INITIAL_LOAD_COOLDOWN_MS - (Date.now() - lastInitialLoadAt);
      if (remaining > 0) {
        if (reconnectResyncTimer === null) {
          reconnectResyncTimer = setTimeout(() => {
            reconnectResyncTimer = null;
            // Never query just because a timer elapsed while Realtime is down.
            // The next SUBSCRIBED confirmation will schedule a resync if needed.
            if (channelConnected) startInitialLoad("reconnect");
          }, remaining);
        }
        return;
      }
    }

    if (reconnectResyncTimer !== null) {
      clearTimeout(reconnectResyncTimer);
      reconnectResyncTimer = null;
    }

    if (reason === "reconnect") {
      // The authoritative snapshot includes changes committed while the channel
      // was unavailable; discard queued pre-snapshot events to avoid stale replay.
      pendingSlotChanges.clear();
      if (slotFlushTimer !== null) {
        clearTimeout(slotFlushTimer);
        slotFlushTimer = null;
      }
    }
    slotsRealtimeStatusRef.current = "syncing";
    lastInitialLoadAt = Date.now();
    initialLoadInFlight = true;
    const generation = ++loadGeneration;
    initialLoadComplete = false;
    changesDuringInitialLoad.clear();

    // A assinatura é estabelecida antes da fotografia paginada. Assim, eventos
    // recebidos enquanto a carga ocorre prevalecem sobre os dados da consulta.
    void loadSlotsFromSupabase(offlineCacheScope, offlineCacheAuthorizationFingerprint)
      .then(snapshot => {
        if (!active || generation !== loadGeneration) return;

        const mergedById = new Map<string, WarehouseSlot>(snapshot.rows.map(slot => [slot.id, slot] as [string, WarehouseSlot]));
        for (const [id, incoming] of changesDuringInitialLoad) {
          if (incoming === null) mergedById.delete(id);
          else mergedById.set(id, incoming);
        }

        const merged = Array.from(mergedById.values());
        initialLoadComplete = true;
        updateSlotsState(() => merged);
        slotsRealtimeStatusRef.current = snapshot.source === "remote_complete" && channelConnected
          ? "ready"
          : "stale";
        void saveOfflineSnapshot("slots", merged, offlineCacheScope, offlineCacheAuthorizationFingerprint);
      })
      .catch(error => {
        slotsRealtimeStatusRef.current = "stale";
        console.error("Erro ao carregar posições da Pesquisa de Estoque:", error);
      })
      .finally(() => {
        initialLoadInFlight = false;
        if (resyncAfterLoad && active && channelConnected) {
          resyncAfterLoad = false;
          startInitialLoad("reconnect");
        }
      });
  };

  const channel = supabase
    .channel("slots-search-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "slots" },
      payload => {
        if (!active) return;

        const eventType = payload.eventType;
        const rawRow = eventType === "DELETE" ? payload.old : payload.new;
        const eventId = String((rawRow as any)?.id ?? "");
        if (!eventId) return;

        const incoming = eventType === "DELETE" ? null : rawRow as WarehouseSlot;
        if (!initialLoadComplete) changesDuringInitialLoad.set(eventId, incoming);
        pendingSlotChanges.set(eventId, incoming);

        // Agrupa eventos de lotes próximos para limitar re-renderizações e
        // gravações repetidas do cache local. Não dispara consultas ao banco.
        if (slotFlushTimer === null) {
          slotFlushTimer = setTimeout(flushPendingSlotChanges, 50);
        }
      }
    )
    .subscribe(status => {
      if (!active) return;

      if (status === "SUBSCRIBED") {
        channelConnected = true;
        console.info("[Realtime] Pesquisa de estoque conectada.");
        if (hadConnectionError) {
          hadConnectionError = false;
          startInitialLoad("reconnect");
        } else if (!initialLoadComplete && lastInitialLoadAt === 0) {
          startInitialLoad("initial");
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        channelConnected = false;
        slotsRealtimeStatusRef.current = "stale";
        console.warn("[Realtime] Atualização ao vivo da Pesquisa de Estoque indisponível:", status);
        hadConnectionError = true;
        // If the initial snapshot has not started yet, perform a single fallback
        // read. After data is loaded, wait for SUBSCRIBED before a reconnect read.
        if (!initialLoadComplete && lastInitialLoadAt === 0) {
          startInitialLoad("fallback");
        }
      }
    });

  return () => {
    active = false;
    if (slotFlushTimer !== null) clearTimeout(slotFlushTimer);
    if (snapshotTimer !== null) clearTimeout(snapshotTimer);
    if (reconnectResyncTimer !== null) clearTimeout(reconnectResyncTimer);
    pendingSlotChanges.clear();
    changesDuringInitialLoad.clear();
    slotsRealtimeStatusRef.current = "inactive";
    void supabase.removeChannel(channel);
  };
}, [
  authUserId,
  currentUser,
  shouldSyncSlotsForActiveTab,
  canReadCompleteSlots,
  permissionContextStatus,
  offlineCacheAuthorizationFingerprint,
]);

useEffect(() => {
  if (!authUserId) return;
  if (permissionEnforcementEnabled && (
    permissionContextStatus !== "ready" ||
    (!canUseAppPermissionForUi("warehouse.layout.view") &&
      !canUseAppPermissionForUi("warehouse.layout.manage") &&
      !canUseAppPermissionForUi("map.view") &&
      !canUseAppPermissionForUi("stock.launch.view") &&
      !canUseAppPermissionForUi("stock.launch.create") &&
      !canUseAppPermissionForUi("stock.transfer.create") &&
      !canUseAppPermissionForUi("stock.batch.process"))
  )) {
    setWarehouseLayout(getDefaultE1Layout());
    setWarehouseLayoutError(null);
    setWarehousePositions([]);
    setWarehousePositionsError(null);
    return;
  }

  let cancelled = false;

  const loadLayout = async () => {
    setWarehouseLayoutLoading(true);
    const result = await loadWarehouseLayout();

    if (cancelled) return;

    setWarehouseLayout(result.data);
    setWarehouseLayoutError(result.error);
    setWarehouseLayoutLoading(false);
  };

  loadLayout();

  return () => {
    cancelled = true;
  };
}, [
  authUserId,
  permissionEnforcementEnabled,
  permissionContextStatus,
  offlineCacheAuthorizationFingerprint,
]);

useEffect(() => {
  if (!authUserId) return;
  if (permissionEnforcementEnabled && (
    permissionContextStatus !== "ready" ||
    (!canUseAppPermissionForUi("warehouse.layout.view") &&
      !canUseAppPermissionForUi("warehouse.layout.manage") &&
      !canUseAppPermissionForUi("map.view") &&
      !canUseAppPermissionForUi("stock.launch.view") &&
      !canUseAppPermissionForUi("stock.launch.create") &&
      !canUseAppPermissionForUi("stock.transfer.create") &&
      !canUseAppPermissionForUi("stock.batch.process"))
  )) {
    setWarehousePositions([]);
    setWarehousePositionsError(null);
    return;
  }

  let cancelled = false;

  const loadPositions = async () => {
    setWarehousePositionsLoading(true);
    const result = await loadWarehousePositions();

    if (cancelled) return;

    setWarehousePositions(result.data);
    setWarehousePositionsError(result.error);
    setWarehousePositionsLoading(false);
  };

  loadPositions();

  return () => {
    cancelled = true;
  };
}, [
  authUserId,
  permissionEnforcementEnabled,
  permissionContextStatus,
  offlineCacheAuthorizationFingerprint,
]);

useEffect(() => {
  if (activeTab !== "dashboard" && activeTab !== "histórico" && activeTab !== "ai") {
    return;
  }
  if (permissionEnforcementEnabled && (
    permissionContextStatus !== "ready" || !canUseAppPermissionForUi("history.view")
  )) {
    setHistory([]);
    return;
  }

  let active = true;
  const loadHistory = async () => {
    const today = getTodayIsoDate();
    const needsDashboardWindow = activeTab === "dashboard" || activeTab === "ai";

    // Dashboard/IA precisam da janela de 60 dias para indicadores e análises.
    // A tela Histórico consulta somente o dia selecionado por padrão; períodos
    // maiores são carregados sob demanda pelo botão "Consultar período".
    const data = await loadHistoryFromSupabase({
      startDate: needsDashboardWindow
        ? getIsoDateDaysAgo(HISTORY_DASHBOARD_DAYS)
        : today,
      endDate: today,
    }, offlineCacheScope, offlineCacheAuthorizationFingerprint);

    if (!active) return;
    if (!needsDashboardWindow) {
      setHistory(data);
      return;
    }

    // Mantém o indicador de "última movimentação" do Dashboard mesmo
    // quando o último movimento aconteceu fora da janela dos últimos 60 dias.
    const latest = await loadLatestHistoryRecord(offlineCacheScope, offlineCacheAuthorizationFingerprint);
    if (!active) return;
    const merged = latest && !data.some(item => item.id === latest.id)
      ? [latest, ...data]
      : data;

    setHistory(merged);
  };

  void loadHistory().catch(error => {
    if (active) console.error("Erro inesperado ao preparar histórico da tela:", error);
  });

  return () => { active = false; };
}, [
  activeTab,
  authUserId,
  permissionEnforcementEnabled,
  permissionContextStatus,
  offlineCacheAuthorizationFingerprint,
]);

const shouldSyncDivergenciasForActiveTab = DIVERGENCE_DATA_ACTIVE_TABS.has(activeTab);
const canReadDivergencias = !permissionEnforcementEnabled || (
  permissionContextStatus === "ready" && canUseAppPermissionForUi("divergences.view")
);

useEffect(() => {
  if (!currentUser) {
    divergenciasRef.current = [];
    setDivergencias([]);
    divergenciasRealtimeStatusRef.current = "inactive";
    return;
  }
  if (!canReadDivergencias) {
    divergenciasRef.current = [];
    setDivergencias([]);
    divergenciasRealtimeStatusRef.current = permissionContextStatus === "ready" ? "denied" : "syncing";
    return;
  }
  if (!shouldSyncDivergenciasForActiveTab) {
    divergenciasRealtimeStatusRef.current = "inactive";
    return;
  }

  divergenciasRealtimeStatusRef.current = "syncing";
  let active = true;
  let initialLoadComplete = false;
  let initialLoadInFlight = false;
  let lastInitialLoadAt = 0;
  let loadGeneration = 0;
  let channelConnected = false;
  let hadConnectionError = false;
  let resyncAfterLoad = false;
  let reconnectResyncTimer: ReturnType<typeof setTimeout> | null = null;
  let divergenceFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const RECONNECT_RESYNC_COOLDOWN_MS = 30_000;
  const CHANGES_FLUSH_DELAY_MS = 50;
  const changesDuringInitialLoad = new Map<string, Divergencia | null>();
  const pendingChanges = new Map<string, Divergencia | null>();

  const flushPendingChanges = () => {
    divergenceFlushTimer = null;
    if (!active || !initialLoadComplete || pendingChanges.size === 0) return;

    const changes = Array.from(pendingChanges.entries());
    pendingChanges.clear();

    const next = updateDivergenciasState(current => {
      const byId = new Map(current.map(item => [item.id, item]));
      for (const [id, incoming] of changes) {
        if (incoming === null) byId.delete(id);
        else byId.set(id, incoming);
      }
      return Array.from(byId.values());
    });

    // Lotes de eventos Realtime se reflejan en estado y cache una sola vez,
    // evitando miles de escrituras locales si llegan muchas divergencias juntas.
    void saveOfflineSnapshot("divergencias", next, offlineCacheScope, offlineCacheAuthorizationFingerprint);
  };

  const schedulePendingChangesFlush = () => {
    if (!active || !initialLoadComplete || divergenceFlushTimer !== null) return;
    divergenceFlushTimer = setTimeout(flushPendingChanges, CHANGES_FLUSH_DELAY_MS);
  };

  const startInitialLoad = (reason: "initial" | "fallback" | "reconnect" = "initial") => {
    if (!active) return;
    if (initialLoadInFlight) {
      if (reason === "reconnect") resyncAfterLoad = true;
      return;
    }

    if (reason === "reconnect" && lastInitialLoadAt > 0) {
      const remaining = RECONNECT_RESYNC_COOLDOWN_MS - (Date.now() - lastInitialLoadAt);
      if (remaining > 0) {
        // No crie um loop de cargas se o canal oscilar. No máximo uma
        // ressincronização completa fica agendada dentro da janela de 30 s.
        if (reconnectResyncTimer === null) {
          reconnectResyncTimer = setTimeout(() => {
            reconnectResyncTimer = null;
            // Não consulte o banco enquanto o websocket permanece desconectado.
            // A próxima confirmação SUBSCRIBED agendará a ressincronização.
            if (channelConnected) startInitialLoad("reconnect");
          }, remaining);
        }
        return;
      }
    }

    if (reconnectResyncTimer !== null) {
      clearTimeout(reconnectResyncTimer);
      reconnectResyncTimer = null;
    }

    // Os eventos pendentes já foram confirmados no banco antes de serem
    // publicados; a fotografia seguinte recupera o estado atual. Cancele
    // apenas a gravação local pendente para não aplicá-la duas vezes.
    pendingChanges.clear();
    if (divergenceFlushTimer !== null) {
      clearTimeout(divergenceFlushTimer);
      divergenceFlushTimer = null;
    }

    initialLoadInFlight = true;
    initialLoadComplete = false;
    divergenciasRealtimeStatusRef.current = "syncing";
    lastInitialLoadAt = Date.now();
    const generation = ++loadGeneration;
    changesDuringInitialLoad.clear();

    // A fotografia completa é refeita após uma reconexão bem-sucedida para
    // recuperar eventos ocorridos enquanto o websocket esteve desconectado.
    void loadDivergenciasFromSupabase(offlineCacheScope, offlineCacheAuthorizationFingerprint)
      .then(snapshot => {
        if (!active || generation !== loadGeneration) return;

        const mergedById = new Map<string, Divergencia>(snapshot.rows.map(item => [item.id, item]));
        for (const [id, eventRow] of changesDuringInitialLoad) {
          if (eventRow === null) mergedById.delete(id);
          else mergedById.set(id, eventRow);
        }

        const merged = Array.from(mergedById.values());
        changesDuringInitialLoad.clear();
        initialLoadComplete = true;
        divergenciasRef.current = merged;
        setDivergencias(merged);
        divergenciasRealtimeStatusRef.current = snapshot.source === "remote_complete" && channelConnected
          ? "ready"
          : "stale";
        void saveOfflineSnapshot("divergencias", merged, offlineCacheScope, offlineCacheAuthorizationFingerprint);
      })
      .catch(error => {
        divergenciasRealtimeStatusRef.current = "stale";
        console.error("Erro ao inicializar sincronização de divergências:", error);
      })
      .finally(() => {
        if (generation === loadGeneration) {
          initialLoadInFlight = false;
          if (resyncAfterLoad && active) {
            resyncAfterLoad = false;
            startInitialLoad("reconnect");
          }
        }
      });
  };

  const channel = supabase
    .channel("divergencias-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "divergencias" },
      payload => {
        if (!active) return;

        const eventType = payload.eventType;
        const rawRow = eventType === "DELETE" ? payload.old : payload.new;
        const eventId = String((rawRow as any)?.id ?? "");
        if (!eventId) return;

        const incoming = eventType === "DELETE" ? null : normalizeDivergenciaRow(rawRow);
        if (eventType !== "DELETE" && !incoming) return;

        if (!initialLoadComplete) {
          changesDuringInitialLoad.set(eventId, incoming);
          return;
        }

        pendingChanges.set(eventId, incoming);
        schedulePendingChangesFlush();
      }
    )
    .subscribe(status => {
      if (status === "SUBSCRIBED") {
        channelConnected = true;
        console.info("[Realtime] Sincronização de divergências conectada.");
        if (hadConnectionError) {
          hadConnectionError = false;
          startInitialLoad("reconnect");
        } else if (!initialLoadComplete && lastInitialLoadAt === 0) {
          startInitialLoad("initial");
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        channelConnected = false;
        divergenciasRealtimeStatusRef.current = "stale";
        console.warn("[Realtime] Sincronização de divergências indisponível:", status);
        hadConnectionError = true;
        // Se ainda não houve fotografia inicial, carrega uma vez como fallback.
        // Após já ter dados, aguarda a próxima conexão para ressincronizar.
        if (!initialLoadComplete && lastInitialLoadAt === 0) {
          startInitialLoad("fallback");
        }
      }
    });

  return () => {
    active = false;
    if (reconnectResyncTimer !== null) clearTimeout(reconnectResyncTimer);
    if (divergenceFlushTimer !== null) clearTimeout(divergenceFlushTimer);
    pendingChanges.clear();
    changesDuringInitialLoad.clear();
    divergenciasRealtimeStatusRef.current = "inactive";
    void supabase.removeChannel(channel);
  };
}, [
  currentUser,
  authUserId,
  shouldSyncDivergenciasForActiveTab,
  canReadDivergencias,
  offlineCacheAuthorizationFingerprint,
]);

  // --- DYNAMIC REGISTERED CUSTOM PRODUCTS STATE ---
  const [productsList, setProductsList] = useState<Product[]>([]);

  const canReadProductsForCurrentContext = (): boolean => {
    if (!permissionEnforcementEnabled) return true;
    if (permissionContextStatus !== "ready") return false;
    return [
      "products.view",
      "products.create",
      "products.edit",
      "products.import_bulk",
      "products.delete_deactivate",
      "stock.search",
      "stock.launch.view",
      "stock.launch.create",
      "stock.transfer.create",
      "stock.batch.process",
      "consultor.use",
    ].some((key) => canUseAppPermissionForUi(key as PermissionKey));
  };

  const loadProductsFromSupabase = async () => {
    const requestGeneration = sessionDataGenerationRef.current;
    if (!canReadProductsForCurrentContext()) {
      setProductsList([]);
      return;
    }
    if (productsLoadPromiseRef.current) {
      const cachedProducts = await productsLoadPromiseRef.current;
      if (requestGeneration === sessionDataGenerationRef.current && cachedProducts) {
        setProductsList(cachedProducts);
      }
      return;
    }

    const promise = (async (): Promise<Product[]> => {
      const response = await guardedSupabaseRequest("products.list", () =>
        supabase
          .from("products")
          .select("referencia,descricao,paletizacao")
      );
      const { data, error } = response;

      if (error) {
        if (!response.blocked) console.error("Erro ao carregar produtos:", error);
        const cached = await readOfflineSnapshot<Product[]>("products", offlineCacheScope, offlineCacheAuthorizationFingerprint);
        return cached ?? [];
      }

      const result = (data ?? []).map((p: any) => ({
        referencia: p.referencia,
        descricao: p.descricao,
        paletizacao: Number(p.paletizacao || 0)
      }));
      await saveOfflineSnapshot("products", result, offlineCacheScope, offlineCacheAuthorizationFingerprint);
      return result;
    })();

    productsLoadPromiseRef.current = promise;

    try {
      const loadedProducts = await promise;
      if (requestGeneration === sessionDataGenerationRef.current && loadedProducts) {
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
      setProductsList([]);
      return;
    }
    if (permissionEnforcementEnabled && permissionContextStatus !== "ready") {
      setProductsList([]);
      return;
    }

    const tabsRequiringProducts = [
      "dashboard",
      "endereçamento",
      "lançamento",
      "divergências",
      "base",
      "mapa",
      "ai"
    ];

    if (tabsRequiringProducts.includes(activeTab) && canReadProductsForCurrentContext()) {
      loadProductsFromSupabase();
    } else if (!canReadProductsForCurrentContext()) {
      setProductsList([]);
    }
  }, [
    activeTab,
    currentUser,
    permissionEnforcementEnabled,
    permissionContextStatus,
    offlineCacheAuthorizationFingerprint,
  ]);

  // Save changes to custom references list
  const registerNewProduct = async (
    ref: string,
    desc: string,
    paletizacao: number
  ): Promise<boolean> => {
    if (!(await requestAppMutationPermission("products.create", "cadastrar produto"))) return false;

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

  if (!(await requestAppMutationPermission("products.edit", "editar produto"))) return false;

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

  if (!(await requestAppMutationPermission("products.delete_deactivate", "excluir produto"))) return false;

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
  const slotsRef = useRef<WarehouseSlot[]>([]);
  const slotsRealtimeStatusRef = useRef<"inactive" | "syncing" | "ready" | "stale" | "denied">("inactive");
  const divergenciasRealtimeStatusRef = useRef<"inactive" | "syncing" | "ready" | "stale" | "denied">("inactive");

  const updateSlotsState = (
    updater: (current: WarehouseSlot[]) => WarehouseSlot[]
  ): WarehouseSlot[] => {
    const next = updater(slotsRef.current);
    slotsRef.current = next;
    setSlots(next);
    return next;
  };

  // Mescla apenas as linhas recebidas/alteradas, sem substituir outras linhas
  // que possam ter sido atualizadas por Realtime desde o cálculo local.
  const mergeSlotsState = (changedSlots: WarehouseSlot[]): WarehouseSlot[] =>
    updateSlotsState(current => {
      const byId = new Map(current.map(slot => [slot.id, slot]));
      changedSlots.forEach(slot => byId.set(slot.id, slot));
      return Array.from(byId.values());
    });

  const [warehouseLayout, setWarehouseLayout] = useState<WarehouseLayoutEntry[]>(() => getDefaultE1Layout());
  const [warehouseLayoutLoading, setWarehouseLayoutLoading] = useState(false);
  const [warehouseLayoutSaving, setWarehouseLayoutSaving] = useState(false);
  const [warehouseLayoutError, setWarehouseLayoutError] = useState<string | null>(null);
  const [warehousePositions, setWarehousePositions] = useState<WarehousePositionConfig[]>([]);
  const [warehousePositionsLoading, setWarehousePositionsLoading] = useState(false);
  const [warehousePositionsSaving, setWarehousePositionsSaving] = useState(false);
  const [warehousePositionsError, setWarehousePositionsError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoricoMov[]>([]);

  const [divergencias, setDivergencias] = useState<Divergencia[]>([]);
  const divergenciasRef = useRef<Divergencia[]>([]);

  // Mantém uma referência síncrona para combinar eventos remotos e gravações
  // locais sem substituir a lista inteira por um estado potencialmente antigo.
  const updateDivergenciasState = (
    updater: (current: Divergencia[]) => Divergencia[]
  ): Divergencia[] => {
    const next = updater(divergenciasRef.current);
    divergenciasRef.current = next;
    setDivergencias(next);
    return next;
  };

  /**
   * A edição móvel só altera metadados. O saldo, SKU e identidade física são
   * validados pelo banco e nunca são enviados como campos graváveis.
   */
  const handleMobileUpdateSlot = async (updatedSlot: WarehouseSlot): Promise<boolean> => {
    if (slotsRealtimeStatusRef.current !== "ready") {
      alert("Os dados do endereço ainda não estão sincronizados. Aguarde a atualização antes de editar os metadados.");
      return false;
    }
    if (!(await requestAppMutationPermission("map.metadata.edit", "editar metadados do mapa"))) {
      return false;
    }

    if (!navigator.onLine) {
      alert("A edição de metadados exige conexão com o Supabase. Nenhum dado foi alterado.");
      return false;
    }

    const previous = slotsRef.current.find(slot => slot.id === updatedSlot.id);
    if (!previous) {
      alert("O endereço não está mais na fotografia atual. Atualize o aplicativo antes de editar.");
      return false;
    }

    const metadata = {
      dataChacote: String(updatedSlot.dataChacote ?? "").trim(),
      galpao: updatedSlot.galpao ?? "3",
      restricao: updatedSlot.restricao ?? "nenhuma",
      observacao: String(updatedSlot.observacao ?? "").trim(),
    };

    const { data, error } = await supabase.rpc("update_slot_metadata_atomic" as never, {
      p_expected_slot: {
        id: previous.id,
        estoque: previous.estoque,
        modulo: previous.modulo,
        posicao: previous.posicao,
        referencia: previous.referencia,
        descricao: previous.descricao,
        saldo: previous.saldo,
        dataChacote: previous.dataChacote,
        galpao: previous.galpao ?? null,
        restricao: previous.restricao ?? null,
        observacao: previous.observacao ?? null,
      },
      p_metadata: metadata,
    } as never);
    const result = data as { success?: boolean; code?: string; message?: string } | null;

    if (error || result?.success !== true) {
      console.error("Edição de metadados não confirmada:", {
        code: result?.code ?? error?.code,
        message: result?.message ?? error?.message,
      });
      alert(
        "Não foi possível confirmar a edição dos metadados. Atualize o endereço e tente novamente. " +
        "Nenhum saldo ou SKU foi alterado por este fluxo."
      );
      return false;
    }

    const savedSlot: WarehouseSlot = { ...previous, ...metadata };
    const nextSlots = mergeSlotsState([savedSlot]);
    await saveOfflineSnapshot("slots", nextSlots, offlineCacheScope, offlineCacheAuthorizationFingerprint);
    return true;
  };

  const handleSaveWarehouseLayout = async (
    entries: WarehouseLayoutEntry[]
  ): Promise<boolean> => {
    if (!authUserId || !isAdmin(currentUser?.role)) {
      alert("Somente usuários Administrador podem alterar a configuração física.");
      return false;
    }

    setWarehouseLayoutSaving(true);

    const result = await saveWarehouseLayout(entries, warehouseLayout);

    if (result.error || !result.data) {
      setWarehouseLayoutSaving(false);
      alert(
        `Não foi possível salvar a configuração física dos estoques.\n\n${result.error || "Erro desconhecido."}`
      );
      return false;
    }

    setWarehouseLayout(result.data);
    setWarehouseLayoutError(null);
    setWarehouseLayoutSaving(false);
    return true;
  };

  const handleSaveWarehousePositions = async (
    entries: WarehousePositionConfig[]
  ): Promise<boolean> => {
    if (!authUserId || !isAdmin(currentUser?.role)) {
      alert("Somente usuários Administrador podem alterar a configuração física.");
      return false;
    }

    setWarehousePositionsSaving(true);

    const result = await saveWarehousePositions(entries, warehousePositions);

    if (result.error || !result.data) {
      setWarehousePositionsSaving(false);
      alert(
        `Não foi possível salvar as posições físicas dos estoques.\n\n${result.error || "Erro desconhecido."}`
      );
      return false;
    }

    setWarehousePositions(result.data);
    setWarehousePositionsError(null);
    setWarehousePositionsSaving(false);
    return true;
  };

  const handleDeleteWarehousePosition = async (
    estoque: string,
    modulo: string,
    posicao: string
  ): Promise<boolean> => {
    if (!authUserId || !isAdmin(currentUser?.role)) {
      alert("Somente usuários Administrador podem excluir posições.");
      return false;
    }

    const result = await deleteWarehousePosition(estoque, modulo, posicao);

    if (result.error) {
      alert(
        `Não foi possível excluir a posição ${posicao} do módulo ${modulo}.\n\n${result.error}`
      );
      return false;
    }

    setWarehousePositions(current =>
      current.filter(
        position =>
          !(
            position.estoque === String(estoque).replace(/^E/i, "") &&
            String(Number(position.modulo)) === String(Number(modulo)) &&
            position.posicao === posicao.trim().toUpperCase()
          )
      )
    );
    return true;
  };

  const handleDeleteWarehouseModule = async (
    estoque: string,
    modulo: string
  ): Promise<boolean> => {
    if (!authUserId || !isAdmin(currentUser?.role)) {
      alert("Somente usuários Administrador podem excluir módulos.");
      return false;
    }

    const result = await deleteWarehouseModule(estoque, modulo);

    if (result.error) {
      alert(
        `Não foi possível excluir o módulo ${modulo} do Estoque ${estoque}.\n\n${result.error}`
      );
      return false;
    }

    const normalizedEstoque = String(estoque).replace(/^E/i, "");
    const normalizedModulo = String(Number(modulo));

    setWarehousePositions(current =>
      current.filter(
        position =>
          !(
            position.estoque === normalizedEstoque &&
            String(Number(position.modulo)) === normalizedModulo
          )
      )
    );
    setWarehouseLayout(current =>
      current.filter(
        entry =>
          !(
            entry.estoque === normalizedEstoque &&
            String(Number(entry.modulo)) === normalizedModulo
          )
      )
    );

    return true;
  };

  /**
   * Persistência transacional dos fluxos diários de entrada, saída, lote e
   * transferência. Envia snapshots completos dos endereços impactados para as
   * RPCs atômicas existentes; nunca usa fallback para upsert + histórico em
   * chamadas separadas se a RPC falhar ou tiver resposta ambígua.
   */
  const persistStockMutationAtomically = async (
    expectedSlotsSnapshot: WarehouseSlot[],
    updatedSlots: WarehouseSlot[],
    newMovements: HistoricoMov[],
    expectedDivergenciasSnapshot: Divergencia[],
    updatedDivergencias: Divergencia[],
    sharedDraftCommit?: SharedDraftBatchContext,
    operationType?: StockMutationOperation,
  ): Promise<{
    ok: boolean;
    reason?: string;
    code?: string;
    ambiguous?: boolean;
    deletedSlotIds: string[];
    batchResult?: SharedDraftRpcResult;
  }> => {
    const failed = (reason: string, code?: string, ambiguous = false) => ({
      ok: false,
      reason,
      code,
      ambiguous,
      deletedSlotIds: [] as string[],
    });
    if (!navigator.onLine) {
      return failed("A operação de estoque exige conexão com o Supabase. Nenhuma gravação foi iniciada.");
    }
    if (!sharedDraftCommit && (
      slotsRealtimeStatusRef.current !== "ready" ||
      divergenciasRealtimeStatusRef.current !== "ready"
    )) {
      return failed("O estoque ou as divergências ainda não estão sincronizados em tempo real. Aguarde a atualização ou reconecte o aplicativo antes de movimentar.");
    }

    if (sharedDraftCommit) {
      if (!(await requestAppMutationPermission("divergences.view", "consultar divergências para validar o lote"))) {
        return failed("O lote foi bloqueado porque a consulta de divergências não foi autorizada.");
      }
      if (!(await requestAppMutationPermission("stock.batch.process", "processar lote compartilhado"))) {
        return failed("O lote foi bloqueado porque a permissão de processamento não foi confirmada.");
      }
      if (!(await requestAppMutationPermission("stock.launch.create", "registrar lançamentos do lote"))) {
        return failed("O lote foi bloqueado porque a permissão de lançamento não foi confirmada.");
      }
    } else {
      if (!(await requestAppMutationPermission("divergences.view", "consultar divergências para validar a movimentação"))) {
        return failed("A operação foi bloqueada porque a consulta de divergências não foi autorizada.");
      }
      if (!operationType) {
        return failed("Tipo de operação de estoque não informado. Nenhuma gravação foi iniciada.");
      }
      const operationPermission: PermissionKey = operationType === "transfer"
        ? "stock.transfer.create"
        : operationType === "physical_correction"
          ? "stock.physical_correction"
          : "stock.launch.create";
      const operationLabel = operationType === "transfer"
        ? "transferir estoque"
        : operationType === "physical_correction"
          ? "corrigir fisicamente o estoque"
          : "registrar lançamento de estoque";
      if (!(await requestAppMutationPermission(operationPermission, operationLabel))) {
        return failed(`A operação foi bloqueada: a permissão '${operationPermission}' não foi confirmada.`);
      }
    }

    const scopeKey = (row: { estoque: string; modulo: string; posicao?: string }): string =>
      JSON.stringify([
        normalizeHistoricalStock(row.estoque),
        normalizeHistoricalModule(row.modulo),
        normalizeHistoricalStock(row.estoque) === "1"
          ? ""
          : normalizeHistoricalPosition(row.posicao || ""),
      ]);
    const scopeKeys = new Set<string>();
    const expectedSlotsById = new Map(expectedSlotsSnapshot.map(slot => [slot.id, slot]));
    const updatedSlotsById = new Map(updatedSlots.map(slot => [slot.id, slot]));
    const expectedDivergenciasById = new Map(expectedDivergenciasSnapshot.map(div => [div.id, div]));
    const updatedDivergenciasById = new Map(updatedDivergencias.map(div => [div.id, div]));

    if (expectedSlotsById.size !== expectedSlotsSnapshot.length || updatedSlotsById.size !== updatedSlots.length) {
      return failed("Há IDs de endereço duplicados no snapshot local. Atualize os dados antes de lançar.");
    }
    if (
      new Set(newMovements.map(movement => movement.id)).size !== newMovements.length ||
      new Set(updatedDivergencias.map(div => div.id)).size !== updatedDivergencias.length
    ) {
      return failed("Há IDs duplicados no histórico ou nas divergências do payload. Nenhuma gravação foi iniciada.");
    }

    for (const expected of expectedSlotsSnapshot) {
      const next = updatedSlotsById.get(expected.id);
      if (!next || JSON.stringify(expected) !== JSON.stringify(next)) {
        scopeKeys.add(scopeKey(expected));
        if (next) scopeKeys.add(scopeKey(next));
      }
    }
    for (const next of updatedSlots) {
      if (!expectedSlotsById.has(next.id)) scopeKeys.add(scopeKey(next));
    }
    for (const movement of newMovements) scopeKeys.add(scopeKey(movement));
    for (const next of updatedDivergencias) {
      const expected = expectedDivergenciasById.get(next.id);
      if (!expected || JSON.stringify(expected) !== JSON.stringify(next)) {
        scopeKeys.add(scopeKey(next));
        if (expected) scopeKeys.add(scopeKey(expected));
      }
    }

    if (scopeKeys.size === 0 && newMovements.length === 0 && !sharedDraftCommit) {
      return { ok: true, deletedSlotIds: [] };
    }

    const changedExistingDivergence = updatedDivergencias.some(div => {
      const expected = expectedDivergenciasById.get(div.id);
      return Boolean(expected && JSON.stringify(expected) !== JSON.stringify(div));
    });
    const newDivergencesOnly = updatedDivergencias.filter(div => !expectedDivergenciasById.has(div.id));
    const anySlotStateChanged = updatedSlots.some(slot => {
      const expected = expectedSlotsById.get(slot.id);
      return !expected || JSON.stringify(expected) !== JSON.stringify(slot);
    }) || expectedSlotsSnapshot.some(slot => !updatedSlotsById.has(slot.id));

    // Conflict-only batch rows do not mutate stock or append movements. Save
    // their new open divergences separately so an inconsistent legacy slot can
    // be reported without passing that bad row through the stock writer.
    if (
      !anySlotStateChanged &&
      newMovements.length === 0 &&
      newDivergencesOnly.length > 0 &&
      !sharedDraftCommit &&
      !changedExistingDivergence &&
      newDivergencesOnly.every(div => div.status === "Aberta")
    ) {
      // Conflict-only rows use a server-authorized insert-only RPC. This route
      // never updates stock, writes history, or overwrites an existing divergence.
      const { data: conflictResult, error: conflictError } = await supabase.rpc(
        "record_stock_conflict_divergences_atomic",
        {
          p_operation_type: operationType,
          p_divergencias: mapDivergenciasForSupabase(newDivergencesOnly),
        } as never,
      );
      if (conflictError || conflictResult?.success !== true) {
        const code = String(conflictResult?.code ?? conflictError?.code ?? "SEM_CONFIRMACAO");
        const reason = String(conflictResult?.message ?? conflictError?.message ?? "O servidor não confirmou o registro das divergências.");
        console.error("Registro de divergências por conflito não confirmado:", {
          rpc: "record_stock_conflict_divergences_atomic",
          code,
          message: reason,
        });
        return failed(
          `A divergência foi identificada, mas o Supabase não confirmou seu registro (${code}). ${reason} Nenhum saldo foi alterado.`,
          code,
        );
      }
      const merged = updateDivergenciasState(current => {
        const byId = new Map(current.map(div => [div.id, div]));
        newDivergencesOnly.forEach(div => byId.set(div.id, div));
        return Array.from(byId.values());
      });
      await saveOfflineSnapshot("divergencias", merged, offlineCacheScope, offlineCacheAuthorizationFingerprint);
      return { ok: true, deletedSlotIds: [] };
    }

    // Existing divergence records may be included unchanged in a stock write,
    // but resolving one must use the dedicated resolve_stock_divergence_atomic RPC.
    for (const expected of expectedDivergenciasSnapshot) {
      if (!scopeKeys.has(scopeKey(expected))) continue;
      const next = updatedDivergenciasById.get(expected.id);
      if (next && JSON.stringify(expected) !== JSON.stringify(next)) {
        return failed("Uma divergência existente mudou de status/dados. Use o fluxo específico de correção de divergência.");
      }
    }

    const isCanonicalSlotSnapshot = (slot: WarehouseSlot): string | null => {
      const stock = normalizeHistoricalStock(slot.estoque);
      const module = String(slot.modulo ?? "").trim();
      const normalizedModule = normalizeHistoricalModule(module);
      const position = normalizeHistoricalPosition(slot.posicao || "");

      if (!module || module !== normalizedModule || !/^\d+$/.test(module)) {
        return `o módulo '${module}' do registro '${slot.id}' não é canônico. Corrija os módulos antigos com zero à esquerda antes de movimentar esse endereço.`;
      }
      if (stock === "1") {
        if (position !== "") return `o endereço E1 '${slot.id}' tem uma posição física inválida.`;
        if (String(slot.referencia || "").trim()) {
          const expectedId = `1-${module}-${String(slot.referencia).trim().toUpperCase()}`;
          if (slot.id !== expectedId) return `o ID E1 '${slot.id}' não corresponde ao SKU armazenado '${slot.referencia}'.`;
        }
        return null;
      }
      if (stock !== "2" && stock !== "3") return `o estoque '${slot.estoque}' do ID '${slot.id}' é inválido.`;
      if (!position || position !== String(slot.posicao || "")) {
        return `a posição física do ID '${slot.id}' não está normalizada.`;
      }
      const baseId = `${stock}-${module}-${position}`;
      if (slot.id.includes("::ITEM::")) {
        const identity = getAuxiliarySlotIdentity(slot.id);
        if (!identity || identity.addressId !== baseId) {
          return `o ID auxiliar '${slot.id}' não corresponde ao endereço físico ${baseId}.`;
        }
        const mismatch = getSlotIdentityMismatch(slot);
        if (mismatch) return mismatch;
        return null;
      }
      if (slot.id !== baseId) return `o ID base '${slot.id}' deveria ser '${baseId}'.`;
      const mismatch = getSlotIdentityMismatch(slot);
      return mismatch;
    };

    const expectedSlotsInScopes = expectedSlotsSnapshot.filter(slot => scopeKeys.has(scopeKey(slot)));
    const finalSlotsInScopes = updatedSlots.filter(slot => scopeKeys.has(scopeKey(slot)));
    const expectedDivergenciasInScopes = expectedDivergenciasSnapshot.filter(div => scopeKeys.has(scopeKey(div)));

    // A few identifiable operational conflicts are already converted by the
    // batch processor into an explicit divergence. They may be recorded only
    // when that physical scope has no stock/history mutation; the SQL wrapper
    // independently checks the underlying condition before bypassing the normal
    // stock writer for that divergence-only scope.
    const exceptionDivergenceTypes = new Set([
      "Módulo Inativo",
      "ID de Endereço Inconsistente",
    ]);
    const exceptionDivergenceScopes = new Set<string>();
    for (const divergence of newDivergencesOnly) {
      if (!exceptionDivergenceTypes.has(divergence.tipoDivergencia)) continue;
      const key = scopeKey(divergence);
      const hasMovement = newMovements.some(movement => scopeKey(movement) === key);
      const hasSlotChange = updatedSlots.some(slot => {
        if (scopeKey(slot) !== key) return false;
        const expected = expectedSlotsById.get(slot.id);
        return !expected || JSON.stringify(expected) !== JSON.stringify(slot);
      }) || expectedSlotsSnapshot.some(slot =>
        scopeKey(slot) === key && !updatedSlotsById.has(slot.id)
      );
      const hasChangedExistingDivergence = updatedDivergencias.some(div => {
        if (scopeKey(div) !== key) return false;
        const expected = expectedDivergenciasById.get(div.id);
        return Boolean(expected && JSON.stringify(expected) !== JSON.stringify(div));
      });
      const allNewDivergencesAreExceptions = canRecordDivergenceOnlyScope(
        newDivergencesOnly.filter(div => scopeKey(div) === key)
      );
      if (!hasMovement && !hasSlotChange && !hasChangedExistingDivergence && allNewDivergencesAreExceptions) {
        exceptionDivergenceScopes.add(key);
      }
    }

    // Fail closed on malformed IDs/modules in the complete address snapshot,
    // except for a verified divergence-only scope with no stock mutation.
    for (const slot of [...expectedSlotsInScopes, ...finalSlotsInScopes]) {
      if (exceptionDivergenceScopes.has(scopeKey(slot))) continue;
      const issue = isCanonicalSlotSnapshot(slot);
      if (issue) return failed(issue);
    }

    const expectedSlotIdsInScope = new Set(expectedSlotsInScopes.map(slot => slot.id));
    const finalSlotIdsInScope = new Set(finalSlotsInScopes.map(slot => slot.id));
    for (const id of expectedSlotIdsInScope) {
      if (!finalSlotIdsInScope.has(id)) {
        return failed(`O snapshot da operação removeu o ID '${id}' sem a rotina de exclusão atômica. Recarregue e tente novamente.`);
      }
    }

    // Fully exhausted logical rows are removed only inside the same PostgreSQL
    // transaction that writes their exact, balanced movement history. E2/E3
    // auxiliaries and E1 SKU rows are eligible; physical E2/E3 base-address
    // rows are never deleted because they represent real configured vacancies.
    const deleteSlotIds: string[] = [];
    for (const expected of expectedSlotsInScopes) {
      const stock = normalizeHistoricalStock(expected.estoque);
      const isAuxiliary = expected.id.includes("::ITEM::");
      const isE1SkuRow = stock === "1";
      if ((!isAuxiliary && !isE1SkuRow) || Number(expected.saldo || 0) <= 0 || !String(expected.referencia || "").trim()) continue;

      const next = updatedSlotsById.get(expected.id);
      if (!next || Number(next.saldo || 0) !== 0 || String(next.referencia || "").trim() || String(next.descricao || "").trim()) continue;

      let identityReference = String(expected.referencia || "").trim().toUpperCase();
      let identityRestriction = normalizeHistoricalRestriction(expected.restricao);
      if (isAuxiliary) {
        const identity = getAuxiliarySlotIdentity(expected.id);
        if (!identity || identity.referencia !== identityReference || identity.restricao !== identityRestriction) continue;
      } else {
        const canonicalE1Id = `1-${normalizeHistoricalModule(expected.modulo)}-${identityReference}`;
        if (expected.id !== canonicalE1Id || String(expected.posicao || "") !== "") continue;
      }

      const sameLogicalHistory = newMovements.filter(movement =>
        scopeKey(movement) === scopeKey(expected) &&
        String(movement.referencia || "").trim().toUpperCase() === identityReference &&
        normalizeHistoricalRestriction(movement.restricao) === identityRestriction
      );
      if (sameLogicalHistory.length === 0 || sameLogicalHistory.some(movement => movement.slotId !== expected.id)) continue;
      const exits = sameLogicalHistory
        .filter(movement => movement.tipo === "Saída")
        .reduce((sum, movement) => sum + Number(movement.quantidade || 0), 0);
      const entries = sameLogicalHistory
        .filter(movement => movement.tipo === "Entrada")
        .reduce((sum, movement) => sum + Number(movement.quantidade || 0), 0);
      if (exits > 0 && Number(expected.saldo || 0) + entries - exits === 0) {
        deleteSlotIds.push(expected.id);
      }
    }

    const deleteIds = new Set(deleteSlotIds);
    const finalSlotsPayload = finalSlotsInScopes.filter(slot => !deleteIds.has(slot.id));

    // Generic stock mutations cannot delete divergences or silently change their
    // status. Merge updated rows into the full snapshot for every impacted scope.
    const finalDivergenciasById = new Map(
      expectedDivergenciasInScopes.map(div => [div.id, div])
    );
    for (const div of updatedDivergencias) {
      if (scopeKeys.has(scopeKey(div))) finalDivergenciasById.set(div.id, div);
    }
    const finalDivergenciasInScopes = Array.from(finalDivergenciasById.values());

    const allKnownSlotIds = new Set<string>([
      ...expectedSlotsInScopes.map(slot => slot.id),
      ...finalSlotsInScopes.map(slot => slot.id),
    ]);
    for (const movement of newMovements) {
      if (movement.slotId && !historicalSlotIdMatchesMovement(movement, movement.slotId)) {
        return failed(`O histórico ${movement.id} referencia o ID '${movement.slotId}', mas ele não corresponde ao SKU/restrição da movimentação. Nenhum dado foi gravado.`);
      }
    }
    const validatedMovements = validateHistorySlotLinks(newMovements, allKnownSlotIds);

    const rpcName = sharedDraftCommit
      ? "process_shared_lancamento_draft_batch_atomic"
      : deleteSlotIds.length > 0
        ? "apply_stock_mutation_atomic_with_deletes"
        : "apply_stock_mutation_atomic";
    const stockRpcArgs = deleteSlotIds.length > 0
      ? {
          p_expected_slots: expectedSlotsInScopes,
          p_slots: finalSlotsPayload,
          p_expected_divergencias: mapDivergenciasForSupabase(expectedDivergenciasInScopes),
          p_divergencias: mapDivergenciasForSupabase(finalDivergenciasInScopes),
          p_history: mapHistoryRowsForSupabase(validatedMovements),
          p_delete_slot_ids: deleteSlotIds,
          p_operation_type: operationType,
        }
      : {
          p_expected_slots: expectedSlotsInScopes,
          p_slots: finalSlotsPayload,
          p_expected_divergencias: mapDivergenciasForSupabase(expectedDivergenciasInScopes),
          p_divergencias: mapDivergenciasForSupabase(finalDivergenciasInScopes),
          p_history: mapHistoryRowsForSupabase(validatedMovements),
          p_operation_type: operationType,
        };
    const rpcArgs = sharedDraftCommit
      ? {
          p_batch_id: sharedDraftCommit.batchId,
          p_generation_id: sharedDraftCommit.generationId,
          p_expected_revision: sharedDraftCommit.expectedRevision,
          p_input_rows: sharedDraftCommit.inputRows,
          p_result_summary: sharedDraftCommit.resultSummary,
          p_expected_slots: expectedSlotsInScopes,
          p_slots: finalSlotsPayload,
          p_expected_divergencias: mapDivergenciasForSupabase(expectedDivergenciasInScopes),
          p_divergencias: mapDivergenciasForSupabase(finalDivergenciasInScopes),
          p_history: mapHistoryRowsForSupabase(validatedMovements),
          p_delete_slot_ids: deleteSlotIds,
        }
      : stockRpcArgs;

    // Never automatically repeat a stock mutation. If the response is lost,
    // the batch id is queried once; it is safe to resume only with that same id.
    const response = await supabase.rpc(rpcName as never, rpcArgs as never);
    let data = response.data as SharedDraftRpcResult | null;
    let error = response.error;
    if (sharedDraftCommit && error) {
      const probe = await supabase.rpc("get_shared_lancamento_batch_result" as never, {
        p_batch_id: sharedDraftCommit.batchId,
      } as never);
      const probeData = probe.data as SharedDraftRpcResult | null;
      if (!probe.error && probeData?.success === true) {
        data = probeData;
        error = null;
      }
    }

    if (error || data?.success !== true) {
      const code = String(data?.code ?? error?.code ?? "SEM_CONFIRMACAO");
      const reason = String(data?.message ?? data?.code ?? error?.message ?? "A transação não foi confirmada pelo Supabase.");
      console.error("Transação de estoque revertida/sem confirmação:", {
        rpc: rpcName,
        code,
        message: reason,
      });
      return failed(
        `O Supabase não confirmou a transação atômica (${code}). ${reason} ` +
        (sharedDraftCommit && error
          ? "O resultado ainda é incerto. O identificador do lote foi preservado para consulta; não inicie outro lote."
          : "Não repita automaticamente: atualize os dados antes de tentar novamente."),
        code,
        Boolean(sharedDraftCommit && error),
      );
    }

    // The RPC committed the full transaction. Replace only its locked scopes;
    // physical base-address rows remain, while exhausted logical SKU rows that
    // the delete RPC removed are omitted from the refreshed client snapshot.
    const nextSlots = updateSlotsState(current => [
      ...current.filter(slot => !scopeKeys.has(scopeKey(slot))),
      ...finalSlotsPayload,
    ]);
    await saveOfflineSnapshot("slots", nextSlots, offlineCacheScope, offlineCacheAuthorizationFingerprint);

    const nextDivergencias = updateDivergenciasState(current => [
      ...current.filter(div => !scopeKeys.has(scopeKey(div))),
      ...finalDivergenciasInScopes,
    ]);
    await saveOfflineSnapshot("divergencias", nextDivergencias, offlineCacheScope, offlineCacheAuthorizationFingerprint);

    const movementIds = new Set(newMovements.map(movement => movement.id));
    const nextHistory = [
      ...newMovements,
      ...history.filter(movement => !movementIds.has(movement.id)),
    ];
    setHistory(nextHistory);
    await saveOfflineSnapshot("history", nextHistory, offlineCacheScope, offlineCacheAuthorizationFingerprint);
    setHistoryQueryRows(previous => {
      if (!previous) return previous;
      const inSelectedPeriod = newMovements.filter(
        movement => movement.data >= histDateStart && movement.data <= histDateEnd
      );
      const selectedIds = new Set(inSelectedPeriod.map(movement => movement.id));
      return [...inSelectedPeriod, ...previous.filter(movement => !selectedIds.has(movement.id))];
    });

    return { ok: true, deletedSlotIds: deleteSlotIds, batchResult: sharedDraftCommit ? data : undefined };
  };

  /**
   * Salva uma correção física, o histórico e o status das divergências em uma
   * única transação PostgreSQL. O banco também compara os registros com a versão
   * que o operador leu; alterações concorrentes fazem a transação inteira falhar.
   */
  const persistDivergenceResolutionAtomically = async (
    updatedSlots: WarehouseSlot[],
    newMovements: HistoricoMov[],
    updatedDivergencias: Divergencia[]
  ): Promise<boolean> => {
    if (!navigator.onLine) {
      console.warn("Correção de divergência cancelada: conexão indisponível.");
      return false;
    }

    const previousSlotsById = new globalThis.Map(slotsRef.current.map(slot => [slot.id, slot]));
    const changedSlots = updatedSlots.filter(slot => {
      const previous = previousSlotsById.get(slot.id);
      return !previous || JSON.stringify(previous) !== JSON.stringify(slot);
    });
    const expectedSlots = changedSlots
      .map(slot => previousSlotsById.get(slot.id))
      .filter((slot): slot is WarehouseSlot => Boolean(slot));

    const previousDivergenciasById = new globalThis.Map(
      divergenciasRef.current.map(div => [div.id, div])
    );
    const changedDivergencias = updatedDivergencias.filter(div => {
      const previous = previousDivergenciasById.get(div.id);
      return !previous || JSON.stringify(previous) !== JSON.stringify(div);
    });
    const expectedDivergencias = changedDivergencias
      .map(div => previousDivergenciasById.get(div.id))
      .filter((div): div is Divergencia => Boolean(div));

    if (
      changedDivergencias.length === 0 ||
      expectedDivergencias.length !== changedDivergencias.length ||
      expectedDivergencias.some(div => div.status !== "Aberta") ||
      changedDivergencias.some(div => div.status !== "Corrigida") ||
      newMovements.length === 0
    ) {
      console.error(
        "Correção atômica abortada: estado anterior ou transição da divergência inválida."
      );
      return false;
    }

    const knownSlotIds = new Set<string>(updatedSlots.map(slot => String(slot.id).trim()));
    const validatedMovements = validateHistorySlotLinks(newMovements, knownSlotIds);

    const { data, error } = await supabase.rpc("resolve_stock_divergence_atomic", {
      p_expected_slots: expectedSlots,
      p_slots: changedSlots,
      p_history: mapHistoryRowsForSupabase(validatedMovements),
      p_expected_divergencias: mapDivergenciasForSupabase(expectedDivergencias),
      p_divergencias: mapDivergenciasForSupabase(changedDivergencias),
    });

    if (error || data?.success !== true) {
      console.error("Transação da correção de divergência foi revertida:", {
        code: error?.code,
        message: error?.message ?? "Resposta inválida da função transacional.",
        details: error?.details,
        hint: error?.hint,
      });
      return false;
    }

    // Atualiza a interface/cache apenas após a confirmação da transação no banco.
    const nextSlots = mergeSlotsState(changedSlots);
    await saveOfflineSnapshot("slots", nextSlots, offlineCacheScope, offlineCacheAuthorizationFingerprint);

    const movementIds = new Set(newMovements.map(movement => movement.id));
    const nextHistory = [
      ...newMovements,
      ...history.filter(movement => !movementIds.has(movement.id)),
    ];
    setHistory(nextHistory);
    await saveOfflineSnapshot("history", nextHistory, offlineCacheScope, offlineCacheAuthorizationFingerprint);

    setHistoryQueryRows(previous => {
      if (!previous) return previous;
      const inSelectedPeriod = newMovements.filter(
        movement => movement.data >= histDateStart && movement.data <= histDateEnd
      );
      const selectedIds = new Set(inSelectedPeriod.map(movement => movement.id));
      return [
        ...inSelectedPeriod,
        ...previous.filter(movement => !selectedIds.has(movement.id)),
      ];
    });

    const mergedDivergencias = updateDivergenciasState(current => {
      const byId = new globalThis.Map(current.map(div => [div.id, div]));
      changedDivergencias.forEach(div => byId.set(div.id, div));
      return Array.from(byId.values());
    });
    await saveOfflineSnapshot("divergencias", mergedDivergencias, offlineCacheScope, offlineCacheAuthorizationFingerprint);

    return true;
  };

  const handleMobileResolveDivergencia = async (
    div: Divergencia,
    action: "sobrescrever" | "zerar",
    observacaoValue: string
  ): Promise<boolean> => {
    if (!currentUser) {
      alert("Não foi possível identificar a sessão atual. Atualize o aplicativo e tente novamente.");
      return false;
    }
    // Durante a migração, preserva o bloqueio legado quando a autorização dinâmica
    // ainda não está habilitada. Com o painel ativo, os dois grants são consultados.
    if (!permissionEnforcementEnabled && !canExecuteOperations(currentUser.role)) {
      alert("Seu perfil não possui permissão para corrigir divergências.");
      return false;
    }
    if (slotsRealtimeStatusRef.current !== "ready" || divergenciasRealtimeStatusRef.current !== "ready") {
      alert("O estoque ou as divergências ainda não estão sincronizados. Atualize os dados antes de corrigir fisicamente o endereço.");
      return false;
    }
    if (!(await requestAppMutationPermission("divergences.view", "consultar divergências para resolver"))) {
      return false;
    }
    if (!(await requestAppMutationPermission("stock.physical_correction", "zerar endereço fisicamente"))) {
      return false;
    }
    if (!(await requestAppMutationPermission("divergences.resolve", "resolver as divergências do endereço"))) {
      return false;
    }
    if (action !== "zerar") {
      alert("A opção anterior de correção foi removida. Atualize a tela e utilize apenas Zerar endereço.");
      return false;
    }
    if (!navigator.onLine) {
      alert("O zeramento exige conexão com o Supabase. Nenhum dado foi alterado.");
      return false;
    }

    const liveDivergencias = divergenciasRef.current;
    const currentDiv = liveDivergencias.find(item => item.id === div.id);
    if (!currentDiv || currentDiv.status !== "Aberta") {
      alert("Esta divergência não está mais aberta. Atualize a tela antes de tentar novamente.");
      return false;
    }

    const confirmed = window.confirm(
      `CONFIRME O ZERAMENTO FÍSICO

` +
      `Posição: ${currentDiv.estoque}-${currentDiv.modulo}-${currentDiv.posicao}

` +
      "Esta ação considera a posição fisicamente vazia. Ela registrará as saídas dos saldos cadastrados, " +
      "manterá a linha-base com saldo zero, excluirá as linhas auxiliares e encerrará todas as divergências " +
      "ainda abertas desta posição. O histórico existente e as divergências já corrigidas serão preservados.\n\n" +
      "Confirma que a posição foi conferida fisicamente e está vazia?"
    );
    if (!confirmed) return false;

    const normalizeStock = (value: string): string =>
      String(value ?? "").trim().toUpperCase().replace(/^E/i, "");
    const normalizeModule = (value: string): string => {
      const raw = String(value ?? "").trim().toUpperCase().replace(/^[RM]/i, "");
      return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
    };
    const normalizePosition = (value: string): string => String(value ?? "").trim().toUpperCase();
    const normalizedEstoque = normalizeStock(currentDiv.estoque);
    const normalizedModulo = normalizeModule(currentDiv.modulo);
    const normalizedPosicao = normalizePosition(currentDiv.posicao);
    if (normalizedEstoque !== "2" && normalizedEstoque !== "3") {
      alert("O comando Zerar endereço desta correção é exclusivo para posições físicas E2/E3. O endereço E1 não foi alterado.");
      return false;
    }
    const addressId = `${normalizedEstoque}-${normalizedModulo}-${normalizedPosicao}`;
    const sameAddress = (row: { estoque: string; modulo: string; posicao: string }): boolean =>
      normalizeStock(row.estoque) === normalizedEstoque &&
      normalizeModule(row.modulo) === normalizedModulo &&
      normalizePosition(row.posicao) === normalizedPosicao;

    const slotsInAddress = slotsRef.current.filter(sameAddress);
    const openDivergences = liveDivergencias.filter(item =>
      item.status === "Aberta" && sameAddress(item)
    );
    if (!openDivergences.some(item => item.id === currentDiv.id)) {
      alert("A divergência selecionada não faz mais parte do conjunto aberto desta posição. Atualize a tela.");
      return false;
    }

    const targetDate = getTodayIsoDate();
    const currentHour = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const correctedBy = currentUser.name || operator;
    const correctionId = globalThis.crypto?.randomUUID?.();
    if (!correctionId) {
      alert("Este navegador não disponibilizou um identificador seguro para a correção. Nenhum dado foi alterado.");
      return false;
    }

    let plan;
    try {
      plan = buildZeroPhysicalAddressPlan({
        address: {
          estoque: normalizedEstoque,
          modulo: normalizedModulo,
          posicao: normalizedPosicao,
        },
        // O PostgreSQL confere a fotografia completa e a quantidade exata de linhas
        // dentro da transação. Se os dados vierem de cache ou estiverem desatualizados,
        // a RPC aborta sem gravar nada.
        slotsSnapshotComplete: true,
        divergencesSnapshotComplete: true,
        slots: slotsInAddress,
        openDivergences,
        correctionId,
        operator: correctedBy,
        date: targetDate,
        time: currentHour,
        observation: observacaoValue.trim(),
      });
    } catch (error) {
      const reason = error instanceof ZeroPhysicalAddressPlanError
        ? error.message
        : "A fotografia local da posição não passou pelas validações de segurança.";
      alert(`${reason} Nenhum dado foi alterado.`);
      return false;
    }

    const expectedDivergencesPayload = mapDivergenciasForSupabase(
      plan.expectedOpenDivergences as unknown as Divergencia[]
    );
    const finalDivergencesPayload = mapDivergenciasForSupabase(
      plan.correctedDivergences as unknown as Divergencia[]
    );
    const historyPayload = plan.history.map(({ slotId, ...movement }) => ({
      ...movement,
      slot_id: slotId,
    }));

    // RPC específica porque a rotina genérica recusa duplicidades preexistentes.
    // Não há retry automático: em caso de resposta perdida, o operador deve atualizar
    // a tela e conferir o estado antes de qualquer nova tentativa.
    const { data, error } = await supabase.rpc("zero_physical_divergence_address_atomic", {
      p_physical_zero_confirmed: true,
      p_correction_id: plan.correctionId,
      p_address: { estoque: normalizedEstoque, modulo: normalizedModulo, posicao: normalizedPosicao },
      p_expected_slots: plan.expectedSlots,
      p_slots: plan.finalSlots,
      p_expected_divergencias: expectedDivergencesPayload,
      p_divergencias: finalDivergencesPayload,
      p_history: historyPayload,
      p_delete_slot_ids: plan.deleteSlotIds,
    });

    if (error || data?.success !== true) {
      console.error("Zeramento transacional não confirmado:", {
        rpc: "zero_physical_divergence_address_atomic",
        code: data?.code ?? error?.code,
        message: data?.message ?? error?.message ?? "Resposta inválida do Supabase.",
      });
      alert(
        `O zeramento não foi confirmado pelo Supabase (${data?.code || error?.code || "SEM_CONFIRMACAO"}). ` +
        `${data?.message || error?.message || "Nenhum dado foi alterado."} ` +
        "Atualize os dados e confira a posição antes de tentar novamente."
      );
      return false;
    }

    const effectiveDate = typeof data.effective_date === "string" ? data.effective_date : targetDate;
    const effectiveTime = typeof data.effective_time === "string" ? data.effective_time : currentHour;
    const actorName = typeof data.actor_name === "string" ? data.actor_name : correctedBy;
    const persistedFinalSlots = plan.finalSlots.map(slot => ({
      ...slot,
      ultimaData: effectiveDate,
      ultimaHora: effectiveTime,
      ultimoResponsavel: actorName,
    })) as WarehouseSlot[];
    const persistedDivergencias = plan.correctedDivergences.map(item => ({
      ...item,
      dataCorrecao: effectiveDate,
      corrigidoPor: actorName,
    }));
    const persistedHistory = plan.history.map(movement => ({
      ...movement,
      dataLancamento: effectiveDate,
      quemLancou: actorName,
      data: effectiveDate,
      hora: effectiveTime,
      responsavel: actorName,
    })) as HistoricoMov[];

    const addressParts = plan.addressId.split("-");
    const deletedIds = new Set(plan.deleteSlotIds);
    const isSameAddress = (slot: WarehouseSlot): boolean =>
      normalizeStock(slot.estoque) === addressParts[0] &&
      normalizeModule(slot.modulo) === addressParts[1] &&
      normalizePosition(slot.posicao) === addressParts.slice(2).join("-");
    const nextSlots = updateSlotsState(current => [
      ...current.filter(slot => !isSameAddress(slot) && !deletedIds.has(slot.id)),
      ...persistedFinalSlots,
    ]);
    await saveOfflineSnapshot("slots", nextSlots, offlineCacheScope, offlineCacheAuthorizationFingerprint);

    const updatedDivergenceIds = new Set(persistedDivergencias.map(item => item.id));
    const mergedDivergencias = updateDivergenciasState(current => {
      const byId = new globalThis.Map(current.map(item => [item.id, item]));
      persistedDivergencias.forEach(item => {
        if (updatedDivergenceIds.has(item.id)) byId.set(item.id, item as unknown as Divergencia);
      });
      return Array.from(byId.values());
    });
    await saveOfflineSnapshot("divergencias", mergedDivergencias, offlineCacheScope, offlineCacheAuthorizationFingerprint);

    if (persistedHistory.length > 0) {
      const newMovements = persistedHistory;
      const movementIds = new Set(newMovements.map(movement => movement.id));
      const nextHistory = [
        ...newMovements,
        ...history.filter(movement => !movementIds.has(movement.id)),
      ];
      setHistory(nextHistory);
      await saveOfflineSnapshot("history", nextHistory, offlineCacheScope, offlineCacheAuthorizationFingerprint);
      setHistoryQueryRows(previous => {
        if (!previous) return previous;
        const inSelectedPeriod = newMovements.filter(
          movement => movement.data >= histDateStart && movement.data <= histDateEnd
        );
        const selectedIds = new Set(inSelectedPeriod.map(movement => movement.id));
        return [
          ...inSelectedPeriod,
          ...previous.filter(movement => !selectedIds.has(movement.id)),
        ];
      });
    }

    alert(`Posição ${addressId} zerada com sucesso. Faça agora a entrada correta do item.`);
    return true;
  };

  const occupiedPalletsE1 = useMemo(() => {
    const productsByReference = new globalThis.Map<string, Product>(
      productsList.map(product => [product.referencia, product])
    );

    const activeCapacityMap = getE1CapacityMap(warehouseLayout);

    return slots
      .filter(
        s =>
          s.estoque === "1" &&
          activeCapacityMap[String(Number(s.modulo))] !== undefined &&
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
  }, [slots, productsList, warehouseLayout]);
  
  const activePhysicalPositionKeys = useMemo(() => {
    const result = {
      "2": new Set<string>(),
      "3": new Set<string>(),
    };

    warehousePositions.forEach(position => {
      if (!position.ativo || (position.estoque !== "2" && position.estoque !== "3")) return;
      result[position.estoque].add(
        `${position.estoque}-${Number(position.modulo)}-${position.posicao.trim().toUpperCase()}`
      );
    });

    return result;
  }, [warehousePositions]);

  // --- SYSTEM LOG OPERATOR RESPONSIBLES ---
  const operator = currentUser?.name || "Administrador Geral";
  const launchDate = getTodayIsoDate();

  // --- FILTERED VIEWS ---
  // Product Search Coordinates (Pesquisa Produtos) Filters
  const [searchRef, setSearchRef] = useState("");
  const [searchDesc, setSearchDesc] = useState("");
  const [filterEstoque, setFilterEstoque] = useState("");
  const [filterGalpao, setFilterGalpao] = useState("");
  const [filterRestricao, setFilterRestricao] = useState("");
  const [searchObservacao, setSearchObservacao] = useState("");
  const [searchModulo, setSearchModulo] = useState("");
  const [searchPosicao, setSearchPosicao] = useState("");
  const [searchPage, setSearchPage] = useState(1);

  type SearchSortField =
    | "estoque"
    | "modulo"
    | "posicao"
    | "referencia"
    | "restricao"
    | "descricao"
    | "saldo"
    | "dataChacote"
    | "ultimaMov"
    | "responsavel"
    | "observacao";

  type SearchSortRule = {
    field: SearchSortField;
    direction: "asc" | "desc";
  };

  const [searchSorts, setSearchSorts] = useState<SearchSortRule[]>([]);

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
  const [historySortField, setHistorySortField] = useState<
    "dataLancamento" | "estoque" | "modulo" | "posicao" | "referencia" | "quantidade" | "tipo" | "hora"
  >("dataLancamento");
  const [historySortDirection, setHistorySortDirection] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    sessionDataGenerationRef.current += 1;
    productsLoadPromiseRef.current = null;
    usersLoadPromiseRef.current = null;
    setUsersLoadError(null);
    setUsersLoading(false);
    updateSlotsState(() => []);
    setProductsList([]);
    setHistory([]);
    setHistoryQueryRows(null);
    divergenciasRef.current = [];
    setDivergencias([]);
    setWarehouseLayout(getDefaultE1Layout());
    setWarehousePositions([]);
    setUsers([]);
  }, [authUserId]);

  // IMPORTANT: this effect intentionally follows the authUserId reset effect above.
  // The reset increments sessionDataGenerationRef; loading before it would make the
  // newly started request stale and discard its result on every fresh login.
  useEffect(() => {
    if (!authUserId || !currentUser || !isAdmin(currentUser.role)) {
      setUsers([]);
      setUsersLoading(false);
      setUsersLoadError(null);
      return;
    }

    void loadUsersFromSupabase();
  }, [authUserId, currentUser]);

  const handleHistoryPeriodSearch = async () => {
    if (!histDateStart || !histDateEnd) {
      alert("Informe a data inicial e a data final.");
      return;
    }

    if (histDateStart > histDateEnd) {
      alert("A data inicial não pode ser maior que a data final.");
      return;
    }

    if (permissionEnforcementEnabled && !canUseAppPermissionForUi("history.view")) {
      setHistoryQueryRows(null);
      alert("Seu perfil não possui permissão para consultar o histórico.");
      return;
    }

    setHistoryQueryLoading(true);
    try {
      const data = await loadHistoryFromSupabase({
        startDate: histDateStart,
        endDate: histDateEnd
      }, offlineCacheScope, offlineCacheAuthorizationFingerprint);
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

  // --- LANÇAMENTO EM LOTE: RASCUNHO COMPARTILHADO NO SUPABASE ---
  const batchLaunchInFlightRef = useRef(false);
  const batchLaunchRequestedRef = useRef(false);
  const [batchLaunchLoading, setBatchLaunchLoading] = useState(false);
  const [batchPendingRecovery, setBatchPendingRecovery] = useState(false);
  const [lancamentoRows, setLancamentoRowsState] = useState<LancamentoRow[]>([]);
  const lancamentoRowsRef = useRef<LancamentoRow[]>([]);
  const setLancamentoRows = (action: Parameters<typeof setLancamentoRowsState>[0]) => {
    const nextRows = typeof action === "function"
      ? action(lancamentoRowsRef.current)
      : action;
    lancamentoRowsRef.current = nextRows;
    setLancamentoRowsState(nextRows);
  };

  const [lancamentoDraftReady, setLancamentoDraftReady] = useState(false);
  const [sharedDraftSyncStatus, setSharedDraftSyncStatus] = useState<
    "loading" | "synced" | "saving" | "conflict" | "error"
  >("loading");
  const [sharedDraftSyncMessage, setSharedDraftSyncMessage] = useState("");
  const [legacyDraftQuarantineCount, setLegacyDraftQuarantineCount] = useState(0);
  useEffect(() => {
    setBatchPendingRecovery(hasUnresolvedBatchMarker());
  }, []);
  const sharedDraftMetaRef = useRef<SharedDraftMeta>({ generationId: null, revision: 0 });
  const baselineDraftLinesRef = useRef<SharedLancamentoDraftLine[]>([]);
  const draftSyncBlockedRef = useRef<string | null>(null);
  const activeAuthUserIdRef = useRef<string | null>(authUserId);
  activeAuthUserIdRef.current = authUserId;
  const draftAutosaveTimerRef = useRef<number | null>(null);

  const applySharedDraftSnapshot = (snapshot: SharedLancamentoDraftSnapshot) => {
    baselineDraftLinesRef.current = snapshot.lines;
    sharedDraftMetaRef.current = {
      generationId: snapshot.generation_id,
      revision: snapshot.revision,
    };
    draftSyncBlockedRef.current = null;
    setLancamentoRows(snapshot.lines.map(line => line.row_data));
    setLancamentoDraftReady(true);
    setSharedDraftSyncStatus("synced");
    setSharedDraftSyncMessage(`${snapshot.lines.length} linha(s) no rascunho compartilhado.`);
  };

  const markDraftSyncBlocked = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    draftSyncBlockedRef.current = message;
    setSharedDraftSyncStatus(isSharedDraftConflict(error) ? "conflict" : "error");
    setSharedDraftSyncMessage(
      isSharedDraftConflict(error)
        ? "Conflito de edição detectado. Sincronize antes de continuar."
        : "Falha de sincronização. Os dados locais foram preservados; sincronize antes de continuar."
    );
  };

  const syncSharedDraftChanges = async (): Promise<boolean> => {
    if (!activeAuthUserIdRef.current || !lancamentoDraftReady) return false;
    if (batchLaunchInFlightRef.current) return false;
    if (draftSyncBlockedRef.current) return false;

    const generationId = sharedDraftMetaRef.current.generationId;
    if (!generationId) {
      markDraftSyncBlocked(new Error("O rascunho compartilhado ainda não tem uma geração confirmada."));
      return false;
    }

    let plan;
    try {
      plan = buildSharedDraftSyncPlan(
        lancamentoRowsRef.current,
        baselineDraftLinesRef.current,
      );
    } catch (error) {
      markDraftSyncBlocked(error);
      return false;
    }

    if (plan.upserts.length === 0 && plan.deletes.length === 0) return true;
    setSharedDraftSyncStatus("saving");
    setSharedDraftSyncMessage("Salvando alterações no rascunho compartilhado…");

    try {
      if (plan.upserts.length > 0) {
        const result = await invokeSharedDraftRpc("upsert_shared_lancamento_draft_lines", {
          p_generation_id: generationId,
          p_lines: plan.upserts,
        });
        const savedGenerationId = String(result.generation_id ?? generationId);
        if (savedGenerationId !== generationId) {
          // A new line was saved just after another computer completed the
          // previous batch. The RPC moved only brand-new rows into the next
          // generation; refresh the whole snapshot so processed rows do not
          // reappear locally and don't apply deletes based on the old generation.
          const latestSnapshot = await loadSharedLancamentoDraftFromSupabase();
          applySharedDraftSnapshot(latestSnapshot);
          return true;
        }
        const returnedLines = Array.isArray(result.line_revisions)
          ? result.line_revisions as Array<Record<string, unknown>>
          : [];
        const returnedById = new Map<string, SharedLancamentoDraftLine>();
        for (const item of returnedLines) {
          const lineId = String(item.line_id ?? "");
          const lineRevision = Number(item.line_revision);
          const sequence = Number(item.sequence);
          if (!lineId || !Number.isSafeInteger(lineRevision) || lineRevision < 1 ||
              !Number.isSafeInteger(sequence) || sequence < 1) {
            throw new Error("A confirmação do Supabase não trouxe a versão de todas as linhas salvas.");
          }
          returnedById.set(lineId, {
            line_id: lineId,
            row_data: normalizeLancamentoDraftRow(item.row_data),
            line_revision: lineRevision,
            sequence,
          });
        }
        if (plan.upserts.some(item => !returnedById.has(item.line_id))) {
          throw new Error("A confirmação do Supabase ficou incompleta; o rascunho precisa ser sincronizado novamente.");
        }

        const baselineById = new Map<string, SharedLancamentoDraftLine>(baselineDraftLinesRef.current.map(line => [line.line_id, line]));
        returnedById.forEach((line, lineId) => baselineById.set(lineId, line));
        baselineDraftLinesRef.current = Array.from(baselineById.values()).sort((a, b) => a.sequence - b.sequence);
        sharedDraftMetaRef.current.revision = Number(result.revision);
      }

      for (const item of plan.deletes) {
        let result: SharedDraftRpcResult;
        try {
          result = await invokeSharedDraftRpc("delete_shared_lancamento_draft_line", {
            p_generation_id: generationId,
            p_line_id: item.line_id,
            p_expected_line_revision: item.expected_line_revision,
          });
        } catch (error) {
          if (/DRAFT_GENERATION_CONFLICT/i.test(String((error as { code?: string; message?: string } | null)?.code ?? (error as Error)?.message ?? ""))) {
            // The old generation was already processed/cleared elsewhere. Its
            // rows are no longer pending, so synchronize instead of trying to
            // delete historical lines or accidentally restoring old data.
            const latestSnapshot = await loadSharedLancamentoDraftFromSupabase();
            applySharedDraftSnapshot(latestSnapshot);
            return true;
          }
          throw error;
        }
        baselineDraftLinesRef.current = baselineDraftLinesRef.current.filter(line => line.line_id !== item.line_id);
        sharedDraftMetaRef.current.revision = Number(result.revision);
      }

      setSharedDraftSyncStatus("synced");
      setSharedDraftSyncMessage("Alterações desta tela confirmadas. Use Sincronizar para buscar novas linhas de outros computadores.");
      return true;
    } catch (error) {
      const errorCode = String((error as { code?: string; message?: string } | null)?.code ?? (error as Error)?.message ?? "");
      const staleLineConflict = /DRAFT_(?:GENERATION|LINE)_CONFLICT|DRAFT_LINE_MISSING/i.test(errorCode);
      const hasOldLineChanges = plan.upserts.some(item => item.expected_line_revision !== null) || plan.deletes.length > 0;
      if (staleLineConflict && hasOldLineChanges) {
        // A batch/clear or another operator changed a line before this write.
        // Never resurrect or silently discard that old-line edit. Preserve the
        // local screen for recovery, save only genuinely new lines into the
        // current generation, and require a deliberate second click to process.
        if (!preserveLocalDraftForRecovery()) {
          markDraftSyncBlocked(new Error("Houve um conflito de edição e não foi possível preservar a cópia local. Nenhum novo dado foi aplicado."));
          return false;
        }
        try {
          const latest = await loadSharedLancamentoDraftFromSupabase();
          const newlyAddedLines = plan.upserts.filter(item => item.expected_line_revision === null);
          if (newlyAddedLines.length > 0) {
            await invokeSharedDraftRpc("upsert_shared_lancamento_draft_lines", {
              p_generation_id: latest.generation_id,
              p_lines: newlyAddedLines,
            });
          }
          const refreshed = await loadSharedLancamentoDraftFromSupabase();
          applySharedDraftSnapshot(refreshed);
          setSharedDraftSyncStatus("conflict");
          setSharedDraftSyncMessage(
            newlyAddedLines.length > 0
              ? "Outro computador alterou ou encerrou linhas durante a edição. As novas linhas foram salvas no rascunho compartilhado; alterações/exclusões das linhas antigas estão preservadas numa cópia de recuperação neste computador. Confira antes de lançar novamente."
              : "Outro computador alterou ou encerrou linhas durante a edição. As alterações locais estão preservadas numa cópia de recuperação; o rascunho compartilhado foi atualizado sem restaurar linhas antigas. Confira antes de continuar."
          );
        } catch (recoveryError) {
          markDraftSyncBlocked(recoveryError);
        }
        return false;
      }
      markDraftSyncBlocked(error);
      console.error("Falha ao sincronizar linhas do rascunho compartilhado:", error);
      return false;
    }
  };

  const flushSharedDraftChanges = async (): Promise<boolean> => {
    if (draftAutosaveTimerRef.current !== null) {
      window.clearTimeout(draftAutosaveTimerRef.current);
      draftAutosaveTimerRef.current = null;
    }
    if (draftSyncBlockedRef.current) return false;
    return enqueueLancamentoDraftWrite(() => syncSharedDraftChanges());
  };

  // The former global localStorage cache is quarantined, never imported into the shared draft.
  // This preserves an old local-only copy for manual recovery without allowing resurrection.
  useEffect(() => {
    try {
      const legacy = localStorage.getItem(LANCAMENTO_DRAFT_LOCAL_KEY);
      if (!legacy) return;
      let rowsCount = 0;
      try {
        const parsed = JSON.parse(legacy);
        rowsCount = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        rowsCount = 1;
      }
      if (rowsCount > 0) {
        const quarantineKey = localStorage.getItem(LANCAMENTO_DRAFT_LEGACY_QUARANTINE_KEY)
          ? `${LANCAMENTO_DRAFT_LEGACY_QUARANTINE_KEY}:${Date.now()}`
          : LANCAMENTO_DRAFT_LEGACY_QUARANTINE_KEY;
        localStorage.setItem(quarantineKey, legacy);
        setLegacyDraftQuarantineCount(rowsCount);
      }
      localStorage.removeItem(LANCAMENTO_DRAFT_LOCAL_KEY);
    } catch (error) {
      console.warn("Não foi possível colocar o cache legado de rascunho em quarentena local:", error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!authUserId) {
      setLancamentoDraftReady(false);
      setSharedDraftSyncStatus("loading");
      setSharedDraftSyncMessage("Entre no sistema para carregar o rascunho compartilhado.");
      baselineDraftLinesRef.current = [];
      sharedDraftMetaRef.current = { generationId: null, revision: 0 };
      draftSyncBlockedRef.current = null;
      setLancamentoRows([]);
      return () => { cancelled = true; };
    }

    setLancamentoDraftReady(false);
    setSharedDraftSyncStatus("loading");
    setSharedDraftSyncMessage("Carregando rascunho compartilhado do Supabase…");
    setLancamentoRows([]);
    baselineDraftLinesRef.current = [];
    sharedDraftMetaRef.current = { generationId: null, revision: 0 };
    draftSyncBlockedRef.current = null;

    void loadSharedLancamentoDraftFromSupabase().then(snapshot => {
      if (cancelled) return;
      applySharedDraftSnapshot(snapshot);
    }).catch(error => {
      if (cancelled) return;
      setLancamentoDraftReady(false);
      setSharedDraftSyncStatus("error");
      setSharedDraftSyncMessage("Não foi possível carregar o rascunho do banco. Não foi usado cache local antigo.");
      console.error("Falha ao hidratar rascunho compartilhado:", error);
    });

    return () => { cancelled = true; };
  }, [authUserId]);

  useEffect(() => {
    if (!authUserId || !lancamentoDraftReady || batchLaunchLoading || batchLaunchInFlightRef.current ||
        hasUnresolvedBatchMarker() || draftSyncBlockedRef.current || !sharedDraftMetaRef.current.generationId) {
      return;
    }
    if (draftAutosaveTimerRef.current !== null) window.clearTimeout(draftAutosaveTimerRef.current);
    draftAutosaveTimerRef.current = window.setTimeout(() => {
      draftAutosaveTimerRef.current = null;
      void enqueueLancamentoDraftWrite(() => syncSharedDraftChanges());
    }, 450);

    return () => {
      if (draftAutosaveTimerRef.current !== null) {
        window.clearTimeout(draftAutosaveTimerRef.current);
        draftAutosaveTimerRef.current = null;
      }
    };
  }, [authUserId, lancamentoDraftReady, lancamentoRows, batchLaunchLoading, batchPendingRecovery]);

  const preserveLocalDraftForRecovery = (): boolean => {
    try {
      const key = `eb_lancamento_draft_conflict_quarantine_v1:${Date.now()}`;
      localStorage.setItem(key, JSON.stringify(lancamentoRowsRef.current));
      return true;
    } catch (error) {
      console.error("Não foi possível preservar o rascunho local em quarentena:", error);
      return false;
    }
  };

  const preserveBeforeReplacingLocalDraft = async (): Promise<boolean> => {
    if (!draftSyncBlockedRef.current) {
      const flushed = await flushSharedDraftChanges();
      if (flushed) return true;
    }
    return preserveLocalDraftForRecovery();
  };

  const handleSynchronizeSharedDraft = async () => {
    if (!authUserId || batchLaunchRequestedRef.current || batchLaunchInFlightRef.current || hasUnresolvedBatchMarker()) return;
    if (draftSyncBlockedRef.current) {
      const confirmed = confirm(
        "Existe uma alteração local que não foi confirmada pelo banco. Antes de atualizar a tela, o conteúdo local será preservado em uma cópia de recuperação neste computador. Deseja carregar a versão compartilhada do Supabase?"
      );
      if (!confirmed) return;
      if (!preserveLocalDraftForRecovery()) {
        alert("Não foi possível preservar a cópia local. A sincronização foi cancelada para evitar perda de dados.");
        return;
      }
    } else if (lancamentoDraftReady) {
      const flushed = await flushSharedDraftChanges();
      if (!flushed) {
        alert("Há alterações que ainda não foram confirmadas. Os dados locais foram preservados; resolva o conflito ou sincronize antes de continuar.");
        return;
      }
    } else if (lancamentoRowsRef.current.length > 0) {
      const confirmed = confirm("A versão compartilhada ainda não foi confirmada. Antes de recarregar, salvar uma cópia local de recuperação?");
      if (!confirmed || !preserveLocalDraftForRecovery()) return;
    }

    try {
      setSharedDraftSyncStatus("loading");
      const snapshot = await loadSharedLancamentoDraftFromSupabase();
      applySharedDraftSnapshot(snapshot);
    } catch (error) {
      setSharedDraftSyncStatus("error");
      setSharedDraftSyncMessage("Não foi possível atualizar o rascunho compartilhado.");
      alert(error instanceof Error ? error.message : "Falha ao sincronizar o rascunho compartilhado.");
    }
  };

  const clearLancamentoDraft = async () => {
    if (!lancamentoDraftReady || !authUserId || batchLaunchRequestedRef.current || batchLaunchInFlightRef.current || hasUnresolvedBatchMarker()) return;
    const confirmed = confirm(
      "Limpar o rascunho compartilhado de lançamento? Isso descartará TODAS as linhas pendentes de todos os computadores, não apenas as linhas abertas nesta tela. Os registros já processados serão preservados no histórico."
    );
    if (!confirmed) return;

    const flushed = await flushSharedDraftChanges();
    if (!flushed) {
      alert("Não foi possível confirmar todas as alterações antes da limpeza. Sincronize o rascunho e tente novamente.");
      return;
    }
    const meta = sharedDraftMetaRef.current;
    if (!meta.generationId) return;

    try {
      const result = await invokeSharedDraftRpc("clear_shared_lancamento_draft", {
        p_generation_id: meta.generationId,
        p_expected_revision: meta.revision,
      });
      // Load the next snapshot, not a hard-coded empty array: another operator
      // may already have started entering the next generation after the clear.
      const snapshot = await loadSharedLancamentoDraftFromSupabase();
      applySharedDraftSnapshot(snapshot);
      setSharedDraftSyncMessage(`Rascunho limpo. ${Number(result.archived_count ?? 0)} linha(s) preservadas no arquivo de descarte.`);
    } catch (error) {
      markDraftSyncBlocked(error);
      alert(
        isSharedDraftConflict(error)
          ? "O rascunho foi alterado em outro computador durante a limpeza. Nada foi descartado; sincronize e confirme a limpeza novamente."
          : (error instanceof Error ? error.message : "Não foi possível limpar o rascunho compartilhado.")
      );
    }
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
    if (batchLaunchRequestedRef.current || hasUnresolvedBatchMarker()) return "";
    const rowId = newLancamentoDraftLineId();
    const defaultRow: LancamentoRow = {
      id: rowId,
      data: "",
      estoque: "1",
      modulo: "",
      posicao: "",
      referencia: "",
      quantidade: "",
      tipo: "",
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
    if (batchLaunchRequestedRef.current || hasUnresolvedBatchMarker()) return;
    // Remove only this line. Deleting the last visible line must never clear
    // the shared draft or remove rows that another computer has added.
    setLancamentoRows(lancamentoRowsRef.current.filter(row => row.id !== id));
  };

  const updateRowField = (id: string, field: keyof LancamentoRow, value: any) => {
    if (batchLaunchRequestedRef.current || hasUnresolvedBatchMarker()) return;
    setLancamentoRows(prev => prev.map(row => {
      if (row.id !== id) return row;

      let nextValue = value;

      if (field === "data") {
        nextValue = normalizeDateInputValue(String(value));
      }

      if (field === "dataChacote") {
        nextValue = formatChacoteMask(String(value));
      }

      if (field === "referencia") {
        nextValue = String(value).toUpperCase();
      }

      if (field === "modulo") {
        nextValue = String(value).replace(/\D/g, "").slice(0, 3);
      }

      if (field === "posicao") {
        nextValue = String(value).toUpperCase().slice(0, 3);
      }

      if (field === "estoque") {
        const raw = String(value).toUpperCase().replace(/[^E0-9]/g, "");
        const digit = raw.replace(/^E/, "").slice(0, 1);
        nextValue =
          digit && ["1", "2", "3"].includes(digit)
            ? `E${digit}`
            : raw.startsWith("E")
              ? "E"
              : "";
      }

      if (field === "galpao") {
        const digits = String(value).replace(/\D/g, "").slice(0, 2);
        nextValue = digits as Galpao | "";
      }

      if (field === "tipo") {
        nextValue = normalizeTypedMovementType(String(value), row.tipo);
      }

      const updated = { ...row, [field]: nextValue };

      if (field === "estoque" && nextValue === "E1") {
        updated.posicao = "";
        if (!updated.modulo) updated.modulo = "11";
      } else if (
        field === "estoque" &&
        (nextValue === "E2" || nextValue === "E3") &&
        row.modulo === "11"
      ) {
        updated.modulo = "";
        updated.posicao = "";
      }

      if (field === "galpao" && nextValue === "12") {
        updated.restricao = "autorizacao";
      }

      return updated;
    }));
  };

  const handleLancamentoInputKeyDown = (
    event: KeyboardEvent<HTMLElement>
  ) => {
    const target = event.currentTarget as HTMLElement;
    const rowId = target.dataset.lancamentoRow;
    const column = Number(target.dataset.lancamentoCol);

    if (!rowId || !Number.isInteger(column)) return;

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      addLancamentoRow();
      return;
    }

    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const visibleRows = lancamentoRowsFiltradas;
    const rowIndex = visibleRows.findIndex(row => row.id === rowId);
    if (rowIndex < 0) return;

    let targetRowIndex = rowIndex;
    let targetColumn = column;

    if (event.key === "ArrowUp") targetRowIndex -= 1;
    if (event.key === "ArrowDown") targetRowIndex += 1;
    if (event.key === "ArrowLeft") targetColumn -= 1;
    if (event.key === "ArrowRight") targetColumn += 1;

    const horizontalDirection =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const verticalDirection =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;

    let rowCursor = targetRowIndex;
    let columnCursor = targetColumn;
    let targetElement: HTMLElement | null = null;

    while (rowCursor >= 0 && rowCursor < visibleRows.length && columnCursor >= 2 && columnCursor <= 14) {
      const targetRow = visibleRows[rowCursor];
      targetElement = document.querySelector<HTMLElement>(
        `[data-lancamento-row="${targetRow.id}"][data-lancamento-col="${columnCursor}"]`
      );

      const isDisabled =
        targetElement instanceof HTMLInputElement || targetElement instanceof HTMLSelectElement
          ? targetElement.disabled
          : false;

      if (targetElement && !isDisabled) break;

      if (horizontalDirection !== 0) {
        columnCursor += horizontalDirection;
      } else {
        rowCursor += verticalDirection;
      }
    }

    targetElement?.focus();
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

  // Process all lines from the current shared draft. The draft snapshot is loaded
  // again before processing, and the database closes it atomically with stock writes.
  const handleLancarLote = async () => {
    if (!authUserId || !lancamentoDraftReady) {
      alert("O rascunho compartilhado ainda não foi carregado. Sincronize antes de lançar.");
      return;
    }
    if (batchLaunchRequestedRef.current || batchLaunchInFlightRef.current) return;

    batchLaunchRequestedRef.current = true;
    setBatchLaunchLoading(true);
    let keepPendingBatchMarker = false;

    try {
      let pendingBatch: { batchId: string; generationId: string; revision: number } | null = null;
      try {
        const pendingRaw = localStorage.getItem(LANCAMENTO_BATCH_PENDING_KEY);
        if (pendingRaw) {
          const parsed = JSON.parse(pendingRaw) as Record<string, unknown>;
          if (
            typeof parsed.batchId === "string" &&
            typeof parsed.generationId === "string" &&
            Number.isSafeInteger(Number(parsed.revision))
          ) {
            pendingBatch = {
              batchId: parsed.batchId,
              generationId: parsed.generationId,
              revision: Number(parsed.revision),
            };
          } else {
            alert("Foi encontrado um marcador de lote incompleto neste navegador. Não iniciarei outro lote automaticamente; sincronize o rascunho e confira o histórico.");
            return;
          }
        }
      } catch (error) {
        console.error("Não foi possível consultar o marcador de lote pendente:", error);
        alert("Não foi possível verificar o identificador do lote anterior. Nenhum novo lote foi iniciado.");
        return;
      }

      // A previous request may have committed while its network response was lost.
      // The status RPC serializes with in-flight batches on the database control row.
      let draftSnapshotForPending: SharedLancamentoDraftSnapshot | null = null;
      if (pendingBatch) {
        const probe = await supabase.rpc("get_shared_lancamento_batch_result" as never, {
          p_batch_id: pendingBatch.batchId,
        } as never);
        const probeData = probe.data as SharedDraftRpcResult | null;
        if (probe.error) {
          alert("Não foi possível confirmar se o lote anterior foi processado. Não repita o lançamento. Tente sincronizar e consultar novamente.");
          keepPendingBatchMarker = true;
          return;
        }
        if (probeData?.success === true) {
          // The old batch is confirmed. Preserve or synchronize any edits made
          // after the ambiguous response before replacing this screen with the
          // newly active generation.
          const preservedOrSynced = await preserveBeforeReplacingLocalDraft();
          if (!preservedOrSynced) {
            alert("O lote anterior já foi confirmado, mas não foi possível sincronizar nem preservar as alterações locais. A tela não será sobrescrita.");
            keepPendingBatchMarker = true;
            return;
          }
          localStorage.removeItem(LANCAMENTO_BATCH_PENDING_KEY);
          setBatchPendingRecovery(false);
          const snapshot = await loadSharedLancamentoDraftFromSupabase();
          applySharedDraftSnapshot(snapshot);
          alert("O lote anterior já foi confirmado pelo banco. Nenhuma movimentação foi repetida. O rascunho compartilhado atual foi sincronizado.");
          return;
        }
        if (probeData?.code !== "BATCH_NOT_FOUND") {
          alert("O banco não conseguiu confirmar o estado do lote anterior. Não iniciarei um novo processamento.");
          keepPendingBatchMarker = true;
          return;
        }

        // The status RPC waited for the prior transaction and confirmed there is
        // no committed batch record with this ID. Read the generation, but do not
        // apply it yet: the current screen may contain new unsaved local edits.
        draftSnapshotForPending = await loadSharedLancamentoDraftFromSupabase();
        if (draftSnapshotForPending.generation_id !== pendingBatch.generationId) {
          const preservedOrSynced = await preserveBeforeReplacingLocalDraft();
          if (!preservedOrSynced) {
            alert("O rascunho mudou em outro computador e não foi possível salvar uma cópia das alterações locais. A tela não será sobrescrita.");
            keepPendingBatchMarker = true;
            return;
          }
          const latest = await loadSharedLancamentoDraftFromSupabase();
          applySharedDraftSnapshot(latest);
          localStorage.removeItem(LANCAMENTO_BATCH_PENDING_KEY);
          keepPendingBatchMarker = false;
          alert("Outra operação encerrou o rascunho anterior. Sincronizei a geração atual sem repetir o lote antigo. Confira a cópia local de recuperação caso houvesse edições pendentes.");
          return;
        }
      }

      if (draftSyncBlockedRef.current && pendingBatch) {
        // The previous network response was ambiguous but the database confirms
        // that this batch ID was not committed. Preserve any local edits, reset
        // the screen to the authoritative shared draft and require a deliberate
        // second click; do not leave the operator stuck behind a stale CAS error.
        if (!preserveLocalDraftForRecovery()) {
          alert("Não foi possível preservar as alterações locais. O rascunho não foi alterado; mantenha esta tela aberta e não inicie outro lote.");
          keepPendingBatchMarker = true;
          return;
        }
        try {
          const latest = await loadSharedLancamentoDraftFromSupabase();
          applySharedDraftSnapshot(latest);
          setSharedDraftSyncStatus("conflict");
          setSharedDraftSyncMessage("O lote anterior não foi confirmado. As alterações locais foram preservadas numa cópia de recuperação; revise o rascunho compartilhado e clique novamente para processar usando o mesmo identificador.");
        } catch (recoveryError) {
          markDraftSyncBlocked(recoveryError);
        }
        keepPendingBatchMarker = true;
        alert("O banco confirmou que o lote anterior não foi processado. Preservei a cópia local e atualizei o rascunho compartilhado. Revise os dados antes de clicar em Lançar Lote novamente.");
        return;
      }
      if (draftSyncBlockedRef.current) {
        alert("Há alterações locais que ainda não foram confirmadas. Sincronize o rascunho antes de lançar o lote.");
        return;
      }
      // This also runs for a known-not-processed pending batch. Since its ID is
      // stable, reusing it after a confirmed rollback is idempotent; edits made
      // after the previous attempt are persisted before loading the next snapshot.
      const flushed = await flushSharedDraftChanges();
      if (!flushed) {
        alert("Não foi possível confirmar as alterações locais no rascunho compartilhado. Nenhum lote foi iniciado.");
        return;
      }

      let draftSnapshot = await loadSharedLancamentoDraftFromSupabase();
      if (pendingBatch && draftSnapshot.generation_id !== pendingBatch.generationId) {
        const preservedOrSynced = await preserveBeforeReplacingLocalDraft();
        if (!preservedOrSynced) {
          alert("A geração mudou e não foi possível preservar as alterações locais. A tela não será sobrescrita.");
          keepPendingBatchMarker = true;
          return;
        }
        const latest = await loadSharedLancamentoDraftFromSupabase();
        applySharedDraftSnapshot(latest);
        localStorage.removeItem(LANCAMENTO_BATCH_PENDING_KEY);
        keepPendingBatchMarker = false;
        alert("A geração do rascunho mudou. Sincronizei os dados atuais e não repeti o lote anterior.");
        return;
      }
      applySharedDraftSnapshot(draftSnapshot);

      const batchId = pendingBatch?.batchId ?? newOperationUuid();
      batchLaunchInFlightRef.current = true;
      const retryableStockCodes = new Set([
        "SLOT_SET_CONFLICT",
        "SLOT_CONFLICT",
        "DIVERGENCIA_SET_CONFLICT",
        "DIVERGENCIA_CONFLICT",
      ]);
      const retryableDraftCodes = new Set([
        "DRAFT_REVISION_CONFLICT",
        "DRAFT_SNAPSHOT_MISMATCH",
      ]);
      let completedSummary: Record<string, unknown> | null = null;
      let finalError: { code?: string; reason?: string; ambiguous?: boolean } | null = null;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        // A retry after a concurrent draft edit must include the complete latest
        // line set, not just the rows visible in the first snapshot.
        const nonBlankWithoutSku = draftSnapshot.lines
          .map(line => line.row_data)
          .filter(row => !isBlankLancamentoDraftRow(row) && !row.referencia.trim());
        if (nonBlankWithoutSku.length > 0) {
          alert(
            `Existem ${nonBlankWithoutSku.length} linha(s) parcialmente preenchida(s) sem SKU. ` +
            "Complete ou remova somente essas linhas antes de lançar. Elas não serão descartadas automaticamente."
          );
          return;
        }
        const activeData = draftSnapshot.lines
          .map(line => line.row_data)
          .filter(row => !isBlankLancamentoDraftRow(row) && row.referencia.trim() !== "");
        if (activeData.length === 0) {
          alert("O rascunho compartilhado não contém movimentações completas para processar.");
          return;
        }

        // The batch reads a fresh full snapshot directly; divergence rows remain separately permissioned.
        if (!(await requestAppMutationPermission("stock.search", "consultar o estoque para processar o lote"))) return;
        if (!(await requestAppMutationPermission("divergences.view", "consultar divergências para processar o lote"))) return;

        // All reads are bounded and authoritative. No offline cache is accepted for a write.
        const [freshSlots, freshDivergencias, freshLayoutResult, freshPositionsResult] = await Promise.all([
          loadFreshSlotsForBatch(),
          loadFreshDivergenciasForBatch(),
          loadWarehouseLayout(),
          loadWarehousePositions(),
        ]);
        if (freshLayoutResult.error) {
          throw new Error(`Não foi possível confirmar a configuração física antes do lote: ${freshLayoutResult.error}`);
        }
        if (freshPositionsResult.error) {
          throw new Error(`Não foi possível confirmar as posições físicas antes do lote: ${freshPositionsResult.error}`);
        }
        const batchWarehouseLayout = freshLayoutResult.data;
        const batchWarehousePositions = freshPositionsResult.data;
        setWarehouseLayout(batchWarehouseLayout);
        setWarehouseLayoutError(null);
        setWarehousePositions(batchWarehousePositions);
        setWarehousePositionsError(null);

        let allErrors: string[] = [];
        activeData.forEach((row, index) => {
          const rowErrors = validateLancamentoRow(
            row,
            index + 1,
            productsList,
            true,
            freshSlots,
            getE1CapacityMap(batchWarehouseLayout),
            batchWarehouseLayout,
            batchWarehousePositions,
          );
          // These two conditions are handled by processLancamentosInSequence
          // as explicit operational divergences. Do not abort the whole lot
          // before its existing business rule can record them.
          const structuralErrors = rowErrors.filter(message =>
            !/módulo \d+ está inativo na configuração física do Estoque \d+/i.test(message) &&
            !/^Endereço .* contém o item auxiliar .* cujo SKU\/restrição no registro não corresponde ao ID\./i.test(message)
          );
          allErrors = [...allErrors, ...structuralErrors];
          if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.hora.trim())) {
            allErrors.push(`Linha ${index + 1}: a hora deve estar no formato HH:mm (ex.: 08:30).`);
          }
          if ((row.galpao || "3") === "12" && row.restricao !== "autorizacao") {
            allErrors.push(`Linha ${index + 1}: Galpão 12 exige Restrição = Solicitar autorização.`);
          }
        });

        if (allErrors.length > 0) {
          alert(`O lote contém inconsistências de preenchimento e não pôde ser lançado:\n\n${allErrors.slice(0, 10).join("\n")}${allErrors.length > 10 ? `\n...e mais ${allErrors.length - 10} inconsistências.` : ""}`);
          return;
        }

        // Recompute from the newest DB snapshot after a conflict, not from the stale UI state.
        const {
          updatedSlots,
          newHistory,
          newDivergencias,
          processedCount,
          errorCount,
        } = processLancamentosInSequence(
          activeData,
          freshSlots,
          operator,
          launchDate,
          freshDivergencias,
          productsList,
          true,
          getE1CapacityMap(batchWarehouseLayout),
          batchWarehouseLayout,
        );
        const updatedDivergencias = [...newDivergencias, ...freshDivergencias];

        // Persist the idempotency marker before the network mutation. It remains
        // if the response is ambiguous and is checked before a future retry.
        const marker = {
          batchId,
          generationId: draftSnapshot.generation_id,
          revision: draftSnapshot.revision,
        };
        try {
          localStorage.setItem(LANCAMENTO_BATCH_PENDING_KEY, JSON.stringify(marker));
          setBatchPendingRecovery(true);
        } catch (error) {
          throw new Error("Não foi possível salvar o identificador idempotente do lote neste navegador. O lançamento foi cancelado antes da gravação.");
        }
        keepPendingBatchMarker = true;

        const transaction = await persistStockMutationAtomically(
          freshSlots,
          updatedSlots,
          newHistory,
          freshDivergencias,
          updatedDivergencias,
          {
            batchId,
            generationId: draftSnapshot.generation_id,
            expectedRevision: draftSnapshot.revision,
            inputRows: draftSnapshot.lines,
            resultSummary: {
              processed_count: processedCount,
              divergence_count: errorCount,
              source: "shared_lancamento_draft",
            },
          },
        );

        if (transaction.ok) {
          completedSummary = transaction.batchResult?.result_summary as Record<string, unknown> | undefined ?? {
            processed_count: processedCount,
            divergence_count: errorCount,
          };
          localStorage.removeItem(LANCAMENTO_BATCH_PENDING_KEY);
          setBatchPendingRecovery(false);
          keepPendingBatchMarker = false;
          break;
        }

        finalError = {
          code: transaction.code,
          reason: transaction.reason,
          ambiguous: transaction.ambiguous,
        };
        if (transaction.ambiguous) {
          keepPendingBatchMarker = true;
          setSharedDraftSyncStatus("error");
          setSharedDraftSyncMessage("O resultado do lote está incerto. Consulte o identificador antes de repetir.");
          alert(
            `${transaction.reason || "A resposta do Supabase não confirmou o lote."}\n\n` +
            "O rascunho foi preservado. Não clique novamente para criar outro lote; a próxima tentativa consultará o mesmo identificador."
          );
          return;
        }

        if (transaction.code === "DRAFT_GENERATION_CONFLICT") {
          // Another client closed or cleared the generation first. The current
          // batch has not written anything; fetch the actual next generation
          // rather than leaving old rows on screen or implying they are pending.
          try {
            const latest = await loadSharedLancamentoDraftFromSupabase();
            applySharedDraftSnapshot(latest);
            localStorage.removeItem(LANCAMENTO_BATCH_PENDING_KEY);
            setBatchPendingRecovery(false);
            keepPendingBatchMarker = false;
            alert("Outro computador encerrou ou limpou esse rascunho antes deste processamento. Sincronizei a geração atual e não repeti nenhuma movimentação.");
          } catch (syncError) {
            markDraftSyncBlocked(syncError);
            keepPendingBatchMarker = false;
            localStorage.removeItem(LANCAMENTO_BATCH_PENDING_KEY);
            setBatchPendingRecovery(false);
            alert("O rascunho mudou em outro computador, mas não consegui carregar a nova geração. Nenhuma movimentação deste lote foi aplicada; use Sincronizar rascunho.");
          }
          return;
        }

        const isRetryable = retryableStockCodes.has(transaction.code ?? "") || retryableDraftCodes.has(transaction.code ?? "");
        if (!isRetryable || attempt === 3) break;

        // Reload the shared rows before a retry. Never retry an old generation:
        // another operator may have completed or cleared that batch already.
        const nextDraftSnapshot = await loadSharedLancamentoDraftFromSupabase();
        if (nextDraftSnapshot.generation_id !== draftSnapshot.generation_id) {
          applySharedDraftSnapshot(nextDraftSnapshot);
          localStorage.removeItem(LANCAMENTO_BATCH_PENDING_KEY);
          setBatchPendingRecovery(false);
          keepPendingBatchMarker = false;
          alert("O rascunho foi encerrado ou substituído por outra operação enquanto o lote era processado. Sincronizei os dados e não repeti o lançamento.");
          return;
        }
        draftSnapshot = nextDraftSnapshot;
        applySharedDraftSnapshot(draftSnapshot);
        // The shared revision may have advanced because another PC saved lines.
        // The next iteration uses the refreshed complete generation and same batch ID.
      }

      if (!completedSummary) {
        if (!finalError?.ambiguous) {
          localStorage.removeItem(LANCAMENTO_BATCH_PENDING_KEY);
          setBatchPendingRecovery(false);
          keepPendingBatchMarker = false;
        }
        const reason = finalError?.reason || "O lote não pôde ser confirmado pelo banco.";
        setSharedDraftSyncStatus(finalError?.ambiguous ? "error" : "conflict");
        setSharedDraftSyncMessage("O rascunho foi preservado; sincronize antes de tentar novamente.");
        alert(
          `${reason}\n\nO sistema não limpou o rascunho e não iniciou outra movimentação. ` +
          "Sincronize os dados e consulte o histórico antes de uma nova tentativa."
        );
        return;
      }

      // The database has already closed/archived the processed generation in the
      // same transaction as stock + history + divergence writes. Read the current
      // generation rather than forcing [] so rows added moments later by another
      // computer are retained on this screen.
      try {
        const currentDraft = await loadSharedLancamentoDraftFromSupabase();
        applySharedDraftSnapshot(currentDraft);
      } catch (error) {
        setLancamentoRows([]);
        baselineDraftLinesRef.current = [];
        const nextGenerationId = String(completedSummary.next_generation_id ?? "");
        sharedDraftMetaRef.current = {
          generationId: nextGenerationId || null,
          revision: 0,
        };
        setLancamentoDraftReady(Boolean(nextGenerationId));
        setSharedDraftSyncStatus("error");
        setSharedDraftSyncMessage("O lote foi confirmado, mas não foi possível atualizar a tela. Sincronize antes do próximo lote.");
        console.error("Lote confirmado; falha ao ler o rascunho seguinte:", error);
      }
      const processedCount = Number(completedSummary.processed_count ?? completedSummary.history_count ?? 0);
      const divergenceCount = Number(completedSummary.divergence_count ?? completedSummary.new_divergence_count ?? 0);
      alert(
        `Lote confirmado pelo banco.\n✔️ ${processedCount} movimentação(ões) processada(s).\n⚠️ ${divergenceCount} divergência(s) registrada(s).\n\n` +
        "O rascunho processado foi encerrado atomicamente. Nenhuma linha deste lote será reaplicada."
      );
    } catch (error) {
      console.error("Erro inesperado ao processar o lote compartilhado:", error);
      alert(error instanceof Error ? error.message : "Não foi possível concluir o lote. O rascunho foi preservado.");
    } finally {
      batchLaunchInFlightRef.current = false;
      batchLaunchRequestedRef.current = false;
      setBatchLaunchLoading(false);
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
    if (!permissionEnforcementEnabled && !hasAccess("operador")) {
  alert("Seu perfil não possui permissão para efetuar lançamentos.");
  return false;
  }

  if (
    permissionEnforcementEnabled &&
    !canUseAppPermissionForUi("stock.launch.create")
  ) {
    alert("Seu perfil não possui permissão para efetuar lançamentos.");
    return false;
  }

  if (
    permissionEnforcementEnabled &&
    (warehouseLayoutLoading || warehousePositionsLoading)
  ) {
    alert("A estrutura física ainda está sendo carregada. Aguarde alguns segundos e tente novamente.");
    return false;
  }

  if (
    permissionEnforcementEnabled &&
    (warehouseLayoutError || warehousePositionsError)
  ) {
    alert(
      "Não foi possível carregar a estrutura física do estoque. Atualize o aplicativo e tente novamente.\n\n" +
      [warehouseLayoutError, warehousePositionsError].filter(Boolean).join("\n")
    );
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
      true,
      slots,
      getE1CapacityMap(warehouseLayout),
      warehouseLayout,
      warehousePositions
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
      true,
      getE1CapacityMap(warehouseLayout)
    );

    if (processedCount === 0 && newDivergencias.length === 0) {
      alert("O lançamento não gerou nenhuma alteração. Verifique os dados informados.");
      return false;
    }

    if (newDivergencias.length > 0) {
      const updatedDivergencias = [...newDivergencias, ...divergencias];
      const transaction = await persistStockMutationAtomically(
        slots,
        updatedSlots,
        newHistory,
        divergencias,
        updatedDivergencias,
        undefined,
        "launch",
      );
      if (!transaction.ok) {
        alert(
          "O lançamento foi interrompido e não foi confirmado pelo Supabase.\n\n" +
          `${transaction.reason || "Atualize o endereço e confira o histórico antes de tentar novamente."}`
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

    const transaction = await persistStockMutationAtomically(
      slots,
      updatedSlots,
      newHistory,
      divergencias,
      divergencias,
      undefined,
      "launch",
    );
    if (!transaction.ok) {
      alert(
        "O lançamento foi interrompido e não foi confirmado pelo Supabase.\n\n" +
        `${transaction.reason || "Atualize o endereço e confira o histórico antes de tentar novamente."}`
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
    if (!permissionEnforcementEnabled && !hasAccess("operador")) {
  alert("Seu perfil não possui permissão para transferir posições.");
  return false;
  }

  if (
    permissionEnforcementEnabled &&
    !canUseAppPermissionForUi("stock.transfer.create")
  ) {
    alert("Seu perfil não possui permissão para transferir posições.");
    return false;
  }

  if (
    permissionEnforcementEnabled &&
    (warehouseLayoutLoading || warehousePositionsLoading)
  ) {
    alert("A estrutura física ainda está sendo carregada. Aguarde alguns segundos e tente novamente.");
    return false;
  }

  if (
    permissionEnforcementEnabled &&
    (warehouseLayoutError || warehousePositionsError)
  ) {
    alert(
      "Não foi possível carregar a estrutura física do estoque. Atualize o aplicativo e tente novamente.\n\n" +
      [warehouseLayoutError, warehousePositionsError].filter(Boolean).join("\n")
    );
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

    const transaction = await persistStockMutationAtomically(
      slots,
      result.updatedSlots,
      historyWithObservation,
      divergencias,
      divergencias,
      undefined,
      "transfer",
    );
    if (!transaction.ok) {
      alert(
        "A transferência foi interrompida e não foi confirmada pelo Supabase.\n\n" +
        `${transaction.reason || "Atualize a origem e o destino antes de tentar novamente."}`
      );
      return false;
    }

    alert("Transferência concluída. SKU, saldo e data de chacote foram preservados.");
    return true;
  };

  // Manual Excel paste parser updated to handle E1, E2, E3
  const handleImportExcelData = () => {
    if (batchLaunchRequestedRef.current || hasUnresolvedBatchMarker()) return;
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
    id: newLancamentoDraftLineId(),
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
      // Excel import contributes rows to the shared draft; it never replaces
      // rows already saved by this or another computer.
      setLancamentoRows(prev => [...prev, ...newRows]);
      setBulkFeedback(`Sucesso! ${newRows.length} lançamentos adicionados ao rascunho compartilhado.`);
      setBulkText("");
      setTimeout(() => {
        setShowBulkImport(false);
        setBulkFeedback("");
      }, 2000);
    } else {
      setBulkFeedback("Falha no parser. O formato deve ser: Referência [Tab ou Semicolon] Quantidade [Tab] Tipo.");
    }
  };

  // Static import-layout template with synthetic example values only; it does not export live stock or reports.
  // Keep this separate from reports.export until the template contains operational data.
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

  const handleExportarEnderecamento = async () => {
    if (!(await requestReportExportPermission(["stock.search"]))) return;
    if (filteredSlots.length === 0) {
      alert("Nenhum endereço corresponde aos filtros atuais.");
      return;
    }

    const data = filteredSlots.map(createStockSearchSpreadsheetRow);

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Endereçamento"
    );

    XLSX.writeFile(
      workbook,
      `enderecamento_porto_brasil_${getTodayIsoDate()}.xlsx`
    );
  };

    const handleExportarEnderecamentoPDF = async () => {
      if (!(await requestReportExportPermission(["stock.search"]))) return;
      if (filteredSlots.length === 0) {
        alert("Nenhum endereço corresponde aos filtros atuais.");
        return;
      }

      const doc = new jsPDF({ orientation: "landscape" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const generatedAt = new Date().toLocaleString("pt-BR");
      const activeFilters = [
        filterEstoque ? `Estoque ${filterEstoque.replace(/^E/i, "")}` : "",
        filterGalpao ? `Galpão ${filterGalpao}` : "",
        searchRef.trim() ? `SKU ${searchRef.trim()}` : "",
        searchDesc.trim() ? `Descrição: ${searchDesc.trim()}` : "",
        searchModulo.trim() ? `Módulo ${searchModulo.trim()}` : "",
        searchPosicao.trim() ? `Posição ${searchPosicao.trim()}` : "",
        filterRestricao.trim() ? `Restrição ${filterRestricao.trim()}` : "",
        searchObservacao.trim() ? `Observação: ${searchObservacao.trim()}` : "",
        somenteAcimaPaletizacao ? "Somente acima da paletização" : "",
      ].filter(Boolean);
      const filtersSummary = `Filtros: ${activeFilters.length ? activeFilters.join(" | ") : "nenhum (todos os registros correspondentes)"}`;

      const drawHeader = () => {
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageWidth, 30, "F");
        doc.setFillColor(37, 99, 235);
        doc.rect(0, 30, pageWidth, 2, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("PORTO BRASIL CERÂMICA  |  GESTÃO DE ARMAZENAGEM", 14, 9);
        doc.setFontSize(18);
        doc.text("Relatório de Endereçamento", 14, 19);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(
          "POSIÇÕES E SALDOS FÍSICOS",
          14,
          25
        );
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("RELATÓRIO OPERACIONAL", pageWidth - 14, 10, { align: "right" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.text(`Gerado em ${generatedAt}`, pageWidth - 14, 17, { align: "right" });
        doc.setTextColor(30, 41, 59);
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(14, 35, pageWidth - 28, 12, 1.5, 1.5, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(`Registros: ${filteredSlots.length.toLocaleString("pt-BR")}`, 18, 42.5);
        doc.text(`Saldo físico total: ${filteredSlotsTotalSaldo.toLocaleString("pt-BR")} peças`, 78, 42.5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        const filterLines = doc.splitTextToSize(filtersSummary, pageWidth - 28);
        doc.text(filterLines, 14, 52);
        doc.setDrawColor(226, 232, 240);
        doc.line(14, 56, pageWidth - 14, 56);
        doc.setFont("helvetica", "normal");
      };

      autoTable(doc, {
        startY: 60,
        margin: { top: 60, bottom: 14, left: 14, right: 14 },
        didDrawPage: () => {
          drawHeader();
          doc.setDrawColor(203, 213, 225);
          doc.line(14, pageHeight - 10, pageWidth - 14, pageHeight - 10);
          doc.setTextColor(100, 116, 139);
          doc.setFontSize(7);
          doc.text("Documento gerado pelo sistema de endereçamento • Conferir filtros e data de emissão", 14, pageHeight - 5);
          doc.text(`Página ${doc.getNumberOfPages()}`, pageWidth - 14, pageHeight - 5, { align: "right" });
        },
        didParseCell: (data) => {
          if (data.section !== "body") return;

          const slot = filteredSlots[data.row.index];
          if (!slot) return;

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

        head: [getStockSearchPdfHeaders()],

        body: filteredSlots.map(createStockSearchPdfRow),

        styles: {
          fontSize: 6.5,
          cellPadding: 1.7
        },

        headStyles: {
          fillColor: [37, 99, 235],
          fontStyle: "bold"
        },

        columnStyles: { 4: { cellWidth: 55 }, 11: { cellWidth: 55 } }
      });

      doc.save(
        `Enderecamento_${getTodayIsoDate()}.pdf`
      );
    };

  const handleExportarHistorico = async () => {
    if (!(await requestReportExportPermission(["history.view"]))) return;
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
            },
        offlineCacheScope,
        offlineCacheAuthorizationFingerprint,
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

  // A correção de divergências é centralizada em DivergenciasPanel e no fluxo transacional acima.

  const handleExportCSV = async () => {
    if (!(await requestReportExportPermission(["divergences.view"]))) return;
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

  const handlePrintDivergenciais = async () => {
    if (!(await requestReportExportPermission(["divergences.view"]))) return;
    window.print();
  };

  const handleClearSlotsFilter = () => {
    setSearchRef("");
    setSearchDesc("");
    setFilterEstoque("");
    setFilterGalpao("");
    setFilterRestricao("");
    setSearchObservacao("");
    setSearchModulo("");
    setSearchPosicao("");
    setSearchSorts([]);
    setSomenteAcimaPaletizacao(false);
    setSearchPage(1);
  };

  // --- COMPILATING SYSTEM VIEWS ---
  const productsByReference = useMemo(
    () => new globalThis.Map(productsList.map(product => [product.referencia, product])),
    [productsList]
  );

  const toggleSearchSort = (field: SearchSortField) => {
    setSearchSorts(current => {
      const existingIndex = current.findIndex(rule => rule.field === field);

      if (existingIndex === -1) {
        return [...current, { field, direction: "asc" }];
      }

      const existing = current[existingIndex];

      if (existing.direction === "asc") {
        return current.map((rule, index) =>
          index === existingIndex
            ? { ...rule, direction: "desc" as const }
            : rule
        );
      }

      return current.filter((_, index) => index !== existingIndex);
    });

    setSearchPage(1);
  };

  const getSearchSortValue = (
    slot: WarehouseSlot,
    field: SearchSortField
  ): string | number | null => {
    switch (field) {
      case "estoque":
        return Number(String(slot.estoque).replace(/\D/g, "")) || 0;
      case "modulo":
        return Number(String(slot.modulo).replace(/^[RM]/i, "")) || 0;
      case "posicao":
        return String(slot.posicao || "").trim().toUpperCase() || null;
      case "referencia":
        return String(slot.referencia || "").trim().toUpperCase() || null;
      case "restricao":
        return String(slot.restricao || "nenhuma").trim().toLowerCase() || null;
      case "descricao":
        return String(slot.descricao || "").trim() || null;
      case "saldo":
        return Number(slot.saldo) || 0;
      case "dataChacote":
        return parseChacoteDate(slot.dataChacote);
      case "ultimaMov": {
        const date = parseChacoteDate(slot.ultimaData);
        if (date === null) return null;

        const timeMatch = String(slot.ultimaHora || "").match(/^(\d{1,2}):(\d{2})/);
        const minutes = timeMatch
          ? Number(timeMatch[1]) * 60 + Number(timeMatch[2])
          : 0;

        return date + minutes * 60 * 1000;
      }
      case "responsavel":
        return String(slot.ultimoResponsavel || "").trim() || null;
      case "observacao":
        return String(slot.observacao || "").trim() || null;
      default:
        return null;
    }
  };

  const compareSearchSortValues = (
    a: string | number | null,
    b: string | number | null,
    direction: "asc" | "desc",
    field: SearchSortField
  ): number => {
    if (a === null && b === null) return 0;

    // Para a ordenação operacional, valores sem data ficam primeiro na ordem
    // ascendente. Isso é especialmente importante para Data Chacote.
    if (a === null) return direction === "asc" ? -1 : 1;
    if (b === null) return direction === "asc" ? 1 : -1;

    let result = 0;

    if (typeof a === "number" && typeof b === "number") {
      result = a - b;
    } else if (field === "posicao") {
      const aText = String(a);
      const bText = String(b);
      const aMatch = aText.match(/^([A-Z]+)?(\d+(?:[.,]\d+)?)?(.*)$/);
      const bMatch = bText.match(/^([A-Z]+)?(\d+(?:[.,]\d+)?)?(.*)$/);

      if (aMatch && bMatch) {
        result =
          (aMatch[1] || "").localeCompare(bMatch[1] || "", "pt-BR") ||
          ((Number((aMatch[2] || "0").replace(",", ".")) || 0) -
            (Number((bMatch[2] || "0").replace(",", ".")) || 0)) ||
          aMatch[3].localeCompare(bMatch[3], "pt-BR", { numeric: true });
      } else {
        result = aText.localeCompare(bText, "pt-BR", { numeric: true });
      }
    } else {
      result = String(a).localeCompare(String(b), "pt-BR", {
        numeric: true,
        sensitivity: "base",
      });
    }

    return direction === "asc" ? result : -result;
  };

  const getSearchSortIndicator = (field: SearchSortField): string => {
    const index = searchSorts.findIndex(rule => rule.field === field);
    if (index === -1) return "↕";

    const rule = searchSorts[index];
    return `${rule.direction === "asc" ? "↑" : "↓"}${searchSorts.length > 1 ? ` ${index + 1}` : ""}`;
  };

  const filteredSlots = useMemo(() => {
    const normalizedSearchRef = searchRef.trim().toLowerCase();
    const normalizedSearchDesc = searchDesc.trim().toLowerCase();
    const normFilterEst = filterEstoque ? filterEstoque.replace("E", "") : "";
    const normalizedFilterGalpao = filterGalpao.trim();
    const normalizedFilterRestricao = filterRestricao.trim().toLowerCase();
    const normalizedSearchObservacao = searchObservacao.trim().toLowerCase();
    const addressQuery = searchModulo.trim().replace(/\s+/g, "").toUpperCase();
    const addressMatch = addressQuery.match(/^E([123])M(\d+)([A-Z]\d+)?$/) ||
      addressQuery.match(/^M(\d+)([A-Z]\d+)?$/);
    const normalizeSlotModule = (value: unknown): string => {
      const raw = String(value ?? "").trim().toUpperCase().replace(/^[RM]/i, "");
      return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
    };

    const rawSearchModule = searchModulo.replace(/^[RM]/i, "");
    const normalizedSearchModulo = /^\d+$/.test(rawSearchModule)
      ? String(Number(rawSearchModule))
      : rawSearchModule;
    const normalizedSearchPosicao = searchPosicao.replace(/^[RMG]/i, "").toUpperCase();
    const normalizedSearchPosicaoText = searchPosicao.trim().toLowerCase();

    // Vagas físicas E2/E3 são exibidas uma única vez. Linhas auxiliares ::ITEM::
    // vazias continuam no banco para preservar histórico e reutilização, mas não
    // representam uma segunda vaga física. E1 contém linhas lógicas por SKU.
    const occupiedPhysicalAddressKeys = new Set<string>(
      slots
        .filter(slot => {
          const stock = String(slot.estoque ?? "").trim().toUpperCase().replace(/^E/i, "");
          return (stock === "2" || stock === "3") &&
            Number(slot.saldo) > 0 &&
            String(slot.referencia ?? "").trim() !== "";
        })
        .map(slot => {
          const stock = String(slot.estoque ?? "").trim().toUpperCase().replace(/^E/i, "");
          return `${stock}-${normalizeSlotModule(slot.modulo)}-${String(slot.posicao || "").trim().toUpperCase()}`;
        })
    );

    const shouldDisplaySlot = (slot: WarehouseSlot): boolean => {
      const stock = String(slot.estoque ?? "").trim().toUpperCase().replace(/^E/i, "");
      const rawModule = String(slot.modulo ?? "").trim().toUpperCase().replace(/^[RM]/i, "");
      const module = normalizeSlotModule(slot.modulo);
      const reference = String(slot.referencia ?? "").trim();
      const occupied = Number(slot.saldo) > 0 && reference !== "";

      // A configuração oficial não possui módulos numéricos com zero à esquerda.
      // As vagas legadas vazias são ocultadas; qualquer saldo positivo anômalo continua visível.
      if (!/^\d+$/.test(module)) return false;
      if (stock === "1") return occupied || (rawModule !== module && Number(slot.saldo) > 0);
      if (stock !== "2" && stock !== "3") return false;
      if (rawModule !== module && Number(slot.saldo) > 0) return true;
      if (rawModule !== module && reference === "") return false;
      if (occupied) return true;
      if (String(slot.id).includes("::ITEM::")) return false;

      const position = String(slot.posicao || "").trim().toUpperCase();
      const baseId = `${stock}-${module}-${position}`;
      if (slot.id !== baseId) return false;

      return !occupiedPhysicalAddressKeys.has(`${stock}-${module}-${position}`);
    };

    const filtered = slots.filter(s => {
      if (!shouldDisplaySlot(s)) return false;

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

      const matchesRestricao = normalizedFilterRestricao
        ? String(s.restricao || "nenhuma").trim().toLowerCase() === normalizedFilterRestricao
        : true;

      const matchesObservacao = normalizedSearchObservacao
        ? String(s.observacao || "").toLowerCase().includes(normalizedSearchObservacao)
        : true;

      const matchesAddress = addressMatch
        ? addressQuery.startsWith("E")
          ? s.estoque === addressMatch[1] &&
            normalizeSlotModule(s.modulo) === normalizeSlotModule(addressMatch[2]) &&
            (!addressMatch[3] ||
              s.posicao.trim().toUpperCase() === addressMatch[3])
          : normalizeSlotModule(s.modulo) === normalizeSlotModule(addressMatch[1]) &&
            (!addressMatch[2] ||
              s.posicao.trim().toUpperCase() === addressMatch[2])
        : true;

      const matchesModulo = !addressMatch && normalizedSearchModulo
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
        matchesRestricao &&
        matchesObservacao &&
        matchesAddress &&
        matchesModulo &&
        matchesPosicao
      );
    });

    if (searchSorts.length === 0) {
      return filtered;
    }

    return filtered
      .map((slot, index) => ({ slot, index }))
      .sort((a, b) => {
        for (const rule of searchSorts) {
          const comparison = compareSearchSortValues(
            getSearchSortValue(a.slot, rule.field),
            getSearchSortValue(b.slot, rule.field),
            rule.direction,
            rule.field
          );

          if (comparison !== 0) return comparison;
        }

        return a.index - b.index;
      })
      .map(item => item.slot);
  }, [
    slots,
    productsByReference,
    searchRef,
    searchDesc,
    filterEstoque,
    filterGalpao,
    filterRestricao,
    searchObservacao,
    searchModulo,
    searchPosicao,
    searchSorts,
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

    const handleExportConsolidationPDF = async () => {
  if (!(await requestReportExportPermission(["products.view", "stock.search"]))) return;
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
  type ConsultorChatMessage = {
    sender: "system" | "user";
    text: string;
    kind?: "executive";
  };

  const [chatMessages, setChatMessages] = useState<ConsultorChatMessage[]>([
    {
      sender: "system",
      text: "Olá! Sou o Celso. Estou conectado aos dados reais dos Estoques E1, E2 e E3 e posso analisar estoque, endereçamento, chacotes, capacidade, movimentações e indicadores. Escolha um tema, selecione uma pergunta ou escreva livremente. Se faltar contexto, vou pedir apenas o necessário."
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [consultorQuickTopic, setConsultorQuickTopic] = useState<keyof typeof CONSULTOR_QUICK_QUESTIONS>("Operação e Endereçamento");
  const [consultorQuickQuestion, setConsultorQuickQuestion] = useState("");
  const [recommendationQueue, setRecommendationQueue] = useState<string[]>([]);
  const [chatAiLoading, setChatAiLoading] = useState(false);
  type PendingConsultorRequest =
    | {
        kind: "storage";
        sku: string | null;
        quantity: number | null;
        palletCount: number | null;
        cageCount: number | null;
        structure: "2" | "3" | null;
        restriction: Restricao | null;
      }
    | {
        kind: "separation";
        sku: string | null;
        quantity: number | null;
        structure: "2" | "3" | null;
        restriction: Restricao | null;
      }
    | {
        kind: "remontagem";
        sku: string | null;
        quantity: number | null;
        structure: "2" | "3" | null;
        restriction: Restricao | null;
      };

  const [pendingConsultorRequest, setPendingConsultorRequest] =
    useState<PendingConsultorRequest | null>(null);

  const formatMobileSlot = (slot: WarehouseSlot): string =>
    `E${slot.estoque} • M${slot.modulo}${slot.posicao ? ` • ${slot.posicao}` : ""}`;

  const isStandardConsultorSlot = (slot: WarehouseSlot): boolean =>
    slot.galpao !== "12" && (slot.restricao || "nenhuma") === "nenhuma";

  const isStrategicConsultorSlot = (slot: WarehouseSlot): boolean => {
    if (
      slot.saldo <= 0 ||
      !slot.referencia ||
      !isStandardConsultorSlot(slot)
    ) {
      return false;
    }

    if (slot.estoque === "1") {
      const e1CapacityMap = getE1CapacityMap(warehouseLayout);
      return e1CapacityMap[String(Number(slot.modulo))] !== undefined;
    }

    return isPhysicalPositionActive(slot, activePhysicalPositionKeys);
  };

  const cleanConsultorDisplayText = (text: string): string =>
    text
      .replace(/\*\*/g, "")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^\s*[-*]\s+/gm, "• ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const findSkuInChatText = (text: string): string | null => {
    const normalizeReference = (value: string) => {
      const clean = value.trim().toUpperCase();
      return clean.startsWith("S") ? clean.slice(1) : clean;
    };

    const normalizedText = text.trim().toUpperCase();
    const normalizedReferences = productsList.map(product => ({
      reference: product.referencia,
      normalized: normalizeReference(product.referencia),
    }));

    // First, resolve exact SKU/reference tokens. Never use substring matching
    // here because a reference such as "310" is contained in "23101G" and
    // "43101G". The token must match the complete reference.
    const tokens = normalizedText.match(/[A-Z0-9-]+/g) || [];
    for (const token of tokens) {
      const normalizedToken = normalizeReference(token);
      const exactMatch = normalizedReferences.find(
        ({ normalized }) => normalized === normalizedToken
      );
      if (exactMatch) return exactMatch.reference;
    }

    // Accept a complete reference surrounded by non-alphanumeric characters,
    // including references that contain punctuation.
    const byBoundedReference = normalizedReferences.find(({ reference, normalized }) => {
      const candidates = [reference.toUpperCase(), normalized].filter(Boolean);
      return candidates.some(candidate => {
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, "i").test(normalizedText);
      });
    });
    if (byBoundedReference) return byBoundedReference.reference;

    // Description remains a fallback when the user asks using the product name.
    const byDescription = productsList.find(product =>
      product.descricao &&
      normalizedText.includes(product.descricao.trim().toUpperCase())
    );
    if (byDescription) return byDescription.referencia;

    return null;
  };

  const parseConsultorQuantity = (
    text: string,
    allowBareNumber = false
  ): number | null => {
    const combined = text.match(
      /(\d[\d.]*)\s*(?:\+|\/)\s*(\d[\d.]*)\s*(?:pç|pçs|peças|pecas|unidades|un)?/i
    );

    if (combined) {
      const first = Number(combined[1].replace(/\./g, ""));
      const second = Number(combined[2].replace(/\./g, ""));
      const total = first + second;
      return Number.isFinite(total) && total > 0 ? total : null;
    }

    const withUnit = text.match(
      /(\d[\d.]*)\s*(?:pç|pçs|peças|pecas|unidades|un)/i
    );

    if (withUnit) {
      const value = Number(withUnit[1].replace(/\./g, ""));
      return Number.isFinite(value) && value > 0 ? value : null;
    }

    if (allowBareNumber && /^\s*\d[\d.]*\s*$/.test(text)) {
      const value = Number(text.trim().replace(/\./g, ""));
      return Number.isFinite(value) && value > 0 ? value : null;
    }

    return null;
  };

  const parseConsultorStructure = (text: string): "2" | "3" | null => {
    if (/gaiola|aranha|\bE3\b/i.test(text)) return "3";
    if (/palete|\bE2\b/i.test(text)) return "2";
    return null;
  };

  const parseConsultorPalletCount = (text: string): number | null => {
    const match = text.match(/(\d[\d.]*)\s*paletes?/i);
    if (!match) return null;
    const value = Number(match[1].replace(/\./g, ""));
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const parseConsultorCageCount = (text: string): number | null => {
    const match = text.match(/(\d[\d.]*)\s*gaiolas?/i);
    if (!match) return null;
    const value = Number(match[1].replace(/\./g, ""));
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const parseConsultorRestriction = (text: string): Restricao | null => {
    const normalized = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    if (normalized.includes("teste")) return "teste";
    if (normalized.includes("autorizacao")) return "autorizacao";
    if (/(^|\s)outra(\s|$)/.test(normalized) || normalized.includes("outra restricao") || normalized.includes("restricao outra")) {
      return "outra";
    }

    return null;
  };

  type ConsultorDateReference = {
    startDate: string;
    endDate: string;
    label: string;
  };

  const parseConsultorDateReference = (
    value: string
  ): ConsultorDateReference | null => {
    const raw = value.trim();
    if (!raw) return null;

    const now = new Date();
    const currentYear = now.getFullYear();

    const monthNames: Record<string, number> = {
      janeiro: 1,
      fevereiro: 2,
      marco: 3,
      abril: 4,
      maio: 5,
      junho: 6,
      julho: 7,
      agosto: 8,
      setembro: 9,
      outubro: 10,
      novembro: 11,
      dezembro: 12,
    };

    const normalizeMonthName = (month: string) =>
      month
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const buildDayReference = (
      day: number,
      month: number,
      year: number
    ): ConsultorDateReference | null => {
      const date = new Date(year, month - 1, day);

      if (
        !Number.isFinite(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        return null;
      }

      const canonical = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
      return {
        startDate: canonical,
        endDate: canonical,
        label: canonical,
      };
    };

    const buildMonthReference = (
      month: number,
      year: number
    ): ConsultorDateReference | null => {
      if (month < 1 || month > 12 || year < 1900 || year > 2200) return null;

      const lastDay = new Date(year, month, 0).getDate();
      const start = `01/${String(month).padStart(2, "0")}/${year}`;
      const end = `${String(lastDay).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;

      return {
        startDate: start,
        endDate: end,
        label: `${String(month).padStart(2, "0")}/${year}`,
      };
    };

    let match = raw.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/);
    if (match) {
      return buildDayReference(
        Number(match[1]),
        Number(match[2]),
        Number(match[3])
      );
    }

    match = raw.match(/\b(\d{1,2})[\/.\-](\d{4})\b/);
    if (match) {
      return buildMonthReference(Number(match[1]), Number(match[2]));
    }

    const monthPattern =
      /\b(janeiro|fevereiro|mar(?:c|ç)o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de|\s*\/|\s+)?\s*(\d{4})?\b/i;
    match = raw.match(monthPattern);

    if (match) {
      const month = monthNames[normalizeMonthName(match[1])];
      const year = match[2] ? Number(match[2]) : currentYear;
      return month ? buildMonthReference(month, year) : null;
    }

    return null;
  };

  const parseConsultorDateRange = (
    text: string
  ): {
    startDate: string | null;
    endDate: string;
    label: string;
    kind: "cutoff" | "day" | "interval" | "month";
  } | null => {
    const normalized = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const references: ConsultorDateReference[] = [];
    const seen = new Set<string>();
    const acceptedSpans: Array<{ start: number; end: number }> = [];

    const collect = (pattern: RegExp) => {
      for (const match of normalized.matchAll(pattern)) {
        const candidate = match[0];
        const start = match.index ?? 0;
        const end = start + candidate.length;

        // Não interprete partes de uma data completa como uma segunda referência.
        // Ex.: em 01/09/2026, o padrão MM/AAAA também encontraria 09/2026.
        if (acceptedSpans.some(span => start < span.end && end > span.start)) {
          continue;
        }

        const parsed = parseConsultorDateReference(candidate);
        if (!parsed) continue;

        acceptedSpans.push({ start, end });
        const key = `${parsed.startDate}|${parsed.endDate}`;
        if (!seen.has(key)) {
          seen.add(key);
          references.push(parsed);
        }
      }
    };

    collect(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}\b/g);
    collect(/\b\d{1,2}[\/.\-]\d{4}\b/g);
    collect(/\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de|\s*\/|\s+)?\s*\d{4}?\b/g);
    collect(/\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/g);

    if (references.length >= 2) {
      const first = references[0];
      const second = references[1];
      return {
        startDate: first.startDate,
        endDate: second.endDate,
        label: `${first.label} a ${second.label}`,
        kind: "interval",
      };
    }

    if (references.length !== 1) return null;

    const reference = references[0];
    const isMonthReference = reference.startDate !== reference.endDate;
    const explicitlyRequestsCutoff = /\b(ate|antes|anterior)\b/.test(normalized);

    if (isMonthReference && !explicitlyRequestsCutoff) {
      return {
        startDate: reference.startDate,
        endDate: reference.endDate,
        label: reference.label,
        kind: "month",
      };
    }

    // Uma data diária isolada significa aquele dia, não todo o histórico até ele.
    if (!isMonthReference && !explicitlyRequestsCutoff) {
      return {
        startDate: reference.startDate,
        endDate: reference.endDate,
        label: reference.label,
        kind: "day",
      };
    }

    return {
      startDate: null,
      endDate: reference.endDate,
      label: `até ${reference.label}`,
      kind: "cutoff",
    };
  };

  const isChacoteQuantityIntent = (text: string): boolean => {
    const normalized = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const hasQuantityTerm =
      normalized.includes("quantas pecas") ||
      normalized.includes("quantidade") ||
      normalized.includes("saldo") ||
      normalized.includes("pecas") ||
      normalized.includes("estoque");

    const hasDateTerm =
      normalized.includes("chacote") ||
      normalized.includes("data") ||
      normalized.includes("mes") ||
      normalized.includes("ate ") ||
      normalized.includes("entre ") ||
      normalized.includes("de ");

    return hasQuantityTerm && hasDateTerm && parseConsultorDateRange(text) !== null;
  };

  const handleNextRecommendation = () => {
    const next = recommendationQueue[0];
    if (!next) return;
    setRecommendationQueue(prev => prev.slice(1));
    setChatMessages(messages => [...messages, { sender: "system", text: next }]);
  };


  const shouldUseGenerativeConsultor = (message: string): boolean => {
    const normalized = message
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    return (
      normalized.includes("por que") ||
      normalized.includes("porque") ||
      normalized.includes("explique") ||
      normalized.includes("considerando") ||
      normalized.includes("compare") ||
      normalized.includes("analise") ||
      normalized.includes("qual seria") ||
      normalized.includes("faria sentido") ||
      normalized.includes("faz sentido") ||
      normalized.includes("devo") ||
      normalized.includes("sugira") ||
      normalized.includes("estrategia") ||
      normalized.includes("melhor opcao") ||
      normalized.includes("outra opcao") ||
      normalized.includes("o que voce") ||
      normalized.includes("o que você") ||
      /\b(quanto|quantos|quantas|qual|quais|como|resumo|situacao|situação|capacidade|projecao|projeção|rotatividade|risco|riscos)\b/.test(normalized) ||
      normalized.includes("pcp") ||
      normalized.includes("qualidade") ||
      normalized.includes("diretoria") ||
      normalized.includes("executivo")
    );
  };

  const buildConsultorAiContext = (
    question: string,
    deterministicResponse: string
  ): string => {
    const sku = findSkuInChatText(question);
    const normalizedSku = sku?.toUpperCase();
    const strategyAnalysis = sku
      ? buildStrategyAnalysis({
          slots,
          products: productsList,
          sku,
          activePhysicalPositionKeys,
          requestedRestriction: parseConsultorRestriction(question),
        })
      : null;

    const contextRestriction = parseConsultorRestriction(question);

    const relevantSlots = slots
      .filter(slot => {
        const activeForContext =
          slot.estoque === "1"
            ? getE1CapacityMap(warehouseLayout)[String(Number(slot.modulo))] !== undefined
            : isPhysicalPositionActive(slot, activePhysicalPositionKeys);

        if (slot.saldo <= 0 || !slot.referencia || !activeForContext) {
          return false;
        }

        if (
          normalizedSku &&
          slot.referencia.toUpperCase() !== normalizedSku
        ) {
          return false;
        }

        return contextRestriction
          ? (slot.galpao === "12"
              ? "autorizacao"
              : (slot.restricao || "nenhuma")) === contextRestriction
          : isStandardConsultorSlot(slot);
      })
      .slice(0, normalizedSku ? 20 : 12)
      .map(slot => ({
        estoque: slot.estoque,
        modulo: slot.modulo,
        posicao: slot.posicao,
        referencia: slot.referencia,
        descricao: slot.descricao,
        saldo: slot.saldo,
        dataChacote: slot.dataChacote || null,
        galpao: slot.galpao || "3",
        restricao: slot.galpao === "12" ? "autorizacao" : (slot.restricao || "nenhuma"),
        observacao: slot.observacao || "",
      }));

    const relevantProduct = sku
      ? productsList.find(
          product => product.referencia.toUpperCase() === normalizedSku
        )
      : null;

    const openDivergencias = divergencias
      .filter(item =>
        item.status === "Aberta" &&
        (!normalizedSku ||
          item.refAtual?.toUpperCase() === normalizedSku ||
          item.refNova?.toUpperCase() === normalizedSku)
      )
      .slice(0, 10)
      .map(item => ({
        tipo: item.tipoDivergencia,
        estoque: item.estoque,
        modulo: item.modulo,
        posicao: item.posicao,
        refAtual: item.refAtual,
        refNova: item.refNova,
        saldoAntes: item.saldoAntes,
        movimentacao: item.movimentacao,
        saldoFinal: item.saldoFinal,
      }));

    const activeSlots = slots.filter(isStrategicConsultorSlot);
    const activePhysicalSlots = activeSlots.filter(
      slot => slot.estoque === "2" || slot.estoque === "3"
    );
    const activeE1Slots = activeSlots.filter(slot => slot.estoque === "1");

    const strategicQuantity = activeSlots.reduce((sum, slot) => sum + slot.saldo, 0);
    const strategicE1Quantity = activeE1Slots.reduce((sum, slot) => sum + slot.saldo, 0);
    const strategicE1Pallets = activeE1Slots.reduce((sum, slot) => {
      const product = productsList.find(
        item => item.referencia.toUpperCase() === slot.referencia.toUpperCase()
      );
      return sum + (
        product?.paletizacao
          ? calcularPaletes(slot.saldo, product.paletizacao)
          : 0
      );
    }, 0);

    const strategicReferences = new Set<string>(
      activeSlots.map(slot => slot.referencia.trim().toUpperCase())
    );

    const occupiedAddresses = new Set(
      activePhysicalSlots.map(
        slot =>
          `${slot.estoque}-${Number(slot.modulo)}-${String(slot.posicao || "")
            .trim()
            .toUpperCase()}`
      )
    );

    const totalPhysicalPositions =
      activePhysicalPositionKeys["2"].size +
      activePhysicalPositionKeys["3"].size;

    const occupiedPhysicalPositions = occupiedAddresses.size;
    const freePhysicalPositions = Math.max(
      0,
      totalPhysicalPositions - occupiedPhysicalPositions
    );

    const occupationPercent =
      totalPhysicalPositions > 0
        ? (occupiedPhysicalPositions / totalPhysicalPositions) * 100
        : 0;

    const e1CapacityTotal = getE1TotalCapacity(warehouseLayout);
    const e1OccupationPercent =
      e1CapacityTotal > 0
        ? (strategicE1Pallets / e1CapacityTotal) * 100
        : 0;

    const totalStorageUnits =
      strategicE1Pallets + occupiedPhysicalPositions;
    const totalStorageCapacity =
      e1CapacityTotal + totalPhysicalPositions;
    const totalStorageOccupationPercent =
      totalStorageCapacity > 0
        ? (totalStorageUnits / totalStorageCapacity) * 100
        : 0;

    const todayTimestamp = parseChacoteDate(getTodayIsoDate()) ?? Date.now();
    const movementToday = history.filter(item => {
      const timestamp = parseChacoteDate(item.data);
      return timestamp !== null && timestamp === todayTimestamp;
    }).length;

    const movementNet = history.reduce((sum, item) => {
      const quantity = Number(item.quantidade) || 0;
      return sum + (item.tipo === "Saída" ? -quantity : quantity);
    }, 0);

    const movementGross = history.reduce(
      (sum, item) => sum + Math.abs(Number(item.quantidade) || 0),
      0
    );

    const movementTimestamps = history
      .map(item => parseChacoteDate(item.data))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);

    const movementPeriodDays =
      movementTimestamps.length >= 2
        ? Math.max(
            1,
            Math.floor(
              (movementTimestamps[movementTimestamps.length - 1] -
                movementTimestamps[0]) /
                (1000 * 60 * 60 * 24)
            ) + 1
          )
        : 1;

    const latestMovementBySku = new Map<string, number>();

    history.forEach(item => {
      const referencia = item.referencia?.trim().toUpperCase();
      const timestamp = parseChacoteDate(item.data);

      if (!referencia || timestamp === null) return;

      const previous = latestMovementBySku.get(referencia);
      if (previous === undefined || timestamp > previous) {
        latestMovementBySku.set(referencia, timestamp);
      }
    });

    const occupiedByStock = ["1", "2", "3"].map(estoque => {
      if (estoque === "1") {
        return {
          estoque: "E1",
          ocupadas: strategicE1Pallets,
          livres: Math.max(0, e1CapacityTotal - strategicE1Pallets),
          total: e1CapacityTotal,
          unidade: "paletes",
        };
      }

      const addresses = new Set(
        activePhysicalSlots
          .filter(slot => slot.estoque === estoque)
          .map(
            slot =>
              `${slot.estoque}-${Number(slot.modulo)}-${String(slot.posicao || "")
                .trim()
                .toUpperCase()}`
          )
      );

      const total = activePhysicalPositionKeys[estoque as "2" | "3"].size;

      return {
        estoque: `E${estoque}`,
        ocupadas: addresses.size,
        livres: Math.max(0, total - addresses.size),
        total,
        unidade: "posições",
      };
    });

    const topStock = [...activeSlots.reduce(
      (map, slot) => {
        const key = slot.referencia.trim().toUpperCase();
        const current = map.get(key) || {
          referencia: key,
          descricao: slot.descricao,
          saldo: 0,
        };
        current.saldo += slot.saldo;
        map.set(key, current);
        return map;
      },
      new Map<string, { referencia: string; descricao: string; saldo: number }>()
    ).values()]
      .sort((a, b) => b.saldo - a.saldo)
      .slice(0, 10);

    const skusSemMovimento7Dias = [...strategicReferences].filter(referencia => {
      const movementTime = latestMovementBySku.get(referencia);
      return movementTime === undefined ||
        todayTimestamp - movementTime > 7 * 24 * 60 * 60 * 1000;
    }).length;
    const skusSemMovimento30Dias = [...strategicReferences].filter(referencia => {
      const movementTime = latestMovementBySku.get(referencia);
      return movementTime === undefined ||
        todayTimestamp - movementTime > 30 * 24 * 60 * 60 * 1000;
    }).length;

    const attentionPoints: string[] = [];
    const openDivergenciasCount = divergencias.filter(
      item => item.status === "Aberta"
    ).length;

    if (openDivergenciasCount > 0) {
      attentionPoints.push(`${openDivergenciasCount} divergência(s) em aberto`);
    }
    if (skusSemMovimento30Dias > 0) {
      attentionPoints.push(
        `${skusSemMovimento30Dias} SKU(s) sem movimentação há mais de 30 dias`
      );
    }
    if (occupationPercent >= 95) {
      attentionPoints.push(
        `ocupação física E2/E3 em nível de saturação (${occupationPercent.toFixed(1)}%)`
      );
    } else if (occupationPercent >= 85) {
      attentionPoints.push(
        `ocupação física E2/E3 acima de 85% (${occupationPercent.toFixed(1)}%)`
      );
    }
    if (e1OccupationPercent >= 95) {
      attentionPoints.push(
        `ocupação do E1 em nível de saturação (${e1OccupationPercent.toFixed(1)}%)`
      );
    } else if (e1OccupationPercent >= 85) {
      attentionPoints.push(
        `ocupação do E1 acima de 85% (${e1OccupationPercent.toFixed(1)}%)`
      );
    }

    const departmentLens =
      /qualidade/i.test(question)
        ? "Qualidade: priorizar rastreabilidade por chacote, quantidades por período, saldos sem data e identificação de lotes."
        : /pcp/i.test(question)
          ? "PCP: priorizar saldo, SKUs ativos, capacidade física, rotatividade, tendência de movimentação e projeções explicitamente qualificadas."
          : /diretoria|diretor/i.test(question)
            ? "Diretoria: responder em visão executiva, com volume, ocupação, tendência, riscos e principais exceções."
            : "Visão operacional geral: responder com dados objetivos e indicar o impacto operacional quando houver evidência.";

    const strategicContext = {
      visaoGeral: {
        saldoTotalPecas: strategicQuantity,
        skusAtivos: strategicReferences.size,
        posicoesFisicasOcupadas: occupiedPhysicalPositions,
        posicoesFisicasLivres: freePhysicalPositions,
        ocupacaoFisicaPercentual: Number(occupationPercent.toFixed(2)),
        divergenciasAbertas: divergencias.filter(item => item.status === "Aberta").length,
        ocupacaoPorEstoque: occupiedByStock,
        skusSemMovimento7Dias,
        skusSemMovimento30Dias,
        saldoE1Pecas: strategicE1Quantity,
        paletesE1Ocupados: strategicE1Pallets,
        capacidadeE1Paletes: e1CapacityTotal,
        ocupacaoE1Percentual: Number(e1OccupationPercent.toFixed(2)),
        ocupacaoFisicaE2E3Percentual: Number(occupationPercent.toFixed(2)),
        unidadesArmazenamentoOcupadas: totalStorageUnits,
        unidadesArmazenamentoCapacidade: totalStorageCapacity,
        ocupacaoConsolidadaPercentual: Number(totalStorageOccupationPercent.toFixed(2)),
        pontosAtencao: attentionPoints,
      },
      movimentacoesPeriodoCarregado: {
        registros: history.length,
        movimentacaoBrutaPecas: movementGross,
        movimentacaoLiquidaPecas: movementNet,
        periodoEmDias: movementPeriodDays,
        mediaLiquidaPorDia: Number((movementNet / movementPeriodDays).toFixed(2)),
        projecaoSaldo30Dias: Math.max(
          0,
          strategicQuantity + (movementNet / movementPeriodDays) * 30
        ),
        movimentacoesHoje: movementToday,
        observacao: "A projeção de estoque, quando solicitada, é uma extrapolação simples do ritmo líquido do histórico carregado; não representa previsão de vendas ou produção.",
      },
      rankingSaldo: topStock,
      departamento: departmentLens,
      visaoExecutiva: {
        saldoTotalPecas: strategicQuantity,
        skusAtivos: strategicReferences.size,
        ocupacaoConsolidadaPercentual: Number(totalStorageOccupationPercent.toFixed(2)),
        ocupacaoFisicaE2E3Percentual: Number(occupationPercent.toFixed(2)),
        ocupacaoE1Percentual: Number(e1OccupationPercent.toFixed(2)),
        movimentacaoLiquidaNoPeriodo: movementNet,
        mediaLiquidaPorDia: Number((movementNet / movementPeriodDays).toFixed(2)),
        skusSemMovimento30Dias,
        divergenciasAbertas: openDivergenciasCount,
        principaisPontosAtencao: attentionPoints,
      },
      regraDeUnidade: "E1 é medido por paletes ocupados/capacidade; E2 e E3 por posições físicas. O saldo total em peças inclui E1, E2 e E3.",
    };

    const broadStrategicQuestion =
      !normalizedSku &&
      /(situacao|situação|capacidade|tendencia|tendência|resumo|executivo|risco|riscos|atencao|atenção|estoque hoje|pcp|diretoria)/i.test(
        question
      );

    return JSON.stringify(
      {
        pergunta: question,
        contextoEstrategico: strategicContext,
        visaoExecutiva: strategicContext.visaoExecutiva,
        resultadoDeterministico: deterministicResponse,
        produto: relevantProduct
          ? {
              referencia: relevantProduct.referencia,
              descricao: relevantProduct.descricao,
              paletizacao: relevantProduct.paletizacao ?? null,
            }
          : null,
        posicoesRelevantes: broadStrategicQuestion ? [] : relevantSlots.slice(0, 12),
        divergenciasAbertasRelevantes: openDivergencias.slice(0, 8),
        analiseEstrategica: strategyAnalysis,
        observacao:
          "O saldo total de peças inclui E1, E2 e E3. E1 é medido em paletes; E2/E3 em posições físicas. A IA deve explicar os dados, não inventar posições.",
      },
      null,
      2
    ).slice(0, 12000);
  };

  const requestGenerativeConsultor = async (
    question: string,
    deterministicResponse: string
  ): Promise<string | null> => {
    setChatAiLoading(true);

    try {
      const context = buildConsultorAiContext(question, deterministicResponse);

      const { data, error } = await supabase.functions.invoke("consultor-ai", {
        body: {
          question,
          deterministicResponse,
          context,
        },
      });

      if (error) {
        console.error("Erro ao consultar a IA do Consultor:", error);
        return null;
      }

      const answer =
        typeof data?.answer === "string" ? data.answer.trim() : "";

      return answer || null;
    } catch (error) {
      console.error("Falha inesperada ao consultar a IA do Consultor:", error);
      return null;
    } finally {
      setChatAiLoading(false);
    }
  };

  const handleExportConsultorExecutivePdf = async (text: string) => {
    if (!(await requestReportExportPermission(["consultor.use"]))) return;
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;
    let y = 20;

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 34, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("PORTO BRASIL", margin, 15);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("CELSO • RESUMO EXECUTIVO DO ESTOQUE", margin, 23);
    doc.text(
      `Gerado em ${new Date().toLocaleString("pt-BR")}`,
      margin,
      29
    );

    y = 45;
    doc.setTextColor(30, 41, 59);

    const lines = text
      .replace(/\r/g, "")
      .split("\n")
      .map(line => line.trimEnd());

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        y += 3;
        continue;
      }

      if (y > pageHeight - 24) {
        doc.addPage();
        y = 18;
      }

      const isHeading =
        trimmed === trimmed.toUpperCase() &&
        trimmed.length >= 4 &&
        !trimmed.startsWith("•");

      doc.setFont("helvetica", isHeading ? "bold" : "normal");
      doc.setFontSize(isHeading ? 10.5 : 9.5);

      const wrapped = doc.splitTextToSize(
        trimmed,
        pageWidth - margin * 2
      );

      doc.text(wrapped, margin, y);
      y += wrapped.length * (isHeading ? 5.5 : 4.8);

      if (isHeading) y += 1.5;
    }

    const totalPages = doc.getNumberOfPages();
    for (let page = 1; page <= totalPages; page += 1) {
      doc.setPage(page);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Celso • Estoque de Chacote • Página ${page}/${totalPages}`,
        margin,
        pageHeight - 10
      );
    }

    doc.save(`celso_resumo_executivo_${getTodayIsoDate()}.pdf`);
  };

  const handleSendChatMessage = async (messageOverride?: string) => {
    let userMessage = (
      typeof messageOverride === "string" ? messageOverride : chatInput
    ).trim();

    if (!userMessage) return;

    setChatMessages(prev => [...prev, { sender: "user", text: userMessage }]);
    setChatInput("");

    let responseText = "";

    const isStorageIntent =
      userMessage.toLowerCase().includes("onde armazenar") ||
      userMessage.toLowerCase().includes("onde devo armazenar") ||
      userMessage.toLowerCase().includes("armazenar") ||
      userMessage.toLowerCase().includes("melhor posição") ||
      userMessage.toLowerCase().includes("melhor posicao") ||
      userMessage.toLowerCase().includes("melhor local");

    const isSeparationIntent =
      userMessage.toLowerCase().includes("onde separar") ||
      userMessage.toLowerCase().includes("melhor palete") ||
      userMessage.toLowerCase().includes("separação") ||
      userMessage.toLowerCase().includes("separacao");

    const isRemontagemIntent =
      userMessage.toLowerCase().includes("remont") ||
      userMessage.toLowerCase().includes("consolidar") ||
      userMessage.toLowerCase().includes("liberar posição") ||
      userMessage.toLowerCase().includes("liberar posicao");

    if (
      pendingConsultorRequest &&
      !isStorageIntent &&
      !isSeparationIntent &&
      !isRemontagemIntent
    ) {
      const parsedSku = findSkuInChatText(userMessage);
      const parsedQuantity = parseConsultorQuantity(userMessage, true);
      const parsedStructure = parseConsultorStructure(userMessage);
      const parsedRestriction = parseConsultorRestriction(userMessage);
      const parsedPalletCount = parseConsultorPalletCount(userMessage);
      const parsedCageCount = parseConsultorCageCount(userMessage);

      const nextPending =
        pendingConsultorRequest.kind === "storage"
          ? {
              kind: "storage" as const,
              sku: parsedSku || pendingConsultorRequest.sku,
              quantity: parsedQuantity ?? pendingConsultorRequest.quantity,
              palletCount:
                parsedPalletCount ?? pendingConsultorRequest.palletCount,
              cageCount:
                parsedCageCount ?? pendingConsultorRequest.cageCount,
              structure:
                parsedStructure ?? pendingConsultorRequest.structure,
              restriction:
                parsedRestriction ?? pendingConsultorRequest.restriction,
            }
          : pendingConsultorRequest.kind === "separation"
            ? {
                kind: "separation" as const,
                sku: parsedSku || pendingConsultorRequest.sku,
                quantity: parsedQuantity ?? pendingConsultorRequest.quantity,
                structure:
                  parsedStructure ?? pendingConsultorRequest.structure,
                restriction:
                  parsedRestriction ?? pendingConsultorRequest.restriction,
              }
            : {
                kind: "remontagem" as const,
                sku: parsedSku || pendingConsultorRequest.sku,
                quantity: parsedQuantity ?? pendingConsultorRequest.quantity,
                structure:
                  parsedStructure ?? pendingConsultorRequest.structure,
                restriction:
                  parsedRestriction ?? pendingConsultorRequest.restriction,
              };

      if (nextPending.kind === "storage") {
        if (!nextPending.sku) {
          setPendingConsultorRequest(nextPending);
          responseText =
            "Informe o SKU ou a descrição do produto que deseja armazenar.";
        } else if (
          !nextPending.quantity &&
          !nextPending.palletCount &&
          !nextPending.cageCount
        ) {
          setPendingConsultorRequest(nextPending);
          responseText =
            "Informe a quantidade em peças, paletes ou gaiolas que deseja armazenar.";
        } else if (!nextPending.structure) {
          setPendingConsultorRequest(nextPending);
          responseText =
            "Informe se o armazenamento será em palete (E2) ou gaiola (E3).";
        } else {
          userMessage = nextPending.cageCount
            ? `Onde devo armazenar ${nextPending.cageCount} gaiolas do SKU ${nextPending.sku} em gaiola (E3)`
            : nextPending.palletCount
              ? `Onde devo armazenar ${nextPending.palletCount} paletes do SKU ${nextPending.sku} ${
                  nextPending.structure === "2" ? "no palete (E2)" : "em gaiola (E3)"
                }`
              : `Onde devo armazenar ${nextPending.quantity} peças do SKU ` +
                `${nextPending.sku} no ${
                  nextPending.structure === "2" ? "palete (E2)" : "gaiola (E3)"
                }`;

          if (nextPending.restriction) {
            userMessage += ` com restrição ${nextPending.restriction}`;
          }

          setPendingConsultorRequest(null);
        }
      } else if (nextPending.kind === "separation") {
        if (!nextPending.sku) {
          setPendingConsultorRequest(nextPending);
          responseText =
            "Informe o SKU ou a descrição do produto que deseja separar.";
        } else if (!nextPending.quantity) {
          setPendingConsultorRequest(nextPending);
          responseText = "Informe a quantidade que deseja separar.";
        } else {
          userMessage =
            `Onde separar ${nextPending.quantity} peças do SKU ${nextPending.sku}` +
            (nextPending.structure === "2"
              ? " em palete (E2)"
              : nextPending.structure === "3"
                ? " em gaiola (E3)"
                : "") +
            (nextPending.restriction
              ? ` com restrição ${nextPending.restriction}`
              : "");
          setPendingConsultorRequest(null);
        }
      } else if (!nextPending.sku) {
        setPendingConsultorRequest(nextPending);
        responseText =
          "Informe o SKU ou a descrição do produto que deseja remontar.";
      } else if (!nextPending.quantity) {
        setPendingConsultorRequest(nextPending);
        responseText =
          "Informe a quantidade em peças que deseja remontar.";
      } else {
        userMessage =
          `Onde remontar ${nextPending.quantity} peças do SKU ${nextPending.sku}` +
          (nextPending.structure === "2"
            ? " em palete (E2)"
            : nextPending.structure === "3"
              ? " em gaiola (E3)"
              : "") +
          (nextPending.restriction
            ? ` com restrição ${nextPending.restriction}`
            : "");
        setPendingConsultorRequest(null);
      }

      if (responseText) {
        setChatMessages(prev => [
          ...prev,
          { sender: "system", text: responseText },
        ]);
        return;
      }
    }

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
        isChacoteQuantityIntent(userMessage) ||
        /\b(quantas|quantidade|saldo|estoque)\b/i.test(userMessage)
      ) {
        const quantitySku = findSkuInChatText(userMessage);
        const dateRange = parseConsultorDateRange(userMessage);

        if (!quantitySku && dateRange) {
          responseText =
            "Informe o SKU ou a descrição do produto para eu calcular a quantidade por data de chacote.";
        } else if (quantitySku && !dateRange) {
          responseText =
            "Entendi a consulta de quantidade do SKU, mas preciso do período. Você pode informar uma data (31/08/2026), mês (08/2026 ou agosto/2026), ou intervalo (01/07/2026 a 31/07/2026).";
        } else if (quantitySku && dateRange) {
          const analysis = buildChacoteQuantityAnalysis({
            slots,
            products: productsList,
            sku: quantitySku,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
          });

          const periodLine =
            dateRange.kind === "cutoff"
              ? `Com data de chacote até ${analysis.endDate}: ${analysis.datedInPeriod.toLocaleString("pt-BR")} pçs`
              : `Com data de chacote no período ${analysis.periodLabel}: ${analysis.datedInPeriod.toLocaleString("pt-BR")} pçs`;

          const totalLine =
            dateRange.kind === "cutoff"
              ? `TOTAL CONSIDERADO: ${analysis.totalEligible.toLocaleString("pt-BR")} pçs`
              : `TOTAL NO PERÍODO: ${analysis.totalEligible.toLocaleString("pt-BR")} pçs`;

          responseText =
            `QUANTIDADE POR DATA DE CHACOTE • ${analysis.sku}\n` +
            `${analysis.descricao}\n\n` +
            `Período: ${analysis.periodLabel}\n` +
            `Sem data de chacote: ${analysis.withoutChacoteDate.toLocaleString("pt-BR")} pçs` +
            (dateRange.kind === "cutoff"
              ? " • incluído no total considerado"
              : " • não atribuível ao período") +
            `\n` +
            `${periodLine}\n` +
            `${totalLine}\n\n` +
            `Estoque atual total do SKU: ${analysis.totalCurrent.toLocaleString("pt-BR")} pçs\n` +
            `Critério: saldo sem data é separado; saldos com data são considerados somente quando pertencem ao período solicitado.`;
        }
      } else if (
        lower.includes("estratégia") ||
        lower.includes("estrategia") ||
        lower.includes("organizar este sku") ||
        lower.includes("organizar o sku")
      ) {
        const strategySku = findSkuInChatText(userMessage);

        if (!strategySku) {
          responseText =
            "Informe o SKU ou a descrição do produto para eu analisar a estratégia de armazenagem.";
        } else {
          const analysis = buildStrategyAnalysis({
            slots,
            products: productsList,
            sku: strategySku,
            activePhysicalPositionKeys,
            requestedRestriction: parseConsultorRestriction(userMessage),
          });

          if (analysis.totalSaldo <= 0) {
            responseText =
              `Não encontrei saldo atual do SKU ${strategySku} para montar uma estratégia baseada no estoque real.`;
          } else {
            const topModules = analysis.modules
              .slice(0, 5)
              .map(
                item =>
                  `• M${item.modulo}: ${item.saldo.toLocaleString("pt-BR")} pçs ` +
                  `(${(item.participacao * 100).toFixed(1)}% do saldo)`
              )
              .join("\n");

            const nearby = analysis.nearbyModules.length
              ? analysis.nearbyModules.map(module => `M${module}`).join(" → ")
              : "não identificado";

            responseText =
              `ESTRATÉGIA DE ESTOQUE • ${analysis.sku}\n` +
              `${analysis.descricao}\n\n` +
              `Saldo elegível: ${analysis.totalSaldo.toLocaleString("pt-BR")} pçs\n` +
              `Paletes estimados: ${analysis.totalPaletes.toLocaleString("pt-BR")}\n` +
              `Posições ocupadas pelo SKU: ${analysis.totalPosicoes}\n` +
              `Módulos envolvidos: ${analysis.totalModulos}\n` +
              `Capacidade teórica dessas posições: ${analysis.capacidadeTotal.toLocaleString("pt-BR")} pçs\n` +
              `Ocupação média: ${analysis.ocupacaoPercentual.toFixed(1)}%\n` +
              (analysis.restrictedSaldo > 0
                ? `Saldo fora da regra padrão (restrito): ${analysis.restrictedSaldo.toLocaleString("pt-BR")} pçs\n`
                : "") +
              `\nCONCENTRAÇÃO ATUAL\n${topModules || "Nenhuma posição física elegível encontrada."}\n\n` +
              `CENTRO DE CONCENTRAÇÃO: ${
                analysis.concentrationModule !== null
                  ? `M${analysis.concentrationModule}`
                  : "não identificado"
              }\n` +
              `PROXIMIDADE: ${nearby}\n\n` +
              `ORIENTAÇÃO DE ORGANIZAÇÃO\n` +
              `1. A estratégia analisa somente posições já ocupadas pelo mesmo SKU.\n` +
              `2. Não indica vaga vazia como destino.\n` +
              `3. Prioriza a concentração no módulo com maior saldo.\n` +
              `4. Depois considera módulos fisicamente próximos para reduzir dispersão.\n` +
              `5. Considera capacidade, ocupação e restrições antes de sugerir uma consolidação.\n\n` +
              `DIFERENÇA PARA REMONTAGEM\n` +
              `A estratégia define onde concentrar e como organizar o SKU; a remontagem calcula quanto de uma quantidade informada pode ser absorvido por posições já ocupadas.`;
          }
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
          setPendingConsultorRequest({
            kind: "storage",
            sku: null,
            quantity: parseConsultorQuantity(userMessage),
            palletCount: parseConsultorPalletCount(userMessage),
            cageCount: parseConsultorCageCount(userMessage),
            structure: parseConsultorStructure(userMessage),
            restriction: parseConsultorRestriction(userMessage),
          });
          responseText =
            "Informe o SKU ou a descrição do produto para eu calcular o melhor plano de armazenamento.";
        } else {
          const requestedQty = parseConsultorQuantity(userMessage);
          const requestedPalletCount = parseConsultorPalletCount(userMessage);
          const requestedCageCount = parseConsultorCageCount(userMessage);
          const requestedType = parseConsultorStructure(userMessage);
          const requestedRestriction = parseConsultorRestriction(userMessage);

          if (!requestedQty && !requestedPalletCount && !requestedCageCount) {
            setPendingConsultorRequest({
              kind: "storage",
              sku: skuRecommendation,
              quantity: null,
              palletCount: null,
              cageCount: null,
              structure: requestedType,
              restriction: requestedRestriction,
            });
            responseText =
              "Informe a quantidade em peças, paletes ou gaiolas que deseja armazenar.";
          } else if (!requestedType) {
            setPendingConsultorRequest({
              kind: "storage",
              sku: skuRecommendation,
              quantity: requestedQty,
              palletCount: requestedPalletCount,
              cageCount: requestedCageCount,
              structure: null,
              restriction: requestedRestriction,
            });
            responseText =
              "Informe se o armazenamento será em palete (E2) ou gaiola (E3).";
          } else {
            setPendingConsultorRequest(null);

            const result = buildStoragePlans({
              slots,
              products: productsList,
              sku: skuRecommendation,
              requestedQty,
              requestedPalletCount,
              requestedCageCount,
              structure: requestedType,
              activePhysicalPositionKeys,
              requestedRestriction,
            });

            const product = productsList.find(
              item => item.referencia.toUpperCase() === skuRecommendation.toUpperCase()
            );
            const capacity = result.capacity;

            if (!capacity) {
              responseText =
                `O SKU ${skuRecommendation} não possui paletização cadastrada. ` +
                "Sem esse dado não consigo calcular um plano físico confiável.";
            } else if (result.plans.length === 0) {
              const unitLabel =
                requestedType === "3"
                  ? "gaiola(s)"
                  : "posição(ões) de palete";
              const required =
                requestedType === "3"
                  ? result.requiredCages
                  : result.requiredPallets;

              responseText =
                `Não encontrei um plano físico completo para ${skuRecommendation}.

` +
                `Necessidade calculada: ${required.toLocaleString("pt-BR")} ${unitLabel}.
` +
                "Considerei somente posições físicas ativas, livres, sem ocupação física " +
                "de outro registro e, para gaiolas, somente pares A+B, C+D ou E+F.";
            } else {
              const plan = result.plans[0];
              const allocationById = new Map(
                plan.allocations.map(item => [item.slot.id, item.quantity])
              );

              const needText = requestedQty
                ? `${requestedQty.toLocaleString("pt-BR")} peças`
                : requestedPalletCount
                  ? `${requestedPalletCount.toLocaleString("pt-BR")} paletes`
                  : `${requestedCageCount?.toLocaleString("pt-BR") || result.requiredCages} gaiolas`;

              const reason =
                result.concentrationModule !== null
                  ? `prioriza a concentração atual do SKU no M${result.concentrationModule} e reduz a dispersão`
                  : "prioriza posições físicas ativas e livres com menor dispersão";

              if (requestedType === "3") {
                responseText =
                  `PLANO DE ARMAZENAMENTO • ${skuRecommendation}\n` +
                  `${product?.descricao || ""}\n\n` +
                  `Necessidade informada: ${needText}\n` +
                  `Paletização: ${capacity.toLocaleString("pt-BR")} pçs/palete\n` +
                  `Necessidade física: ${result.requiredPallets.toLocaleString("pt-BR")} palete(s) → ` +
                  `${result.requiredCages.toLocaleString("pt-BR")} gaiola(s)\n\n` +
                  `PLANO RECOMENDADO\n` +
                  plan.cages
                    .map((cage, index) =>
                      [
                        `Gaiola ${index + 1} • ${cage.key} • M${cage.module}`,
                        `• ${formatMobileSlot(cage.first)} → ${(allocationById.get(cage.first.id) || 0).toLocaleString("pt-BR")} pçs`,
                        `• ${formatMobileSlot(cage.second)} → ${(allocationById.get(cage.second.id) || 0).toLocaleString("pt-BR")} pçs`,
                      ].join("\n")
                    )
                    .join("\n\n") +
                  `\n\nMotivo: ${reason}.\n\n` +
                  `RESERVA\n` +
                  (plan.reserveCages[0]
                    ? `${plan.reserveCages[0].key} • M${plan.reserveCages[0].module} • ` +
                      `${formatMobileSlot(plan.reserveCages[0].first)} + ${formatMobileSlot(plan.reserveCages[0].second)}`
                    : "Nenhuma gaiola reserva disponível.");
              } else {
                responseText =
                  `PLANO DE ARMAZENAMENTO • ${skuRecommendation}\n` +
                  `${product?.descricao || ""}\n\n` +
                  `Necessidade informada: ${needText}\n` +
                  `Paletização: ${capacity.toLocaleString("pt-BR")} pçs/palete\n` +
                  `Posições necessárias: ${result.requiredPallets.toLocaleString("pt-BR")}\n\n` +
                  `PLANO RECOMENDADO\n` +
                  plan.allocations
                    .map(
                      (allocation, index) =>
                        `${index + 1}. ${formatMobileSlot(allocation.slot)} → ${allocation.quantity.toLocaleString("pt-BR")} pçs`
                    )
                    .join("\n") +
                  `\n\nMotivo: ${reason}.\n\n` +
                  `POSIÇÃO RESERVA\n` +
                  (plan.reserveSlots[0]
                    ? formatMobileSlot(plan.reserveSlots[0])
                    : "Nenhuma posição reserva disponível.");
              }
            }
          }
        }
      } else if (
        lower.includes("melhor palete") ||
        lower.includes("melhor palete para separ") ||
        lower.includes("qual palete") ||
        lower.includes("onde separar") ||
        lower.includes("separação") ||
        lower.includes("separacao")
      ) {
        const skuRecommendation = findSkuInChatText(userMessage);
        const requestedStructure = parseConsultorStructure(userMessage);
        const requestedRestriction = parseConsultorRestriction(userMessage);

        if (!skuRecommendation) {
          setPendingConsultorRequest({
            kind: "separation",
            sku: null,
            quantity: parseConsultorQuantity(userMessage),
            structure: requestedStructure,
            restriction: requestedRestriction,
          });
          responseText =
            "Informe o SKU ou a descrição do produto para eu montar a separação.";
        } else {
          const requestedQty = parseConsultorQuantity(userMessage);

          if (!requestedQty || requestedQty <= 0) {
            setPendingConsultorRequest({
              kind: "separation",
              sku: skuRecommendation,
              quantity: null,
              structure: requestedStructure,
              restriction: requestedRestriction,
            });
            responseText =
              "Informe a quantidade que deseja separar, por exemplo: 300 peças.";
          } else {
            setPendingConsultorRequest(null);

            const separation = buildSeparationPlan({
              slots,
              sku: skuRecommendation,
              requestedQty,
              activePhysicalPositionKeys,
              requestedRestriction,
              requestedStructure,
            });

            if (separation.plan.length === 0) {
              responseText =
                `Não encontrei saldo disponível e elegível do SKU ${skuRecommendation} para a separação.`;
            } else {
              const planText = separation.plan
                .map(
                  (item, index) =>
                    `${index + 1}. ${formatMobileSlot(item.slot)} → ${item.quantity.toLocaleString("pt-BR")} pçs` +
                    `\n   Saldo antes: ${item.slot.saldo.toLocaleString("pt-BR")} pçs` +
                    `\n   Chacote: ${item.slot.dataChacote || "sem data"}` +
                    `\n   Tipo: ${item.structure === "3" ? "Gaiola (E3)" : "Palete (E2)"}`
                )
                .join("\n\n");

              const restrictionText = requestedRestriction
                ? `Restrição solicitada: ${requestedRestriction}`
                : "Restrição: somente nenhuma";

              responseText =
                `PLANO DE SEPARAÇÃO • ${skuRecommendation}\n\n` +
                `Solicitado: ${requestedQty.toLocaleString("pt-BR")} pçs\n` +
                `Disponível elegível: ${separation.totalAvailable.toLocaleString("pt-BR")} pçs\n` +
                `${restrictionText}\n\n` +
                `ROTEIRO OPERACIONAL\n${planText}\n\n` +
                (separation.complete
                  ? "Resultado: quantidade totalmente atendida."
                  : `Atenção: faltam ${separation.remaining.toLocaleString("pt-BR")} pçs.`) +
                "\n\nCritério de seleção: sem data primeiro, depois chacote mais antigo e menor saldo. " +
                "O roteiro acima foi ordenado fisicamente por estoque, módulo e posição para reduzir deslocamento.";

              setRecommendationQueue([]);
            }
          }
        }

      } else if (
        lower.includes("remont") ||
        lower.includes("consolidar") ||
        lower.includes("liberar posição") ||
        lower.includes("liberar posicao")
      ) {
        const requestedSku = findSkuInChatText(userMessage);
        const requestedQty = parseConsultorQuantity(userMessage);
        const requestedStructure = parseConsultorStructure(userMessage);
        const requestedRestriction = parseConsultorRestriction(userMessage);

        if (!requestedSku) {
          setPendingConsultorRequest({
            kind: "remontagem",
            sku: null,
            quantity: requestedQty,
            structure: requestedStructure,
            restriction: requestedRestriction,
          });
          responseText =
            "Informe o SKU ou a descrição do produto que deseja remontar.";
        } else if (!requestedQty || requestedQty <= 0) {
          setPendingConsultorRequest({
            kind: "remontagem",
            sku: requestedSku,
            quantity: null,
            structure: requestedStructure,
            restriction: requestedRestriction,
          });
          responseText =
            "Informe a quantidade em peças que deseja remontar.";
        } else {
          setPendingConsultorRequest(null);

          const remontagem = buildRemontagemPlan({
            slots,
            products: productsList,
            sku: requestedSku,
            requestedQty,
            activePhysicalPositionKeys,
            requestedRestriction,
            requestedStructure,
          });

          if (remontagem.capacity <= 0) {
            responseText =
              `O SKU ${requestedSku} não possui paletização cadastrada. ` +
              "Sem esse dado não consigo calcular a capacidade livre das posições.";
          } else if (remontagem.allocations.length === 0) {
            responseText =
              `Não encontrei uma posição ocupada pelo SKU ${requestedSku} que tenha capacidade livre para absorver ${requestedQty.toLocaleString("pt-BR")} pçs.\n\n` +
              "A remontagem não utiliza posição vazia; ela somente considera posições já ocupadas pelo mesmo SKU e, por padrão, sem restrição.";
          } else {
            const allocationText = remontagem.allocations
              .map(
                (allocation, index) =>
                  `${index + 1}. ${formatMobileSlot(allocation.slot)} → adicionar ${allocation.quantity.toLocaleString("pt-BR")} pçs` +
                  `\n   Saldo atual: ${allocation.slot.saldo.toLocaleString("pt-BR")} pçs` +
                  `\n   Capacidade livre antes: ${allocation.freeCapacityBefore.toLocaleString("pt-BR")} pçs`
              )
              .join("\n\n");

            responseText =
              `PLANO DE REMONTAGEM • ${remontagem.sku}\n` +
              `${remontagem.descricao}\n\n` +
              `Quantidade a remontar: ${requestedQty.toLocaleString("pt-BR")} pçs\n` +
              `Paletização: ${remontagem.capacity.toLocaleString("pt-BR")} pçs/palete\n` +
              `Capacidade livre elegível: ${remontagem.totalFreeCapacity.toLocaleString("pt-BR")} pçs\n\n` +
              `POSIÇÕES DESTINO\n${allocationText}\n\n` +
              (remontagem.complete
                ? "Resultado: quantidade totalmente distribuída nas posições ocupadas selecionadas."
                : `Atenção: ainda faltam ${remontagem.remaining.toLocaleString("pt-BR")} pçs para completar a remontagem.`) +
              "\n\nCritério: somente posições ocupadas pelo mesmo SKU, com capacidade livre, priorizando concentração e proximidade.";
          }
        }

      } else if (
        lower.includes("concentração") ||
        lower.includes("concentracao")
      ) {
        const concentrationSku = findSkuInChatText(userMessage);

        if (!concentrationSku) {
          responseText =
            "Informe o SKU ou a descrição do produto para eu calcular a concentração atual.";
        } else {
          const analysis = buildStrategyAnalysis({
            slots,
            products: productsList,
            sku: concentrationSku,
            activePhysicalPositionKeys,
            requestedRestriction: parseConsultorRestriction(userMessage),
          });

          if (analysis.totalSaldo <= 0) {
            responseText =
              `Não encontrei saldo elegível do SKU ${concentrationSku} para calcular a concentração atual.`;
          } else {
            const topModules = analysis.modules
              .slice(0, 5)
              .map(
                (item, index) =>
                  `${index + 1}. M${item.modulo} — ${item.saldo.toLocaleString("pt-BR")} pçs ` +
                  `(${(item.participacao * 100).toFixed(1)}%)`
              )
              .join("\n");

            responseText =
              `CONCENTRAÇÃO ATUAL • ${analysis.sku}\n` +
              `${analysis.descricao}\n\n` +
              `Saldo elegível total: ${analysis.totalSaldo.toLocaleString("pt-BR")} pçs\n` +
              `• E1: ${analysis.e1Saldo.toLocaleString("pt-BR")} pçs em ${analysis.e1Paletes} palete(s) estimado(s)\n` +
              `• E2/E3: ${analysis.physicalSaldo.toLocaleString("pt-BR")} pçs em ${analysis.totalPosicoes} posições\n` +
              `Módulos envolvidos: ${analysis.totalModulos} (E1: ${analysis.e1Modulos})\n` +
              `Paletes estimados no total: ${analysis.totalPaletes}\n` +
              `Ocupação média E2/E3: ${analysis.ocupacaoPercentual.toFixed(1)}%\n\n` +
              `MÓDULOS COM MAIOR CONCENTRAÇÃO\n${topModules}\n\n` +
              `Centro de concentração: ${
                analysis.concentrationModule !== null
                  ? `M${analysis.concentrationModule}`
                  : "não identificado"
              }\n` +
              `Módulos próximos: ${
                analysis.nearbyModules.length
                  ? analysis.nearbyModules.map(module => `M${module}`).join(" → ")
                  : "não identificado"
              }`;
          }
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
          
      else if (
        lower.includes("item") ||
        lower.includes("produto") ||
        lower.includes("mais estocado") ||
        lower.includes("maior saldo")
      ) {
        const topMatch = lower.match(/top\s*(\d{1,2})/);
        const requestedTop = topMatch ? Math.min(10, Math.max(1, Number(topMatch[1]))) : 5;

        const activeItemMap: Record<
          string,
          {
            qty: number;
            desc: string;
            positions: number;
            modules: Set<string>;
          }
        > = {};

        slots.forEach(slot => {
          if (!isStrategicConsultorSlot(slot)) {
            return;
          }

          const skuKey = slot.referencia.toUpperCase();
          if (!activeItemMap[skuKey]) {
            activeItemMap[skuKey] = {
              qty: 0,
              desc: slot.descricao,
              positions: 0,
              modules: new Set<string>(),
            };
          }

          activeItemMap[skuKey].qty += slot.saldo;
          activeItemMap[skuKey].positions += 1;
          activeItemMap[skuKey].modules.add(
            `${slot.estoque}-${slot.modulo}`
          );
        });

        const sorted = Object.entries(activeItemMap)
          .sort((a, b) => b[1].qty - a[1].qty)
          .slice(0, requestedTop);

        if (sorted.length > 0) {
          const total = Object.values(activeItemMap).reduce(
            (sum, item) => sum + item.qty,
            0
          );

          const ranking = sorted
            .map(([sku, data], index) => {
              const product = productsList.find(
                item => item.referencia.toUpperCase() === sku
              );
              const palletization = Number(product?.paletizacao || 0);
              const pallets =
                palletization > 0
                  ? Math.ceil(data.qty / palletization)
                  : 0;
              const share = total > 0 ? (data.qty / total) * 100 : 0;

              return (
                `${index + 1}. ${sku} • ${data.desc}\n` +
                `   ${data.qty.toLocaleString("pt-BR")} pçs` +
                (pallets > 0 ? ` • ${pallets} paletes est.` : "") +
                ` • ${data.positions} posições` +
                ` • ${data.modules.size} módulos` +
                ` • ${share.toFixed(1)}% do saldo elegível`
              );
            })
            .join("\n\n");

          responseText =
            `TOP ${sorted.length} ITENS MAIS ESTOCADOS\n\n${ranking}`;
        } else {
          responseText =
            "Não existem produtos com saldo elegível em posições sem restrição.";
        }
      } else if (lower.includes("diverg") || lower.includes("erro") || lower.includes("aberto")) {
        const abertas = divergencias.filter(d => d.status === "Aberta");

        if (abertas.length > 0) {
          responseText =
            `DIVERGÊNCIAS EM ABERTO • ${abertas.length}\n\n` +
            abertas
              .map(
                a =>
                  `• ${a.tipoDivergencia} — E${a.estoque} M${a.modulo} ${a.posicao || "Rua"} — SKU ${a.refNova || a.refAtual || "-"}`
              )
              .join("\n");
        } else {
          responseText =
            "Não existem divergências em aberto.";
        }
      } else if (
        lower.includes("indique") ||
        lower.includes("recomenda") ||
        lower.includes("livre") ||
        lower.includes("colocar")
      ) {
        responseText =
          "Para recomendar um endereço operacional, preciso do SKU, da quantidade e, no caso de armazenagem, do tipo físico (palete E2 ou gaiola E3). " +
          "Não vou indicar uma vaga apenas porque existe uma linha vazia no cadastro.";
      } else {
        responseText =
          "Não identifiquei uma operação determinística para essa pergunta. " +
          "Use uma pergunta pronta ou informe SKU, quantidade e objetivo operacional.";
      }

    const isDeterministicConsultorIntent =
      isStorageIntent ||
      isSeparationIntent ||
      isRemontagemIntent ||
      isChacoteQuantityIntent(userMessage) ||
      lower.includes("estratégia") ||
      lower.includes("estrategia") ||
      lower.includes("concentração") ||
      lower.includes("concentracao") ||
      lower.includes("mais estocado") ||
      lower.includes("maior saldo") ||
      lower.includes("diverg") ||
      (findSkuInChatText(userMessage) !== null &&
        /\b(quantas|quantidade|saldo|estoque)\b/.test(lower));

    if (
      shouldUseGenerativeConsultor(userMessage) &&
      !isDeterministicConsultorIntent
    ) {
      const aiResponse = await requestGenerativeConsultor(
        userMessage,
        responseText
      );

      if (aiResponse) {
        responseText = cleanConsultorDisplayText(aiResponse);
      }
    }

    responseText = cleanConsultorDisplayText(responseText);

    const isExecutiveResponse =
      /\bresumo executivo\b/i.test(userMessage);

    setChatMessages(prev => [
      ...prev,
      {
        sender: "system",
        text: responseText,
        ...(isExecutiveResponse ? { kind: "executive" as const } : {}),
      },
    ]);
  };


  const role = currentUser ? normalizeRole(currentUser.role) : "";

  const canAccessTab = (tab: string): boolean => {
    if (!currentUser) return false;

    if (permissionEnforcementEnabled) {
      const slotBackedTabs = new Set([
        "dashboard", "endereçamento", "lançamento", "divergências",
        "base", "configuracao", "mapa", "ai",
      ]);
      if (slotBackedTabs.has(tab) && !canUseAppPermissionForUi("stock.search")) {
        return false;
      }
      if (tab === "divergências" && !canUseAppPermissionForUi("divergences.view")) {
        return false;
      }

      const permissionsByTab: Partial<Record<string, PermissionKey[]>> = {
        dashboard: ["dashboard.view"],
        "endereçamento": ["stock.search"],
        "lançamento": ["stock.launch.view", "stock.launch.create", "stock.transfer.create", "stock.batch.process"],
        "histórico": ["history.view"],
        "divergências": ["divergences.view"],
        base: ["products.view", "products.create", "products.edit", "products.import_bulk", "products.delete_deactivate"],
        configuracao: ["warehouse.layout.view", "warehouse.layout.manage"],
        mapa: ["map.view", "map.metadata.edit", "stock.physical_correction"],
        ai: ["consultor.use"],
        users: ["users.view", "users.manage"],
      };
      const requiredPermissions = permissionsByTab[tab];
      return Boolean(requiredPermissions?.some(canUseAppPermissionForUi));
    }

    if (tab === "configuracao" || tab === "users") {
      return isAdmin(currentUser.role);
    }

    switch (role) {
      case "administrador":
        return true;
      case "lideranca":
        return ["dashboard", "endereçamento", "lançamento", "histórico", "divergências", "base", "ai"].includes(tab);
      case "apoio":
        return ["endereçamento", "lançamento", "histórico", "divergências", "ai"].includes(tab);
      case "producao":
        return ["endereçamento", "ai"].includes(tab);
      case "visualizador":
        return ["dashboard", "endereçamento", "lançamento", "histórico", "divergências", "base", "ai"].includes(tab);
      default:
        return false;
    }
  };

  // After a profile switch, the previous tab may not belong to the new role.
  // Keep the desktop shell on the first accessible module instead of rendering
  // an empty content area (mobile already has an equivalent fallback).
  useEffect(() => {
    if (!currentUser) return;
    if (permissionEnforcementEnabled && permissionContextStatus !== "ready") return;
    if (canAccessTab(activeTab)) return;

    const fallbackTabs = [
      "endereçamento", "dashboard", "lançamento", "histórico",
      "divergências", "base", "configuracao", "mapa", "ai", "users",
    ];
    const fallbackTab = fallbackTabs.find((tab) => canAccessTab(tab));
    if (fallbackTab) setActiveTab(fallbackTab);
  }, [
    activeTab,
    currentUser,
    authUserId,
    permissionEnforcementEnabled,
    permissionContextStatus,
    appPermissionContext,
  ]);

  // --- LOCK SCREEN CONDITIONAL RENDERING ON NOT LOGGED IN ---
  if (!currentUser) {
    return (
      <div className="h-screen w-full bg-slate-900 flex items-center justify-center p-4" id="login-container">
        
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl space-y-6">
          <div className="text-center space-y-1.5">
            <div className="w-12 h-12 bg-blue-600 rounded-xl mx-auto flex items-center justify-center shadow-md border border-blue-500 overflow-hidden">
              <img
                src="/pb-192.png"
                alt="Estoque de Chacote"
                className="w-full h-full object-cover"
              />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white uppercase pt-2">Estoque de Chacote</h1>
            <p className="text-xs text-slate-400 font-medium font-sans">Gestão de Estoque e Armazenagem</p>
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

  const isReadOnly = permissionEnforcementEnabled
    ? !canUseAppPermissionForUi("stock.launch.create")
    : isReadOnlyRole(currentUser.role);
  const canAccessBatchLaunch = permissionEnforcementEnabled
    ? canUseAppPermissionForUi("stock.batch.process") && canUseAppPermissionForUi("stock.launch.create")
    : canExecuteOperations(currentUser.role);
  const canExecuteBatchLaunch = permissionEnforcementEnabled
    ? canUseAppPermissionForUi("stock.batch.process") && canUseAppPermissionForUi("stock.launch.create")
    : canExecuteOperations(currentUser.role);

  const hasAccess = (requiredLevel: "administrador" | "operador" | "consulta"): boolean => {
    if (!currentUser) return false;

    if (permissionEnforcementEnabled) {
      if (requiredLevel === "administrador") return canUseAppPermissionForUi("database.manage");
      if (requiredLevel === "operador") {
        return canUseAppPermissionForUi("products.create") || canUseAppPermissionForUi("products.edit");
      }
      return true;
    }

    if (requiredLevel === "administrador") {
      return isAdmin(currentUser.role);
    }

    if (requiredLevel === "operador") {
      return canExecuteOperations(currentUser.role);
    }

    return true;
  };

  const mobileAllowedTabs = ([
    ...(canAccessTab("endereçamento") ? ["endereçamento"] : []),
    ...(canAccessTab("lançamento") ? ["lançamento"] : []),
    ...(canAccessTab("divergências") ? ["divergências"] : []),
    ...(canAccessTab("histórico") ? ["histórico"] : []),
    ...(canAccessTab("ai") ? ["ai"] : []),
    ...(canAccessTab("base") ? ["base"] : []),
    ...(canAccessTab("configuracao") ? ["configuracao"] : []),
  ]) as Array<"endereçamento" | "lançamento" | "divergências" | "histórico" | "ai" | "base" | "configuracao">;

  const mobileActiveTab = mobileAllowedTabs.includes(activeTab)
    ? activeTab
    : (mobileAllowedTabs[0] ?? "");

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
        canLaunch={permissionEnforcementEnabled ? canUseAppPermissionForUi("stock.launch.create") : canExecuteOperations(currentUser.role)}
        canTransfer={permissionEnforcementEnabled ? canUseAppPermissionForUi("stock.transfer.create") : canExecuteOperations(currentUser.role)}
        canEditSlotMetadata={permissionEnforcementEnabled ? canUseAppPermissionForUi("map.metadata.edit") : canExecuteOperations(currentUser.role)}
        showStockDetailsInSearch={showStockDetailsInSearch}
        showSlotMetadataInSearch={showSlotMetadataInSearch}
        canResolveDivergences={permissionEnforcementEnabled
          ? canUseAppPermissionForUi("divergences.view") && canUseAppPermissionForUi("divergences.resolve")
          : canExecuteOperations(currentUser.role)}
        canViewStock={canAccessTab("endereçamento")}
        canViewLaunch={canAccessTab("lançamento")}
        canViewDivergences={canAccessTab("divergências")}
        canViewHistory={canAccessTab("histórico")}
        canExportHistory={canExportHistory}
        requestHistoryExportPermission={() => requestReportExportPermission(["history.view"])}
        canUseConsultor={canAccessTab("ai")}
        canViewProducts={canAccessTab("base")}
        canViewWarehouseLayout={canAccessTab("configuracao")}
        activeTab={mobileActiveTab}
        onTabChange={tab => setActiveTab(tab)}
        onUpdateSlot={handleMobileUpdateSlot}
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
        baseDataProps={{
          productsList,
          slots,
          onRegisterProduct: registerNewProduct,
          onUpdateProduct: updateProduct,
          onDeleteProduct: deleteProduct,
          hasAccess,
          currentUser,
          permissionEnforcementEnabled,
          canUsePermission: canUseAppPermissionForUi,
        }}
        warehouseConfigProps={{
          layout: warehouseLayout,
          slots,
          positions: warehousePositions,
          productsList,
          currentUser,
          loading: warehouseLayoutLoading || warehousePositionsLoading,
          saving: warehouseLayoutSaving || warehousePositionsSaving,
          loadError: warehouseLayoutError || warehousePositionsError,
          onSave: handleSaveWarehouseLayout,
          onSavePositions: handleSaveWarehousePositions,
          onDeletePosition: handleDeleteWarehousePosition,
          onDeleteModule: handleDeleteWarehouseModule,
        }}
      />
    );
  }

  return (
    <div className="h-screen w-full bg-[#f8fafc] text-slate-800 font-sans overflow-hidden border-8 border-slate-200 flex flex-col md:flex-row antialiased">
      
      {/* SIDEBAR NAVIGATION MAIN SYSTEM */}
      <aside className="w-full md:w-56 bg-slate-900 text-white flex flex-col h-full shrink-0 no-print">
        
        {/* App Title Header Banner */}
        <div className="p-4 border-b border-slate-800 flex items-center space-x-2.5">
          <div className="w-7 h-7 bg-blue-600 rounded overflow-hidden shadow shadow-blue-500/20 shrink-0">
            <img
              src="/pb-192.png"
              alt="Estoque de Chacote"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="leading-tight">
            <span className="block font-black text-xs tracking-tight text-white uppercase">Estoque de Chacote</span>
            <span className="text-[9px] text-[#4dd0e1] block font-extrabold uppercase">Gestão e Armazenagem</span>
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
              <PackageSearch className="w-4 h-4 shrink-0" />
              <span>PESQUISA DE ESTOQUE</span>
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
              <PackagePlus className="w-4 h-4 shrink-0" />
              <span>MOVIMENTAÇÕES</span>
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
              <ClipboardList className="w-4 h-4 shrink-0" />
              <span>HISTÓRICO DE ESTOQUE</span>
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
                <TriangleAlert className="w-4 h-4 shrink-0" />
                <span>DIVERGÊNCIAS DE ESTOQUE</span>
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
              <Boxes className="w-4 h-4 shrink-0" />
              <span>PRODUTOS E SKUs</span>
            </button>
          )}

          {canAccessTab("configuracao") && (
            <button
              onClick={() => setActiveTab("configuracao")}
              className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "configuracao"
                  ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs"
                  : "hover:bg-slate-800 text-slate-350"
              }`}
            >
              <Warehouse className="w-4 h-4 shrink-0" />
              <span>ESTRUTURA DO ESTOQUE</span>
            </button>
          )}

          {/* Render advanced sections if any advanced tab is accessible */}
          {(canAccessTab("mapa") || canAccessTab("ai")) && (
            <>
              <span className="text-[9px] text-slate-500 font-extrabold block pt-4 pb-1.5 px-4 uppercase tracking-wider">Avançado & Controle</span>

              {canAccessTab("mapa") && (
                 <button
                  onClick={() => {
                    setActiveTab("mapa");
                  }}
                  className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                    activeTab === "mapa" 
                      ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                      : "hover:bg-slate-800 text-slate-350"
                  }`}
                >
                  <MapPinned className="w-4 h-4 shrink-0" />
                  <span>MAPA DO ESTOQUE</span>
                </button>
              )}

              {canAccessTab("ai") && (
                <button
                  onClick={() => {
                    setActiveTab("ai");
                  }}
                  className={`w-full flex items-center space-x-3 px-4 py-2 text-xs font-bold transition-all ${
                    activeTab === "ai" 
                      ? "bg-blue-600/15 border-l-4 border-blue-500 text-blue-400 font-bold text-xs" 
                      : "hover:bg-slate-800 text-slate-350"
                  }`}
                >
                  <BrainCircuit className="w-4 h-4 shrink-0" />
                  <span>CONSULTOR DE ESTOQUE</span>
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
            <h1 className="text-sm font-black text-slate-700 font-sans tracking-tight uppercase">Estoque de Chacote</h1>
            {true && (
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
          {permissionEnforcementEnabled && currentUser && permissionContextStatus !== "ready" && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <strong>{permissionContextStatus === "loading" ? "Validando permissões..." : "Permissões não disponíveis."}</strong>{" "}
              {permissionContextStatus === "loading"
                ? "As exportações ficam bloqueadas até a validação terminar."
                : "As exportações foram bloqueadas por segurança. Atualize o aplicativo ou peça ao Administrador para verificar a matriz."}
              {permissionContextError && <span className="block mt-1 text-[10px]">Detalhe técnico: {permissionContextError}</span>}
            </div>
          )}
          
          {/* TAB 1: DASHBOARD VIEW */}
            {activeTab === "dashboard" && canAccessTab("dashboard") && (
              <div className="space-y-6">
              
              {/* Linked versions feedback info */}
              <div className="bg-slate-800 rounded-xl p-5 text-white bg-linear-to-r from-slate-900 to-slate-800 shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border border-slate-700">
                <div>
                  <h3 className="text-md font-extrabold uppercase tracking-wide">Estoque de Chacote • Gestão e Armazenagem</h3>
                  <p className="text-xs text-slate-300 max-w-2xl mt-1 leading-normal font-medium">
                    Plataforma de endereçamento integrada de dados lógicos. A operação utiliza uma única versão integrada: os lançamentos e as correções do módulo de divergências atualizam o Gêmeo Digital em tempo real.
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => {
                      if (!canAccessTab("lançamento")) {
                        alert("Seu perfil não possui permissão para abrir a tela de lançamentos.");
                        return;
                      }
                      setActiveTab("lançamento");
                    }}
                    className="bg-white text-slate-900 hover:bg-slate-100 px-4 py-2 rounded-lg text-xs font-black transition shadow cursor-pointer uppercase"
                  >
                    Efetuar Lançamentos
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
                e1CapacityTotal={getE1TotalCapacity(warehouseLayout)}
                warehousePositions={warehousePositions}
                appMode="avancado"
                canExportReports={canExportDashboardDetails}
                requestReportExportPermission={() => requestReportExportPermission(["dashboard.view"])}
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
                          total = getE1TotalCapacity(warehouseLayout);
                          occupied = occupiedPalletsE1;
                        }
                        
                        if (est === "2" || est === "3") {
                          const configured = activePhysicalPositionKeys[est];
                          total = configured.size;
                          occupied = new Set(
                            slots
                              .filter(
                                slot =>
                                  slot.estoque === est &&
                                  slot.saldo > 0 &&
                                  configured.has(
                                    `${est}-${Number(slot.modulo)}-${String(slot.posicao || "").trim().toUpperCase()}`
                                  )
                              )
                              .map(
                                slot =>
                                  `${est}-${Number(slot.modulo)}-${String(slot.posicao || "").trim().toUpperCase()}`
                              )
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

                  {canAccessTab("mapa") && (
                    <button
                      onClick={() => setActiveTab("mapa")}
                      className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition rounded-lg py-2.5 mt-6 border border-slate-250 shadow-xs uppercase tracking-wider"
                    >
                      Visualizar Gêmeo Digital (2D)
                    </button>
                  )}
                </div>

                {/* AI advisor Teaser */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] text-amber-600 font-bold block uppercase mb-1">Diagnóstico IA</span>
                    <h4 className="text-md font-black text-slate-800 uppercase tracking-tight">Sugestão de Endereço</h4>
                    <p className="text-xs text-slate-400 mt-1 mb-4 leading-normal">
                      Algoritmo inteligente integrado monitorando vagas vazias e divergência de palete.
                    </p>

                    <div className="bg-amber-50/70 border border-amber-200/50 p-4 rounded-xl text-xs text-amber-900 space-y-2 font-sans leading-normal">
                      <span className="font-bold flex items-center gap-1.5 text-amber-850">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                        Celso conectado aos dados reais
                      </span>
                      <p>
                        O Consultor usa saldo, endereçamento físico, movimentações,
                        chacotes, capacidade e divergências para responder perguntas
                        operacionais e estratégicas.
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <span>
                          Saldo atual:{" "}
                          <strong>
                            {slots.reduce((sum, slot) => sum + slot.saldo, 0).toLocaleString("pt-BR")} pçs
                          </strong>
                        </span>
                        <span>
                          Divergências abertas:{" "}
                          <strong>{divergencias.filter(item => item.status === "Aberta").length}</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  {canAccessTab("ai") && (
                    <button
                      onClick={() => setActiveTab("ai")}
                      className="w-full bg-amber-500/10 border border-amber-200 text-amber-820 hover:bg-amber-500/25 text-amber-800 text-xs font-black transition rounded-lg py-2.5 mt-6 uppercase tracking-wider"
                    >
                      Conversar com Diagnóstico IA
                    </button>
                  )}
                </div>

              </div>

            </div>
          )}

          {/* TAB 2: PESQUISA PRODUTOS (Endereçamento search grid) */}
          {activeTab === "endereçamento" && canAccessTab("endereçamento") && (
            <div className="space-y-6">
              
              {/* Filter coordinates */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Filtro de Logística e Endereçamento</h3>
                  <div className="flex items-center gap-4">
                    {canExportStockSearch && (
                      <button
                        onClick={handleExportarEnderecamento}
                        className="text-xs text-indigo-600 hover:text-indigo-800 transition font-bold cursor-pointer flex items-center gap-1.5 font-sans uppercase tracking-wider text-[11px]"
                      >
                        <Download className="w-3.5 h-3.5 text-indigo-500" />
                        Exportar Endereçamento (EXCEL)
                      </button>
                    )}
                    <button
                      onClick={handleClearSlotsFilter}
                      className="text-xs text-slate-400 hover:text-blue-600 transition font-medium cursor-pointer font-sans uppercase tracking-wider text-[11px]"
                    >
                      Limpar Filtros
                    </button>
                    {canExportStockSearch && (
                      <button
                        onClick={handleExportarEnderecamentoPDF}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-xs font-bold"
                      >
                        Exportar PDF
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
                  {
                    <>
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
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">
                          Endereço / Módulo
                        </label>
                        <input
                          type="text"
                          value={searchModulo}
                          onChange={(e) => { setSearchModulo(e.target.value); setSearchPage(1); }}
                          placeholder="Ex.: E3M7 ou M7"
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
                          <option value="">Todos (E1, E2, E3)</option>
                          <option value="E1">Estoque 1 (E1)</option>
                          <option value="E2">Estoque 2 (E2)</option>
                          <option value="E3">Estoque 3 (E3)</option>
                        </select>
                      </div>

                      {showSlotMetadataInSearch && <div>
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
                      </div>}

                      {showSlotMetadataInSearch && <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Restrição</label>
                        <select
                          value={filterRestricao}
                          onChange={(e) => { setFilterRestricao(e.target.value); setSearchPage(1); }}
                          className="w-full border border-slate-300 bg-white rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                        >
                          <option value="">Todas</option>
                          <option value="nenhuma">Nenhuma</option>
                          <option value="teste">Teste</option>
                          <option value="autorizacao">Solicitar autorização</option>
                          <option value="outra">Outro motivo</option>
                        </select>
                      </div>}

                      {showSlotMetadataInSearch && <div>
                        <label className="text-[10px] text-slate-450 font-bold block uppercase mb-1">Observação</label>
                        <input
                          type="text"
                          value={searchObservacao}
                          onChange={(e) => { setSearchObservacao(e.target.value); setSearchPage(1); }}
                          placeholder="Buscar observação"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                        />
                      </div>}

                      {showStockDetailsInSearch && <label className="flex items-center gap-2 self-end pb-2">
                        <input
                          type="checkbox"
                          checked={somenteAcimaPaletizacao}
                          onChange={(e) => {
                            setSomenteAcimaPaletizacao(e.target.checked);
                            setSearchPage(1);
                          }}
                        />
                        <span className="text-xs font-bold text-indigo-600">
                          Apenas acima da paletização
                        </span>
                      </label>}
                    </>
                   }
                </div>
              </div>

              {/* Stats header */}
              <div className="flex justify-between items-center bg-slate-100 text-slate-600 text-xs px-4 py-2 border border-slate-200 rounded-lg font-medium">
                <span>Total de <strong>{filteredSlots.length}</strong> endereços correspondendo aos filtros inseridos.</span>
                {showStockDetailsInSearch && (
                  <span>Saldo físico total localizado: <strong>{filteredSlotsTotalSaldo.toLocaleString()} pçs</strong></span>
                )}
              </div>

              {/* Data Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto overflow-y-auto max-h-[650px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600 uppercase text-[10px] tracking-wider border-b border-slate-200">
                        {([
                          ["estoque", "Estoque"],
                          ["modulo", "Módulo / Rua"],
                          ["posicao", "Posição"],
                          ["referencia", "Referência SKU"],
                          ["restricao", "Restrição"],
                          ["descricao", "Descrição do Item"],
                          ["saldo", "Saldo Logístico (pçs)"],
                          ["dataChacote", "Data Chacote"],
                          ["ultimaMov", "Última mov."],
                          ["responsavel", "Responsável"],
                          ["observacao", "Observação"],
                        ] as Array<[SearchSortField, string]>).filter(([field]) => {
                          const detailsOnly = ["saldo", "ultimaMov", "responsavel"];
                          const metadataOnly = ["restricao", "dataChacote", "observacao"];
                          return (showStockDetailsInSearch || !detailsOnly.includes(field)) &&
                            (showSlotMetadataInSearch || !metadataOnly.includes(field));
                        }).map(([field, label]) => (
                          <th
                            key={field}
                            className={`py-3 px-4 font-bold ${field === "referencia" ? "font-mono text-center" : ""} ${field === "restricao" ? "text-center" : ""} ${field === "saldo" ? "text-right" : ""}`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleSearchSort(field)}
                              className="inline-flex items-center gap-1 hover:text-indigo-700 transition"
                              title={`Ordenar por ${label}. A ordenação é acumulativa: cada novo campo mantém os anteriores como desempate.`}
                            >
                              <span>{label}</span>
                              <span className="font-black whitespace-nowrap">
                                {getSearchSortIndicator(field)}
                              </span>
                            </button>
                          </th>
                        ))}
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
                              {showSlotMetadataInSearch && <td className="py-3 px-4 text-center">
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
                              </td>}
                              <td className="py-3 px-4 truncate max-w-[200px]">
                                {isOccupied ? s.descricao : <span className="text-slate-300 italic font-normal">Vaga desocupada</span>}
                              </td>
                             {showStockDetailsInSearch && <td className="py-3 px-4 text-right font-black pr-6">
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
                            </td>}
                              {showSlotMetadataInSearch && (
                                <td className="py-3 px-4 font-mono text-slate-550">
                                  {isOccupied ? (s.dataChacote || "—") : "—"}
                                </td>
                              )}
                              {showStockDetailsInSearch && (
                                <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                                  {isOccupied ? `${s.ultimaData || "—"} ${s.ultimaHora || ""}`.trim() : "—"}
                                </td>
                              )}
                              {showStockDetailsInSearch && (
                                <td className="py-3 px-4 text-slate-705 font-bold whitespace-nowrap">
                                  {isOccupied ? s.ultimoResponsavel : "—"}
                                </td>
                              )}
                              {showSlotMetadataInSearch && (
                                <td className="py-3 px-4 max-w-[220px] truncate text-slate-500" title={isOccupied ? s.observacao || "" : ""}>
                                  {isOccupied ? s.observacao || "—" : "—"}
                                </td>
                              )}
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={5 + (showStockDetailsInSearch ? 3 : 0) + (showSlotMetadataInSearch ? 3 : 0)} className="py-20 text-center text-slate-400 font-medium bg-slate-50">
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
          {activeTab === "lançamento" && canAccessTab("lançamento") && (
            <div className="space-y-6">
              
              {/* If advanced mode, offer a toggle between Lançamento Unitário and Lançamento em Lote */}
              {true && (
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

              {true && selectedLaunchType === "unitario" ? (
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
                          Seu perfil está configurado somente para consulta nesta área. Solicite ao Administrador a permissão de lançamento, se necessário.
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
                          type="text"
                          inputMode="numeric"
                          value={unitQuantidade}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, "");
                            setUnitQuantidade(digits ? String(Math.max(1, parseInt(digits, 10))) : "");
                          }}
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
                      onClick={() => void handleSynchronizeSharedDraft()}
                      disabled={!authUserId || batchLaunchLoading || batchPendingRecovery}
                      className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg px-3.5 py-2 text-xs font-bold transition cursor-pointer"
                    >
                      Sincronizar rascunho
                    </button>
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
                      onClick={() => canExecuteBatchLaunch && void handleLancarLote()}
                      disabled={!canExecuteBatchLaunch || batchLaunchLoading || !lancamentoDraftReady}
                      aria-busy={batchLaunchLoading}
                      className="bg-indigo-600 hover:bg-indigo-750 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg px-5 py-2 text-xs font-bold transition shadow-sm uppercase tracking-wider cursor-pointer"
                    >
                      {batchLaunchLoading ? "Processando lote..." : "Lançar Lote Completo"}
                    </button>
                    {lancamentoRows.length > 0 && (
                      <button
                        onClick={clearLancamentoDraft}
                        disabled={batchLaunchLoading || !lancamentoDraftReady || batchPendingRecovery}
                        className="bg-white hover:bg-red-50 text-red-600 border border-red-200 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Limpar rascunho
                      </button>
                    )}
                  </div>
                </div>

                <div className="mb-4 flex flex-col gap-1" role="status" aria-live="polite">
                  <p className={`text-xs ${sharedDraftSyncStatus === "synced" ? "text-emerald-700" : sharedDraftSyncStatus === "saving" ? "text-indigo-700" : sharedDraftSyncStatus === "conflict" || sharedDraftSyncStatus === "error" ? "text-amber-700" : "text-slate-500"}`}>
                    {sharedDraftSyncMessage || "Aguardando sincronização do rascunho compartilhado."}
                  </p>
                  {batchPendingRecovery && (
                    <p className="text-xs font-semibold text-amber-800">
                      Há um lote anterior aguardando confirmação. A edição está bloqueada para evitar perder dados ou duplicar movimentações. Clique em Lançar Lote para consultar o mesmo identificador idempotente.
                    </p>
                  )}
                  {legacyDraftQuarantineCount > 0 && (
                    <p className="text-xs text-amber-800">
                      Foi preservada uma cópia local antiga com {legacyDraftQuarantineCount} linha(s). Ela não foi importada nem será restaurada automaticamente. Confirme a cópia de recuperação antes de descartá-la.
                    </p>
                  )}
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
                      disabled={batchLaunchLoading}
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      placeholder="Cole colunas do Excel aqui..."
                      className="w-full h-24 bg-white border border-slate-300 rounded-lg p-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                    />

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => canExecuteBatchLaunch && handleImportExcelData()}
                        disabled={!canExecuteBatchLaunch || batchLaunchLoading || !lancamentoDraftReady}
                        className="bg-indigo-650 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-xs font-bold transition shadow-sm"
                      >
                        Carregar Lançamentos
                      </button>
                      <span className="text-xs font-bold text-indigo-700">{bulkFeedback}</span>
                    </div>
                  </div>
                )}

                {/* TABULAR ENTRY SYSTEM WITH ADVANCED DYNAMIC LAYOUT FIELD CORRECTIONS */}
                <div className={`pt-2 ${batchLaunchLoading || batchPendingRecovery ? "pointer-events-none opacity-60" : ""}`} aria-busy={batchLaunchLoading || batchPendingRecovery}>
                  <div className="max-h-[calc(100vh-24rem)] min-h-[18rem] overflow-auto border border-slate-350 rounded-xl bg-slate-50 shadow-inner">
                    <div className="min-w-[1550px]">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="sticky top-0 z-20 shadow-sm">
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
                            <th className="py-2.5 px-3 w-32">Data da Movimentação</th>
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
                          const isE1 = row.estoque.replace(/^E/i, "") === "1";
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
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={10}
                                  value={formatStoredDateForInput(row.data)}
                                  placeholder="DD/MM/AAAA"
                                  data-lancamento-row={row.id}
                                  data-lancamento-col="2"
                                  onChange={(e) => updateRowField(row.id, "data", e.target.value)}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className="w-full border border-slate-300 rounded p-1 text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                />
                              </td>

                              {/* Galpão */}
                              <td className="py-2 px-2.5">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={2}
                                  value={row.galpao || ""}
                                  placeholder="3 ou 12"
                                  data-lancamento-row={row.id}
                                  data-lancamento-col="3"
                                  onChange={(e) => updateRowField(row.id, "galpao", e.target.value)}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  list={`galpoes-${row.id}`}
                                  className="w-full border border-slate-300 rounded p-1 text-xs bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none font-bold"
                                />
                                <datalist id={`galpoes-${row.id}`}>
                                  <option value="3" />
                                  <option value="12" />
                                </datalist>
                              </td>

                              {/* Estoque selector E1, E2, E3 */}
                              <td className="py-2 px-2.5 font-bold">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={2}
                                  value={row.estoque.replace(/^E/i, "")}
                                  placeholder="1/2/3"
                                  data-lancamento-row={row.id}
                                  data-lancamento-col="4"
                                  onChange={(e) => updateRowField(row.id, "estoque", e.target.value)}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  list={`estoques-${row.id}`}
                                  className="w-full border border-slate-300 rounded p-1 text-xs bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none font-bold"
                                />
                                <datalist id={`estoques-${row.id}`}>
                                  <option value="1" />
                                  <option value="2" />
                                  <option value="3" />
                                </datalist>
                              </td>

                              {/* Modulo / Rua value */}
                              <td className="py-2 px-2.5">
                                <input 
                                  type="text" 
                                  value={row.modulo}
                                  placeholder={isE1 ? "1 a 22" : "1 a 172"}
                                   data-lancamento-row={row.id}
                                   data-lancamento-col="5"
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
                                   data-lancamento-row={row.id}
                                   data-lancamento-col="6"
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
                                     data-lancamento-row={row.id}
                                     data-lancamento-col="7"
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
                                  type="text"
                                  inputMode="numeric"
                                  value={row.quantidade}
                                  data-lancamento-row={row.id}
                                  data-lancamento-col="8"
                                  onChange={(e) => {
                                    const digits = e.target.value.replace(/\D/g, "");
                                    updateRowField(row.id, "quantidade", digits === "" ? "" : parseInt(digits, 10));
                                  }}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className="w-full border border-slate-300 rounded p-1 text-xs text-right pr-0.5 font-bold focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                />
                              </td>

                              {/* Type Entrada / Saída */}
                              <td className="py-2 px-2.5">
                                <input
                                  type="text"
                                  value={row.tipo}
                                  placeholder="E / S"
                                  data-lancamento-row={row.id}
                                  data-lancamento-col="9"
                                  onChange={(e) => updateRowField(row.id, "tipo", e.target.value)}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onKeyDown={handleLancamentoInputKeyDown}
                                  className={`w-full border rounded p-1 text-[11px] focus:outline-none font-extrabold ${
                                    row.tipo === "Entrada"
                                      ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                                      : row.tipo === "Saída"
                                        ? "bg-red-50 border-red-300 text-red-800"
                                        : "bg-white border-slate-300 text-slate-500"
                                  }`}
                                />
                              </td>

                              {/* dataChacote: optional */}
                              <td className="py-2 px-2.5">
                                <input 
                                  type="text" 
                                  value={row.dataChacote}
                                  data-lancamento-row={row.id}
                                  data-lancamento-col="10"
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
                                  data-lancamento-row={row.id}
                                  data-lancamento-col="11"
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
                                  data-lancamento-row={row.id}
                                  data-lancamento-col="12"
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
                                   data-lancamento-row={row.id}
                                   data-lancamento-col="13"
                                   onKeyDown={handleLancamentoInputKeyDown}
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
                                   data-lancamento-row={row.id}
                                   data-lancamento-col="14"
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
          {activeTab === "histórico" && canAccessTab("histórico") && (() => {
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

            const sortedFilteredHistory = [...filteredHistory].sort((a, b) => {
              const valueA = a[historySortField];
              const valueB = b[historySortField];
              let comparison = 0;

              if (historySortField === "quantidade") {
                comparison = Number(valueA || 0) - Number(valueB || 0);
              } else if (historySortField === "estoque" || historySortField === "modulo") {
                const numberA = Number(String(valueA ?? "").replace(/\D/g, ""));
                const numberB = Number(String(valueB ?? "").replace(/\D/g, ""));
                comparison = numberA - numberB;
                if (!Number.isFinite(comparison) || comparison === 0) {
                  comparison = String(valueA ?? "").localeCompare(String(valueB ?? ""), "pt-BR", { numeric: true });
                }
              } else {
                comparison = String(valueA ?? "").localeCompare(String(valueB ?? ""), "pt-BR", { numeric: true, sensitivity: "base" });
              }

              if (comparison === 0) {
                comparison = String(b.data ?? "").localeCompare(String(a.data ?? "")) ||
                  String(b.hora ?? "").localeCompare(String(a.hora ?? "")) ||
                  String(b.id ?? "").localeCompare(String(a.id ?? ""));
              }

              return historySortDirection === "asc" ? comparison : -comparison;
            });

            return (
              <div className="space-y-6">
                <div role="tablist" aria-label="Tipo de histórico" className="inline-flex w-full sm:w-auto rounded-xl border border-slate-200 bg-slate-100 p-1 gap-1">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={historyContentTab === "movements"}
                    onClick={() => setHistoryContentTab("movements")}
                    className={`flex-1 sm:flex-none rounded-lg px-4 py-2.5 text-xs font-bold transition ${historyContentTab === "movements" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    Movimentações
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={historyContentTab === "daily"}
                    onClick={() => setHistoryContentTab("daily")}
                    className={`flex-1 sm:flex-none rounded-lg px-4 py-2.5 text-xs font-bold transition ${historyContentTab === "daily" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    Saldo diário por SKU
                  </button>
                </div>
                {historyContentTab === "daily" && (
                  <StockBalanceHistoryPanel
                    canExportReports={canExportHistory}
                    requestReportExportPermission={() => requestReportExportPermission(["history.view"])}
                  />
                )}
                <div hidden={historyContentTab !== "movements"} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
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
                      {canExportHistory && (
                        <button
                          onClick={handleExportarHistorico}
                          disabled={historyExportLoading}
                          className="bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60 border border-indigo-200 text-indigo-700 rounded-lg px-4 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer uppercase tracking-wider font-sans whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5 text-indigo-600" />
                          {historyExportLoading ? "Exportando..." : "Exportar Histórico"}
                        </button>
                      )}
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

                  <div className="flex flex-wrap items-center justify-end gap-2 mb-2 text-xs">
                    <label htmlFor="history-sort-field" className="font-bold text-slate-500">Ordenar por</label>
                    <select
                      id="history-sort-field"
                      value={historySortField}
                      onChange={(event) => setHistorySortField(event.target.value as typeof historySortField)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-slate-700"
                    >
                      <option value="dataLancamento">Data de registro</option>
                      <option value="estoque">Estoque</option>
                      <option value="modulo">Módulo / rua</option>
                      <option value="posicao">Posição</option>
                      <option value="referencia">SKU</option>
                      <option value="quantidade">Quantidade</option>
                      <option value="tipo">Tipo</option>
                      <option value="hora">Hora</option>
                    </select>
                    <select
                      aria-label="Sentido da ordenação do histórico"
                      value={historySortDirection}
                      onChange={(event) => setHistorySortDirection(event.target.value as "asc" | "desc")}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-slate-700"
                    >
                      <option value="desc">Decrescente</option>
                      <option value="asc">Crescente</option>
                    </select>
                  </div>
                  <div className="overflow-x-auto overflow-y-auto max-h-[650px]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-605 uppercase text-[10px] tracking-wider font-bold">
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
                        {sortedFilteredHistory.length > 0 ? (
                          sortedFilteredHistory.map((h) => (
                            <tr key={h.id} className="hover:bg-slate-50 border-b border-slate-100">
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
          {activeTab === "divergências" && canAccessTab("divergências") && (
            <DivergenciasPanel
              divergencias={divergencias}
              slots={slots}
              currentUser={currentUser}
              operator={operator}
              launchDate={launchDate}
              onResolveDivergencia={handleMobileResolveDivergencia}
              hasAccess={hasAccess}
              canResolveDivergences={permissionEnforcementEnabled
                ? canUseAppPermissionForUi("divergences.view") && canUseAppPermissionForUi("divergences.resolve")
                : canExecuteOperations(currentUser.role)}
              canExportReports={canExportDivergences}
              requestReportExportPermission={() => requestReportExportPermission(["divergences.view"])}
            />
          )}

          {/* TAB 6: BASE DE DADOS (References List and registering new ones) */}
          {activeTab === "base" && canAccessTab("base") && (
           <BaseDeDadosPanel
              productsList={productsList}
              slots={slots}
              onRegisterProduct={registerNewProduct}
              onUpdateProduct={updateProduct}
              onDeleteProduct={deleteProduct}
              hasAccess={hasAccess}
              currentUser={currentUser}
              permissionEnforcementEnabled={permissionEnforcementEnabled}
              canUsePermission={canUseAppPermissionForUi}
          />
          )}

          {activeTab === "configuracao" && canAccessTab("configuracao") && (
            <WarehouseLayoutPanel
              layout={warehouseLayout}
              slots={slots}
              positions={warehousePositions}
              productsList={productsList}
              currentUser={currentUser}
              canView={
                permissionEnforcementEnabled
                  ? canUseAppPermissionForUi("warehouse.layout.view")
                  : Boolean(currentUser && isAdmin(currentUser.role))
              }
              canManage={
                permissionEnforcementEnabled
                  ? canUseAppPermissionForUi("warehouse.layout.manage")
                  : Boolean(currentUser && isAdmin(currentUser.role))
              }
              loading={warehouseLayoutLoading || warehousePositionsLoading}
              saving={warehouseLayoutSaving || warehousePositionsSaving}
              loadError={warehouseLayoutError || warehousePositionsError}
              onSave={handleSaveWarehouseLayout}
              onSavePositions={handleSaveWarehousePositions}
              onDeletePosition={handleDeleteWarehousePosition}
              onDeleteModule={handleDeleteWarehouseModule}
            />
          )}

          {/* TAB 7: GÊMEO DIGITAL */}
          {activeTab === "mapa" && canAccessTab("mapa") && (
            <div className="space-y-6">
              
          <InteractiveMapa
            slots={slots}
            onQuickUpdateSlot={async (requestedSlot, expectedSlot) => {
              if (!(await requestAppMutationPermission("stock.physical_correction", "corrigir fisicamente o estoque"))) {
                return { ok: false };
              }
              const currentSlots = slotsRef.current;
              if (!isMapQuickCorrectionSnapshotCurrent(currentSlots, expectedSlot)) {
                alert("O endereço mudou desde que você abriu a correção. Nenhum dado foi alterado; feche a edição, atualize o mapa e confira o saldo atual.");
                return { ok: false };
              }

              const correctionDate = getTodayIsoDate();
              const correctionTime = new Date().toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              });
              const plan = buildMapQuickCorrectionPlan({
                slots: currentSlots,
                requestedSlot,
                productsList,
                operator,
                date: correctionDate,
                time: correctionTime,
                createHistoryId: () => `MOV-${generateId()}`,
                createCorrectionId: () => globalThis.crypto?.randomUUID?.() ?? null,
              });

              if (plan.ok === false) {
                alert(plan.reason);
                return { ok: false };
              }

              // The map uses the same atomic writer as stock movements.
              // Never fall back to upsert + history as separate requests.
              try {
                const currentDivergencias = divergenciasRef.current;
                const transaction = await persistStockMutationAtomically(
                  currentSlots,
                  plan.updatedSlots,
                  plan.history,
                  currentDivergencias,
                  currentDivergencias,
                  undefined,
                  "physical_correction",
                );

                if (!transaction.ok) {
                  alert(
                    "A correção do mapa não foi confirmada pelo Supabase. Nenhum fallback ou nova tentativa automática será executado.\n\n" +
                    `${transaction.reason || "Atualize os dados e confira o endereço e o histórico antes de tentar novamente."}`
                  );
                  return { ok: false };
                }

                return { ok: true, selectedSlotId: plan.selectedSlotId };
              } catch (error) {
                console.error("Falha inesperada ao confirmar correção do mapa; nenhuma nova tentativa foi iniciada.", error);
                alert("Não foi possível confirmar a correção do mapa. Não repita automaticamente; atualize os dados e confira o endereço e o histórico.");
                return { ok: false };
              }
            }}
            productsList={productsList}
              currentUser={currentUser}
              e1Layout={warehouseLayout}
              warehousePositions={warehousePositions}
              />
            </div>
          )}

          {/* TAB 9: IA CONSULTOR (AI dialogue workspace chat) */}
          {activeTab === "ai" && canAccessTab("ai") && (
            <div className="space-y-6 pt-8">
              
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col lg:flex-row gap-5 items-stretch">

                {/* Chat section */}
                <div className="flex-[1.8] min-w-0 border border-slate-300 rounded-xl flex flex-col h-[74vh] min-h-[600px] max-h-[820px] overflow-hidden shadow-inner bg-slate-50 font-sans">

                  <div className="bg-slate-900 border-b border-slate-950 p-4 font-sans text-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping mr-1"></div>
                      <div>
                        <span className="font-bold text-xs block uppercase">Celso • Consultor de Estoque</span>
                        <span className="text-[10px] text-indigo-300 block">Sincronizado aos Estoques E1, E2, E3</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 p-5 overflow-y-auto space-y-3 text-xs leading-normal font-medium">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[92%] lg:max-w-[82%] rounded-xl shadow-xs ${
                            msg.sender === "user"
                              ? "rounded-br-none bg-slate-800 p-3 text-white"
                              : "rounded-bl-none border border-slate-200 bg-white p-4 text-slate-800"
                          }`}
                        >
                          <div className="whitespace-pre-wrap text-xs leading-6 font-medium">
                            {msg.text}
                          </div>

                          {msg.kind === "executive" && canExportConsultor && (
                            <div className="mt-4 border-t border-slate-100 pt-3">
                              <button
                                type="button"
                                onClick={() => handleExportConsultorExecutivePdf(msg.text)}
                                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white transition hover:bg-slate-800"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Baixar resumo executivo em PDF
                              </button>
                            </div>
                          )}
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
                      placeholder="Pergunte ao Celso sobre estoque, chacote, capacidade, PCP ou qualidade..."
                      className="flex-1 bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                    <button
                      onClick={() => handleSendChatMessage()}
                      disabled={chatAiLoading}
                      className="bg-indigo-700 hover:bg-indigo-800 text-white px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-60"
                    >
                      {chatAiLoading ? "Consultando..." : "Enviar"}
                    </button>
                  </div>

                </div>

                {/* Quick questions organized by business area */}
                <aside className="w-full lg:w-80 shrink-0 border border-slate-200 rounded-xl p-5 bg-slate-50 space-y-4 font-sans">
                  <div>
                    <span className="text-[10px] text-indigo-600 font-extrabold block uppercase tracking-wider">
                      Perguntas rápidas
                    </span>
                    <p className="mt-1 text-xs text-slate-500 leading-normal font-medium">
                      Selecione o contexto e escolha uma pergunta para preencher o chat. Você também pode escrever livremente.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                        Tema / setor
                      </span>
                      <select
                        value={consultorQuickTopic}
                        onChange={(event) => {
                          const topic = event.target.value as keyof typeof CONSULTOR_QUICK_QUESTIONS;
                          setConsultorQuickTopic(topic);
                          setConsultorQuickQuestion("");
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        {Object.keys(CONSULTOR_QUICK_QUESTIONS).map(topic => (
                          <option key={topic} value={topic}>{topic}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                        Pergunta
                      </span>
                      <select
                        value={consultorQuickQuestion}
                        onChange={(event) => {
                          const prompt = event.target.value;
                          setConsultorQuickQuestion(prompt);
                          if (prompt) setChatInput(prompt);
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option value="">Escolher uma pergunta...</option>
                        {CONSULTOR_QUICK_QUESTIONS[consultorQuickTopic].map(([icon, prompt]) => (
                          <option key={prompt} value={prompt}>{icon} {prompt}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-[11px] leading-normal text-indigo-900">
                    <strong className="block mb-1">Celso entende linguagem natural</strong>
                    Você pode alterar a pergunta preenchida, informar SKU, período ou quantidade e enviar normalmente.
                  </div>
                </aside>

              </div>

            </div>
          )}

          {/* TAB 10: CONTROLE DE USUÁRIOS */}
          {activeTab === "users" && canAccessTab("users") && (
            <div className="space-y-6">
              <AdminUsersManagement
                users={users}
                usersLoading={usersLoading}
                usersLoadError={usersLoadError}
                onReloadUsers={() => { void loadUsersFromSupabase(); }}
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