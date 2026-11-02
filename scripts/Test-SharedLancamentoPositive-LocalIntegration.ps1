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
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$TargetContainer = 'supabase_db_enderecamento-integracao-local'
$ExpectedComposeProject = 'enderecamento-integracao-local'
$ExpectedWorkdir = 'c:\testes\enderecamento_integracao_local'
$SqlRelativePath = 'docs/sql/20261029020000_shared_lancamento_positive_functional_smoke.sql'
$SqlLocalPath = Join-Path $ProjectRoot $SqlRelativePath

function Stop-Safely([string]$Message) {
  Write-Host "`nBLOQUEADO: $Message" -ForegroundColor Red
  throw $Message
}
function Invoke-TargetQuery([string]$Sql, [string]$Label) {
  Write-Host "`n--- $Label ---" -ForegroundColor Cyan
  $prev = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -P pager=off -c $Sql 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev }
  $joined = ($lines | ForEach-Object { "$_" }) -join "`n"
  if ($code -ne 0) { Stop-Safely "Consulta '$Label' falhou:`n$joined" }
  $out = @($lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne '' })
  $out | ForEach-Object { Write-Host $_ }
  return $out
}

Write-Host 'RUNNER_VERSION|SHARED-LANCAMENTO-POSITIVE-SMOKE-LOCAL-V1' -ForegroundColor Green
Write-Host 'TESTE POSITIVO DO LOTE COMPARTILHADO — SOMENTE BANCO LOCAL DE INTEGRAÇÃO' -ForegroundColor Yellow
Write-Host 'Usa o produto sintético TEST-CUTOVER-001 e o módulo E1 1, que deve permanecer vazio.'
Write-Host 'Executa uma Entrada de 1 peça, repete o mesmo batch_id e termina em ROLLBACK.'
Write-Host 'Não inicia/reinicia/remove containers, não acessa Supabase Cloud e não usa db push.'

if (-not (Test-Path -LiteralPath $SqlLocalPath -PathType Leaf)) { Stop-Safely "SQL positivo não encontrado: $SqlRelativePath" }
$inspectRaw = & docker inspect $TargetContainer 2>$null
if ($LASTEXITCODE -ne 0 -or -not $inspectRaw) { Stop-Safely "Container exato '$TargetContainer' não encontrado." }
$ci = @($inspectRaw | ConvertFrom-Json)[0]
if ($ci.State.Running -ne $true) { Stop-Safely 'Container alvo não está em execução; script não irá iniciá-lo.' }
$labels = $ci.Config.Labels
if ($labels.'com.docker.compose.project' -ne $ExpectedComposeProject) { Stop-Safely 'Label do projeto Docker diferente.' }
$wd = ([string]$labels.'com.supabase.cli.workdir').Replace('/','\').TrimEnd('\').ToLowerInvariant()
if ($wd -ne $ExpectedWorkdir) { Stop-Safely "Workdir inesperado: $wd" }

$conn = Invoke-TargetQuery "SELECT 'CONNECTION|'||current_database()||'|'||current_setting('server_version');" 'Identificação da conexão'
if (-not ($conn | Where-Object { $_ -match '^CONNECTION\|postgres\|17\.' })) { Stop-Safely 'Banco/versão não corresponde a postgres/PG17.' }

$preflightSql = @'
SELECT 'SHARED_RPC_SET|'||(
  to_regprocedure('public.get_shared_lancamento_draft()') IS NOT NULL
  AND to_regprocedure('public.upsert_shared_lancamento_draft_lines(uuid,jsonb)') IS NOT NULL
  AND to_regprocedure('public.get_shared_lancamento_batch_result(uuid)') IS NOT NULL
  AND to_regprocedure('public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])') IS NOT NULL
)::text;
SELECT 'TYPED_LAUNCH_WRITER|'||(
  to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NOT NULL
)::text;
SELECT 'SYNTHETIC_PRODUCT|'||(count(*) = 1)::text
FROM public.products
WHERE upper(btrim(referencia))='TEST-CUTOVER-001'
  AND nullif(btrim(descricao),'') IS NOT NULL;
SELECT 'E1_MODULE_1_EMPTY|'||(
  NOT EXISTS (SELECT 1 FROM public.slots WHERE estoque='1' AND modulo='1')
  AND NOT EXISTS (SELECT 1 FROM public.history WHERE estoque='1' AND modulo='1')
  AND NOT EXISTS (SELECT 1 FROM public.divergencias WHERE estoque='1' AND modulo='1')
)::text;
SELECT 'E1_MODULE_1_ACTIVE|'||(
  NOT EXISTS (SELECT 1 FROM public.warehouse_layout WHERE estoque='1')
  OR EXISTS (SELECT 1 FROM public.warehouse_layout WHERE estoque='1' AND btrim(modulo)='1' AND ativo IS TRUE)
)::text;
SELECT 'SHARED_DRAFT_CONTROL|'||(
  EXISTS (SELECT 1 FROM public.lancamento_draft_control WHERE singleton IS TRUE)
)::text;
'@
$preflight = Invoke-TargetQuery $preflightSql 'Pré-requisitos do lançamento positivo'
foreach ($required in @(
  'SHARED_RPC_SET|true',
  'TYPED_LAUNCH_WRITER|true',
  'SYNTHETIC_PRODUCT|true',
  'E1_MODULE_1_EMPTY|true',
  'E1_MODULE_1_ACTIVE|true',
  'SHARED_DRAFT_CONTROL|true'
)) {
  if (-not ($preflight | Where-Object { $_ -eq $required })) { Stop-Safely "Pré-requisito não confirmado: $required. Nenhum teste foi iniciado." }
}

$adminRows = Invoke-TargetQuery "SELECT id::text FROM public.profiles WHERE lower(btrim(role))='administrador' AND coalesce(btrim(name),'')<>'' ORDER BY id LIMIT 1;" 'Identificação do administrador local'
$adminId = @($adminRows | Where-Object { $_ -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' } | Select-Object -First 1)
if ($adminId.Count -ne 1) { Stop-Safely 'Não foi possível identificar exatamente um administrador local válido.' }

$containerSqlPath = '/tmp/shared-lancamento-positive-functional-smoke.sql'
Write-Host "`nADMIN_ID|$($adminId[0])"
Write-Host "`n--- Executar entrada positiva sintética e idempotência ---" -ForegroundColor Cyan
& docker cp $SqlLocalPath "${TargetContainer}:$containerSqlPath" | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Safely 'Falha ao copiar SQL positivo para o container local.' }
try {
  $prev = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v "admin_id=$($adminId[0])" -P pager=off -f $containerSqlPath 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev }
  $output | ForEach-Object { Write-Host "$_" }
  if ($code -ne 0) { Stop-Safely 'Teste positivo falhou. O psql encerrará a conexão e reverterá a transação aberta. Não repita antes de revisar a saída.' }
  if (-not ($output | Where-Object { "$_" -match 'PASS_SHARED_BATCH_POSITIVE_SMOKE_ROLLED_BACK_NO_PERSISTENT_DATA' })) {
    Stop-Safely 'A transação terminou sem a confirmação pós-ROLLBACK esperada.'
  }
} finally {
  & docker exec $TargetContainer rm -f $containerSqlPath | Out-Null
}
Write-Host "`nPASS: entrada positiva sintética, auditoria, idempotência e rollback validados no clone local." -ForegroundColor Green
