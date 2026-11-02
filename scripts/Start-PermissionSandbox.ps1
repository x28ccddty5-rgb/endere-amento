$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SandboxRoot = Join-Path $ProjectRoot "docs\seguranca\permission-sandbox"
$SandboxMigrations = Join-Path $SandboxRoot "supabase\migrations"
$SupabaseCli = Join-Path $ProjectRoot "node_modules\.bin\supabase.cmd"
$Psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
$EnvFile = Join-Path $ProjectRoot ".env.permission-test.local"
function New-SandboxTestPassword {
  $upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
  $lower = "abcdefghijkmnopqrstuvwxyz"
  $digits = "23456789"
  $alphabet = $upper + $lower + $digits
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }

  $chars = New-Object char[] 32
  $chars[0] = $upper[[int]$bytes[0] % $upper.Length]
  $chars[1] = $lower[[int]$bytes[1] % $lower.Length]
  $chars[2] = $digits[[int]$bytes[2] % $digits.Length]
  for ($index = 3; $index -lt $chars.Length; $index++) {
    $chars[$index] = $alphabet[[int]$bytes[$index] % $alphabet.Length]
  }
  [Array]::Clear($bytes, 0, $bytes.Length)
  return (-join $chars)
}

$TestPassword = New-SandboxTestPassword

if (-not (Test-Path $SupabaseCli)) { throw "CLI Supabase não encontrado em node_modules\.bin. Não instale nada ainda; informe este erro." }
if (-not (Test-Path $Psql)) { throw "psql.exe do PostgreSQL 17 não foi encontrado no caminho esperado." }
if (-not (Test-Path (Join-Path $SandboxRoot "supabase\config.toml"))) { throw "Configuração isolada do sandbox não encontrada." }

$RequiredSources = @(
  @{ Source = (Join-Path $ProjectRoot "docs\sql\migrations\20261028010000_permission_foundation.sql"); Target = (Join-Path $SandboxMigrations "20261028010000_permission_foundation.sql") },
  @{ Source = (Join-Path $ProjectRoot "docs\sql\migrations\20261028020000_permission_admin_write_rpcs.sql"); Target = (Join-Path $SandboxMigrations "20261028020000_permission_admin_write_rpcs.sql") }
  @{ Source = (Join-Path $ProjectRoot "docs\sql\migrations\20261030110000_permission_lideranca_configuravel.sql"); Target = (Join-Path $SandboxMigrations "20261030110000_permission_lideranca_configuravel.sql") }
)
foreach ($file in $RequiredSources) {
  if (-not (Test-Path $file.Source)) { throw "Migration fonte não encontrada: $($file.Source). Não continue." }
  Copy-Item -LiteralPath $file.Source -Destination $file.Target -Force
}

Write-Host "`n=== Confirme: este script usa um projeto Supabase LOCAL separado ===" -ForegroundColor Cyan
Write-Host "Projeto: $SandboxRoot"
Write-Host "API local: porta 55321 | PostgreSQL local: porta 55433"
Write-Host "Não usa link remoto e não executa db push."

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) { throw "Docker CLI não encontrado. Inicie/instale Docker Desktop antes de continuar." }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop não parece estar pronto. Inicie-o e execute o script novamente." }

