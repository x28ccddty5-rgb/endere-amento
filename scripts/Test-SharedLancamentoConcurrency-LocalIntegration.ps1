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
$BatchId = 'b7a10000-0000-4000-8000-000000000002'
$LineId = 'ROW-SHARED-CONCURRENCY-001'
$SlotId = '1-1-TEST-CUTOVER-001'
$HistoryId = 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH'
$SessionARelative = 'docs/sql/20261029030000_shared_lancamento_concurrency_session_a.sql'
$SessionBRelative = 'docs/sql/20261029030000_shared_lancamento_concurrency_session_b.sql'
$RestoreSqlRelative = 'docs/sql/20261029030000_shared_lancamento_concurrency_restore.sql'
$SessionAPath = Join-Path $ProjectRoot $SessionARelative
$SessionBPath = Join-Path $ProjectRoot $SessionBRelative
$RestoreSqlPath = Join-Path $ProjectRoot $RestoreSqlRelative
$DockerCommand = Get-Command docker.exe -ErrorAction Stop
$DockerExe = $DockerCommand.Source

$aProcess = $null
$bProcess = $null
$needsCleanup = $false
$baseline = $null
$expectedPostGenerationId = 'NONE'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("shared-lancamento-concurrency-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$aOut = Join-Path $tempRoot 'session-a.stdout.txt'
$aErr = Join-Path $tempRoot 'session-a.stderr.txt'
$bOut = Join-Path $tempRoot 'session-b.stdout.txt'
$bErr = Join-Path $tempRoot 'session-b.stderr.txt'
New-Item -ItemType File -Path $aOut,$aErr,$bOut,$bErr -Force | Out-Null

function Stop-Safely([string]$Message) {
  Write-Host "`nBLOQUEADO: $Message" -ForegroundColor Red
  throw $Message
}

function Invoke-DbQuery([string]$Sql, [string]$Label) {
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = & $DockerExe exec $TargetContainer psql -X -U postgres -d postgres -A -t -P pager=off -v ON_ERROR_STOP=1 -c $Sql 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  $joined = ($lines | ForEach-Object { "$_" }) -join "`n"
  if ($code -ne 0) { Stop-Safely "Consulta '$Label' falhou:`n$joined" }
  $result = @($lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne '' })
  $result | ForEach-Object { Write-Host $_ }
  return $result
}

function Test-DbProbe([string]$Sql) {
  # PostgreSQL boolean output may be 't' or explicit ::text output may be 'true'.
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = & $DockerExe exec $TargetContainer psql -X -U postgres -d postgres -A -t -P pager=off -v ON_ERROR_STOP=1 -c $Sql 2>$null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { return $false }
  $probeResult = (($lines | ForEach-Object { "$_" }) -join '').Trim()
  return ($probeResult -in @('t', 'true'))
}

function Wait-ForDbProbe([string]$Sql, [string]$Label, [int]$MaxAttempts, [int]$DelayMilliseconds, [System.Diagnostics.Process]$ProcessToWatch) {
  for ($attempt = 0; $attempt -lt $MaxAttempts; $attempt++) {
    if ($ProcessToWatch -and $ProcessToWatch.HasExited) {
      $outText = if (Test-Path $aOut) { Get-Content $aOut -Raw } else { '' }
      $errText = if (Test-Path $aErr) { Get-Content $aErr -Raw } else { '' }
      Stop-Safely "${Label}: a sessão terminou antes da condição esperada.`n$outText`n$errText"
    }
    if (Test-DbProbe $Sql) { return $true }
    Start-Sleep -Milliseconds $DelayMilliseconds
  }
  return $false
}

