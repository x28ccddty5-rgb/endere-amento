-- Frente 01 - Segurança e Integridade
-- Revoga DML direto do papel authenticated nas tabelas centrais de estoque.
-- Mantém SELECT, service_role, postgres, RPCs SECURITY DEFINER e políticas RLS.
-- Aplicar somente no clone local: supabase_db_enderecamento-integracao-local.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

-- Pré-condições: esquema e privilégios precisam corresponder à auditoria.
DO $migration_precheck$
DECLARE
  v_table text;
  v_rpc_count integer;
BEGIN
  IF to_regclass('public.slots') IS NULL
     OR to_regclass('public.history') IS NULL
     OR to_regclass('public.divergencias') IS NULL THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: tabela central ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: role esperada ausente';
  END IF;

  -- Não prosseguir se PUBLIC tiver DML direto em qualquer tabela-alvo.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(c.relacl, acldefault('r', c.relowner))
    ) a
    WHERE n.nspname = 'public'
      AND c.relname IN ('slots', 'history', 'divergencias')
      AND a.grantee = 0
      AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: PUBLIC possui DML direto';
  END IF;

  FOREACH v_table IN ARRAY ARRAY['slots', 'history', 'divergencias'] LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: authenticated não possui SELECT em %', v_table;
    END IF;

    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: service_role não possui DML completo em %', v_table;
    END IF;

    IF NOT has_table_privilege('postgres', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: postgres não possui DML completo em %', v_table;
    END IF;
  END LOOP;

  -- Confirmar exatamente as oito RPCs operacionais protegidas já auditadas.
  SELECT count(*)
    INTO v_rpc_count
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
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_rpc_count <> 8 THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: esperado 8 RPCs operacionais executáveis; encontrado %', v_rpc_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
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
      AND (
        NOT p.prosecdef
        OR NOT r.rolbypassrls
        OR NOT (p.proconfig @> ARRAY['search_path=""'])
        OR position('has_app_permission' IN lower(p.prosrc)) = 0
      )
  ) THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: RPC executável sem proteção SECURITY DEFINER/search_path/permissão esperada';
  END IF;

  -- As sobrecargas legadas sem p_operation_type devem continuar inacessíveis.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('apply_stock_mutation_atomic', 'apply_stock_mutation_atomic_with_deletes')
      AND position('p_operation_type' IN pg_get_function_identity_arguments(p.oid)) = 0
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: sobrecarga legada ainda executável por authenticated';
  END IF;
END;
$migration_precheck$;

-- Revoga somente escrita direta de authenticated nas tabelas centrais.
REVOKE INSERT, UPDATE, DELETE
ON TABLE public.slots, public.history, public.divergencias
FROM authenticated;

-- Pós-condições: qualquer divergência aborta e reverte toda a transação.
DO $migration_postcheck$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['slots', 'history', 'divergencias'] LOOP
    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: DML direto ainda efetivo para authenticated em %', v_table;
    END IF;

    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: SELECT de authenticated foi perdido em %', v_table;
    END IF;

    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: DML de service_role foi alterado em %', v_table;
    END IF;

    IF NOT has_table_privilege('postgres', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'STOCK_DML_REVOKE_ABORT: DML de postgres foi alterado em %', v_table;
    END IF;
  END LOOP;
END;
$migration_postcheck$;

COMMIT;
