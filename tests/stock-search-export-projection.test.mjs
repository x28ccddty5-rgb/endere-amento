import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStockSearchSpreadsheetRow,
  createStockSearchPdfRow,
  getStockSearchPdfHeaders,
} from '../src/lib/stockSearchExportProjection.ts';

const slot = {
  id: '2-19-B1::ITEM::12345G::outra',
  estoque: '2',
  modulo: '19',
  posicao: 'B1',
  referencia: '12345G',
  descricao: 'Produto de teste',
  saldo: 250,
  dataChacote: '2026-10-20',
  ultimaData: '2026-10-28',
  ultimaHora: '14:30',
  ultimoResponsavel: 'Operador Teste',
  galpao: '3',
  restricao: 'outra',
  observacao: 'Informação interna',
};

const expectedHeaders = [
  'Estoque', 'Módulo/Rua', 'Posição', 'SKU', 'Descrição', 'Saldo',
  'Data Chacote', 'Última Movimentação', 'Responsável', 'Galpão', 'Restrição', 'Observação',
];

test('XLSX exports the fixed operational projection and never exposes the technical slot ID', () => {
  const row = createStockSearchSpreadsheetRow(slot);
  assert.deepEqual(Object.keys(row), [
    'Estoque', 'Modulo_Rua', 'Posicao', 'Referencia_SKU', 'Descricao_Produto',
    'Saldo_Pecas', 'Data_Chacote', 'Ultima_Movimentacao', 'Ultimo_Responsavel',
    'Galpao', 'Restricao', 'Observacao',
  ]);
  assert.equal(row.Referencia_SKU, '12345G');
  assert.equal(row.Modulo_Rua, '19');
  assert.equal(row.Ultima_Movimentacao, '2026-10-28 14:30');
  assert.equal(row.Saldo_Pecas, 250);
  assert.equal(row.Galpao, '3');
  assert.equal(Object.hasOwn(row, 'id'), false);
  assert.equal(Object.hasOwn(row, 'ID'), false);
});

test('PDF and XLSX expose the same 12 operational fields in the same logical order', () => {
  const pdfRow = createStockSearchPdfRow(slot);
  assert.deepEqual(getStockSearchPdfHeaders(), expectedHeaders);
  assert.equal(pdfRow.length, expectedHeaders.length);
  assert.equal(Object.keys(createStockSearchSpreadsheetRow(slot)).length, expectedHeaders.length);
  assert.deepEqual(pdfRow, [
    'E2', '19', 'B1', '12345G', 'Produto de teste', '250',
    '2026-10-20', '2026-10-28 14:30', 'Operador Teste', '3', 'outra', 'Informação interna',
  ]);
});

test('restriction label preserves the operational rule for warehouse 12', () => {
  assert.equal(createStockSearchSpreadsheetRow({ ...slot, galpao: '12', restricao: 'nenhuma' }).Restricao, 'autorizacao');
  assert.equal(createStockSearchPdfRow({ ...slot, galpao: '12', restricao: 'nenhuma' })[10], 'autorizacao');
});
