BEGIN;

DO $preflight$
DECLARE
  v_layout_policy text;
  v_positions_policy text;
BEGIN
  SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
    INTO v_layout_policy
    FROM pg_catalog.pg_policy pol
   WHERE pol.polrelid = 'public.warehouse_layout'::regclass
     AND pol.polname = 'warehouse_layout_select_permission_catalog'
     AND pol.polcmd = 'r';

  SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
    INTO v_positions_policy
    FROM pg_catalog.pg_policy pol
   WHERE pol.polrelid = 'public.warehouse_layout_positions'::regclass
     AND pol.polname = 'warehouse_layout_positions_select_permission_catalog'
     AND pol.polcmd = 'r';

  IF v_layout_policy IS NULL OR
     pg_catalog.strpos(v_layout_policy, 'warehouse.layout.view') = 0 OR
     pg_catalog.strpos(v_layout_policy, 'warehouse.layout.manage') = 0 OR
     pg_catalog.strpos(v_layout_policy, 'map.view') = 0 OR
     pg_catalog.strpos(v_layout_policy, 'dashboard.view') = 0 OR
     pg_catalog.strpos(v_layout_policy, 'stock.physical_correction') = 0 THEN
    RAISE EXCEPTION 'BLOCO_OPS_R2_PREFLIGHT_LAYOUT_POLICY_MISMATCH';
  END IF;

  IF v_positions_policy IS NULL OR
     pg_catalog.strpos(v_positions_policy, 'warehouse.layout.view') = 0 OR
     pg_catalog.strpos(v_positions_policy, 'warehouse.layout.manage') = 0 OR
     pg_catalog.strpos(v_positions_policy, 'map.view') = 0 OR
     pg_catalog.strpos(v_positions_policy, 'dashboard.view') = 0 OR
     pg_catalog.strpos(v_positions_policy, 'stock.physical_correction') = 0 THEN
    RAISE EXCEPTION 'BLOCO_OPS_R2_PREFLIGHT_POSITIONS_POLICY_MISMATCH';
  END IF;
END;
$preflight$;

-- Leitura da estrutura física para validar endereços usados em lançamentos e transferências.
-- Não concede edição da configuração nem permissões de escrita.
ALTER POLICY warehouse_layout_select_permission_catalog
  ON public.warehouse_layout
  USING (
    public.has_app_permission('warehouse.layout.view'::text)
    OR public.has_app_permission('warehouse.layout.manage'::text)
    OR public.has_app_permission('map.view'::text)
    OR public.has_app_permission('dashboard.view'::text)
    OR public.has_app_permission('stock.physical_correction'::text)
    OR public.has_app_permission('stock.launch.view'::text)
    OR public.has_app_permission('stock.launch.create'::text)
    OR public.has_app_permission('stock.transfer.create'::text)
    OR public.has_app_permission('stock.batch.process'::text)
  );

ALTER POLICY warehouse_layout_positions_select_permission_catalog
  ON public.warehouse_layout_positions
  USING (
    public.has_app_permission('warehouse.layout.view'::text)
    OR public.has_app_permission('warehouse.layout.manage'::text)
    OR public.has_app_permission('map.view'::text)
    OR public.has_app_permission('dashboard.view'::text)
    OR public.has_app_permission('stock.physical_correction'::text)
    OR public.has_app_permission('stock.launch.view'::text)
    OR public.has_app_permission('stock.launch.create'::text)
    OR public.has_app_permission('stock.transfer.create'::text)
    OR public.has_app_permission('stock.batch.process'::text)
  );

DO $postflight$
DECLARE
  v_layout_policy text;
  v_positions_policy text;
  v_key text;
BEGIN
  SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
    INTO v_layout_policy
    FROM pg_catalog.pg_policy pol
   WHERE pol.polrelid = 'public.warehouse_layout'::regclass
     AND pol.polname = 'warehouse_layout_select_permission_catalog';

  SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
    INTO v_positions_policy
    FROM pg_catalog.pg_policy pol
   WHERE pol.polrelid = 'public.warehouse_layout_positions'::regclass
     AND pol.polname = 'warehouse_layout_positions_select_permission_catalog';

  FOREACH v_key IN ARRAY ARRAY[
    'stock.launch.view',
    'stock.launch.create',
    'stock.transfer.create',
    'stock.batch.process'
  ] LOOP
    IF pg_catalog.strpos(v_layout_policy, v_key) = 0 OR
       pg_catalog.strpos(v_positions_policy, v_key) = 0 THEN
      RAISE EXCEPTION 'BLOCO_OPS_R2_POSTFLIGHT_POLICY_KEY_MISSING: %', v_key;
    END IF;
  END LOOP;
END;
$postflight$;

COMMIT;