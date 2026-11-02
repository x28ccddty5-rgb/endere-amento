\set ON_ERROR_STOP on

-- Rollback only the additive scope-check RPC. Revert the app code using this RPC first.
-- Function dependency restrictions remain active; PostgreSQL must refuse if a database object depends on this RPC.
DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('public.has_app_permissions(text[])') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK_NOTHING_TO_DO_OR_RPC_MISSING';
  END IF;
END;
$preflight$;

DROP FUNCTION public.has_app_permissions(text[]);

SELECT 'ROLLBACK_PERMISSION_SCOPED_CHECK_COMPLETED' AS result;
