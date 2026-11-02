$ErrorActionPreference = "Stop"

$ContainerName = "supabase_db_enderecamento-integracao-local"
$ExpectedRoles = @("administrador", "apoio", "producao", "visualizador", "lideranca")
$ExpectedComposeProject = "enderecamento-integracao-local"
$ExpectedSupabaseProject = "enderecamento-integracao-local"
$ExpectedWorkdir = "c:\testes\enderecamento_integracao_local"

$InspectOutput = & docker inspect $ContainerName 2>$null | Out-String
$InspectExitCode = $LASTEXITCODE
if ($InspectExitCode -ne 0 -or -not $InspectOutput) {
    throw "BLOQUEADO: container local esperado não foi encontrado."
}
try {
    $ContainerInfo = @($InspectOutput | ConvertFrom-Json)[0]
}
catch {
    throw "BLOQUEADO: não foi possível interpretar a identidade do container."
}
if ($ContainerInfo.State.Running -ne $true) {
    throw "BLOQUEADO: clone local de integração não está em execução; o script não iniciará containers."
}
if ($ContainerInfo.Name.Trim() -ne "/$ContainerName") {
    throw "BLOQUEADO: nome do container não corresponde ao clone local esperado."
}

$Labels = $ContainerInfo.Config.Labels
if ($Labels.'com.docker.compose.project' -ne $ExpectedComposeProject) {
    throw "BLOQUEADO: label do projeto Docker inesperado."
}
if ($Labels.'com.supabase.cli.project' -ne $ExpectedSupabaseProject) {
    throw "BLOQUEADO: label do projeto Supabase inesperado."
}
$ActualWorkdir = ([string]$Labels.'com.supabase.cli.workdir').Replace('/', '\').TrimEnd('\').ToLowerInvariant()
if ($ActualWorkdir -ne $ExpectedWorkdir) {
    throw "BLOQUEADO: workdir do container não corresponde ao clone local esperado: '$ActualWorkdir'."
}

$DatabaseInfo = docker exec $ContainerName psql -X -At -U postgres -d postgres -c "SELECT current_database() || '|' || current_setting('server_version');"
if ($LASTEXITCODE -ne 0 -or $DatabaseInfo.Trim() -notmatch '^postgres\|17\.') {
    throw "BLOQUEADO: esperado banco postgres no PostgreSQL 17 do clone local."
}

function Invoke-LocalPsqlFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Sql,
        [Parameter(Mandatory = $true)]
        [string[]]$PsqlArguments
    )

    $Token = [guid]::NewGuid().ToString("N")
    $HostSqlPath = Join-Path ([System.IO.Path]::GetTempPath()) "permission-rls-check-$Token.sql"
    $ContainerSqlPath = "/tmp/permission-rls-check-$Token.sql"
    $ContainerSqlCopied = $false
    $Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

    try {
        [System.IO.File]::WriteAllText($HostSqlPath, $Sql, $Utf8NoBom)

        docker cp $HostSqlPath "$($ContainerName):$ContainerSqlPath" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao transferir consulta SQL temporária para o container local."
        }
        $ContainerSqlCopied = $true

        $Arguments = @()
        $Arguments += $PsqlArguments
        $Arguments += @("-f", $ContainerSqlPath)

        $Output = @(& docker exec $ContainerName psql @Arguments)
        $PsqlExitCode = $LASTEXITCODE
        if ($PsqlExitCode -ne 0) {
            $Diagnostic = $Output -join [Environment]::NewLine
            throw "Consulta psql falhou (exit code $PsqlExitCode). $Diagnostic"
        }

        return $Output
    }
    finally {
        if ($ContainerSqlCopied) {
            docker exec $ContainerName rm -f $ContainerSqlPath 2>$null | Out-Null
        }
        if (Test-Path $HostSqlPath) {
            Remove-Item -LiteralPath $HostSqlPath -Force
        }
    }
}

Write-Host "`n=== MATRIZ INSTALADA ===" -ForegroundColor Cyan
$MatrixSql = @'
SELECT
  count(*) FILTER (WHERE is_active) AS active_permissions,
  (SELECT count(*) FROM public.role_permissions) AS permission_rows,
  (SELECT count(DISTINCT role) FROM public.role_permissions) AS roles
FROM public.permission_catalog;
'@
$MatrixOutput = Invoke-LocalPsqlFile -Sql $MatrixSql -PsqlArguments @(
    "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-P", "pager=off"
)
$MatrixOutput | ForEach-Object { Write-Host $_ }
$MatrixLines = @($MatrixOutput | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -match '^\d+\|\d+\|\d+$' })
if ($MatrixLines.Count -ne 1 -or $MatrixLines[0] -ne "29|145|5") {
    throw "BLOQUEADO: matriz instalada divergente; esperados 29 permissões ativas, 145 concessões e cinco papéis."
}

