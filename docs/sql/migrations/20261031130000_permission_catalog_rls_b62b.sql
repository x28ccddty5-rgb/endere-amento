-- Auditoria 03 / B6.2B: alinhar RLS e ACL ao catálogo configurável.
-- Aplicar primeiro somente no clone local de integração.
-- Não altera dados operacionais.
-- Escritas de estoque/estrutura passam pelas RPCs atômicas.
-- Escritores diretos de products são preservados sob RLS granular.

BEGIN;

DO $preflight$
DECLARE
  v_missing_keys text;
  v_missing_tables text;
  v_select_policy_count integer;
  v_product_write_policy_count integer;
  v_function_oid oid;
BEGIN
  IF pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NULL
     OR pg_catalog.to_regprocedure('public.update_slot_metadata_atomic(jsonb,jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('public.save_warehouse_layout_atomic(jsonb,jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('public.save_warehouse_positions_atomic(jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_REQUIRED_FUNCTION_MISSING';
  END IF;

  SELECT pg_catalog.string_agg(x.permission_key, ', ' ORDER BY x.permission_key)
    INTO v_missing_keys
  FROM unnest(ARRAY[
    'dashboard.view','stock.search','stock.details.view','stock.launch.view',
    'stock.launch.create','stock.transfer.create','stock.batch.process',
    'stock.physical_correction','history.view','divergences.view',
    'divergences.resolve','products.view','products.create','products.edit',
    'products.import_bulk','products.delete_deactivate','map.view',
    'map.metadata.edit','warehouse.layout.view','warehouse.layout.manage',
    'consultor.use'
  ]::text[]) AS x(permission_key)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.permission_catalog pc
    WHERE pc.permission_key = x.permission_key AND pc.is_active IS TRUE
  );

  IF v_missing_keys IS NOT NULL THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_PERMISSION_KEYS_MISSING: %', v_missing_keys;
  END IF;

  SELECT pg_catalog.string_agg(x.table_name, ', ' ORDER BY x.table_name)
    INTO v_missing_tables
  FROM unnest(ARRAY[
    'slots','history','divergencias','products',
    'warehouse_layout','warehouse_layout_positions'
  ]::text[]) AS x(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = x.table_name
      AND c.relkind IN ('r','p') AND c.relrowsecurity IS TRUE
  );

  IF v_missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_TABLES_OR_RLS_MISSING: %', v_missing_tables;
  END IF;

  SELECT count(*) INTO v_select_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions')
    AND cmd = 'SELECT';

  IF v_select_policy_count <> 6 THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_UNEXPECTED_SELECT_POLICY_INVENTORY: %', v_select_policy_count;
  END IF;

  SELECT count(*) INTO v_product_write_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'products'
    AND policyname IN ('products_insert_permission','products_update_permission','products_delete_permission');

  IF v_product_write_policy_count <> 3 THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_PRODUCT_PERMISSION_POLICIES_MISSING: %', v_product_write_policy_count;
  END IF;

  SELECT p.oid INTO v_function_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_slot_metadata_atomic'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
        'p_expected_slot jsonb, p_metadata jsonb';

  IF v_function_oid IS NULL
     OR (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_function_oid) IS DISTINCT FROM TRUE
     OR NOT (COALESCE(
       (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid=v_function_oid),
       ARRAY[]::text[]
     ) @> ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'B62B_PREFLIGHT_METADATA_RPC_SECURITY_CONFIG_INVALID';
  END IF;
END;
$preflight$;

-- Bloqueia clientes anônimos; mantém SELECT autenticado.
REVOKE ALL ON TABLE
  public.slots, public.history, public.divergencias, public.products,
  public.warehouse_layout, public.warehouse_layout_positions
FROM PUBLIC, anon;

-- Estoque e estrutura física não aceitam mais DML direto do cliente.
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.slots, public.history, public.divergencias,
  public.warehouse_layout, public.warehouse_layout_positions
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS slots_insert_operations ON public.slots;
DROP POLICY IF EXISTS slots_update_operations ON public.slots;
DROP POLICY IF EXISTS history_insert_operations ON public.history;
DROP POLICY IF EXISTS divergencias_insert_operations ON public.divergencias;
DROP POLICY IF EXISTS divergencias_update_operations ON public.divergencias;
DROP POLICY IF EXISTS warehouse_layout_insert_admin ON public.warehouse_layout;
DROP POLICY IF EXISTS warehouse_layout_update_admin ON public.warehouse_layout;
DROP POLICY IF EXISTS warehouse_layout_positions_insert_admin ON public.warehouse_layout_positions;
DROP POLICY IF EXISTS warehouse_layout_positions_update_admin ON public.warehouse_layout_positions;

-- slots atende Dashboard, Pesquisa, Mapa, Lançamentos, Correção Física
-- e resolução de divergências. RLS é por linha, não por coluna: qualquer
-- chave abaixo concede SELECT da linha completa; granularidade por coluna
-- exigiria views/RPCs de leitura específicas.
DROP POLICY IF EXISTS slots_select_authenticated ON public.slots;
DROP POLICY IF EXISTS slots_select_permission_catalog ON public.slots;
CREATE POLICY slots_select_permission_catalog ON public.slots
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('dashboard.view'))
  OR (SELECT public.has_app_permission('stock.search'))
  OR (SELECT public.has_app_permission('stock.details.view'))
  OR (SELECT public.has_app_permission('stock.launch.view'))
  OR (SELECT public.has_app_permission('stock.launch.create'))
  OR (SELECT public.has_app_permission('stock.transfer.create'))
  OR (SELECT public.has_app_permission('stock.batch.process'))
  OR (SELECT public.has_app_permission('stock.physical_correction'))
  OR (SELECT public.has_app_permission('divergences.resolve'))
  OR (SELECT public.has_app_permission('map.view'))
  OR (SELECT public.has_app_permission('map.metadata.edit'))
  OR (SELECT public.has_app_permission('consultor.use'))
);

DROP POLICY IF EXISTS history_select_authenticated ON public.history;
DROP POLICY IF EXISTS history_select_permission_catalog ON public.history;
CREATE POLICY history_select_permission_catalog ON public.history
FOR SELECT TO authenticated
USING ((SELECT public.has_app_permission('history.view')));

DROP POLICY IF EXISTS divergencias_select_authenticated ON public.divergencias;
DROP POLICY IF EXISTS divergencias_select_permission_catalog ON public.divergencias;
CREATE POLICY divergencias_select_permission_catalog ON public.divergencias
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('divergences.view'))
  OR (SELECT public.has_app_permission('divergences.resolve'))
);

