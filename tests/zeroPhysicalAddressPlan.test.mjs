import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildZeroPhysicalAddressPlan,
  ZeroPhysicalAddressPlanError,
} from '../src/lib/zeroPhysicalAddressPlan.ts';

const correctionId = '3b241101-e2bb-4255-8caf-4136c566a962';
const address = { estoque: '2', modulo: '33', posicao: 'A1' };
const baseId = '2-33-A1';
const aux = (sku, restriction = 'nenhuma') => `${baseId}::ITEM::${sku}::${restriction}`;
function slot(id, sku, saldo, restriction = 'nenhuma', overrides = {}) {
  return {
    id, estoque: '2', modulo: '33', posicao: 'A1', referencia: sku,
    descricao: sku ? `Produto ${sku}` : '', saldo, dataChacote: '20/10/2026',
    galpao: '3', restricao: restriction, ultimaData: '20/10/2026',
    ultimaHora: '14:00', ultimoResponsavel: 'Operador anterior', observacao: '',
    ...overrides,
  };
}
function divergence(id, refAtual = '71401G', slotId = baseId, restriction = 'nenhuma') {
  return {
    id, estoque: '2', modulo: '33', posicao: 'A1', refAtual,
    refNova: '', restricao: restriction, status: 'Aberta', slotId,
    saldoAntes: 25, movimentacao: -10, saldoFinal: 15, observacao: 'divergência antiga',
  };
}
function input(overrides = {}) {
  return {
    address,
    slotsSnapshotComplete: true,
    divergencesSnapshotComplete: true,
    slots: [slot(baseId, '71401G', 1584), slot(aux('71401G'), '71401G', 25)],
    openDivergences: [
      divergence('DIV-0DJVSRL'),
      divergence('DIV-L1M634X'),
      divergence('DIV-YXBMTDC'),
    ],
    correctionId,
    operator: 'Operador de teste',
    date: '2026-10-21',
    time: '18:10',
    observation: 'Zeramento confirmado no local',
    ...overrides,
  };
}
function expectCode(code, callback) {
  assert.throws(callback, error => error instanceof ZeroPhysicalAddressPlanError && error.code === code);
}

test('zera o endereço duplicado real de forma agregada e preserva os três IDs de divergência', () => {
  const plan = buildZeroPhysicalAddressPlan(input());
  assert.equal(plan.addressId, baseId);
  assert.deepEqual(plan.deleteSlotIds, [aux('71401G')]);
  assert.equal(plan.finalSlots.length, 1);
  assert.equal(plan.finalSlots[0].id, baseId);
  assert.equal(plan.finalSlots[0].saldo, 0);
  assert.equal(plan.finalSlots[0].referencia, '');
  assert.equal(plan.history.length, 1);
  assert.equal(plan.history[0].tipo, 'Saída');
  assert.equal(plan.history[0].quantidade, 1609);
  assert.equal(plan.history[0].saldoAnterior, 1609);
  assert.equal(plan.history[0].saldoFinal, 0);
  assert.equal(plan.history[0].naturezaTransacao, 'correcao_fisica');
  assert.equal(plan.history[0].correcaoId, correctionId);
  assert.equal(plan.correctedDivergences.length, 3);
  assert.ok(plan.correctedDivergences.every(item => item.status === 'Corrigida'));
  assert.ok(plan.correctedDivergences.every(item => item.correcaoId === correctionId));
});

test('agrega uma saída por SKU/restrição ao zerar várias linhas da posição', () => {
  const sku2 = '461401G';
  const result = buildZeroPhysicalAddressPlan(input({
    slots: [
      slot(baseId, '71401G', 1584),
      slot(aux('71401G'), '71401G', 25),
      slot(aux(sku2, 'teste'), sku2, 60, 'teste'),
      slot(aux('953101G'), '953101G', 0),
    ],
    openDivergences: [divergence('DIV-A'), divergence('DIV-B', sku2, aux(sku2, 'teste'), 'teste')],
  }));
  assert.equal(result.history.length, 2);
  assert.deepEqual(result.history.map(row => [row.referencia, row.restricao, row.quantidade]), [
    ['461401G', 'teste', 60],
    ['71401G', 'nenhuma', 1609],
  ]);
  assert.deepEqual(result.deleteSlotIds, [aux('461401G', 'teste'), aux('71401G'), aux('953101G')].sort());
  assert.equal(result.correctedDivergences.length, 2);
});

test('permite zerar endereço sem saldo registrado, encerrando divergências sem inventar saída', () => {
  const result = buildZeroPhysicalAddressPlan(input({
    slots: [slot(baseId, '', 0), slot(aux('71401G'), '', 0)],
    openDivergences: [divergence('DIV-ZERO')],
  }));
  assert.equal(result.history.length, 0);
  assert.equal(result.finalSlots[0].saldo, 0);
  assert.deepEqual(result.deleteSlotIds, [aux('71401G')]);
  assert.equal(result.correctedDivergences[0].status, 'Corrigida');
});

