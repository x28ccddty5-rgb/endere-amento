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
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) { throw "Raiz do projeto inexistente: $ProjectRoot" }
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
    # Windows PowerShell 5.1 can turn native stderr (including PostgreSQL NOTICE)
    # into a terminating NativeCommandError when ErrorActionPreference=Stop.
    # Temporarily use Continue and capture both streams; always decide success by
    # the native process exit code, not by the presence of stderr text.
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -P pager=off -c $Sql 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousErrorActionPreference }
    $joined = ($lines | ForEach-Object { "$_" }) -join "`n"
    if ($exitCode -ne 0) { Stop-Safely "Consulta '$Label' falhou:`n$joined" }
    $result = @($lines | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -ne '' })
    $result | ForEach-Object { Write-Host $_ }
    return $result
}

function Invoke-TargetSqlFile([string]$LocalPath, [string]$Label) {
    if (-not (Test-Path -LiteralPath $LocalPath -PathType Leaf)) { Stop-Safely "Arquivo obrigatório não encontrado: $LocalPath" }
    $containerPath = "/tmp/phase03-$([IO.Path]::GetFileName($LocalPath))"
    Write-Host "`n--- $Label ---" -ForegroundColor Cyan
    & docker cp $LocalPath "${TargetContainer}:$containerPath" | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Safely "Falha ao copiar SQL para o container local." }
    try {
        # PostgreSQL NOTICE/WARNING messages go to stderr but are not necessarily
        # SQL failures. Do not let Windows PowerShell 5.1 abort before checking psql's
        # exit code. SQL errors still fail because ON_ERROR_STOP=1 returns nonzero.
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $output = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off -f $containerPath 2>&1
            $exitCode = $LASTEXITCODE
        }
        finally { $ErrorActionPreference = $previousErrorActionPreference }
        $output | ForEach-Object { Write-Host "$_" }
        if ($exitCode -ne 0) { Stop-Safely "'$Label' falhou. Não repita automaticamente; envie a saída integral para avaliar o estado parcial." }
    }
    finally { & docker exec $TargetContainer rm -f $containerPath | Out-Null }
}

Write-Host @"
ETAPA 03 — APLICAR B6.1/B6.2A SOMENTE NA INTEGRAÇÃO LOCAL
Alvo fixo: $TargetContainer
Não cria/inicia/reinicia/remove containers; não aceita URL remota; não acessa Supabase Cloud.
B6.1 troca apenas as três policies de escrita de products.
B6.2A cria uma RPC estreita de metadados; não revoga DML direto nem altera saldo/SKU.
"@ -ForegroundColor Yellow

$requiredFiles = @(
    'docs/sql/migrations/20261028010000_permission_foundation.sql',
    'docs/sql/migrations/20261028020000_permission_admin_write_rpcs.sql',
    'docs/sql/migrations/20261028060000_permission_product_mutations.sql',
    'docs/sql/20261028060000_permission_product_mutations_verify.sql',
    'docs/sql/rollback/20261028060000_rollback_permission_product_mutations.sql',
    'docs/sql/migrations/20261028070000_permission_slot_metadata_atomic.sql',
    'docs/sql/20261028070000_permission_slot_metadata_verify.sql',
    'docs/sql/rollback/20261028070000_rollback_permission_slot_metadata_atomic.sql'
)
foreach ($relative in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $relative) -PathType Leaf)) {
        Stop-Safely "Falta o arquivo requerido '$relative'. Nenhuma migration foi iniciada."
    }
}

