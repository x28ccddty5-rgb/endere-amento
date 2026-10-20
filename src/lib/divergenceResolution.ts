import type { Divergencia, Restricao, WarehouseSlot } from "../types";
import {
  getAuxiliarySlotIdentity,
  getSlotIdentityMismatch,
  isBasePhysicalSlotAtOwnAddress,
} from "../data/mockStorage";

export type CorroboratedDivergenceSlotResult =
  | { kind: "none" }
  | { kind: "selected"; slotId: string; supportingDivergenceIds: string[] }
  | { kind: "ambiguous"; slotIds: string[] }
  | { kind: "unsafe-identity"; slotId: string; reason: string };

export interface FindCorroboratedDivergenceSlotInput {
  currentDivergence: Divergencia;
  divergences: Divergencia[];
  slots: WarehouseSlot[];
  targetSku: string;
  targetRestriction: Restricao | string;
}

const normalizeStock = (value: unknown): string =>
  String(value ?? "").trim().toUpperCase().replace(/^E/i, "");

const normalizeModule = (value: unknown): string => {
  const raw = String(value ?? "").trim().toUpperCase().replace(/^[RM]/i, "");
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
};

const normalizePosition = (value: unknown): string =>
  String(value ?? "").trim().toUpperCase();

const normalizeSku = (value: unknown): string => {
  const sku = String(value ?? "").trim().toUpperCase();
  return sku.startsWith("S") ? sku.slice(1) : sku;
};

const normalizeRestriction = (value: unknown): string => {
  const restriction = String(value ?? "nenhuma").trim().toLowerCase();
  return ["teste", "autorizacao", "outra"].includes(restriction) ? restriction : "nenhuma";
};

const sameAddress = (
  a: { estoque?: unknown; modulo?: unknown; posicao?: unknown },
  b: { estoque?: unknown; modulo?: unknown; posicao?: unknown },
): boolean =>
  normalizeStock(a.estoque) === normalizeStock(b.estoque) &&
  normalizeModule(a.modulo) === normalizeModule(b.modulo) &&
  normalizePosition(a.posicao) === normalizePosition(b.posicao);

const hasConsistentEncodedIdentity = (slot: WarehouseSlot, canonicalAddressId: string): boolean => {
  if (getSlotIdentityMismatch(slot) !== null) return false;
  if (slot.id === canonicalAddressId && isBasePhysicalSlotAtOwnAddress(slot)) return true;

  const auxiliary = getAuxiliarySlotIdentity(slot.id);
  if (auxiliary) {
    return auxiliary.addressId === canonicalAddressId &&
      normalizeSku(auxiliary.referencia) === normalizeSku(slot.referencia) &&
      normalizeRestriction(auxiliary.restricao) === normalizeRestriction(slot.restricao);
  }

  const estoque = normalizeStock(slot.estoque);
  const modulo = normalizeModule(slot.modulo);
  const sku = normalizeSku(slot.referencia);
  return estoque === "1" && !normalizePosition(slot.posicao) && Boolean(sku) &&
    slot.id === `1-${modulo}-${sku}`;
};

const targetCanReuseIdentity = (
  slot: WarehouseSlot,
  canonicalAddressId: string,
  targetSku: string,
  targetRestriction: string,
): { safe: boolean; reason?: string } => {
  if (slot.id === canonicalAddressId && isBasePhysicalSlotAtOwnAddress(slot)) {
    // E2/E3 physical-base IDs encode the address, not the SKU.
    return { safe: true };
  }

  const auxiliary = getAuxiliarySlotIdentity(slot.id);
  if (auxiliary) {
    const sameEncodedIdentity =
      auxiliary.addressId === canonicalAddressId &&
      normalizeSku(auxiliary.referencia) === targetSku &&
      normalizeRestriction(auxiliary.restricao) === targetRestriction;
    return sameEncodedIdentity
      ? { safe: true }
      : { safe: false, reason: "O ID auxiliar codifica outro SKU/restrição e não pode ser reaproveitado." };
  }

  const estoque = normalizeStock(slot.estoque);
  const modulo = normalizeModule(slot.modulo);
  const currentSku = normalizeSku(slot.referencia);
  const currentRestriction = normalizeRestriction(slot.restricao);
  if (estoque === "1") {
    const sameE1Identity =
      slot.id === `1-${modulo}-${targetSku}` &&
      currentSku === targetSku &&
      currentRestriction === targetRestriction;
    return sameE1Identity
      ? { safe: true }
      : { safe: false, reason: "O ID do E1 codifica a SKU atual e não pode ser convertido em outra identidade." };
  }

  return { safe: false, reason: "O ID atual não é uma identidade física canônica validada." };
};