function Start-LocalPsqlSession([string]$SqlContainerPath, [string]$StdoutPath, [string]$StderrPath, [string[]]$PsqlVariables) {
  $arguments = @('exec', $TargetContainer, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1')
  $arguments += $PsqlVariables
  $arguments += @('-P', 'pager=off', '-f', $SqlContainerPath)
  return Start-Process -FilePath $DockerExe -ArgumentList $arguments -NoNewWindow -PassThru -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath
}

function Read-ProcessOutput([string]$OutPath, [string]$ErrPath) {
  $outText = if (Test-Path $OutPath) { Get-Content $OutPath -Raw } else { '' }
  $errText = if (Test-Path $ErrPath) { Get-Content $ErrPath -Raw } else { '' }
  return ($outText + "`n" + $errText).Trim()
}

function Invoke-SafeRestore {
  if (-not $needsCleanup -or -not $baseline) { return }

  $sessionAOutput = Read-ProcessOutput $aOut $aErr
  $postGenerationMatch = [regex]::Match($sessionAOutput, 'PASS_CONCURRENCY_SESSION_A_PROCESSED\|batch_id=[^|]+\|revision=[0-9]+\|next_generation=([0-9a-fA-F-]{36})')
  if ($postGenerationMatch.Success) { $script:expectedPostGenerationId = $postGenerationMatch.Groups[1].Value }

  $cleanupArgs = @(
    '-v', "baseline_generation_id=$($baseline.GenerationId)",
    '-v', "baseline_revision=$($baseline.Revision)",
    '-v', "baseline_next_sequence=$($baseline.NextSequence)",
    '-v', "baseline_updated_by=$($baseline.UpdatedBy)",
    '-v', "baseline_updated_at=$($baseline.UpdatedAt)",
    '-v', "baseline_batch_count=$($baseline.BatchCount)",
    '-v', "baseline_archive_count=$($baseline.ArchiveCount)",
    '-v', "expected_post_generation_id=$expectedPostGenerationId"
  )
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = & $DockerExe exec $TargetContainer psql -X -U postgres -d postgres -A -t -P pager=off -v ON_ERROR_STOP=1 @cleanupArgs -f '/tmp/shared-lancamento-concurrency-restore.sql' 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  $lines | ForEach-Object { Write-Host "$_" }
  if ($code -ne 0 -or -not ($lines | Where-Object { "$_" -match 'PASS_CONCURRENCY_CLONE_RESTORED_TO_BASELINE' })) {
    Stop-Safely 'A limpeza exata não foi confirmada. Preserve o clone para diagnóstico; não execute limpeza manual.'
  }
}

Write-Host 'RUNNER_VERSION|SHARED-LANCAMENTO-CONCURRENCY-LOCAL-V2' -ForegroundColor Green
Write-Host 'CONCORRÊNCIA DO MESMO LOTE — SOMENTE CLONE LOCAL POSTGRESQL 17' -ForegroundColor Yellow
Write-Host 'Duas sessões independentes; a sessão B precisa ser observada bloqueada pela sessão A antes do COMMIT da sessão A.'
Write-Host 'A sessão A mantém o lock por até 20 segundos. O teste grava apenas IDs sintéticos e restaura o baseline exato ao final.'
Write-Host 'Não inicia/reinicia/remove containers, não acessa Supabase Cloud e não usa db push.'

try {
  foreach ($path in @($SessionAPath, $SessionBPath, $RestoreSqlPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Stop-Safely "Arquivo SQL não encontrado: $path" }
  }

  $inspectRaw = & $DockerExe inspect $TargetContainer 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $inspectRaw) { Stop-Safely "Container exato '$TargetContainer' não encontrado." }
  $containerInfo = @($inspectRaw | ConvertFrom-Json)[0]
  if ($containerInfo.State.Running -ne $true) { Stop-Safely 'Container alvo não está em execução; script não irá iniciá-lo.' }
  $labels = $containerInfo.Config.Labels
  if ($labels.'com.docker.compose.project' -ne $ExpectedComposeProject) { Stop-Safely 'Label do projeto Docker diferente.' }
  $workdir = ([string]$labels.'com.supabase.cli.workdir').Replace('/','\').TrimEnd('\').ToLowerInvariant()
  if ($workdir -ne $ExpectedWorkdir) { Stop-Safely "Workdir inesperado: $workdir" }

  $preflightSql = @'
SELECT 'CONNECTION|' || current_database() || '|' || current_setting('server_version');
SELECT 'SHARED_RPC_SET|' || (
  to_regprocedure('public.get_shared_lancamento_draft()') IS NOT NULL
  AND to_regprocedure('public.upsert_shared_lancamento_draft_lines(uuid,jsonb)') IS NOT NULL
  AND to_regprocedure('public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])') IS NOT NULL
)::text;
SELECT 'TYPED_WRITERS|' || (
  to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NOT NULL
  AND to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)') IS NOT NULL
)::text;
SELECT 'ADMIN_COUNT|' || count(*)::text
FROM public.profiles WHERE lower(btrim(role)) = 'administrador' AND coalesce(btrim(name), '') <> '';
SELECT 'ADMIN|' || coalesce(min(id::text), '')
FROM public.profiles WHERE lower(btrim(role)) = 'administrador' AND coalesce(btrim(name), '') <> '';
SELECT 'BASELINE|' || generation_id::text || '|' || revision::text || '|' || next_sequence::text || '|' || coalesce(updated_by::text, 'NULL') || '|' || to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')
FROM public.lancamento_draft_control WHERE singleton IS TRUE;
SELECT 'TABLE_BASELINE|' || (SELECT count(*)::text FROM public.lancamento_batch_runs) || '|' || (SELECT count(*)::text FROM public.lancamento_draft_archive_lines);
SELECT 'PRODUCT_COUNT|' || count(*)::text
FROM public.products
WHERE upper(btrim(referencia)) = 'TEST-CUTOVER-001' AND nullif(btrim(descricao), '') IS NOT NULL;
SELECT 'DRAFT_EMPTY|' || (
  NOT EXISTS (SELECT 1 FROM public.lancamento_draft_lines)
)::text;
SELECT 'MODULE_1_EMPTY|' || (
  NOT EXISTS (SELECT 1 FROM public.slots WHERE estoque = '1' AND modulo = '1')
  AND NOT EXISTS (SELECT 1 FROM public.history WHERE estoque = '1' AND modulo = '1')
  AND NOT EXISTS (SELECT 1 FROM public.divergencias WHERE estoque = '1' AND modulo = '1')
)::text;
SELECT 'MODULE_1_ACTIVE|' || (
  NOT EXISTS (SELECT 1 FROM public.warehouse_layout WHERE estoque = '1')
  OR EXISTS (SELECT 1 FROM public.warehouse_layout WHERE estoque = '1' AND btrim(modulo) = '1' AND ativo IS TRUE)
)::text;
SELECT 'TEST_IDS_ABSENT|' || (
  NOT EXISTS (SELECT 1 FROM public.slots WHERE id = '1-1-TEST-CUTOVER-001')
  AND NOT EXISTS (SELECT 1 FROM public.history WHERE id = 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH')
  AND NOT EXISTS (SELECT 1 FROM public.lancamento_batch_runs WHERE batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.lancamento_draft_archive_lines WHERE line_id = 'ROW-SHARED-CONCURRENCY-001')
  AND NOT EXISTS (SELECT 1 FROM public.lancamento_draft_lines WHERE line_id = 'ROW-SHARED-CONCURRENCY-001')
)::text;
'@
  $preflight = Invoke-DbQuery $preflightSql 'Pré-requisitos do teste de concorrência'
  if (-not ($preflight | Where-Object { $_ -match '^CONNECTION\|postgres\|17\.' })) { Stop-Safely 'O alvo não é postgres/PG17.' }
  if (-not ($preflight | Where-Object { $_ -eq 'SHARED_RPC_SET|true' })) { Stop-Safely 'Conjunto de RPCs compartilhadas incompleto.' }
  if (-not ($preflight | Where-Object { $_ -eq 'TYPED_WRITERS|true' })) { Stop-Safely 'Escritores tipados B7.1 não encontrados.' }
  if (-not ($preflight | Where-Object { $_ -eq 'ADMIN_COUNT|1' })) { Stop-Safely 'Não existe exatamente um perfil Administrador local válido.' }
  if (-not ($preflight | Where-Object { $_ -eq 'PRODUCT_COUNT|1' })) { Stop-Safely 'Produto sintético TEST-CUTOVER-001 não é único.' }
  foreach ($required in @('DRAFT_EMPTY|true', 'MODULE_1_EMPTY|true', 'MODULE_1_ACTIVE|true', 'TEST_IDS_ABSENT|true')) {
    if (-not ($preflight | Where-Object { $_ -eq $required })) { Stop-Safely "Pré-requisito não confirmado: $required. Nenhuma sessão foi iniciada." }
  }

  $adminLine = @($preflight | Where-Object { $_ -match '^ADMIN\|[0-9a-fA-F-]{36}$' } | Select-Object -First 1)
  $baselineLine = @($preflight | Where-Object { $_ -match '^BASELINE\|' } | Select-Object -First 1)
  $tableBaselineLine = @($preflight | Where-Object { $_ -match '^TABLE_BASELINE\|' } | Select-Object -First 1)
  if ($adminLine.Count -ne 1 -or $baselineLine.Count -ne 1 -or $tableBaselineLine.Count -ne 1) { Stop-Safely 'Não foi possível capturar Administrador e baselines do clone.' }
  $adminId = $adminLine[0].Substring(6)
  $baselineParts = $baselineLine[0].Split('|')
  $tableBaselineParts = $tableBaselineLine[0].Split('|')
  if ($baselineParts.Count -ne 6 -or $tableBaselineParts.Count -ne 3) { Stop-Safely 'Formato inesperado dos baselines do clone.' }
  $baseline = [pscustomobject]@{
    GenerationId = $baselineParts[1]
    Revision = [int64]$baselineParts[2]
    NextSequence = [int64]$baselineParts[3]
    UpdatedBy = $baselineParts[4]
    UpdatedAt = $baselineParts[5]
    BatchCount = [int64]$tableBaselineParts[1]
    ArchiveCount = [int64]$tableBaselineParts[2]
  }
  $expectedRevision = $baseline.Revision + 1
  Write-Host "`nADMIN_ID|$adminId"
  Write-Host "BASELINE|generation=$($baseline.GenerationId)|revision=$($baseline.Revision)|next_sequence=$($baseline.NextSequence)"
  Write-Host "EXPECTED_BATCH_REVISION|$expectedRevision"

  $containerA = '/tmp/shared-lancamento-concurrency-session-a.sql'
  $containerB = '/tmp/shared-lancamento-concurrency-session-b.sql'
  $containerRestore = '/tmp/shared-lancamento-concurrency-restore.sql'
  & $DockerExe cp $SessionAPath "${TargetContainer}:$containerA" | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Safely 'Falha ao copiar Session A para o container local.' }
  & $DockerExe cp $SessionBPath "${TargetContainer}:$containerB" | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Safely 'Falha ao copiar Session B para o container local.' }
  & $DockerExe cp $RestoreSqlPath "${TargetContainer}:$containerRestore" | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Safely 'Falha ao copiar o SQL de restauração para o container local.' }

  $needsCleanup = $true
  $commonVarsA = @(
    '-v', "admin_id=$adminId",
    '-v', "baseline_generation_id=$($baseline.GenerationId)",
    '-v', "baseline_revision=$($baseline.Revision)"
  )
  Write-Host "`n--- Iniciar Session A: processa o lote e mantém a transação aberta ---" -ForegroundColor Cyan
  $aProcess = Start-LocalPsqlSession $containerA $aOut $aErr $commonVarsA

  # The NOTICE is emitted after the batch RPC returns and before pg_sleep.
  # Its backend PID avoids relying on an application_name-only match.
  $aMarkerPattern = 'PASS_CONCURRENCY_SESSION_A_PROCESSED\|batch_id=[^|]+\|revision=[0-9]+\|next_generation=([0-9a-fA-F-]{36})\|saldo=1\|history=1\|backend_pid=([0-9]+)'
  $aMarkerMatch = [regex]::Match((Read-ProcessOutput $aOut $aErr), $aMarkerPattern)
  for ($attempt = 0; -not $aMarkerMatch.Success -and $attempt -lt 60; $attempt++) {
    if ($aProcess.HasExited) {
      Stop-Safely "Session A terminou antes de emitir o marcador de processamento.`n$(Read-ProcessOutput $aOut $aErr)"
    }
    Start-Sleep -Milliseconds 200
    $aMarkerMatch = [regex]::Match((Read-ProcessOutput $aOut $aErr), $aMarkerPattern)
  }
  if (-not $aMarkerMatch.Success) {
    Stop-Safely "Session A não emitiu o marcador de processamento dentro do limite.`n$(Read-ProcessOutput $aOut $aErr)"
  }
  $expectedPostGenerationId = $aMarkerMatch.Groups[1].Value
  $aBackendPid = [int]$aMarkerMatch.Groups[2].Value

  $aHoldingLockSql = @"
