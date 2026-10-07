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
  reserveSlots: WarehouseSlot[];
  reserveCages: ConsultorCageCandidate[];
}

export interface ConsultorRemontagemAllocation {
  slot: WarehouseSlot;
  quantity: number;
  freeCapacityBefore: number;
}

export interface ConsultorRemontagemPlan {
  sku: string;
  descricao: string;
  requestedQty: number;
  capacity: number;
  allocations: ConsultorRemontagemAllocation[];
  remaining: number;
  complete: boolean;
  totalFreeCapacity: number;
}

export interface ConsultorSeparationItem {
  slot: WarehouseSlot;
  quantity: number;
  chacoteTime: number | null;
  structure: "2" | "3";
}

export interface ConsultorStrategyAnalysis {
  sku: string;
  descricao: string;
  totalSaldo: number;
  totalPaletes: number;
  totalPosicoes: number;
  totalModulos: number;
  capacidadeTotal: number;
  ocupacaoPercentual: number;
  restrictedSaldo: number;
  modules: Array<{
    modulo: number;
    saldo: number;
    participacao: number;
    posicoes: number;
  }>;
  concentrationModule: number | null;
  nearbyModules: number[];
}

export interface ConsultorChacoteQuantityAnalysis {
  sku: string;
  descricao: string;
  cutoffDate: string;
  withoutChacoteDate: number;
  datedUpToCutoff: number;
  totalEligible: number;
  totalCurrent: number;
  datedPositions: number;
  withoutDatePositions: number;
}

export type ConsultorRestriction = Restricao | null | undefined;

export type ActivePhysicalPositionKeys = {
  "2": Set<string>;
  "3": Set<string>;
};

const normalizeSku = (value: string) => value.trim().toUpperCase();

const normalizeModule = (value: string) =>
  String(value).trim().replace(/^[RM]/i, "").replace(/^0+(?=\d)/, "") || "0";

const normalizePosition = (value: string) =>
  String(value || "").trim().toUpperCase();

export const normalizeConsultorPosition = (slot: WarehouseSlot): string =>
  `${slot.estoque}-${Number(slot.modulo)}-${normalizePosition(slot.posicao)}`;

export const isPhysicalPositionActive = (
  slot: WarehouseSlot,
  activePhysicalPositionKeys: ActivePhysicalPositionKeys
): boolean => {
  if (slot.estoque !== "2" && slot.estoque !== "3") return false;

  const configured = activePhysicalPositionKeys[slot.estoque];

  // No known physical configuration means that the Consultor must not guess
  // that an arbitrary slot is operationally active.
  if (!configured || configured.size === 0) return false;

  return configured.has(normalizeConsultorPosition(slot));
};

const slotRestriction = (slot: WarehouseSlot): Restricao =>
  slot.galpao === "12"
    ? "autorizacao"
    : slot.restricao || "nenhuma";

const isStandardSlot = (slot: WarehouseSlot): boolean =>
  slotRestriction(slot) === "nenhuma";

const matchesRestriction = (
  slot: WarehouseSlot,
  requestedRestriction?: ConsultorRestriction
): boolean =>
  requestedRestriction
    ? slotRestriction(slot) === requestedRestriction
    : isStandardSlot(slot);

const physicalAddressKey = (slot: WarehouseSlot): string =>
  `${slot.estoque}-${normalizeModule(slot.modulo)}-${normalizePosition(slot.posicao)}`;

const makeVirtualEmptySlot = (
  estoque: "2" | "3",
  modulo: string,
  posicao: string
): WarehouseSlot => ({
  id: `${estoque}-${normalizeModule(modulo)}-${normalizePosition(posicao)}`,
  estoque,
  modulo: normalizeModule(modulo),
  posicao: normalizePosition(posicao),
  referencia: "",
  descricao: "",
  saldo: 0,
  dataChacote: "",
  ultimaData: "",
  ultimaHora: "",
  ultimoResponsavel: "",
  galpao: "3",
  restricao: "nenhuma",
  observacao: "",
});

