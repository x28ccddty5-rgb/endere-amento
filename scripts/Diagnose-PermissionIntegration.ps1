$ErrorActionPreference = 'Stop'

Write-Host "`n=== DIAGNOSTICO SOMENTE DE LEITURA: INTEGRACAO LOCAL ==="
Write-Host "Este script apenas consulta o container local existente. Nao cria, reinicia, remove ou modifica containers, tabelas ou dados."

$dbContainer = docker ps --filter "name=supabase_db_enderecamento-integracao-local" --format "{{.Names}}" | Select-Object -First 1
if (-not $dbContainer) {
    Write-Host "Container supabase_db_enderecamento-integracao-local nao esta em execucao."
    Write-Host "Containers existentes com nome relacionado:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | Select-String -Pattern "enderecamento|NAMES"
    throw "Pare aqui. Nao iniciaremos nem reiniciaremos outro ambiente automaticamente."
}

Write-Host "`nContainer alvo: $dbContainer"

$sql = @'
SELECT 'CONNECTION' AS section,
       jsonb_build_object(
         'database', current_database(),
         'user', current_user,
         'server_addr', inet_server_addr(),
         'server_port', inet_server_port()
       ) AS result;

SELECT 'CORE_OBJECT' AS section, item,
       CASE WHEN kind = 'table' THEN pg_catalog.to_regclass('public.' || item) IS NOT NULL
            ELSE pg_catalog.to_regprocedure(signature) IS NOT NULL END AS exists
FROM (VALUES
  ('profiles','table',NULL),
  ('slots','table',NULL),
  ('history','table',NULL),
  ('divergencias','table',NULL),
  ('products','table',NULL),
  ('warehouse_layout','table',NULL),
  ('warehouse_layout_positions','table',NULL),
  ('occupancy_history','table',NULL),
  ('apply_stock_mutation_atomic','function','public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)'),
  ('apply_stock_mutation_atomic_with_deletes','function','public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])'),
  ('process_shared_lancamento_draft_batch_atomic','function','public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'),
  ('resolve_stock_divergence_atomic','function','public.resolve_stock_divergence_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)'),
  ('zero_physical_divergence_address_atomic','function','public.zero_physical_divergence_address_atomic(boolean,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'),
  ('reconcile_physical_address_atomic','function','public.reconcile_physical_address_atomic(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'),
  ('reconcile_physical_address_atomic_with_deletes','function','public.reconcile_physical_address_atomic_with_deletes(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'),
  ('save_warehouse_layout_atomic','function','public.save_warehouse_layout_atomic(jsonb,jsonb)'),
  ('save_warehouse_positions_atomic','function','public.save_warehouse_positions_atomic(jsonb,jsonb)'),
  ('delete_warehouse_module','function','public.delete_warehouse_module(text,text)'),
  ('delete_warehouse_position','function','public.delete_warehouse_position(text,text,text)')
) AS x(item,kind,signature)
ORDER BY kind, item;

DO $diagnostic$
DECLARE
  v_count bigint;
  v_roles jsonb;
  v_catalog_count bigint;
  v_base_count bigint;
  v_override_count bigint;
  v_audit_count bigint;
  v_has_app_permission boolean;
  v_has_app_permissions boolean;
BEGIN
  RAISE NOTICE '=== PERFIS LOCAIS ===';
  IF pg_catalog.to_regclass('public.profiles') IS NULL THEN
    RAISE NOTICE 'profiles: AUSENTE';
  ELSE
    EXECUTE $q$SELECT pg_catalog.jsonb_object_agg(role, n) FROM (
      SELECT pg_catalog.lower(pg_catalog.btrim(role)) AS role, count(*) AS n
      FROM public.profiles GROUP BY 1 ORDER BY 1
    ) s$q$ INTO v_roles;
    RAISE NOTICE 'profiles por role: %', COALESCE(v_roles, '{}'::jsonb);
  END IF;

  RAISE NOTICE '=== FUNDACAO DE PERMISSOES B1/B2/B5 ===';
  IF pg_catalog.to_regclass('public.permission_catalog') IS NULL
     OR pg_catalog.to_regclass('public.role_permissions') IS NULL
     OR pg_catalog.to_regclass('public.user_permission_overrides') IS NULL
     OR pg_catalog.to_regclass('public.permission_change_audit') IS NULL THEN
    RAISE NOTICE 'Fundacao incompleta/ausente: uma ou mais tabelas de permissao nao existem.';
  ELSE
    EXECUTE 'SELECT count(*) FROM public.permission_catalog WHERE is_active' INTO v_catalog_count;
    EXECUTE 'SELECT count(*) FROM public.role_permissions' INTO v_base_count;
    EXECUTE 'SELECT count(*) FROM public.user_permission_overrides' INTO v_override_count;
    EXECUTE 'SELECT count(*) FROM public.permission_change_audit' INTO v_audit_count;
    RAISE NOTICE 'catalog_active=%, role_permission_rows=%, user_overrides=%, audit_events=%',
      v_catalog_count, v_base_count, v_override_count, v_audit_count;
  END IF;
  v_has_app_permission := pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NOT NULL;
  v_has_app_permissions := pg_catalog.to_regprocedure('public.has_app_permissions(text[])') IS NOT NULL;
  RAISE NOTICE 'has_app_permission(text)=%, has_app_permissions(text[])=%', v_has_app_permission, v_has_app_permissions;
END;
$diagnostic$;

SELECT 'WRITE_POLICY' AS section, schemaname, tablename, policyname, cmd,
       roles, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions','occupancy_history')
ORDER BY tablename, cmd, policyname;

SELECT 'CLIENT_DML_GRANT' AS section,
       table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('authenticated','anon')
  AND table_name IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions','occupancy_history')
  AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
ORDER BY table_name, grantee, privilege_type;
'@

Write-Host "`n=== CONSULTAS AO BANCO LOCAL ==="
docker exec $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off -c $sql
if ($LASTEXITCODE -ne 0) {
    throw "Diagnostico SQL falhou. Nenhuma alteracao foi solicitada; envie a saida completa."
}

Write-Host "`nDIAGNOSTICO CONCLUIDO. Nenhuma alteracao foi feita."
