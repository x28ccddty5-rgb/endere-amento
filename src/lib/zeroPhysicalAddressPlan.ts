/**
 * Valida e monta a fotografia completa de um zeramento físico E2/E3.
 * Não acessa rede nem grava dados; a confirmação transacional é responsabilidade
 * exclusiva de zero_physical_divergence_address_atomic no PostgreSQL.
 */

export type ZeroAddressSlot = {
  id: string;
  estoque: string;
  modulo: string;
  posicao: string;
  referencia: string | null;
  restricao: string | null;
  saldo: number | null;
  descricao?: string | null;
  dataChacote?: string | null;
  ultimaData?: string | null;
  ultimaHora?: string | null;
  ultimoResponsavel?: string | null;
  galpao?: string | null;
  observacao?: string | null;
  [key: string]: unknown;
};

export type ZeroAddressDivergence = {
  id: string;
  estoque: string;
  modulo: string;
  posicao: string;
  refAtual: string | null;
  refNova?: string | null;
  restricao: string | null;
  status: string;
  slotId?: string | null;
  slot_id?: string | null;
  saldoFinal?: number | null;
  dataCorrecao?: string | null;
  corrigidoPor?: string | null;
  observacao?: string | null;
  correcaoId?: string | null;
  [key: string]: unknown;
};

export type ZeroAddress = { estoque: string; modulo: string; posicao: string };

export type ZeroAddressHistory = {
  id: string;
  dataLancamento: string;
  quemLancou: string;
  data: string;
  estoque: string;
  modulo: string;
  posicao: string;
  referencia: string;
  quantidade: number;
  tipo: "Saída";
  dataChacote: string;
  hora: string;
  responsavel: string;
  observacao: string;
  galpao: string;
  slotId: string;
  restricao: string;
  naturezaTransacao: "correcao_fisica";
  saldoAnterior: number;
  saldoFinal: 0;
  correcaoId: string;
};

export type ZeroPhysicalAddressInput = {
  address: ZeroAddress;
  slotsSnapshotComplete: boolean;
  divergencesSnapshotComplete: boolean;
  slots: ZeroAddressSlot[];
  openDivergences: ZeroAddressDivergence[];
  correctionId: string;
  operator: string;
  date: string;
  time: string;
  observation?: string;
};

export type ZeroPhysicalAddressPlan = {
  addressId: string;
  expectedSlots: ZeroAddressSlot[];
  finalSlots: [ZeroAddressSlot];
  deleteSlotIds: string[];
  expectedOpenDivergences: ZeroAddressDivergence[];
  correctedDivergences: ZeroAddressDivergence[];
  history: ZeroAddressHistory[];
  correctionId: string;
};

export class ZeroPhysicalAddressPlanError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ZeroPhysicalAddressPlanError";
    this.code = code;
  }
}

const fail = (code: string, message: string): never => {
  throw new ZeroPhysicalAddressPlanError(code, message);
};
const text = (value: unknown): string => String(value ?? "").trim();
const stockKey = (value: unknown): string => text(value).toUpperCase().replace(/^E/, "");
const moduleKey = (value: unknown): string => {
  const raw = text(value).toUpperCase().replace(/^[MR]/, "");
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
};
const positionKey = (value: unknown): string => text(value).toUpperCase();
const skuKey = (value: unknown): string => text(value).toUpperCase();
const restrictionKey = (value: unknown): string => {
  const normalized = text(value).toLowerCase();
  return ["teste", "autorizacao", "outra"].includes(normalized) ? normalized : "nenhuma";
};
const addressKey = (address: { estoque: unknown; modulo: unknown; posicao: unknown }): string =>
  `${stockKey(address.estoque)}-${moduleKey(address.modulo)}-${positionKey(address.posicao)}`;
const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isInt32NonNegative = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
const canonicalModule = (value: unknown): boolean => {
  const raw = text(value);
  return /^\d+$/.test(raw) && Number(raw) > 0 && raw === String(Number(raw));
};

