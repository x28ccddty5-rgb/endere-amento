import { supabase } from "./supabase";
import { E1_CAPACITY } from "../constants/layout";
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
});


export async function loadWarehouseLayout(): Promise<{
  data: WarehouseLayoutEntry[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("warehouse_layout")
    .select("id,estoque,modulo,capacidade,ativo,updated_at")
    .in("estoque", ["1", "2", "3"])
    .order("estoque", { ascending: true })
    .order("modulo", { ascending: true });

  if (error) {
    console.error("Erro ao carregar configuração física dos estoques:", error);
    return {
      data: getDefaultE1Layout(),
      error: error.message || "Não foi possível carregar a configuração física.",
    };
  }

  const mapped = (data || [])
    .map(mapRow)
    .sort(
      (a, b) =>
        Number(a.estoque) - Number(b.estoque) ||
        Number(a.modulo) - Number(b.modulo)
    );

  const e1 = mapped.filter(entry => entry.estoque === "1");
  return {
    data: e1.length > 0
      ? mapped
      : [...getDefaultE1Layout(), ...mapped.filter(entry => entry.estoque !== "1")],
    error: null,
  };
}

export async function saveWarehouseLayout(
  entries: WarehouseLayoutEntry[],
  userId: string
): Promise<{ data: WarehouseLayoutEntry[] | null; error: string | null }> {
  const now = new Date().toISOString();

  const payload = entries.map(entry => ({
    id: entry.id,
    estoque: String(entry.estoque).replace(/^E/i, ""),
    modulo: String(Number(entry.modulo)),
    capacidade: Number(entry.capacidade),
    ativo: Boolean(entry.ativo),
    updated_at: now,
    updated_by: userId,
  }));

  const { data, error } = await supabase
    .from("warehouse_layout")
    .upsert(payload, { onConflict: "id" })
    .select("id,estoque,modulo,capacidade,ativo,updated_at");

  if (error) {
    console.error("Erro ao salvar configuração física dos estoques:", error);
    return {
      data: null,
      error: error.message || "Não foi possível salvar a configuração física.",
    };
  }

  return {
    data: (data || [])
      .map(mapRow)
      .sort(
        (a, b) =>
          Number(a.estoque) - Number(b.estoque) ||
          Number(a.modulo) - Number(b.modulo)
      ),
    error: null,
  };
}

/** Compatibilidade com chamadas legadas: mantém a API anterior para E1. */
export const loadE1Layout = loadWarehouseLayout;

export async function saveE1Layout(
  entries: WarehouseLayoutEntry[],
  userId: string
): Promise<{ data: WarehouseLayoutEntry[] | null; error: string | null }> {
  return saveWarehouseLayout(entries, userId);
}