test('bloqueia snapshot incompleto ou sem linha-base canônica', () => {
  expectCode('INCOMPLETE_SNAPSHOT', () => buildZeroPhysicalAddressPlan(input({ slotsSnapshotComplete: false })));
  expectCode('INCOMPLETE_SNAPSHOT', () => buildZeroPhysicalAddressPlan(input({ divergencesSnapshotComplete: false })));
  expectCode('BASE_SLOT_COUNT_MISMATCH', () => buildZeroPhysicalAddressPlan(input({ slots: [slot(aux('71401G'), '71401G', 25)] })));
});

test('bloqueia linha extra com ID não canônico, mesmo se estiver vazia', () => {
  expectCode('NON_CANONICAL_AUXILIARY_ID', () => buildZeroPhysicalAddressPlan(input({
    slots: [...input().slots, slot('2-33-A1::ITEM::sku-lower::nenhuma', '', 0)],
  })));
});

test('bloqueia auxiliar cuja SKU/restrição não corresponde ao ID', () => {
  expectCode('AUXILIARY_IDENTITY_MISMATCH', () => buildZeroPhysicalAddressPlan(input({
    slots: [slot(baseId, '71401G', 1584), slot(aux('71401G'), '71401G', 25, 'teste')],
  })));
  expectCode('AUXILIARY_IDENTITY_MISMATCH', () => buildZeroPhysicalAddressPlan(input({
    slots: [slot(baseId, '71401G', 1584), slot(aux('71401G', 'teste'), '', 0, 'nenhuma')],
  })));
});

test('consolida SKU/restrição com datas de Chacote divergentes em uma saída auditável', () => {
  const plan = buildZeroPhysicalAddressPlan(input({
    slots: [
      slot(baseId, '71401G', 1584, 'nenhuma', { dataChacote: '' }),
      slot(aux('71401G'), '71401G', 25, 'nenhuma', { dataChacote: '19/10/2026' }),
    ],
  }));
  assert.equal(plan.history.length, 1);
  assert.equal(plan.history[0].dataChacote, '');
  assert.equal(plan.history[0].quantidade, 1609);
  assert.equal(plan.history[0].saldoAnterior, 1609);
  assert.match(plan.history[0].observacao, /Metadados de origem divergentes:/);
  assert.match(plan.history[0].observacao, /2-33-A1: saldo=1584; dataChacote=\(vazio\); galpao=3/);
  assert.match(plan.history[0].observacao, /2-33-A1::ITEM::71401G::nenhuma: saldo=25; dataChacote=19\/10\/2026; galpao=3/);
  assert.equal(plan.finalSlots[0].saldo, 0);
});

test('reproduz posição real 2-142-B1: uma única saída de 3718 e auditoria das duas origens', () => {
  const base = '2-142-B1';
  const auxiliary = `${base}::ITEM::953101G::nenhuma`;
  const result = buildZeroPhysicalAddressPlan({
    address: { estoque: '2', modulo: '142', posicao: 'B1' },
    slotsSnapshotComplete: true,
    divergencesSnapshotComplete: true,
    slots: [
      slot(base, '953101G', 1896, 'nenhuma', {
        estoque: '2', modulo: '142', posicao: 'B1', dataChacote: '', galpao: '3',
      }),
      slot(auxiliary, '953101G', 1822, 'nenhuma', {
        estoque: '2', modulo: '142', posicao: 'B1', dataChacote: '06/08/2026', galpao: '3',
      }),
    ],
    openDivergences: [{
      ...divergence('DIV-SIBWJ6H', '953101G', base),
      estoque: '2', modulo: '142', posicao: 'B1', status: 'Aberta',
      slot_id: base, movimentacao: -50, saldoFinal: 1896,
    }],
    correctionId,
    operator: 'Luis Rafaldini',
    date: '2026-10-21',
    time: '22:52',
    observation: 'Teste local com snapshot real',
  });
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].dataChacote, '');
  assert.equal(result.history[0].galpao, '3');
  assert.equal(result.history[0].quantidade, 3718);
  assert.equal(result.history[0].saldoAnterior, 3718);
  assert.match(result.history[0].observacao, /Metadados de origem divergentes:/);
  assert.match(result.history[0].observacao, /2-142-B1: saldo=1896; dataChacote=\(vazio\); galpao=3/);
  assert.match(result.history[0].observacao, /2-142-B1::ITEM::953101G::nenhuma: saldo=1822; dataChacote=06\/08\/2026; galpao=3/);
  assert.equal(result.finalSlots[0].saldo, 0);
  assert.deepEqual(result.deleteSlotIds, [auxiliary]);
});

