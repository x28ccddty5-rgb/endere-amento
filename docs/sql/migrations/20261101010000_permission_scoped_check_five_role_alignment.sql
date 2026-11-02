BEGIN;

-- The previous scoped-export migration was authored against the four-role
-- foundation (116 rows). Audit 03 now includes the configurable leadership
-- role, so this forward migration validates the current 29 x 5 matrix (145).
DO $preflight$
DECLARE
  v_catalog_count integer;
  v_role_rows integer;
  v_role_distinct integer;
  v_expected_roles integer;
  v_unknown_roles integer;
BEGIN
  IF pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_REQUIRES_B1_FOUNDATION';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_catalog_count
  FROM public.permission_catalog
  WHERE is_active;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(DISTINCT rp.role)::integer,
    pg_catalog.count(DISTINCT rp.role) FILTER (
      WHERE rp.role IN ('administrador', 'apoio', 'producao', 'visualizador', 'lideranca')
    )::integer
    INTO v_role_rows, v_role_distinct, v_expected_roles
  FROM public.role_permissions rp
  JOIN public.permission_catalog pc
    ON pc.permission_key = rp.permission_key
   AND pc.is_active;

  SELECT pg_catalog.count(DISTINCT rp.role)::integer
    INTO v_unknown_roles
  FROM public.role_permissions rp
  WHERE rp.role NOT IN ('administrador', 'apoio', 'producao', 'visualizador', 'lideranca');

  IF v_catalog_count <> 29
     OR v_role_rows <> 145
     OR v_role_distinct <> 5
     OR v_expected_roles <> 5
     OR v_unknown_roles <> 0 THEN
    RAISE EXCEPTION
      'PERMISSION_SCOPED_CHECK_FIVE_ROLE_MATRIX_INVALID: catalog %, rows %, roles %, expected roles %, unknown roles %',
      v_catalog_count, v_role_rows, v_role_distinct, v_expected_roles, v_unknown_roles;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('administrador'), ('apoio'), ('producao'), ('visualizador'), ('lideranca')
    ) AS expected(role)
    LEFT JOIN (
      SELECT rp.role, pg_catalog.count(*)::integer AS permission_rows
      FROM public.role_permissions rp
      JOIN public.permission_catalog pc
        ON pc.permission_key = rp.permission_key
       AND pc.is_active
      GROUP BY rp.role
    ) AS actual ON actual.role = expected.role
    WHERE COALESCE(actual.permission_rows, 0) <> 29
  ) THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_FIVE_ROLE_PER_ROLE_COUNT_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    GROUP BY rp.role, rp.permission_key
    HAVING pg_catalog.count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_FIVE_ROLE_DUPLICATE_GRANTS';
  END IF;
END;
$preflight$;

-- One bounded server round-trip validates the global export grant and every
-- requested module/scope permission. Unknown, duplicate, empty, or excessive
-- inputs fail closed. No permission data or role grants are changed.
CREATE OR REPLACE FUNCTION public.has_app_permissions(p_permission_keys text[])
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_input_count integer;
  v_distinct_count integer;
  v_all_allowed boolean;
BEGIN
  IF auth.uid() IS NULL OR p_permission_keys IS NULL THEN
    RETURN FALSE;
  END IF;

  v_input_count := pg_catalog.cardinality(p_permission_keys);
  IF v_input_count < 1 OR v_input_count > 8 THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_permission_keys) AS supplied(permission_key)
    WHERE supplied.permission_key IS NULL
       OR pg_catalog.btrim(supplied.permission_key) = ''
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT pg_catalog.count(DISTINCT supplied.permission_key)::integer
    INTO v_distinct_count
  FROM pg_catalog.unnest(p_permission_keys) AS supplied(permission_key);

  IF v_distinct_count <> v_input_count THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_permission_keys) AS supplied(permission_key)
    LEFT JOIN public.permission_catalog pc
      ON pc.permission_key = supplied.permission_key
     AND pc.is_active
    WHERE pc.permission_key IS NULL
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT COALESCE(
    pg_catalog.bool_and(public.has_app_permission(supplied.permission_key)),
    FALSE
  )
  INTO v_all_allowed
  FROM pg_catalog.unnest(p_permission_keys) AS supplied(permission_key);

  RETURN COALESCE(v_all_allowed, FALSE);
END;
$function$;

REVOKE ALL ON FUNCTION public.has_app_permissions(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_app_permissions(text[]) TO authenticated;

DO $postflight$
DECLARE
  v_is_definer boolean;
  v_config text[];
  v_authenticated_exec boolean;
  v_anon_exec boolean;
BEGIN
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

  IF v_is_definer IS DISTINCT FROM TRUE
     OR NOT ('search_path=""' = ANY(COALESCE(v_config, ARRAY[]::text[])))
     OR v_authenticated_exec IS DISTINCT FROM TRUE
     OR v_anon_exec IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_FIVE_ROLE_SECURITY_POSTFLIGHT_FAILED';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
