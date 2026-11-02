[CmdletBinding()]
param([string]$ProjectRoot)

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
$SqlPath = Join-Path $ProjectRoot 'docs/sql/20261028070000_permission_slot_metadata_rollback_smoke.sql'
$RunnerVersion = 'RPC-METADATA-SMOKE-V2-JSON-KEY'
$Marker = '__ETAPA03_RPC_ROLLBACK_SMOKE__'

function Stop-Safely([string]$Message) {
    Write-Host "`nBLOQUEADO: $Message" -ForegroundColor Red
    throw $Message
}
function Invoke-TargetQuery([string]$Sql, [string]$Label) {
    Write-Host "`n--- $Label ---" -ForegroundColor Cyan
    $oldEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -P pager=off -c $Sql 2>&1
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldEap }
    $joined = ($lines | ForEach-Object { "$_" }) -join "`n"
    if ($exitCode -ne 0) { Stop-Safely "Consulta '$Label' falhou:`n$joined" }
    $result = @($lines | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -ne '' })
    $result | ForEach-Object { Write-Host $_ }
    return $result
}

Write-Host "RUNNER_VERSION|$RunnerVersion" -ForegroundColor Cyan
Write-Host @"
ETAPA 03 — TESTE DE SUCESSO DA RPC B6.2A COM ROLLBACK (RUNNER V2)
Alvo fixo: $TargetContainer
O teste modifica temporariamente somente observacao de um slot válido e reverte tudo com ROLLBACK.
Produção deve ser negada; administrador deve atualizar apenas metadados.
Não altera container, migrations, policies, grants, saldos, SKU nem histórico de forma persistente.
Não acessa Supabase Cloud.
"@ -ForegroundColor Yellow

if (-not (Test-Path -LiteralPath $SqlPath -PathType Leaf)) { Stop-Safely "SQL obrigatório ausente: $SqlPath" }
$inspectRaw = & docker inspect $TargetContainer 2>$null
if ($LASTEXITCODE -ne 0 -or -not $inspectRaw) { Stop-Safely "Container exato '$TargetContainer' não encontrado." }
$containerInfo = @($inspectRaw | ConvertFrom-Json)[0]
if ($containerInfo.State.Running -ne $true) { Stop-Safely 'Container alvo não está em execução; o script não vai iniciá-lo.' }
$labels = $containerInfo.Config.Labels
if ($labels.'com.docker.compose.project' -ne $ExpectedComposeProject) { Stop-Safely 'Label do projeto Docker inesperado.' }
$actualWorkdir = ([string]$labels.'com.supabase.cli.workdir').Replace('/', '\').TrimEnd('\').ToLowerInvariant()
if ($actualWorkdir -ne $ExpectedWorkdir) { Stop-Safely "Workdir inesperado: '$actualWorkdir'." }

$preflightSql = @"
SELECT 'CONNECTION|' || current_database() || '|' || current_setting('server_version');
SELECT 'FOUNDATION|' || (to_regprocedure('public.has_app_permission(text)') IS NOT NULL AND to_regprocedure('public.get_my_app_context()') IS NOT NULL)::text;
SELECT 'CATALOG|' || (SELECT count(*) FROM public.permission_catalog)::text || '|' || (SELECT count(*) FROM public.role_permissions)::text || '|' || (SELECT count(DISTINCT (role,permission_key)) FROM public.role_permissions)::text;
SELECT 'METADATA_RPC|' || (to_regprocedure('public.update_slot_metadata_atomic(jsonb,jsonb)') IS NOT NULL)::text;
SELECT 'ADMIN_ID|' || id::text FROM public.profiles WHERE lower(btrim(role))='administrador' ORDER BY id LIMIT 1;
SELECT 'PRODUCTION_ID|' || id::text FROM public.profiles WHERE lower(btrim(role))='producao' ORDER BY id LIMIT 1;
SELECT 'ELIGIBLE_SLOTS|' || count(*)::text FROM public.slots s WHERE s.galpao::text IN ('3','12') AND s.restricao::text IN ('nenhuma','teste','autorizacao','outra') AND (s.galpao::text <> '12' OR s.restricao::text='autorizacao') AND (coalesce(to_jsonb(s)->>'dataChacote','') IN ('','NT') OR coalesce(to_jsonb(s)->>'dataChacote','') ~ '^\d{2}/\d{2}/\d{4}$');
SELECT 'MARKER_COUNT|' || count(*)::text FROM public.slots WHERE observacao::text = '$Marker';
"@
$preflightRows = Invoke-TargetQuery $preflightSql 'Pré-requisitos do teste transacional local'
$values = @{}
foreach ($line in $preflightRows) {
    $parts = $line -split '\|', 2
    if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] }
}
if ($values['CONNECTION'] -notmatch '^postgres\|17\.') { Stop-Safely 'Banco/versão inesperado; esperado postgres/PostgreSQL 17.' }
if ($values['FOUNDATION'] -ne 'true' -or $values['CATALOG'] -ne '29|116|116') { Stop-Safely 'Fundação B1 incompleta.' }
if ($values['METADATA_RPC'] -ne 'true') { Stop-Safely 'RPC B6.2A ausente; aplique e verifique a migration antes deste teste.' }
if ($values['ADMIN_ID'] -notmatch '^[0-9a-fA-F-]{36}$' -or $values['PRODUCTION_ID'] -notmatch '^[0-9a-fA-F-]{36}$') { Stop-Safely 'Perfis de administrador/produção não identificados.' }
if ([int]$values['ELIGIBLE_SLOTS'] -lt 1) { Stop-Safely 'Não há slot com metadados atuais válidos para testar a RPC; nada será alterado.' }
if ($values['MARKER_COUNT'] -ne '0') { Stop-Safely 'Marcador de teste já existe nos dados; não é seguro prosseguir.' }

