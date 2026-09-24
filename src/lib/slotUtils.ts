import type { WarehouseSlot } from "../types";

export const getPhysicalAddressKey = (
  slot: Pick<WarehouseSlot, "estoque" | "modulo" | "posicao">
): string =>
  `${slot.estoque}|${slot.modulo}|${slot.posicao}`;
