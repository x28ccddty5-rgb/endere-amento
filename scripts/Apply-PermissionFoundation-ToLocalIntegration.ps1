[CmdletBinding()]
param(
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'

# PowerShell can evaluate parameter defaults before $PSScriptRoot is populated.
# Resolve the default only after parameter binding, with fallbacks for -File calls.
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $scriptDirectory = $PSScriptRoot

    if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
        $scriptPath = $PSCommandPath
        if ([string]::IsNullOrWhiteSpace($scriptPath)) {
            $scriptPath = $MyInvocation.MyCommand.Path
        }
        if ([string]::IsNullOrWhiteSpace($scriptPath)) {
            throw 'Não foi possível determinar o caminho do script. Informe -ProjectRoot explicitamente.'
        }
        $scriptDirectory = Split-Path -Parent $scriptPath
    }

    $ProjectRoot = Split-Path -Parent $scriptDirectory
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "A raiz do projeto não existe: $ProjectRoot"
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$TargetContainer = 'supabase_db_enderecamento-integracao-local'
$ExpectedComposeProject = 'enderecamento-integracao-local'
$ExpectedWorkdir = 'c:\testes\enderecamento_integracao_local'

function Stop-Safely([string]$Message) {
    Write-Host "`nBLOQUEADO: $Message" -ForegroundColor Red
    throw $Message
}

function Invoke-TargetQuery([string]$Sql, [string]$Label) {
    Write-Host "`n--- $Label ---" -ForegroundColor Cyan
    $result = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -P pager=off -c $Sql
    if ($LASTEXITCODE -ne 0) {
        Stop-Safely "A consulta '$Label' falhou. Nenhuma nova migration será iniciada nesta execução."
    }
    return @($result | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -ne '' })
}

function Invoke-TargetSqlFile([string]$LocalPath, [string]$Label) {
    if (-not (Test-Path -LiteralPath $LocalPath -PathType Leaf)) {
        Stop-Safely "Arquivo obrigatório não encontrado: $LocalPath"
    }

    $containerPath = "/tmp/phase03-$([IO.Path]::GetFileName($LocalPath))"
    Write-Host "`n--- $Label ---" -ForegroundColor Cyan
    & docker cp $LocalPath "${TargetContainer}:$containerPath"
    if ($LASTEXITCODE -ne 0) {
        Stop-Safely "Não foi possível copiar o arquivo SQL de trabalho para o container local."
    }

    try {
        & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off -f $containerPath
        if ($LASTEXITCODE -ne 0) {
            Stop-Safely "'$Label' falhou. Não repita automaticamente: envie a saída integral e identifique quais etapas concluíram."
        }
    }
    finally {
        & docker exec $TargetContainer rm -f $containerPath | Out-Null
    }
}

Write-Host @"
ETAPA 03 — APLICAR B1/B2 SOMENTE NA INTEGRAÇÃO LOCAL
O script NÃO cria, inicia, reinicia ou remove containers.
O script NÃO aceita URL remota e não acessa Supabase Cloud.
A aplicação de B1/B2 cria objetos de autorização no banco local.
"@ -ForegroundColor Yellow

$requiredFiles = @(
    'docs/sql/migrations/20261028010000_permission_foundation.sql',
    'docs/sql/20261028010000_permission_foundation_verify.sql',
    'docs/sql/migrations/20261028020000_permission_admin_write_rpcs.sql',
    'docs/sql/20261028020000_permission_write_rpcs_verify.sql'
)
foreach ($relative in $requiredFiles) {
    $path = Join-Path $ProjectRoot $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Stop-Safely "Falta o arquivo requerido '$relative'. A aplicação foi interrompida antes de qualquer alteração."
    }
}

