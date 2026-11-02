import type { Product } from "../types.ts";

export interface NormalizedProductCatalog {
  products: Product[];
  invalidRows: number;
}

/** Normaliza SKU para comparação sem prefixo legado S. */
export function normalizeSkuReference(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const normalized = String(value).trim().toUpperCase();
  return normalized.startsWith("S") ? normalized.slice(1) : normalized;
}

/**
 * Valida o retorno do banco/cache sem assumir que colunas nullable respeitam
 * os tipos históricos do frontend. Linhas sem SKU são ignoradas, não lançam.
 */
export function normalizeProductCatalogRows(value: unknown): NormalizedProductCatalog {
  const rows = Array.isArray(value) ? value : [];
  const products: Product[] = [];
  let invalidRows = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      invalidRows += 1;
      continue;
    }

    const record = row as Record<string, unknown>;
    const referencia = typeof record.referencia === "string" || typeof record.referencia === "number"
      ? String(record.referencia).trim()
      : "";

    if (!referencia) {
      invalidRows += 1;
      continue;
    }

    const descricao = typeof record.descricao === "string"
      ? record.descricao.trim()
      : "";
    const rawPaletizacao = Number(record.paletizacao ?? 0);

    products.push({
      referencia,
      descricao,
      paletizacao: Number.isFinite(rawPaletizacao) ? rawPaletizacao : 0,
    });
  }

  return { products, invalidRows };
}

/** Soma saldos uma única vez por SKU, em O(slots), sem dereferenciar SKUs nulos. */
export function buildProductBalanceIndex(value: unknown): Map<string, number> {
  const balances = new Map<string, number>();
  const rows = Array.isArray(value) ? value : [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const reference = normalizeSkuReference(record.referencia);
    if (!reference) continue;

    const balance = Number(record.saldo ?? 0);
    if (!Number.isFinite(balance)) continue;

    balances.set(reference, (balances.get(reference) ?? 0) + balance);
  }

  return balances;
}

export function filterProductCatalogRows(products: readonly Product[], searchQuery: string): Product[] {
  const query = String(searchQuery ?? "").trim().toLocaleLowerCase("pt-BR");
  if (!query) return [...products];

  return products.filter((product) => {
    const reference = String(product.referencia ?? "").toLocaleLowerCase("pt-BR");
    const description = String(product.descricao ?? "").toLocaleLowerCase("pt-BR");
    return reference === query || description.includes(query);
  });
}

export interface ProductCatalogPage {
  items: Product[];
  pageIndex: number;
  totalPages: number;
  start: number;
  end: number;
}

/** Paginação defensiva: não renderiza milhares de registros simultaneamente. */
export function paginateProductCatalogRows(
  products: readonly Product[],
  requestedPage: number,
  pageSize: number,
): ProductCatalogPage {
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 100;
  const totalPages = Math.max(1, Math.ceil(products.length / safePageSize));
  const requestedIndex = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0;
  const pageIndex = Math.min(Math.max(0, requestedIndex), totalPages - 1);
  const offset = pageIndex * safePageSize;
  const items = products.slice(offset, offset + safePageSize);

  return {
    items,
    pageIndex,
    totalPages,
    start: items.length ? offset + 1 : 0,
    end: offset + items.length,
  };
}