SELECT EXISTS (
  SELECT 1 FROM pg_stat_activity
  WHERE pid = $aBackendPid
    AND application_name = 'shared_batch_concurrency_a'
    AND state = 'active'
    AND query ILIKE '%pg_sleep(20)%'
    AND wait_event_type = 'Timeout'
    AND wait_event = 'PgSleep'
)::text;
"@
  if (-not (Wait-ForDbProbe $aHoldingLockSql 'Session A manter o lock após o marcador' 40 100 $aProcess)) {
    $aStateSql = @"
SELECT 'SESSION_A_DIAGNOSTIC|' || coalesce(application_name,'NULL') || '|' || pid::text || '|' || coalesce(state,'NULL') || '|' || coalesce(wait_event_type,'NULL') || '|' || coalesce(wait_event,'NULL') || '|' || coalesce(query,'NULL')
FROM pg_stat_activity WHERE pid = $aBackendPid;
"@
    $aState = Invoke-DbQuery $aStateSql 'Diagnóstico da sessão A (somente leitura)'
    Stop-Safely "Session A não foi observada em pg_sleep mantendo a transação dentro do limite. PID=$aBackendPid Saída:`n$(Read-ProcessOutput $aOut $aErr)`n$($aState -join '`n')"
  }
  Write-Host "PASS_CONCURRENCY_SESSION_A_HOLDS_CONTROL_LOCK|pid=$aBackendPid"

  $commonVarsB = @(
    '-v', "admin_id=$adminId",
    '-v', "baseline_generation_id=$($baseline.GenerationId)",
    '-v', "expected_revision=$expectedRevision"
  )
  Write-Host "`n--- Iniciar Session B: repetir o mesmo batch_id enquanto A mantém o lock ---" -ForegroundColor Cyan
  $bProcess = Start-LocalPsqlSession $containerB $bOut $bErr $commonVarsB

  $bBlockedByASql = @"
