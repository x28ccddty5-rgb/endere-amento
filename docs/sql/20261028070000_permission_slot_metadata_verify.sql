-- Verificação somente leitura para o clone local de integração.

SELECT
  pg_catalog.to_regprocedure('public.update_slot_metadata_atomic(jsonb,jsonb)') IS NOT NULL
    AS rpc_exists,
  pg_catalog.has_function_privilege('authenticated',
    'public.update_slot_metadata_atomic(jsonb,jsonb)', 'EXECUTE')
    AS authenticated_can_execute,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    WHERE p.oid = pg_catalog.to_regprocedure('public.update_slot_metadata_atomic(jsonb,jsonb)')
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_role_can_execute;

SELECT
  has_table_privilege('authenticated', 'public.slots', 'SELECT') AS slots_select_preserved,
  has_table_privilege('authenticated', 'public.slots', 'INSERT') AS slots_insert_still_open_before_b,
  has_table_privilege('authenticated', 'public.slots', 'UPDATE') AS slots_update_still_open_before_b,
  has_table_privilege('authenticated', 'public.slots', 'DELETE') AS slots_delete_still_open_before_b;

-- Este SELECT usa a sessão atual; no SQL Editor como postgres auth.uid() normalmente é NULL.
SELECT auth.uid() AS current_auth_user,
       public.has_app_permission('map.metadata.edit') AS current_user_can_edit_map_metadata;
