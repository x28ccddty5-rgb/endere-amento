import type { HistoricoMov, Product, Restricao, WarehouseSlot } from "../types";
import { getAuxiliarySlotIdentity, getSlotIdentityMismatch } from "../data/mockStorage";

export interface MapQuickCorrectionPlanInput {
  slots: WarehouseSlot[];
  requestedSlot: WarehouseSlot;
  productsList: Product[];
  operator: string;
  date: string;
  time: string;
  createHistoryId: () => string;
  createCorrectionId?: () => string | null;
}

export type MapQuickCorrectionPlanResult =
  | { ok: true; updatedSlots: WarehouseSlot[]; history: HistoricoMov[]; selectedSlotId: string | null }
  | { ok: false; reason: string };

const MAX_DATABASE_INTEGER = 2_147_483_647;

const normalizeStock = (value: string): string =>
  String(value ?? "").trim().toUpperCase().replace(/^E/i, "");

const normalizeModule = (value: string): string => {
  const raw = String(value ?? "").trim().toUpperCase().replace(/^[RM]/i, "");
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
};

const normalizePosition = (value?: string): string => String(value ?? "").trim().toUpperCase();

const normalizeReference = (value?: string): string => String(value ?? "").trim().toUpperCase();

const normalizeRestriction = (value?: string): Restricao =>
  value === "teste" || value === "autorizacao" || value === "outra" ? value : "nenhuma";

export const isMapQuickCorrectionSnapshotCurrent = (
  slots: WarehouseSlot[],
  expectedSlot: WarehouseSlot,
): boolean => {
  const matches = slots.filter(slot => slot.id === expectedSlot.id);
  return matches.length === 1 && JSON.stringify(matches[0]) === JSON.stringify(expectedSlot);
};

const sameScope = (a: WarehouseSlot, b: WarehouseSlot): boolean => {
  const stockA = normalizeStock(a.estoque);
  const stockB = normalizeStock(b.estoque);
  if (stockA !== stockB || normalizeModule(a.modulo) !== normalizeModule(b.modulo)) return false;
  return stockA === "1" || normalizePosition(a.posicao) === normalizePosition(b.posicao);
};

const blankIdentity = (slot: WarehouseSlot, date: string, time: string, operator: string): WarehouseSlot => {
  const encodedRestriction = getAuxiliarySlotIdentity(slot.id)?.restricao;
  return {
    ...slot,
    referencia: "",
    descricao: "",
    saldo: 0,
    dataChacote: "",
    ultimaData: date,
    ultimaHora: time,
    ultimoResponsavel: operator,
    galpao: "3",
    restricao: encodedRestriction ?? normalizeRestriction(slot.restricao),
    observacao: "",
  };
};

