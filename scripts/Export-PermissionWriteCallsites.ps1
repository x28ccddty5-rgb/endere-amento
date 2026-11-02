[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$sourceRoots = @(
    (Join-Path $root 'src'),
    (Join-Path $root 'supabase\functions')
)
$serverFile = Join-Path $root 'server.ts'
if (Test-Path -LiteralPath $serverFile) {
    $sourceRoots += $serverFile
}

$extensions = @('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs')
$knownTables = @(
    'slots',
    'history',
    'divergencias',
    'occupancy_history',
    'products',
    'profiles',
    'warehouse_layout',
    'warehouse_layout_positions',
    'physical_corrections',
    'permission_catalog',
    'role_permissions',
    'user_permission_overrides',
    'permission_change_audit'
)

$files = @()
foreach ($sourceRoot in $sourceRoots) {
    if (-not (Test-Path -LiteralPath $sourceRoot)) { continue }

    $item = Get-Item -LiteralPath $sourceRoot
    if ($item.PSIsContainer) {
        $files += Get-ChildItem -LiteralPath $sourceRoot -Recurse -File |
            Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() }
    } else {
        $files += $item
    }
}
$files = @($files | Sort-Object FullName -Unique)
if ($files.Count -eq 0) {
    throw 'No TypeScript/JavaScript source files found in src, supabase/functions or server.ts.'
}

$records = New-Object System.Collections.Generic.List[string]
$rpcSeen = @{}
$dmlSeen = @{}
$fromPattern = '\.from\s*\(\s*[''"]([^''"]+)[''"]\s*\)'
$rpcPattern = '\.rpc\s*\(\s*[''"]([^''"]+)[''"]'
$writePattern = '\.(insert|upsert|update|delete)\s*\('

foreach ($file in $files) {
    $content = @(Get-Content -LiteralPath $file.FullName -Encoding UTF8)
    $relative = $file.FullName.Substring($root.Length).TrimStart([char]'\', [char]'/')

    for ($i = 0; $i -lt $content.Count; $i++) {
        $line = $content[$i]

        foreach ($rpcMatch in [regex]::Matches($line, $rpcPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
            $functionName = $rpcMatch.Groups[1].Value
            $key = "$relative|$($i + 1)|$functionName"
            if (-not $rpcSeen.ContainsKey($key)) {
                $rpcSeen[$key] = $true
                $records.Add("RPC_CALLSITE|$relative|$($i + 1)|$functionName")
            }
        }

        foreach ($fromMatch in [regex]::Matches($line, $fromPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
            $table = $fromMatch.Groups[1].Value
            if ($knownTables -notcontains $table) { continue }

            $last = [Math]::Min($content.Count - 1, $i + 20)
            for ($j = $i; $j -le $last; $j++) {
                if ($j -gt $i -and [regex]::IsMatch($content[$j], $fromPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
                    break
                }

                foreach ($writeMatch in [regex]::Matches($content[$j], $writePattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
                    $method = $writeMatch.Groups[1].Value.ToUpperInvariant()
                    $key = "$relative|$($i + 1)|$table|$method|$($j + 1)"
                    if (-not $dmlSeen.ContainsKey($key)) {
                        $dmlSeen[$key] = $true
                        $records.Add("DIRECT_DML_CALLSITE|$relative|from_line=$($i + 1)|table=$table|method=$method|method_line=$($j + 1)")
                    }
                }
            }
        }
    }
}

$records = @($records | Sort-Object -Unique)
$rpcCount = @($records | Where-Object { $_ -like 'RPC_CALLSITE|*' }).Count
$dmlCount = @($records | Where-Object { $_ -like 'DIRECT_DML_CALLSITE|*' }).Count

$outDir = Join-Path $root 'docs\seguranca'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$outPath = Join-Path $outDir 'permission-write-callsite-inventory.txt'

$header = @(
    'ENDERECAMENTO - INVENTARIO ESTATICO DE CHAMADAS DE AUTORIZACAO E ESCRITA',
    "Gerado em: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')",
    "Raiz do codigo: $root",
    'Modo: leitura estatica dos arquivos-fonte; nenhum servidor, banco ou endpoint e chamado.',
    'Arquivos escaneados: src, supabase/functions e server.ts se existir.',
    'Nao foram lidos arquivos .env, node_modules, dist, banco de dados ou logs.',
    "RPC_CALLSITE_COUNT=$rpcCount",
    "DIRECT_DML_CALLSITE_COUNT=$dmlCount",
    '---'
)
$allLines = @($header) + $records
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllLines($outPath, [string[]]$allLines, $utf8Bom)

Write-Host 'INVENTARIO ESTATICO CONCLUIDO.'
Write-Host "Arquivos-fonte examinados: $($files.Count)"
Write-Host "Chamadas RPC encontradas: $(@($records | Where-Object { $_ -like 'RPC_CALLSITE|*' }).Count)"
Write-Host "Candidatos a DML direto encontrados: $(@($records | Where-Object { $_ -like 'DIRECT_DML_CALLSITE|*' }).Count)"
Write-Host "Arquivo: $outPath"
Write-Host 'Este resultado e um inventario estatico; revise falsos positivos e caminhos dinamicos.'