Write-Host "`nALVO VALIDADO: $TargetContainer / banco postgres / PostgreSQL 17" -ForegroundColor Green
Write-Host 'Teste: Produção deve receber PERMISSION_DENIED; administrador deve concluir UPDATE e preservar todos os demais campos.'
Write-Host 'Todas as alterações de teste ficam dentro de transações que terminam em ROLLBACK.'
$confirmation = Read-Host 'Para executar o teste transacional SOMENTE neste banco local, digite exatamente TESTAR RPC METADADOS COM ROLLBACK LOCAL'
if ($confirmation -cne 'TESTAR RPC METADADOS COM ROLLBACK LOCAL') { Stop-Safely 'Confirmação não recebida. Nada foi executado.' }

$containerSqlPath = '/tmp/phase03-20261028070000_permission_slot_metadata_rollback_smoke.sql'
& docker cp $SqlPath "${TargetContainer}:$containerSqlPath" | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Safely 'Falha ao copiar o SQL de smoke test para o container local.' }
try {
    Write-Host "`n--- Executar teste com claims locais e ROLLBACK ---" -ForegroundColor Cyan
    $oldEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v "admin_id=$($values['ADMIN_ID'])" -v "production_id=$($values['PRODUCTION_ID'])" -v "marker=$Marker" -P pager=off -f $containerSqlPath 2>&1
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldEap }
    $joined = ($output | ForEach-Object { "$_" }) -join "`n"
    $output | ForEach-Object { Write-Host "$_" }
    if ($exitCode -ne 0) { Stop-Safely "Teste transacional falhou. A conexão fará rollback da transação aberta; não repita sem revisar a saída:`n$joined" }
    foreach ($expected in @('PASS_PRODUCTION_DENIED','PASS_ADMIN_METADATA_UPDATED','PASS_NON_METADATA_FIELDS_UNCHANGED','PASS_MARKER_VISIBLE_BEFORE_ROLLBACK','ROLLBACK')) {
        if ($joined -notmatch [regex]::Escape($expected)) { Stop-Safely "Saída não confirmou '$expected'. Não declare o teste aprovado:`n$joined" }
    }
} finally { & docker exec $TargetContainer rm -f $containerSqlPath | Out-Null }

$finalChecks = Invoke-TargetQuery "SELECT 'MARKER_COUNT_AFTER_ROLLBACK|' || count(*)::text FROM public.slots WHERE observacao::text = '$Marker';" 'Verificar ausência de marcador persistido'
if (-not ($finalChecks -contains 'MARKER_COUNT_AFTER_ROLLBACK|0')) { Stop-Safely 'O marcador de teste persistiu após ROLLBACK; interrompa e investigue.' }
Write-Host "`nPASS: B6.2A executou atualização real dentro da transação, preservou campos não editáveis, negou Produção e reverteu o marcador." -ForegroundColor Green
Write-Host 'Limite: teste local via papel/claims PostgreSQL; não testa login GoTrue/REST nem fluxos operacionais completos.' -ForegroundColor Yellow
Write-Host 'Não autoriza revogar DML direto nem publicar em produção.' -ForegroundColor Yellow
