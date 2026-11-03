BEGIN;

-- BLOCO 8: fotografias diarias automaticas de ocupacao e saldo por SKU.
-- Executa no banco, sem Edge Function, pg_net, polling ou novo canal Realtime.

DO $preflight$
BEGIN
  IF to_regclass('public.slots') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('public.warehouse_layout') IS NULL
     OR to_regclass('public.warehouse_layout_positions') IS NULL
     OR to_regclass('public.occupancy_history') IS NULL THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_REQUIRED_TABLE_MISSING';
  END IF;

  IF to_regprocedure('public.has_app_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_PERMISSION_HELPER_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
  ) THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_PG_CRON_NOT_AVAILABLE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.products WHERE btrim(referencia) = ''
  ) THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_BLANK_PRODUCT_REFERENCE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products
    GROUP BY upper(btrim(referencia))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_DUPLICATE_PRODUCT_REFERENCE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.products
    WHERE upper(btrim(referencia)) = '__SEM_REFERENCIA__'
  ) OR EXISTS (
    SELECT 1 FROM public.slots
    WHERE upper(btrim(coalesce(referencia, ''))) = '__SEM_REFERENCIA__'
  ) THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_RESERVED_REFERENCE_COLLISION';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.warehouse_layout
    WHERE estoque = '1' AND ativo IS TRUE AND capacidade > 0
  ) THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_E1_LAYOUT_NOT_CONFIGURED';
  END IF;
END;
$preflight$;

-- Supabase Cron: extensao nativa do PostgreSQL, sem invocacoes de Edge Function.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE SCHEMA IF NOT EXISTS stock_internal AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA stock_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA stock_internal TO postgres;

CREATE TABLE IF NOT EXISTS public.stock_balance_snapshots (
  snapshot_date date NOT NULL,
  reference text NOT NULL CHECK (btrim(reference) <> ''),
  description text NOT NULL DEFAULT '',
  pieces_e1 bigint NOT NULL DEFAULT 0 CHECK (pieces_e1 >= 0),
  pieces_e2 bigint NOT NULL DEFAULT 0 CHECK (pieces_e2 >= 0),
  pieces_e3 bigint NOT NULL DEFAULT 0 CHECK (pieces_e3 >= 0),
  total_pieces bigint NOT NULL DEFAULT 0 CHECK (total_pieces >= 0),
  occupied_addresses integer NOT NULL DEFAULT 0 CHECK (occupied_addresses >= 0),
  is_unidentified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_balance_snapshots_pkey PRIMARY KEY (snapshot_date, reference)
);


ALTER TABLE public.stock_balance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_balance_snapshots_read_history
  ON public.stock_balance_snapshots;
CREATE POLICY stock_balance_snapshots_read_history
  ON public.stock_balance_snapshots
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_app_permission('history.view'::text))
    AND (SELECT public.has_app_permission('stock.search'::text))
  );

REVOKE ALL ON TABLE public.stock_balance_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.stock_balance_snapshots TO authenticated;

-- A ocupacao passa a ser gravada exclusivamente pela rotina do banco.
-- A leitura acompanha o acesso ao Dashboard; a interface nao grava mais snapshots.
DROP POLICY IF EXISTS occupancy_history_select_authenticated
  ON public.occupancy_history;
DROP POLICY IF EXISTS occupancy_history_insert_operations
  ON public.occupancy_history;
DROP POLICY IF EXISTS occupancy_history_update_operations
  ON public.occupancy_history;

CREATE POLICY occupancy_history_select_dashboard
  ON public.occupancy_history
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_app_permission('dashboard.view'::text)));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.occupancy_history
  FROM anon, authenticated;
GRANT SELECT ON TABLE public.occupancy_history TO authenticated;

CREATE TABLE IF NOT EXISTS stock_internal.daily_stock_snapshot_runs (
  snapshot_date date PRIMARY KEY,
  completed_at timestamptz NOT NULL,
  sku_rows integer NOT NULL,
  total_pieces bigint NOT NULL,
  occupied_positions bigint NOT NULL,
  free_positions bigint NOT NULL,
  total_positions bigint NOT NULL,
  occupied_e1_pallets bigint NOT NULL,
  occupied_e2_e3_positions bigint NOT NULL,
  unidentified_pieces bigint NOT NULL DEFAULT 0
);

REVOKE ALL ON TABLE stock_internal.daily_stock_snapshot_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE stock_internal.daily_stock_snapshot_runs TO postgres;