$inspectRaw = & docker inspect $TargetContainer 2>$null
if ($LASTEXITCODE -ne 0 -or -not $inspectRaw) { Stop-Safely "Container exato '$TargetContainer' não encontrado; nenhum outro alvo será escolhido." }
$containerInfo = @($inspectRaw | ConvertFrom-Json)[0]
if ($containerInfo.State.Running -ne $true) { Stop-Safely 'Container alvo não está em execução; o script não vai iniciá-lo.' }
$labels = $containerInfo.Config.Labels
if ($labels.'com.docker.compose.project' -ne $ExpectedComposeProject) { Stop-Safely 'Label do projeto Docker não corresponde ao esperado.' }
$actualWorkdir = ([string]$labels.'com.supabase.cli.workdir').Replace('/', '\').TrimEnd('\').ToLowerInvariant()
if ($actualWorkdir -ne $ExpectedWorkdir) { Stop-Safely "Workdir não corresponde ao esperado: '$actualWorkdir'." }

$connection = Invoke-TargetQuery "SELECT 'CONNECTION|' || current_database() || '|' || current_setting('server_version');" 'Identificação da conexão'
if (-not ($connection | Where-Object { $_ -match '^CONNECTION\|postgres\|17\.' })) { Stop-Safely 'Banco ou versão não corresponde ao clone local esperado (postgres/PG17).'}

$preflightSql = @'
SELECT 'B1_TABLES|' || ((to_regclass('public.permission_catalog') IS NOT NULL AND to_regclass('public.role_permissions') IS NOT NULL AND to_regclass('public.user_permission_overrides') IS NOT NULL AND to_regclass('public.permission_change_audit') IS NOT NULL))::text;
SELECT 'B1_B2_FUNCTIONS|' || ((to_regprocedure('public.has_app_permission(text)') IS NOT NULL AND to_regprocedure('public.get_my_app_context()') IS NOT NULL AND to_regprocedure('public.get_permission_admin_matrix()') IS NOT NULL AND to_regprocedure('public.save_role_permission_changes(text,jsonb)') IS NOT NULL AND to_regprocedure('public.save_user_permission_overrides(uuid,jsonb)') IS NOT NULL))::text;
SELECT 'CATALOG_COUNT|' || (SELECT count(*) FROM public.permission_catalog)::text;
SELECT 'ROLE_ROWS|' || (SELECT count(*) FROM public.role_permissions)::text;
SELECT 'DISTINCT_ROLE_ROWS|' || (SELECT count(DISTINCT (role, permission_key)) FROM public.role_permissions)::text;
SELECT 'ADMIN_COUNT|' || (SELECT count(*) FROM public.profiles WHERE lower(btrim(role))='administrador')::text;
SELECT 'PRODUCTION_COUNT|' || (SELECT count(*) FROM public.profiles WHERE lower(btrim(role))='producao')::text;
SELECT 'LEGACY_LEADER_COUNT|' || (SELECT count(*) FROM public.profiles WHERE lower(btrim(role))='lideranca')::text;
SELECT 'UNKNOWN_ROLE_COUNT|' || (SELECT count(*) FROM public.profiles WHERE lower(btrim(role)) NOT IN ('administrador','lideranca','apoio','producao','visualizador'))::text;
SELECT 'PRODUCTS_TABLE|' || (to_regclass('public.products') IS NOT NULL)::text;
SELECT 'PRODUCTS_RLS|' || COALESCE((SELECT c.relrowsecurity::text FROM pg_class c WHERE c.oid=to_regclass('public.products')), 'missing');
SELECT 'PRODUCT_LEGACY_POLICIES|' || (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='products' AND policyname IN ('products_insert_management','products_update_management','products_delete_management'))::text;
SELECT 'PRODUCT_PERMISSION_POLICIES|' || (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='products' AND policyname IN ('products_insert_permission','products_update_permission','products_delete_permission'))::text;
SELECT 'PRODUCT_UNEXPECTED_WRITE_POLICIES|' || (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='products' AND cmd IN ('INSERT','UPDATE','DELETE','ALL') AND policyname NOT IN ('products_insert_management','products_update_management','products_delete_management','products_insert_permission','products_update_permission','products_delete_permission'))::text;
SELECT 'PRODUCT_SELECT_POLICY|' || (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='products' AND policyname='products_select_authenticated' AND cmd='SELECT')::text;
SELECT 'SLOTS_TABLE|' || (to_regclass('public.slots') IS NOT NULL)::text;
SELECT 'SLOT_REQUIRED_COLUMNS|' || (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.slots') AND attnum>0 AND NOT attisdropped AND attname IN ('id','estoque','modulo','posicao','referencia','descricao','saldo','dataChacote','galpao','restricao','observacao'))::text;
SELECT 'METADATA_RPC_EXISTS|' || (to_regprocedure('public.update_slot_metadata_atomic(jsonb,jsonb)') IS NOT NULL)::text;
'@
$preflightRows = Invoke-TargetQuery $preflightSql 'Pré-requisitos da fundação e estado atual de B6.1/B6.2A'
$values = @{}
foreach ($line in $preflightRows) { $parts = $line -split '\|', 2; if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] } }
foreach ($key in @('B1_TABLES','B1_B2_FUNCTIONS','PRODUCTS_TABLE','SLOTS_TABLE')) { if ($values[$key] -ne 'true') { Stop-Safely "Pré-requisito '$key' não confirmado." } }
if ($values['CATALOG_COUNT'] -ne '29' -or $values['ROLE_ROWS'] -ne '116' -or $values['DISTINCT_ROLE_ROWS'] -ne '116') { Stop-Safely 'A matriz B1 não é a esperada (29/116/116).'}
if ([int]$values['ADMIN_COUNT'] -lt 1 -or [int]$values['PRODUCTION_COUNT'] -lt 1) { Stop-Safely 'É necessário pelo menos um perfil administrador e um perfil producao.' }
if ($values['LEGACY_LEADER_COUNT'] -ne '0' -or $values['UNKNOWN_ROLE_COUNT'] -ne '0') { Stop-Safely 'Há perfil legado ou papel desconhecido; revise antes de migrar.' }
if ($values['PRODUCTS_RLS'] -ne 'true') { Stop-Safely 'RLS de products não está habilitado.' }
if ($values['PRODUCT_UNEXPECTED_WRITE_POLICIES'] -ne '0') { Stop-Safely 'Há policy de escrita de products inesperada; revisar antes de migrar.' }
if ($values['PRODUCT_SELECT_POLICY'] -ne '1') { Stop-Safely 'A policy de leitura products_select_authenticated não foi confirmada.' }
$legacyProductPolicies = [int]$values['PRODUCT_LEGACY_POLICIES']
$permissionProductPolicies = [int]$values['PRODUCT_PERMISSION_POLICIES']
$B61AlreadyApplied = $false
if ($legacyProductPolicies -eq 3 -and $permissionProductPolicies -eq 0) {
    $B61AlreadyApplied = $false
}
elseif ($legacyProductPolicies -eq 0 -and $permissionProductPolicies -eq 3) {
    # Recovery path: prior run may have committed B6.1 before PowerShell misread
    # the expected psql NOTICE as an error. Verify and continue without reapplying.
    $B61AlreadyApplied = $true
}
else {
    Stop-Safely "Estado parcial ou inesperado de B6.1 (legacy=$legacyProductPolicies; permission=$permissionProductPolicies). Não repetir nem fazer rollback automaticamente."
}
if ($values['SLOT_REQUIRED_COLUMNS'] -ne '11') { Stop-Safely "As 11 colunas necessárias de slots não foram confirmadas (encontradas: $($values['SLOT_REQUIRED_COLUMNS']))." }
if ($values['METADATA_RPC_EXISTS'] -ne 'false') { Stop-Safely 'A RPC de metadados já existe; este pacote não repetirá a migration.' }

