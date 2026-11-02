import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProductBalanceIndex,
  filterProductCatalogRows,
  normalizeProductCatalogRows,
  normalizeSkuReference,
  paginateProductCatalogRows,
} from '../src/lib/productCatalogModel.ts';

const products = [
  { referencia: '12345G', descricao: 'XICARA MONACO', paletizacao: 648 },
  { referencia: 'S54321', descricao: 'PIRES MONACO', paletizacao: '324' },
  { referencia: '', descricao: 'SEM REFERENCIA' },
  null,
];

test('catalog normalization skips invalid SKU rows and preserves valid product data', () => {
  const result = normalizeProductCatalogRows(products);
  assert.equal(result.products.length, 2);
  assert.equal(result.invalidRows, 2);
  assert.equal(result.products[0].referencia, '12345G');
  assert.equal(result.products[1].paletizacao, 324);
});

test('balance index ignores empty warehouse positions and sums S-prefixed SKUs safely', () => {
  const balances = buildProductBalanceIndex([
    { referencia: null, saldo: 0 },
    { referencia: '', saldo: 10 },
    { referencia: 'S12345G', saldo: 100 },
    { referencia: '12345G', saldo: '50' },
    { referencia: 'S54321', saldo: 30 },
    { referencia: 'IGNORADO', saldo: 'saldo inválido' },
    null,
  ]);
  assert.equal(balances.get('12345G'), 150);
  assert.equal(balances.get('54321'), 30);
  assert.equal(balances.has(''), false);
  assert.equal(balances.has('IGNORADO'), false);
});

test('SKU normalization and product search are deterministic', () => {
  assert.equal(normalizeSkuReference(' s123 '), '123');
  const normalized = normalizeProductCatalogRows(products).products;
  assert.deepEqual(filterProductCatalogRows(normalized, 'xICARA'), [normalized[0]]);
  assert.deepEqual(filterProductCatalogRows(normalized, '12345G'), [normalized[0]]);
  assert.equal(filterProductCatalogRows(normalized, '').length, 2);
});

test('pagination bounds the rendered list and clamps a stale page after filtering', () => {
  const many = Array.from({ length: 450 }, (_, index) => ({
    referencia: String(index + 1),
    descricao: `Produto ${index + 1}`,
  }));
  const page = paginateProductCatalogRows(many, 3, 100);
  assert.equal(page.items.length, 100);
  assert.equal(page.pageIndex, 3);
  assert.equal(page.totalPages, 5);
  assert.equal(page.start, 301);
  assert.equal(page.end, 400);

  const clamped = paginateProductCatalogRows(many.slice(0, 30), 3, 100);
  assert.equal(clamped.pageIndex, 0);
  assert.equal(clamped.items.length, 30);
});

test('base panel uses safe aggregate helpers, paginates, and receives the live permission resolver', async () => {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const panel = await readFile(resolve('src/components/BaseDeDadosPanel.tsx'), 'utf8');
  const app = await readFile(resolve('src/App.tsx'), 'utf8');
  assert.match(panel, /buildProductBalanceIndex\(slots\)/);
  assert.match(panel, /visibleProducts\.map/);
  assert.doesNotMatch(panel, /slots\s*\.filter\s*\(/);
  assert.match(app, /permissionEnforcementEnabled=\{permissionEnforcementEnabled\}/);
  assert.match(app, /canUsePermission=\{canUseAppPermissionForUi\}/);
  assert.match(app, /permissionEnforcementEnabled,\s*canUsePermission: canUseAppPermissionForUi,/);
});
