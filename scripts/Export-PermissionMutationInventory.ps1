$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$reportPath = Join-Path $root 'docs\seguranca\permission-mutation-inventory.txt'
$targetContainerName = 'supabase_db_enderecamento-integracao-local'

Write-Host "`n=== EXPORTACAO DE CONTRATOS DE MUTACAO - SOMENTE LEITURA ==="
Write-Host 'O script consulta exclusivamente o container local ja existente.'
Write-Host 'Nao cria, inicia, para, reinicia ou remove containers; nao executa DDL/DML; nao acessa projeto remoto.'

$runningContainers = @(& docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0) {
    throw 'Nao foi possivel consultar Docker. Pare aqui.'
}
$dbContainer = $runningContainers | Where-Object { $_ -eq $targetContainerName } | Select-Object -First 1
if (-not $dbContainer) {
    Write-Host "Container alvo ausente: $targetContainerName"
    Write-Host 'Containers relacionados disponiveis:'
    $runningContainers | Where-Object { $_ -match 'enderecamento' } | ForEach-Object { Write-Host " - $_" }
    throw 'Pare aqui. O script nao iniciara outro ambiente.'
}

$labels = & docker inspect --format '{{json .Config.Labels}}' $dbContainer
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel ler os metadados do container.' }

$sql = @'
SELECT 'CONNECTION' AS section, pg_catalog.row_to_json(x)::text AS payload
FROM (
  SELECT current_database() AS database_name, current_user AS database_user,
         inet_server_addr()::text AS server_addr, inet_server_port() AS server_port,
         version() AS postgres_version
) x;

SELECT 'PROFILE_ROLE_COUNTS' AS section,
       pg_catalog.jsonb_build_object('role', role, 'count', role_count)::text AS payload
FROM (
  SELECT pg_catalog.lower(pg_catalog.btrim(role)) AS role, count(*) AS role_count
  FROM public.profiles GROUP BY 1
) role_counts
ORDER BY role;

SELECT 'PERMISSION_FOUNDATION_OBJECT' AS section,
       pg_catalog.jsonb_build_object(
         'object', objects.object_name,
         'exists', CASE WHEN objects.object_kind = 'table' THEN pg_catalog.to_regclass('public.' || objects.object_name) IS NOT NULL
                        ELSE pg_catalog.to_regprocedure(objects.signature) IS NOT NULL END
       )::text AS payload
FROM (VALUES
  ('permission_catalog','table',NULL),
  ('role_permissions','table',NULL),
  ('user_permission_overrides','table',NULL),
  ('permission_change_audit','table',NULL),
  ('has_app_permission','function','public.has_app_permission(text)'),
  ('has_app_permissions','function','public.has_app_permissions(text[])'),
  ('get_my_app_context','function','public.get_my_app_context()')
) AS objects(object_name, object_kind, signature)
ORDER BY objects.object_kind, objects.object_name;

SELECT 'PROFILE_COLUMNS' AS section,
       pg_catalog.jsonb_build_object('column', column_name, 'data_type', data_type, 'nullable', is_nullable)::text AS payload
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;

SELECT 'ROLE_CONSTRAINTS' AS section,
       pg_catalog.jsonb_build_object('constraint', c.conname, 'definition', pg_catalog.pg_get_constraintdef(c.oid))::text AS payload
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'profiles' AND c.contype = 'c'
ORDER BY c.conname;

WITH expected(proname) AS (
  VALUES
    ('has_app_role'), ('has_app_permission'), ('has_app_permissions'), ('get_my_app_context'),
    ('apply_stock_mutation_atomic'), ('apply_stock_mutation_atomic_with_deletes'),
    ('process_shared_lancamento_draft_batch_atomic'), ('resolve_stock_divergence_atomic'),
    ('zero_physical_divergence_address_atomic'), ('reconcile_physical_address_atomic'),
    ('reconcile_physical_address_atomic_with_deletes'), ('save_warehouse_layout_atomic'),
    ('save_warehouse_positions_atomic'), ('delete_warehouse_module'), ('delete_warehouse_position'),
    ('get_shared_lancamento_draft'), ('get_shared_lancamento_batch_result')
)
SELECT 'EXPECTED_FUNCTION' AS section,
       pg_catalog.jsonb_build_object(
         'name', e.proname,
         'overloads', COALESCE((
           SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'signature', pg_catalog.pg_get_function_identity_arguments(p.oid),
             'return_type', pg_catalog.pg_get_function_result(p.oid),
             'language', l.lanname,
             'security_definer', p.prosecdef,
             'configuration', p.proconfig,
             'owner', pg_catalog.pg_get_userbyid(p.proowner),
             'execute_authenticated', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
             'execute_anon', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
             'definition', pg_catalog.pg_get_functiondef(p.oid)
           ) ORDER BY pg_catalog.pg_get_function_identity_arguments(p.oid))
           FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
           JOIN pg_catalog.pg_language l ON l.oid = p.prolang
           WHERE n.nspname = 'public' AND p.proname = e.proname AND p.prokind IN ('f','p')
         ), '[]'::jsonb)
       )::text AS payload