$adminResult = Invoke-TargetQuery "SELECT id::text FROM public.profiles WHERE lower(btrim(role))='administrador' ORDER BY id LIMIT 1;" 'Selecionar perfil administrador local'
$productionResult = Invoke-TargetQuery "SELECT id::text FROM public.profiles WHERE lower(btrim(role))='producao' ORDER BY id LIMIT 1;" 'Selecionar perfil producao local'
$adminId = [string]($adminResult | Select-Object -Last 1)
$productionId = [string]($productionResult | Select-Object -Last 1)
if ($adminId -notmatch '^[0-9a-fA-F-]{36}$' -or $productionId -notmatch '^[0-9a-fA-F-]{36}$') { Stop-Safely 'Não foi possível selecionar IDs locais válidos.' }

Write-Host @"

ALVO VALIDADO
  Container: $TargetContainer
  Projeto:   $ExpectedComposeProject
  Workdir:   $actualWorkdir
  Banco:     postgres (local, PostgreSQL 17)
  Perfis de teste: administrador e producao

Estado B6.1: $(if ($B61AlreadyApplied) { 'já aplicada integralmente; será verificada e NÃO será reaplicada' } else { 'ainda não aplicada; será aplicada uma vez' })
Ordem:
  1. B6.1 — aplicar apenas se as três policies antigas existirem e as novas não
  2. Verificação SQL + teste de permissões por perfil
  3. B6.2A — RPC update_slot_metadata_atomic (só se ainda não existir)
  4. Verificação SQL + teste negativo de autorização (sem gravar dados)

