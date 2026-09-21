import { Product, WarehouseSlot, LancamentoRow, HistoricoMov, Divergencia } from "../types";
import { findProductInList } from "./products";
import { E1_CAPACITY } from "../constants/layout";

// Helper to generate a unique ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9).toUpperCase();
}

const sameNumericModule = (left: string, right: string): boolean => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    leftNumber === rightNumber;
};

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

export function validateLancamentoRow(
  row: LancamentoRow,
  rowNumber: number,
  productsList: Product[],
  isAdvanced = false,
  currentSlots?: WarehouseSlot[]
): string[] {
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
      if (!isAdvanced || currentSlots) {
        errors.push(`Linha ${rowNumber}: Posição é obrigatória para o Estoque 2.`);
      }
    } else if (!validPositionsE2.includes(pos)) {
      errors.push(`Linha ${rowNumber}: Posição '${pos}' inválida para o Estoque 2. Escolha entre A1-E1 ou A2-E2.`);
    }
  } else if (est === "3") {
    const validPositionsE3 = ["A1", "B1", "C1", "D1", "E1", "F1", "A2", "B2", "C2", "D2", "E2", "F2"];
    if (!pos) {
      if (!isAdvanced || currentSlots) {
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

  if (currentSlots && est === "1" && mod && !Object.prototype.hasOwnProperty.call(E1_CAPACITY, String(Number(mod)))) {
    errors.push(
      `Linha ${rowNumber}: o corredor ${mod} não está cadastrado no Estoque 1.`
    );
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
  // The caller is responsible for validating the rows before processing.
  // Do not validate the batch again here: the processor must operate on the
  // already-approved rows while maintaining a progressively updated state.
  const slots = JSON.parse(JSON.stringify(currentSlots)) as WarehouseSlot[];
  const newHistory: HistoricoMov[] = [];
  const newDivergencias: Divergencia[] = [];

  // Keep the parameter for API compatibility with the existing callers.
  void allDivergencias;
  void isAdvanced;

  // Process chronologically so that each row sees the state produced by the
  // previous successful row in the same batch.
  const sortedRows = [...rows].sort((a, b) => {
    const dateTimeA = `${a.data}T${a.hora || "00:00"}`;
    const dateTimeB = `${b.data}T${b.hora || "00:00"}`;
    return dateTimeA.localeCompare(dateTimeB);
  });

  let processedCount = 0;
  let errorCount = 0;

  for (const row of sortedRows) {
    const qty = Number(row.quantidade);
    const prod = findProductInList(row.referencia, productsList);

    if (!prod || !Number.isInteger(qty) || qty <= 0) {
      errorCount++;
      continue;
    }

    const refUpper = prod.referencia.toUpperCase();

    // Normalizations for storage references.
    const estVal = row.estoque.trim().toUpperCase().replace("E", "");
    const modVal = row.modulo.trim().toUpperCase().replace(/^[RM]/i, "");

    // E1 is a corridor ledger and does not use a physical position.
    // E2/E3 require the registered physical position.
    const posVal =
      estVal === "1" || !row.posicao || row.posicao.trim() === ""
        ? ""
        : row.posicao.trim().toUpperCase();

    let slotIdx = slots.findIndex((s) => {
      if (estVal === "1") {
        return (
          s.estoque === estVal &&
          s.modulo === modVal &&
          s.referencia.toUpperCase() === refUpper
        );
      }

      return (
        s.estoque === estVal &&
        sameNumericModule(s.modulo, modVal) &&
        s.posicao === posVal
      );
    });

    // E1 is a corridor ledger and can legitimately add a new SKU row.
    // E2/E3 are physical address registries and must never create positions
    // implicitly.
    let slot: WarehouseSlot;

    if (slotIdx === -1) {
      if (estVal !== "1") {
        errorCount++;
        continue;
      }

      slot = {
        id: `${estVal}-${modVal}-${refUpper}`,
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
      slotIdx = slots.length - 1;
    } else {
      slot = slots[slotIdx];
    }

    const currentRef = slot.referencia;
    const currentSaldo = slot.saldo;

    if (row.tipo === "Entrada") {
      // Slot is either empty or already contains the same reference.
      if (
        currentRef === "" ||
        currentRef.trim().toUpperCase() === refUpper
      ) {
        const hadExistingStock = currentRef !== "" && currentSaldo > 0;

        slot.referencia = prod.referencia;
        slot.descricao = prod.descricao;
        slot.saldo += qty;

        // The registered chacote date belongs to the physical position.
        // Once the position already has stock, adding another mixed lot does
        // not replace that registered date.
        if (!hadExistingStock && row.dataChacote) {
          slot.dataChacote = row.dataChacote;
        }

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
          // History records the chacote date actually registered on the slot.
          dataChacote: slot.dataChacote,
          hora: row.hora || "00:00",
          responsavel: row.responsavel || batchOperator,
        });

        processedCount++;
      } else {
        // Slot is occupied by a different product reference.
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
          saldoFinal: currentSaldo,
          responsavel: row.responsavel || batchOperator,
          status: "Aberta",
          observacao: `Posição já ocupada por ${currentRef} (${slot.descricao}). Tentativa de entrada de ${qty} pçs de ${prod.referencia}.`,
        });
      }
    } else {
      // Saída.
      if (
        currentRef === "" ||
        currentRef.trim().toUpperCase() !== refUpper
      ) {
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
          observacao: `Tentativa de saída do item ${prod.referencia} em posição ocupada por ${currentRef || "Vazio"}.`,
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
          observacao: `Solicitada saída de ${qty} pçs de ${prod.referencia} mas o saldo atual é de apenas ${currentSaldo} pçs.`,
        });
      } else {
        // Capture the registered position chacote before the stock can become
        // empty and clear the position.
        const registeredChacote = slot.dataChacote;

        slot.saldo -= qty;
        slot.ultimaData = row.data;
        slot.ultimaHora = row.hora || "00:00";
        slot.ultimoResponsavel = row.responsavel || batchOperator;

        // If the position becomes empty, its registered chacote is no longer
        // applicable and the position becomes available for a new stock/date.
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
          // Preserve the date that was registered on the physical
          // position before this movement. If the position is emptied,
          // the slot itself is cleared, but the movement history keeps
          // the date that was actually registered on that stock.
          dataChacote: registeredChacote,
          hora: row.hora || "00:00",
          responsavel: row.responsavel || batchOperator,
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
    errorCount,
  };
}

