import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = path => readFileSync(join(root, path), 'utf8');

const migration = read('supabase/migrations/20261102181100_daily_stock_snapshots.sql');
const panel = read('src/components/StockBalanceHistoryPanel.tsx');
const dashboard = read('src/components/DashboardCards.tsx');
const app = read('src/App.tsx');
const mobile = read('src/components/mobile/MobileShell.tsx');

test('daily snapshots use native pg_cron and the Sao Paulo close time', () => {
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog/i);
  assert.match(migration, /'55 2 \* \* \*'/);
  assert.match(migration, /AT TIME ZONE 'America\/Sao_Paulo'/);
  assert.match(migration, /enderecamento-daily-stock-snapshots/);
  assert.doesNotMatch(migration, /net\.http_post|functions\/v1|service_role/i);
});

test('the migration creates protected daily SKU snapshots and checks reconciliation', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.stock_balance_snapshots/i);
  assert.match(migration, /PRIMARY KEY \(snapshot_date, reference\)/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /has_app_permission\('history\.view'/i);
  assert.match(migration, /has_app_permission\('stock\.search'/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.stock_balance_snapshots FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT SELECT ON TABLE public\.stock_balance_snapshots TO authenticated/i);
  assert.match(migration, /LOCK TABLE public\.products, public\.warehouse_layout/);
  assert.match(migration, /DAILY_STOCK_SNAPSHOT_RECONCILIATION_FAILED/);
  assert.match(migration, /__SEM_REFERENCIA__/);
});

test('occupancy snapshots stop being written by the browser', () => {
  assert.doesNotMatch(dashboard, /occupancy-history\.write/);
  assert.doesNotMatch(dashboard, /saveOccupancySnapshot/);
  assert.doesNotMatch(dashboard, /occupancyWriteTimerRef/);
  assert.match(dashboard, /occupancy_history/);
  assert.match(migration, /DROP POLICY IF EXISTS occupancy_history_insert_operations/i);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]+occupancy_history/i);
});

test('history panel searches reference and description and exports PDF and Excel', () => {
  assert.match(panel, /normalizeSearchText\(row\.reference\)\.includes\(term\)/);
  assert.match(panel, /normalizeSearchText\(row\.description\)\.includes\(term\)/);
  assert.match(panel, /new jsPDF/);
  assert.match(panel, /autoTable\(/);
  assert.match(panel, /XLSX\.utils\.book_new/);
  assert.match(panel, /XLSX\.writeFile/);
  assert.match(panel, /from \"jspdf\"/);
  assert.match(panel, /from \"jspdf-autotable\"/);
  assert.match(panel, /from \"xlsx\"/);
});

test('the panel is available on desktop and mobile, with the existing history export permission', () => {
  assert.match(app, /import \{ StockBalanceHistoryPanel \}/);
  assert.match(app, /<StockBalanceHistoryPanel/);
  assert.match(app, /canExportReports=\{canExportHistory\}/);
  assert.match(mobile, /import \{ StockBalanceHistoryPanel \}/);
  assert.match(mobile, /<StockBalanceHistoryPanel/);
  assert.match(mobile, /requestReportExportPermission=\{requestHistoryExportPermission\}/);
});
