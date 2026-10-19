import test from 'node:test';
import assert from 'node:assert/strict';
import { processLancamentosInSequence, processTransferenciaPosicao } from '../src/data/mockStorage.ts';
import { enqueueLancamentoDraftWrite } from '../src/lib/lancamentoDraftQueue.ts';

const products = [
  { referencia: 'AAA', descricao: 'Produto AAA' },
  { referencia: 'BBB', descricao: 'Produto BBB' },
];

const blankPhysicalSlot = (overrides = {}) => ({
  id: '2-3-A1',
  estoque: '2',
  modulo: '3',
  posicao: 'A1',
  referencia: '',
  descricao: '',
  saldo: 0,
  dataChacote: '',
  ultimaData: '',
  ultimaHora: '',
  ultimoResponsavel: '',
  galpao: '3',
  restricao: 'nenhuma',
  observacao: '',
  ...overrides,
});

const row = (overrides = {}) => ({
  id: 'TEST-ROW-1',
  data: '2026-10-19',
  estoque: '2',
  modulo: '3',
  posicao: 'A1',
  referencia: 'AAA',
  quantidade: 5,
  tipo: 'Entrada',
  dataChacote: '2026-10-01',
  hora: '08:30',
  responsavel: 'Teste',
  galpao: '3',
  restricao: 'nenhuma',
  observacao: '',
  ...overrides,
});

const run = (rows, slots) => processLancamentosInSequence(
  rows,
  slots,
  'Teste',
  '2026-10-19',
  [],
  products,
  true,
  {},
  [],
);

test('regressão Cloud 10: posição com letra minúscula e espaço não cria um segundo slot', () => {
  const existing = blankPhysicalSlot({ posicao: 'a1 ' });
  const result = run([row()], [existing]);
  assert.equal(result.newHistory.length, 0);
  assert.equal(result.newDivergencias.length, 1);
  assert.match(result.newDivergencias[0].observacao, /não está normalizada|não corresponde/i);
  assert.equal(result.updatedSlots.length, 1);
  assert.equal(result.updatedSlots[0].id, existing.id);
});

test('regressão Cloud 11: módulo E1 03 não é duplicado como módulo 3', () => {
  const existing = blankPhysicalSlot({
    id: '1-03-AAA',
    estoque: '1',
    modulo: '03',
    posicao: '',
    referencia: 'AAA',
    descricao: 'Produto AAA',
    saldo: 25,
  });
  const result = run([row({ estoque: '1', modulo: '3', posicao: '', quantidade: 5, tipo: 'Entrada' })], [existing]);
  assert.equal(result.newHistory.length, 0);
  assert.equal(result.newDivergencias.length, 1);
  assert.equal(result.updatedSlots.length, 1);
  assert.equal(result.updatedSlots[0].id, '1-03-AAA');
  assert.equal(result.updatedSlots[0].saldo, 25);
});

test('regressão de identidade: o mesmo SKU/restrição soma no slot já existente sem duplicar ID', () => {
  const existing = blankPhysicalSlot({
    id: '2-3-A1::ITEM::AAA::nenhuma',
    referencia: 'AAA',
    descricao: 'Produto AAA',
    saldo: 20,
  });
  const result = run([row()], [existing]);
  assert.equal(result.newDivergencias.length, 0);
  assert.equal(result.newHistory.length, 1);
  assert.equal(result.updatedSlots.filter(slot => slot.id === existing.id).length, 1);
  assert.equal(result.updatedSlots.find(slot => slot.id === existing.id).saldo, 25);
  assert.equal(result.newHistory[0].slotId, existing.id);
  assert.equal(result.newHistory[0].referencia, 'AAA');
  assert.equal(result.newHistory[0].restricao, 'nenhuma');
});

test('regressão de saída total e nova entrada: mantém a identidade determinística do item auxiliar', () => {
  const id = '2-3-A1::ITEM::AAA::teste';
  const existing = blankPhysicalSlot({
    id,
    referencia: 'AAA',
    descricao: 'Produto AAA',
    saldo: 5,
    restricao: 'teste',
  });
  const result = run([
    row({ id: 'OUT-1', tipo: 'Saída', quantidade: 5, restricao: 'teste' }),
    row({ id: 'IN-2', tipo: 'Entrada', quantidade: 7, restricao: 'teste' }),
  ], [existing]);
  assert.equal(result.newDivergencias.length, 0);
  assert.equal(result.newHistory.length, 2);
  assert.deepEqual(result.newHistory.map(movement => movement.tipo), ['Saída', 'Entrada']);
  assert.ok(result.newHistory.every(movement => movement.slotId === id));
  assert.equal(new Set(result.updatedSlots.map(slot => slot.id)).size, result.updatedSlots.length);
  assert.equal(result.updatedSlots.find(slot => slot.id === id).saldo, 7);
});