CREATE OR REPLACE FUNCTION stock_internal.capture_daily_stock_snapshots()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_snapshot_date date;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_e1_capacity bigint := 0;
  v_e2_e3_capacity bigint := 0;
  v_e1_occupied_pallets bigint := 0;
  v_e2_e3_occupied_positions bigint := 0;
  v_occupied_positions bigint := 0;
  v_free_positions bigint := 0;
  v_total_positions bigint := 0;
  v_total_pieces bigint := 0;
  v_snapshot_pieces bigint := 0;
  v_unidentified_pieces bigint := 0;
  v_occupancy_percent numeric := 0;
  v_sku_rows integer := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stock_internal.capture_daily_stock_snapshots', 0)
  );

  v_started_at := pg_catalog.clock_timestamp();
  v_snapshot_date := (v_started_at AT TIME ZONE 'America/Sao_Paulo')::date;

  -- Mantem uma fotografia consistente entre as consultas de saldo, catalogo e layout.
  -- Leituras continuam liberadas; gravacoes nessas tabelas aguardam apenas durante
  -- a captura (base atual: cerca de 3 mil enderecos e 202 produtos).
  EXECUTE 'LOCK TABLE public.products, public.warehouse_layout, public.warehouse_layout_positions, public.slots IN SHARE MODE';

  -- Indicadores iguais ao Dashboard atual: E1 usa paletizacao por endereco;
  -- E2/E3 contam somente posicoes fisicas ativas com saldo positivo.
  SELECT COALESCE(sum(l.capacidade), 0)::bigint
    INTO v_e1_capacity
    FROM public.warehouse_layout l
   WHERE l.estoque = '1'
     AND l.ativo IS TRUE;

  SELECT count(*)::bigint
    INTO v_e2_e3_capacity
    FROM public.warehouse_layout_positions p
   WHERE p.estoque IN ('2', '3')
     AND p.ativo IS TRUE;

  SELECT COALESCE(sum(
    CASE
      WHEN s.saldo::numeric / p.paletizacao::numeric < 0.5 THEN 0
      ELSE pg_catalog.ceil(s.saldo::numeric / p.paletizacao::numeric)
    END
  ), 0)::bigint
    INTO v_e1_occupied_pallets
    FROM public.slots s
    JOIN public.products p
      ON upper(btrim(p.referencia)) = upper(btrim(s.referencia))
    JOIN public.warehouse_layout l
      ON l.estoque = '1'
     AND l.ativo IS TRUE
     AND l.modulo ~ '^\d+$'
     AND l.modulo::numeric = CASE
       WHEN s.modulo ~ '^\d+(\.0+)?$' THEN s.modulo::numeric
       ELSE NULL
     END
   WHERE s.estoque = '1'
     AND COALESCE(s.saldo, 0) > 0
     AND COALESCE(p.paletizacao, 0) > 0;

  SELECT count(DISTINCT p.id)::bigint
    INTO v_e2_e3_occupied_positions
    FROM public.warehouse_layout_positions p
   WHERE p.estoque IN ('2', '3')
     AND p.ativo IS TRUE
     AND EXISTS (
       SELECT 1
         FROM public.slots s
        WHERE s.estoque = p.estoque
          AND s.modulo ~ '^\d+(\.0+)?$'
          AND p.modulo ~ '^\d+$'
          AND s.modulo::numeric = p.modulo::numeric
          AND upper(btrim(s.posicao)) = upper(btrim(p.posicao))
          AND COALESCE(s.saldo, 0) > 0
     );

  SELECT COALESCE(sum(GREATEST(COALESCE(s.saldo, 0), 0)), 0)::bigint
    INTO v_total_pieces
    FROM public.slots s;

  SELECT COALESCE(sum(GREATEST(COALESCE(s.saldo, 0), 0)), 0)::bigint
    INTO v_unidentified_pieces
    FROM public.slots s
   WHERE COALESCE(btrim(s.referencia), '') = '';

  v_total_positions := v_e1_capacity + v_e2_e3_capacity;
  v_occupied_positions := v_e1_occupied_pallets + v_e2_e3_occupied_positions;
  v_free_positions := v_total_positions - v_occupied_positions;
  v_occupancy_percent := CASE
    WHEN v_total_positions > 0
      THEN pg_catalog.round((v_occupied_positions::numeric * 100) / v_total_positions, 2)
    ELSE 0
  END;

  -- Reprocessar a mesma data e seguro: substitui a fotografia daquele dia.
  DELETE FROM public.stock_balance_snapshots
   WHERE snapshot_date = v_snapshot_date;

  WITH product_refs AS (
    SELECT upper(btrim(p.referencia)) AS reference,
           COALESCE(max(nullif(btrim(p.descricao), '')), '') AS description
      FROM public.products p
     WHERE COALESCE(btrim(p.referencia), '') <> ''
     GROUP BY upper(btrim(p.referencia))
  ),
  slot_balances AS (
    SELECT upper(btrim(s.referencia)) AS reference,
           COALESCE(max(nullif(btrim(s.descricao), '')), '') AS description,
           COALESCE(sum(CASE WHEN COALESCE(s.saldo, 0) > 0 THEN s.saldo ELSE 0 END), 0)::bigint AS total_pieces,
           COALESCE(sum(CASE WHEN s.estoque = '1' AND COALESCE(s.saldo, 0) > 0 THEN s.saldo ELSE 0 END), 0)::bigint AS pieces_e1,
           COALESCE(sum(CASE WHEN s.estoque = '2' AND COALESCE(s.saldo, 0) > 0 THEN s.saldo ELSE 0 END), 0)::bigint AS pieces_e2,
           COALESCE(sum(CASE WHEN s.estoque = '3' AND COALESCE(s.saldo, 0) > 0 THEN s.saldo ELSE 0 END), 0)::bigint AS pieces_e3,
           count(DISTINCT (s.estoque, upper(btrim(coalesce(s.modulo, ''))), upper(btrim(coalesce(s.posicao, ''))))) FILTER (WHERE COALESCE(s.saldo, 0) > 0)::integer AS occupied_addresses
      FROM public.slots s
     WHERE COALESCE(btrim(s.referencia), '') <> ''
     GROUP BY upper(btrim(s.referencia))
  ),
  combined AS (
    SELECT COALESCE(p.reference, b.reference) AS reference,
           COALESCE(nullif(p.description, ''), nullif(b.description, ''), '') AS description,
           COALESCE(b.pieces_e1, 0)::bigint AS pieces_e1,
           COALESCE(b.pieces_e2, 0)::bigint AS pieces_e2,
           COALESCE(b.pieces_e3, 0)::bigint AS pieces_e3,
           COALESCE(b.total_pieces, 0)::bigint AS total_pieces,
           COALESCE(b.occupied_addresses, 0)::integer AS occupied_addresses,
           false AS is_unidentified
      FROM product_refs p
      FULL OUTER JOIN slot_balances b USING (reference)
  ),
  unidentified AS (
    SELECT '__SEM_REFERENCIA__'::text AS reference,
           'Saldo em posicoes sem referencia'::text AS description,
           COALESCE(sum(CASE WHEN s.estoque = '1' AND COALESCE(s.saldo, 0) > 0 THEN s.saldo ELSE 0 END), 0)::bigint AS pieces_e1,
           COALESCE(sum(CASE WHEN s.estoque = '2' AND COALESCE(s.saldo, 0) > 0 THEN s.saldo ELSE 0 END), 0)::bigint AS pieces_e2,
           COALESCE(sum(CASE WHEN s.estoque = '3' AND COALESCE(s.saldo, 0) > 0 THEN s.saldo ELSE 0 END), 0)::bigint AS pieces_e3,
           COALESCE(sum(GREATEST(COALESCE(s.saldo, 0), 0)), 0)::bigint AS total_pieces,
           count(DISTINCT (s.estoque, upper(btrim(coalesce(s.modulo, ''))), upper(btrim(coalesce(s.posicao, ''))))) FILTER (WHERE COALESCE(s.saldo, 0) > 0)::integer AS occupied_addresses,
           true AS is_unidentified
      FROM public.slots s
     WHERE COALESCE(btrim(s.referencia), '') = ''
    HAVING COALESCE(sum(GREATEST(COALESCE(s.saldo, 0), 0)), 0) > 0
  ),
  all_rows AS (
    SELECT * FROM combined
    UNION ALL
    SELECT * FROM unidentified
  )
  INSERT INTO public.stock_balance_snapshots (
    snapshot_date, reference, description,
    pieces_e1, pieces_e2, pieces_e3, total_pieces,
    occupied_addresses, is_unidentified, created_at
  )
  SELECT v_snapshot_date, a.reference, a.description,
         a.pieces_e1, a.pieces_e2, a.pieces_e3, a.total_pieces,
         a.occupied_addresses, a.is_unidentified, v_started_at
    FROM all_rows a;

  GET DIAGNOSTICS v_sku_rows = ROW_COUNT;

  SELECT COALESCE(sum(s.total_pieces), 0)::bigint
    INTO v_snapshot_pieces
    FROM public.stock_balance_snapshots s
   WHERE s.snapshot_date = v_snapshot_date;

  IF v_snapshot_pieces <> v_total_pieces THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_RECONCILIATION_FAILED: slots=%, snapshots=%',
      v_total_pieces, v_snapshot_pieces;
  END IF;

  v_completed_at := pg_catalog.clock_timestamp();

  INSERT INTO public.occupancy_history (
    snapshot_date, occupied_positions, free_positions, total_positions,
    occupancy_percent, total_pieces, total_pallets, created_at
  ) VALUES (
    v_snapshot_date, v_occupied_positions::integer, v_free_positions::integer,
    v_total_positions::integer, v_occupancy_percent, v_total_pieces,
    v_e1_occupied_pallets::integer, v_completed_at
  )
  ON CONFLICT (snapshot_date) DO UPDATE SET
    occupied_positions = EXCLUDED.occupied_positions,
    free_positions = EXCLUDED.free_positions,
    total_positions = EXCLUDED.total_positions,
    occupancy_percent = EXCLUDED.occupancy_percent,
    total_pieces = EXCLUDED.total_pieces,
    total_pallets = EXCLUDED.total_pallets,
    created_at = EXCLUDED.created_at;

  INSERT INTO stock_internal.daily_stock_snapshot_runs (
    snapshot_date, completed_at, sku_rows, total_pieces,
    occupied_positions, free_positions, total_positions,
    occupied_e1_pallets, occupied_e2_e3_positions, unidentified_pieces
  ) VALUES (
    v_snapshot_date, v_completed_at, v_sku_rows, v_total_pieces,
    v_occupied_positions, v_free_positions, v_total_positions,
    v_e1_occupied_pallets, v_e2_e3_occupied_positions, v_unidentified_pieces
  )
  ON CONFLICT (snapshot_date) DO UPDATE SET
    completed_at = EXCLUDED.completed_at,
    sku_rows = EXCLUDED.sku_rows,
    total_pieces = EXCLUDED.total_pieces,
    occupied_positions = EXCLUDED.occupied_positions,
    free_positions = EXCLUDED.free_positions,
    total_positions = EXCLUDED.total_positions,
    occupied_e1_pallets = EXCLUDED.occupied_e1_pallets,
    occupied_e2_e3_positions = EXCLUDED.occupied_e2_e3_positions,
    unidentified_pieces = EXCLUDED.unidentified_pieces;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'snapshot_date', v_snapshot_date,
    'sku_rows', v_sku_rows,
    'total_pieces', v_total_pieces,
    'snapshot_pieces', v_snapshot_pieces,
    'occupied_positions', v_occupied_positions,
    'free_positions', v_free_positions,
    'total_positions', v_total_positions,
    'occupied_e1_pallets', v_e1_occupied_pallets,
    'occupied_e2_e3_positions', v_e2_e3_occupied_positions,
    'completed_at', v_completed_at
  );