SELECT EXISTS (
  SELECT 1
  FROM pg_stat_activity AS b
  WHERE b.application_name = 'shared_batch_concurrency_b'
    AND b.state = 'active'
    AND b.wait_event_type = 'Lock'
    AND EXISTS (
      SELECT 1 FROM pg_stat_activity AS a
      WHERE a.application_name = 'shared_batch_concurrency_a'
        AND a.pid = ANY(pg_blocking_pids(b.pid))
    )
)::text;
"@
  if (-not (Wait-ForDbProbe $bBlockedByASql 'Session B bloquear especificamente em Session A' 40 200 $bProcess)) {
    Stop-Safely "Não foi possível comprovar que B aguardou A. Saída B:`n$(Read-ProcessOutput $bOut $bErr)"
  }
  Write-Host 'PASS_CONCURRENCY_SESSION_B_BLOCKED_BY_A|true'

  if (-not $aProcess.WaitForExit(25000)) { Stop-Safely 'Session A excedeu o limite de espera de conclusão.' }
  if (-not $bProcess.WaitForExit(10000)) { Stop-Safely 'Session B não retornou após o COMMIT da Session A.' }
  $aOutput = Read-ProcessOutput $aOut $aErr
  $bOutput = Read-ProcessOutput $bOut $bErr
  Write-Host "`n--- Saída Session A ---`n$aOutput"
  Write-Host "`n--- Saída Session B ---`n$bOutput"
  if ($aProcess.ExitCode -ne 0 -or $bProcess.ExitCode -ne 0) { Stop-Safely 'Uma das sessões PostgreSQL terminou com erro.' }
  $postGenerationMatch = [regex]::Match($aOutput, 'PASS_CONCURRENCY_SESSION_A_PROCESSED\|batch_id=[^|]+\|revision=[0-9]+\|next_generation=([0-9a-fA-F-]{36})\|saldo=1\|history=1\|backend_pid=([0-9]+)')
  if (-not $postGenerationMatch.Success -or $postGenerationMatch.Groups[2].Value -ne [string]$aBackendPid) {
    Stop-Safely 'O marcador final da Session A não corresponde ao backend observado durante o lock.'
  }
  if ($aOutput -notmatch 'PASS_CONCURRENCY_SESSION_A_PROCESSED' -or $bOutput -notmatch 'PASS_CONCURRENCY_SESSION_B_ALREADY_PROCESSED' -or $expectedPostGenerationId -eq 'NONE') {
    Stop-Safely 'Os marcadores de processamento único/idempotência não foram encontrados nas duas sessões.'
  }

  $postStateSql = @'