Não serão revogados grants/DML de slots, history, divergencias ou produtos.
"@ -ForegroundColor Yellow
$confirmation = Read-Host 'Para confirmar a alteração SOMENTE neste banco local, digite exatamente APLICAR B6.1 B6.2A LOCAL'
if ($confirmation -cne 'APLICAR B6.1 B6.2A LOCAL') { Write-Host 'Cancelado. Nenhuma migration foi executada.' -ForegroundColor Yellow; exit 0 }

if (-not $B61AlreadyApplied) {
    Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/migrations/20261028060000_permission_product_mutations.sql') 'Aplicar B6.1 — permissões de escrita products'
}
else {
    Write-Host 'B6.1 já está aplicada integralmente; pulando reexecução da migration.' -ForegroundColor Yellow
}
Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/20261028060000_permission_product_mutations_verify.sql') 'Verificação SQL B6.1'

$postProductsSql = @'
SELECT 'PRODUCT_POLICY_STATE|' ||
  ((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='products' AND policyname IN ('products_insert_permission','products_update_permission','products_delete_permission'))=3)::text || '|' ||
  ((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='products' AND policyname IN ('products_insert_management','products_update_management','products_delete_management'))=0)::text || '|' ||
  ((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='products' AND policyname='products_select_authenticated' AND cmd='SELECT')=1)::text || '|' ||
  ((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='products' AND cmd IN ('INSERT','UPDATE','DELETE','ALL') AND policyname NOT IN ('products_insert_permission','products_update_permission','products_delete_permission'))=0)::text;
'@
$productPolicyRows = Invoke-TargetQuery $postProductsSql 'Validar estado final das policies products'
if (-not ($productPolicyRows | Where-Object { $_ -eq 'PRODUCT_POLICY_STATE|true|true|true|true' })) { Stop-Safely 'Estado final das policies products não corresponde ao contrato.' }

$adminPermissionSql = @"
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '$adminId';
SELECT 'ADMIN_PRODUCT_PERMS|' || public.has_app_permission('products.create')::text || '|' || public.has_app_permission('products.edit')::text || '|' || public.has_app_permission('products.delete_deactivate')::text;
ROLLBACK;
"@
$adminPermissionRows = Invoke-TargetQuery $adminPermissionSql 'Permissões products do administrador (transação revertida)'
if (-not ($adminPermissionRows | Where-Object { $_ -eq 'ADMIN_PRODUCT_PERMS|true|true|true' })) { Stop-Safely 'Administrador não recebeu as permissões de produto esperadas.' }
$productionPermissionSql = @"
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '$productionId';
SELECT 'PRODUCTION_PRODUCT_PERMS|' || public.has_app_permission('products.create')::text || '|' || public.has_app_permission('products.edit')::text || '|' || public.has_app_permission('products.delete_deactivate')::text;
ROLLBACK;
"@
$productionPermissionRows = Invoke-TargetQuery $productionPermissionSql 'Permissões products do perfil producao (transação revertida)'
if (-not ($productionPermissionRows | Where-Object { $_ -eq 'PRODUCTION_PRODUCT_PERMS|false|false|false' })) { Stop-Safely 'Perfil producao recebeu uma permissão de produto indevida.' }
Write-Host 'PASS: policies products e matriz de permissões verificadas.' -ForegroundColor Green

Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/migrations/20261028070000_permission_slot_metadata_atomic.sql') 'Aplicar B6.2A — RPC de metadados de slots'
Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/20261028070000_permission_slot_metadata_verify.sql') 'Verificação SQL B6.2A'

