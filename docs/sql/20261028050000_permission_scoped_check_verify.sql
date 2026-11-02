\set ON_ERROR_STOP on

SELECT
  p.proname AS function_name,
  p.prosecdef AS security_definer,
  p.proconfig AS configuration,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'has_app_permissions'
  AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_permission_keys text[]';

DO $verify$
DECLARE
  v_catalog_count integer;
  v_role_rows integer;
  v_definer boolean;
  v_config text[];
  v_authenticated_exec boolean;
  v_anon_exec boolean;
BEGIN
  SELECT pg_catalog.count(*) INTO v_catalog_count
  FROM public.permission_catalog WHERE is_active;
  SELECT pg_catalog.count(*) INTO v_role_rows
  FROM public.role_permissions rp
  JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active;
  SELECT p.prosecdef, p.proconfig,
         has_function_privilege('authenticated', p.oid, 'EXECUTE'),
         has_function_privilege('anon', p.oid, 'EXECUTE')
    INTO v_definer, v_config, v_authenticated_exec, v_anon_exec
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'has_app_permissions'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_permission_keys text[]';

  IF v_catalog_count <> 29 OR v_role_rows <> 116 THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_VERIFY_MATRIX_CHANGED: catalog %, grants %', v_catalog_count, v_role_rows;
  END IF;
  IF v_definer IS DISTINCT FROM TRUE OR NOT ('search_path=""' = ANY(COALESCE(v_config, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_VERIFY_SECURITY_CONFIG_FAILED';
  END IF;
  IF v_authenticated_exec IS DISTINCT FROM TRUE OR v_anon_exec IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_VERIFY_ACL_FAILED';
  END IF;
END;
$verify$;
