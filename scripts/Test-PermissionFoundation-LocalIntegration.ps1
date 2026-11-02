[CmdletBinding()]
param(
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $scriptDirectory = $PSScriptRoot
    if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
        $scriptPath = $PSCommandPath
        if ([string]::IsNullOrWhiteSpace($scriptPath)) { $scriptPath = $MyInvocation.MyCommand.Path }
        if ([string]::IsNullOrWhiteSpace($scriptPath)) { throw 'Não foi possível determinar o caminho do script.' }
        $scriptDirectory = Split-Path -Parent $scriptPath
    }
    $ProjectRoot = Split-Path -Parent $scriptDirectory
}
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) { throw "Raiz inválida: $ProjectRoot" }

$TargetContainer = 'supabase_db_enderecamento-integracao-local'
$ExpectedComposeProject = 'enderecamento-integracao-local'
$ExpectedWorkdir = 'c:\testes\enderecamento_integracao_local'

function Stop-Safely([string]$Message) {
    Write-Host "`nBLOQUEADO: $Message" -ForegroundColor Red
    throw $Message
}

function Invoke-TargetQuery([string]$Sql, [string]$Label) {
    Write-Host "`n--- $Label ---" -ForegroundColor Cyan
    $lines = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -P pager=off -c $Sql 2>&1
    $exitCode = $LASTEXITCODE
    $joined = ($lines | ForEach-Object { "$_" }) -join "`n"
    if ($exitCode -ne 0) { Stop-Safely "Consulta '$Label' falhou:`n$joined" }
    $result = @($lines | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -ne '' })
    $result | ForEach-Object { Write-Host $_ }
    return $result
}

function Invoke-ExpectedAuthorizationDenial([string]$Sql, [string]$Label) {
    Write-Host "`n--- $Label (negação esperada) ---" -ForegroundColor Cyan
    $previousEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -P pager=off -c $Sql 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousEap }
    $joined = ($lines | ForEach-Object { "$_" }) -join "`n"
    if ($exitCode -eq 0 -or $joined -notmatch 'PERMISSION_ADMIN_REQUIRED') {
        Stop-Safely "A chamada deveria ser negada com PERMISSION_ADMIN_REQUIRED, mas o resultado foi inesperado:`n$joined"
    }
    Write-Host 'PASS: chamada recusada com PERMISSION_ADMIN_REQUIRED.' -ForegroundColor Green
}

Write-Host @"
ETAPA 03 — SMOKE TEST B1/B2 NO BANCO LOCAL DE INTEGRAÇÃO
Somente leitura e tentativas administrativas com payload vazio.
Não altera permissões, políticas de estoque nem grants operacionais.
Não inicia, reinicia ou remove containers e não acessa Supabase Cloud.
"@ -ForegroundColor Yellow