test('regressão Cloud 13: dois SKUs restritos podem compartilhar posição sem duplicar IDs', () => {
  const result = run([
    row({ id: 'RESTR-AAA', referencia: 'AAA', restricao: 'teste', quantidade: 5 }),
    row({ id: 'RESTR-BBB', referencia: 'BBB', restricao: 'autorizacao', quantidade: 7 }),
  ], [blankPhysicalSlot()]);

  assert.equal(result.newDivergencias.length, 0);
  assert.equal(result.newHistory.length, 2);
  assert.deepEqual(
    result.updatedSlots.filter(slot => slot.saldo > 0).map(slot => `${slot.referencia}:${slot.restricao}`).sort(),
    ['AAA:teste', 'BBB:autorizacao'],
  );
  assert.equal(new Set(result.updatedSlots.map(slot => slot.id)).size, result.updatedSlots.length);
});

test('regressão Cloud 14: estoque normal não pode misturar com item restrito na mesma posição', () => {
  const result = run([
    row({ id: 'RESTR-AAA', referencia: 'AAA', restricao: 'teste', quantidade: 5 }),
    row({ id: 'NORMAL-BBB', referencia: 'BBB', restricao: 'nenhuma', quantidade: 7 }),
  ], [blankPhysicalSlot()]);

  assert.equal(result.newDivergencias.length, 1);
  assert.equal(result.newHistory.length, 1);
  assert.equal(result.newDivergencias[0].tipoDivergencia, 'Classificação Incompatível');
  assert.equal(result.updatedSlots.filter(slot => slot.saldo > 0).length, 1);
  assert.equal(result.updatedSlots.find(slot => slot.saldo > 0).referencia, 'AAA');
  assert.equal(new Set(result.updatedSlots.map(slot => slot.id)).size, result.updatedSlots.length);
});

test('regressão de transferência: destino auxiliar é rejeitado, destino base vazio é aceito', () => {
  const source = blankPhysicalSlot({
    id: '2-3-A1::ITEM::AAA::teste',
    referencia: 'AAA',
    descricao: 'Produto AAA',
    saldo: 10,
    restricao: 'teste',
  });
  const auxiliaryDestination = blankPhysicalSlot({
    id: '2-4-A1::ITEM::BBB::teste',
    modulo: '4',
  });
  const rejected = processTransferenciaPosicao(
    source.id,
    auxiliaryDestination.id,
    [source, auxiliaryDestination],
    'Teste',
    '2026-10-19',
  );
  assert.equal(rejected.processedCount, 0);

  const baseDestination = blankPhysicalSlot({
    id: '2-4-A1',
    modulo: '4',
  });
  const accepted = processTransferenciaPosicao(
    source.id,
    baseDestination.id,
    [source, baseDestination],
    'Teste',
    '2026-10-19',
  );
  assert.equal(accepted.processedCount, 1);
  assert.equal(accepted.newHistory.length, 2);
  assert.equal(accepted.newHistory[0].slotId, source.id);
  assert.equal(accepted.newHistory[1].slotId, baseDestination.id);
  assert.equal(accepted.updatedSlots.find(slot => slot.id === baseDestination.id).saldo, 10);
});


test('regressão de idempotência: o mesmo rascunho gera o mesmo ID de histórico', () => {
  const sameDraftRow = row({ id: 'ROW-IDEMPOTENCY-001' });
  const first = run([sameDraftRow], [blankPhysicalSlot()]);
  const repeated = run([sameDraftRow], first.updatedSlots);

  assert.equal(first.newHistory.length, 1);
  assert.equal(repeated.newHistory.length, 1);
  assert.equal(repeated.newHistory[0].id, first.newHistory[0].id);
  assert.equal(repeated.newHistory[0].slotId, first.newHistory[0].slotId);
  // history.id é PRIMARY KEY no Supabase: a tentativa repetida será rejeitada
  // e, por estar na mesma RPC, o saldo não será incrementado pela segunda vez.
});

test('regressão de idempotência: editar uma linha cria uma identidade de operação diferente', () => {
  const original = run([row({ id: 'ROW-IDEMPOTENCY-EDIT' })], [blankPhysicalSlot()]);
  const edited = run([row({ id: 'ROW-IDEMPOTENCY-EDIT', quantidade: 8 })], [blankPhysicalSlot()]);
  assert.notEqual(edited.newHistory[0].id, original.newHistory[0].id);
});

test('fila de rascunho: exclusão aguarda upsert antigo e não é ultrapassada', async () => {
  const events = [];
  let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });

  const saving = enqueueLancamentoDraftWrite(async () => {
    events.push('upsert-inicio');
    await saveGate;
    events.push('upsert-fim');
    return true;
  });
  const deleting = enqueueLancamentoDraftWrite(async () => {
    events.push('delete');
    return true;
  });

  await Promise.resolve();
  assert.deepEqual(events, ['upsert-inicio']);
  releaseSave();
  assert.deepEqual(await Promise.all([saving, deleting]), [true, true]);
  assert.deepEqual(events, ['upsert-inicio', 'upsert-fim', 'delete']);
});

test('fila de rascunho: falha em uma operação não bloqueia as próximas', async () => {
  const events = [];
  const failed = enqueueLancamentoDraftWrite(async () => {
    events.push('falha');
    throw new Error('erro de rede simulado');
  });
  const next = enqueueLancamentoDraftWrite(async () => {
    events.push('proxima');
    return 'ok';
  });

  await assert.rejects(failed, /erro de rede simulado/);
  assert.equal(await next, 'ok');
  assert.deepEqual(events, ['falha', 'proxima']);
});