export const buildMapQuickCorrectionPlan = (
  input: MapQuickCorrectionPlanInput,
): MapQuickCorrectionPlanResult => {
  const { slots, requestedSlot, productsList, operator, date, time } = input;
  const selectedMatches = slots.filter(slot => slot.id === requestedSlot.id);
  if (selectedMatches.length !== 1) {
    return { ok: false, reason: "O endereço selecionado não está mais disponível no estado atual. Atualize o mapa antes de corrigir." };
  }

  const current = selectedMatches[0];
  const stock = normalizeStock(current.estoque);
  const module = normalizeModule(current.modulo);
  const position = normalizePosition(current.posicao);
  if (!(["1", "2", "3"] as string[]).includes(stock) || !/^\d+$/.test(module) || Number(module) <= 0) {
    return { ok: false, reason: "O endereço selecionado não está em formato canônico. Nenhum dado foi alterado." };
  }
  if (current.estoque !== stock || current.modulo !== module || (stock === "1" ? current.posicao !== "" : current.posicao !== position)) {
    return { ok: false, reason: "O endereço selecionado possui estoque, módulo ou posição fora do padrão. Corrija a identidade antes de usar o mapa." };
  }
  if (getSlotIdentityMismatch(current)) {
    return { ok: false, reason: `A identidade atual do endereço é inconsistente: ${getSlotIdentityMismatch(current)}. Nenhum dado foi alterado.` };
  }

  const requestedQuantity = Number(requestedSlot.saldo);
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 0 || requestedQuantity > MAX_DATABASE_INTEGER) {
    return { ok: false, reason: "Informe um saldo inteiro, maior ou igual a zero e dentro do limite aceito pelo banco." };
  }

  const currentReference = normalizeReference(current.referencia);
  const currentQuantity = Number(current.saldo || 0);
  if (!Number.isSafeInteger(currentQuantity) || currentQuantity < 0 || currentQuantity > MAX_DATABASE_INTEGER || (currentQuantity > 0 && !currentReference)) {
    return { ok: false, reason: "O saldo ou SKU atual do endereço é inconsistente. Nenhum dado foi alterado." };
  }

  // The UI intentionally treats a zero count as an empty logical identity.
  const targetReference = requestedQuantity > 0 ? normalizeReference(requestedSlot.referencia) : "";
  if (requestedQuantity > 0 && !targetReference) {
    return { ok: false, reason: "Informe o SKU quando o saldo corrigido for maior que zero." };
  }

  const scopeSlots = slots.filter(slot => sameScope(slot, current));
  for (const slot of scopeSlots) {
    const mismatch = getSlotIdentityMismatch(slot);
    if (mismatch) {
      return { ok: false, reason: `Há uma identidade inconsistente no escopo do endereço (${slot.id}): ${mismatch}. Nenhum dado foi alterado.` };
    }
    const quantity = Number(slot.saldo || 0);
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_DATABASE_INTEGER || (quantity > 0 && !normalizeReference(slot.referencia))) {
      return { ok: false, reason: `O registro ${slot.id} possui saldo/SKU inconsistente. Corrija o dado antes de usar o mapa.` };
    }
  }

  const sourceIdentity = getAuxiliarySlotIdentity(current.id);
  const restriction = sourceIdentity?.restricao ?? normalizeRestriction(current.restricao);
  if (current.galpao === "12" && restriction !== "autorizacao") {
    return { ok: false, reason: "O endereço tem uma combinação inválida de galpão e restrição. Nenhum dado foi alterado." };
  }

  const baseAddressId = `${stock}-${module}-${position}`;
  let targetId = current.id;
  if (requestedQuantity > 0 && targetReference) {
    if (stock === "1") targetId = `1-${module}-${targetReference}`;
    else if (current.id !== baseAddressId) targetId = `${baseAddressId}::ITEM::${targetReference}::${restriction}`;
  }

  const targetIsNewIdentity = targetReference !== currentReference;
  const targetProduct = targetReference
    ? productsList.find(product => normalizeReference(product.referencia) === targetReference)
    : undefined;
  if (requestedQuantity > 0 && targetReference && targetIsNewIdentity && !targetProduct) {
    return { ok: false, reason: `O SKU ${targetReference} não está cadastrado na base oficial de produtos. Cadastre/valide o SKU antes de corrigir o estoque.` };
  }

  const targetCandidate = targetId === current.id
    ? current
    : slots.find(slot => slot.id === targetId);
  if (targetCandidate && targetCandidate.id !== current.id) {
    if (!sameScope(targetCandidate, current)) {
      return { ok: false, reason: `O ID de destino ${targetId} já pertence a outro endereço. Nenhum dado foi alterado.` };
    }
    const candidateReference = normalizeReference(targetCandidate.referencia);
    if (Number(targetCandidate.saldo || 0) > 0) {
      return { ok: false, reason: `Já existe saldo positivo no ID de destino ${targetId}. A correção foi bloqueada para não sobrescrever nem mesclar saldos automaticamente.` };
    }
    if (candidateReference && candidateReference !== targetReference) {
      return { ok: false, reason: `O ID de destino ${targetId} possui um SKU divergente. Nenhum dado foi alterado.` };
    }
  }

  if (stock !== "1" && targetReference) {
    const duplicateTargetIdentity = scopeSlots.find(slot =>
      slot.id !== current.id &&
      Number(slot.saldo || 0) > 0 &&
      normalizeReference(slot.referencia) === targetReference &&
      normalizeRestriction(slot.restricao) === restriction
    );
    if (duplicateTargetIdentity) {
      return { ok: false, reason: `Já existe outro registro ocupado para o SKU ${targetReference} com a mesma restrição nesta posição (${duplicateTargetIdentity.id}). Confira a duplicidade antes de corrigir.` };
    }
  }

  if (stock !== "1" && targetReference && targetIsNewIdentity) {
    const otherOccupied = scopeSlots.filter(slot =>
      slot.id !== current.id && Number(slot.saldo || 0) > 0 && normalizeReference(slot.referencia),
    );
    if (restriction === "nenhuma" && otherOccupied.length > 0) {
      return { ok: false, reason: "Estoque normal não pode compartilhar a posição física com outro SKU. A correção foi bloqueada." };
    }
    if (restriction !== "nenhuma" && otherOccupied.some(slot => normalizeRestriction(slot.restricao) === "nenhuma")) {
      return { ok: false, reason: "Um item restrito não pode compartilhar a posição com estoque sem restrição. A correção foi bloqueada." };
    }
  }

  const description = targetReference
    ? (targetProduct?.descricao || (targetReference === currentReference ? current.descricao : ""))
    : "";
  const requestedMetadata = {
    referencia: targetReference,
    descricao: description,
    saldo: requestedQuantity,
    dataChacote: requestedQuantity > 0 ? String(requestedSlot.dataChacote || "") : "",
    ultimaData: String(requestedSlot.ultimaData || date),
    ultimaHora: String(requestedSlot.ultimaHora || time),
    ultimoResponsavel: String(requestedSlot.ultimoResponsavel || operator),
  };

  const updatedSlots = [...slots];
  const replaceById = (replacement: WarehouseSlot) => {
    const index = updatedSlots.findIndex(slot => slot.id === replacement.id);
    if (index >= 0) updatedSlots[index] = replacement;
    else updatedSlots.push(replacement);
  };

  const identityChangesId = targetId !== current.id;
  const sourceMustBeCleared = identityChangesId && currentQuantity > 0;
  if (sourceMustBeCleared) replaceById(blankIdentity(current, date, time, operator));

  // An empty E1/auxiliary row encodes an old identity and is not reassigned to
  // a different SKU. Keep it as-is and use the target's deterministic ID.
  const targetBase = targetCandidate && targetCandidate.id !== current.id ? targetCandidate : current;
  const targetRow = {
    ...targetBase,
    estoque: current.estoque,
    modulo: current.modulo,
    posicao: current.posicao,
    ...requestedMetadata,
    galpao: current.galpao || targetBase.galpao || "3",
    restricao: restriction,
    observacao: targetReference === currentReference ? (targetBase.observacao || "") : "",
    id: targetId,
  } satisfies WarehouseSlot;

  // If an empty E1/auxiliary row is being switched to a different positive
  // SKU, targetId differs and the source row naturally remains untouched.
  // If the operator confirms saldo zero, however, clear that row's fields.
  replaceById(targetRow);

  const history: HistoricoMov[] = [];
  const makeMovement = (
    slot: WarehouseSlot,
    reference: string,
    movementRestriction: Restricao,
    quantity: number,
    type: "Entrada" | "Saída" | "",
    movementChacote: string,
  ): HistoricoMov => ({
    id: input.createHistoryId(),
    dataLancamento: date,
    quemLancou: operator,
    data: date,
    estoque: stock,
    modulo: module,
    posicao: stock === "1" ? "" : position,
    referencia: reference,
    quantidade: quantity,
    tipo: type,
    dataChacote: movementChacote,
    hora: time,
    responsavel: String(requestedSlot.ultimoResponsavel || operator),
    galpao: slot.galpao || "3",
    observacao: slot.observacao || "",
    slotId: slot.id,
    restricao: movementRestriction,
  });

  if (targetIsNewIdentity) {
    if (currentQuantity > 0 && currentReference) {
      history.push(makeMovement(current, currentReference, normalizeRestriction(current.restricao), currentQuantity, "Saída", current.dataChacote || ""));
    } else if (currentQuantity === 0 && currentReference && targetId === current.id) {
      // When an ID remains stable, clearing/reassigning its old SKU still
      // needs an audit event even if the recorded balance was already zero.
      // E1 requires the stricter correction fields and a UUID in the RPC.
      const correctionId = input.createCorrectionId?.() ?? null;
      if (stock === "1" && !correctionId) {
        return { ok: false, reason: "Este navegador não disponibilizou um identificador seguro para registrar a correção física E1. Nenhum dado foi alterado." };
      }
      history.push({
        ...makeMovement(current, currentReference, normalizeRestriction(current.restricao), 0, "", current.dataChacote || ""),
        naturezaTransacao: "correcao_fisica",
        saldoAnterior: 0,
        saldoFinal: 0,
        correcaoId: correctionId,
      });
    }
    if (requestedQuantity > 0 && targetReference) {
      history.push(makeMovement(targetRow, targetReference, restriction, requestedQuantity, "Entrada", targetRow.dataChacote || ""));
    }
  } else if (requestedQuantity !== currentQuantity && currentReference) {
    const difference = requestedQuantity - currentQuantity;
    if (stock === "1") {
      const correctionId = input.createCorrectionId?.();
      if (!correctionId) {
        return { ok: false, reason: "Este navegador não disponibilizou um identificador seguro para registrar a correção física E1. Nenhum dado foi alterado." };
      }
      history.push({
        ...makeMovement(targetRow, targetReference, restriction, Math.abs(difference), difference > 0 ? "Entrada" : "Saída", targetRow.dataChacote || ""),
        naturezaTransacao: "correcao_fisica",
        saldoAnterior: currentQuantity,
        saldoFinal: requestedQuantity,
        correcaoId: correctionId,
      });
    } else if (difference !== 0) {
      history.push(makeMovement(
        current,
        currentReference,
        normalizeRestriction(current.restricao),
        Math.abs(difference),
        difference > 0 ? "Entrada" : "Saída",
        difference > 0 ? (targetRow.dataChacote || "") : (current.dataChacote || ""),
      ));
    }
  } else if (!currentReference && requestedQuantity > 0 && targetReference) {
    history.push(makeMovement(targetRow, targetReference, restriction, requestedQuantity, "Entrada", targetRow.dataChacote || ""));
  }

  if (new Set(updatedSlots.map(slot => slot.id)).size !== updatedSlots.length) {
    return { ok: false, reason: "A correção geraria IDs duplicados. Nenhum dado foi alterado." };
  }
  if (new Set(history.map(movement => movement.id)).size !== history.length) {
    return { ok: false, reason: "Não foi possível gerar IDs únicos para o histórico. Nenhum dado foi alterado." };
  }

  let auditedHistory = history.map(movement => ({
    ...movement,
    naturezaTransacao: "correcao_fisica" as const,
  }));

  if (stock === "1" && auditedHistory.length > 0) {
    const existingCorrectionId = auditedHistory.find(movement => movement.correcaoId)?.correcaoId;
    const correctionId = existingCorrectionId ?? input.createCorrectionId?.() ?? null;
    if (!correctionId) {
      return { ok: false, reason: "Não foi possível gerar um identificador seguro para auditar a correção física E1. Nenhum dado foi alterado." };
    }

    const previousById = new Map(slots.map(slot => [slot.id, slot]));
    const finalById = new Map(updatedSlots.map(slot => [slot.id, slot]));
    auditedHistory = auditedHistory.map(movement => {
      const previous = previousById.get(String(movement.slotId || ""));
      const final = finalById.get(String(movement.slotId || ""));
      const saldoAnterior = Number(previous?.saldo || 0);
      const saldoFinal = Number(final?.saldo || 0);
      return {
        ...movement,
        naturezaTransacao: "correcao_fisica" as const,
        saldoAnterior,
        saldoFinal,
        quantidade: Math.abs(saldoFinal - saldoAnterior),
        tipo: saldoFinal > saldoAnterior ? "Entrada" as const : saldoFinal < saldoAnterior ? "Saída" as const : "" as const,
        correcaoId: correctionId,
      };
    });
  }

  const selectedSlotId = requestedQuantity > 0
    ? targetId
    : stock !== "1" && slots.some(slot => slot.id === baseAddressId)
      ? baseAddressId
      : null;

  return { ok: true, updatedSlots, history: auditedHistory, selectedSlotId };
};
