[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$DbHost,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$DbUser,

    [ValidateRange(1, 65535)]
    [int]$DbPort = 5432,

    [ValidateNotNullOrEmpty()]
    [string]$DbName = 'postgres'
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'eltxmfgrbobinzchtxme'

if ((-not $DbHost.Contains($expectedProjectRef)) -and (-not $DbUser.EndsWith('.' + $expectedProjectRef, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Host ou usuario nao identifica o projeto oficial $expectedProjectRef. Confira os dados em Supabase > Connect. Nenhuma conexao foi aberta."
}

function Get-TextMd5 {
    param([Parameter(Mandatory = $true)][string]$Text)
    $md5 = [System.Security.Cryptography.MD5]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $md5.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $md5.Dispose()
    }
}

Write-Host '=== RECUPERACAO LOCAL DO HISTORICO REMOTO ===' -ForegroundColor Cyan
Write-Host 'Operacao: somente SELECT no Supabase; escrita apenas nos arquivos locais.'
Write-Host 'Nenhuma migration sera aplicada, reparada ou enviada ao banco.'

$repoRootResult = & git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or -not $repoRootResult) {
    throw 'Execute este script dentro da raiz de um repositorio Git.'
}
$repoRoot = [System.IO.Path]::GetFullPath(($repoRootResult | Select-Object -First 1).Trim())
$configPath = Join-Path $repoRoot 'supabase\config.toml'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "supabase\config.toml nao encontrado em: $repoRoot"
}

$psql = $null
$candidate = Join-Path $env:ProgramFiles 'PostgreSQL\17\bin\psql.exe'
if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    $psql = $candidate
}
else {
    $command = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($command) { $psql = $command.Source }
}
if (-not $psql) {
    throw 'psql.exe nao encontrado. Instale/use PostgreSQL 17 ou informe o psql no PATH.'
}

# R3: SQL enviado por arquivo UTF-8; resultado dividido em linhas JSON sem agregacao.
# Os nomes/timestamps e fingerprints abaixo foram lidos do ledger remoto em 2026-11-02.
# O script exige correspondencia exata antes de gravar qualquer arquivo.
$query = @'
BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'version', version,
  'name', name,
  'statement_count', cardinality(statements),
  'sql_hex', encode(convert_to(statements[1], 'UTF8'), 'hex'),
  'sql_chars', length(statements[1]),
  'sql_md5', md5(array_to_string(statements, E'\n'))
)::text
FROM supabase_migrations.schema_migrations
WHERE version IN ('20261012164134', '20261012221223')
ORDER BY version;
COMMIT;
'@

$oldPgSslMode = $env:PGSSLMODE
$oldPgClientEncoding = $env:PGCLIENTENCODING
$oldConsoleOutputEncoding = [Console]::OutputEncoding
$queryFile = Join-Path ([System.IO.Path]::GetTempPath()) ("restore-remote-migration-history-" + [guid]::NewGuid().ToString('N') + '.sql')
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$env:PGSSLMODE = 'require'
$env:PGCLIENTENCODING = 'UTF8'
[Console]::OutputEncoding = $utf8NoBom
try {
    # O SQL multilinha e transportado por arquivo, evitando quoting/limites
    # de argumentos nativos do PowerShell ao chamar psql.exe.
    [System.IO.File]::WriteAllText($queryFile, $query.Trim() + "`n", $utf8NoBom)

    Write-Host "Conectando somente para leitura: $DbUser@$DbHost`:$DbPort/$DbName"
    Write-Host 'O psql solicitara a senha interativamente; ela nao sera gravada pelo script.'

    $psqlArgs = @(
        '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-W',
        '-h', $DbHost, '-p', $DbPort.ToString(), '-U', $DbUser, '-d', $DbName,
        '-f', $queryFile
    )
    $rawOutput = & $psql @psqlArgs
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "psql terminou com codigo $exitCode. Nenhum arquivo foi escrito."
    }
}
finally {
    if (Test-Path -LiteralPath $queryFile) {
        Remove-Item -LiteralPath $queryFile -Force -ErrorAction SilentlyContinue
    }
    if ($null -eq $oldPgSslMode) { Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue }
    else { $env:PGSSLMODE = $oldPgSslMode }
    if ($null -eq $oldPgClientEncoding) { Remove-Item Env:PGCLIENTENCODING -ErrorAction SilentlyContinue }
    else { $env:PGCLIENTENCODING = $oldPgClientEncoding }
    [Console]::OutputEncoding = $oldConsoleOutputEncoding
}

# R3: uma linha JSON independente por migration. Evita jsonb_agg + parser
# de array gigante, que no Windows PowerShell 5.1 pode colapsar a resposta.
# O SQL e transportado em hexadecimal sem quebras de linha e decodificado localmente.
$jsonLines = @($rawOutput | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne '' })
if ($jsonLines.Count -ne 2) {
    $lineLengths = ($jsonLines | ForEach-Object { $_.Length }) -join ', '
    throw "Esperadas 2 linhas JSON (uma por migration); recebidas $($jsonLines.Count). Comprimentos: [$lineLengths]. Nenhum arquivo foi escrito."
}

$rows = @()
foreach ($jsonLine in $jsonLines) {
    try { $rows += ($jsonLine | ConvertFrom-Json) }
    catch { throw "Resposta JSON individual do banco invalida: $($_.Exception.Message). Nenhum arquivo foi escrito." }
}
if ($rows.Count -ne 2) {
    throw "Esperados 2 objetos JSON; recebidos $($rows.Count). Nenhum arquivo foi escrito."
}

