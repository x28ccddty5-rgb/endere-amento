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
  $out=@($lines | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -ne '' })
  $out | ForEach-Object { Write-Host $_ }
  return $out
}
Write-Host 'RUNNER_VERSION|SHARED-LAUNCH-CONTRACT-READONLY-V1' -ForegroundColor Green
Write-Host 'CHECKUP DO CONTRATO DO LOTE COMPARTILHADO — SOMENTE LEITURA' -ForegroundColor Yellow
Write-Host 'Não executa migrations/DDL/DML, não altera permissões nem dados, não inicia/reinicia/remove containers e não acessa Supabase Cloud.'
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
SELECT 'TABLE|'||t.table_name||'|'||CASE WHEN to_regclass('public.'||quote_ident(t.table_name)) IS NULL THEN 'MISSING' ELSE 'PRESENT' END
FROM (VALUES
 ('lancamento_drafts'),('lancamento_draft_legacy_quarantine'),('lancamento_draft_control'),
 ('lancamento_draft_lines'),('lancamento_draft_archive_lines'),('lancamento_batch_runs')
) AS t(table_name) ORDER BY t.table_name;
SELECT 'COLUMN|'||c.table_name||'|'||c.ordinal_position::text||'|'||c.column_name||'|'||c.data_type||'|'||c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.table_name IN (
 'lancamento_drafts','lancamento_draft_legacy_quarantine','lancamento_draft_control',
 'lancamento_draft_lines','lancamento_draft_archive_lines','lancamento_batch_runs'
) ORDER BY c.table_name,c.ordinal_position;
SELECT 'RPC|'||r.function_name||'|'||coalesce(to_regprocedure(r.signature)::text,'MISSING')
FROM (VALUES
 ('get_shared_lancamento_draft','public.get_shared_lancamento_draft()'),
 ('upsert_shared_lancamento_draft_lines','public.upsert_shared_lancamento_draft_lines(uuid,jsonb)'),
 ('delete_shared_lancamento_draft_line','public.delete_shared_lancamento_draft_line(uuid,text,bigint)'),
 ('clear_shared_lancamento_draft','public.clear_shared_lancamento_draft(uuid,bigint)'),
 ('get_shared_lancamento_batch_result','public.get_shared_lancamento_batch_result(uuid)'),
 ('process_shared_lancamento_draft_batch_atomic','public.process_shared_lancamento_draft_batch_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[])')
) AS r(function_name,signature) ORDER BY r.function_name;
SELECT 'STOCK_WRITER|'||p.oid::regprocedure::text||'|security_definer='||p.prosecdef::text||'|search_path='||coalesce(array_to_string(p.proconfig,','),'(default)')||'|authenticated_exec='||has_function_privilege('authenticated',p.oid,'EXECUTE')::text||'|requires_operation_type='||(position('STOCK_OPERATION_TYPE_REQUIRED' in p.prosrc)>0)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('apply_stock_mutation_atomic','apply_stock_mutation_atomic_with_deletes')
ORDER BY p.proname,p.oid;
SELECT 'WRITER_CALLER|'||p.oid::regprocedure::text||'|name='||p.proname||'|old_base='||(p.prosrc ILIKE '%apply_stock_mutation_atomic(%' AND p.prosrc NOT ILIKE '%apply_stock_mutation_atomic(%text%')::text||'|delete='||(p.prosrc ILIKE '%apply_stock_mutation_atomic_with_deletes(%')::text||'|snippet='||left(regexp_replace(coalesce(p.prosrc,''),'\s+',' ','g'),220)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname NOT IN ('apply_stock_mutation_atomic','apply_stock_mutation_atomic_with_deletes')
  AND (p.prosrc ILIKE '%apply_stock_mutation_atomic(%' OR p.prosrc ILIKE '%apply_stock_mutation_atomic_with_deletes(%')
ORDER BY p.proname,p.oid;
SELECT 'PROFILE_ROLE|'||lower(btrim(role))||'|'||count(*)::text FROM public.profiles GROUP BY lower(btrim(role)) ORDER BY lower(btrim(role));
SELECT 'MIGRATION_LEDGER|'||CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'UNAVAILABLE' ELSE 'PRESENT' END;
'@
$rows=Invoke-TargetQuery $sql 'Inventário de tabelas, RPCs, escritores e perfis'
$missingRpc=@($rows|Where-Object{$_ -match '^RPC\|[^|]+\|MISSING$'})
$missingTables=@($rows|Where-Object{$_ -match '^TABLE\|[^|]+\|MISSING$'})
Write-Host "`n--- Resumo de inspeção ---" -ForegroundColor Cyan
Write-Host "MISSING_SHARED_RPCS|$($missingRpc.Count)"
Write-Host "MISSING_DRAFT_TABLES|$($missingTables.Count)"
Write-Host 'READ_ONLY_COMPLETE|true' -ForegroundColor Green
Write-Host 'Não aplique a migration histórica 20261024_shared_lancamento_draft.sql como está: a função de lote dessa versão chama as assinaturas antigas que B7.1 desativa com STOCK_OPERATION_TYPE_REQUIRED.' -ForegroundColor Yellow
Write-Host 'Próximo passo após revisar esta saída: desenhar uma migration de compatibilidade que use o escritor tipado com p_operation_type=''launch'' e permissionamento explícito, preservando idempotência e conflito do lote.' -ForegroundColor Yellow
