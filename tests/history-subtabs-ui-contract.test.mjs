import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../src/components/mobile/MobileShell.tsx", import.meta.url), "utf8");

test("desktop exposes separate movement and daily SKU tabs, defaulting to movements", () => {
  assert.match(app, /useState<"movements" \| "daily">\("movements"\)/);
  assert.match(app, /aria-label="Tipo de histórico"/);
  assert.match(app, /Movimentações/);
  assert.match(app, /Saldo diário por SKU/);
  assert.match(app, /hidden=\{historyContentTab !== "movements"\}/);
  assert.match(app, /historyContentTab === "daily" && \(/);
});

test("mobile exposes separate movement and daily SKU tabs, defaulting to movements", () => {
  assert.match(mobile, /useState<"movements" \| "daily">\("movements"\)/);
  assert.match(mobile, /aria-label="Tipo de histórico"/);
  assert.match(mobile, /Movimentações/);
  assert.match(mobile, /Saldo diário por SKU/);
  assert.match(mobile, /hidden=\{historyContentTab !== "movements"\}/);
  assert.match(mobile, /historyContentTab === "daily" && \(/);
});

test("legacy movement history and new daily SKU panel both remain wired", () => {
  assert.match(app, /Log Temporal de Movimentações/);
  assert.match(app, /handleExportarHistorico/);
  assert.match(mobile, /historySearch/);
  assert.match(mobile, /filteredHistory\.map/);
  assert.match(app, /StockBalanceHistoryPanel/);
  assert.match(mobile, /StockBalanceHistoryPanel/);
});
