-- FOUNDATION ROLLBACK ONLY. Never run after the application or RLS policies depend on these objects.
-- Export/backup all permission configuration and audit rows before any rollback that includes data.
BEGIN;

DO $rollback_guard$
DECLARE
  v_role_rows integer;
  v_override_rows integer;
  v_audit_rows integer;
  v_catalog_rows integer;
  v_catalog_hash text;
  v_role_matrix_hash text;
BEGIN
  IF pg_catalog.to_regclass('public.permission_catalog') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_PERMISSION_FOUNDATION_NOT_PRESENT';
  END IF;
  SELECT count(*) INTO v_catalog_rows FROM public.permission_catalog;
  SELECT count(*) INTO v_role_rows FROM public.role_permissions;
  SELECT count(*) INTO v_override_rows FROM public.user_permission_overrides;
  SELECT count(*) INTO v_audit_rows FROM public.permission_change_audit;
  IF v_catalog_rows <> 29 OR v_role_rows <> 116 THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_SCHEMA_OR_MATRIX_CHANGED: catalog %, role rows %; backup and review first', v_catalog_rows, v_role_rows;
  END IF;
  IF v_override_rows > 0 OR v_audit_rows > 0 THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_PERMISSION_DATA_EXISTS: overrides %, audit rows %; export and approve data handling first', v_override_rows, v_audit_rows;
  END IF;
  IF EXISTS (SELECT 1 FROM public.role_permissions WHERE updated_by IS NOT NULL) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_ROLE_GRANTS_WERE_CHANGED: export and review first';
  END IF;
  SELECT pg_catalog.md5(pg_catalog.string_agg(
    rp.role || chr(31) || rp.permission_key || chr(31) || rp.allowed::text,
    chr(10) ORDER BY rp.role COLLATE "C", rp.permission_key COLLATE "C"
  )) INTO v_role_matrix_hash FROM public.role_permissions rp;
  IF v_role_matrix_hash <> '740e6ae5134c2037d61e57226f2499dc' THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_ROLE_MATRIX_CONTENT_CHANGED: export and review first';
  END IF;
  SELECT pg_catalog.md5(pg_catalog.string_agg(
    pc.permission_key || chr(31) || pc.module_name || chr(31) || pc.label || chr(31) || pc.description || chr(31) ||
    pc.risk_level || chr(31) || pc.is_admin_only::text || chr(31) || pc.user_override_allowed::text || chr(31) ||
    pc.is_active::text || chr(31) || pc.sort_order::text,
    chr(10) ORDER BY pc.permission_key COLLATE "C"
  )) INTO v_catalog_hash FROM public.permission_catalog pc;
  IF v_catalog_hash <> '9a9f58faa1d5e6a5dcf108ca4af48f29' THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_CATALOG_CONTENT_CHANGED: export and review first';
  END IF;
END;
$rollback_guard$;

DROP FUNCTION IF EXISTS public.get_permission_admin_matrix();
DROP FUNCTION IF EXISTS public.get_my_app_context();
DROP FUNCTION IF EXISTS public.has_app_permission(text);

DROP TABLE public.permission_change_audit;
DROP TABLE public.user_permission_overrides;
DROP TABLE public.role_permissions;
DROP TABLE public.permission_catalog;

COMMIT;
