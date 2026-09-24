import { Product, WarehouseSlot, LancamentoRow, HistoricoMov, Divergencia, Restricao } from "../types";
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

const normalizeEstoque = (value: string): string =>
  value.trim().toUpperCase().replace(/^E/, "");

const normalizeModulo = (value: string): string =>
  value.trim().toUpperCase().replace(/^[RM]/i, "");

const normalizePosicao = (value: string): string =>
  value.trim().toUpperCase();

const normalizeRestricao = (value?: string): Restricao =>
  value === "teste" || value === "autorizacao" || value === "outra"
    ? value
    : "nenhuma";

const isE2E3 = (estoque: string): boolean =>
  estoque === "2" || estoque === "3";

const isAuxiliarySlotId = (id: string): boolean =>
  id.includes("::ITEM::");

const buildAddressId = (
  estoque: string,
  modulo: string,
  posicao: string
): string => `${estoque}-${modulo}-${posicao}`;

const buildItemId = (
  addressId: string,
  referencia: string,
  restricao: Restricao
): string =>
  `${addressId}::ITEM::${referencia.toUpperCase()}::${restricao}`;

const sameAddress = (
  slot: WarehouseSlot,
  estoque: string,
  modulo: string,
  posicao: string
): boolean =>
  slot.estoque === estoque &&
  sameNumericModule(slot.modulo, modulo) &&
  slot.posicao === posicao;

const sameLogicalItem = (
  slot: WarehouseSlot,
  estoque: string,
  modulo: string,
  posicao: string,
  referencia: string,
  restricao: Restricao
): boolean =>
  sameAddress(slot, estoque, modulo, posicao) &&
  slot.referencia.trim().toUpperCase() === referencia.toUpperCase() &&
  normalizeRestricao(slot.restricao) === restricao;

const getDivergenceBlockKey = (
  estoque: string,
  modulo: string,
  posicao: string,
  referencia = "",
  restricao: Restricao = "nenhuma"
): string => {
  const est = normalizeEstoque(estoque);
  const mod = normalizeModulo(modulo);
  const pos = normalizePosicao(posicao);
  const ref = referencia.trim().toUpperCase().replace(/^S/, "");

  if (est === "1") {
    return `ITEM|E1|${mod}|${ref}`;
  }

  return `ITEM|E${est}|${mod}|${pos}|${ref}|${restricao}`;
};

const getLegacyAddressBlockKey = (
  estoque: string,
  modulo: string,
  posicao: string
): string =>
  `ADDRESS|E${normalizeEstoque(estoque)}|${normalizeModulo(modulo)}|${normalizePosicao(posicao)}`;

const getExistingDivergenceBlocks = (
  divergencia: Divergencia
): { itemKey?: string; addressKey?: string } => {
  const est = normalizeEstoque(divergencia.estoque);

  // Divergences created before multi-SKU support did not have restriction/slotId.
  // They are kept conservative and continue to block the whole physical address.
  if (isE2E3(est) && !divergencia.restricao && !divergencia.slotId) {
    return {
      addressKey: getLegacyAddressBlockKey(
        est,
        divergencia.modulo,
        divergencia.posicao
      ),
    };
  }

  const referencia =
    divergencia.refNova?.trim() &&
    divergencia.refNova.trim().toLowerCase() !== "vazio"
      ? divergencia.refNova
      : divergencia.refAtual;

  return {
    itemKey: getDivergenceBlockKey(
      est,
      divergencia.modulo,
      divergencia.posicao,
      referencia || "",
      normalizeRestricao(divergencia.restricao)
    ),
  };
};

const clearSlotAfterDivergence = (
  slot: WarehouseSlot,
  row: LancamentoRow,
  batchOperator: string
): void => {
  slot.referencia = "";
  slot.descricao = "";
  slot.saldo = 0;
  slot.dataChacote = "";
  slot.observacao = "";
  slot.ultimaData = row.data;
  slot.ultimaHora = row.hora || "00:00";
  slot.ultimoResponsavel = row.responsavel || batchOperator;
};

