-- Verificação somente leitura para executar no banco local de integração.
-- Confirma policies e grants-base, mas não substitui o teste real com cada usuário.

SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename = 'products'
ORDER BY cmd, policyname;

SELECT role, permission_key, allowed
FROM public.role_permissions
WHERE permission_key IN (
  'products.create',
  'products.edit',
  'products.delete_deactivate'
)
ORDER BY role, permission_key;

-- O resultado desta consulta representa apenas a sessão atual.
-- Ao executar no SQL Editor como postgres sem JWT autenticado, é esperado que
-- auth.uid() seja NULL e as verificações não representem uma sessão de usuário.
SELECT
  auth.uid() AS authenticated_user_id,
  public.has_app_permission('products.create') AS can_create_product,
  public.has_app_permission('products.edit') AS can_edit_product,
  public.has_app_permission('products.delete_deactivate') AS can_delete_product;

-- A policy de leitura deve permanecer instalada.
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'products'
    AND policyname = 'products_select_authenticated'
    AND cmd = 'SELECT'
) AS legacy_product_select_policy_preserved;
