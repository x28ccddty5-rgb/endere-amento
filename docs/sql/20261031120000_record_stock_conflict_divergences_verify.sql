BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';

SELECT
  'FUNCTION|' || p.proname ||
  '|security_definer=' || p.prosecdef::text ||
  '|search_path=' || COALESCE(array_to_string(p.proconfig, ','), 'NULL') ||
  '|authenticated_execute=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text ||
  '|anon_execute=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.oid = to_regprocedure('public.record_stock_conflict_divergences_atomic(text,jsonb)');

SELECT
  'RPC_CHECK|' || CASE
    WHEN p.oid IS NOT NULL
     AND p.prosecdef IS TRUE
     AND p.proconfig @> ARRAY['search_path=""']
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    THEN 'PASS'
    ELSE 'FAIL'
  END
FROM (SELECT to_regprocedure('public.record_stock_conflict_divergences_atomic(text,jsonb)') AS oid) AS f
LEFT JOIN pg_proc p ON p.oid = f.oid;

SELECT
  'RLS_UNCHANGED|' || c.relname ||
  '|enabled=' || c.relrowsecurity::text ||
  '|forced=' || c.relforcerowsecurity::text ||
  '|policies=' || count(p.policyname)::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relname IN ('slots', 'history', 'divergencias')
GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.relname;

ROLLBACK;
