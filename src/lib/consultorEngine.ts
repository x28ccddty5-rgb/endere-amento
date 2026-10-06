import type { WarehouseSlot, Product, Restricao } from "../types";

export interface StorageAllocation {
  slot: WarehouseSlot;
  quantity: number;
}

export interface ConsultorCageCandidate {
  key: string;
  first: WarehouseSlot;
  second: WarehouseSlot;
  module: number;
  sameSkuCount: number;
  combinedFree: number;
  distanceToConcentration: number;
}

export interface ConsultorStoragePlan {
  slots: WarehouseSlot[];
  allocations: StorageAllocation[];
  cages: ConsultorCageCandidate[];
  requiredPallets: number;
  requiredCages: number;
  score: number;
  modules: number[];
  sameSkuPieces: number;
}

export interface ConsultorStrategyAnalysis {
  sku: string;
  descricao: string;
  totalSaldo: number;
  totalPaletes: number;
  modules: Array<{
    modulo: number;
    saldo: number;
    participacao: number;
    posicoes: number;
  }>;
  concentrationModule: number | null;
  nearbyModules: number[];
}

const normalizeSku = (value: string) => value.trim().toUpperCase();

export const normalizeConsultorPosition = (slot: WarehouseSlot): string =>
  `${slot.estoque}-${Number(slot.modulo)}-${String(slot.posicao || "")
    .trim()
    .toUpperCase()}`;

export const isPhysicalPositionActive = (
  slot: WarehouseSlot,
  activePhysicalPositionKeys: { "2": Set<string>; "3": Set<string> }
): boolean => {
  if (slot.estoque !== "2" && slot.estoque !== "3") return false;
  const configured = activePhysicalPositionKeys[slot.estoque];
  if (!configured || configured.size === 0) return true;
  return configured.has(normalizeConsultorPosition(slot));
};

export const getCagePair = (position: string): {
  key: string;
  counterpartPrefix: string;
} | null => {
  const normalized = position.trim().toUpperCase();
  const match = normalized.match(/^([A-Z])(.*)$/);
  if (!match) return null;

  const [, prefix, suffix] = match;
  const pairMap: Record<string, string> = {
    A: "B",
    B: "A",
    C: "D",
    D: "C",
    E: "F",
    F: "E",
  };

  const counterpartPrefix = pairMap[prefix];
  if (!counterpartPrefix) return null;

  const keyPrefix = ["A", "B"].includes(prefix)
    ? "A+B"
    : ["C", "D"].includes(prefix)
      ? "C+D"
      : "E+F";

  return {
    key: keyPrefix,
    counterpartPrefix: `${counterpartPrefix}${suffix}`,
  };
};

const moduleNumber = (slot: WarehouseSlot) => Number(slot.modulo);

const slotRestriction = (slot: WarehouseSlot): Restricao =>
  slot.restricao || (slot.galpao === "12" ? "autorizacao" : "nenhuma");

const isStorageCandidateAllowed = (slot: WarehouseSlot) =>
  slotRestriction(slot) !== "teste";

const getConcentrationModules = (
  slots: WarehouseSlot[],
  sku: string,
  activePhysicalPositionKeys?: { "2": Set<string>; "3": Set<string> }
) => {
  const grouped = new Map<number, { saldo: number; posicoes: number }>();
  const normalizedSku = normalizeSku(sku);

  for (const slot of slots) {
    if (
      (slot.estoque !== "2" && slot.estoque !== "3") ||
      normalizeSku(slot.referencia) !== normalizedSku ||
      slot.saldo <= 0 ||
      slotRestriction(slot) === "teste" ||
      (activePhysicalPositionKeys &&
        !isPhysicalPositionActive(slot, activePhysicalPositionKeys))
    ) {
      continue;
    }

    const modulo = moduleNumber(slot);
    const current = grouped.get(modulo) || { saldo: 0, posicoes: 0 };
    current.saldo += slot.saldo;
    current.posicoes += 1;
    grouped.set(modulo, current);
  }

  return [...grouped.entries()]
    .map(([modulo, value]) => ({ modulo, ...value }))
    .sort((a, b) => b.saldo - a.saldo || a.modulo - b.modulo);
};

