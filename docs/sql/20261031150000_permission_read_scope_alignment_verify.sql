-- Verificação somente leitura da Auditoria 03 / alinhamento de permissões.
BEGIN TRANSACTION READ ONLY;

DO $verify$
DECLARE
  v_catalog_count integer;
  v_matrix_count integer;
  v_slots_columns integer;
  v_slots_qual text;
  v_divergencias_qual text;
  v_products_qual text;
  v_permission_helper_definition text;
  v_context_helper_definition text;
  v_permission_helper_oid oid;
  v_context_helper_oid oid;
BEGIN
  v_permission_helper_oid := pg_catalog.to_regprocedure('public.has_app_permission(text)');
  v_context_helper_oid := pg_catalog.to_regprocedure('public.get_my_app_context()');
  IF v_permission_helper_oid IS NULL OR v_context_helper_oid IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid IN (v_permission_helper_oid, v_context_helper_oid)
          AND (p.prosecdef IS DISTINCT FROM TRUE
               OR NOT (COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]))
     ) THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_VERIFY_PERMISSION_HELPER_SECURITY_INVALID';
  END IF;

  v_permission_helper_definition := pg_catalog.pg_get_functiondef(v_permission_helper_oid);
  v_context_helper_definition := pg_catalog.pg_get_functiondef(v_context_helper_oid);
  IF v_permission_helper_definition NOT ILIKE '%v_dependency_keys%'
     OR v_permission_helper_definition NOT ILIKE '%stock.search%'
     OR v_permission_helper_definition NOT ILIKE '%divergences.view%'
     OR v_context_helper_definition NOT ILIKE '%v_permissions ->> ''stock.search''%'
     OR v_context_helper_definition NOT ILIKE '%v_permissions ->> ''divergences.view''%' THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_VERIFY_PERMISSION_DEPENDENCIES_INVALID';
  END IF;

  SELECT pg_catalog.count(*) INTO v_catalog_count
    FROM public.permission_catalog WHERE is_active IS TRUE;
  SELECT pg_catalog.count(*) INTO v_matrix_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active IS TRUE;

  IF v_catalog_count <> 29 OR v_matrix_count <> 145 THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_VERIFY_MATRIX_INVALID: catalog %, matrix %', v_catalog_count, v_matrix_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role='lideranca' AND permission_key='stock.search' AND allowed IS TRUE) THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_VERIFY_LEADERSHIP_SEARCH_NOT_ALLOWED';
  END IF;

  SELECT pg_catalog.max(qual) INTO v_slots_qual
    FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND tablename='slots' AND cmd='SELECT'
     AND policyname='slots_select_permission_catalog';
  IF v_slots_qual IS NULL OR v_slots_qual NOT ILIKE '%has_app_permission%stock.search%'
     OR v_slots_qual ILIKE '%stock.details.view%'
     OR v_slots_qual ILIKE '%dashboard.view%'
     OR v_slots_qual ILIKE '%divergences.resolve%' THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_VERIFY_SLOTS_POLICY_INVALID';
  END IF;

  SELECT pg_catalog.max(qual) INTO v_divergencias_qual
    FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND tablename='divergencias' AND cmd='SELECT'
     AND policyname='divergencias_select_permission_catalog';
  IF v_divergencias_qual IS NULL OR v_divergencias_qual NOT ILIKE '%has_app_permission%divergences.view%'
     OR v_divergencias_qual ILIKE '%divergences.resolve%' THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_VERIFY_DIVERGENCIAS_POLICY_INVALID';
  END IF;

  SELECT pg_catalog.max(qual) INTO v_products_qual
    FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND tablename='products' AND cmd='SELECT'
     AND policyname='products_select_permission_catalog';
  IF v_products_qual IS NULL OR v_products_qual ILIKE '%stock.details.view%'
     OR v_products_qual NOT ILIKE '%stock.search%' THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_VERIFY_PRODUCTS_POLICY_INVALID';
  END IF;

  SELECT pg_catalog.count(*) INTO v_slots_columns
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='slots' AND a.attnum>0 AND NOT a.attisdropped
     AND pg_catalog.has_column_privilege('authenticated', c.oid, a.attname, 'SELECT');
  IF v_slots_columns <> 14
     OR NOT pg_catalog.has_table_privilege('authenticated','public.slots','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.slots','SELECT') THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_VERIFY_SLOTS_FULL_READ_INVALID: %', v_slots_columns;
  END IF;

  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='slots' AND cmd='SELECT') <> 1
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='divergencias' AND cmd='SELECT') <> 1
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='products' AND cmd='SELECT') <> 1 THEN
    RAISE EXCEPTION 'A03_READ_SCOPE_VERIFY_DUPLICATE_SELECT_POLICY';
  END IF;
END;
$verify$;

SELECT 'AUDITORIA03_READ_SCOPE_OK' AS verification_result;
ROLLBACK;
