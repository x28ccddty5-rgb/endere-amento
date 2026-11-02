-- Rollback somente da Etapa 03 / B6.1.
-- Restaura as três policies de escrita anteriores baseadas nos papéis legados.
-- Executar somente se a migração B6.1 tiver sido aplicada ao banco local de teste.

BEGIN;

DROP POLICY IF EXISTS products_insert_permission ON public.products;
DROP POLICY IF EXISTS products_update_permission ON public.products;
DROP POLICY IF EXISTS products_delete_permission ON public.products;

CREATE POLICY products_insert_management
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.has_app_role(ARRAY['administrador'::text, 'lideranca'::text]))
  );

CREATE POLICY products_update_management
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.has_app_role(ARRAY['administrador'::text, 'lideranca'::text]))
  )
  WITH CHECK (
    (SELECT public.has_app_role(ARRAY['administrador'::text, 'lideranca'::text]))
  );

CREATE POLICY products_delete_management
  ON public.products
  FOR DELETE
  TO authenticated
  USING (
    (SELECT public.has_app_role(ARRAY['administrador'::text, 'lideranca'::text]))
  );

COMMIT;
