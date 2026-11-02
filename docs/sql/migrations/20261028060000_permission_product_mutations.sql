-- Etapa 03 / B6.1: autorização de gravação individual do cadastro de produtos.
-- Pré-requisito: permission foundation 20261028010000 já aplicada no banco-alvo.
-- Este migration não altera grants SQL nem a policy SELECT; ela substitui apenas
-- as três policies de escrita atualmente baseadas em papel.
-- Aplicar primeiro em clone local de integração. Não executar em produção sem aprovação.

BEGIN;

DO $preflight$
DECLARE
  v_rls_enabled boolean;
  v_unexpected_write_policy text;
BEGIN
  IF pg_catalog.to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_PRODUCTS_PREFLIGHT_TABLE_MISSING';
  END IF;

  IF pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_PRODUCTS_PREFLIGHT_FOUNDATION_MISSING';
  END IF;

  SELECT c.relrowsecurity
    INTO v_rls_enabled
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.products'::regclass;

  IF v_rls_enabled IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERMISSION_PRODUCTS_PREFLIGHT_RLS_DISABLED';
  END IF;

  -- Falha fechada se houver outra policy permissiva de escrita que possa
  -- continuar autorizando INSERT/UPDATE/DELETE após esta migração.
  SELECT p.policyname
    INTO v_unexpected_write_policy
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename = 'products'
    AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    AND p.policyname NOT IN (
      'products_insert_management',
      'products_update_management',
      'products_delete_management',
      'products_insert_permission',
      'products_update_permission',
      'products_delete_permission'
    )
  LIMIT 1;

  IF v_unexpected_write_policy IS NOT NULL THEN
    RAISE EXCEPTION 'PERMISSION_PRODUCTS_PREFLIGHT_UNEXPECTED_WRITE_POLICY: %',
      v_unexpected_write_policy;
  END IF;
END;
$preflight$;

DROP POLICY IF EXISTS products_insert_management ON public.products;
DROP POLICY IF EXISTS products_update_management ON public.products;
DROP POLICY IF EXISTS products_delete_management ON public.products;

DROP POLICY IF EXISTS products_insert_permission ON public.products;
DROP POLICY IF EXISTS products_update_permission ON public.products;
DROP POLICY IF EXISTS products_delete_permission ON public.products;

CREATE POLICY products_insert_permission
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_app_permission('products.create'));

CREATE POLICY products_update_permission
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (public.has_app_permission('products.edit'))
  WITH CHECK (public.has_app_permission('products.edit'));

-- A chave é marcada no catálogo como administrativa e não delegável.
CREATE POLICY products_delete_permission
  ON public.products
  FOR DELETE
  TO authenticated
  USING (public.has_app_permission('products.delete_deactivate'));

-- Intencionalmente preservados:
--   * policy de SELECT atual (a lista de produtos também serve aos fluxos operacionais);
--   * grants de tabela existentes, já que os escritores individuais continuam usando DML;
--   * todos os demais objetos e políticas operacionais.

COMMIT;
