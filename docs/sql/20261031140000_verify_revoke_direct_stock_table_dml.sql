-- Verificação pós-migração - somente leitura.
-- Executar no clone local após aplicar 20261031140000_revoke_direct_stock_table_dml.sql.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';

SELECT
  'TABLE|' || t.table_name ||
  '|authenticated_select=' || has_table_privilege('authenticated', t.table_name, 'SELECT')::text ||
  '|authenticated_insert=' || has_table_privilege('authenticated', t.table_name, 'INSERT')::text ||
  '|authenticated_update=' || has_table_privilege('authenticated', t.table_name, 'UPDATE')::text ||
  '|authenticated_delete=' || has_table_privilege('authenticated', t.table_name, 'DELETE')::text ||
  '|service_role_dml=' || has_table_privilege('service_role', t.table_name, 'INSERT,UPDATE,DELETE')::text ||
  '|postgres_dml=' || has_table_privilege('postgres', t.table_name, 'INSERT,UPDATE,DELETE')::text AS result
FROM (VALUES
  ('public.slots'),
  ('public.history'),
  ('public.divergencias')
) AS t(table_name)
ORDER BY t.table_name;

SELECT
  'RPC|' || p.proname ||
  '|' || pg_get_function_identity_arguments(p.oid) ||
  '|security_definer=' || p.prosecdef::text ||
  '|authenticated_execute=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text ||
  '|anon_execute=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text ||
  '|permission_guard=' || (position('has_app_permission' IN lower(p.prosrc)) > 0)::text ||
  '|empty_search_path=' || (p.proconfig @> ARRAY['search_path=""'])::text AS result
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'apply_stock_mutation_atomic',
    'apply_stock_mutation_atomic_with_deletes',
    'process_shared_lancamento_draft_batch_atomic',
    'reconcile_physical_address_atomic',
    'reconcile_physical_address_atomic_with_deletes',
    'record_stock_conflict_divergences_atomic',
    'resolve_stock_divergence_atomic',
    'zero_physical_divergence_address_atomic'
  )
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

DO $verification$
DECLARE
  v_table text;
  v_rpc_count integer;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['slots', 'history', 'divergencias'] LOOP
    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'VERIFY_FAILED: authenticated ainda possui DML em %', v_table;
    END IF;
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'VERIFY_FAILED: SELECT de authenticated ausente em %', v_table;
    END IF;
    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'VERIFY_FAILED: DML de service_role ausente em %', v_table;
    END IF;
    IF NOT has_table_privilege('postgres', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'VERIFY_FAILED: DML de postgres ausente em %', v_table;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_rpc_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'apply_stock_mutation_atomic',
      'apply_stock_mutation_atomic_with_deletes',
      'process_shared_lancamento_draft_batch_atomic',
      'reconcile_physical_address_atomic',
      'reconcile_physical_address_atomic_with_deletes',
      'record_stock_conflict_divergences_atomic',
      'resolve_stock_divergence_atomic',
      'zero_physical_divergence_address_atomic'
    )
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.prosecdef
    AND p.proconfig @> ARRAY['search_path=""']
    AND position('has_app_permission' IN lower(p.prosrc)) > 0;

  IF v_rpc_count <> 8 THEN
    RAISE EXCEPTION 'VERIFY_FAILED: esperado 8 RPCs protegidas executáveis; encontrado %', v_rpc_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('apply_stock_mutation_atomic', 'apply_stock_mutation_atomic_with_deletes')
      AND position('p_operation_type' IN pg_get_function_identity_arguments(p.oid)) = 0
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'VERIFY_FAILED: sobrecarga legada voltou a ficar executável';
  END IF;

  RAISE NOTICE 'VERIFY_STOCK_DML_REVOKE|PASS';
END;
$verification$;

ROLLBACK;
