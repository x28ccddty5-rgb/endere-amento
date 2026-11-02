import type { WarehouseSlot } from "../types";

/**
 * Projeção operacional fixa da Pesquisa de Estoque.
 *
 * A autorização é validada separadamente por reports.export + stock.search.
 * A projeção nunca inclui o identificador técnico do banco e não varia por
 * perfil: Excel e PDF exportam os mesmos campos, respeitando os filtros ativos.
 */
const getLastMovementLabel = (slot: WarehouseSlot): string => {
  const date = String(slot.ultimaData ?? "").trim();
  const time = String(slot.ultimaHora ?? "").trim();
  return [date, time].filter(Boolean).join(" ");
};

const getRestrictionLabel = (slot: WarehouseSlot): string =>
  slot.galpao === "12" ? "autorizacao" : (slot.restricao || "nenhuma");

export function createStockSearchSpreadsheetRow(
  slot: WarehouseSlot,
): Record<string, string | number> {
  return {
    Estoque: `E${slot.estoque}`,
    Modulo_Rua: slot.modulo,
    Posicao: slot.posicao || "Corredor",
    Referencia_SKU: slot.referencia || "",
    Descricao_Produto: slot.descricao || "",
    Saldo_Pecas: slot.saldo,
    Data_Chacote: slot.dataChacote || "",
    Ultima_Movimentacao: getLastMovementLabel(slot),
    Ultimo_Responsavel: slot.ultimoResponsavel || "",
    Galpao: slot.galpao || "3",
    Restricao: getRestrictionLabel(slot),
    Observacao: slot.observacao || "",
  };
}

export function getStockSearchPdfHeaders(): string[] {
  return [
    "Estoque",
    "Módulo/Rua",
    "Posição",
    "SKU",
    "Descrição",
    "Saldo",
    "Data Chacote",
    "Última Movimentação",
    "Responsável",
    "Galpão",
    "Restrição",
    "Observação",
  ];
}

export function createStockSearchPdfRow(
  slot: WarehouseSlot,
): Array<string | number> {
  return [
    `E${slot.estoque}`,
    slot.modulo,
    slot.posicao || "Corredor",
    slot.referencia || "-",
    slot.descricao || "-",
    slot.saldo.toLocaleString("pt-BR"),
    slot.dataChacote || "-",
    getLastMovementLabel(slot) || "-",
    slot.ultimoResponsavel || "-",
    slot.galpao || "3",
    getRestrictionLabel(slot),
    slot.observacao || "-",
  ];
}