$inspectRaw = & docker inspect $TargetContainer 2>$null
if ($LASTEXITCODE -ne 0 -or -not $inspectRaw) { Stop-Safely "Container exato '$TargetContainer' não encontrado." }
$containerInfo = @($inspectRaw | ConvertFrom-Json)[0]
if ($containerInfo.State.Running -ne $true) { Stop-Safely 'O container alvo não está em execução; o script não vai iniciá-lo.' }
$labels = $containerInfo.Config.Labels
if ($labels.'com.docker.compose.project' -ne $ExpectedComposeProject) { Stop-Safely 'Label de projeto Docker inesperado.' }
$actualWorkdir = ([string]$labels.'com.supabase.cli.workdir').Replace('/', '\').TrimEnd('\').ToLowerInvariant()
if ($actualWorkdir -ne $ExpectedWorkdir) { Stop-Safely "Workdir inesperado: '$actualWorkdir'." }

$preflightSql = @'
SELECT 'CONNECTION|' || current_database() || '|' || current_setting('server_version');
SELECT 'CATALOG_COUNT|' || (SELECT count(*) FROM public.permission_catalog)::text;
SELECT 'ROLE_ROWS|' || (SELECT count(*) FROM public.role_permissions)::text;
SELECT 'DISTINCT_ROLE_ROWS|' || (SELECT count(DISTINCT (role, permission_key)) FROM public.role_permissions)::text;
SELECT 'ADMIN_COUNT|' || (SELECT count(*) FROM public.profiles WHERE lower(btrim(role))='administrador')::text;
SELECT 'PRODUCTION_COUNT|' || (SELECT count(*) FROM public.profiles WHERE lower(btrim(role))='producao')::text;
SELECT 'UNKNOWN_ROLE_COUNT|' || (SELECT count(*) FROM public.profiles WHERE lower(btrim(role)) NOT IN ('administrador','lideranca','apoio','producao','visualizador'))::text;
SELECT 'B1_FUNCTIONS|' || (pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NOT NULL AND pg_catalog.to_regprocedure('public.get_my_app_context()') IS NOT NULL AND pg_catalog.to_regprocedure('public.get_permission_admin_matrix()') IS NOT NULL)::text;
SELECT 'B2_FUNCTIONS|' || (pg_catalog.to_regprocedure('public.save_role_permission_changes(text,jsonb)') IS NOT NULL AND pg_catalog.to_regprocedure('public.save_user_permission_overrides(uuid,jsonb)') IS NOT NULL)::text;
'@
$rows = Invoke-TargetQuery $preflightSql 'Pré-requisitos B1/B2 e identidade do banco'
$values = @{}
foreach ($line in $rows) {
    $parts = $line -split '\|', 2
    if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] }
}
if ($values['CONNECTION'] -notmatch '^postgres\|') { Stop-Safely 'O banco não corresponde ao banco local postgres esperado.' }
if ($values['CATALOG_COUNT'] -ne '29' -or $values['ROLE_ROWS'] -ne '116' -or $values['DISTINCT_ROLE_ROWS'] -ne '116') { Stop-Safely 'Matriz B1 incompleta: esperadas 29 chaves e 116 linhas/grants distintos.' }
if ([int]$values['ADMIN_COUNT'] -lt 1 -or [int]$values['PRODUCTION_COUNT'] -lt 1) { Stop-Safely 'É necessário ao menos um administrador e um perfil producao para o smoke test.' }
if ($values['UNKNOWN_ROLE_COUNT'] -ne '0') { Stop-Safely 'Existem perfis com papel desconhecido; interrompido.' }
if ($values['B1_FUNCTIONS'] -ne 'true' -or $values['B2_FUNCTIONS'] -ne 'true') { Stop-Safely 'Uma ou mais RPCs B1/B2 estão ausentes.' }

$adminRows = Invoke-TargetQuery "SELECT id::text FROM public.profiles WHERE lower(btrim(role))='administrador' ORDER BY id LIMIT 1;" 'Selecionar perfil administrador local'
$productionRows = Invoke-TargetQuery "SELECT id::text FROM public.profiles WHERE lower(btrim(role))='producao' ORDER BY id LIMIT 1;" 'Selecionar perfil producao local'
$adminId = [string]($adminRows | Select-Object -Last 1)
$productionId = [string]($productionRows | Select-Object -Last 1)
if ($adminId -notmatch '^[0-9a-fA-F-]{36}$' -or $productionId -notmatch '^[0-9a-fA-F-]{36}$') { Stop-Safely 'Não foi possível selecionar IDs válidos de perfis locais.' }

