import type { LancamentoRow } from "../types";

export interface SharedLancamentoDraftLine {
  line_id: string;
  row_data: LancamentoRow;
  line_revision: number;
  sequence: number;
}

export interface SharedLancamentoDraftSnapshot {
  success: true;
  generation_id: string;
  revision: number;
  lines: SharedLancamentoDraftLine[];
}

export interface SharedDraftLineWrite {
  line_id: string;
  row_data: LancamentoRow;
  expected_line_revision: number | null;
}

export interface SharedDraftLineDelete {
  line_id: string;
  expected_line_revision: number;
}

export interface SharedDraftSyncPlan {
  upserts: SharedDraftLineWrite[];
  deletes: SharedDraftLineDelete[];
}

const text = (value: unknown): string => value == null ? "" : String(value);

/** Produz uma forma estável para comparar uma linha editada com a base remota. */
export function normalizeLancamentoDraftRow(value: unknown): LancamentoRow {
  const row = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};

  const rawQuantity = row.quantidade;
  const quantity = rawQuantity === "" || rawQuantity == null
    ? ""
    : Number.isFinite(Number(rawQuantity))
      ? Number(rawQuantity)
      : text(rawQuantity) as LancamentoRow["quantidade"];

  return {
    id: text(row.id),
    data: text(row.data),
    estoque: text(row.estoque || "1"),
    modulo: text(row.modulo),
    posicao: text(row.posicao),
    referencia: text(row.referencia),
    quantidade: quantity,
    tipo: row.tipo === "Entrada" || row.tipo === "Saída" ? row.tipo : "",
    dataChacote: text(row.dataChacote),
    hora: text(row.hora),
    responsavel: text(row.responsavel),
    galpao: (text(row.galpao || "3") as LancamentoRow["galpao"]),
    restricao: (text(row.restricao || "nenhuma") as LancamentoRow["restricao"]),
    observacao: text(row.observacao),
  };
}

export function sharedDraftRowsEqual(left: unknown, right: unknown): boolean {
  const a = normalizeLancamentoDraftRow(left);
  const b = normalizeLancamentoDraftRow(right);
  return Object.keys(a).every(key =>
    a[key as keyof LancamentoRow] === b[key as keyof LancamentoRow]
  );
}

/** Linhas vazias criadas para facilitar a digitação podem ser ignoradas no lote. */
export function isBlankLancamentoDraftRow(value: unknown): boolean {
  const row = normalizeLancamentoDraftRow(value);
  const fields = [
    row.data,
    row.modulo,
    row.posicao,
    row.referencia,
    row.quantidade,
    row.tipo,
    row.dataChacote,
    row.hora,
    row.responsavel,
    row.observacao,
    row.estoque === "1" ? "" : row.estoque,
  ];
  const noEnteredFields = fields.every(field => field === "" || field == null);
  const defaultWarehouse = !row.galpao || row.galpao === "3";
  const defaultRestriction = !row.restricao || row.restricao === "nenhuma";
  return noEnteredFields && defaultWarehouse && defaultRestriction;
}

export function buildSharedDraftSyncPlan(
  currentValues: unknown[],
  baselineLines: SharedLancamentoDraftLine[],
): SharedDraftSyncPlan {
  const currentRows = currentValues.map(normalizeLancamentoDraftRow);
  const currentById = new Map<string, LancamentoRow>();
  for (const row of currentRows) {
    if (!row.id || currentById.has(row.id)) {
      throw new Error("O rascunho contém um ID de linha vazio ou duplicado.");
    }
    currentById.set(row.id, row);
  }

  const baselineById = new Map(baselineLines.map(line => [line.line_id, line]));
  const upserts: SharedDraftLineWrite[] = [];
  const deletes: SharedDraftLineDelete[] = [];

  for (const row of currentRows) {
    const baseline = baselineById.get(row.id);
    if (!baseline) {
      upserts.push({
        line_id: row.id,
        row_data: row,
        expected_line_revision: null,
      });
    } else if (!sharedDraftRowsEqual(row, baseline.row_data)) {
      upserts.push({
        line_id: row.id,
        row_data: row,
        expected_line_revision: baseline.line_revision,
      });
    }
  }

  for (const baseline of baselineLines) {
    if (!currentById.has(baseline.line_id)) {
      deletes.push({
        line_id: baseline.line_id,
        expected_line_revision: baseline.line_revision,
      });
    }
  }

  return { upserts, deletes };
}

export function parseSharedLancamentoDraftSnapshot(value: unknown): SharedLancamentoDraftSnapshot {
  const result = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const generationId = text(result.generation_id);
  const revision = Number(result.revision);
  const rawLines = result.lines;

  if (
    result.success !== true ||
    !generationId ||
    !Number.isSafeInteger(revision) || revision < 0 ||
    !Array.isArray(rawLines)
  ) {
    throw new Error("O Supabase retornou um formato inválido para o rascunho compartilhado.");
  }

  const seenIds = new Set<string>();
  const lines = rawLines.map((raw): SharedLancamentoDraftLine => {
    const line = raw && typeof raw === "object"
      ? raw as Record<string, unknown>
      : {};
    const lineId = text(line.line_id);
    const lineRevision = Number(line.line_revision);
    const sequence = Number(line.sequence);
    const rowData = normalizeLancamentoDraftRow(line.row_data);

    if (
      !lineId || lineId !== rowData.id || seenIds.has(lineId) ||
      !Number.isSafeInteger(lineRevision) || lineRevision < 1 ||
      !Number.isSafeInteger(sequence) || sequence < 1
    ) {
      throw new Error("O rascunho compartilhado contém uma linha inválida ou duplicada.");
    }
    seenIds.add(lineId);
    return {
      line_id: lineId,
      row_data: rowData,
      line_revision: lineRevision,
      sequence,
    };
  }).sort((a, b) => a.sequence - b.sequence);

  return {
    success: true,
    generation_id: generationId,
    revision,
    lines,
  };
}