/**
 * Transfers the complete registered stock from one physical position to
 * another position without changing reference, quantity or registered
 * chacote date. Only the location changes.
 *
 * The destination must already exist and be empty. E2/E3 positions are never
 * created implicitly by this operation.
 */
export function processTransferenciaPosicao(
  sourceId: string,
  destinationId: string,
  currentSlots: WarehouseSlot[],
  operator: string,
  movementDate: string
): ProcessResult {
  const slots = JSON.parse(JSON.stringify(currentSlots)) as WarehouseSlot[];
  const newHistory: HistoricoMov[] = [];

  const source = slots.find((slot) => slot.id === sourceId);
  const destination = slots.find((slot) => slot.id === destinationId);

  if (!source || !destination) {
    return {
      updatedSlots: currentSlots,
      newHistory: [],
      newDivergencias: [],
      processedCount: 0,
      errorCount: 1,
    };
  }

  if (source.id === destination.id) {
    return {
      updatedSlots: currentSlots,
      newHistory: [],
      newDivergencias: [],
      processedCount: 0,
      errorCount: 1,
    };
  }

  if (source.estoque !== destination.estoque) {
    return {
      updatedSlots: currentSlots,
      newHistory: [],
      newDivergencias: [],
      processedCount: 0,
      errorCount: 1,
    };
  }

  if (!source.referencia || source.saldo <= 0) {
    return {
      updatedSlots: currentSlots,
      newHistory: [],
      newDivergencias: [],
      processedCount: 0,
      errorCount: 1,
    };
  }

  if (destination.saldo !== 0 || destination.referencia) {
    return {
      updatedSlots: currentSlots,
      newHistory: [],
      newDivergencias: [],
      processedCount: 0,
      errorCount: 1,
    };
  }

  const quantity = source.saldo;
  const reference = source.referencia;
  const description = source.descricao;
  const chacote = source.dataChacote;
  const hour = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  destination.referencia = reference;
  destination.descricao = description;
  destination.saldo = quantity;
  destination.dataChacote = chacote;
  destination.ultimaData = movementDate;
  destination.ultimaHora = hour;
  destination.ultimoResponsavel = operator;

  source.referencia = "";
  source.descricao = "";
  source.saldo = 0;
  source.dataChacote = "";
  source.ultimaData = movementDate;
  source.ultimaHora = hour;
  source.ultimoResponsavel = operator;

  // The existing history schema only has Entrada/Saída. Represent the
  // physical relocation as a paired saída/entrada while keeping the total
  // stock unchanged and preserving the registered chacote date.
  newHistory.push(
    {
      id: `MOV-${generateId()}`,
      dataLancamento: movementDate,
      quemLancou: operator,
      data: movementDate,
      estoque: source.estoque,
      modulo: source.modulo,
      posicao: source.posicao,
      referencia: reference,
      quantidade: quantity,
      tipo: "Saída",
      dataChacote: chacote,
      hora: hour,
      responsavel: operator,
    },
    {
      id: `MOV-${generateId()}`,
      dataLancamento: movementDate,
      quemLancou: operator,
      data: movementDate,
      estoque: destination.estoque,
      modulo: destination.modulo,
      posicao: destination.posicao,
      referencia: reference,
      quantidade: quantity,
      tipo: "Entrada",
      dataChacote: chacote,
      hora: hour,
      responsavel: operator,
    }
  );

  return {
    updatedSlots: slots,
    newHistory,
    newDivergencias: [],
    processedCount: 1,
    errorCount: 0,
  };
}
