\set ON_ERROR_STOP on
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('public.has_app_permissions(text[])') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_SCOPED_CHECK_ROLLBACK_FUNCTION_NOT_FOUND';
  END IF;
END;
$preflight$;

DROP FUNCTION public.has_app_permissions(text[]);
NOTIFY pgrst, 'reload schema';
COMMIT;
