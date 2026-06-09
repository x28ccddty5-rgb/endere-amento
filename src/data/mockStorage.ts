import { Product, WarehouseSlot, LancamentoRow, HistoricoMov, Divergencia } from "../types";
import { PRODUCT_CATALOG, findProductInList } from "./products";

// Helper to generate a unique ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9).toUpperCase();
}

/**
 * Validates a single row of launch input:
 * - Data do lançamento: mandatory
 * - Estoque: mandatory (1, 2, 3)
 * - Módulo/Rua: mandatory (without R/M prefix under the hood, but normalized automatically if entered)
 *    Estoque 1: 1 to 22
 *    Estoque 2: 1 to 172
 *    Estoque 3: 1 to 112
 * - Posição: mandatory for Estoque 2 and 3 ONLY
 *    Estoque 2: A1-E1, A2-E2 (A1, B1, C1, D1, E1, A2, B2, C2, D2, E2)
 *    Estoque 3: A1-F1, A2-F2 (A1, B1, C1, D1, E1, F1, A2, B2, C2, D2, E2, F2)
 * - Ref (SKU): mandatory (automatically stripped of "S" if typed/pasted)
 * - Quantidade: mandatory & positive (saldo logistico em peças)
 * - Tipo: mandatory (Entrada/Saída)
 * - Data do chacote: optional
 * - Hora: mandatory
 * - Responsável: mandatory
 */
export interface RowValidationError {
  rowId: string;
  field: string;
  message: string;
}

export function validateLancamentoRow(row: LancamentoRow, rowNumber: number, productsList: Product[], isAdvanced = false): string[] {
  const errors: string[] = [];

  // 1. Data
  if (!row.data || !row.data.trim()) {
    errors.push(`Linha ${rowNumber}: Data do lançamento é obrigatória.`);
  }

  // 2. Estoque
  const est = row.estoque ? row.estoque.trim().toUpperCase().replace("E", "") : "";
  if (!est || !["1", "2", "3"].includes(est)) {
    errors.push(`Linha ${rowNumber}: Estoque é obrigatório e deve ser 1, 2 ou 3.`);
    return errors; // Stop here as coordinates depend on correct Estoque
  }

  // 3. Modulo (Rua for Estoque 1, Modulo for Estoque 2/3)
  const mod = row.modulo ? row.modulo.trim().toUpperCase().replace(/^[RM]/i, "") : "";
  if (!mod) {
    errors.push(`Linha ${rowNumber}: Módulo/Rua é obrigatório.`);
  } else {
    const modNum = parseInt(mod, 10);
    if (isNaN(modNum) || modNum <= 0) {
      errors.push(`Linha ${rowNumber}: Módulo/Rua deve ser um número inteiro.`);
    } else {
      if (est === "1" && (modNum < 1 || modNum > 22)) {
        errors.push(`Linha ${rowNumber}: Para o Estoque 1, o campo módulo/rua deve ser de 1 a 22.`);
      } else if (est === "2" && (modNum < 1 || modNum > 172)) {
        errors.push(`Linha ${rowNumber}: Para o Estoque 2, o módulo deve ser de 1 a 172.`);
      } else if (est === "3" && (modNum < 1 || modNum > 112)) {
        errors.push(`Linha ${rowNumber}: Para o Estoque 3, o módulo deve ser de 1 a 112.`);
      }
    }
  }

  // 4. Posição (Obrigatório apenas para Estoque 2 e 3; em corredor / vão livre no modo avançado pode vir vazio)
  const pos = row.posicao ? row.posicao.trim().toUpperCase() : "";
  if (est === "2") {
    const validPositionsE2 = ["A1", "B1", "C1", "D1", "E1", "A2", "B2", "C2", "D2", "E2"];
    if (!pos) {
      if (!isAdvanced) {
        errors.push(`Linha ${rowNumber}: Posição é obrigatória para o Estoque 2.`);
      }
    } else if (!validPositionsE2.includes(pos)) {
      errors.push(`Linha ${rowNumber}: Posição '${pos}' inválida para o Estoque 2. Escolha entre A1-E1 ou A2-E2.`);
    }
  } else if (est === "3") {
    const validPositionsE3 = ["A1", "B1", "C1", "D1", "E1", "F1", "A2", "B2", "C2", "D2", "E2", "F2"];
    if (!pos) {
      if (!isAdvanced) {
        errors.push(`Linha ${rowNumber}: Posição é obrigatória para o Estoque 3.`);
      }
    } else if (!validPositionsE3.includes(pos)) {
      errors.push(`Linha ${rowNumber}: Posição '${pos}' inválida para o Estoque 3. Escolha entre A1-F1 ou A2-F2.`);
    }
  } else {
    // Estoque 1
    if (pos) {
      errors.push(`Linha ${rowNumber}: Estoque 1 não possui posições definidas. Deixe o campo Posição vazio.`);
    }
  }

  // 5. Referência (SKU)
  const refRaw = row.referencia ? row.referencia.trim().toUpperCase() : "";
  if (!refRaw) {
    errors.push(`Linha ${rowNumber}: Código SKU (Referência) é obrigatório.`);
  } else {
    const prod = findProductInList(refRaw, productsList);
    if (!prod) {
      errors.push(`Linha ${rowNumber}: SKU '${refRaw}' não cadastrado na Base de dados.`);
    }
  }

  // 6. Quantidade
  if (row.quantidade === "" || isNaN(Number(row.quantidade)) || Number(row.quantidade) <= 0) {
    errors.push(`Linha ${rowNumber}: Quantidade é obrigatória e deve ser um número maior que zero.`);
  }

  // 7. Tipo
  if (!row.tipo || !["Entrada", "Saída"].includes(row.tipo)) {
    errors.push(`Linha ${rowNumber}: Tipo é obrigatório (Entrada ou Saída).`);
  }

  // 8. Hora
  if (!row.hora || !row.hora.trim()) {
    errors.push(`Linha ${rowNumber}: Hora do lançamento é obrigatória.`);
  }

  // 9. Responsável
  if (!row.responsavel || !row.responsavel.trim()) {
    errors.push(`Linha ${rowNumber}: Responsável do lançamento é obrigatório.`);
  }

  return errors;
}