const getConfiguredPositionEntries = (
  slots: WarehouseSlot[],
  activePhysicalPositionKeys: ActivePhysicalPositionKeys,
  estoque: "2" | "3"
): WarehouseSlot[] => {
  const configured = activePhysicalPositionKeys[estoque];
  if (!configured || configured.size === 0) return [];

  const result: WarehouseSlot[] = [];

  for (const key of configured) {
    const match = key.match(/^[23]-(\d+)-(.+)$/);
    if (!match) continue;

    const [, modulo, posicao] = match;
    const samePhysicalAddress = slots.filter(
      slot =>
        slot.estoque === estoque &&
        normalizeModule(slot.modulo) === normalizeModule(modulo) &&
        normalizePosition(slot.posicao) === normalizePosition(posicao)
    );

    if (samePhysicalAddress.length === 0) {
      result.push(makeVirtualEmptySlot(estoque, modulo, posicao));
      continue;
    }

    const emptyRow = samePhysicalAddress.find(
      slot => slot.saldo <= 0 && !slot.referencia.trim()
    );

    result.push(emptyRow || samePhysicalAddress[0]);
  }

  return result;
};

const getOccupiedPhysicalKeys = (slots: WarehouseSlot[]): Set<string> =>
  new Set(
    slots
      .filter(
        slot =>
          (slot.estoque === "2" || slot.estoque === "3") &&
          slot.saldo > 0
      )
      .map(physicalAddressKey)
  );

const getPhysicalSaldoMap = (slots: WarehouseSlot[]): Map<string, number> => {
  const result = new Map<string, number>();

  slots.forEach(slot => {
    if (
      (slot.estoque !== "2" && slot.estoque !== "3") ||
      slot.saldo <= 0
    ) {
      return;
    }

    const key = physicalAddressKey(slot);
    result.set(key, (result.get(key) || 0) + slot.saldo);
  });

  return result;
};