FROM expected e
ORDER BY e.proname;

SELECT 'RELATED_FUNCTION_METADATA' AS section,
       pg_catalog.jsonb_build_object(
         'name', p.proname,
         'signature', pg_catalog.pg_get_function_identity_arguments(p.oid),
         'return_type', pg_catalog.pg_get_function_result(p.oid),
         'language', l.lanname,
         'security_definer', p.prosecdef,
         'configuration', p.proconfig,
         'owner', pg_catalog.pg_get_userbyid(p.proowner),
         'execute_authenticated', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
         'execute_anon', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
       )::text AS payload
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.prokind IN ('f','p')
  AND p.proname ~ '(stock|diverg|warehouse|lancamento|occupancy|product|permission|snapshot)'
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

SELECT 'RLS_POLICY' AS section,
       pg_catalog.jsonb_build_object(
         'table', tablename, 'policy', policyname, 'command', cmd,
         'roles', roles, 'using', qual, 'with_check', with_check
       )::text AS payload
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions','occupancy_history','profiles')
ORDER BY tablename, policyname;

SELECT 'CLIENT_DML_GRANT' AS section,
       pg_catalog.jsonb_build_object(
         'table', table_name, 'grantee', grantee, 'privilege', privilege_type
       )::text AS payload
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('authenticated','anon')
  AND table_name IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions','occupancy_history','profiles')
  AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
ORDER BY table_name, grantee, privilege_type;

SELECT 'TRIGGER' AS section,
       pg_catalog.jsonb_build_object(
         'table', t.relname, 'trigger', tr.tgname,
         'enabled', tr.tgenabled, 'definition', pg_catalog.pg_get_triggerdef(tr.oid, true)
       )::text AS payload
FROM pg_catalog.pg_trigger tr
JOIN pg_catalog.pg_class t ON t.oid = tr.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND NOT tr.tgisinternal
  AND t.relname IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions','occupancy_history','profiles')
ORDER BY t.relname, tr.tgname;

SELECT 'MIGRATION_LEDGER_TABLE' AS section,
       pg_catalog.jsonb_build_object('schema', n.nspname, 'table', c.relname)::text AS payload
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'schema_migrations' AND n.nspname IN ('supabase_migrations','public')
ORDER BY n.nspname;
'@

Write-Host "`nAlvo confirmado: $dbContainer"
Write-Host 'Consultando metadados e definicoes das funcoes; nenhum comando de alteracao sera executado.'
$commandOutput = $sql | & docker exec -i $dbContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -P pager=off
if ($LASTEXITCODE -ne 0) {
    throw 'Consulta de inventario falhou. Nenhuma alteracao foi solicitada; envie a mensagem completa.'
}

$lines = @(
  'ENDERECAMENTO - INVENTARIO DE CONTRATOS PARA AUTORIZACAO DE MUTACOES',
  "Gerado em: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
  "Container: $dbContainer",
  "Docker labels: $labels",
  'Modo: somente leitura; definicoes de funcoes sao dados de catalogo, nao foram executadas.',
  '',
  ($commandOutput -join "`r`n")
)
Set-Content -LiteralPath $reportPath -Value $lines -Encoding UTF8
Write-Host "`nINVENTARIO CONCLUIDO. Arquivo criado:" $reportPath
Write-Host 'O arquivo contem definicoes de funcoes e metadados de seguranca, sem linhas de estoque nem segredos.'
