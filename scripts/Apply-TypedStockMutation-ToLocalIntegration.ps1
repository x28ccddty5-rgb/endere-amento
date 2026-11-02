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
function Stop-Safely([string]$Message) { Write-Host "`nBLOQUEADO: $Message" -ForegroundColor Red; throw $Message }
function Invoke-TargetQuery([string]$Sql, [string]$Label) {
  Write-Host "`n--- $Label ---" -ForegroundColor Cyan
  $prev=$ErrorActionPreference
  try { $ErrorActionPreference='Continue'; $lines=& docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -P pager=off -c $Sql 2>&1; $code=$LASTEXITCODE }
  finally { $ErrorActionPreference=$prev }
  $joined=($lines | ForEach-Object { "$_" }) -join "`n"
  if ($code -ne 0) { Stop-Safely "Consulta '$Label' falhou:`n$joined" }
  $out=@($lines | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -ne '' }); $out | ForEach-Object { Write-Host $_ }; return $out
}
function Invoke-TargetSqlFile([string]$LocalPath,[string]$Label,[switch]$SmokeTemplate) {
  if (-not (Test-Path -LiteralPath $LocalPath -PathType Leaf)) { Stop-Safely "Arquivo obrigatório não encontrado: $LocalPath" }
  $containerPath="/tmp/phase03-$([IO.Path]::GetFileName($LocalPath))"
  Write-Host "`n--- $Label ---" -ForegroundColor Cyan
  & docker cp $LocalPath "${TargetContainer}:$containerPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Safely 'Falha ao copiar SQL para o container local.' }
  try {
    $prev=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $output=& docker exec $TargetContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off -f $containerPath 2>&1; $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$prev }
    $output | ForEach-Object { Write-Host "$_" }
    if ($code -ne 0) { Stop-Safely "'$Label' falhou. Não repita automaticamente; envie a saída integral." }
  } finally { & docker exec $TargetContainer rm -f $containerPath | Out-Null }
}
Write-Host "RUNNER_VERSION|B7.1-TYPED-STOCK-MUTATIONS" -ForegroundColor Green
Write-Host 'ETAPA 03 — TIPO EXPLÍCITO NA RPC GENÉRICA DE ESTOQUE (LOCAL)' -ForegroundColor Yellow
Write-Host 'Não inicia/reinicia/remove containers; não acessa Supabase Cloud; não revoga grants de tabela.'
$required=@('src/lib/mapQuickCorrection.ts','docs/sql/migrations/20261028090000_typed_stock_mutation_rpcs.sql','docs/sql/20261028090000_typed_stock_mutation_rpcs_verify.sql','docs/sql/20261028090000_typed_stock_mutation_rpcs_smoke.sql','docs/sql/rollback/20261028090000_rollback_typed_stock_mutation_rpcs.sql')
foreach($r in $required){if(-not(Test-Path -LiteralPath (Join-Path $ProjectRoot $r) -PathType Leaf)){Stop-Safely "Falta arquivo requerido: $r"}}
$inspectRaw=& docker inspect $TargetContainer 2>$null
if($LASTEXITCODE -ne 0 -or -not $inspectRaw){Stop-Safely "Container exato '$TargetContainer' não encontrado."}
$ci=@($inspectRaw|ConvertFrom-Json)[0]
if($ci.State.Running -ne $true){Stop-Safely 'Container alvo não está em execução; script não irá iniciá-lo.'}
$labels=$ci.Config.Labels
if($labels.'com.docker.compose.project' -ne $ExpectedComposeProject){Stop-Safely 'Label do projeto Docker diferente.'}
$wd=([string]$labels.'com.supabase.cli.workdir').Replace('/','\').TrimEnd('\').ToLowerInvariant()
if($wd -ne $ExpectedWorkdir){Stop-Safely "Workdir inesperado: $wd"}
$conn=Invoke-TargetQuery "SELECT 'CONNECTION|'||current_database()||'|'||current_setting('server_version');" 'Identificação da conexão'
if(-not($conn|Where-Object{$_ -match '^CONNECTION\|postgres\|17\.'})){Stop-Safely 'Banco/versão não corresponde a postgres/PG17.'}
$sql=@'
SELECT 'FOUNDATION|'||((to_regclass('public.permission_catalog') IS NOT NULL AND to_regclass('public.role_permissions') IS NOT NULL AND to_regclass('public.user_permission_overrides') IS NOT NULL AND to_regclass('public.permission_change_audit') IS NOT NULL AND to_regprocedure('public.has_app_permission(text)') IS NOT NULL))::text;
SELECT 'MATRIX|'||(SELECT count(*) FROM public.permission_catalog WHERE is_active)::text||'|'||(SELECT count(*) FROM public.role_permissions)::text||'|'||(SELECT count(DISTINCT (role,permission_key)) FROM public.role_permissions)::text;
SELECT 'B6_POLICIES|'||((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='products' AND policyname IN ('products_insert_permission','products_update_permission','products_delete_permission'))=3)::text;
SELECT 'METADATA_RPC|'||(to_regprocedure('public.update_slot_metadata_atomic(jsonb,jsonb)') IS NOT NULL)::text;
SELECT 'LEGACY_BASE|'||(to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)') IS NOT NULL)::text;
SELECT 'LEGACY_DELETE|'||(to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])') IS NOT NULL)::text;
SELECT 'TYPED_BASE|'||(to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NOT NULL)::text;
SELECT 'TYPED_DELETE|'||(to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)') IS NOT NULL)::text;
SELECT 'SHARED_BATCH_RPC|'||EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_shared_lancamento_draft_batch_atomic')::text;
SELECT 'EXTERNAL_LEGACY_CALLERS|'||(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)')::oid
  AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])')::oid
  AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)')::oid
  AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)')::oid
  AND (p.prosrc ILIKE '%apply_stock_mutation_atomic(%' OR p.prosrc ILIKE '%apply_stock_mutation_atomic_with_deletes(%'))::text;
