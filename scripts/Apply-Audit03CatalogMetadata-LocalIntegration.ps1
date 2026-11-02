$ErrorActionPreference = "Stop"

$dbContainer = "supabase_db_enderecamento-integracao-local"
$edgeContainer = "supabase_edge_runtime_enderecamento-integracao-local"
$sqlRelativePath = "docs/sql/migrations/20261031170000_permission_stock_details_description_alignment.sql"
$verifyRelativePath = "docs/sql/20261031170000_permission_stock_details_description_alignment_verify.sql"
$containerSqlPath = "/tmp/audit03_permission_stock_details_alignment.sql"
$containerVerifyPath = "/tmp/audit03_permission_stock_details_alignment_verify.sql"

function Assert-DockerSuccess {
    param([string]$Action)
    if ($LASTEXITCODE -ne 0) {
        throw "Falha no Docker durante: $Action"
    }
}

try {
    Set-Location (Join-Path $PSScriptRoot "..")

    $inspectRaw = & docker inspect $dbContainer 2>&1
    Assert-DockerSuccess "inspecionar o banco de integração"
    $container = ($inspectRaw -join "`n") | ConvertFrom-Json

    if ($container[0].Name -ne "/$dbContainer" -or $container[0].State.Status -ne "running") {
        throw "O container não corresponde exatamente ao banco local de integração ativo. Nenhuma alteração executada."
    }

    $edgeInspectRaw = & docker inspect $edgeContainer 2>&1
    Assert-DockerSuccess "inspecionar o Edge Runtime de integração"
    $edge = ($edgeInspectRaw -join "`n") | ConvertFrom-Json
    if ($edge[0].Name -ne "/$edgeContainer" -or $edge[0].State.Status -ne "running") {
        throw "O Edge Runtime local de integração não está ativo. Nenhuma alteração executada."
    }

    $dbNetworks = @($container[0].NetworkSettings.Networks.PSObject.Properties.Name)
    $edgeNetworks = @($edge[0].NetworkSettings.Networks.PSObject.Properties.Name)
    $sharedNetworks = @($dbNetworks | Where-Object { $edgeNetworks -contains $_ })
    if ($sharedNetworks.Count -eq 0) {
        throw "Banco e Edge Runtime não pertencem à mesma rede local de integração. Nenhuma alteração executada."
    }

    $sqlPath = Join-Path (Get-Location) $sqlRelativePath
    $verifyPath = Join-Path (Get-Location) $verifyRelativePath

    if (!(Test-Path $sqlPath) -or !(Test-Path $verifyPath)) {
        throw "Arquivos SQL da correção não encontrados. Nenhuma alteração executada."
    }

    Write-Host "Alvo confirmado: $dbContainer" -ForegroundColor Cyan
    Write-Host "Escopo: somente descrição de stock.details.view na integração local." -ForegroundColor Cyan

    & docker cp $sqlPath "${dbContainer}:$containerSqlPath" | Out-Null
    Assert-DockerSuccess "copiar a migração local"

    & docker exec $dbContainer psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f $containerSqlPath
    Assert-DockerSuccess "aplicar o alinhamento do catálogo local"

    & docker cp $verifyPath "${dbContainer}:$containerVerifyPath" | Out-Null
    Assert-DockerSuccess "copiar a verificação local"

    & docker exec $dbContainer psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f $containerVerifyPath
    Assert-DockerSuccess "verificar o alinhamento do catálogo local"

    Write-Host "`nCorreção do catálogo local aplicada e verificada." -ForegroundColor Green
    Write-Host "Nenhum ambiente remoto ou de produção foi acessado." -ForegroundColor Green
}
catch {
    Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
    throw
}
finally {
    & docker exec $dbContainer rm -f $containerSqlPath $containerVerifyPath 2>$null | Out-Null
}