Write-Host "`n=== PREFLIGHT RLS B6.2B JA APLICADA ===" -ForegroundColor Cyan
$B62BStateSql = @'
SELECT
  (SELECT count(*) FROM pg_catalog.pg_policies
   WHERE schemaname='public'
     AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions')
     AND cmd='SELECT'
     AND policyname IN (
       'slots_select_permission_catalog','history_select_permission_catalog',
       'divergencias_select_permission_catalog','products_select_permission_catalog',
       'warehouse_layout_select_permission_catalog','warehouse_layout_positions_select_permission_catalog'
     )
     AND COALESCE(qual,'') ILIKE '%has_app_permission%')
  || '|' ||
  (SELECT count(*) FROM pg_catalog.pg_policies
   WHERE schemaname='public'
     AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions')
     AND cmd='SELECT')
  || '|' ||
  (SELECT count(*) FROM pg_catalog.pg_policies
   WHERE schemaname='public'
     AND tablename IN ('slots','history','divergencias','products','warehouse_layout','warehouse_layout_positions')
     AND cmd='SELECT'
     AND (COALESCE(qual,'') ILIKE '%has_app_role%' OR policyname IN (
       'slots_select_authenticated','history_select_authenticated','divergencias_select_authenticated',
       'products_select_authenticated','warehouse_layout_select_authenticated',
       'warehouse_layout_positions_select_authenticated'
     )))
  || '|' ||
  (SELECT count(*) FROM pg_catalog.pg_policies
   WHERE schemaname='public'
     AND tablename IN ('slots','history','divergencias','warehouse_layout','warehouse_layout_positions')
     AND cmd IN ('INSERT','UPDATE','DELETE','ALL'))
  || '|' ||
  CASE WHEN NOT (
    pg_catalog.has_table_privilege('authenticated','public.slots','INSERT') OR
    pg_catalog.has_table_privilege('authenticated','public.slots','UPDATE') OR
    pg_catalog.has_table_privilege('authenticated','public.slots','DELETE') OR
    pg_catalog.has_table_privilege('authenticated','public.history','INSERT') OR
    pg_catalog.has_table_privilege('authenticated','public.history','UPDATE') OR
    pg_catalog.has_table_privilege('authenticated','public.history','DELETE') OR
    pg_catalog.has_table_privilege('authenticated','public.divergencias','INSERT') OR
    pg_catalog.has_table_privilege('authenticated','public.divergencias','UPDATE') OR
    pg_catalog.has_table_privilege('authenticated','public.divergencias','DELETE') OR
    pg_catalog.has_table_privilege('authenticated','public.warehouse_layout','INSERT') OR
    pg_catalog.has_table_privilege('authenticated','public.warehouse_layout','UPDATE') OR
    pg_catalog.has_table_privilege('authenticated','public.warehouse_layout','DELETE') OR
    pg_catalog.has_table_privilege('authenticated','public.warehouse_layout_positions','INSERT') OR
    pg_catalog.has_table_privilege('authenticated','public.warehouse_layout_positions','UPDATE') OR
    pg_catalog.has_table_privilege('authenticated','public.warehouse_layout_positions','DELETE')
  ) THEN '1' ELSE '0' END
  || '|' ||
  (SELECT count(*) FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND tablename='products'
     AND policyname IN ('products_insert_permission','products_update_permission','products_delete_permission')
     AND (COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) ILIKE '%has_app_permission%')
  || '|' ||
  (SELECT count(*) FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND tablename='products'
     AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
     AND policyname NOT IN ('products_insert_permission','products_update_permission','products_delete_permission'))
  || '|' ||
  CASE WHEN NOT pg_catalog.has_function_privilege('anon','public.update_slot_metadata_atomic(jsonb,jsonb)','EXECUTE')
         AND pg_catalog.has_function_privilege('authenticated','public.update_slot_metadata_atomic(jsonb,jsonb)','EXECUTE')
       THEN '1' ELSE '0' END;
