[CmdletBinding()]
param([string]$ProjectRoot)
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $scriptDirectory = $PSScriptRoot
  if ([string]::IsNullOrWhiteSpace($scriptDirectory)) { throw 'Não foi possível determinar a pasta do script.' }
  $ProjectRoot = Split-Path -Parent $scriptDirectory
}
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) { throw "Raiz do projeto inexistente: $ProjectRoot" }
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)

$TargetContainer = 'supabase_db_enderecamento-integracao-local'
$ExpectedComposeProject = 'enderecamento-integracao-local'
$ExpectedWorkdir = 'c:\testes\enderecamento_integracao_local'
$SqlRelative = 'docs/sql/20261029030000_shared_lancamento_concurrency_recovery_failed_run.sql'
$SqlPath = Join-Path $ProjectRoot $SqlRelative
$DockerExe = (Get-Command docker.exe -ErrorAction Stop).Source
$containerSql = '/tmp/shared-lancamento-concurrency-recovery.sql'

if (-not (Test-Path -LiteralPath $SqlPath -PathType Leaf)) { throw "SQL de recuperação não encontrado: $SqlPath" }
$inspectRaw = & $DockerExe inspect $TargetContainer 2>$null
if ($LASTEXITCODE -ne 0 -or -not $inspectRaw) { throw "Container exato '$TargetContainer' não encontrado." }
$containerInfo = @($inspectRaw | ConvertFrom-Json)[0]
if ($containerInfo.State.Running -ne $true) { throw 'Container alvo não está em execução; o script não irá iniciá-lo.' }
$labels = $containerInfo.Config.Labels
if ($labels.'com.docker.compose.project' -ne $ExpectedComposeProject) { throw 'Label do projeto Docker diferente.' }
$workdir = ([string]$labels.'com.supabase.cli.workdir').Replace('/','\').TrimEnd('\').ToLowerInvariant()
if ($workdir -ne $ExpectedWorkdir) { throw "Workdir inesperado: $workdir" }

$preflightSql = @'
SELECT 'CONNECTION|' || current_database() || '|' || current_setting('server_version');
SELECT 'ACTIVE_TEST_SESSIONS|' || count(*)::text
FROM pg_stat_activity
WHERE application_name IN ('shared_batch_concurrency_a','shared_batch_concurrency_b')
  AND pid <> pg_backend_pid();
SELECT 'ROWS|' ||
 (SELECT count(*)::text FROM public.slots WHERE id='1-1-TEST-CUTOVER-001') || '|' ||
 (SELECT count(*)::text FROM public.history WHERE id='MOV-ROW-SHARED-CONCURRENCY-001-SYNTH') || '|' ||
 (SELECT count(*)::text FROM public.divergencias WHERE estoque='1' AND modulo='1') || '|' ||
 (SELECT count(*)::text FROM public.lancamento_batch_runs WHERE batch_id='b7a10000-0000-4000-8000-000000000002'::uuid) || '|' ||
 (SELECT count(*)::text FROM public.lancamento_draft_archive_lines WHERE line_id='ROW-SHARED-CONCURRENCY-001') || '|' ||
 (SELECT count(*)::text FROM public.lancamento_draft_lines);
SELECT 'CONTROL|' || generation_id::text || '|' || revision::text || '|' || next_sequence::text || '|' || coalesce(updated_by::text,'NULL') || '|' || updated_at::text
FROM public.lancamento_draft_control WHERE singleton IS TRUE;
SELECT 'TABLE_COUNTS|' || (SELECT count(*)::text FROM public.lancamento_batch_runs) || '|' || (SELECT count(*)::text FROM public.lancamento_draft_archive_lines);
'@
$preflight = & $DockerExe exec $TargetContainer psql -X -U postgres -d postgres -A -t -P pager=off -v ON_ERROR_STOP=1 -c $preflightSql
if ($LASTEXITCODE -ne 0) { throw 'Pré-verificação somente leitura falhou; nenhuma alteração foi realizada.' }
$preflight | ForEach-Object { Write-Host $_ }
$values = @($preflight | ForEach-Object { "$($_)".Trim() })
if (-not ($values -contains 'CONNECTION|postgres|17.6')) { throw 'Alvo não corresponde ao PostgreSQL 17.6 esperado.' }
if (-not ($values -contains 'ACTIVE_TEST_SESSIONS|0')) { throw 'Existe sessão do teste ativa; recuperação bloqueada.' }
if (-not ($values -contains 'ROWS|1|1|0|1|1|0')) { throw 'As linhas não correspondem exatamente aos resíduos sintéticos conhecidos; recuperação bloqueada.' }
if (-not ($values -contains 'CONTROL|74e51f01-e794-4140-8480-3a7221d7db26|0|1|01f519c5-108b-4706-a10b-e8782f4fe079|2026-10-30 02:22:54.348236+00')) { throw 'Controle compartilhado mudou desde a inspeção; recuperação bloqueada.' }
if (-not ($values -contains 'TABLE_COUNTS|1|1')) { throw 'Contagens globais inesperadas; recuperação bloqueada.' }

Write-Host 'RECOVERY_TARGET|LOCAL_INTEGRATION_ONLY' -ForegroundColor Yellow
Write-Host 'A recuperação remove somente os IDs sintéticos confirmados e restaura generation/revision/sequence/updated_by.'
Write-Host 'updated_at original não pode ser reconstruído porque o runner anterior o capturou com máscara inválida; será atualizado para o horário real da recuperação.'
$confirmation = Read-Host 'Digite exatamente RESTAURAR CLONE CONCORRENCIA LOCAL para continuar'
if ($confirmation -cne 'RESTAURAR CLONE CONCORRENCIA LOCAL') { throw 'Recuperação cancelada pelo operador; nenhum DML executado.' }

& $DockerExe cp $SqlPath "${TargetContainer}:$containerSql" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar o SQL de recuperação para o container.' }
try {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # psql NOTICE messages can be forwarded by docker.exe on stderr even when
    # psql exits successfully. Keep them visible, but trust the native exit code.
    $ErrorActionPreference = 'Continue'
    $output = & $DockerExe exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off -f $containerSql 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $output | ForEach-Object { Write-Host "$_" }
  if ($code -ne 0) { throw 'SQL de recuperação falhou. A transação foi revertida; preserve o clone para diagnóstico.' }
  if (-not ($output | Where-Object { "$_" -match 'PASS_CONCURRENCY_FAILED_RUN_RECOVERED' })) { throw 'Marcador de recuperação não encontrado.' }
  if (-not ($output | Where-Object { "$_" -match 'RECOVERY_VERIFY\|0\|0\|0\|0\|0\|0' })) { throw 'Verificação pós-recuperação não confirmou remoção exata dos IDs sintéticos.' }
  if (-not ($output | Where-Object { "$_" -match 'PASS_CONCURRENCY_CONTROL_STATE_RECOVERED_UPDATED_AT_REFRESHED' })) { throw 'Controle compartilhado não foi confirmado no baseline lógico.' }
} finally {
  & $DockerExe exec $TargetContainer rm -f $containerSql 2>$null | Out-Null
}
Write-Host 'PASS_LOCAL_CONCURRENCY_FAILED_RUN_RECOVERED|synthetic_rows_removed=true|control_fields_restored=true|updated_at_refreshed=true' -ForegroundColor Green
