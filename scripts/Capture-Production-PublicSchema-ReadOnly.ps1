[CmdletBinding()]
param(
    [string]$ExpectedProjectRef = 'eltxmfgrbobinzchtxme',
    [string]$OutputDirectory = 'docs/sql/production-release/baseline'
)

$ErrorActionPreference = 'Stop'

function Stop-ReleaseCapture([string]$Message) {
    Write-Host "BLOQUEADO: $Message" -ForegroundColor Red
    exit 1
}

$repoRoot = (Get-Location).Path
$configPath = Join-Path $repoRoot 'supabase/config.toml'
$linkedRefPath = Join-Path $repoRoot 'supabase/.temp/project-ref'

Write-Host '=== CAPTURA READ-ONLY DO SCHEMA PUBLIC ===' -ForegroundColor Cyan
Write-Host 'Remoto: somente pg_dump/schema; nenhuma migration, DDL, DML ou repair será executado.'
Write-Host 'Local: será criado um SQL de estrutura e um manifesto de captura.'

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    Stop-ReleaseCapture 'Execute na raiz C:\Projetos\endere-amento; supabase/config.toml não encontrado.'
}
if (-not (Test-Path -LiteralPath $linkedRefPath -PathType Leaf)) {
    Stop-ReleaseCapture 'Vínculo local ausente: supabase/.temp/project-ref não encontrado. Não execute link automaticamente.'
}

$linkedRef = (Get-Content -LiteralPath $linkedRefPath -Raw).Trim()
if ($linkedRef -ne $ExpectedProjectRef) {
    Stop-ReleaseCapture "Projeto vinculado divergente. Esperado $ExpectedProjectRef; encontrado '$linkedRef'."
}

if ($env:SUPABASE_PROJECT_ID -and $env:SUPABASE_PROJECT_ID -ne $ExpectedProjectRef) {
    Stop-ReleaseCapture "SUPABASE_PROJECT_ID aponta para '$env:SUPABASE_PROJECT_ID', diferente do projeto oficial."
}

$cliVersion = (& supabase --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Stop-ReleaseCapture 'Não foi possível identificar a versão da Supabase CLI.' }
if ($cliVersion -notmatch '^2\.') {
    Stop-ReleaseCapture "Script preparado para a CLI v2 usada nesta sessão (2.118.0). Versão encontrada: $cliVersion. Não adapte flags automaticamente."
}

$targetDir = Join-Path $repoRoot $OutputDirectory
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$sqlPath = Join-Path $targetDir "${ExpectedProjectRef}_public_schema_${stamp}.sql"
$manifestPath = Join-Path $targetDir "${ExpectedProjectRef}_public_schema_${stamp}.manifest.json"
if (Test-Path -LiteralPath $sqlPath) { Stop-ReleaseCapture "O destino já existe: $sqlPath" }
if (Test-Path -LiteralPath $manifestPath) { Stop-ReleaseCapture "O manifesto já existe: $manifestPath" }

Write-Host "Projeto confirmado: $linkedRef" -ForegroundColor Green
Write-Host "CLI: $cliVersion"
Write-Host 'Executando: supabase db dump --linked --schema public --file <arquivo> --keep-comments'

$dumpArgs = @('db','dump','--linked','--schema','public','--file',$sqlPath,'--keep-comments')
& supabase @dumpArgs
$dumpExit = $LASTEXITCODE
if ($dumpExit -ne 0) {
    if (Test-Path -LiteralPath $sqlPath) { Remove-Item -LiteralPath $sqlPath -Force }
    Stop-ReleaseCapture "supabase db dump encerrou com código $dumpExit. Arquivo parcial removido; remoto não foi alterado."
}

if (-not (Test-Path -LiteralPath $sqlPath -PathType Leaf)) {
    Stop-ReleaseCapture 'A CLI informou sucesso, mas o arquivo de dump não foi encontrado.'
}

$item = Get-Item -LiteralPath $sqlPath
if ($item.Length -lt 1000) {
    Remove-Item -LiteralPath $sqlPath -Force
    Stop-ReleaseCapture 'Dump menor que 1 KB; arquivo removido por parecer incompleto.'
}

$hash = (Get-FileHash -LiteralPath $sqlPath -Algorithm SHA256).Hash.ToLowerInvariant()
$content = Get-Content -LiteralPath $sqlPath -Raw
$dropLines = @($content -split "`r?`n" | Where-Object { $_ -match '^\s*DROP\s+(TABLE|FUNCTION|POLICY|TYPE|SEQUENCE|VIEW|TRIGGER|SCHEMA|EXTENSION)\b' })
$copyLines = @($content -split "`r?`n" | Where-Object { $_ -match '^\s*(COPY|INSERT\s+INTO)\s+public\.' })

$manifest = [ordered]@{
    capture_type = 'read_only_public_schema_dump'
    project_ref = $ExpectedProjectRef
    linked_project_ref = $linkedRef
    cli_version = $cliVersion
    captured_at_local = (Get-Date).ToString('o')
    schema_scope = @('public')
    includes_table_data = $false
    includes_custom_database_roles = $false
    changes_remote_migration_ledger = $false
    remote_ddl_dml_or_grants_executed = $false
    output_file = [IO.Path]::GetFileName($sqlPath)
    size_bytes = $item.Length
    sha256 = $hash
    top_level_drop_statement_count = $dropLines.Count
    public_data_statement_count = $copyLines.Count
    review_required = ($dropLines.Count -gt 0 -or $copyLines.Count -gt 0)
    notes = @(
      'Dump gerado por supabase db dump; não é uma migration autorizada para execução.',
      'O dump de schema não contém dados operacionais nem as roles gerenciadas pelo Supabase.',
      'Revisar ownership, ACLs, policies, funções e dependências antes de promover a baseline.',
      'Não executar db pull, db push, migration repair ou db reset --linked nesta etapa.'
    )
}
$json = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($manifestPath, $json, [Text.UTF8Encoding]::new($false))

Write-Host ''
Write-Host '=== CAPTURA CONCLUÍDA ===' -ForegroundColor Green
Write-Host "SQL: $sqlPath"
Write-Host "Manifesto: $manifestPath"
Write-Host "Tamanho: $($item.Length) bytes"
Write-Host "SHA-256: $hash"
Write-Host "Linhas DROP top-level: $($dropLines.Count)"
Write-Host "Linhas de dados public: $($copyLines.Count)"
if ($manifest.review_required) {
    Write-Host 'ATENÇÃO: o manifesto marcou o dump para revisão manual antes de qualquer baseline.' -ForegroundColor Yellow
} else {
    Write-Host 'Nenhum DROP top-level nem comando de dados public foi detectado; a revisão de conteúdo ainda é obrigatória.' -ForegroundColor Green
}
Write-Host 'Nenhuma alteração foi feita no banco remoto.'
