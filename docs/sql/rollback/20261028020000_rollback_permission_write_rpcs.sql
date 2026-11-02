-- Rollback reversível apenas das duas RPCs adicionadas na Fase B2.
-- Não apaga catálogo, grants, exceções ou auditoria.
-- Executar somente no banco local/teste onde a migration B2 foi aplicada.
BEGIN;

DO $guard$
BEGIN
  IF pg_catalog.to_regprocedure('public.save_role_permission_changes(text,jsonb)') IS NULL
     AND pg_catalog.to_regprocedure('public.save_user_permission_overrides(uuid,jsonb)') IS NULL THEN
    RAISE NOTICE 'Fase B2 já revertida: nenhuma RPC de escrita encontrada.';
  END IF;
END;
$guard$;

-- Sem CASCADE: se algum objeto passar a depender dessas RPCs, o rollback deve falhar
-- em vez de remover dependências inesperadamente.
DROP FUNCTION IF EXISTS public.save_role_permission_changes(text, jsonb);
DROP FUNCTION IF EXISTS public.save_user_permission_overrides(uuid, jsonb);

DO $verify_rollback$
BEGIN
  IF pg_catalog.to_regprocedure('public.save_role_permission_changes(text,jsonb)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.save_user_permission_overrides(uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'PERMISSION_WRITE_RPC_ROLLBACK_INCOMPLETE';
  END IF;
  IF pg_catalog.to_regclass('public.permission_catalog') IS NULL
     OR pg_catalog.to_regclass('public.role_permissions') IS NULL
     OR pg_catalog.to_regclass('public.user_permission_overrides') IS NULL
     OR pg_catalog.to_regclass('public.permission_change_audit') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_FOUNDATION_MUST_REMAIN_INTACT';
  END IF;
END;
$verify_rollback$;

COMMIT;
