-- BLOCO 8 - verificacao somente leitura
-- Executar no SQL Editor do Supabase como postgres, depois da migration 20261102181100.

-- 1) Extensao, timezone da sessao e timezone do Cron.
SELECT e.extname, e.extversion, n.nspname AS extension_schema
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'pg_cron';

SELECT name, setting
FROM pg_settings
WHERE name IN ('TimeZone', 'cron.timezone');

-- 2) Agendamento: deve existir exatamente um job ativo, 02:55 UTC = 23:55 America/Sao_Paulo.
SELECT jobid, jobname, schedule, command, active, username
FROM cron.job
WHERE jobname = 'enderecamento-daily-stock-snapshots';

-- 3) Ultima execucao e eventuais falhas.
SELECT jobid, runid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid IN (
  SELECT jobid FROM cron.job
  WHERE jobname = 'enderecamento-daily-stock-snapshots'
)
ORDER BY start_time DESC
LIMIT 20;

-- 4) Historico dos snapshots gerais.
SELECT snapshot_date, occupied_positions, free_positions, total_positions,
       occupancy_percent, total_pieces, total_pallets, created_at
FROM public.occupancy_history
ORDER BY snapshot_date DESC
LIMIT 45;

-- 5) Execucoes consolidadas por dia, incluindo saldo sem referencia.
SELECT snapshot_date, completed_at, sku_rows, total_pieces,
       occupied_positions, free_positions, total_positions,
       occupied_e1_pallets, occupied_e2_e3_positions, unidentified_pieces
FROM stock_internal.daily_stock_snapshot_runs
ORDER BY snapshot_date DESC
LIMIT 45;

-- 6) Reconciliacao do snapshot mais recente contra slots.
WITH latest AS (
  SELECT max(snapshot_date) AS snapshot_date
  FROM public.stock_balance_snapshots
), source AS (
  SELECT COALESCE(sum(GREATEST(COALESCE(s.saldo, 0), 0)), 0)::bigint AS total_pieces
  FROM public.slots s
), captured AS (
  SELECT COALESCE(sum(b.total_pieces), 0)::bigint AS total_pieces,
         count(*)::integer AS rows
  FROM public.stock_balance_snapshots b
  JOIN latest l ON l.snapshot_date = b.snapshot_date
)
SELECT latest.snapshot_date,
       source.total_pieces AS slots_total_pieces,
       captured.total_pieces AS snapshot_total_pieces,
       captured.total_pieces - source.total_pieces AS difference,
       captured.rows AS sku_rows,
       (captured.total_pieces = source.total_pieces) AS reconciled
FROM latest CROSS JOIN source CROSS JOIN captured;

-- 7) Lacunas desde a primeira fotografia do Bloco 8.
WITH bounds AS (
  SELECT min(snapshot_date) AS first_date, max(snapshot_date) AS last_date
  FROM public.stock_balance_snapshots
), calendar AS (
  SELECT d::date AS snapshot_date
  FROM bounds b
  CROSS JOIN LATERAL generate_series(b.first_date, b.last_date, interval '1 day') d
)
SELECT c.snapshot_date AS missing_date
FROM calendar c
LEFT JOIN stock_internal.daily_stock_snapshot_runs r USING (snapshot_date)
WHERE r.snapshot_date IS NULL
ORDER BY c.snapshot_date;

-- 8) Seguranca: RLS ligado, policy de leitura e ausencia de DML direto.
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
WHERE c.oid IN (
  'public.stock_balance_snapshots'::regclass,
  'public.occupancy_history'::regclass
);

SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('stock_balance_snapshots', 'occupancy_history')
ORDER BY tablename, policyname;

SELECT
  has_table_privilege('authenticated', 'public.stock_balance_snapshots', 'SELECT') AS snapshots_select,
  has_table_privilege('authenticated', 'public.stock_balance_snapshots', 'INSERT,UPDATE,DELETE') AS snapshots_dml,
  has_table_privilege('authenticated', 'public.occupancy_history', 'SELECT') AS occupancy_select,
  has_table_privilege('authenticated', 'public.occupancy_history', 'INSERT,UPDATE,DELETE') AS occupancy_dml;

-- 9) Tamanho atual das tabelas e do banco.
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size,
       pg_size_pretty(pg_total_relation_size('public.stock_balance_snapshots')) AS sku_snapshots_size,
       pg_size_pretty(pg_total_relation_size('public.occupancy_history')) AS occupancy_history_size;
