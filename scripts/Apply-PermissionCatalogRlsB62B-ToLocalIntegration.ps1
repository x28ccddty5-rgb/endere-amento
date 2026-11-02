$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$MigrationPath = Join-Path $ProjectRoot "docs\sql\migrations\20261031130000_permission_catalog_rls_b62b.sql"
$ContainerName = "supabase_db_enderecamento-integracao-local"

if (-not (Test-Path $MigrationPath)) {
    throw "Migration B6.2B nao encontrada: $MigrationPath"
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
    throw "BLOQUEADO: nao foi possivel confirmar o banco postgres do container local."
}

$MigrationSql = [System.IO.File]::ReadAllText($MigrationPath)
if ($MigrationSql -notmatch "B62B_POSTFLIGHT_METADATA_RPC_ACL_INVALID" -or
    $MigrationSql -notmatch "B62B_POSTFLIGHT_AUTHENTICATED_DIRECT_DML_REMAINS") {
    throw "BLOQUEADO: arquivo nao corresponde a migration B6.2B esperada."
}

$Hash = (Get-FileHash $MigrationPath -Algorithm SHA256).Hash
$Token = [guid]::NewGuid().ToString("N")
$HostSqlPath = Join-Path ([System.IO.Path]::GetTempPath()) "permission-catalog-rls-b62b-$Token.sql"
$ContainerSqlPath = "/tmp/permission-catalog-rls-b62b-$Token.sql"
$ContainerSqlCopied = $false
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

Write-Host "ALVO LOCAL CONFIRMADO: $ContainerName" -ForegroundColor Cyan
Write-Host "Banco: $($DatabaseName.Trim())"
Write-Host "Migration SHA256: $Hash"
Write-Host "Transferindo arquivo SQL para o container e aplicando com psql -f..."

try {
    [System.IO.File]::WriteAllText($HostSqlPath, $MigrationSql, $Utf8NoBom)

    docker cp $HostSqlPath "$($ContainerName):$ContainerSqlPath" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao transferir o arquivo SQL para o container local. Nenhuma migration foi iniciada."
    }
    $ContainerSqlCopied = $true

    $PsqlArguments = @(
        "-U", "postgres",
        "-d", "postgres",
        "-X",
        "-v", "ON_ERROR_STOP=1",
        "-P", "pager=off",
        "-f", $ContainerSqlPath
    )

    $PsqlOutput = @(& docker exec $ContainerName psql @PsqlArguments)
    $PsqlExitCode = $LASTEXITCODE
    $PsqlOutput | ForEach-Object { Write-Host $_ }

    if ($PsqlExitCode -ne 0) {
        throw "Migration B6.2B falhou no clone local (psql exit code $PsqlExitCode). A transacao SQL nao foi confirmada. Nenhum deploy remoto foi executado."
    }
}
finally {
    if ($ContainerSqlCopied) {
        docker exec $ContainerName rm -f $ContainerSqlPath 2>$null | Out-Null
    }
    if (Test-Path $HostSqlPath) {
        Remove-Item -LiteralPath $HostSqlPath -Force
    }
}

Write-Host "`nB6.2B APLICADA E POSTFLIGHT APROVADO NO CLONE LOCAL." -ForegroundColor Green
