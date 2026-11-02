[CmdletBinding()]
param([string]$ProjectRoot)
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) { throw 'Não foi possível determinar a pasta do script.' }
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) { throw "Raiz do projeto inexistente: $ProjectRoot" }
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)

$TargetContainer = 'supabase_db_enderecamento-integracao-local'
$ExpectedComposeProject = 'enderecamento-integracao-local'
$ExpectedWorkdir = 'c:\testes\enderecamento_integracao_local'
$SqlPath = Join-Path $ProjectRoot 'docs/sql/20261030000000_shared_lancamento_concurrency_recovery_second_run.sql'
$DockerExe = (Get-Command docker.exe -ErrorAction Stop).Source
$ContainerSql = '/tmp/shared-lancamento-concurrency-recovery-second-run.sql'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('shared-concurrency-recovery-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$stdoutPath = Join-Path $tempRoot 'psql.stdout.txt'
$stderrPath = Join-Path $tempRoot 'psql.stderr.txt'

function Invoke-ReadOnlyQuery([string]$Sql, [string]$Label) {
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $DockerExe exec $TargetContainer psql -X -U postgres -d postgres -A -t -P pager=off -v ON_ERROR_STOP=1 -c $Sql 2>$null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw "Consulta somente leitura '$Label' falhou. Nenhuma alteração foi executada." }
  return @($output | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -ne '' })
}

