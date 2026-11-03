-- Rollback da migration 20261103180000.
-- Restaura as duas políticas SELECT ao escopo anterior.
-- Não altera dados, permissões cadastradas ou políticas de escrita.

BEGIN;

DO $preflight$
DECLARE
  v_layout_policy text;
  v_positions_policy text;
  v_key text;
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

  IF v_layout_policy IS NULL OR v_positions_policy IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK_ABORT: SELECT_POLICY_NOT_FOUND';
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'stock.launch.view',
    'stock.launch.create',
    'stock.transfer.create',
    'stock.batch.process'
  ] LOOP
    IF pg_catalog.strpos(v_layout_policy, v_key) = 0 OR
       pg_catalog.strpos(v_positions_policy, v_key) = 0 THEN
      RAISE EXCEPTION 'ROLLBACK_ABORT: EXPECTED_PERMISSION_NOT_FOUND: %', v_key;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER POLICY warehouse_layout_select_permission_catalog
  ON public.warehouse_layout
  USING (
    public.has_app_permission('warehouse.layout.view'::text)
    OR public.has_app_permission('warehouse.layout.manage'::text)
    OR public.has_app_permission('map.view'::text)
    OR public.has_app_permission('dashboard.view'::text)
    OR public.has_app_permission('stock.physical_correction'::text)
  );

ALTER POLICY warehouse_layout_positions_select_permission_catalog
  ON public.warehouse_layout_positions
  USING (
    public.has_app_permission('warehouse.layout.view'::text)
    OR public.has_app_permission('warehouse.layout.manage'::text)
    OR public.has_app_permission('map.view'::text)
    OR public.has_app_permission('dashboard.view'::text)
    OR public.has_app_permission('stock.physical_correction'::text)
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
    'warehouse.layout.view',
    'warehouse.layout.manage',
    'map.view',
    'dashboard.view',
    'stock.physical_correction'
  ] LOOP
    IF pg_catalog.strpos(v_layout_policy, v_key) = 0 OR
       pg_catalog.strpos(v_positions_policy, v_key) = 0 THEN
      RAISE EXCEPTION 'ROLLBACK_POSTFLIGHT_FAILED: BASE_PERMISSION_MISSING: %', v_key;
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY ARRAY[
    'stock.launch.view',
    'stock.launch.create',
    'stock.transfer.create',
    'stock.batch.process'
  ] LOOP
    IF pg_catalog.strpos(v_layout_policy, v_key) > 0 OR
       pg_catalog.strpos(v_positions_policy, v_key) > 0 THEN
      RAISE EXCEPTION 'ROLLBACK_POSTFLIGHT_FAILED: OPERATIONAL_PERMISSION_REMAINS: %', v_key;
    END IF;
  END LOOP;
END;
$postflight$;

COMMIT;