'@
$B62BStateOutput = @(Invoke-LocalPsqlFile -Sql $B62BStateSql -PsqlArguments @(
    "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"
))
$B62BStateLines = @($B62BStateOutput | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -match '^\d+\|\d+\|\d+\|\d+\|[01]\|\d+\|\d+\|[01]$' })
if ($B62BStateLines.Count -ne 1 -or $B62BStateLines[0] -ne "6|6|0|0|1|3|0|1") {
    $Diagnostic = $B62BStateOutput -join [Environment]::NewLine
    throw "BLOQUEADO: estado B6.2B no confirmado ou divergente. Esperado 6|6|0|0|1|3|0|1. $Diagnostic"
}
Write-Host "PASS: seis políticas de leitura configuráveis, sem políticas antigas de papel/DML direto e ACL esperada." -ForegroundColor Green

Write-Host "`n=== IDENTIDADE LOCAL PARA SIMULACAO DOS CINCO PAPEIS ===" -ForegroundColor Cyan
# The integration clone may contain only real administrator/production accounts.
# Use one existing Auth-backed profile without user overrides, temporarily switch
# its role inside each transaction, and ROLLBACK every simulation. No fixture user
# is created and no profile/role change is persisted.
$ProfilesSql = @'
SELECT p.id::text || '|' || p.role
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_permission_overrides upo
  WHERE upo.user_id = p.id
)
ORDER BY
  CASE pg_catalog.lower(pg_catalog.btrim(p.role))
    WHEN 'administrador' THEN 0
    WHEN 'producao' THEN 1
    ELSE 2
  END,
  p.id::text
LIMIT 1;
'@
$ProfileRows = @(
    Invoke-LocalPsqlFile -Sql $ProfilesSql -PsqlArguments @(
        "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"
    )
)
$ProfileCandidates = @(
    $ProfileRows |
        ForEach-Object { "$($_)".Trim() } |
        Where-Object { $_ -match '^[0-9a-fA-F-]{36}\|[a-z_]+$' }
)
if ($ProfileCandidates.Count -ne 1) {
    throw "Não foi encontrada exatamente uma identidade local válida sem overrides pessoais. Nenhum teste RLS foi iniciado."
}
$ProfileParts = $ProfileCandidates[0] -split "\|", 2
$TestUserId = $ProfileParts[0]
$OriginalRole = $ProfileParts[1]
if ($ExpectedRoles -notcontains $OriginalRole) {
    throw "Papel original da identidade de teste não pertence à matriz esperada. Nenhum teste RLS foi iniciado."
}
Write-Host "Identidade Auth existente selecionada: $TestUserId (papel original: $OriginalRole)" -ForegroundColor Green
Write-Host "Os cinco papéis serão simulados em transações individuais com ROLLBACK; nenhuma conta será criada." -ForegroundColor DarkCyan

Write-Host "`n=== CONTAGEM AUTORITATIVA (POSTGRES / SEM RLS) ===" -ForegroundColor Cyan
$CountsSql = @'
SELECT 'slots|' || count(*) FROM public.slots
UNION ALL SELECT 'divergencias|' || count(*) FROM public.divergencias
UNION ALL SELECT 'products|' || count(*) FROM public.products
UNION ALL SELECT 'warehouse_layout|' || count(*) FROM public.warehouse_layout
UNION ALL SELECT 'warehouse_layout_positions|' || count(*) FROM public.warehouse_layout_positions;
'@
$CountRows = @(
    Invoke-LocalPsqlFile -Sql $CountsSql -PsqlArguments @(
        "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"
    )
)

$AdminCounts = @{}
foreach ($Row in $CountRows) {
    $Parts = "$Row".Trim() -split "\|"
    if ($Parts.Count -eq 2) { $AdminCounts[$Parts[0]] = [long]$Parts[1] }
}

$RequiredTables = @("slots", "divergencias", "products", "warehouse_layout", "warehouse_layout_positions")
$MissingCounts = @($RequiredTables | Where-Object { -not $AdminCounts.ContainsKey($_) })
if ($MissingCounts.Count -gt 0) {
    throw "Contagens autoritativas incompletas. Tabelas sem resultado: $($MissingCounts -join ', ')."
}