$inspectRaw = & docker inspect $TargetContainer 2>$null
if ($LASTEXITCODE -ne 0 -or -not $inspectRaw) {
    Stop-Safely "O container exato '$TargetContainer' não existe ou não pode ser inspecionado. Nenhum outro container será escolhido automaticamente."
}
$containerInfo = @($inspectRaw | ConvertFrom-Json)[0]
if ($containerInfo.State.Running -ne $true) {
    Stop-Safely "O container alvo não está em execução. O script não vai iniciá-lo."
}
$labels = $containerInfo.Config.Labels
if ($labels.'com.docker.compose.project' -ne $ExpectedComposeProject) {
    Stop-Safely "O label de projeto Docker não corresponde a '$ExpectedComposeProject'."
}
$actualWorkdir = ([string]$labels.'com.supabase.cli.workdir').Replace('/', '\').TrimEnd('\').ToLowerInvariant()
if ($actualWorkdir -ne $ExpectedWorkdir) {
    Stop-Safely "O diretório do projeto Docker não corresponde ao caminho local esperado. Encontrado: '$actualWorkdir'."
}

$connection = Invoke-TargetQuery "SELECT 'CONNECTION|' || current_database() || '|' || COALESCE(inet_server_port()::text, 'null') || '|' || current_setting('server_version');" 'Identificação da conexão'
$connection | ForEach-Object { Write-Host $_ }
if (-not ($connection | Where-Object { $_ -match '^CONNECTION\|postgres\|' })) {
    Stop-Safely 'A base conectada não é a base local postgres esperada.'
}

$preflightSql = @'
SELECT 'PROFILES_TABLE|' || (pg_catalog.to_regclass('public.profiles') IS NOT NULL)::text;
SELECT 'AUTH_UID|' || (pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL)::text;
SELECT 'ANON_ROLE|' || EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon')::text;
SELECT 'AUTHENTICATED_ROLE|' || EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated')::text;
SELECT 'PROFILE_COLUMNS|' || (SELECT count(*)=4 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('id','role','username','name'))::text;
SELECT 'ADMIN_COUNT|' || (SELECT count(*) FROM public.profiles WHERE lower(btrim(role))='administrador')::text;
SELECT 'LEGACY_LEADER_COUNT|' || (SELECT count(*) FROM public.profiles WHERE lower(btrim(role))='lideranca')::text;
SELECT 'UNKNOWN_ROLE_COUNT|' || (SELECT count(*) FROM public.profiles WHERE lower(btrim(role)) NOT IN ('administrador','lideranca','apoio','producao','visualizador'))::text;
SELECT 'PERMISSION_TABLES_EXIST|' || (
  pg_catalog.to_regclass('public.permission_catalog') IS NOT NULL OR
  pg_catalog.to_regclass('public.role_permissions') IS NOT NULL OR
  pg_catalog.to_regclass('public.user_permission_overrides') IS NOT NULL OR
  pg_catalog.to_regclass('public.permission_change_audit') IS NOT NULL)::text;
SELECT 'PERMISSION_FUNCTIONS_EXIST|' || (
  pg_catalog.to_regprocedure('public.has_app_permission(text)') IS NOT NULL OR
  pg_catalog.to_regprocedure('public.get_my_app_context()') IS NOT NULL OR
  pg_catalog.to_regprocedure('public.get_permission_admin_matrix()') IS NOT NULL OR
  pg_catalog.to_regprocedure('public.save_role_permission_changes(text,jsonb)') IS NOT NULL OR
  pg_catalog.to_regprocedure('public.save_user_permission_overrides(uuid,jsonb)') IS NOT NULL)::text;
'@
$preflightRows = Invoke-TargetQuery $preflightSql 'Pré-requisitos e ausência de instalação parcial'
$preflightRows | ForEach-Object { Write-Host $_ }
$values = @{}
foreach ($line in $preflightRows) {
    $parts = $line -split '\|', 2
    if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] }
}
foreach ($key in @('PROFILES_TABLE','AUTH_UID','ANON_ROLE','AUTHENTICATED_ROLE','PROFILE_COLUMNS')) {
    if ($values[$key] -ne 'true') { Stop-Safely "Pré-requisito '$key' não confirmado. Nenhuma migration foi iniciada." }
}
if ([int]$values['ADMIN_COUNT'] -lt 1) { Stop-Safely 'Não existe perfil administrador na base alvo.' }
if ([int]$values['LEGACY_LEADER_COUNT'] -ne 0) { Stop-Safely 'Existe perfil legado lideranca. Não migre até revisar a regra de legado.' }
if ([int]$values['UNKNOWN_ROLE_COUNT'] -ne 0) { Stop-Safely 'Existe perfil com papel desconhecido. Não migre até revisar os papéis.' }
if ($values['PERMISSION_TABLES_EXIST'] -ne 'false' -or $values['PERMISSION_FUNCTIONS_EXIST'] -ne 'false') {
    Stop-Safely 'A fundação está parcialmente ou totalmente instalada. Este script não é idempotente e não repetirá migrations.'
}

Write-Host @"

ALVO VALIDADO:
  Container: $TargetContainer
  Projeto:   $ExpectedComposeProject
  Workdir:   $actualWorkdir
  Banco:     postgres (local)

Será executado, nesta ordem:
  1. B1: docs/sql/migrations/20261028010000_permission_foundation.sql
  2. Verificação B1
  3. B2: docs/sql/migrations/20261028020000_permission_admin_write_rpcs.sql
  4. Verificação B2

Nenhuma policy operacional nem grant de DML de estoque será alterado por este pacote.
"@ -ForegroundColor Yellow

$confirmation = Read-Host "Para confirmar que deseja alterar ESSE BANCO LOCAL, digite exatamente APLICAR B1 B2 LOCAL"
if ($confirmation -cne 'APLICAR B1 B2 LOCAL') {
    Write-Host 'Cancelado. Nenhuma migration foi executada.' -ForegroundColor Yellow
    exit 0
}

Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/migrations/20261028010000_permission_foundation.sql') 'Aplicar migration B1'
Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/20261028010000_permission_foundation_verify.sql') 'Verificar B1'
Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/migrations/20261028020000_permission_admin_write_rpcs.sql') 'Aplicar migration B2'
Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/20261028020000_permission_write_rpcs_verify.sql') 'Verificar B2'

Write-Host @"

B1/B2 aplicadas e scripts de verificação concluídos no banco local alvo.
Este resultado NÃO autoriza aplicar migrations no Supabase de produção.
Próxima etapa: smoke test autenticado das RPCs e depois validar B6.1/B6.2A no clone.
"@ -ForegroundColor Green
