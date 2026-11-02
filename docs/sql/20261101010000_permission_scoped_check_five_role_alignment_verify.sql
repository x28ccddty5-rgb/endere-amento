\set ON_ERROR_STOP on

SELECT
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS configuration,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'has_app_permissions'
  AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_permission_keys text[]';

DO $verify$
DECLARE
  v_catalog_count integer;
  v_role_rows integer;
  v_role_distinct integer;
  v_is_definer boolean;
  v_config text[];
  v_authenticated_exec boolean;
  v_anon_exec boolean;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO v_catalog_count
  FROM public.permission_catalog
  WHERE is_active;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(DISTINCT rp.role)::integer
  INTO v_role_rows, v_role_distinct
  FROM public.role_permissions rp
  JOIN public.permission_catalog pc
    ON pc.permission_key = rp.permission_key
   AND pc.is_active;

  SELECT
    p.prosecdef,
    p.proconfig,
    pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  INTO v_is_definer, v_config, v_authenticated_exec, v_anon_exec
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'has_app_permissions'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_permission_keys text[]';

  IF v_catalog_count <> 29 OR v_role_rows <> 145 OR v_role_distinct <> 5 THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_MATRIX_VERIFY_FAILED: catalog %, rows %, roles %',
      v_catalog_count, v_role_rows, v_role_distinct;
  END IF;

  IF v_is_definer IS DISTINCT FROM TRUE
     OR NOT ('search_path=""' = ANY(COALESCE(v_config, ARRAY[]::text[])))
     OR v_authenticated_exec IS DISTINCT FROM TRUE
     OR v_anon_exec IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_SECURITY_VERIFY_FAILED';
  END IF;
END;
$verify$;
