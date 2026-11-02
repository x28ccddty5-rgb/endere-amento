-- B9 — Verificação pós-migração somente leitura.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';

SELECT
  'MATRIX|catalog=' || (SELECT pg_catalog.count(*) FROM public.permission_catalog WHERE is_active)::text ||
  '|rows=' || (SELECT pg_catalog.count(*) FROM public.role_permissions rp JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active)::text ||
  '|roles=' || (SELECT pg_catalog.count(DISTINCT role) FROM public.role_permissions)::text;

SELECT
  'LEADERSHIP|rows=' || pg_catalog.count(*)::text ||
  '|allowed=' || (pg_catalog.count(*) FILTER (WHERE rp.allowed))::text ||
  '|admin_only_allowed=' || (pg_catalog.count(*) FILTER (WHERE pc.is_admin_only AND rp.allowed))::text
FROM public.role_permissions rp
JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active
WHERE rp.role = 'lideranca';

SELECT
  'FUNCTION|' || p.proname ||
  '|security_definer=' || p.prosecdef::text ||
  '|search_path=' || COALESCE(array_to_string(p.proconfig, ','), 'NULL') ||
  '|authenticated_execute=' || pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')::text ||
  '|anon_execute=' || pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')::text
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'has_app_permission',
    'get_my_app_context',
    'get_permission_admin_matrix',
    'save_role_permission_changes',
    'save_user_permission_overrides'
  )
ORDER BY p.proname;

DO $verify$
DECLARE
  v_catalog_count integer;
  v_role_row_count integer;
  v_role_count integer;
  v_leadership_row_count integer;
  v_leadership_allowed_count integer;
  v_admin_only_leadership_count integer;
  v_function_count integer;
  v_secure_function_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_catalog_count
    FROM public.permission_catalog WHERE is_active;
  SELECT pg_catalog.count(*) INTO v_role_row_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active;
  SELECT pg_catalog.count(DISTINCT rp.role) INTO v_role_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active;
  SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE rp.allowed)
    INTO v_leadership_row_count, v_leadership_allowed_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active
   WHERE rp.role = 'lideranca';
  SELECT pg_catalog.count(*) INTO v_admin_only_leadership_count
    FROM public.role_permissions rp
    JOIN public.permission_catalog pc ON pc.permission_key = rp.permission_key AND pc.is_active
   WHERE rp.role = 'lideranca' AND pc.is_admin_only AND rp.allowed;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE p.prosecdef
        AND p.proconfig @> ARRAY['search_path=""']::text[]
        AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
    )
    INTO v_function_count, v_secure_function_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      (p.proname = 'has_app_permission' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_permission_key text')
      OR (p.proname = 'get_my_app_context' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '')
      OR (p.proname = 'get_permission_admin_matrix' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '')
      OR (p.proname = 'save_role_permission_changes' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_target_role text, p_changes jsonb')
      OR (p.proname = 'save_user_permission_overrides' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_target_user_id uuid, p_changes jsonb')
    );

  IF v_catalog_count <> 29 OR v_role_row_count <> 145 OR v_role_count <> 5
     OR v_leadership_row_count <> 29 OR v_leadership_allowed_count <> 0
     OR v_admin_only_leadership_count <> 0 THEN
    RAISE EXCEPTION 'B9_MATRIX_VERIFY_FAILED';
  END IF;
  IF v_function_count <> 5 OR v_secure_function_count <> 5 THEN
    RAISE EXCEPTION 'B9_FUNCTION_SECURITY_VERIFY_FAILED: functions %, secure %',
      v_function_count, v_secure_function_count;
  END IF;
END;
$verify$;

ROLLBACK;