const getConcentrationModule = (slots: WarehouseSlot[], sku: string) =>
  getConcentrationModules(slots, sku)[0]?.modulo ?? null;

const buildDistanceMap = (
  slots: WarehouseSlot[],
  sku: string,
  estoque: "2" | "3",
  activePhysicalPositionKeys: { "2": Set<string>; "3": Set<string> }
) => {
  const concentrationModules = getConcentrationModules(
    slots.filter(slot => slot.estoque === estoque),
    sku,
    activePhysicalPositionKeys
  );
  const center = concentrationModules[0]?.modulo ?? null;
  const map = new Map<number, number>();

  for (const slot of slots) {
    if (
      slot.estoque !== estoque ||
      !isPhysicalPositionActive(slot, activePhysicalPositionKeys)
    ) {
      continue;
    }

    const modulo = moduleNumber(slot);
    map.set(modulo, center === null ? 0 : Math.abs(modulo - center));
  }

  return { map, center };
};

const compareCandidate = (
  a: {
    slot: WarehouseSlot;
    sameSku: boolean;
    freeCapacity: number;
    distance: number;
  },
  b: {
    slot: WarehouseSlot;
    sameSku: boolean;
    freeCapacity: number;
    distance: number;
  },
  requestedQty: number
) => {
  if (a.sameSku !== b.sameSku) return a.sameSku ? -1 : 1;
  if (a.distance !== b.distance) return a.distance - b.distance;

  const aRestriction = slotRestriction(a.slot);
  const bRestriction = slotRestriction(b.slot);
  if (aRestriction !== bRestriction) {
    if (aRestriction === "autorizacao") return 1;
    if (bRestriction === "autorizacao") return -1;
  }

  const aRemaining = Math.max(0, a.freeCapacity - requestedQty);
  const bRemaining = Math.max(0, b.freeCapacity - requestedQty);
  if (aRemaining !== bRemaining) return aRemaining - bRemaining;

  return normalizeConsultorPosition(a.slot).localeCompare(
    normalizeConsultorPosition(b.slot),
    "pt-BR",
    { numeric: true }
  );
};

const allocateAcrossSlots = (
  selected: WarehouseSlot[],
  requestedQty: number,
  capacity: number
): StorageAllocation[] => {
  let remaining = requestedQty;
  const result: StorageAllocation[] = [];

  for (const slot of selected) {
    if (remaining <= 0) break;

    const freeCapacity = capacity > 0
      ? Math.max(0, capacity - Math.max(0, slot.saldo))
      : remaining;

    const quantity = Math.min(remaining, freeCapacity);
    if (quantity <= 0) continue;

    result.push({ slot, quantity });
    remaining -= quantity;
  }

  return result;
};

const buildPlanScore = (
  slots: WarehouseSlot[],
  allocations: StorageAllocation[],
  distanceMap: Map<number, number>,
  sameSkuPieces: number
) => {
  const modules = [...new Set(slots.map(moduleNumber))];
  const distance = slots.reduce(
    (sum, slot) => sum + (distanceMap.get(moduleNumber(slot)) || 0),
    0
  );

  return (
    distance * 100 +
    modules.length * 30 +
    allocations.length * 5 -
    sameSkuPieces / 100000
  );
};