$adminSql = @"
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '$adminId';
WITH ctx AS (SELECT public.get_my_app_context() AS data), matrix AS (SELECT public.get_permission_admin_matrix() AS data)
SELECT 'ADMIN_CONTEXT|' || (ctx.data #>> '{user,role}') || '|' || (ctx.data ->> 'active_permission_count') || '|' || public.has_app_permission('permissions.manage')::text || '|' || (matrix.data #>> '{matrix_status,active_permissions}') || '|' || (matrix.data #>> '{matrix_status,actual_role_permission_rows}') || '|' || (matrix.data #>> '{matrix_status,complete}') FROM ctx CROSS JOIN matrix;
SELECT 'INTERNAL_TABLE_ACL|' || has_table_privilege('authenticated','public.permission_catalog','SELECT')::text || '|' || has_table_privilege('authenticated','public.role_permissions','SELECT')::text;
ROLLBACK;
"@
$adminResult = Invoke-TargetQuery $adminSql 'Autorização administrativa e leitura da matriz via RPC'
$adminLine = $adminResult | Where-Object { $_ -match '^ADMIN_CONTEXT\|' } | Select-Object -Last 1
$adminParts = @(); if ($adminLine) { $adminParts = $adminLine -split '\|' }
if ($adminParts.Count -ne 7 -or $adminParts[1] -ne 'administrador' -or $adminParts[2] -ne '29' -or $adminParts[3] -ne 'true' -or $adminParts[4] -ne '29' -or $adminParts[5] -ne '116' -or $adminParts[6] -ne 'true') {
    Stop-Safely "Contexto/matriz do administrador fora do esperado: '$adminLine'."
}
$aclLine = $adminResult | Where-Object { $_ -match '^INTERNAL_TABLE_ACL\|' } | Select-Object -Last 1
if ($aclLine -ne 'INTERNAL_TABLE_ACL|false|false') { Stop-Safely "As tabelas internas parecem expostas diretamente: '$aclLine'." }
Write-Host 'PASS: Administrador consulta contexto/matriz; matriz 29/116 completa; tabelas internas não têm SELECT direto.' -ForegroundColor Green

$productionSql = @"
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '$productionId';
WITH ctx AS (SELECT public.get_my_app_context() AS data)
SELECT 'PRODUCTION_CONTEXT|' || (ctx.data #>> '{user,role}') || '|' || (ctx.data ->> 'matrix_complete') || '|' || (ctx.data ->> 'active_permission_count') || '|' || public.has_app_permission('permissions.manage')::text || '|' || public.has_app_permission('__permission_key_unknown__')::text || '|' || public.has_app_permission('stock.search')::text FROM ctx;
ROLLBACK;
"@
$productionResult = Invoke-TargetQuery $productionSql 'Autorização de leitura e negação por perfil producao'
$productionLine = $productionResult | Where-Object { $_ -match '^PRODUCTION_CONTEXT\|' } | Select-Object -Last 1
$prodParts = @(); if ($productionLine) { $prodParts = $productionLine -split '\|' }
if ($prodParts.Count -ne 7 -or $prodParts[1] -ne 'producao' -or $prodParts[2] -ne 'true' -or $prodParts[3] -ne '29' -or $prodParts[4] -ne 'false' -or $prodParts[5] -ne 'false' -or $prodParts[6] -ne 'true') {
    Stop-Safely "Contexto/permissões do perfil producao fora do esperado: '$productionLine'."
}
Write-Host 'PASS: Produção recebe 29 permissões, não gerencia permissões, chave desconhecida nega e stock.search permite.' -ForegroundColor Green

$denyMatrixSql = @"
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '$productionId'; SELECT public.get_permission_admin_matrix(); ROLLBACK;
"@
$denyRoleWriteSql = @"
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '$productionId'; SELECT public.save_role_permission_changes('apoio', '[]'::jsonb); ROLLBACK;
"@
$denyOverrideWriteSql = @"
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '$productionId'; SELECT public.save_user_permission_overrides('$adminId'::uuid, '[]'::jsonb); ROLLBACK;
"@
Invoke-ExpectedAuthorizationDenial $denyMatrixSql 'get_permission_admin_matrix para Produção'
Invoke-ExpectedAuthorizationDenial $denyRoleWriteSql 'save_role_permission_changes para Produção'
Invoke-ExpectedAuthorizationDenial $denyOverrideWriteSql 'save_user_permission_overrides para Produção'

Write-Host @"

SMOKE TEST B1/B2 APROVADO NO BANCO LOCAL.
Limite: este teste exerce o papel Postgres 'authenticated' e a claim auth.uid() de perfis locais; não testa login GoTrue nem o transporte REST/PostgREST.
Nenhuma permissão foi alterada; as consultas foram revertidas com ROLLBACK.
Ainda falta validar B6.1/B6.2A e as RPCs operacionais. Nada aqui autoriza publicação em produção.
"@ -ForegroundColor Green