test('bloqueia slot que viola a constraint real de galpão 12', () => {
  expectCode('GALPAO_RESTRICTION_MISMATCH', () => buildZeroPhysicalAddressPlan(input({
    slots: [slot(baseId, '71401G', 1584, 'nenhuma', { galpao: '12' })],
  })));
});

test('bloqueia saldo sem SKU, saldo negativo e soma acima do limite', () => {
  expectCode('BALANCE_WITHOUT_SKU', () => buildZeroPhysicalAddressPlan(input({
    slots: [slot(baseId, '', 1)],
  })));
  expectCode('INVALID_STORED_BALANCE', () => buildZeroPhysicalAddressPlan(input({
    slots: [slot(baseId, '71401G', -1)],
  })));
  expectCode('AGGREGATED_BALANCE_OVERFLOW', () => buildZeroPhysicalAddressPlan(input({
    slots: [slot(baseId, '71401G', 2_147_483_640), slot(aux('71401G'), '71401G', 10)],
  })));
});

test('bloqueia divergência fora do endereço, fechada ou com ID repetido', () => {
  expectCode('DIVERGENCE_SCOPE_MISMATCH', () => buildZeroPhysicalAddressPlan(input({
    openDivergences: [{ ...divergence('DIV-OTHER'), modulo: '34' }],
  })));
  expectCode('DIVERGENCE_SCOPE_MISMATCH', () => buildZeroPhysicalAddressPlan(input({
    openDivergences: [{ ...divergence('DIV-CLOSED'), status: 'Corrigida' }],
  })));
  const repeated = divergence('DIV-REPEAT');
  expectCode('DUPLICATE_DIVERGENCE_ID', () => buildZeroPhysicalAddressPlan(input({ openDivergences: [repeated, repeated] })));
});

test('bloqueia endereço E1, módulo legado não canônico e UUID inválido', () => {
  expectCode('INVALID_ADDRESS', () => buildZeroPhysicalAddressPlan(input({ address: { estoque: '1', modulo: '33', posicao: '' } })));
  expectCode('NON_CANONICAL_MODULE', () => buildZeroPhysicalAddressPlan(input({ address: { estoque: '2', modulo: '033', posicao: 'A1' } })));
  expectCode('INVALID_CORRECTION_ID', () => buildZeroPhysicalAddressPlan(input({ correctionId: 'not-a-uuid' })));
});

test('preserva galpão físico 3 ao zerar uma posição E3 e limpa a restrição do endereço vazio', () => {
  const e3Base = '3-9-B2';
  const e3Input = input({
    address: { estoque: '3', modulo: '9', posicao: 'B2' },
    slots: [slot(e3Base, '132', 450, 'autorizacao', {
      estoque: '3', modulo: '9', posicao: 'B2',
      dataChacote: '20/09/2026', galpao: '3',
    })],
    openDivergences: [{
      ...divergence('DIV-9ACKEWK', '132', e3Base, 'autorizacao'),
      estoque: '3', modulo: '9', posicao: 'B2', status: 'Aberta',
    }],
  });
  const plan = buildZeroPhysicalAddressPlan(e3Input);
  assert.equal(plan.finalSlots[0].galpao, '3');
  assert.equal(plan.finalSlots[0].restricao, 'nenhuma');
  assert.equal(plan.history[0].galpao, '3');
  assert.equal(plan.history[0].restricao, 'autorizacao');
  assert.equal(plan.history[0].quantidade, 450);
});

test('mantém o galpão correto ao zerar uma posição E3', () => {
  const e3Base = '3-33-B1';
  const e3Aux = `${e3Base}::ITEM::71401G::autorizacao`;
  const e3Input = input({
    address: { estoque: '3', modulo: '33', posicao: 'B1' },
    slots: [
      slot(e3Base, '71401G', 40, 'autorizacao', {
        estoque: '3', posicao: 'B1', galpao: '12',
      }),
      slot(e3Aux, '71401G', 5, 'autorizacao', {
        estoque: '3', posicao: 'B1', galpao: '12',
      }),
    ],
    openDivergences: [
      { ...divergence('DIV-E3', '71401G', e3Base, 'autorizacao'), estoque: '3', posicao: 'B1' },
    ],
  });
  const plan = buildZeroPhysicalAddressPlan(e3Input);
  assert.equal(plan.finalSlots[0].galpao, '12');
  assert.equal(plan.finalSlots[0].restricao, 'autorizacao');
  assert.equal(plan.history[0].galpao, '12');
  assert.equal(plan.history[0].restricao, 'autorizacao');
  assert.equal(plan.history[0].quantidade, 45);
  assert.deepEqual(plan.deleteSlotIds, [e3Aux]);
});
