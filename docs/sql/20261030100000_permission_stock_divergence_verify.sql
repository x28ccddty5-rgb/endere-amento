-- Verificação somente leitura da migração de autorização de estoque/divergências.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';

SELECT
  'FUNCTION|' || p.proname ||
  '|security_definer=' || p.prosecdef::text ||
  '|search_path=' || COALESCE(array_to_string(p.proconfig, ','), '') ||
  '|authenticated_execute=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text ||
  '|anon_execute=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.oid IN (
    to_regprocedure('public.reconcile_physical_address_atomic(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'),
    to_regprocedure('public.reconcile_physical_address_atomic_with_deletes(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'),
    to_regprocedure('public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)'),
    to_regprocedure('public.zero_physical_divergence_address_atomic(boolean,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])')
  )
ORDER BY p.proname;

SELECT
  'RPC_CHECK|' || CASE
    WHEN count(*) = 4
     AND bool_and(p.prosecdef IS TRUE)
     AND bool_and(COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""'])
     AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
    THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.oid IN (
    to_regprocedure('public.reconcile_physical_address_atomic(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'),
    to_regprocedure('public.reconcile_physical_address_atomic_with_deletes(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'),
    to_regprocedure('public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)'),
    to_regprocedure('public.zero_physical_divergence_address_atomic(boolean,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])')
  );

SELECT
  'RLS_UNCHANGED|' || tablename ||
  '|enabled=' || rowsecurity::text ||
  '|policies=' || policy_count::text
FROM (
  SELECT c.relname AS tablename,
         c.relrowsecurity AS rowsecurity,
         count(p.policyname)::integer AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
  WHERE n.nspname = 'public'
    AND c.relname IN ('slots', 'history', 'divergencias')
  GROUP BY c.relname, c.relrowsecurity
) AS policies
ORDER BY tablename;

ROLLBACK;
