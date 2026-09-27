import { supabase } from "./supabase";
import { WarehousePositionConfig } from "../types";

const mapRow = (row: any): WarehousePositionConfig => ({
  id: String(row.id),
  estoque: String(row.estoque),
  modulo: String(row.modulo),
  posicao: String(row.posicao).toUpperCase(),
  ativo: Boolean(row.ativo),
  updatedAt: row.updated_at || undefined,
});


const normalizeWarehousePositions = (
  entries: WarehousePositionConfig[]
): WarehousePositionConfig[] => {
  const grouped = new Map<string, WarehousePositionConfig>();

  for (const entry of entries) {
    const estoque = String(entry.estoque).replace(/^E/i, "");
    const modulo = String(entry.modulo).trim().replace(/^0+/, "") || "0";
    const posicao = String(entry.posicao).trim().toUpperCase();
    const key = `${estoque}-${modulo}-${posicao}`;
    const current = grouped.get(key);

    grouped.set(
      key,
      current
        ? {
            ...current,
            ativo: Boolean(current.ativo || entry.ativo),
            updatedAt: current.updatedAt || entry.updatedAt,
          }
        : {
            ...entry,
            id: `${estoque}-${modulo}-${posicao}`,
            estoque,
            modulo,
            posicao,
          }
    );
  }

  return [...grouped.values()].sort(
    (a, b) =>
      Number(a.estoque) - Number(b.estoque) ||
      Number(a.modulo) - Number(b.modulo) ||
      a.posicao.localeCompare(b.posicao, "pt-BR", { numeric: true })
  );
};

export async function loadWarehousePositions(): Promise<{
  data: WarehousePositionConfig[];
  error: string | null;
}> {
  const pageSize = 1000;
  const rows: any[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("warehouse_layout_positions")
      .select("id,estoque,modulo,posicao,ativo,updated_at")
      .in("estoque", ["2", "3"])
      .order("estoque", { ascending: true })
      .order("modulo", { ascending: true })
      .order("posicao", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("Erro ao carregar posições físicas dos estoques:", error);
      return {
        data: [],
        error: error.message || "Não foi possível carregar as posições físicas.",
      };
    }

    rows.push(...(data || []));

    if (!data || data.length < pageSize) break;
  }

  return {
    data: normalizeWarehousePositions(rows.map(mapRow)),
    error: null,
  };
}


export async function saveWarehousePositions(
  entries: WarehousePositionConfig[],
  userId: string
): Promise<{ data: WarehousePositionConfig[] | null; error: string | null }> {
  const now = new Date().toISOString();

  const payload = entries.map(entry => ({
    id: entry.id,
    estoque: String(entry.estoque).replace(/^E/i, ""),
    modulo: String(Number(entry.modulo)),
    posicao: entry.posicao.trim().toUpperCase(),
    ativo: Boolean(entry.ativo),
    updated_at: now,
    updated_by: userId,
  }));

  const { data, error } = await supabase
    .from("warehouse_layout_positions")
    .upsert(payload, { onConflict: "id" })
    .select("id,estoque,modulo,posicao,ativo,updated_at");

  if (error) {
    console.error("Erro ao salvar posições físicas dos estoques:", error);
    return {
      data: null,
      error: error.message || "Não foi possível salvar as posições físicas.",
    };
  }

  return {
    data: normalizeWarehousePositions((data || []).map(mapRow)),
    error: null,
  };
}


export async function deleteWarehousePosition(
  estoque: string,
  modulo: string,
  posicao: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("delete_warehouse_position", {
    p_estoque: String(estoque).replace(/^E/i, ""),
    p_modulo: String(Number(modulo)),
    p_posicao: posicao.trim().toUpperCase(),
  });

  if (error) {
    console.error("Erro ao excluir posição física:", error);
    return {
      error: error.message || "Não foi possível excluir a posição física.",
    };
  }

  return { error: null };
}

export async function deleteWarehouseModule(
  estoque: string,
  modulo: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("delete_warehouse_module", {
    p_estoque: String(estoque).replace(/^E/i, ""),
    p_modulo: String(Number(modulo)),
  });

  if (error) {
    console.error("Erro ao excluir módulo físico:", error);
    return {
      error: error.message || "Não foi possível excluir o módulo físico.",
    };
  }

  return { error: null };
}