function parseCanonicalAuxiliaryId(id: string, addressId: string): { sku: string; restriction: string } | null {
  const prefix = `${addressId}::ITEM::`;
  if (!id.startsWith(prefix)) return null;
  const suffix = id.slice(prefix.length);
  const parts = suffix.split("::");
  if (parts.length !== 2 || !parts[0] || parts[0] !== parts[0].toUpperCase()) return null;
  if (!["nenhuma", "teste", "autorizacao", "outra"].includes(parts[1])) return null;
  return { sku: parts[0], restriction: parts[1] };
}

/**
 * Monta o zeramento de um endereço físico inteiro. Exige a base canônica e só
 * aceita auxiliares que codificam corretamente seu SKU/restrição. Todo auxiliar
 * é removido na mesma transação; o histórico agrega por SKU/restrição, evitando
 * duas saídas indistinguíveis para uma identidade duplicada.
 */
export function buildZeroPhysicalAddressPlan(input: ZeroPhysicalAddressInput): ZeroPhysicalAddressPlan {
  const stock = stockKey(input.address.estoque);
  const rawModule = text(input.address.modulo).toUpperCase().replace(/^[MR]/, "");
  const module = moduleKey(input.address.modulo);
  const position = positionKey(input.address.posicao);
  if (!(stock === "2" || stock === "3") || !position || !/^\d+$/.test(module) || Number(module) <= 0) {
    return fail("INVALID_ADDRESS", "O zeramento corretivo só é permitido em uma posição física E2/E3 canônica.");
  }
  if (rawModule !== module || !canonicalModule(input.address.modulo) || module !== String(Number(module))) {
    return fail("NON_CANONICAL_MODULE", "O módulo não está normalizado. Nenhum dado foi alterado.");
  }
  if (!input.slotsSnapshotComplete || !input.divergencesSnapshotComplete) {
    return fail("INCOMPLETE_SNAPSHOT", "O zeramento exige snapshots completos de slots e divergências abertas.");
  }

  const addressId = `${stock}-${module}-${position}`;
  const slots = input.slots;
  if (slots.length === 0) return fail("NO_SLOT_SNAPSHOT", "Não há registros carregados para esta posição.");
  const seenSlotIds = new Set<string>();
  for (const slot of slots) {
    if (seenSlotIds.has(slot.id)) return fail("DUPLICATE_SLOT_ID", `O snapshot repete o ID ${slot.id}.`);
    seenSlotIds.add(slot.id);
    if (addressKey(slot) !== addressId) {
      return fail("SLOT_SCOPE_MISMATCH", `O slot ${slot.id} pertence a outro endereço.`);
    }
    if (!canonicalModule(slot.modulo) || text(slot.modulo) !== module ||
        text(slot.estoque) !== stock || text(slot.posicao) !== position) {
      return fail("NON_CANONICAL_SLOT_ADDRESS", `O slot ${slot.id} tem um endereço não canônico.`);
    }
    const saldo = Number(slot.saldo ?? 0);
    if (!isInt32NonNegative(saldo)) {
      return fail("INVALID_STORED_BALANCE", `O saldo do slot ${slot.id} é inválido.`);
    }
    const sku = skuKey(slot.referencia);
    if (sku === "VAZIO") return fail("INVALID_SLOT_SENTINEL", `O slot ${slot.id} usa a referência inválida VAZIO.`);
    if (!sku && saldo > 0) {
      return fail("BALANCE_WITHOUT_SKU", `O slot ${slot.id} possui saldo sem SKU; exige revisão manual.`);
    }
    const galpao = text(slot.galpao);
    if (galpao !== "3" && galpao !== "12") {
      return fail("INVALID_GALPAO", `O slot ${slot.id} possui galpão inválido: ${galpao || "vazio"}.`);
    }
    const rawRestriction = text(slot.restricao).toLowerCase();
    if (!["nenhuma", "teste", "autorizacao", "outra"].includes(rawRestriction)) {
      return fail("INVALID_RESTRICTION", `O slot ${slot.id} possui restrição inválida: ${rawRestriction || "vazia"}.`);
    }
    if (galpao === "12" && rawRestriction !== "autorizacao") {
      return fail("GALPAO_RESTRICTION_MISMATCH", `O slot ${slot.id} viola a regra do banco: galpão 12 exige restrição autorização.`);
    }

    if (slot.id !== addressId) {
      const auxiliary = parseCanonicalAuxiliaryId(slot.id, addressId);
      if (!auxiliary) {
        return fail("NON_CANONICAL_AUXILIARY_ID", `O ID ${slot.id} não é um auxiliar canônico desta posição.`);
      }
      if (restrictionKey(slot.restricao) !== auxiliary.restriction || (sku && sku !== auxiliary.sku)) {
        return fail("AUXILIARY_IDENTITY_MISMATCH", `O ID ${slot.id} não corresponde à SKU/restrição armazenada.`);
      }
      if (!sku && saldo !== 0) {
        return fail("EMPTY_AUXILIARY_WITH_BALANCE", `O auxiliar ${slot.id} tem saldo sem SKU.`);
      }
    }
  }

  const baseRows = slots.filter(slot => slot.id === addressId);
  if (baseRows.length !== 1) {
    return fail("BASE_SLOT_COUNT_MISMATCH", `Era esperada exatamente uma linha-base ${addressId}.`);
  }
  const base = baseRows[0];

  const divergences = input.openDivergences;
  if (divergences.length === 0) {
    return fail("NO_OPEN_DIVERGENCES", "Não há divergências abertas nesta posição para corrigir.");
  }
  const seenDivergenceIds = new Set<string>();
  for (const divergence of divergences) {
    if (!text(divergence.id) || seenDivergenceIds.has(divergence.id)) {
      return fail("DUPLICATE_DIVERGENCE_ID", "O snapshot contém IDs de divergência vazios ou repetidos.");
    }
    seenDivergenceIds.add(divergence.id);
    if (addressKey(divergence) !== addressId || text(divergence.status).toLowerCase() !== "aberta") {
      return fail("DIVERGENCE_SCOPE_MISMATCH", `A divergência ${divergence.id} não pertence ao conjunto aberto desta posição.`);
    }
    const divergenceSlotId = text(divergence.slot_id ?? divergence.slotId);
    if (divergenceSlotId && divergenceSlotId !== addressId && !seenSlotIds.has(divergenceSlotId)) {
      return fail("DIVERGENCE_SLOT_MISMATCH", `A divergência ${divergence.id} aponta para um slot não carregado desta posição.`);
    }
  }

  const correctionId = text(input.correctionId);
  if (!isUuid(correctionId)) return fail("INVALID_CORRECTION_ID", "O identificador idempotente da correção é inválido.");
  const operator = text(input.operator);
  if (!operator) return fail("MISSING_OPERATOR", "O operador responsável não está identificado.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    return fail("INVALID_TIMESTAMP", "A data/hora da correção é inválida.");
  }

  // O índice history_physical_correction_identity_uidx permite exatamente uma
  // linha por correção/endereço/SKU/restrição. Portanto, consolidamos por SKU +
  // restrição; diferenças de Chacote/Galpão ficam explícitas na observação, sem
  // desativar a proteção nem inventar uma única data para saldos de origens distintas.
  const baseGalpao = text(base.galpao);
  const balanceByIdentity = new Map<string, {
    sku: string;
    restriction: string;
    quantity: number;
    sources: Array<{ slotId: string; quantity: number; dataChacote: string; galpao: string }>;
    dataChacoteValues: Set<string>;
    galpaoValues: Set<string>;
  }>();
  for (const slot of slots) {
    const sku = skuKey(slot.referencia);
    const saldo = Number(slot.saldo ?? 0);
    if (!sku || saldo <= 0) continue;
    const restriction = restrictionKey(slot.restricao);
    const dataChacote = text(slot.dataChacote);
    const galpao = text(slot.galpao);
    const key = `${sku}\u0000${restriction}`;
    const current = balanceByIdentity.get(key) ?? {
      sku, restriction, quantity: 0, sources: [],
      dataChacoteValues: new Set<string>(), galpaoValues: new Set<string>(),
    };
    current.quantity += saldo;
    if (!isInt32NonNegative(current.quantity)) {
      return fail("AGGREGATED_BALANCE_OVERFLOW", `A soma do SKU ${sku} na mesma combinação SKU/restrição excede o limite de saldo permitido.`);
    }
    current.sources.push({ slotId: slot.id, quantity: saldo, dataChacote, galpao });
    current.dataChacoteValues.add(dataChacote);
    current.galpaoValues.add(galpao);
    balanceByIdentity.set(key, current);
  }

  const observationSuffix = text(input.observation);
  const history: ZeroAddressHistory[] = Array.from(balanceByIdentity.values())
    .sort((a, b) => a.sku.localeCompare(b.sku) || a.restriction.localeCompare(b.restriction))
    .map((identity, index) => {
      const distinctDataChacote = Array.from(identity.dataChacoteValues).sort();
      const metadataDivergent = identity.dataChacoteValues.size > 1 || identity.galpaoValues.size > 1;
      const sourceAudit = identity.sources
        .sort((a, b) => a.slotId.localeCompare(b.slotId))
        .map(source => `${source.slotId}: saldo=${source.quantity}; dataChacote=${source.dataChacote || "(vazio)"}; galpao=${source.galpao}`)
        .join(" | ");
      const metadataNote = metadataDivergent
        ? `Metadados de origem divergentes: ${sourceAudit}. Histórico consolidado por SKU/restrição para preservar a unicidade da correção; dataChacote fica vazio porque as origens divergem.`
        : "";
      return {
        id: `CORR-${correctionId}-${index + 1}`,
        dataLancamento: input.date,
        quemLancou: operator,
        data: input.date,
        estoque: stock,
        modulo: module,
        posicao: position,
        referencia: identity.sku,
        quantidade: identity.quantity,
        tipo: "Saída" as const,
        dataChacote: distinctDataChacote.length === 1 ? distinctDataChacote[0] : "",
        hora: input.time,
        responsavel: operator,
        observacao: [
          `Zeramento físico integral da posição ${addressId}; contagem física confirmada em zero; correção ${correctionId}.`,
          metadataNote,
          observationSuffix,
        ].filter(Boolean).join(" "),
        // galpao identifica a posição física: preservar o galpão da linha-base.
        galpao: baseGalpao,
        slotId: addressId,
        restricao: identity.restriction,
        naturezaTransacao: "correcao_fisica" as const,
        saldoAnterior: identity.quantity,
        saldoFinal: 0 as const,
        correcaoId: correctionId,
      };
    });

  const finalBase: ZeroAddressSlot = {
    ...base,
    referencia: "",
    descricao: "",
    saldo: 0,
    dataChacote: "",
    galpao: baseGalpao,
    restricao: baseGalpao === "12" ? "autorizacao" : "nenhuma",
    observacao: "",
    ultimaData: input.date,
    ultimaHora: input.time,
    ultimoResponsavel: operator,
  };

  const correctedDivergences = divergences.map(divergence => ({
    ...divergence,
    refNova: "",
    saldoFinal: 0,
    status: "Corrigida",
    dataCorrecao: input.date,
    corrigidoPor: operator,
    correcaoId: correctionId,
    observacao: [
      text(divergence.observacao),
      `Zeramento físico integral da posição ${addressId}; todas as linhas auxiliares foram saneadas; contagem física confirmada em zero.`,
      observationSuffix,
    ].filter(Boolean).join(" "),
  }));

  return {
    addressId,
    expectedSlots: slots,
    finalSlots: [finalBase],
    deleteSlotIds: slots.filter(slot => slot.id !== addressId).map(slot => slot.id).sort(),
    expectedOpenDivergences: divergences,
    correctedDivergences,
    history,
    correctionId,
  };
}
