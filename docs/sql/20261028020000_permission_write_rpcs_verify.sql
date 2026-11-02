-- Verificação somente de leitura da Fase B2. Executar apenas em banco local/teste.
DO $verify$
DECLARE
  v_rpc_count integer;
  v_catalog_count integer;
  v_role_rows integer;
  v_audit_rls boolean;
BEGIN
  SELECT pg_catalog.count(*) INTO v_rpc_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('save_role_permission_changes', 'save_user_permission_overrides')
    AND p.prosecdef
    AND p.proconfig @> ARRAY['search_path=""']::text[];
  IF v_rpc_count <> 2 THEN
    RAISE EXCEPTION 'Expected two secured write RPCs; found %', v_rpc_count;
  END IF;

  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.save_role_permission_changes(text,jsonb)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.save_user_permission_overrides(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated execute grants are missing';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.save_role_permission_changes(text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.save_user_permission_overrides(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous execute privilege is present';
  END IF;

  SELECT pg_catalog.count(*) INTO v_catalog_count
  FROM public.permission_catalog WHERE is_active;
  SELECT pg_catalog.count(*) INTO v_role_rows
  FROM public.role_permissions;
  IF v_catalog_count <> 29 OR v_role_rows <> 116 THEN
    RAISE EXCEPTION 'Base matrix changed unexpectedly: active keys %, role rows %', v_catalog_count, v_role_rows;
  END IF;

  SELECT c.relrowsecurity INTO v_audit_rls
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'permission_change_audit';
  IF v_audit_rls IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Audit RLS unexpectedly disabled';
  END IF;

  IF pg_catalog.has_table_privilege('authenticated', 'public.permission_change_audit', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.permission_change_audit', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.permission_change_audit', 'SELECT') THEN
    RAISE EXCEPTION 'Direct audit table access unexpectedly granted';
  END IF;
END;
$verify$;

SELECT p.proname AS function_name, p.prosecdef AS security_definer, p.proconfig AS configuration
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('save_role_permission_changes', 'save_user_permission_overrides')
ORDER BY p.proname;