$PermissionExpressions = @{
    slots = @"
public.has_app_permission('dashboard.view')
OR public.has_app_permission('stock.search')
OR public.has_app_permission('stock.details.view')
OR public.has_app_permission('stock.launch.view')
OR public.has_app_permission('stock.launch.create')
OR public.has_app_permission('stock.transfer.create')
OR public.has_app_permission('stock.batch.process')
OR public.has_app_permission('stock.physical_correction')
OR public.has_app_permission('divergences.resolve')
OR public.has_app_permission('map.view')
OR public.has_app_permission('map.metadata.edit')
OR public.has_app_permission('consultor.use')
"@
    history = "public.has_app_permission('history.view')"
    divergencias = "public.has_app_permission('divergences.view') OR public.has_app_permission('divergences.resolve')"
    products = @"
public.has_app_permission('products.view')
OR public.has_app_permission('products.create')
OR public.has_app_permission('products.edit')
OR public.has_app_permission('products.import_bulk')
OR public.has_app_permission('products.delete_deactivate')
OR public.has_app_permission('stock.search')
OR public.has_app_permission('stock.details.view')
OR public.has_app_permission('stock.launch.view')
OR public.has_app_permission('stock.launch.create')
OR public.has_app_permission('stock.transfer.create')
OR public.has_app_permission('stock.batch.process')
OR public.has_app_permission('consultor.use')
"@
    warehouse_layout = @"
public.has_app_permission('warehouse.layout.view')
OR public.has_app_permission('warehouse.layout.manage')
OR public.has_app_permission('map.view')
OR public.has_app_permission('dashboard.view')
OR public.has_app_permission('stock.physical_correction')
"@
    warehouse_layout_positions = @"
public.has_app_permission('warehouse.layout.view')
OR public.has_app_permission('warehouse.layout.manage')
OR public.has_app_permission('map.view')
OR public.has_app_permission('dashboard.view')
OR public.has_app_permission('stock.physical_correction')
"@
}

$Failures = [System.Collections.Generic.List[string]]::new()
$Passed = 0
$Inconclusive = 0
$HistoryFixtureId = "B62B_RLS_" + [guid]::NewGuid().ToString("N")