-- products permanece com DML direto: os escritores da aplicação usam
-- INSERT/UPDATE/DELETE e são protegidos pelas três políticas abaixo.
-- A leitura inclui a permissão de produto e os fluxos que usam o catálogo.
DROP POLICY IF EXISTS products_select_authenticated ON public.products;
DROP POLICY IF EXISTS products_select_permission_catalog ON public.products;
CREATE POLICY products_select_permission_catalog ON public.products
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('products.view'))
  OR (SELECT public.has_app_permission('products.create'))
  OR (SELECT public.has_app_permission('products.edit'))
  OR (SELECT public.has_app_permission('products.import_bulk'))
  OR (SELECT public.has_app_permission('products.delete_deactivate'))
  OR (SELECT public.has_app_permission('stock.search'))
  OR (SELECT public.has_app_permission('stock.details.view'))
  OR (SELECT public.has_app_permission('stock.launch.view'))
  OR (SELECT public.has_app_permission('stock.launch.create'))
  OR (SELECT public.has_app_permission('stock.transfer.create'))
  OR (SELECT public.has_app_permission('stock.batch.process'))
  OR (SELECT public.has_app_permission('consultor.use'))
);

DROP POLICY IF EXISTS warehouse_layout_select_authenticated ON public.warehouse_layout;
DROP POLICY IF EXISTS warehouse_layout_select_permission_catalog ON public.warehouse_layout;
CREATE POLICY warehouse_layout_select_permission_catalog ON public.warehouse_layout
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('warehouse.layout.view'))
  OR (SELECT public.has_app_permission('warehouse.layout.manage'))
  OR (SELECT public.has_app_permission('map.view'))
  OR (SELECT public.has_app_permission('dashboard.view'))
  OR (SELECT public.has_app_permission('stock.physical_correction'))
);

