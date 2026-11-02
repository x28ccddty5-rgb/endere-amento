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

function Stop-Safely([string]$Message) {
  Write-Host "`nBLOQUEADO: $Message" -ForegroundColor Red
  throw $Message
}
function Invoke-TargetQuery([string]$Sql, [string]$Label) {
  Write-Host "`n--- $Label ---" -ForegroundColor Cyan
  $prev = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -P pager=off -c $Sql 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev }
  $joined = ($lines | ForEach-Object { "$_" }) -join "`n"
  if ($code -ne 0) { Stop-Safely "Consulta '$Label' falhou:`n$joined" }
  $out = @($lines | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -ne '' })
  $out | ForEach-Object { Write-Host $_ }
  return $out
}
function Invoke-TargetSqlFile([string]$LocalPath, [string]$Label) {
  if (-not (Test-Path -LiteralPath $LocalPath -PathType Leaf)) { Stop-Safely "Arquivo obrigatório não encontrado: $LocalPath" }
  $containerPath = "/tmp/shared-draft-$([IO.Path]::GetFileName($LocalPath))"
  Write-Host "`n--- $Label ---" -ForegroundColor Cyan
  & docker cp $LocalPath "${TargetContainer}:$containerPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Safely 'Falha ao copiar SQL para o container local.' }
  try {
    $prev = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $output = & docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off -f $containerPath 2>&1
      $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    $output | ForEach-Object { Write-Host "$_" }
    if ($code -ne 0) { Stop-Safely "'$Label' falhou. Não repita a migration; envie a saída integral." }
  } finally { & docker exec $TargetContainer rm -f $containerPath | Out-Null }
}

Write-Host 'RUNNER_VERSION|SHARED-LANCAMENTO-DRAFT-COMPAT-LOCAL-V1' -ForegroundColor Green
Write-Host 'COMPATIBILIDADE DO LOTE COMPARTILHADO — SOMENTE BANCO LOCAL DE INTEGRAÇÃO' -ForegroundColor Yellow
Write-Host 'Não inicia/reinicia/remove containers, não acessa Supabase Cloud e não usa db push.'

$required = @(
  'docs/sql/migrations/20261029000000_shared_lancamento_draft_permission_compat.sql',
  'docs/sql/20261029000000_shared_lancamento_draft_verify.sql',
  'docs/sql/20261029000000_shared_lancamento_draft_smoke.sql'
)
foreach ($r in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $r) -PathType Leaf)) { Stop-Safely "Falta arquivo requerido: $r" }
}