export const getCagePair = (position: string): {
  key: string;
  counterpartPrefix: string;
} | null => {
  const normalized = normalizePosition(position);
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

const getConcentrationModules = (
  slots: WarehouseSlot[],
  sku: string,
  activePhysicalPositionKeys?: ActivePhysicalPositionKeys,
  requestedRestriction?: ConsultorRestriction
) => {
  const grouped = new Map<number, { saldo: number; posicoes: number }>();
  const normalizedSku = normalizeSku(sku);

  for (const slot of slots) {
    if (
      slot.estoque !== "2" &&
      slot.estoque !== "3"
    ) {
      continue;
    }

    if (
      activePhysicalPositionKeys &&
      !isPhysicalPositionActive(slot, activePhysicalPositionKeys)
    ) {
      continue;
    }

    if (
      normalizeSku(slot.referencia) !== normalizedSku ||
      slot.saldo <= 0 ||
      !matchesRestriction(slot, requestedRestriction)
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

const getConcentrationModule = (
  slots: WarehouseSlot[],
  sku: string,
  activePhysicalPositionKeys?: ActivePhysicalPositionKeys,
  requestedRestriction?: ConsultorRestriction
) =>
  getConcentrationModules(
    slots,
    sku,
    activePhysicalPositionKeys,
    requestedRestriction
  )[0]?.modulo ?? null;

const buildDistanceMap = (
  slots: WarehouseSlot[],
  sku: string,
  activePhysicalPositionKeys?: ActivePhysicalPositionKeys,
  requestedRestriction?: ConsultorRestriction
) => {
  const center = getConcentrationModule(
    slots,
    sku,
    activePhysicalPositionKeys,
    requestedRestriction
  );
  const map = new Map<number, number>();

  for (const slot of slots) {
    const modulo = moduleNumber(slot);
    map.set(
      modulo,
      center === null ? 0 : Math.abs(modulo - center)
    );
  }

  return { map, center };
};

const sortByOperationalPriority = (
  candidates: Array<{
    slot: WarehouseSlot;
    distance: number;
  }>
): WarehouseSlot[] => {
  const selectedModules = new Set<number>();
  const remaining = [...candidates];
  const result: WarehouseSlot[] = [];

  while (remaining.length > 0) {
    remaining.sort((a, b) => {
      const aNewModule = selectedModules.has(moduleNumber(a.slot)) ? 0 : 1;
      const bNewModule = selectedModules.has(moduleNumber(b.slot)) ? 0 : 1;

      return (
        a.distance * 100 +
        aNewModule * 30 -
        (b.distance * 100 + bNewModule * 30) ||
        moduleNumber(a.slot) - moduleNumber(b.slot) ||
        normalizePosition(a.slot.posicao).localeCompare(
          normalizePosition(b.slot.posicao),
          "pt-BR",
          { numeric: true }
        )
      );
    });

    const [next] = remaining.splice(0, 1);
    result.push(next.slot);
    selectedModules.add(moduleNumber(next.slot));
  }

  return result;
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
  requestedRestriction,
}: {
  slots: WarehouseSlot[];
  products: Product[];
  sku: string;
  requestedQty?: number | null;
  requestedPalletCount?: number | null;
  requestedCageCount?: number | null;
  structure: "2" | "3";
  activePhysicalPositionKeys: ActivePhysicalPositionKeys;
  requestedRestriction?: ConsultorRestriction;
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

  const { map: distanceMap, center: concentrationModule } =
    buildDistanceMap(
      slots,
      normalizedSku,
      activePhysicalPositionKeys,
      requestedRestriction
    );

  if (structure === "2") {
    const candidates = getConfiguredPositionEntries(
      slots,
      activePhysicalPositionKeys,
      "2"
    ).filter(slot => {
      const key = physicalAddressKey(slot);
      return (
        !getOccupiedPhysicalKeys(slots).has(key) &&
        isPhysicalPositionActive(slot, activePhysicalPositionKeys)
      );
    });

    const ordered = sortByOperationalPriority(
      candidates.map(slot => ({
        slot,
        distance: distanceMap.get(moduleNumber(slot)) || 0,
      }))
    );

    const needed = requiredPallets || (requestedQty ? 1 : 0);

    if (needed <= 0 || capacity <= 0 || ordered.length < needed) {
      return {
        plans: [] as ConsultorStoragePlan[],
        capacity,
        requiredPallets: needed,
        requiredCages: 0,
        concentrationModule,
      };
    }

    const selected = ordered.slice(0, needed);
    const reserveSlots = ordered.slice(needed, needed + 1);

    const allocations = requestedQty
      ? allocateAcrossSlots(selected, requestedQty, capacity)
      : selected.map(slot => ({
          slot,
          quantity: capacity,
        }));

    const allocated = allocations.reduce(
      (sum, item) => sum + item.quantity,
      0
    );

    if (requestedQty && allocated < requestedQty) {
      return {
        plans: [] as ConsultorStoragePlan[],
        capacity,
        requiredPallets: needed,
        requiredCages: 0,
        concentrationModule,
      };
    }

    const modules = [...new Set(selected.map(moduleNumber))].sort(
      (a, b) => a - b
    );

    const sameSkuPieces = 0;

    return {
      plans: [
        {
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
          reserveSlots,
          reserveCages: [],
        },
      ],
      capacity,
      requiredPallets: needed,
      requiredCages: 0,
      concentrationModule,
    };
  }

  const e3Positions = getConfiguredPositionEntries(
    slots,
    activePhysicalPositionKeys,
    "3"
  );
  const occupiedKeys = getOccupiedPhysicalKeys(slots);
  const byKey = new Map(
    e3Positions.map(slot => [physicalAddressKey(slot), slot])
  );

  const cageCandidates: ConsultorCageCandidate[] = [];

  for (const slot of e3Positions) {
    const pair = getCagePair(slot.posicao);
    if (!pair) continue;

    const counterpartKey = `3-${normalizeModule(slot.modulo)}-${normalizePosition(
      pair.counterpartPrefix
    )}`;
    const counterpart = byKey.get(counterpartKey);
    if (!counterpart) continue;

    const firstKey = physicalAddressKey(slot);
    const secondKey = physicalAddressKey(counterpart);

    if (
      firstKey >= secondKey ||
      occupiedKeys.has(firstKey) ||
      occupiedKeys.has(secondKey)
    ) {
      continue;
    }

    cageCandidates.push({
      key: pair.key,
      first: slot,
      second: counterpart,
      module: moduleNumber(slot),
      sameSkuCount: 0,
      combinedFree: capacity * 2,
      distanceToConcentration:
        concentrationModule === null
          ? 0
          : Math.abs(moduleNumber(slot) - concentrationModule),
    });
  }

  const uniqueCages = new Map<string, ConsultorCageCandidate>();
  cageCandidates.forEach(cage => {
    uniqueCages.set(
      `${cage.module}-${cage.key}`,
      cage
    );
  });

  const orderedCages = [...uniqueCages.values()].sort(
    (a, b) =>
      a.distanceToConcentration - b.distanceToConcentration ||
      a.module - b.module ||
      a.key.localeCompare(b.key)
  );

  const neededCages = requiredCages;

  if (
    neededCages <= 0 ||
    capacity <= 0 ||
    orderedCages.length < neededCages
  ) {
    return {
      plans: [] as ConsultorStoragePlan[],
      capacity,
      requiredPallets,
      requiredCages: neededCages,
      concentrationModule,
    };
  }

  const selectedCages = orderedCages.slice(0, neededCages);
  const reserveCages = orderedCages.slice(
    neededCages,
    neededCages + 1
  );
  const selectedSlots = selectedCages.flatMap(cage => [
    cage.first,
    cage.second,
  ]);

  const allocations = requestedQty
    ? allocateAcrossSlots(selectedSlots, requestedQty, capacity)
    : selectedSlots.map(slot => ({
        slot,
        quantity: capacity,
      }));

  const allocated = allocations.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  if (requestedQty && allocated < requestedQty) {
    return {
      plans: [] as ConsultorStoragePlan[],
      capacity,
      requiredPallets,
      requiredCages: neededCages,
      concentrationModule,
    };
  }

  const modules = [...new Set(selectedCages.map(cage => cage.module))].sort(
    (a, b) => a - b
  );

  return {
    plans: [
      {
        slots: selectedSlots,
        allocations,
        cages: selectedCages,
        requiredPallets,
        requiredCages: neededCages,
        score:
          selectedCages.reduce(
            (sum, cage) => sum + cage.distanceToConcentration * 100,
            0
          ) +
          modules.length * 30,
        modules,
        sameSkuPieces: 0,
        reserveSlots: [],
        reserveCages,
      },
    ],
    capacity,
    requiredPallets,
    requiredCages: neededCages,
    concentrationModule,
  };
};

export const parseChacoteDate = (value?: string | null): number | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const timestamp = new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3])
    ).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  const br = raw.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{2}|\d{4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]) - 1;
    const yearValue = Number(br[3]);
    const year = br[3].length === 2 ? 2000 + yearValue : yearValue;
    const timestamp = new Date(year, month, day).getTime();

    return (
      Number.isFinite(timestamp) &&
      new Date(timestamp).getFullYear() === year &&
      new Date(timestamp).getMonth() === month &&
      new Date(timestamp).getDate() === day
    )
      ? timestamp
      : null;
  }

  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const compareChacote = (
  a: { chacoteTime: number | null },
  b: { chacoteTime: number | null }
) => {
  // No date is the highest operational risk and therefore comes first.
  if (a.chacoteTime === null && b.chacoteTime !== null) return -1;
  if (a.chacoteTime !== null && b.chacoteTime === null) return 1;
  if (a.chacoteTime !== null && b.chacoteTime !== null) {
    if (a.chacoteTime !== b.chacoteTime) {
      return a.chacoteTime - b.chacoteTime;
    }
  }

  return 0;
};