SELECT 'ADMIN_COUNT|'||(SELECT count(*) FROM public.profiles WHERE lower(btrim(role))='administrador')::text;
SELECT 'PRODUCTION_COUNT|'||(SELECT count(*) FROM public.profiles WHERE lower(btrim(role))='producao')::text;
'@
$rows=Invoke-TargetQuery $sql 'Pré-requisitos e estado de B7.1'
$v=@{};foreach($l in $rows){$p=$l -split '\|',2;if($p.Count -eq 2){$v[$p[0]]=$p[1]}}
if($v.FOUNDATION -ne 'true' -or $v.B6_POLICIES -ne 'true' -or $v.METADATA_RPC -ne 'true' -or $v.LEGACY_BASE -ne 'true' -or $v.LEGACY_DELETE -ne 'true'){Stop-Safely 'Fundação/B6.1/B6.2A ou writers legados não correspondem ao esperado.'}
if($v.MATRIX -ne '29|116|116'){Stop-Safely "Matriz inesperada: $($v.MATRIX)"}
if([int]$v.ADMIN_COUNT -lt 1 -or [int]$v.PRODUCTION_COUNT -lt 1){Stop-Safely 'Falta perfil Administrador ou Produção.'}
if($v.EXTERNAL_LEGACY_CALLERS -ne '0'){
  $legacyCallerDetailsSql=@'
SELECT 'LEGACY_CALLER|'||p.oid::regprocedure::text||'|'||p.proname||'|'||left(regexp_replace(coalesce(p.prosrc,''),'\s+',' ','g'),240)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb)')::oid
  AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[])')::oid
  AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,text)')::oid
  AND p.oid IS DISTINCT FROM to_regprocedure('public.apply_stock_mutation_atomic_with_deletes(jsonb,jsonb,jsonb,jsonb,jsonb,text[],text)')::oid
  AND (p.prosrc ILIKE '%apply_stock_mutation_atomic(%' OR p.prosrc ILIKE '%apply_stock_mutation_atomic_with_deletes(%')