export const buildStoragePlans = ({
  slots,
  products,
  sku,
  requestedQty,
  requestedPalletCount,
  requestedCageCount,
  structure,
  activePhysicalPositionKeys,
}: {
  slots: WarehouseSlot[];
  products: Product[];
  sku: string;
  requestedQty?: number | null;
  requestedPalletCount?: number | null;
  requestedCageCount?: number | null;
  structure: "2" | "3";
} & {
  activePhysicalPositionKeys: { "2": Set<string>; "3": Set<string> };
}) => {
  const normalizedSku = normalizeSku(sku);
  const product = products.find(
    item => normalizeSku(item.referencia) === normalizedSku
  );
  const capacity = Number(product?.paletizacao || 0);

  const requiredPallets =
    requestedPalletCount && requestedPalletCount > 0
      ? Math.ceil(requestedPalletCount)
      : requestedQty && requestedQty > 0 && capacity > 0
        ? Math.max(1, Math.ceil(requestedQty / capacity))
        : requestedCageCount && requestedCageCount > 0
          ? Math.ceil(requestedCageCount) * 2
          : 0;

  const requiredCages =
    structure === "3"
      ? requestedCageCount && requestedCageCount > 0
        ? Math.ceil(requestedCageCount)
        : requiredPallets > 0
          ? Math.ceil(requiredPallets / 2)
          : 0
      : 0;

  const storageEstoque = structure;
  const { map: distanceMap, center: concentrationModule } =
    buildDistanceMap(
      slots,
      normalizedSku,
      storageEstoque,
      activePhysicalPositionKeys
    );

  const baseCandidates = slots
    .filter(slot =>
      slot.estoque === storageEstoque &&
      isPhysicalPositionActive(slot, activePhysicalPositionKeys) &&
      isStorageCandidateAllowed(slot)
    )
    .map(slot => {
      const ref = normalizeSku(slot.referencia);
      const sameSku = ref === normalizedSku && slot.saldo > 0;
      const freeCapacity = capacity > 0
        ? Math.max(0, capacity - slot.saldo)
        : 0;

      return {
        slot,
        sameSku,
        freeCapacity,
        distance: distanceMap.get(moduleNumber(slot)) || 0,
      };
    })
    .filter(candidate => {
      const ref = normalizeSku(candidate.slot.referencia);
      if (candidate.slot.saldo > 0 && ref !== normalizedSku) return false;
      if (candidate.slot.saldo <= 0 && candidate.slot.referencia) return false;
      return true;
    })
    .sort((a, b) => compareCandidate(a, b, requestedQty || 0));

  if (structure === "2") {
    const needed = requiredPallets || (requestedQty ? 1 : 0);
    const plans: ConsultorStoragePlan[] = [];

    if (needed <= 0) {
      return {
        plans,
        capacity,
        requiredPallets: 0,
        requiredCages: 0,
        concentrationModule,
      };
    }

    if (requestedQty && capacity <= 0) {
      return {
        plans,
        capacity,
        requiredPallets: needed,
        requiredCages: 0,
        concentrationModule,
      };
    }

    const selectedCount = Math.max(needed, 1);
    const maxPlans = Math.min(needed + 1, baseCandidates.length);

    for (let start = 0; start < baseCandidates.length && plans.length < maxPlans; start += 1) {
      const rotated = [
        ...baseCandidates.slice(start),
        ...baseCandidates.slice(0, start),
      ];
      const selected = rotated
        .slice(0, selectedCount)
        .map(candidate => candidate.slot);

      if (selected.length !== selectedCount) continue;

      const allocations = requestedQty
        ? allocateAcrossSlots(selected, requestedQty, capacity)
        : selected.map(slot => ({
            slot,
            quantity: capacity,
          }));

      let remainingForValidation =
        requestedQty ?? selected.length * capacity;

      for (const slot of selected) {
        if (remainingForValidation <= 0) break;

        const freeCapacity =
          capacity > 0
            ? Math.max(0, capacity - Math.max(0, slot.saldo))
            : remainingForValidation;
        const requiredOnSlot = Math.min(capacity, remainingForValidation);

        if (freeCapacity < requiredOnSlot) {
          remainingForValidation = -1;
          break;
        }

        remainingForValidation -= requiredOnSlot;
      }

      if (remainingForValidation !== 0) continue;

      if (requestedQty) {
        const allocated = allocations.reduce((sum, item) => sum + item.quantity, 0);
        if (allocated < requestedQty) continue;
      }

      const modules = [...new Set(selected.map(moduleNumber))].sort((a, b) => a - b);
      const sameSkuPieces = selected.reduce(
        (sum, slot) =>
          sum + (normalizeSku(slot.referencia) === normalizedSku ? slot.saldo : 0),
        0
      );

      plans.push({
        slots: selected,
        allocations,
        cages: [],
        requiredPallets: needed,
        requiredCages: 0,
        score: buildPlanScore(
          selected,
          allocations,
          distanceMap,
          sameSkuPieces
        ),
        modules,
        sameSkuPieces,
      });
    }

    return {
      plans: plans.sort((a, b) => a.score - b.score).slice(0, needed + 1),
      capacity,
      requiredPallets: needed,
      requiredCages: 0,
      concentrationModule,
    };
  }

  const e3Slots = slots
    .filter(slot =>
      slot.estoque === "3" &&
      isPhysicalPositionActive(slot, activePhysicalPositionKeys) &&
      isStorageCandidateAllowed(slot)
    )
    .sort((a, b) =>
      normalizeConsultorPosition(a).localeCompare(
        normalizeConsultorPosition(b),
        "pt-BR",
        { numeric: true }
      )
    );

  const byKey = new Map(
    e3Slots.map(slot => [normalizeConsultorPosition(slot), slot])
  );

  const cageCandidates: ConsultorCageCandidate[] = [];
  for (const slot of e3Slots) {
    const pair = getCagePair(slot.posicao);
    if (!pair) continue;

    const counterpart = byKey.get(
      `3-${Number(slot.modulo)}-${pair.counterpartPrefix}`
    );
    if (!counterpart) continue;

    if (
      normalizeConsultorPosition(slot) >=
      normalizeConsultorPosition(counterpart)
    ) {
      continue;
    }

    const firstRef = normalizeSku(slot.referencia);
    const secondRef = normalizeSku(counterpart.referencia);
    if (slot.saldo > 0 && firstRef !== normalizedSku) continue;
    if (counterpart.saldo > 0 && secondRef !== normalizedSku) continue;

    const firstFree = capacity > 0
      ? Math.max(0, capacity - slot.saldo)
      : 0;
    const secondFree = capacity > 0
      ? Math.max(0, capacity - counterpart.saldo)
      : 0;

    if (capacity > 0 && (firstFree < capacity || secondFree < capacity)) {
      continue;
    }

    cageCandidates.push({
      key: pair.key,
      first: slot,
      second: counterpart,
      module: moduleNumber(slot),
      sameSkuCount:
        (firstRef === normalizedSku && slot.saldo > 0 ? 1 : 0) +
        (secondRef === normalizedSku && counterpart.saldo > 0 ? 1 : 0),
      combinedFree: firstFree + secondFree,
      distanceToConcentration:
        concentrationModule === null
          ? 0
          : Math.abs(moduleNumber(slot) - concentrationModule),
    });
  }

  cageCandidates.sort((a, b) =>
    b.sameSkuCount - a.sameSkuCount ||
    a.distanceToConcentration - b.distanceToConcentration ||
    a.module - b.module ||
    a.key.localeCompare(b.key)
  );

  const plans: ConsultorStoragePlan[] = [];
  if (requiredCages > 0 && cageCandidates.length >= requiredCages) {
    const maxPlans = Math.min(requiredCages + 1, cageCandidates.length);

    for (let start = 0; start < cageCandidates.length && plans.length < maxPlans; start += 1) {
      const rotated = [
        ...cageCandidates.slice(start),
        ...cageCandidates.slice(0, start),
      ];
      const selected = rotated.slice(0, requiredCages);
      if (selected.length !== requiredCages) continue;

      const selectedSlots = selected.flatMap(cage => [cage.first, cage.second]);
      const allocations = requestedQty
        ? allocateAcrossSlots(selectedSlots, requestedQty, capacity)
        : selectedSlots.map(slot => ({ slot, quantity: capacity }));

      if (requestedQty) {
        const allocated = allocations.reduce((sum, item) => sum + item.quantity, 0);
        if (allocated < requestedQty) continue;
      }

      const modules = [...new Set(selected.map(cage => cage.module))].sort(
        (a, b) => a - b
      );
      const sameSkuPieces = selectedSlots.reduce(
        (sum, slot) =>
          sum + (normalizeSku(slot.referencia) === normalizedSku ? slot.saldo : 0),
        0
      );

      plans.push({
        slots: selectedSlots,
        allocations,
        cages: selected,
        requiredPallets,
        requiredCages,
        score:
          selected.reduce(
            (sum, cage) => sum + cage.distanceToConcentration * 100,
            0
          ) +
          modules.length * 30 -
          sameSkuPieces / 100000,
        modules,
        sameSkuPieces,
      });
    }
  }

  return {
    plans: plans.sort((a, b) => a.score - b.score).slice(0, requiredCages + 1),
    capacity,
    requiredPallets,
    requiredCages,
    concentrationModule,
  };
};