END;
$function$;

ALTER FUNCTION stock_internal.capture_daily_stock_snapshots() OWNER TO postgres;
REVOKE ALL ON FUNCTION stock_internal.capture_daily_stock_snapshots() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stock_internal.capture_daily_stock_snapshots() TO postgres;

-- O servidor Supabase Cron usa GMT/UTC no projeto atual. 02:55 UTC = 23:55 em Sao Paulo.
-- Mantem apenas um job para as duas fotografias diarias.
DO $schedule$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'enderecamento-daily-stock-snapshots'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'enderecamento-daily-stock-snapshots',
    '55 2 * * *',
    'SELECT stock_internal.capture_daily_stock_snapshots();'
  );
END;
$schedule$;

-- Cria a linha-base de hoje imediatamente; o job das 23:55 atualiza a mesma data no fechamento.
SELECT stock_internal.capture_daily_stock_snapshots();

DO $postflight$
DECLARE
  v_job_count integer;
  v_today date := (pg_catalog.clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_sku_count integer;
  v_run_count integer;
BEGIN
  SELECT count(*) INTO v_job_count
    FROM cron.job
   WHERE jobname = 'enderecamento-daily-stock-snapshots'
     AND schedule = '55 2 * * *';

  SELECT count(*) INTO v_sku_count
    FROM public.stock_balance_snapshots
   WHERE snapshot_date = v_today;

  SELECT count(*) INTO v_run_count
    FROM stock_internal.daily_stock_snapshot_runs
   WHERE snapshot_date = v_today;

  IF v_job_count <> 1 OR v_sku_count = 0 OR v_run_count <> 1 THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_POSTFLIGHT_FAILED: jobs=%, sku_rows=%, runs=%',
      v_job_count, v_sku_count, v_run_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.stock_balance_snapshots'::regclass
       AND relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_RLS_NOT_ENABLED';
  END IF;

  IF has_table_privilege('authenticated', 'public.stock_balance_snapshots', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'DAILY_STOCK_SNAPSHOT_AUTHENTICATED_HAS_DML';
  END IF;

  IF has_table_privilege('authenticated', 'public.occupancy_history', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'DAILY_OCCUPANCY_AUTHENTICATED_HAS_DML';
  END IF;
END;
$postflight$;

COMMIT;
