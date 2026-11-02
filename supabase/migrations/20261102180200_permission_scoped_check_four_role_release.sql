-- RELEASE PRODUCTION / A1 — helper de escopo inicial
-- Source reviewed: docs/sql/migrations/20261028050000_permission_scoped_check.sql
-- Aplicar somente na ordem indicada em README-RELEASE.md.

BEGIN;

-- Preflight: require the reviewed B1 foundation and complete 4-role matrix.
DO $preflight$
DECLARE
  v_catalog_count integer;
  v_role_rows integer;
  v_role_distinct integer;
  v_known_roles integer;
BEGIN
  IF pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_REQUIRES_B1_FOUNDATION';
  END IF;

  SELECT pg_catalog.count(*) INTO v_catalog_count
  FROM public.permission_catalog WHERE is_active;

  SELECT pg_catalog.count(*), pg_catalog.count(DISTINCT rp.role),
         pg_catalog.count(DISTINCT rp.role) FILTER (
           WHERE rp.role IN ('administrador', 'apoio', 'producao', 'visualizador')
         )
    INTO v_role_rows, v_role_distinct, v_known_roles
  FROM public.role_permissions rp
  JOIN public.permission_catalog pc
    ON pc.permission_key = rp.permission_key AND pc.is_active;

  IF v_catalog_count <> 29 OR v_role_rows <> 116 OR v_role_distinct <> 4 OR v_known_roles <> 4 THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_BASE_MATRIX_INVALID: catalog %, rows %, roles %, known roles %',
      v_catalog_count, v_role_rows, v_role_distinct, v_known_roles;
  END IF;
END;
$preflight$;

-- One bounded server round-trip for a global permission plus module/scope permissions.
CREATE FUNCTION public.has_app_permissions(p_permission_keys text[])
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

  -- Unknown, inactive, or malformed keys never grant access.
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

  SELECT COALESCE(pg_catalog.bool_and(public.has_app_permission(supplied.permission_key)), FALSE)
    INTO v_all_allowed
  FROM pg_catalog.unnest(p_permission_keys) AS supplied(permission_key);

  RETURN COALESCE(v_all_allowed, FALSE);
END;
$function$;

REVOKE ALL ON FUNCTION public.has_app_permissions(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_app_permissions(text[]) TO authenticated;

COMMIT;