SELECT 'POST_BUSINESS|' ||
  (SELECT count(*)::text FROM public.slots WHERE id = '1-1-TEST-CUTOVER-001' AND saldo = 1 AND referencia = 'TEST-CUTOVER-001') || '|' ||
  (SELECT count(*)::text FROM public.history WHERE id = 'MOV-ROW-SHARED-CONCURRENCY-001-SYNTH' AND slot_id = '1-1-TEST-CUTOVER-001' AND quantidade = 1 AND tipo = 'Entrada') || '|' ||
  (SELECT count(*)::text FROM public.divergencias WHERE estoque = '1' AND modulo = '1') || '|' ||
  (SELECT count(*)::text FROM public.lancamento_batch_runs WHERE batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid) || '|' ||
  (SELECT count(*)::text FROM public.lancamento_draft_archive_lines WHERE line_id = 'ROW-SHARED-CONCURRENCY-001' AND batch_id = 'b7a10000-0000-4000-8000-000000000002'::uuid AND disposition = 'processed') || '|' ||
  (SELECT count(*)::text FROM public.lancamento_draft_lines WHERE line_id = 'ROW-SHARED-CONCURRENCY-001');
SELECT 'POST_CONTROL|' || generation_id::text || '|' || revision::text || '|' || next_sequence::text
FROM public.lancamento_draft_control WHERE singleton IS TRUE;
'@
  $postState = Invoke-DbQuery $postStateSql 'Verificação pós-concorrência antes da limpeza'
  $businessLine = @($postState | Where-Object { $_ -match '^POST_BUSINESS\|' } | Select-Object -First 1)
  $controlLine = @($postState | Where-Object { $_ -match '^POST_CONTROL\|' } | Select-Object -First 1)
  if ($businessLine.Count -ne 1 -or $businessLine[0] -ne 'POST_BUSINESS|1|1|0|1|1|0') {
    Stop-Safely 'Estado de negócio após concorrência não corresponde a exatamente uma entrada/histórico/lote/arquivo sem duplicidade.'
  }
  if ($controlLine.Count -ne 1) { Stop-Safely 'Estado final do controle compartilhado não foi encontrado.' }
  $controlParts = $controlLine[0].Split('|')
  if ($controlParts.Count -ne 4 -or $controlParts[1] -eq $baseline.GenerationId -or $controlParts[2] -ne '0' -or $controlParts[3] -ne '1') {
    Stop-Safely 'Geração seguinte do rascunho não corresponde ao fechamento de um único lote.'
  }
  Write-Host 'PASS_CONCURRENCY_SINGLE_STOCK_WRITE|slots=1|history=1|divergences=0|batch_runs=1|archive_processed=1'
  Write-Host 'PASS_CONCURRENCY_SAME_BATCH_RETRY|session_b_already_processed=true'
}
finally {
  $allSessionsFinished = $true
  foreach ($proc in @($bProcess, $aProcess)) {
    if ($proc -and -not $proc.HasExited) {
      try {
        if (-not $proc.WaitForExit(40000)) { $allSessionsFinished = $false }
      } catch { $allSessionsFinished = $false }
    }
  }

  if (-not $allSessionsFinished) {
    Write-Host 'BLOQUEADO: uma sessão local continua ativa após o limite; nenhuma limpeza será iniciada.' -ForegroundColor Red
    throw 'Sessão PostgreSQL ainda ativa. Preserve o clone e inspecione pg_stat_activity antes de qualquer recuperação.'
  }

  if ($needsCleanup -and $baseline) {
    $noActiveTestSessionsSql = @'
SELECT NOT EXISTS (
  SELECT 1 FROM pg_stat_activity
  WHERE application_name IN ('shared_batch_concurrency_a','shared_batch_concurrency_b')
    AND pid <> pg_backend_pid()
)::text;
'@
    if (-not (Test-DbProbe $noActiveTestSessionsSql)) {
      throw 'Sessão de concorrência ainda aparece em pg_stat_activity; limpeza bloqueada.'
    }
    try { Invoke-SafeRestore }
    catch { Write-Host "ERRO NA RESTAURAÇÃO DO CLONE: $_" -ForegroundColor Red; throw }
  }

  foreach ($containerPath in @('/tmp/shared-lancamento-concurrency-session-a.sql','/tmp/shared-lancamento-concurrency-session-b.sql','/tmp/shared-lancamento-concurrency-restore.sql')) {
    try { & $DockerExe exec $TargetContainer rm -f $containerPath 2>$null | Out-Null } catch { }
  }
  try { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}

Write-Host "`nPASS_SHARED_BATCH_CONCURRENCY_LOCAL|two_sessions=true|one_stock_write=true|second_already_processed=true|clone_restored=true" -ForegroundColor Green
