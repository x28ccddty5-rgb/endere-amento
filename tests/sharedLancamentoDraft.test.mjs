import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSharedDraftSyncPlan,
  isBlankLancamentoDraftRow,
  normalizeLancamentoDraftRow,
  parseSharedLancamentoDraftSnapshot,
} from "../src/lib/sharedLancamentoDraft.ts";
import { canRecordDivergenceOnlyScope } from "../src/data/mockStorage.ts";

const row = (id, overrides = {}) => ({
  id,
  data: "2026-10-24",
  estoque: "1",
  modulo: "12",
  posicao: "",
  referencia: "ABC123",
  quantidade: 10,
  tipo: "Entrada",
  dataChacote: "2026-10",
  hora: "08:30",
  responsavel: "Operador A",
  galpao: "3",
  restricao: "nenhuma",
  observacao: "",
  ...overrides,
});

const line = (value, lineRevision = 1, sequence = 1) => ({
  line_id: value.id,
  row_data: value,
  line_revision: lineRevision,
  sequence,
});

test("duas estações podem adicionar linhas sem sobrescrever as linhas desconhecidas", () => {
  const localRows = [row("A")];
  const baseline = [line(row("A"))];
  const plan = buildSharedDraftSyncPlan(localRows, baseline);
  assert.deepEqual(plan.upserts, []);
  assert.deepEqual(plan.deletes, []);
  // A linha B que outra estação adicionou nunca esteve no baseline local,
  // portanto o plano local não pode apagá-la.
});

test("remover a última linha visível apaga somente essa linha conhecida", () => {
  const plan = buildSharedDraftSyncPlan([], [line(row("A"))]);
  assert.deepEqual(plan.upserts, []);
  assert.deepEqual(plan.deletes, [
    { line_id: "A", expected_line_revision: 1 },
  ]);
  // An unseen remote line (e.g. B, inserted by another computer) is not in
  // this computer's baseline and therefore cannot be deleted by its plan.
});

test("uma mudança concorrente na mesma linha envia a revisão antiga para conflito CAS", () => {
  const original = row("A");
  const edited = row("A", { quantidade: 12 });
  const plan = buildSharedDraftSyncPlan([edited], [line(original, 4)]);
  assert.equal(plan.upserts.length, 1);
  assert.equal(plan.upserts[0].expected_line_revision, 4);
  assert.equal(plan.upserts[0].row_data.quantidade, 12);
});

test("linha totalmente vazia pode ser ignorada, mas estoque alterado deixa de ser placeholder", () => {
  const blank = row("A", {
    data: "", modulo: "", posicao: "", referencia: "", quantidade: "",
    tipo: "", dataChacote: "", hora: "", responsavel: "", observacao: "",
  });
  assert.equal(isBlankLancamentoDraftRow(blank), true);
  assert.equal(isBlankLancamentoDraftRow({ ...blank, estoque: "2" }), false);
  assert.equal(isBlankLancamentoDraftRow({ ...blank, quantidade: "não numérico" }), false);
});

test("normalização preserva quantidade inválida para não apagar silenciosamente o dado digitado", () => {
  const normalized = normalizeLancamentoDraftRow(row("A", { quantidade: "inválida" }));
  assert.equal(normalized.quantidade, "inválida");
  assert.equal(isBlankLancamentoDraftRow(normalized), false);
});

test("parser rejeita snapshots malformados e preserva ordenação de linhas", () => {
  const parsed = parseSharedLancamentoDraftSnapshot({
    success: true,
    generation_id: "generation-1",
    revision: 2,
    lines: [line(row("B"), 1, 2), line(row("A"), 1, 1)],
  });
  assert.deepEqual(parsed.lines.map(item => item.line_id), ["A", "B"]);
  assert.throws(() => parseSharedLancamentoDraftSnapshot({ success: true, generation_id: "", revision: 0, lines: [] }));
  assert.throws(() => parseSharedLancamentoDraftSnapshot({
    success: true, generation_id: "generation-1", revision: 0,
    lines: [line(row("A")), line(row("A"), 1, 2)],
  }));
});

const divergence = (tipoDivergencia, status = "Aberta") => ({
  id: `${tipoDivergencia}-${Math.random()}`,
  dataDivergencia: "2026-10-24",
  tipoDivergencia,
  estoque: "2",
  modulo: "144",
  posicao: "A2",
  refAtual: "ABC123",
  refNova: "XYZ987",
  saldoAntes: 10,
  movimentacao: -1,
  saldoFinal: 10,
  responsavel: "Operador A",
  status,
});

test("escopo inconsistente aceita a divergência raiz e as posições bloqueadas subsequentes", () => {
  assert.equal(canRecordDivergenceOnlyScope([
    divergence("ID de Endereço Inconsistente"),
    divergence("Posição Bloqueada por Divergência"),
  ]), true);
});

test("escopo de módulo inativo aceita somente divergências de módulo inativo", () => {
  assert.equal(canRecordDivergenceOnlyScope([
    divergence("Módulo Inativo"),
    divergence("Módulo Inativo"),
  ]), true);
  assert.equal(canRecordDivergenceOnlyScope([
    divergence("Módulo Inativo"),
    divergence("Posição Bloqueada por Divergência"),
  ]), false);
});

test("escopo especial rejeita status fechado e divergências de outra causa", () => {
  assert.equal(canRecordDivergenceOnlyScope([
    divergence("ID de Endereço Inconsistente"),
    divergence("Saldo Insuficiente"),
  ]), false);
  assert.equal(canRecordDivergenceOnlyScope([
    divergence("ID de Endereço Inconsistente", "Corrigida"),
  ]), false);
});
