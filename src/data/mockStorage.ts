import { Product, WarehouseSlot, LancamentoRow, HistoricoMov, Divergencia, Restricao, WarehouseLayoutEntry, WarehousePositionConfig } from "../types";
import { findProductInList } from "./products";
import { E1_CAPACITY } from "../constants/layout";

// Helper to generate a unique ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9).toUpperCase();
}

/**
 * Gera um ID estável para o registro de uma linha de lançamento.
 * Se a resposta da RPC se perder depois de o banco confirmar a transação e o
 * rascunho reaparecer, o mesmo payload produzirá o mesmo ID de histórico. A PK
 * history.id rejeitará a segunda gravação e a transação atômica será revertida.
 * Se o operador alterar os dados da linha, o hash muda e permite nova operação.
 */
function getStableLaunchRecordId(prefix: string, row: LancamentoRow): string {
  const payload = [
    row.id,
    row.data,
    row.estoque,
    row.modulo,
    row.posicao,
    row.referencia,
    row.quantidade,
    row.tipo,
    row.dataChacote,
    row.hora,
    row.responsavel,
    row.galpao,
    row.restricao,
    row.observacao,
  ].map(value => String(value ?? "")).join("\u001f");

  // FNV-1a 32-bit: row.id (random and stable for the draft line) supplies the
  // primary identity; the hash distinguishes edits to the same line.
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const rowId = String(row.id || generateId())
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 80);
  return `${prefix}-${rowId}-${hash.toString(36).toUpperCase()}`;
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
 *    Estoque 1: ruas cadastradas e ativas na configuração física
 *    Estoque 2/3: módulo ativo na configuração física
 * - Posição: mandatory for Estoque 2 and 3 ONLY, and must be active in the physical configuration
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