// Generate pre-populated initial warehouse slots with cleaner structure (no E/M/R prefixes)
export function getInitialWarehouseSlots(): WarehouseSlot[] {
  return [];
}

// Generate pre-loaded history records matching Anexo 2 exactly
export function getInitialHistory(slots: WarehouseSlot[]): HistoricoMov[] {
  return [];
}

// Generate initial mock divergence logs matching Anexo 3 exactly
export function getInitialDivergencias(): Divergencia[] {
  return [];
}

// Sequence Batch Processor logic updated to plain numbers
export interface ProcessResult {
  updatedSlots: WarehouseSlot[];
  newHistory: HistoricoMov[];
  newDivergencias: Divergencia[];
  processedCount: number;
  errorCount: number;
}

export function processLancamentosInSequence(
  rows: LancamentoRow[],
  currentSlots: WarehouseSlot[],
  batchOperator: string,
  batchDate: string,
  allDivergencias: Divergencia[],
  productsList: Product[],
  isAdvanced = false
): ProcessResult {
  // 1. Deep clone current slots and prepare history and divergence arrays
  const slots = JSON.parse(JSON.stringify(currentSlots)) as WarehouseSlot[];
  const newHistory: HistoricoMov[] = [];
  const newDivergencias: Divergencia[] = [];

  // Filter out invalid rows of batch
  const validRows = rows.filter(row => {
    const errors = validateLancamentoRow(row, 0, productsList, isAdvanced);
    return errors.length === 0;
  });

  // 2. Sort chronologically by date and hour to process sequentially
  const sortedRows = [...validRows].sort((a, b) => {
    const dateTimeA = `${a.data}T${a.hora || "00:00"}`;
    const dateTimeB = `${b.data}T${b.hora || "00:00"}`;
    return dateTimeA.localeCompare(dateTimeB);
  });

  let processedCount = 0;
  let errorCount = 0;

  for (const row of sortedRows) {
    const qty = Number(row.quantidade);
    const prod = findProductInList(row.referencia, productsList);

    if (!prod) continue;
    const refUpper = prod.referencia.toUpperCase();

    // Normalizations for stockage references
    const estVal = row.estoque.trim().toUpperCase().replace("E", "");
    const modVal = row.modulo.trim().toUpperCase().replace(/^[RM]/i, "");

    // If pos is omitted or empty, or stock is E1, it's a corridor slot (empty string position)
    const posVal = (estVal === "1" || !row.posicao || row.posicao.trim() === "") ? "" : row.posicao.trim().toUpperCase();

    // Locate matching slot
    let slotIdx = slots.findIndex(s => 
      s.estoque === estVal && 
      s.modulo === modVal && 
      s.posicao === posVal
    );

    // If slot doesn't exist, create it on the fly
    let slot: WarehouseSlot;
    if (slotIdx === -1) {
      slot = {
        id: `${estVal}-${modVal}-${posVal}`,
        estoque: estVal,
        modulo: modVal,
        posicao: posVal,
        referencia: "",
        descricao: "",
        saldo: 0,
        dataChacote: "",
        ultimaData: "",
        ultimaHora: "",
        ultimoResponsavel: "",
      };
      slots.push(slot);
    } else {
      slot = slots[slotIdx];
    }

    const currentRef = slot.referencia;
    const currentSaldo = slot.saldo;

    if (row.tipo === "Entrada") {
      // Slot is either empty OR occupied by the same reference
      if (currentRef === "" || currentRef.trim().toUpperCase() === refUpper) {
        slot.referencia = prod.referencia;
        slot.descricao = prod.descricao;
        slot.saldo += qty;
        if (row.dataChacote) slot.dataChacote = row.dataChacote;
        slot.ultimaData = row.data;
        slot.ultimaHora = row.hora || "00:00";
        slot.ultimoResponsavel = row.responsavel || batchOperator;

        newHistory.push({
          id: `MOV-${generateId()}`,
          dataLancamento: batchDate,
          quemLancou: batchOperator,
          data: row.data,
          estoque: estVal,
          modulo: modVal,
          posicao: posVal,
          referencia: prod.referencia,
          quantidade: qty,
          tipo: "Entrada",
          dataChacote: row.dataChacote,
          hora: row.hora || "00:00",
          responsavel: row.responsavel || batchOperator
        });

        processedCount++;
      } else {
        // Slot is occupied by a DIFFERENT product reference (Divergence created)
        errorCount++;
        const divId = `DIV-${generateId()}`;
        newDivergencias.push({
          id: divId,
          dataDivergencia: batchDate,
          tipoDivergencia: "Posição Ocupada",
          estoque: estVal,
          modulo: modVal,
          posicao: posVal,
          refAtual: currentRef,
          refNova: prod.referencia,
          saldoAntes: currentSaldo,
          movimentacao: qty,
          saldoFinal: currentSaldo, // unchanged
          responsavel: row.responsavel || batchOperator,
          status: "Aberta",
          observacao: `Posição já ocupada por ${currentRef} (${slot.descricao}). Tentativa de entrada de ${qty} pçs de ${prod.referencia}.`
        });
      }
    } else {
      // tipo === "Saída"
      if (currentRef === "" || currentRef.trim().toUpperCase() !== refUpper) {
        errorCount++;
        const divId = `DIV-${generateId()}`;
        newDivergencias.push({
          id: divId,
          dataDivergencia: batchDate,
          tipoDivergencia: "Referência Divergente",
          estoque: estVal,
          modulo: modVal,
          posicao: posVal,
          refAtual: currentRef || "Vazio",
          refNova: prod.referencia,
          saldoAntes: currentSaldo,
          movimentacao: -qty,
          saldoFinal: currentSaldo,
          responsavel: row.responsavel || batchOperator,
          status: "Aberta",
          observacao: `Tentativa de saída do item ${prod.referencia} em posição ocupada por ${currentRef || "Vazio"}.`
        });
      } else if (currentSaldo < qty) {
        errorCount++;
        const divId = `DIV-${generateId()}`;
        newDivergencias.push({
          id: divId,
          dataDivergencia: batchDate,
          tipoDivergencia: "Saldo Insuficiente",
          estoque: estVal,
          modulo: modVal,
          posicao: posVal,
          refAtual: currentRef,
          refNova: prod.referencia,
          saldoAntes: currentSaldo,
          movimentacao: -qty,
          saldoFinal: currentSaldo,
          responsavel: row.responsavel || batchOperator,
          status: "Aberta",
          observacao: `Solicitada saída de ${qty} pçs de ${prod.referencia} mas o saldo atual é de apenas ${currentSaldo} pçs.`
        });
      } else {
        slot.saldo -= qty;
        slot.ultimaData = row.data;
        slot.ultimaHora = row.hora || "00:00";
        slot.ultimoResponsavel = row.responsavel || batchOperator;

        if (slot.saldo === 0) {
          slot.referencia = "";
          slot.descricao = "";
          slot.dataChacote = "";
        }

        newHistory.push({
          id: `MOV-${generateId()}`,
          dataLancamento: batchDate,
          quemLancou: batchOperator,
          data: row.data,
          estoque: estVal,
          modulo: modVal,
          posicao: posVal,
          referencia: prod.referencia,
          quantidade: qty,
          tipo: "Saída",
          dataChacote: row.dataChacote,
          hora: row.hora || "00:00",
          responsavel: row.responsavel || batchOperator
        });

        processedCount++;
      }
    }
  }

  return {
    updatedSlots: slots,
    newHistory,
    newDivergencias,
    processedCount,
    errorCount
  };
}