$expected = @{
    '20261012164134' = @{
        name = 'return_stale_slot_conflicts_without_database_errors'
        chars = 14267
        md5 = 'f64554e2c0bf7e4404392de3f3de7b25'
        file = '20261012164134_return_stale_slot_conflicts_without_database_errors.sql'
    }
    '20261012221223' = @{
        name = 'prevent_postgrest_rpc_retry'
        chars = 1713
        md5 = '921148de90a316961346b21145472b7d'
        file = '20261012221223_prevent_postgrest_rpc_retry.sql'
    }
}

$validated = @()
foreach ($row in $rows) {
    $version = [string]$row.version
    if (-not $expected.ContainsKey($version)) {
        throw "Versao remota inesperada: $version. Nenhum arquivo foi escrito."
    }
    $spec = $expected[$version]
    if ([string]$row.name -ne $spec.name) {
        throw "Nome divergente para $version. Nenhum arquivo foi escrito."
    }
    if ([int]$row.statement_count -ne 1) {
        throw "A migration $version nao contem exatamente um statement. Nenhum arquivo foi escrito."
    }
    if ([int]$row.sql_chars -ne $spec.chars) {
        throw "Tamanho divergente para $version. Nenhum arquivo foi escrito."
    }
    if ([string]$row.sql_md5 -ne $spec.md5) {
        throw "Fingerprint remoto divergente para $version. Nenhum arquivo foi escrito."
    }
    $sqlHex = [string]$row.sql_hex
    if ([string]::IsNullOrWhiteSpace($sqlHex) -or ($sqlHex.Length % 2) -ne 0 -or $sqlHex -notmatch '^[0-9a-fA-F]+$') {
        throw "Conteudo hexadecimal invalido para $version. Nenhum arquivo foi escrito."
    }
    $sqlBytes = New-Object byte[] ($sqlHex.Length / 2)
    for ($i = 0; $i -lt $sqlBytes.Length; $i++) {
        $sqlBytes[$i] = [Convert]::ToByte($sqlHex.Substring($i * 2, 2), 16)
    }
    $sqlText = [System.Text.Encoding]::UTF8.GetString($sqlBytes)
    if ($sqlText.Length -ne $spec.chars) {
        throw "Tamanho do SQL decodificado diverge para $version. Nenhum arquivo foi escrito."
    }
    $localMd5 = Get-TextMd5 -Text $sqlText
    if ($localMd5 -ne $spec.md5) {
        throw "Fingerprint UTF-8 do SQL retornado diverge para $version. Nenhum arquivo foi escrito."
    }
    $validated += [pscustomobject]@{
        version = $version
        name = $spec.name
        file = $spec.file
        sql = $sqlText
        chars = [int]$row.sql_chars
        md5 = [string]$row.sql_md5
    }
}

# Validar todos os destinos antes da primeira escrita local.
$migrationDir = Join-Path $repoRoot 'supabase\migrations'
$manifestDir = Join-Path $repoRoot 'docs\sql\production-release'
$manifestPath = Join-Path $manifestDir 'remote-migration-history-recovery.json'
$manifest = @()

foreach ($item in ($validated | Sort-Object version)) {
    $target = Join-Path $migrationDir $item.file
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        $existing = [System.IO.File]::ReadAllText($target, [System.Text.Encoding]::UTF8)
        if ((Get-TextMd5 -Text $existing) -ne $item.md5) {
            throw "O arquivo ja existe com conteudo diferente: $target. Nenhum destino sera alterado."
        }
    }
}

foreach ($item in ($validated | Sort-Object version)) {
    $manifest += [pscustomobject]@{
        version = $item.version
        name = $item.name
        file = "supabase/migrations/$($item.file)"
        sql_chars = $item.chars
        sql_md5_utf8 = $item.md5
        source = 'supabase_migrations.schema_migrations remoto'
        applied_remotely = $true
        sql_executed_by_this_script = $false
    }
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $existingManifest = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
    if ($existingManifest.Trim() -ne $manifestJson.Trim()) {
        throw "O manifesto ja existe com conteudo diferente: $manifestPath. Nenhum destino sera alterado."
    }
}

# Somente agora, depois de validar os dois SQLs e todos os destinos, gravar arquivos locais.
New-Item -ItemType Directory -Path $migrationDir -Force | Out-Null
foreach ($item in ($validated | Sort-Object version)) {
    $target = Join-Path $migrationDir $item.file
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        Write-Host "JA EXISTE E CONFERE: $($item.file)" -ForegroundColor Yellow
    }
    else {
        [System.IO.File]::WriteAllText($target, $item.sql, $utf8NoBom)
        Write-Host "RESTAURADO LOCALMENTE: $($item.file)" -ForegroundColor Green
    }
}

New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    [System.IO.File]::WriteAllText($manifestPath, $manifestJson + "`n", $utf8NoBom)
}

Write-Host ''
Write-Host '=== CONCLUIDO ===' -ForegroundColor Green
Write-Host 'Foram restaurados/alinhados localmente somente os dois arquivos historicos encontrados no ledger remoto.'
Write-Host 'Nenhum SQL foi executado no banco; nenhuma linha do ledger foi alterada.'
Write-Host 'Manifesto: docs\sql\production-release\remote-migration-history-recovery.json'
Write-Host ''
Write-Host 'Proxima verificacao recomendada (somente leitura): supabase migration list'
Write-Host 'NAO execute db push, migration repair ou db reset --linked como parte desta etapa.'
