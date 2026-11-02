import { supabase } from "./supabase";
import { WarehousePositionConfig } from "../types";
import { guardedSupabaseRequest } from "./supabaseRequestGuard";

const mapRow = (row: any): WarehousePositionConfig => ({
  id: String(row.id),
  estoque: String(row.estoque),
  modulo: String(row.modulo),
  posicao: String(row.posicao).toUpperCase(),
  ativo: Boolean(row.ativo),
  updatedAt: row.updated_at || undefined,
  updatedBy: row.updated_by ?? null,
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
            updatedBy: current.updatedBy ?? entry.updatedBy ?? null,
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
  const maxPages = 50;
  const rows: any[] = [];
  let paginationComplete = false;

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const response = await guardedSupabaseRequest(`warehouse-positions.read:${from}`, () =>
      supabase
        .from("warehouse_layout_positions")
        .select("id,estoque,modulo,posicao,ativo,updated_at,updated_by")
        .in("estoque", ["2", "3"])
        .order("estoque", { ascending: true })
        .order("modulo", { ascending: true })
        .order("posicao", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1),
      "warehouse-positions.read",
    );
    const { data, error } = response;

    if (error) {
      if (!response.blocked) console.error("Erro ao carregar posições físicas dos estoques:", error);
      return {
        data: [],
        error: error.message || "Não foi possível carregar as posições físicas.",
      };
    }

    rows.push(...(data || []));

    if (!data || data.length < pageSize) {
      paginationComplete = true;
      break;
    }
  }

  if (!paginationComplete) {
    const message = `Carga de posições físicas interrompida no limite de ${maxPages} páginas para evitar consultas sem fim.`;
    console.error(message);
    return { data: [], error: message };
  }

  return { data: normalizeWarehousePositions(rows.map(mapRow)), error: null };
}


export async function saveWarehousePositions(
  entries: WarehousePositionConfig[],
  expectedEntries: WarehousePositionConfig[],
): Promise<{ data: WarehousePositionConfig[] | null; error: string | null }> {
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
      previous.posicao !== entry.posicao ||
      Boolean(previous.ativo) !== Boolean(entry.ativo);
  });

  if (changedEntries.length === 0) {
    return { data: normalizeWarehousePositions(entries), error: null };
  }

  const payload = changedEntries.map(entry => ({
    id: String(entry.id),
    estoque: String(entry.estoque).replace(/^E/i, ""),
    modulo: String(Number(entry.modulo)),
    posicao: entry.posicao.trim().toUpperCase(),
    ativo: Boolean(entry.ativo),
  }));

  const expectedPayload = changedEntries.flatMap(entry => {
    const previous = expectedById.get(entry.id);
    if (!previous) return [];
    return [{
      id: previous.id,
      estoque: String(previous.estoque).replace(/^E/i, ""),
      modulo: String(Number(previous.modulo)),
      posicao: previous.posicao.trim().toUpperCase(),
      ativo: Boolean(previous.ativo),
      updated_at: previous.updatedAt,
      updated_by: previous.updatedBy ?? null,
    }];
  });

  const { data, error } = await supabase.rpc("save_warehouse_positions_atomic" as never, {
    p_expected_positions: expectedPayload,
    p_positions: payload,
  } as never);

  if (error) {
    console.error("Erro ao salvar posições físicas dos estoques pela RPC atômica:", error);
    return {
      data: null,
      error: error.message || "Não foi possível salvar as posições físicas.",
    };
  }

  const result = data as { success?: boolean; rows?: any[] } | null;
  if (result?.success !== true || !Array.isArray(result.rows)) {
    return {
      data: null,
      error: "O banco não confirmou a gravação das posições físicas.",
    };
  }

  const savedById = new Map<string, WarehousePositionConfig>(
    result.rows.map(row => {
      const saved = mapRow(row);
      return [saved.id, saved];
    })
  );
  return {
    data: normalizeWarehousePositions(
      entries.map(entry => savedById.get(entry.id) ?? entry)
    ),
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