const comparePhysicalRoute = (
  a: WarehouseSlot,
  b: WarehouseSlot
) =>
  Number(a.estoque) - Number(b.estoque) ||
  moduleNumber(a) - moduleNumber(b) ||
  normalizePosition(a.posicao).localeCompare(
    normalizePosition(b.posicao),
    "pt-BR",
    { numeric: true }
  );

type SeparationUnit = {
  key: string;
  structure: "2" | "3";
  slots: WarehouseSlot[];
  chacoteTime: number | null;
  quantity: number;
};

const findAddressRows = (
  slots: WarehouseSlot[],
  target: WarehouseSlot
): WarehouseSlot[] =>
  slots.filter(
    slot =>
      slot.estoque === target.estoque &&
      normalizeModule(slot.modulo) === normalizeModule(target.modulo) &&
      normalizePosition(slot.posicao) === normalizePosition(target.posicao)
  );

const buildSeparationUnits = ({
  slots,
  sku,
  activePhysicalPositionKeys,
  requestedRestriction,
  requestedStructure,
}: {
  slots: WarehouseSlot[];
  sku: string;
  activePhysicalPositionKeys: ActivePhysicalPositionKeys;
  requestedRestriction?: ConsultorRestriction;
  requestedStructure?: "2" | "3" | null;
}): SeparationUnit[] => {
  const normalizedSku = normalizeSku(sku);
  const units: SeparationUnit[] = [];

  if (requestedStructure !== "3") {
    slots
      .filter(
        slot =>
          slot.estoque === "2" &&
          isPhysicalPositionActive(slot, activePhysicalPositionKeys) &&
          slot.saldo > 0 &&
          normalizeSku(slot.referencia) === normalizedSku &&
          matchesRestriction(slot, requestedRestriction)
      )
      .forEach(slot => {
        units.push({
          key: physicalAddressKey(slot),
          structure: "2",
          slots: [slot],
          chacoteTime: parseChacoteDate(slot.dataChacote),
          quantity: slot.saldo,
        });
      });
  }

  if (requestedStructure !== "2") {
    const e3Positions = slots.filter(
      slot =>
        slot.estoque === "3" &&
        isPhysicalPositionActive(slot, activePhysicalPositionKeys)
    );

    const visitedCages = new Set<string>();

    for (const position of e3Positions) {
      const pair = getCagePair(position.posicao);
      if (!pair) continue;

      const cageKey =
        `3-${normalizeModule(position.modulo)}-${pair.key}`;

      if (visitedCages.has(cageKey)) continue;

      const counterpartAddress = `3-${normalizeModule(
        position.modulo
      )}-${normalizePosition(pair.counterpartPrefix)}`;

      const firstAddress = physicalAddressKey(position);
      const counterpartExists =
        e3Positions.some(
          slot => physicalAddressKey(slot) === counterpartAddress
        ) ||
        activePhysicalPositionKeys["3"].has(counterpartAddress);

      if (!counterpartExists) continue;

      visitedCages.add(cageKey);

      const cageRows = [
        ...findAddressRows(slots, position),
        ...slots.filter(
          slot => physicalAddressKey(slot) === counterpartAddress
        ),
      ];

      const eligibleTargetRows = cageRows.filter(
        slot =>
          slot.saldo > 0 &&
          normalizeSku(slot.referencia) === normalizedSku &&
          matchesRestriction(slot, requestedRestriction)
      );

      if (eligibleTargetRows.length === 0) continue;

      const orderedTargetRows = eligibleTargetRows
        .map(slot => ({
          slot,
          chacoteTime: parseChacoteDate(slot.dataChacote),
        }))
        .sort((a, b) => {
          const fifo = compareChacote(a, b);
          if (fifo !== 0) return fifo;

          return (
            a.slot.saldo - b.slot.saldo ||
            comparePhysicalRoute(a.slot, b.slot)
          );
        });

      const cageQuantity = orderedTargetRows.reduce(
        (sum, item) => sum + item.slot.saldo,
        0
      );

      units.push({
        key: cageKey,
        structure: "3",
        slots: orderedTargetRows.map(item => item.slot),
        chacoteTime:
          orderedTargetRows.some(item => item.chacoteTime === null)
            ? null
            : orderedTargetRows.reduce<number | null>(
                (oldest, item) =>
                  oldest === null
                    ? item.chacoteTime
                    : item.chacoteTime !== null
                      ? Math.min(oldest, item.chacoteTime)
                      : oldest,
                null
              ),
        quantity: cageQuantity,
      });
    }
  }

  return units;
};