$inspectRaw = & docker inspect $TargetContainer 2>$null
if ($LASTEXITCODE -ne 0 -or -not $inspectRaw) { Stop-Safely "Container exato '$TargetContainer' não encontrado." }
$ci = @($inspectRaw | ConvertFrom-Json)[0]
if ($ci.State.Running -ne $true) { Stop-Safely 'Container alvo não está em execução; script não irá iniciá-lo.' }
$labels = $ci.Config.Labels
if ($labels.'com.docker.compose.project' -ne $ExpectedComposeProject) { Stop-Safely 'Label do projeto Docker diferente.' }
$wd = ([string]$labels.'com.supabase.cli.workdir').Replace('/','\').TrimEnd('\').ToLowerInvariant()
if ($wd -ne $ExpectedWorkdir) { Stop-Safely "Workdir inesperado: $wd" }

$conn = Invoke-TargetQuery "SELECT 'CONNECTION|'||current_database()||'|'||current_setting('server_version');" 'Identificação da conexão'
if (-not ($conn | Where-Object { $_ -match '^CONNECTION\|postgres\|17\.' })) { Stop-Safely 'Banco/versão não corresponde a postgres/PG17.' }

$sql = @'
SELECT 'FOUNDATION|'||((to_regclass('public.permission_catalog') IS NOT NULL AND to_regclass('public.role_permissions') IS NOT NULL AND to_regclass('public.user_permission_overrides') IS NOT NULL AND to_regprocedure('public.has_app_permission(text)') IS NOT NULL))::text;
SELECT 'B7_TYPED_BASE|'||(to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NOT NULL)::text;
SELECT 'B7_TYPED_DELETE|'||(to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)') IS NOT NULL)::text;
SELECT 'LEGACY_DRAFT|'||(to_regclass('public.lancamento_drafts') IS NOT NULL)::text;
SELECT 'TABLE|'||t.table_name||'|'||CASE WHEN to_regclass('public.'||quote_ident(t.table_name)) IS NULL THEN 'MISSING' ELSE 'PRESENT' END
FROM (VALUES ('lancamento_draft_legacy_quarantine'),('lancamento_draft_control'),('lancamento_draft_lines'),('lancamento_draft_archive_lines'),('lancamento_batch_runs')) AS t(table_name) ORDER BY t.table_name;
SELECT 'RPC|'||r.name||'|'||CASE WHEN to_regprocedure(r.signature) IS NULL THEN 'MISSING' ELSE 'PRESENT' END
FROM (VALUES
 ('get_shared_lancamento_draft','public.get_shared_lancamento_draft()'),
 ('upsert_shared_lancamento_draft_lines','public.upsert_shared_lancamento_draft_lines(uuid,jsonb)'),
 ('delete_shared_lancamento_draft_line','public.delete_shared_lancamento_draft_line(uuid,text,bigint)'),
 ('clear_shared_lancamento_draft','public.clear_shared_lancamento_draft(uuid,bigint)'),
 ('get_shared_lancamento_batch_result','public.get_shared_lancamento_batch_result(uuid)'),
 ('process_shared_lancamento_draft_batch_atomic','public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])'),
 ('shared_draft_slot_identity_is_inconsistent','public.shared_draft_slot_identity_is_inconsistent(public.slots)')
) AS r(name,signature) ORDER BY r.name;
SELECT 'PERMISSION_KEYS|'||(SELECT count(*) FROM public.permission_catalog WHERE is_active AND permission_key = ANY(ARRAY['stock.launch.view','stock.launch.create','stock.batch.process']))::text;
SELECT 'DEPENDENCY_COLUMNS_MISSING|'||(SELECT count(*) FROM (VALUES
 ('profiles','id'),('profiles','name'),
 ('slots','id'),('slots','estoque'),('slots','modulo'),('slots','posicao'),('slots','referencia'),('slots','saldo'),('slots','restricao'),
 ('divergencias','id'),('divergencias','dataDivergencia'),('divergencias','tipoDivergencia'),('divergencias','estoque'),('divergencias','modulo'),('divergencias','posicao'),('divergencias','refAtual'),('divergencias','refNova'),('divergencias','saldoAntes'),('divergencias','movimentacao'),('divergencias','saldoFinal'),('divergencias','responsavel'),('divergencias','status'),('divergencias','dataChacote'),('divergencias','dataCorrecao'),('divergencias','corrigidoPor'),('divergencias','observacao'),('divergencias','slot_id'),('divergencias','restricao'),('divergencias','correcaoId'),
 ('warehouse_layout','estoque'),('warehouse_layout','modulo'),('warehouse_layout','ativo')
) AS req(table_name,column_name) LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=req.table_name AND c.column_name=req.column_name WHERE c.column_name IS NULL)::text;
SELECT 'LOCK_FUNCTION|'||(to_regprocedure('public.stock_address_lock_key(text,text,text)') IS NOT NULL)::text;
SELECT 'LEGACY_COLUMNS|'||(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='lancamento_drafts' AND ((column_name='user_id' AND data_type='uuid') OR (column_name='rows' AND data_type='jsonb') OR (column_name='updated_at' AND data_type='timestamp with time zone')))::text;
SELECT 'LEGACY_EXTERNAL_CALLERS|'||(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)')::oid
   AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])')::oid
   AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)')::oid
   AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)')::oid
   AND (p.prosrc ILIKE '%apply_stock_mutation_atomic(%' OR p.prosrc ILIKE '%apply_stock_mutation_atomic_with_deletes(%'))::text;
SELECT 'ADMIN_ID|'||id::text FROM public.profiles WHERE lower(btrim(role))='administrador' AND coalesce(btrim(name),'')<>'' ORDER BY id LIMIT 1;
SELECT 'PRODUCTION_ID|'||id::text FROM public.profiles WHERE lower(btrim(role))='producao' ORDER BY id LIMIT 1;
'@
$rows = Invoke-TargetQuery $sql 'Pré-requisitos do contrato compartilhado'
$v = @{}
foreach ($line in $rows) {
  $parts = $line -split '\|', 3
  if ($parts.Count -ge 2) { $v["$($parts[0])|$($parts[1])"] = if ($parts.Count -eq 3) { $parts[2] } else { '' } }
  if ($parts.Count -eq 2) { $v[$parts[0]] = $parts[1] }
}
if ($v['FOUNDATION'] -ne 'true' -or $v['B7_TYPED_BASE'] -ne 'true' -or $v['B7_TYPED_DELETE'] -ne 'true' -or $v['LEGACY_DRAFT'] -ne 'true') {
  Stop-Safely 'Foundation, B7.1 tipada ou tabela legada não corresponde ao estado esperado.'
}
if ($v['PERMISSION_KEYS'] -ne '3' -or $v['DEPENDENCY_COLUMNS_MISSING'] -ne '0' -or $v['LOCK_FUNCTION'] -ne 'true' -or $v['LEGACY_COLUMNS'] -ne '3') {
  Stop-Safely 'Catálogo de permissões ou dependências do schema não corresponde ao contrato revisado.'
}
if ($v['LEGACY_EXTERNAL_CALLERS'] -ne '0') { Stop-Safely 'Há chamadores externos dos escritores legados; não aplicar a migration.' }

