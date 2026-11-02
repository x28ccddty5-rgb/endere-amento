import { supabase } from "./supabase";
import { E1_CAPACITY } from "../constants/layout";
import { guardedSupabaseRequest } from "./supabaseRequestGuard";
import { WarehouseLayoutEntry } from "../types";

const DEFAULT_E1_LAYOUT: WarehouseLayoutEntry[] = Object.entries(E1_CAPACITY)
  .map(([modulo, capacidade]) => ({
    id: `1-${modulo}`,
    estoque: "1",
    modulo,
    capacidade,
    ativo: true,
  }))
  .sort((a, b) => Number(a.modulo) - Number(b.modulo));

export const getDefaultE1Layout = (): WarehouseLayoutEntry[] =>
  DEFAULT_E1_LAYOUT.map(entry => ({ ...entry }));

export const getE1CapacityMap = (
  layout: WarehouseLayoutEntry[]
): Record<string, number> =>
  Object.fromEntries(
    layout
      .filter(entry => entry.estoque === "1" && entry.ativo)
      .map(entry => [String(Number(entry.modulo)), entry.capacidade])
  );

export const getE1ActiveLayout = (
  layout: WarehouseLayoutEntry[]
): WarehouseLayoutEntry[] =>
  layout
    .filter(entry => entry.estoque === "1" && entry.ativo)
    .sort((a, b) => Number(a.modulo) - Number(b.modulo));

export const getE1TotalCapacity = (layout: WarehouseLayoutEntry[]): number =>
  getE1ActiveLayout(layout).reduce(
    (total, entry) => total + entry.capacidade,
    0
  );

const mapRow = (row: any): WarehouseLayoutEntry => ({
  id: String(row.id),
  estoque: String(row.estoque),
  modulo: String(row.modulo),
  capacidade: Number(row.capacidade),
  ativo: Boolean(row.ativo),
  updatedAt: row.updated_at || undefined,
  updatedBy: row.updated_by ?? null,
});



export const normalizeWarehouseLayoutEntries = (
  entries: WarehouseLayoutEntry[]
): WarehouseLayoutEntry[] => {
  const grouped = new Map<string, WarehouseLayoutEntry>();

  for (const entry of entries) {
    const estoque = String(entry.estoque).replace(/^E/i, "");
    const modulo = String(entry.modulo).trim().replace(/^0+/, "") || "0";
    const key = `${estoque}-${modulo}`;
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, {
        ...entry,
        id: `${estoque}-${modulo}`,
        estoque,
        modulo,
      });
      continue;
    }

    grouped.set(key, {
      ...current,
      id: `${estoque}-${modulo}`,
      estoque,
      modulo,
      capacidade:
        estoque === "1"
          ? Math.max(Number(current.capacidade || 0), Number(entry.capacidade || 0))
          : Math.max(Number(current.capacidade || 0), Number(entry.capacidade || 0)),
      ativo: Boolean(current.ativo || entry.ativo),
      updatedAt: current.updatedAt || entry.updatedAt,
      updatedBy: current.updatedBy ?? entry.updatedBy ?? null,
    });
  }

  return [...grouped.values()].sort(
    (a, b) =>
      Number(a.estoque) - Number(b.estoque) ||
      Number(a.modulo) - Number(b.modulo)
  );
};

export async function loadWarehouseLayout(): Promise<{
  data: WarehouseLayoutEntry[];
  error: string | null;
}> {
  const response = await guardedSupabaseRequest("warehouse-layout.read", () =>
    supabase
      .from("warehouse_layout")
      .select("id,estoque,modulo,capacidade,ativo,updated_at,updated_by")
      .in("estoque", ["1", "2", "3"])
      .order("estoque", { ascending: true })
      .order("modulo", { ascending: true })
  );
  const { data, error } = response;

  if (error) {
    if (!response.blocked) console.error("Erro ao carregar configuração física dos estoques:", error);
    return {
      data: getDefaultE1Layout(),
      error: error.message || "Não foi possível carregar a configuração física.",
    };
  }

  const mapped = normalizeWarehouseLayoutEntries((data || []).map(mapRow));

  const e1 = mapped.filter(entry => entry.estoque === "1");
  return {
    data: e1.length > 0
      ? mapped
      : normalizeWarehouseLayoutEntries([
          ...getDefaultE1Layout(),
          ...mapped.filter(entry => entry.estoque !== "1"),
        ]),
    error: null,
  };
}

export async function saveWarehouseLayout(
  entries: WarehouseLayoutEntry[],
  expectedEntries: WarehouseLayoutEntry[],
): Promise<{ data: WarehouseLayoutEntry[] | null; error: string | null }> {
  const expectedById = new Map(
    expectedEntries
      .filter(entry => Boolean(entry.updatedAt))
      .map(entry => [entry.id, entry])
  );
  const changedEntries = entries.filter(entry => {
    const previous = expectedById.get(entry.id);
    if (!previous) return true;
    return previous.estoque !== entry.estoque ||
      previous.modulo !== entry.modulo ||
      Number(previous.capacidade) !== Number(entry.capacidade) ||
      Boolean(previous.ativo) !== Boolean(entry.ativo);
  });

  if (changedEntries.length === 0) {
    return { data: normalizeWarehouseLayoutEntries(entries), error: null };
  }

  const payload = changedEntries.map(entry => ({
    id: String(entry.id),
    estoque: String(entry.estoque).replace(/^E/i, ""),
    modulo: String(Number(entry.modulo)),
    capacidade: Number(entry.capacidade),
    ativo: Boolean(entry.ativo),
  }));

  const expectedPayload = changedEntries.flatMap(entry => {
    const previous = expectedById.get(entry.id);
    if (!previous) return [];
    return [{
      id: previous.id,
      estoque: String(previous.estoque).replace(/^E/i, ""),
      modulo: String(Number(previous.modulo)),
      capacidade: Number(previous.capacidade),
      ativo: Boolean(previous.ativo),
      updated_at: previous.updatedAt,
      updated_by: previous.updatedBy ?? null,
    }];
  });

  const { data, error } = await supabase.rpc("save_warehouse_layout_atomic" as never, {
    p_expected_layout: expectedPayload,
    p_layout: payload,
  } as never);

  if (error) {
    console.error("Erro ao salvar configuração física dos estoques pela RPC atômica:", error);
    return {
      data: null,
      error: error.message || "Não foi possível salvar a configuração física.",
    };
  }

  const result = data as { success?: boolean; rows?: any[] } | null;
  if (result?.success !== true || !Array.isArray(result.rows)) {
    return {
      data: null,
      error: "O banco não confirmou a gravação da configuração física.",
    };
  }

  const savedById = new Map<string, WarehouseLayoutEntry>(
    result.rows.map(row => {
      const saved = mapRow(row);
      return [saved.id, saved];
    })
  );
  return {
    data: normalizeWarehouseLayoutEntries(
      entries.map(entry => savedById.get(entry.id) ?? entry)
    ),
    error: null,
  };
}

/** Compatibilidade com chamadas legadas: mantém a API anterior para E1. */
export const loadE1Layout = loadWarehouseLayout;

export async function saveE1Layout(
  entries: WarehouseLayoutEntry[],
  _userId: string
): Promise<{ data: WarehouseLayoutEntry[] | null; error: string | null }> {
  const current = await loadWarehouseLayout();
  if (current.error) return { data: null, error: current.error };
  return saveWarehouseLayout(entries, current.data);
}