export function processLancamentosInSequence(
  rows: LancamentoRow[],
  currentSlots: WarehouseSlot[],
  batchOperator: string,
  batchDate: string,
  allDivergencias: Divergencia[],
  productsList: Product[],
  isAdvanced = false
): ProcessResult {
  const slots = JSON.parse(JSON.stringify(currentSlots)) as WarehouseSlot[];
  const newHistory: HistoricoMov[] = [];
  const newDivergencias: Divergencia[] = [];

  void isAdvanced;

  const blockedItemKeys = new Set<string>();
  const blockedAddressKeys = new Set<string>();
  const blockedItemSlots = new Map<string, {
    slotId?: string;
    refAtual: string;
    saldoAntes: number;
  }>();

  allDivergencias
    .filter(div => div.status === "Aberta")
    .forEach(div => {
      const blocks = getExistingDivergenceBlocks(div);
      if (blocks.addressKey) blockedAddressKeys.add(blocks.addressKey);
      if (blocks.itemKey) {
        blockedItemKeys.add(blocks.itemKey);
        blockedItemSlots.set(blocks.itemKey, {
          slotId: div.slotId,
          refAtual: div.refAtual || "Vazio",
          saldoAntes: div.saldoAntes || 0,
        });
      }
    });

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
    const estVal = normalizeEstoque(row.estoque);
    const modVal = normalizeModulo(row.modulo);
    const posVal =
      estVal === "1" || !row.posicao || row.posicao.trim() === ""
        ? ""
        : normalizePosicao(row.posicao);
    const requestedRestricao = normalizeRestricao(row.restricao);
    const itemBlockKey = getDivergenceBlockKey(
      estVal,
      modVal,
      posVal,
      refUpper,
      requestedRestricao
    );
    const addressBlockKey = getLegacyAddressBlockKey(estVal, modVal, posVal);

    const addressSlots = slots.filter(slot =>
      sameAddress(slot, estVal, modVal, posVal)
    );

    let exactSlotIdx = slots.findIndex(slot =>
      sameLogicalItem(
        slot,
        estVal,
        modVal,
        posVal,
        refUpper,
        requestedRestricao
      )
    );

    const exactSlot = exactSlotIdx >= 0 ? slots[exactSlotIdx] : undefined;

    const createDivergence = (
      tipoDivergencia: Divergencia["tipoDivergencia"],
      observation: string,
      movimentacao: number,
      targetSlot?: WarehouseSlot,
      clearTarget = false,
      explicitRefAtual?: string,
      explicitSaldoAntes?: number
    ) => {
      errorCount++;

      const refAtual =
        explicitRefAtual ??
        targetSlot?.referencia ??
        (addressSlots.find(slot => slot.saldo > 0)?.referencia || "Vazio");

      const saldoAntes =
        explicitSaldoAntes ??
        targetSlot?.saldo ??
        (addressSlots.find(slot => slot.saldo > 0)?.saldo || 0);

      if (targetSlot && clearTarget) {
        clearSlotAfterDivergence(targetSlot, row, batchOperator);
      }

      const divId = `DIV-${generateId()}`;

      newDivergencias.push({
        id: divId,
        dataDivergencia: batchDate,
        tipoDivergencia,
        estoque: estVal,
        modulo: modVal,
        posicao: posVal,
        refAtual: refAtual || "Vazio",
        refNova: prod.referencia,
        saldoAntes,
        movimentacao,
        saldoFinal: saldoAntes,
        responsavel: row.responsavel || batchOperator,
        status: "Aberta",
        dataChacote: targetSlot?.dataChacote || row.dataChacote || "",
        observacao: observation,
        slotId: targetSlot?.id,
        restricao: requestedRestricao,
      });

      blockedItemKeys.add(itemBlockKey);
      blockedItemSlots.set(itemBlockKey, {
        slotId: targetSlot?.id,
        refAtual: refAtual || "Vazio",
        saldoAntes,
      });
    };

    // Legacy address-level divergences remain conservative for compatibility.
    if (blockedAddressKeys.has(addressBlockKey)) {
      createDivergence(
        "Posição Bloqueada por Divergência",
        `A posição ${estVal}-${modVal}-${posVal || "Corredor"} possui uma divergência aberta anterior. ` +
        `A movimentação de ${qty} pçs de ${prod.referencia} não foi aplicada.`,
        row.tipo === "Saída" ? -qty : qty
      );
      continue;
    }

    // New divergences are item-specific. A second movement for the same
    // SKU/restriction is blocked, while other restricted items at the same
    // physical address remain operational.
    if (blockedItemKeys.has(itemBlockKey)) {
      const blocked = blockedItemSlots.get(itemBlockKey);
      createDivergence(
        "Item Bloqueado por Divergência",
        `O item ${prod.referencia} / ${requestedRestricao} já possui uma divergência aberta. ` +
        `A movimentação de ${qty} pçs não foi aplicada e também foi registrada como divergência.`,
        row.tipo === "Saída" ? -qty : qty,
        blocked?.slotId
          ? slots.find(slot => slot.id === blocked.slotId)
          : undefined,
        false,
        blocked?.refAtual,
        blocked?.saldoAntes
      );
      continue;
    }

    if (estVal === "1") {
      // Preserve the existing E1 behavior exactly: one logical row per SKU.
      exactSlotIdx = slots.findIndex(slot =>
        slot.estoque === "1" &&
        slot.modulo === modVal &&
        slot.referencia.toUpperCase() === refUpper
      );
    }

    if (row.tipo === "Entrada") {
      if (estVal === "1") {
        if (exactSlotIdx === -1) {
          const newSlot: WarehouseSlot = {
            id: `${estVal}-${modVal}-${refUpper}`,
            estoque: estVal,
            modulo: modVal,
            posicao: "",
            referencia: "",
            descricao: "",
            saldo: 0,
            dataChacote: "",
            ultimaData: "",
            ultimaHora: "",
            ultimoResponsavel: "",
            galpao: row.galpao || "3",
            restricao: requestedRestricao,
            observacao: row.observacao?.trim() || "",
          };
          slots.push(newSlot);
          exactSlotIdx = slots.length - 1;
        }
      } else {
        const occupiedAtAddress = addressSlots.filter(slot => slot.saldo > 0);

        // Normal pallets cannot share an address with restricted pallets and
        // restricted pallets cannot share an address with a normal pallet.
        const hasNormal = occupiedAtAddress.some(
          slot => normalizeRestricao(slot.restricao) === "nenhuma"
        );
        const hasRestricted = occupiedAtAddress.some(
          slot => normalizeRestricao(slot.restricao) !== "nenhuma"
        );

        if (
          (requestedRestricao === "nenhuma" &&
            occupiedAtAddress.length > 0 &&
            exactSlotIdx === -1) ||
          (requestedRestricao === "nenhuma" && hasRestricted) ||
          (requestedRestricao !== "nenhuma" && hasNormal)
        ) {
          createDivergence(
            "Classificação Incompatível",
            requestedRestricao === "nenhuma"
              ? `A posição ${estVal}-${modVal}-${posVal} já possui outro item. ` +
                "Estoque normal sem restrição não pode compartilhar a posição com outro SKU."
              : `A posição ${estVal}-${modVal}-${posVal} já contém ` +
                "palete(s) sem restrição. Não é permitido misturar estoque normal e restrito na mesma posição.",
            qty
          );
          continue;
        }

        if (exactSlotIdx === -1) {
          // Reuse an empty auxiliary row first, then the physical base row.
          // This avoids unbounded row growth because DELETE is not enabled by
          // the current slots RLS policy.
          const reusableIdx = slots.findIndex(slot =>
            sameAddress(slot, estVal, modVal, posVal) &&
            slot.saldo === 0 &&
            (isAuxiliarySlotId(slot.id) || slot.id === buildAddressId(estVal, modVal, posVal))
          );

          if (reusableIdx >= 0) {
            exactSlotIdx = reusableIdx;
          } else {
            const baseAddressId = buildAddressId(estVal, modVal, posVal);
            const newSlot: WarehouseSlot = {
              id: buildItemId(baseAddressId, refUpper, requestedRestricao),
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
              galpao: row.galpao || "3",
              restricao: requestedRestricao,
              observacao: row.observacao?.trim() || "",
            };
            slots.push(newSlot);
            exactSlotIdx = slots.length - 1;
          }
        }
      }

      const activeSlot = slots[exactSlotIdx];
      const hadExistingStock = activeSlot.referencia !== "" && activeSlot.saldo > 0;

      if (!hadExistingStock) {
        activeSlot.galpao = row.galpao || activeSlot.galpao || "3";
        activeSlot.restricao = requestedRestricao;
        activeSlot.observacao = row.observacao?.trim() || "";
      }

      activeSlot.referencia = prod.referencia;
      activeSlot.descricao = prod.descricao;
      activeSlot.saldo += qty;

      if (!hadExistingStock && row.dataChacote) {
        activeSlot.dataChacote = row.dataChacote;
      }

      activeSlot.ultimaData = row.data;
      activeSlot.ultimaHora = row.hora || "00:00";
      activeSlot.ultimoResponsavel = row.responsavel || batchOperator;

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
        dataChacote: activeSlot.dataChacote,
        hora: row.hora || "00:00",
        responsavel: row.responsavel || batchOperator,
        galpao: activeSlot.galpao || row.galpao || "3",
        observacao: row.observacao?.trim() || "",
        slotId: activeSlot.id,
        restricao: normalizeRestricao(activeSlot.restricao),
      });

      processedCount++;
      continue;
    }

    // Saída: in E2/E3 the requested SKU + restriction identifies the exact item.
    if (exactSlotIdx === -1) {
      createDivergence(
        "Referência Divergente",
        `Não existe o item ${prod.referencia} / ${requestedRestricao} na posição ` +
        `${estVal}-${modVal}-${posVal}. A movimentação não foi aplicada.`,
        -qty
      );
      continue;
    }

    const activeSlot = slots[exactSlotIdx];
    const currentRef = activeSlot.referencia;
    const currentSaldo = activeSlot.saldo;

    if (currentSaldo < qty) {
      createDivergence(
        "Saldo Insuficiente",
        `Solicitada saída de ${qty} pçs de ${prod.referencia} / ${requestedRestricao}, ` +
        `mas o saldo atual deste item é de apenas ${currentSaldo} pçs. ` +
        "Somente este item foi limpo e bloqueado para correção.",
        -qty,
        activeSlot,
        true
      );
      continue;
    }

    const registeredChacote = activeSlot.dataChacote;

    activeSlot.saldo -= qty;
    activeSlot.ultimaData = row.data;
    activeSlot.ultimaHora = row.hora || "00:00";
    activeSlot.ultimoResponsavel = row.responsavel || batchOperator;

    if (activeSlot.saldo === 0) {
      activeSlot.referencia = "";
      activeSlot.descricao = "";
      activeSlot.dataChacote = "";
      activeSlot.galpao = "3";
      activeSlot.restricao = "nenhuma";
      activeSlot.observacao = "";
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
      dataChacote: registeredChacote,
      hora: row.hora || "00:00",
      responsavel: row.responsavel || batchOperator,
      galpao: activeSlot.galpao || row.galpao || "3",
      observacao: row.observacao?.trim() || "",
      slotId: activeSlot.id,
      restricao: requestedRestricao,
    });

    processedCount++;
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
  destination.galpao = source.galpao || "3";
  destination.restricao = source.restricao || "nenhuma";
  destination.observacao = source.observacao || "";
  destination.ultimaData = movementDate;
  destination.ultimaHora = hour;
  destination.ultimoResponsavel = operator;

  source.referencia = "";
  source.descricao = "";
  source.saldo = 0;
  source.dataChacote = "";
  source.galpao = "3";
  source.restricao = "nenhuma";
  source.observacao = "";
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
      galpao: source.galpao || "3",
      observacao: "",
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
      galpao: destination.galpao || source.galpao || "3",
      observacao: "",
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