$missingTables = @($rows | Where-Object { $_ -match '^TABLE\|[^|]+\|MISSING$' })
$presentTables = @($rows | Where-Object { $_ -match '^TABLE\|[^|]+\|PRESENT$' })
$missingRpcs = @($rows | Where-Object { $_ -match '^RPC\|[^|]+\|MISSING$' })
$presentRpcs = @($rows | Where-Object { $_ -match '^RPC\|[^|]+\|PRESENT$' })
if ($missingTables.Count -ne 5 -or $presentTables.Count -ne 0 -or $missingRpcs.Count -ne 7 -or $presentRpcs.Count -ne 0) {
  Stop-Safely "Estado parcial ou já aplicado. Esperado: 5 tabelas e 7 funções candidatas ausentes; encontrado: tabelas ausentes=$($missingTables.Count), presentes=$($presentTables.Count), funções ausentes=$($missingRpcs.Count), presentes=$($presentRpcs.Count). Não reaplique."
}

$admin = @($rows | Where-Object { $_ -match '^ADMIN_ID\|[0-9a-fA-F-]{36}$' } | ForEach-Object { ($_ -split '\|')[1] } | Select-Object -First 1)[0]
$prod = @($rows | Where-Object { $_ -match '^PRODUCTION_ID\|[0-9a-fA-F-]{36}$' } | ForEach-Object { ($_ -split '\|')[1] } | Select-Object -First 1)[0]
if ($admin -notmatch '^[0-9a-fA-F-]{36}$' -or $prod -notmatch '^[0-9a-fA-F-]{36}$') { Stop-Safely 'Falta perfil local Administrador com nome ou perfil Produção.' }

Write-Host "`nALVO VALIDADO: $TargetContainer / $ExpectedComposeProject / $wd / postgres PG17" -ForegroundColor Yellow
Write-Host 'A migration cria cinco tabelas, seis RPCs e uma função auxiliar. Também copia os rascunhos legados para quarentena; não apaga lancamento_drafts nem altera slots/history/divergencias.' -ForegroundColor Yellow
$confirmation = Read-Host 'Digite exatamente APLICAR LOTE COMPARTILHADO LOCAL para continuar'
if ($confirmation -cne 'APLICAR LOTE COMPARTILHADO LOCAL') {
  Write-Host 'Cancelado; nenhuma migration aplicada.' -ForegroundColor Yellow
  exit 0
}

Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/migrations/20261029000000_shared_lancamento_draft_permission_compat.sql') 'Aplicar migration de compatibilidade do lote compartilhado LOCAL'
Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/20261029000000_shared_lancamento_draft_verify.sql') 'Verificar schema, RPCs, permissões, escritores tipados e quarentena'

$template = Get-Content -LiteralPath (Join-Path $ProjectRoot 'docs/sql/20261029000000_shared_lancamento_draft_smoke.sql') -Raw
$template = $template.Replace('__ADMIN_ID__', $admin).Replace('__PRODUCTION_ID__', $prod)
$tempSql = Join-Path $env:TEMP ('shared-draft-smoke-' + [guid]::NewGuid().ToString('N') + '.sql')
try {
  Set-Content -LiteralPath $tempSql -Value $template -Encoding UTF8
  Invoke-TargetSqlFile $tempSql 'Smoke de autorização dos seis RPCs sem mutação de dados'
} finally {
  Remove-Item -LiteralPath $tempSql -Force -ErrorAction SilentlyContinue
}

Write-Host "`nPASS: migration de compatibilidade aplicada e verificada no clone LOCAL. Smoke de autorização executado com ROLLBACK; nenhum dado de negócio foi gravado. O processamento real de lote ainda exige teste funcional controlado separado. Produção não foi acessada." -ForegroundColor Green
