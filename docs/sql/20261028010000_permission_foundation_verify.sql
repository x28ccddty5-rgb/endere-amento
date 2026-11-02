-- READ-ONLY POST-MIGRATION CONTRACT CHECK. Run only in an isolated test DB.
DO $verify$
DECLARE
  v_catalog integer;
  v_role_rows integer;
  v_distinct_role_rows integer;
  v_rls_count integer;
BEGIN
  SELECT count(*) INTO v_catalog FROM public.permission_catalog WHERE is_active;
  SELECT count(*), count(DISTINCT (role, permission_key)) INTO v_role_rows, v_distinct_role_rows
    FROM public.role_permissions;
  IF v_catalog <> 29 THEN RAISE EXCEPTION 'Expected 29 active keys, got %', v_catalog; END IF;
  IF v_role_rows <> 116 OR v_distinct_role_rows <> 116 THEN
    RAISE EXCEPTION 'Expected 116 explicit role rows, got %, distinct %', v_role_rows, v_distinct_role_rows;
  END IF;
  SELECT count(*) INTO v_rls_count FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('permission_catalog','role_permissions','user_permission_overrides','permission_change_audit')
    AND c.relrowsecurity;
  IF v_rls_count <> 4 THEN RAISE EXCEPTION 'RLS not enabled on all 4 new tables (found %)', v_rls_count; END IF;
  IF pg_catalog.has_table_privilege('authenticated','public.permission_catalog','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','public.role_permissions','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','public.user_permission_overrides','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','public.permission_change_audit','SELECT') THEN
    RAISE EXCEPTION 'Unexpected direct SELECT privilege granted to authenticated';
  END IF;
  IF pg_catalog.has_table_privilege('anon','public.permission_catalog','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.role_permissions','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.user_permission_overrides','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.permission_change_audit','SELECT') THEN
    RAISE EXCEPTION 'Unexpected direct SELECT privilege granted to anon';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated','public.has_app_permission(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated','public.get_my_app_context()','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated','public.get_permission_admin_matrix()','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated RPC execute grant is missing';
  END IF;
  IF pg_catalog.has_function_privilege('anon','public.has_app_permission(text)','EXECUTE')
     OR pg_catalog.has_function_privilege('anon','public.get_my_app_context()','EXECUTE')
     OR pg_catalog.has_function_privilege('anon','public.get_permission_admin_matrix()','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous execution privilege must be denied';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('has_app_permission','get_my_app_context','get_permission_admin_matrix')
        AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']::text[]) <> 3 THEN
    RAISE EXCEPTION 'Security-definer/search_path check failed for authorization RPCs';
  END IF;
END;
$verify$;

SELECT p.proname AS function_name, p.prosecdef AS security_definer, p.proconfig AS configuration
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('has_app_permission','get_my_app_context','get_permission_admin_matrix')
ORDER BY p.proname;