/**
 * Resolve a seleção quando a divergência foi criada com um snapshot antigo.
 * Só aceita um slot ocupado se outra divergência aberta na mesma posição
 * confirmar o SKU/restrição que está gravado hoje. Nunca escolhe arbitrariamente
 * entre dois slots e nunca reutiliza IDs E1/auxiliares para outra identidade.
 */
export function findCorroboratedDivergenceSlot(
  input: FindCorroboratedDivergenceSlotInput,
): CorroboratedDivergenceSlotResult {
  const { currentDivergence, divergences, slots } = input;
  const targetSku = normalizeSku(input.targetSku);
  const targetRestriction = normalizeRestriction(input.targetRestriction);
  if (!targetSku) return { kind: "none" };

  const normalizedStock = normalizeStock(currentDivergence.estoque);
  const normalizedModule = normalizeModule(currentDivergence.modulo);
  const normalizedPosition = normalizePosition(currentDivergence.posicao);
  // E1 IDs encode SKU and have no physical position coordinate. Multiple SKUs
  // in one module are independent records, so a position-based fallback is unsafe.
  if (normalizedStock === "1") return { kind: "none" };
  const canonicalAddressId = `${normalizedStock}-${normalizedModule}-${normalizedPosition}`;

  const siblings = divergences.filter((div) =>
    div.id !== currentDivergence.id &&
    String(div.status ?? "").trim().toLowerCase() === "aberta" &&
    sameAddress(div, currentDivergence),
  );

  if (siblings.length === 0) return { kind: "none" };

  const occupiedSlots = slots.filter((slot) =>
    sameAddress(slot, currentDivergence) &&
    Number(slot.saldo ?? 0) > 0 &&
    Boolean(String(slot.referencia ?? "").trim()),
  );

  const attested = occupiedSlots
    .map((slot) => {
      const currentSku = normalizeSku(slot.referencia);
      const currentRestriction = normalizeRestriction(slot.restricao);
      const supportingDivergenceIds = siblings
        .filter((div) => {
          const confirmedSku = normalizeSku(div.refAtual);
          const confirmedRestriction = normalizeRestriction(div.restricao);
          const linkedId = String(div.slotId ?? "").trim();
          return Boolean(confirmedSku) &&
            confirmedSku !== "VAZIO" &&
            confirmedSku === currentSku &&
            confirmedRestriction === currentRestriction &&
            (!linkedId || linkedId === slot.id);
        })
        .map((div) => div.id);
      return { slot, supportingDivergenceIds };
    })
    .filter((candidate) => candidate.supportingDivergenceIds.length > 0);

  const uniqueById = new Map(attested.map((candidate) => [candidate.slot.id, candidate]));
  const candidates = Array.from(uniqueById.values());
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length > 1) {
    return { kind: "ambiguous", slotIds: candidates.map((candidate) => candidate.slot.id).sort() };
  }

  const candidate = candidates[0];
  if (!hasConsistentEncodedIdentity(candidate.slot, canonicalAddressId)) {
    return {
      kind: "unsafe-identity",
      slotId: candidate.slot.id,
      reason: "O slot confirmado por outra divergência possui um ID incompatível com o endereço/SKU/restrição gravados.",
    };
  }

  const reuse = targetCanReuseIdentity(
    candidate.slot,
    canonicalAddressId,
    targetSku,
    targetRestriction,
  );
  if (!reuse.safe) {
    return {
      kind: "unsafe-identity",
      slotId: candidate.slot.id,
      reason: reuse.reason || "A identidade do slot não pode ser reutilizada com segurança.",
    };
  }

  return {
    kind: "selected",
    slotId: candidate.slot.id,
    supportingDivergenceIds: candidate.supportingDivergenceIds,
  };
}