foreach ($Role in $ExpectedRoles) {
    Write-Host "`n--- RLS como $Role (simulação transacional) ---" -ForegroundColor Yellow

    $Sql = @"
BEGIN;
DO `$role_fixture`$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.profiles
     SET role = '$Role'
   WHERE id = '$TestUserId'::uuid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'B62B_RLS_ROLE_FIXTURE_PROFILE_NOT_UPDATED: role %, rows %', '$Role', v_updated;
  END IF;
END;
`$role_fixture`$;

INSERT INTO public.history (
    id,
    tipo,
    restricao,
    observacao
)
VALUES (
    '$HistoryFixtureId',
    'B62B_RLS_TEST',
    'teste',
    'Temporary fixture for B6.2B RLS verification; rolled back.'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '$TestUserId';
SET LOCAL "request.jwt.claims" = '{"sub":"$TestUserId","role":"authenticated"}';

SELECT
  '$Role',
  ($($PermissionExpressions.slots)) AS exp_slots,
  (SELECT count(*) FROM public.slots) AS slots_visible,
  ($($PermissionExpressions.history)) AS exp_history,
  (SELECT count(*) FROM public.history WHERE id = '$HistoryFixtureId') AS history_visible,
  ($($PermissionExpressions.divergencias)) AS exp_divergencias,
  (SELECT count(*) FROM public.divergencias) AS divergencias_visible,
  ($($PermissionExpressions.products)) AS exp_products,
  (SELECT count(*) FROM public.products) AS products_visible,
  ($($PermissionExpressions.warehouse_layout)) AS exp_warehouse_layout,
  (SELECT count(*) FROM public.warehouse_layout) AS warehouse_layout_visible,
  ($($PermissionExpressions.warehouse_layout_positions)) AS exp_warehouse_positions,
  (SELECT count(*) FROM public.warehouse_layout_positions) AS warehouse_positions_visible;

ROLLBACK;
"@

    $Result = Invoke-LocalPsqlFile -Sql $Sql -PsqlArguments @(
        "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-F", "|", "-v", "ON_ERROR_STOP=1"
    )

    $DataLine = @($Result | Where-Object { "$($_)".Trim().StartsWith("$Role|", [System.StringComparison]::Ordinal) } | Select-Object -Last 1)
    if ($DataLine.Count -ne 1) {
        throw "Resultado RLS ausente ou ambíguo para $Role."
    }

    $Values = "$($DataLine[0])".Trim() -split "\|"
    if ($Values.Count -ne 13) {
        throw "Formato inesperado de resultado RLS para ${Role}: $($Values.Count) colunas."
    }

    $Checks = @(
        @{ Table = "slots"; Expected = ($Values[1] -in @("t", "true")); Visible = [long]$Values[2] },
        @{ Table = "history"; Expected = ($Values[3] -in @("t", "true")); Visible = [long]$Values[4] },
        @{ Table = "divergencias"; Expected = ($Values[5] -in @("t", "true")); Visible = [long]$Values[6] },
        @{ Table = "products"; Expected = ($Values[7] -in @("t", "true")); Visible = [long]$Values[8] },
        @{ Table = "warehouse_layout"; Expected = ($Values[9] -in @("t", "true")); Visible = [long]$Values[10] },
        @{ Table = "warehouse_layout_positions"; Expected = ($Values[11] -in @("t", "true")); Visible = [long]$Values[12] }
    )

    foreach ($Check in $Checks) {
        if ($Check.Table -eq "history") {
            $ExpectedFixtureRows = if ($Check.Expected) { [long]1 } else { [long]0 }

            if ($Check.Visible -ne $ExpectedFixtureRows) {
                $Failures.Add("$Role/history: esperava $ExpectedFixtureRows registro(s) visível(is), retornou $($Check.Visible).")
                Write-Host "FAIL: history esperava $ExpectedFixtureRows, retornou $($Check.Visible)." -ForegroundColor Red
            }
            else {
                $Passed++

                if ($Check.Expected) {
                    Write-Host "PASS: history permitiu a leitura do registro temporário." -ForegroundColor Green
                }
                else {
                    Write-Host "PASS: history negou a leitura conforme catálogo." -ForegroundColor Green
                }
            }

            continue
        }

        $Total = [long]$AdminCounts[$Check.Table]

        if (-not $Check.Expected) {
            if ($Check.Visible -ne 0) {
                $Failures.Add("$Role/$($Check.Table): deveria negar, mas retornou $($Check.Visible) linhas.")
                Write-Host "FAIL: $($Check.Table) deveria negar, retornou $($Check.Visible)" -ForegroundColor Red
            }
            else {
                $Passed++
                Write-Host "PASS: $($Check.Table) negado conforme catálogo." -ForegroundColor Green
            }
        }
        elseif ($Total -eq 0) {
            $Inconclusive++
            Write-Host "INCONCLUSIVO: $($Check.Table) sem registros para confirmar leitura permitida." -ForegroundColor DarkYellow
        }
        elseif ($Check.Visible -ne $Total) {
            $Failures.Add("$Role/$($Check.Table): esperava $Total linhas, retornou $($Check.Visible).")
            Write-Host "FAIL: $($Check.Table) esperava $Total, retornou $($Check.Visible)" -ForegroundColor Red
        }
        else {
            $Passed++
            Write-Host "PASS: $($Check.Table) permitiu as $Total linhas conforme catálogo." -ForegroundColor Green
        }
    }
}

$FixturePostflightRows = @(Invoke-LocalPsqlFile -Sql "SELECT COUNT(*) FROM public.history WHERE id = '$HistoryFixtureId';" -PsqlArguments @(
    "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"
))

$FixturePostflightCounts = @(
    $FixturePostflightRows |
    ForEach-Object { "$_".Trim() } |
    Where-Object { $_ -match '^\d+$' }
)

if ($FixturePostflightCounts.Count -ne 1) {
    throw "Não foi possível confirmar a reversão do registro temporário de history."
}

if ([long]$FixturePostflightCounts[0] -ne 0) {
    throw "B62B_RLS_HISTORY_FIXTURE_PERSISTED: registro temporário permaneceu no banco."
}

Write-Host "PASS: registro temporário de history revertido; nenhum dado de teste permaneceu." -ForegroundColor Green

$ProfilePostflightRows = @(Invoke-LocalPsqlFile -Sql "SELECT role FROM public.profiles WHERE id = '$TestUserId'::uuid;" -PsqlArguments @(
    "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"
))
$ProfilePostflightRoles = @(
    $ProfilePostflightRows |
    ForEach-Object { "$($_)".Trim() } |
    Where-Object { $_ -ne '' }
)
if ($ProfilePostflightRoles.Count -ne 1 -or $ProfilePostflightRoles[0] -cne $OriginalRole) {
    throw "B62B_RLS_PROFILE_ROLE_NOT_RESTORED: papel original '$OriginalRole' não foi confirmado após os ROLLBACKs."
}
Write-Host "PASS: papel original do perfil restaurado ($OriginalRole)." -ForegroundColor Green

Write-Host "`nResumo RLS: $Passed aprovados; $($Failures.Count) falhas; $Inconclusive inconclusivos por tabela vazia." -ForegroundColor Cyan
if ($Failures.Count -gt 0) {
    $Failures | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    throw "Validação direta RLS encontrou falhas."
}
if ($Inconclusive -gt 0) {
    Write-Host "Atenção: permissões de leitura em tabelas sem registros não podem ser comprovadas por contagem; a política foi verificada estruturalmente pela migration." -ForegroundColor Yellow
}
Write-Host "PASS: leitura direta por perfil validada no clone local." -ForegroundColor Green