DROP POLICY IF EXISTS warehouse_layout_positions_select_authenticated ON public.warehouse_layout_positions;
DROP POLICY IF EXISTS warehouse_layout_positions_select_permission_catalog ON public.warehouse_layout_positions;
CREATE POLICY warehouse_layout_positions_select_permission_catalog ON public.warehouse_layout_positions
FOR SELECT TO authenticated
USING (
  (SELECT public.has_app_permission('warehouse.layout.view'))
  OR (SELECT public.has_app_permission('warehouse.layout.manage'))
  OR (SELECT public.has_app_permission('map.view'))
  OR (SELECT public.has_app_permission('dashboard.view'))
  OR (SELECT public.has_app_permission('stock.physical_correction'))
);

-- B6.2A revogou PUBLIC, mas a ACL observada tinha concessão explícita a anon.
REVOKE ALL ON FUNCTION public.update_slot_metadata_atomic(jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_slot_metadata_atomic(jsonb,jsonb) TO authenticated;

DO $postflight$
DECLARE
  v_select_policy_count integer;
  v_product_write_policy_count integer;
  v_function_oid oid;
BEGIN
  SELECT count(*) INTO v_select_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname='public'
    AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions')
    AND cmd='SELECT'
    AND policyname IN (
      'slots_select_permission_catalog','history_select_permission_catalog',
      'divergencias_select_permission_catalog','products_select_permission_catalog',
      'warehouse_layout_select_permission_catalog',
      'warehouse_layout_positions_select_permission_catalog'
    )
    AND COALESCE(qual,'') ILIKE '%has_app_permission%';

  IF v_select_policy_count <> 6 THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_PERMISSION_SELECT_POLICIES_INVALID: %', v_select_policy_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public'
      AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions')
      AND cmd='SELECT' AND COALESCE(qual,'') ILIKE '%has_app_role%'
  ) THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_ROLE_BASED_SELECT_POLICY_REMAINS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public'
      AND tablename IN ('slots','history','divergencias','warehouse_layout','warehouse_layout_positions')
      AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  ) THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_DIRECT_WRITE_POLICY_REMAINS';
  END IF;

  IF pg_catalog.has_table_privilege('authenticated','public.slots','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.slots','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.slots','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.history','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.history','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.history','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.divergencias','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.divergencias','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.divergencias','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout_positions','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout_positions','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.warehouse_layout_positions','DELETE') THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_AUTHENTICATED_DIRECT_DML_REMAINS';
  END IF;

  -- products é a exceção intencional, com DML protegido por has_app_permission.
  IF NOT pg_catalog.has_table_privilege('authenticated','public.products','SELECT')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.products','INSERT')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.products','UPDATE')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.products','DELETE') THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_PRODUCTS_DIRECT_WRITERS_CHANGED';
  END IF;

  SELECT count(*) INTO v_product_write_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='products'
    AND policyname IN ('products_insert_permission','products_update_permission','products_delete_permission')
    AND (COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) ILIKE '%has_app_permission%';

  IF v_product_write_policy_count <> 3 THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_PRODUCTS_PERMISSION_POLICIES_INVALID: %',
      v_product_write_policy_count;
  END IF;

  SELECT p.oid INTO v_function_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='update_slot_metadata_atomic'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid)='p_expected_slot jsonb, p_metadata jsonb';

  IF v_function_oid IS NULL
     OR pg_catalog.has_function_privilege('anon',v_function_oid,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated',v_function_oid,'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(
         COALESCE(
           (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid=v_function_oid),
           pg_catalog.acldefault('f',(SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid=v_function_oid))
         )
       ) acl
       WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
     ) THEN
    RAISE EXCEPTION 'B62B_POSTFLIGHT_METADATA_RPC_ACL_INVALID';
  END IF;
END;
$postflight$;

COMMIT;