ORDER BY p.proname,p.oid;
'@
  Invoke-TargetQuery $legacyCallerDetailsSql 'Detalhes dos chamadores externos das assinaturas legadas' | Out-Null
  Stop-Safely "Há chamadas externas a outras rotinas das assinaturas antigas ($($v.EXTERNAL_LEGACY_CALLERS)); confira os detalhes acima."
}
$typedBaseExists = $v.TYPED_BASE -eq 'true'
$typedDeleteExists = $v.TYPED_DELETE -eq 'true'
if($typedBaseExists -ne $typedDeleteExists){Stop-Safely 'Estado parcial inesperado: apenas uma das duas assinaturas tipadas existe. Não aplique novamente; inspecione o banco local.'}
$alreadyApplied = $typedBaseExists -and $typedDeleteExists
if($v.SHARED_BATCH_RPC -eq 'true'){Stop-Safely 'RPC de lote compartilhado existe; reconciliar seu contrato antes de continuar.'}
if($v.EXTERNAL_LEGACY_CALLERS -ne '0'){Stop-Safely "Há chamadas externas às assinaturas antigas ($($v.EXTERNAL_LEGACY_CALLERS)); reconcilie antes de continuar."}
$admin=@(Invoke-TargetQuery "SELECT id::text FROM public.profiles WHERE lower(btrim(role))='administrador' ORDER BY id LIMIT 1;" 'Perfil administrador local' | Select-Object -Last 1)[0]
$prod=@(Invoke-TargetQuery "SELECT id::text FROM public.profiles WHERE lower(btrim(role))='producao' ORDER BY id LIMIT 1;" 'Perfil Produção local' | Select-Object -Last 1)[0]
if($admin -notmatch '^[0-9a-fA-F-]{36}$' -or $prod -notmatch '^[0-9a-fA-F-]{36}$'){Stop-Safely 'IDs locais inválidos.'}
Write-Host "`nALVO VALIDADO: $TargetContainer / $ExpectedComposeProject / $wd / postgres PG17" -ForegroundColor Yellow
if($alreadyApplied){
  Write-Host 'B7.1 já parece aplicada integralmente: as duas assinaturas tipadas existem. A migration será IGNORADA; o script executará somente verificação e smoke test.' -ForegroundColor Yellow
  $c=Read-Host 'Digite exatamente VERIFICAR B7.1 TIPADO LOCAL para continuar'
  if($c -cne 'VERIFICAR B7.1 TIPADO LOCAL'){Write-Host 'Cancelado; nenhuma ação foi executada.' -ForegroundColor Yellow;exit 0}
} else {
  Write-Host 'B7.1 ainda não está aplicada: as duas assinaturas tipadas estão ausentes. A migration será aplicada uma única vez.' -ForegroundColor Yellow
  $c=Read-Host 'Digite exatamente APLICAR B7.1 TIPADO LOCAL para continuar'
  if($c -cne 'APLICAR B7.1 TIPADO LOCAL'){Write-Host 'Cancelado; nenhuma migration aplicada.' -ForegroundColor Yellow;exit 0}
  Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/migrations/20261028090000_typed_stock_mutation_rpcs.sql') 'Aplicar migration B7.1'
}
Invoke-TargetSqlFile (Join-Path $ProjectRoot 'docs/sql/20261028090000_typed_stock_mutation_rpcs_verify.sql') 'Verificar migration B7.1'
# Create a personalized smoke SQL in temp: UUIDs are selected above from this exact local DB.
$template=(Get-Content -LiteralPath (Join-Path $ProjectRoot 'docs/sql/20261028090000_typed_stock_mutation_rpcs_smoke.sql') -Raw).Replace('__ADMIN_ID__',$admin).Replace('__PRODUCTION_ID__',$prod)
$tempSql=Join-Path $env:TEMP ('phase03-b71-smoke-'+[guid]::NewGuid().ToString('N')+'.sql')
try { Set-Content -LiteralPath $tempSql -Value $template -Encoding UTF8; Invoke-TargetSqlFile $tempSql 'Smoke test autorização por operação e rollback' }
finally { Remove-Item -LiteralPath $tempSql -Force -ErrorAction SilentlyContinue }
if($alreadyApplied){ Write-Host "`nPASS: B7.1 já aplicada; verificação e smoke concluídos no clone local sem reaplicar migration. Nenhuma linha de negócio foi gravada pelo smoke. Isso NÃO fecha os outros caminhos RPC nem autoriza produção." -ForegroundColor Green }
else { Write-Host "`nPASS: B7.1 aplicada e smoke executado no clone local. Nenhuma linha de negócio foi gravada pelo smoke. Isso NÃO fecha os outros caminhos RPC nem autoriza produção." -ForegroundColor Green }