export const buildSeparationPlan = ({
  slots,
  sku,
  requestedQty,
  allowTest = false,
}: {
  slots: WarehouseSlot[];
  sku: string;
  requestedQty: number;
  allowTest?: boolean;
}) => {
  const normalizedSku = normalizeSku(sku);

  const candidates = slots
    .filter(
      slot =>
        slot.estoque === "2" &&
        slot.saldo > 0 &&
        normalizeSku(slot.referencia) === normalizedSku &&
        slotRestriction(slot) === (allowTest ? "teste" : "nenhuma")
    )
    .map(slot => ({
      slot,
      chacoteTime: slot.dataChacote
        ? new Date(slot.dataChacote).getTime()
        : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => {
      if (a.chacoteTime !== b.chacoteTime) return a.chacoteTime - b.chacoteTime;
      return a.slot.saldo - b.slot.saldo;
    });

  let remaining = requestedQty;
  const plan: Array<{
    slot: WarehouseSlot;
    quantity: number;
    chacoteTime: number;
  }> = [];

  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const quantity = Math.min(candidate.slot.saldo, remaining);
    plan.push({ ...candidate, quantity });
    remaining -= quantity;
  }

  return {
    plan,
    remaining,
    complete: remaining <= 0,
    totalAvailable: candidates.reduce((sum, item) => sum + item.slot.saldo, 0),
  };
};

export const buildStrategyAnalysis = ({
  slots,
  products,
  sku,
  activePhysicalPositionKeys,
}: {
  slots: WarehouseSlot[];
  products: Product[];
  sku: string;
  activePhysicalPositionKeys?: { "2": Set<string>; "3": Set<string> };
}): ConsultorStrategyAnalysis => {
  const normalizedSku = normalizeSku(sku);
  const product = products.find(
    item => normalizeSku(item.referencia) === normalizedSku
  );

  const skuSlots = slots.filter(
    slot =>
      normalizeSku(slot.referencia) === normalizedSku &&
      slot.saldo > 0 &&
      slotRestriction(slot) !== "teste" &&
      (activePhysicalPositionKeys
        ? isPhysicalPositionActive(slot, activePhysicalPositionKeys)
        : true)
  );

  const totalSaldo = skuSlots.reduce((sum, slot) => sum + slot.saldo, 0);
  const paletizacao = Number(product?.paletizacao || 0);
  const totalPaletes =
    paletizacao > 0 ? Math.ceil(totalSaldo / paletizacao) : 0;

  const grouped = getConcentrationModules(
    slots,
    normalizedSku,
    activePhysicalPositionKeys
  );
  const totalGrouped = grouped.reduce((sum, item) => sum + item.saldo, 0);
  const concentrationModule = grouped[0]?.modulo ?? null;

  const modules = grouped.map(item => ({
    ...item,
    participacao: totalGrouped > 0 ? item.saldo / totalGrouped : 0,
  }));

  const nearbyModules =
    concentrationModule === null
      ? []
      : [...new Set(
          grouped
            .map(item => item.modulo)
            .sort(
              (a, b) =>
                Math.abs(a - concentrationModule) -
                  Math.abs(b - concentrationModule) ||
                a - b
            )
        )].slice(0, 8);

  return {
    sku: normalizedSku,
    descricao: product?.descricao || sku,
    totalSaldo,
    totalPaletes,
    modules,
    concentrationModule,
    nearbyModules,
  };
};