const allocateSeparationUnit = (
  unit: SeparationUnit,
  requestedQty: number
): ConsultorSeparationItem[] => {
  let remaining = requestedQty;

  const orderedSlots = [...unit.slots].sort((a, b) => {
    const fifo = compareChacote(
      { chacoteTime: parseChacoteDate(a.dataChacote) },
      { chacoteTime: parseChacoteDate(b.dataChacote) }
    );

    if (fifo !== 0) return fifo;

    return (
      a.saldo - b.saldo ||
      comparePhysicalRoute(a, b)
    );
  });

  const result: ConsultorSeparationItem[] = [];

  for (const slot of orderedSlots) {
    if (remaining <= 0) break;

    const quantity = Math.min(slot.saldo, remaining);
    if (quantity <= 0) continue;

    result.push({
      slot,
      quantity,
      chacoteTime: parseChacoteDate(slot.dataChacote),
      structure: unit.structure,
    });

    remaining -= quantity;
  }

  return result;
};

export const buildSeparationPlan = ({
  slots,
  sku,
  requestedQty,
  activePhysicalPositionKeys,
  requestedRestriction,
  requestedStructure,
}: {
  slots: WarehouseSlot[];
  sku: string;
  requestedQty: number;
  activePhysicalPositionKeys: ActivePhysicalPositionKeys;
  requestedRestriction?: ConsultorRestriction;
  requestedStructure?: "2" | "3" | null;
}) => {
  const units = buildSeparationUnits({
    slots,
    sku,
    activePhysicalPositionKeys,
    requestedRestriction,
    requestedStructure,
  });

  const orderedUnits = [...units].sort((a, b) => {
    const fifo = compareChacote(a, b);
    if (fifo !== 0) return fifo;

    // For the same chacote, use the smaller available unit first to avoid
    // opening more stock than necessary. This does not create a priority
    // between E2 and E3.
    if (a.quantity !== b.quantity) {
      return a.quantity - b.quantity;
    }

    return (
      Number(a.slots[0]?.estoque || 0) -
        Number(b.slots[0]?.estoque || 0) ||
      moduleNumber(a.slots[0]) - moduleNumber(b.slots[0]) ||
      comparePhysicalRoute(a.slots[0], b.slots[0])
    );
  });

  let remaining = requestedQty;
  const selected: ConsultorSeparationItem[] = [];

  for (const unit of orderedUnits) {
    if (remaining <= 0) break;

    const allocation = allocateSeparationUnit(unit, remaining);
    selected.push(...allocation);

    const allocated = allocation.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    remaining -= allocated;
  }

  const plan = [...selected].sort((a, b) =>
    comparePhysicalRoute(a.slot, b.slot)
  );

  return {
    plan,
    remaining,
    complete: remaining <= 0,
    totalAvailable: units.reduce(
      (sum, unit) => sum + unit.quantity,
      0
    ),
  };
};