$functionState = Invoke-TargetQuery "SELECT 'METADATA_RPC_STATE|' || (to_regprocedure('public.update_slot_metadata_atomic(jsonb,jsonb)') IS NOT NULL)::text || '|' || has_function_privilege('authenticated','public.update_slot_metadata_atomic(jsonb,jsonb)','EXECUTE')::text || '|' || (NOT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl WHERE p.oid=to_regprocedure('public.update_slot_metadata_atomic(jsonb,jsonb)') AND acl.grantee=0 AND acl.privilege_type='EXECUTE'))::text;" 'Validar contrato de execução da RPC'
if (-not ($functionState | Where-Object { $_ -eq 'METADATA_RPC_STATE|true|true|true' })) { Stop-Safely 'Permissões de execução da RPC de metadados fora do esperado.' }

$productionDenySql = @"
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '$productionId';
DO `$smoke`$
DECLARE v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.update_slot_metadata_atomic('{}'::jsonb, '{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM = 'PERMISSION_DENIED:map.metadata.edit' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'SMOKE_FAILED_PRODUCTION_WAS_NOT_DENIED'; END IF;
END;
`$smoke`$;
ROLLBACK;
"@
$denyRows = Invoke-TargetQuery $productionDenySql 'Smoke test: metadados devem ser negados para producao'
if (-not ($denyRows | Where-Object { $_ -match '^DO$' })) { Stop-Safely 'Não foi possível confirmar a negação de edição de metadados para producao.' }

$adminValidationSql = @"
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '$adminId';
DO `$smoke`$
DECLARE v_validation_reached boolean := false;
BEGIN
  BEGIN
    PERFORM public.update_slot_metadata_atomic('{}'::jsonb, '{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM = 'INVALID_SLOT_METADATA_PAYLOAD' THEN v_validation_reached := true; ELSE RAISE; END IF;
  END;
  IF NOT v_validation_reached THEN RAISE EXCEPTION 'SMOKE_FAILED_ADMIN_DID_NOT_REACH_PAYLOAD_VALIDATION'; END IF;
END;
`$smoke`$;
ROLLBACK;
"@
$adminValidationRows = Invoke-TargetQuery $adminValidationSql 'Smoke test: administrador passa pela autorização e chega à validação de payload'
if (-not ($adminValidationRows | Where-Object { $_ -match '^DO$' })) { Stop-Safely 'Não foi possível confirmar a autorização/validação para administrador.' }

Write-Host @"

B6.1 E B6.2A APLICADAS E VERIFICADAS NO CLONE LOCAL.
B6.1: as três policies de escrita products verificam permissões; leitura preservada.
B6.2A: a RPC existe, authenticated pode executá-la, PUBLIC não pode; produção é negada e admin chega à validação do payload.
Os testes da RPC usaram payload vazio e ROLLBACK; nenhuma linha de estoque/produto foi alterada.
Nenhum grant DML de tabela foi revogado. Fluxos operacionais de estoque ainda exigem validação separada.
Nada neste resultado autoriza aplicar migrations ou publicar em produção.
"@ -ForegroundColor Green
