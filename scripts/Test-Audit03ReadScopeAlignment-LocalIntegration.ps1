$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$VerifyPath = Join-Path $ProjectRoot "docs\sql\20261031150000_permission_read_scope_alignment_verify.sql"
$ContainerName = "supabase_db_enderecamento-integracao-local"

if (-not (Test-Path $VerifyPath)) { throw "Arquivo verify nao encontrado: $VerifyPath" }
$RunningNames = @(docker ps --format "{{.Names}}")
if ($LASTEXITCODE -ne 0 -or $RunningNames -notcontains $ContainerName) {
    throw "BLOQUEADO: container local exato nao esta em execucao. Diagnostico nao executado."
}
$InspectedName = docker inspect --format "{{.Name}}" $ContainerName
if ($LASTEXITCODE -ne 0 -or $InspectedName.Trim() -ne "/$ContainerName") {
    throw "BLOQUEADO: identidade do container nao corresponde ao clone local esperado."
}
$DatabaseName = docker exec $ContainerName psql -X -At -U postgres -d postgres -c "SELECT current_database();"
if ($LASTEXITCODE -ne 0 -or $DatabaseName.Trim() -ne "postgres") {
    throw "BLOQUEADO: nao foi possivel confirmar o banco postgres do clone local."
}

$Sql = [System.IO.File]::ReadAllText($VerifyPath)
if ($Sql -notmatch "BEGIN TRANSACTION READ ONLY" -or $Sql -notmatch "ROLLBACK;") {
    throw "BLOQUEADO: o arquivo nao esta marcado como verify somente leitura."
}
if ($Sql -match "(?im)^\s*(INSERT INTO|UPDATE public\.|DELETE FROM|ALTER TABLE|DROP POLICY|CREATE POLICY|GRANT |REVOKE )") {
    throw "BLOQUEADO: o verify contem uma instrucao de mutacao/DDL."
}

$Token = [guid]::NewGuid().ToString("N")
$HostSqlPath = Join-Path ([System.IO.Path]::GetTempPath()) "audit03-read-scope-verify-$Token.sql"
$ContainerSqlPath = "/tmp/audit03-read-scope-verify-$Token.sql"
$ContainerSqlCopied = $false
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
try {
    [System.IO.File]::WriteAllText($HostSqlPath, $Sql, $Utf8NoBom)
    docker cp $HostSqlPath "$($ContainerName):$ContainerSqlPath" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao transferir o verify para o container local." }
    $ContainerSqlCopied = $true

    $PsqlArguments = @(
        "-U", "postgres", "-d", "postgres", "-X",
        "-v", "ON_ERROR_STOP=1", "-P", "pager=off", "-f", $ContainerSqlPath
    )
    $Output = @(& docker exec $ContainerName psql @PsqlArguments)
    $ExitCode = $LASTEXITCODE
    $Output | ForEach-Object { Write-Host $_ }
    if ($ExitCode -ne 0) { throw "Verify da Auditoria 03 falhou (psql exit code $ExitCode)." }
}
finally {
    if ($ContainerSqlCopied) { docker exec $ContainerName rm -f $ContainerSqlPath 2>$null | Out-Null }
    if (Test-Path $HostSqlPath) { Remove-Item -LiteralPath $HostSqlPath -Force }
}
Write-Host "`nVERIFY DA AUDITORIA 03 CONCLUIDO; NENHUM DADO FOI ALTERADO." -ForegroundColor Green