export const buildRemontagemPlan = ({
  slots,
  products,
  sku,
  requestedQty,
  activePhysicalPositionKeys,
  requestedRestriction,
  requestedStructure,
}: {
  slots: WarehouseSlot[];
  products: Product[];
  sku: string;
  requestedQty: number;
  activePhysicalPositionKeys: ActivePhysicalPositionKeys;
  requestedRestriction?: ConsultorRestriction;
  requestedStructure?: "2" | "3" | null;
}): ConsultorRemontagemPlan => {
  const normalizedSku = normalizeSku(sku);
  const product = products.find(
    item => normalizeSku(item.referencia) === normalizedSku
  );
  const capacity = Number(product?.paletizacao || 0);

  if (capacity <= 0 || requestedQty <= 0) {
    return {
      sku: normalizedSku,
      descricao: product?.descricao || sku,
      requestedQty,
      capacity,
      allocations: [],
      remaining: requestedQty,
      complete: false,
      totalFreeCapacity: 0,
    };
  }

  const physicalSaldo = getPhysicalSaldoMap(slots);
  const { map: distanceMap } = buildDistanceMap(
    slots,
    normalizedSku,
    activePhysicalPositionKeys,
    requestedRestriction
  );

  const candidates = slots
    .filter(slot => {
      if (
        (slot.estoque !== "2" && slot.estoque !== "3") ||
        !isPhysicalPositionActive(slot, activePhysicalPositionKeys) ||
        slot.saldo <= 0 ||
        normalizeSku(slot.referencia) !== normalizedSku ||
        !matchesRestriction(slot, requestedRestriction) ||
        (requestedStructure && slot.estoque !== requestedStructure)
      ) {
        return false;
      }

      const totalPhysicalSaldo =
        physicalSaldo.get(physicalAddressKey(slot)) || 0;
      return capacity - totalPhysicalSaldo > 0;
    })
    .map(slot => ({
      slot,
      freeCapacity: Math.max(
        0,
        capacity - (physicalSaldo.get(physicalAddressKey(slot)) || 0)
      ),
      distance: distanceMap.get(moduleNumber(slot)) || 0,
    }))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        b.freeCapacity - a.freeCapacity ||
        b.slot.saldo - a.slot.saldo ||
        comparePhysicalRoute(a.slot, b.slot)
    );

  let remaining = requestedQty;
  const allocations: ConsultorRemontagemAllocation[] = [];

  for (const candidate of candidates) {
    if (remaining <= 0) break;

    const quantity = Math.min(remaining, candidate.freeCapacity);
    if (quantity <= 0) continue;

    allocations.push({
      slot: candidate.slot,
      quantity,
      freeCapacityBefore: candidate.freeCapacity,
    });
    remaining -= quantity;
  }

  return {
    sku: normalizedSku,
    descricao: product?.descricao || sku,
    requestedQty,
    capacity,
    allocations,
    remaining,
    complete: remaining <= 0,
    totalFreeCapacity: candidates.reduce(
      (sum, item) => sum + item.freeCapacity,
      0
    ),
  };
};