try {
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
SELECT 'SESSIONS|' || count(*)::text
FROM pg_stat_activity
WHERE application_name IN ('shared_batch_concurrency_a','shared_batch_concurrency_b')
  AND pid <> pg_backend_pid();
SELECT 'SYNTHETIC|' ||
 (SELECT count(*)::text FROM public.slots WHERE id='1-1-TEST-CUTOVER-001') || '|' ||
 (SELECT count(*)::text FROM public.history WHERE id='MOV-ROW-SHARED-CONCURRENCY-001-SYNTH') || '|' ||
 (SELECT count(*)::text FROM public.divergencias WHERE estoque='1' AND modulo='1') || '|' ||
 (SELECT count(*)::text FROM public.lancamento_batch_runs WHERE batch_id='b7a10000-0000-4000-8000-000000000002'::uuid) || '|' ||
 (SELECT count(*)::text FROM public.lancamento_draft_archive_lines WHERE line_id='ROW-SHARED-CONCURRENCY-001');
SELECT 'CONTROL|' || generation_id::text || '|' || revision::text || '|' || next_sequence::text || '|' || coalesce(updated_by::text,'NULL') || '|' || to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')
FROM public.lancamento_draft_control WHERE singleton IS TRUE;
SELECT 'TABLE_COUNTS|' || (SELECT count(*)::text FROM public.lancamento_batch_runs) || '|' || (SELECT count(*)::text FROM public.lancamento_draft_archive_lines) || '|' || (SELECT count(*)::text FROM public.lancamento_draft_lines);
SELECT 'MODULE_1|' || (SELECT count(*)::text FROM public.slots WHERE estoque='1' AND modulo='1') || '|' || (SELECT count(*)::text FROM public.history WHERE estoque='1' AND modulo='1') || '|' || (SELECT count(*)::text FROM public.divergencias WHERE estoque='1' AND modulo='1');
'@
  $preflight = Invoke-ReadOnlyQuery $preflightSql 'baseline do segundo teste'
  $preflight | ForEach-Object { Write-Host $_ }
  $required = @(
    'CONNECTION|postgres|17.6',
    'SESSIONS|0',
    'SYNTHETIC|1|1|0|1|1',
    'CONTROL|1e80bd22-9918-4522-bda3-68bced42bd3e|0|1|01f519c5-108b-4706-a10b-e8782f4fe079|2026-10-30 02:40:32.789691',
    'TABLE_COUNTS|1|1|0',
    'MODULE_1|1|1|0'
  )
  foreach ($line in $required) {
    if (-not ($preflight -contains $line)) { throw "Estado não corresponde exatamente à segunda tentativa conhecida: $line. Nenhuma alteração executada." }
  }

  Write-Host 'RECOVERY_TARGET|LOCAL_INTEGRATION_ONLY' -ForegroundColor Yellow
  Write-Host 'Serão removidos somente os registros sintéticos desta segunda tentativa e restaurado o baseline capturado antes dela.'
  Write-Host 'updated_at será restaurado para o valor válido capturado no preflight: 2026-10-30 02:32:50.896128+00.'
  $confirmation = Read-Host 'Digite exatamente RESTAURAR SEGUNDA TENTATIVA DE CONCORRENCIA LOCAL'
  if ($confirmation -cne 'RESTAURAR SEGUNDA TENTATIVA DE CONCORRENCIA LOCAL') { throw 'Recuperação cancelada; nenhum DML executado.' }

  & $DockerExe cp $SqlPath "${TargetContainer}:$ContainerSql" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar SQL para o clone local.' }

  $arguments = @('exec', $TargetContainer, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-f', $ContainerSql)
  $process = Start-Process -FilePath $DockerExe -ArgumentList $arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $stdout = if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Raw } else { '' }
  $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
  if ($stdout) { Write-Host $stdout }
  if ($stderr) { Write-Host $stderr }
  if ($process.ExitCode -ne 0) { throw "psql de recuperação terminou com ExitCode=$($process.ExitCode). Consulte a saída; não repita automaticamente." }
  if (($stdout + "`n" + $stderr) -notmatch 'PASS_CONCURRENCY_SECOND_FAILED_RUN_RECOVERED') { throw 'Marcador de recuperação não encontrado.' }

  $verifySql = @'
SELECT 'VERIFY_SYNTHETIC|' ||
 (SELECT count(*)::text FROM public.slots WHERE id='1-1-TEST-CUTOVER-001') || '|' ||
 (SELECT count(*)::text FROM public.history WHERE id='MOV-ROW-SHARED-CONCURRENCY-001-SYNTH') || '|' ||
 (SELECT count(*)::text FROM public.divergencias WHERE estoque='1' AND modulo='1') || '|' ||
 (SELECT count(*)::text FROM public.lancamento_batch_runs WHERE batch_id='b7a10000-0000-4000-8000-000000000002'::uuid) || '|' ||
 (SELECT count(*)::text FROM public.lancamento_draft_archive_lines WHERE line_id='ROW-SHARED-CONCURRENCY-001') || '|' ||
 (SELECT count(*)::text FROM public.lancamento_draft_lines);
SELECT 'VERIFY_CONTROL|' || generation_id::text || '|' || revision::text || '|' || next_sequence::text || '|' || coalesce(updated_by::text,'NULL') || '|' || to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')
FROM public.lancamento_draft_control WHERE singleton IS TRUE;
SELECT 'VERIFY_TABLES|' || (SELECT count(*)::text FROM public.lancamento_batch_runs) || '|' || (SELECT count(*)::text FROM public.lancamento_draft_archive_lines) || '|' || (SELECT count(*)::text FROM public.lancamento_draft_lines);
'@
  $verify = Invoke-ReadOnlyQuery $verifySql 'confirmação após recuperação'
  $verify | ForEach-Object { Write-Host $_ }
  if (-not ($verify -contains 'VERIFY_SYNTHETIC|0|0|0|0|0|0')) { throw 'Recuperação não confirmou remoção exata dos registros sintéticos.' }
  if (-not ($verify -contains 'VERIFY_CONTROL|2cee16e6-6480-4bea-9bbf-fa27aceecddf|0|1|NULL|2026-10-30 02:32:50.896128')) { throw 'Controle não voltou ao baseline exato.' }
  if (-not ($verify -contains 'VERIFY_TABLES|0|0|0')) { throw 'Contagens das tabelas auxiliares não voltaram ao baseline.' }

  Write-Host 'PASS_SECOND_CONCURRENCY_ATTEMPT_RECOVERED|synthetic_ids_removed=true|control_baseline_restored=true' -ForegroundColor Green
}
finally {
  try { & $DockerExe exec $TargetContainer rm -f $ContainerSql 2>$null | Out-Null } catch { }
  try { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}