Push-Location $SandboxRoot
try {
  # Do not call `supabase status` before the sandbox containers exist.
  # On a first run, the CLI may write "No such container" to stderr; with
  # ErrorActionPreference=Stop, Windows PowerShell can turn that normal
  # not-started state into a terminating NativeCommandError.
  # Detect this exact project's running containers first, without inspecting
  # or stopping any unrelated Supabase stack.
  $dockerRows = @(& docker ps --format "{{.Names}}|{{.Ports}}")
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível consultar os containers Docker. O sandbox não foi iniciado." }

  $dbRow = $dockerRows | Where-Object { $_ -match '^supabase_db_enderecamento-permission-test\|' } | Select-Object -First 1
  $apiRow = $dockerRows | Where-Object { $_ -match '^supabase_kong_enderecamento-permission-test\|' } | Select-Object -First 1
  $studioRow = $dockerRows | Where-Object { $_ -match '^supabase_studio_enderecamento-permission-test\|' } | Select-Object -First 1

  $existingApi = $null
  $sandboxAlreadyRunning = (
    $dbRow -and $dbRow.Contains('55433->5432/tcp') -and
    $apiRow -and $apiRow.Contains('55321->8000/tcp') -and
    $studioRow -and $studioRow.Contains('55323->3000/tcp')
  )
  if ($sandboxAlreadyRunning) {
    $existingApi = 'http://127.0.0.1:55321'
  }

  $requiredPorts = @(55321, 55433, 55323)
  $occupiedPorts = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in $requiredPorts } |
    Select-Object -ExpandProperty LocalPort -Unique
  if ($occupiedPorts -and -not $existingApi) {
    throw "Porta(s) local(is) já ocupada(s): $($occupiedPorts -join ', '). O sandbox não foi iniciado e nenhum serviço foi encerrado. Libere as portas ou envie o resultado para ajustarmos portas próprias."
  }

  # If some containers of this exact sandbox exist but the required port
  # mappings are incomplete, stop instead of attempting to repair/reset an
  # unknown partial state automatically.
  $allKnownRows = @(& docker ps -a --format "{{.Names}}")
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível verificar o estado dos containers. O sandbox não foi iniciado." }
  $sandboxContainerNames = @($allKnownRows | Where-Object { $_ -match '^supabase_(db|kong|studio|auth|rest|realtime|storage|pg_meta|vector|analytics|inbucket)_enderecamento-permission-test$' })
  if ($sandboxContainerNames.Count -gt 0 -and -not $sandboxAlreadyRunning) {
    throw "Foi encontrado um estado parcial do sandbox ($($sandboxContainerNames -join ', ')). Nenhum container foi removido. Envie essa saída para diagnóstico antes de continuar."
  }

  & $SupabaseCli start
  if ($LASTEXITCODE -ne 0) { throw "supabase start falhou. Envie a saída; não execute nada no projeto remoto." }

  # Explicit local reset only. It wipes only this isolated sandbox database.
  & $SupabaseCli db reset --local --yes
  if ($LASTEXITCODE -ne 0) { throw "Reset LOCAL do sandbox falhou. Não execute db reset --linked." }

  $statusLines = & $SupabaseCli status -o env
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível ler o status do Supabase local." }
  $envValues = @{}
  foreach ($line in $statusLines) {
    $eq = $line.IndexOf('=')
    if ($eq -le 0) { continue }
    $key = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim().Trim('"')
    $envValues[$key] = $value
  }

  $ApiUrl = $envValues["API_URL"]
  $AnonKey = $envValues["ANON_KEY"]
  $ServiceRoleKey = $envValues["SERVICE_ROLE_KEY"]
  if (-not $ApiUrl -or -not $AnonKey -or -not $ServiceRoleKey) { throw "Status local não retornou API_URL/ANON_KEY/SERVICE_ROLE_KEY. Não crie arquivo .env." }
  $apiUri = [Uri]$ApiUrl
  if ($apiUri.Host -notin @("localhost", "127.0.0.1", "::1")) { throw "Bloqueio de segurança: API_URL não é local ($ApiUrl). Nenhum usuário foi criado." }

  $fixtures = @(
    @{ username = "admin-permissoes"; name = "Administrador Teste"; email = "admin-permissoes@local.test"; role = "administrador" },
    @{ username = "rafael-teste"; name = "Rafael Teste"; email = "rafael-permissoes@local.test"; role = "apoio" },
    @{ username = "producao-teste"; name = "Produção Teste"; email = "producao-permissoes@local.test"; role = "producao" },
    @{ username = "visualizador-teste"; name = "Visualizador Teste"; email = "visualizador-permissoes@local.test"; role = "visualizador" },
    @{ username = "lideranca-teste"; name = "Liderança Teste"; email = "lideranca-permissoes@local.test"; role = "lideranca" }
  )

  $updates = [System.Collections.Generic.List[string]]::new()
  foreach ($fixture in $fixtures) {
    $body = @{
      email = $fixture.email
      password = $TestPassword
      email_confirm = $true
      user_metadata = @{ username = $fixture.username; name = $fixture.name }
    } | ConvertTo-Json -Depth 5 -Compress

    $created = Invoke-RestMethod -Method Post -Uri "$ApiUrl/auth/v1/admin/users" -Headers @{
      apikey = $ServiceRoleKey
      Authorization = "Bearer $ServiceRoleKey"
    } -ContentType "application/json" -Body $body

    $userId = if ($created.id) { [string]$created.id } elseif ($created.user -and $created.user.id) { [string]$created.user.id } else { "" }
    if ($userId -notmatch '^[0-9a-fA-F-]{36}$') { throw "Auth local não retornou UUID válido para $($fixture.email). Resetar apenas o sandbox e revisar." }
    $safeUsername = $fixture.username.Replace("'", "''")
    $updates.Add("UPDATE public.profiles SET id = '$userId'::uuid WHERE username = '$safeUsername';")
  }

  $sql = @"
BEGIN;
$($updates -join "`n")
DO `$verify`$
BEGIN
  IF (SELECT count(*) FROM public.profiles p JOIN auth.users u ON u.id = p.id) <> 5 THEN
    RAISE EXCEPTION 'PERMISSION_SANDBOX_PROFILE_AUTH_MAPPING_FAILED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_id_fkey') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
`$verify`$;
NOTIFY pgrst, 'reload schema';
COMMIT;
"@

  $oldPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = "postgres"
    & $Psql -h 127.0.0.1 -p 55433 -U postgres -d postgres -v ON_ERROR_STOP=1 -c $sql
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível associar perfis aos usuários Auth locais." }
  } finally {
    if ($null -eq $oldPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    else { $env:PGPASSWORD = $oldPassword }
  }

  @(
    "VITE_SUPABASE_URL=$ApiUrl"
    "VITE_SUPABASE_ANON_KEY=$AnonKey"
    "VITE_PERMISSION_ADMIN_MODE=live"
    "VITE_PERMISSION_ENFORCEMENT_MODE=live"
  ) | Set-Content -LiteralPath $EnvFile -Encoding ascii

  Write-Host "`nSANDBOX LOCAL PREPARADO." -ForegroundColor Green
  Write-Host "Página: http://127.0.0.1:3001/permission-test.html"
  Write-Host "Administrador local: admin-permissoes@local.test"
  Write-Host "Senha temporária de TODOS os usuários locais: $TestPassword"
  Write-Host "Arquivo criado: .env.permission-test.local (contém somente URL e chave pública local)."
  Write-Host "A chave SERVICE_ROLE_KEY foi usada apenas em memória e NÃO foi salva no arquivo .env."
  Write-Host "Para limpar alterações de teste, execute supabase db reset --local dentro da pasta permission-sandbox."
} finally {
  Pop-Location
}
