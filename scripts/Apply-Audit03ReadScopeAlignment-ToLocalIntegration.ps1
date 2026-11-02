param(
    [switch]$ConfirmApplyLocal
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$MigrationPath = Join-Path $ProjectRoot "docs\sql\migrations\20261031150000_permission_read_scope_alignment.sql"
$ContainerName = "supabase_db_enderecamento-integracao-local"

if (-not $ConfirmApplyLocal) {
    throw "BLOQUEADO: informe -ConfirmApplyLocal para aplicar somente no clone local."
}
if (-not (Test-Path $MigrationPath)) {
    throw "Migration da Auditoria 03 nao encontrada: $MigrationPath"
}

$RunningNames = @(docker ps --format "{{.Names}}")
if ($LASTEXITCODE -ne 0 -or $RunningNames -notcontains $ContainerName) {
    throw "BLOQUEADO: container local exato nao esta em execucao. Nenhuma acao foi executada."
}
$InspectedName = docker inspect --format "{{.Name}}" $ContainerName
if ($LASTEXITCODE -ne 0 -or $InspectedName.Trim() -ne "/$ContainerName") {
    throw "BLOQUEADO: identidade do container nao corresponde ao clone local esperado."
}
$DatabaseName = docker exec $ContainerName psql -X -At -U postgres -d postgres -c "SELECT current_database();"
if ($LASTEXITCODE -ne 0 -or $DatabaseName.Trim() -ne "postgres") {
    throw "BLOQUEADO: nao foi possivel confirmar o banco postgres do clone local."
}

$MigrationSql = [System.IO.File]::ReadAllText($MigrationPath)
if ($MigrationSql -notmatch "A03_READ_SCOPE_POSTFLIGHT_SLOTS_POLICY_INVALID" -or
    $MigrationSql -notmatch "A03_READ_SCOPE_POSTFLIGHT_DIVERGENCIAS_POLICY_INVALID" -or
    $MigrationSql -notmatch "CREATE POLICY slots_select_permission_catalog") {
    throw "BLOQUEADO: arquivo nao corresponde a migration esperada da Auditoria 03."
}

$Hash = (Get-FileHash $MigrationPath -Algorithm SHA256).Hash
$Token = [guid]::NewGuid().ToString("N")
$HostSqlPath = Join-Path ([System.IO.Path]::GetTempPath()) "audit03-read-scope-$Token.sql"
$ContainerSqlPath = "/tmp/audit03-read-scope-$Token.sql"
$ContainerSqlCopied = $false
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

Write-Host "ALVO LOCAL CONFIRMADO: $ContainerName" -ForegroundColor Cyan
Write-Host "Banco: $($DatabaseName.Trim())"
Write-Host "Migration SHA256: $Hash"
Write-Host "Nenhuma conexao com Supabase Cloud ou Vercel sera iniciada."

try {
    [System.IO.File]::WriteAllText($HostSqlPath, $MigrationSql, $Utf8NoBom)
    docker cp $HostSqlPath "$($ContainerName):$ContainerSqlPath" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao transferir o SQL para o container local."
    }
    $ContainerSqlCopied = $true

    $PsqlArguments = @(
        "-U", "postgres", "-d", "postgres", "-X",
        "-v", "ON_ERROR_STOP=1", "-P", "pager=off", "-f", $ContainerSqlPath
    )
    $PsqlOutput = @(& docker exec $ContainerName psql @PsqlArguments)
    $PsqlExitCode = $LASTEXITCODE
    $PsqlOutput | ForEach-Object { Write-Host $_ }
    if ($PsqlExitCode -ne 0) {
        throw "Migration falhou no clone local (psql exit code $PsqlExitCode). A transacao foi interrompida."
    }
}
finally {
    if ($ContainerSqlCopied) {
        docker exec $ContainerName rm -f $ContainerSqlPath 2>$null | Out-Null
    }
    if (Test-Path $HostSqlPath) { Remove-Item -LiteralPath $HostSqlPath -Force }
}

Write-Host "`nALINHAMENTO DA AUDITORIA 03 APLICADO E POSTFLIGHT APROVADO NO CLONE LOCAL." -ForegroundColor Green