const normalizeLaunchDate = (value: string): string | null => {
  const clean = value.trim();
  if (!clean) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const date = new Date(`${clean}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : clean;
  }

  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(clean);
  if (!br) return null;

  const [, day, month, year] = br;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return iso;
};

const isConfiguredModuleActive = (
  warehouseLayout: WarehouseLayoutEntry[] | undefined,
  estoque: string,
  modulo: string
): boolean => {
  if (!warehouseLayout || warehouseLayout.length === 0 || estoque === "1") {
    return true;
  }

  const entry = warehouseLayout.find(
    item =>
      item.estoque === estoque &&
      sameNumericModule(item.modulo, modulo)
  );

  return entry ? entry.ativo : true;
};

export function validateLancamentoRow(
  row: LancamentoRow,
  rowNumber: number,
  productsList: Product[],
  isAdvanced = false,
  currentSlots?: WarehouseSlot[],
  e1Capacity: Record<string, number> = E1_CAPACITY,
  warehouseLayout: WarehouseLayoutEntry[] = [],
  warehousePositions: WarehousePositionConfig[] = []
): string[] {
  const errors: string[] = [];

  // 1. Data
  const normalizedDate = normalizeLaunchDate(row.data || "");
  if (!row.data || !row.data.trim()) {
    errors.push(`Linha ${rowNumber}: Data do lançamento é obrigatória.`);
  } else if (!normalizedDate) {
    errors.push(`Linha ${rowNumber}: Data do lançamento deve estar no formato DD/MM/AAAA.`);
  }

  // 2. Estoque
  const est = row.estoque ? row.estoque.trim().toUpperCase().replace("E", "") : "";
  if (!est || !["1", "2", "3"].includes(est)) {
    errors.push(`Linha ${rowNumber}: Estoque é obrigatório e deve ser 1, 2 ou 3.`);
    return errors; // Stop here as coordinates depend on correct Estoque
  }

  // 3. Galpão
  const galpao = String(row.galpao || "").trim();
  if (galpao && !["3", "12"].includes(galpao)) {
    errors.push(`Linha ${rowNumber}: Galpão deve ser 3 ou 12.`);
  }

  // 4. Modulo (Rua for Estoque 1, Modulo for Estoque 2/3)
  const mod = row.modulo ? row.modulo.trim().toUpperCase().replace(/^[RM]/i, "") : "";
  if (!mod) {
    errors.push(`Linha ${rowNumber}: Módulo/Rua é obrigatório.`);
  } else {
    const modNum = parseInt(mod, 10);
    if (isNaN(modNum) || modNum <= 0) {
      errors.push(`Linha ${rowNumber}: Módulo/Rua deve ser um número inteiro.`);
    } else {
      if (est === "1" && !Object.prototype.hasOwnProperty.call(e1Capacity, String(modNum))) {
        errors.push(`Linha ${rowNumber}: o corredor ${mod} não está ativo/cadastrado no Estoque 1.`);
      } else if (
        (est === "2" || est === "3") &&
        !isConfiguredModuleActive(warehouseLayout, est, String(modNum))
      ) {
        errors.push(`Linha ${rowNumber}: o módulo ${modNum} está inativo na configuração física do Estoque ${est}.`);
      }
    }
  }

  // 4. Posição (Obrigatório apenas para Estoque 2 e 3; em corredor / vão livre no modo avançado pode vir vazio)
  const pos = row.posicao ? row.posicao.trim().toUpperCase() : "";
  if (est === "2" || est === "3") {
    const moduleConfig = warehousePositions.filter(
      position =>
        position.estoque === est &&
        sameNumericModule(position.modulo, mod)
    );
    const activePositions = moduleConfig
      .filter(position => position.ativo)
      .map(position => position.posicao.toUpperCase());

    if (!pos) {
      if (!isAdvanced || currentSlots) {
        errors.push(`Linha ${rowNumber}: Posição é obrigatória para o Estoque ${est}.`);
      }
    } else if (moduleConfig.length > 0 && !activePositions.includes(pos)) {
      errors.push(
        `Linha ${rowNumber}: Posição '${pos}' não está ativa na configuração física do Estoque ${est}, módulo ${mod}.`
      );
    } else if (moduleConfig.length === 0) {
      errors.push(
        `Linha ${rowNumber}: O módulo ${mod} do Estoque ${est} não possui posições configuradas.`
      );
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

  // E2/E3 auxiliary IDs encode SKU and restriction. If an occupied row's
  // stored fields disagree with its ID, do not launch anything at that address:
  // otherwise processing could select it by the stored fields and persist a
  // history.slot_id that names a different item.
  if ((est === "2" || est === "3") && pos && currentSlots?.length) {
    const conflictingSlot = currentSlots.find(slot =>
      sameAddress(slot, est, String(parseInt(mod, 10)), pos) &&
      slot.saldo > 0 &&
      Boolean(String(slot.referencia || "").trim()) &&
      getSlotIdentityMismatch(slot) !== null
    );

    if (conflictingSlot) {
      errors.push(
        `Endereço ${est}-${mod}-${pos} contém o item auxiliar '${conflictingSlot.id}' ` +
        "cujo SKU/restrição no registro não corresponde ao ID. Corrija o registro antes de lançar entrada/saída neste endereço."
      );
    }
  }

  // 6. Quantidade
  if (row.quantidade === "" || !Number.isInteger(Number(row.quantidade)) || Number(row.quantidade) <= 0) {
    errors.push(`Linha ${rowNumber}: Quantidade é obrigatória e deve ser um número inteiro maior que zero.`);
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

const normalizeModulo = (value: string): string => {
  const normalized = value.trim().toUpperCase().replace(/^[RM]/i, "");
  // Módulos são identificadores numéricos; "03" deve ser persistido como "3".
  return /^\d+$/.test(normalized) ? String(Number(normalized)) : normalized;
};

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

export const getAuxiliarySlotIdentity = (id: string): { addressId: string; referencia: string; restricao: Restricao } | null => {
  const marker = "::ITEM::";
  const markerIndex = id.indexOf(marker);
  if (markerIndex < 0) return null;

  const [rawReference = "", rawRestriction = "", ...extraParts] = id.slice(markerIndex + marker.length).split("::");
  const normalizedRestriction = rawRestriction.trim().toLowerCase();
  if (
    !rawReference.trim() ||
    !normalizedRestriction ||
    !["nenhuma", "teste", "autorizacao", "outra"].includes(normalizedRestriction) ||
    extraParts.length > 0
  ) return null;

  return {
    addressId: id.slice(0, markerIndex),
    referencia: rawReference.trim().toUpperCase(),
    restricao: normalizedRestriction as Restricao,
  };
};

const addressIdMatchesSlot = (addressId: string, slot: WarehouseSlot): boolean => {
  const parts = addressId.trim().split("-");
  if (parts.length < 3) return false;

  const idStock = normalizeEstoque(parts[0]);
  const idModule = normalizeModulo(parts[1]);
  const idPosition = normalizePosicao(parts.slice(2).join("-"));
  return idStock === normalizeEstoque(slot.estoque) &&
    idModule === normalizeModulo(slot.modulo) &&
    idPosition === normalizePosicao(slot.posicao || "");
};

/** True if the stock ID still names this physical address and, for auxiliary
 * IDs, the stored SKU/restriction agrees with the suffix encoded in the ID.
 * Empty auxiliary rows may be reused only by the exact same item ID; their
 * old reference fields are deliberately ignored while completely empty. */
export const getSlotIdentityMismatch = (slot: WarehouseSlot): string | null => {
  const rawStock = String(slot.estoque ?? "").trim();
  const rawModule = String(slot.modulo ?? "").trim();
  const rawPosition = String(slot.posicao ?? "");
  const stock = normalizeEstoque(rawStock);
  const module = normalizeModulo(rawModule);
  const position = normalizePosicao(rawPosition);

  // Encontrar por coordenadas normalizadas não autoriza gravar sobre uma linha
  // legada não canônica. O chamador deve registrar conflito e não criar outro ID.
  if (rawStock !== stock) {
    return `o estoque armazenado '${rawStock}' não está normalizado (esperado '${stock}')`;
  }
  if (rawModule !== module) {
    return `o módulo armazenado '${rawModule}' não está normalizado (esperado '${module}')`;
  }

  if (stock === "1") {
    if (rawPosition !== "") return `o endereço E1 '${slot.id}' possui posição física inesperada '${rawPosition}'`;
    const prefix = `1-${module}-`;
    if (!slot.id.startsWith(prefix) || slot.id.length <= prefix.length) {
      return `o ID E1 '${slot.id}' não segue o padrão '1-${module}-SKU'`;
    }
    const encodedSku = slot.id.slice(prefix.length).trim().toUpperCase();
    const storedSku = String(slot.referencia || "").trim().toUpperCase();
    if (storedSku && storedSku !== encodedSku) {
      return `o SKU armazenado '${storedSku}' não corresponde ao SKU '${encodedSku}' do ID E1 '${slot.id}'`;
    }
    return null;
  }

  if (!isE2E3(stock)) return null;
  if (rawPosition !== position) {
    return `a posição armazenada '${rawPosition}' não está normalizada (esperado '${position}')`;
  }

  const canonicalAddressId = `${stock}-${module}-${position}`;
  const identity = isAuxiliarySlotId(slot.id) ? getAuxiliarySlotIdentity(slot.id) : null;
  const encodedAddress = identity?.addressId ?? slot.id;
  if (encodedAddress !== canonicalAddressId || !addressIdMatchesSlot(encodedAddress, slot)) {
    return `o ID '${slot.id}' não corresponde ao endereço físico canônico ${canonicalAddressId}`;
  }

  if (!isAuxiliarySlotId(slot.id)) return null;
  if (!identity) return `o ID auxiliar '${slot.id}' não contém SKU e restrição válidos`;

  const isOccupiedOrHasReference = Number(slot.saldo || 0) > 0 || Boolean(String(slot.referencia || "").trim());
  if (!isOccupiedOrHasReference) return null;

  if (String(slot.referencia || "").trim().toUpperCase() !== identity.referencia) {
    return `o SKU armazenado '${slot.referencia}' não corresponde ao SKU '${identity.referencia}' do ID '${slot.id}'`;
  }
  if (normalizeRestricao(slot.restricao) !== identity.restricao) {
    return `a restrição armazenada '${normalizeRestricao(slot.restricao)}' não corresponde à restrição '${identity.restricao}' do ID '${slot.id}'`;
  }
  return null;
};


/** Checks an E2/E3 base-address row against its own physical coordinates. */
export const isBasePhysicalSlotAtOwnAddress = (slot: WarehouseSlot): boolean =>
  isE2E3(normalizeEstoque(slot.estoque)) &&
  !isAuxiliarySlotId(slot.id) &&
  getSlotIdentityMismatch(slot) === null;

const buildAddressId = (
  estoque: string,
  modulo: string,
  posicao: string
): string => `${normalizeEstoque(estoque)}-${normalizeModulo(modulo)}-${normalizePosicao(posicao)}`;

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
  normalizeEstoque(slot.estoque) === normalizeEstoque(estoque) &&
  sameNumericModule(slot.modulo, modulo) &&
  normalizePosicao(slot.posicao || "") === normalizePosicao(posicao || "");

const sameLogicalItem = (
  slot: WarehouseSlot,
  estoque: string,
  modulo: string,
  posicao: string,
  referencia: string,
  restricao: Restricao
): boolean =>
  sameAddress(slot, estoque, modulo, posicao) &&
  getSlotIdentityMismatch(slot) === null &&
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
  isAdvanced = false,
  e1Capacity: Record<string, number> = E1_CAPACITY,
  warehouseLayout: WarehouseLayoutEntry[] = []
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

  const sortedRows = [...rows].map(row => ({
    ...row,
    data: normalizeLaunchDate(row.data) || row.data,
  })).sort((a, b) => {
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

    if (!isConfiguredModuleActive(warehouseLayout, estVal, modVal)) {
      errorCount++;
      newDivergencias.push({
        id: `DIV-${generateId()}`,
        dataDivergencia: batchDate,
        tipoDivergencia: "Módulo Inativo",
        estoque: estVal,
        modulo: modVal,
        posicao: posVal,
        refAtual: "",
        refNova: prod.referencia,
        saldoAntes: 0,
        movimentacao: row.tipo === "Saída" ? -qty : qty,
        saldoFinal: 0,
        responsavel: row.responsavel || batchOperator,
        status: "Aberta",
        dataChacote: row.dataChacote || "",
        observacao: `O módulo ${modVal} do Estoque ${estVal} está inativo na configuração física. A movimentação não foi aplicada.`,
        restricao: requestedRestricao,
      });
      continue;
    }
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

    const matchingLogicalIndexes = slots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => sameLogicalItem(
        slot,
        estVal,
        modVal,
        posVal,
        refUpper,
        requestedRestricao
      ))
      .map(({ index }) => index);
    let exactSlotIdx = matchingLogicalIndexes[0] ?? -1;

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

    // Normalize coordinates only for locating candidates. If a row is stored in
    // a non-canonical form (e.g. module "03" or position "a1 "), stop the move
    // and report a divergence instead of creating a second canonical ID beside it.
    const inconsistentAtAddress = addressSlots.find(slot => getSlotIdentityMismatch(slot) !== null);
    if (inconsistentAtAddress) {
      createDivergence(
        "ID de Endereço Inconsistente",
        `A movimentação foi bloqueada: ${getSlotIdentityMismatch(inconsistentAtAddress)}. ` +
        "Confira e normalize o registro existente antes de lançar. Nenhum saldo foi alterado nem outro ID foi criado.",
        row.tipo === "Saída" ? -qty : qty,
        inconsistentAtAddress,
        false,
        inconsistentAtAddress.referencia || "Vazio",
        Number(inconsistentAtAddress.saldo || 0)
      );
      continue;
    }

    // A line-base can be reused by different SKUs over time; an E1 line or an
    // auxiliary E2/E3 line cannot be reassigned to an identity encoded in another ID.
    if (isE2E3(estVal)) {
      const expectedBaseId = buildAddressId(estVal, modVal, posVal);
      const expectedItemId = buildItemId(expectedBaseId, refUpper, requestedRestricao);
      const idCollision = slots.find(slot =>
        (slot.id === expectedBaseId || slot.id === expectedItemId) &&
        (!sameAddress(slot, estVal, modVal, posVal) || getSlotIdentityMismatch(slot) !== null)
      );
      if (idCollision) {
        createDivergence(
          "ID já associado a outro endereço",
          `A movimentação foi bloqueada porque o ID determinístico '${idCollision.id}' já existe, ` +
          "mas seus campos físicos não correspondem ao endereço solicitado. Nenhum registro novo foi criado.",
          row.tipo === "Saída" ? -qty : qty,
          undefined,
          false,
          "Vazio",
          0
        );
        continue;
      }

      if (matchingLogicalIndexes.length > 1) {
        createDivergence(
          "Item Duplicado na Posição",
          `Foram encontrados ${matchingLogicalIndexes.length} registros para ${refUpper} / ${requestedRestricao} ` +
          `em ${estVal}-${modVal}-${posVal}. A movimentação foi bloqueada para não escolher um ID arbitrariamente.`,
          row.tipo === "Saída" ? -qty : qty,
          slots[matchingLogicalIndexes[0]],
          false
        );
        continue;
      }
    }

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
        normalizeEstoque(slot.estoque) === "1" &&
        normalizeModulo(slot.modulo) === modVal &&
        String(slot.referencia || "").trim().toUpperCase() === refUpper
      );
    }

    if (row.tipo === "Entrada") {
      if (estVal === "1") {
        if (exactSlotIdx === -1) {
          // E1 has one logical row per Rua + SKU. If a previous saída
          // reduced that logical item to zero, reuse its deterministic ID
          // instead of creating a second in-memory object with the same ID.
          const reusableE1Idx = slots.findIndex(slot =>
            slot.id === `${estVal}-${modVal}-${refUpper}` &&
            slot.saldo === 0
          );

          if (reusableE1Idx >= 0) {
            exactSlotIdx = reusableE1Idx;
          } else {
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
          // Reuse an empty auxiliary only when its ID already encodes the item
          // being entered. Reusing any empty auxiliary row by address alone
          // would leave an ID that names a different SKU/restriction.
          // Prefer the exact auxiliary ID first, then the generic base address.
          const baseAddressId = buildAddressId(estVal, modVal, posVal);
          const requestedItemId = buildItemId(baseAddressId, refUpper, requestedRestricao);
          const reusableExactAuxIdx = slots.findIndex(slot =>
            slot.id === requestedItemId &&
            sameAddress(slot, estVal, modVal, posVal) &&
            slot.saldo === 0 &&
            !String(slot.referencia || "").trim()
          );
          const reusableBaseIdx = slots.findIndex(slot =>
            slot.id === baseAddressId &&
            sameAddress(slot, estVal, modVal, posVal) &&
            !isAuxiliarySlotId(slot.id) &&
            slot.saldo === 0 &&
            !String(slot.referencia || "").trim()
          );
          const reusableIdx = reusableExactAuxIdx >= 0
            ? reusableExactAuxIdx
            : reusableBaseIdx;

          if (reusableIdx >= 0) {
            exactSlotIdx = reusableIdx;
          } else {
            const newSlot: WarehouseSlot = {
              id: requestedItemId,
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
        id: getStableLaunchRecordId("MOV", row),
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
      // Keep an auxiliary slot's restriction aligned with its immutable ID
      // suffix so a later entry can safely reuse the same exact item ID.
      activeSlot.restricao = isAuxiliarySlotId(activeSlot.id)
        ? (getAuxiliarySlotIdentity(activeSlot.id)?.restricao || normalizeRestricao(activeSlot.restricao))
        : "nenhuma";
      activeSlot.observacao = "";
    }

    const completedSlotId = activeSlot.id;

    newHistory.push({
      id: getStableLaunchRecordId("MOV", row),
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
      slotId: completedSlotId,
      restricao: requestedRestricao,
    });

    // The caller persists the now-empty auxiliary row first, appends history,
    // and then deletes only that exact empty ID. This order prevents a failed
    // history insert from losing the slot identity needed to reconcile the move.
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

  // Transfers move one item row, but the target must be the canonical physical
  // base slot, never an auxiliary item row. Fail closed if either ID contradicts
  // its address or an auxiliary source contradicts its encoded SKU/restriction.
  if (
    getSlotIdentityMismatch(source) !== null ||
    !isBasePhysicalSlotAtOwnAddress(destination)
  ) {
    return {
      updatedSlots: currentSlots,
      newHistory: [],
      newDivergencias: [],
      processedCount: 0,
      errorCount: 1,
    };
  }

  const destinationHasOtherStock = slots.some(slot =>
    slot.id !== destination.id &&
    sameAddress(slot, destination.estoque, normalizeModulo(destination.modulo), normalizePosicao(destination.posicao)) &&
    (Number(slot.saldo || 0) > 0 || Boolean(String(slot.referencia || "").trim()))
  );
  if (destinationHasOtherStock) {
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
  const sourceGalpao = source.galpao || "3";
  const itemRestriction = normalizeRestricao(source.restricao);
  const sourceWasAuxiliary = isAuxiliarySlotId(source.id);
  const hour = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  destination.referencia = reference;
  destination.descricao = description;
  destination.saldo = quantity;
  destination.dataChacote = chacote;
  destination.galpao = sourceGalpao;
  destination.restricao = itemRestriction;
  destination.observacao = source.observacao || "";
  destination.ultimaData = movementDate;
  destination.ultimaHora = hour;
  destination.ultimoResponsavel = operator;

  source.referencia = "";
  source.descricao = "";
  source.saldo = 0;
  source.dataChacote = "";
  source.galpao = "3";
  source.restricao = sourceWasAuxiliary
    ? (getAuxiliarySlotIdentity(source.id)?.restricao || itemRestriction)
    : "nenhuma";
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
      galpao: sourceGalpao,
      observacao: "",
      slotId: source.id,
      restricao: itemRestriction,
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
      galpao: destination.galpao || sourceGalpao,
      observacao: "",
      slotId: destination.id,
      restricao: itemRestriction,
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