export const buildChacoteQuantityAnalysis = ({
  slots,
  products,
  sku,
  cutoffDate,
}: {
  slots: WarehouseSlot[];
  products: Product[];
  sku: string;
  cutoffDate: string;
}): ConsultorChacoteQuantityAnalysis => {
  const normalizedSku = normalizeSku(sku);
  const product = products.find(
    item => normalizeSku(item.referencia) === normalizedSku
  );
  const cutoffTime = parseChacoteDate(cutoffDate);

  let withoutChacoteDate = 0;
  let datedUpToCutoff = 0;
  let totalCurrent = 0;
  let datedPositions = 0;
  let withoutDatePositions = 0;

  if (cutoffTime === null) {
    return {
      sku: normalizedSku,
      descricao: product?.descricao || sku,
      cutoffDate,
      withoutChacoteDate: 0,
      datedUpToCutoff: 0,
      totalEligible: 0,
      totalCurrent: 0,
      datedPositions: 0,
      withoutDatePositions: 0,
    };
  }

  for (const slot of slots) {
    if (
      slot.saldo <= 0 ||
      normalizeSku(slot.referencia) !== normalizedSku
    ) {
      continue;
    }

    totalCurrent += slot.saldo;

    const chacoteTime = parseChacoteDate(slot.dataChacote);

    if (chacoteTime === null) {
      withoutChacoteDate += slot.saldo;
      withoutDatePositions += 1;
      continue;
    }

    datedPositions += 1;

    if (chacoteTime <= cutoffTime) {
      datedUpToCutoff += slot.saldo;
    }
  }

  return {
    sku: normalizedSku,
    descricao: product?.descricao || sku,
    cutoffDate,
    withoutChacoteDate,
    datedUpToCutoff,
    totalEligible: withoutChacoteDate + datedUpToCutoff,
    totalCurrent,
    datedPositions,
    withoutDatePositions,
  };
};

export const buildStrategyAnalysis = ({
  slots,
  products,
  sku,
  activePhysicalPositionKeys,
  requestedRestriction,
}: {
  slots: WarehouseSlot[];
  products: Product[];
  sku: string;
  activePhysicalPositionKeys?: ActivePhysicalPositionKeys;
  requestedRestriction?: ConsultorRestriction;
}): ConsultorStrategyAnalysis => {
  const normalizedSku = normalizeSku(sku);
  const product = products.find(
    item => normalizeSku(item.referencia) === normalizedSku
  );

  const skuSlots = slots.filter(
    slot =>
      (slot.estoque === "2" || slot.estoque === "3") &&
      (!activePhysicalPositionKeys ||
        isPhysicalPositionActive(slot, activePhysicalPositionKeys)) &&
      normalizeSku(slot.referencia) === normalizedSku &&
      slot.saldo > 0 &&
      matchesRestriction(slot, requestedRestriction)
  );

  const totalSaldo = skuSlots.reduce((sum, slot) => sum + slot.saldo, 0);
  const paletizacao = Number(product?.paletizacao || 0);
  const totalPaletes =
    paletizacao > 0 ? Math.ceil(totalSaldo / paletizacao) : 0;
  const totalPosicoes = skuSlots.length;
  const totalModulos = new Set(skuSlots.map(moduleNumber)).size;
  const capacidadeTotal = totalPosicoes * paletizacao;
  const ocupacaoPercentual =
    capacidadeTotal > 0
      ? (totalSaldo / capacidadeTotal) * 100
      : 0;

  const restrictedSaldo = slots
    .filter(
      slot =>
        (slot.estoque === "2" || slot.estoque === "3") &&
        (!activePhysicalPositionKeys ||
          isPhysicalPositionActive(slot, activePhysicalPositionKeys)) &&
        normalizeSku(slot.referencia) === normalizedSku &&
        slot.saldo > 0 &&
        !matchesRestriction(slot, requestedRestriction)
    )
    .reduce((sum, slot) => sum + slot.saldo, 0);

  const grouped = getConcentrationModules(
    slots,
    normalizedSku,
    activePhysicalPositionKeys,
    requestedRestriction
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
    totalPosicoes,
    totalModulos,
    capacidadeTotal,
    ocupacaoPercentual,
    restrictedSaldo,
    modules,
    concentrationModule,
    nearbyModules,
  };
};
