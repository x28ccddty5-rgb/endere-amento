# Scripts de auditoria e integração

Os scripts desta pasta são ferramentas de investigação e ensaio. A palavra `Apply` significa aplicação em clone local quando o script assim declara; não significa autorização para o banco oficial. Leia o cabeçalho, parâmetros, container alvo e teste de contrato antes de executar.

## Categorias

### Aplicação no clone de integração

- `Apply-PermissionFoundation-ToLocalIntegration.ps1` — B1/B2, exige pré-condições e confirmação local.
- `Apply-PermissionCatalogRlsB62B-ToLocalIntegration.ps1` — B6.2B no container exato de integração.
- `Apply-PermissionProductAndMetadata-ToLocalIntegration.ps1` — B6.1/B6.2A no clone.
- `Apply-TypedStockMutation-ToLocalIntegration.ps1` — B7.1 no clone.
- `Apply-SharedLancamentoDraft-ToLocalIntegration.ps1` — compatibilidade do rascunho compartilhado no clone.
- `Apply-Audit03ReadScopeAlignment-ToLocalIntegration.ps1` — alinhamento de leitura no clone.
- `Apply-Audit03CatalogMetadata-LocalIntegration.ps1` — metadados do catálogo no clone.

### Sandbox de permissões isolado

- `Start-PermissionSandbox.ps1` — inicia/reset somente o projeto local `enderecamento-permission-test`; `db reset --local --yes` é destrutivo para esse sandbox, não para o clone de integração. Gera credenciais temporárias locais e nunca deve ser apontado para URL remota.

### Verificação e diagnóstico

- `Diagnose-PermissionIntegration.ps1` — diagnóstico do container de integração.
- `Inspect-SharedLaunchContract-LocalIntegration.ps1` — inspeção de tabelas, RPCs e contrato do lote.
- `Test-PermissionFoundation-LocalIntegration.ps1` — smoke da fundação B1/B2.
- `Test-PermissionCatalogRlsB62B-LocalIntegration.ps1` — simula matriz de perfis em transações revertidas.
- `Test-PermissionMetadataRpc-LocalIntegration.ps1` — smoke da RPC de metadados.
- `Test-Audit03ReadScopeAlignment-LocalIntegration.ps1` — verifica alinhamento de leitura; read-only.
- `Test-SharedLancamentoDraft-LocalIntegration.ps1` — smoke do rascunho compartilhado.
- `Test-SharedLancamentoPositive-LocalIntegration.ps1` — lançamento positivo sintético, transacional e com cleanup verificado.
- `Test-SharedLancamentoConcurrency-LocalIntegration.ps1` — duas sessões locais e identidade de lote controlada.
- `Test-PermissionProfiles.mjs` — testes de resolução de perfis.
- `Test-PermissionBackend.mjs` — smoke do backend no ambiente `.env.permission-test.local`; exige endpoint localhost.

### Recuperação e inventários

- `Restore-SharedLancamentoConcurrency-LocalIntegration.ps1` — recuperação do primeiro baseline conhecido.
- `Restore-SharedLancamentoConcurrency-SecondFailedRun-LocalIntegration.ps1` — recuperação do segundo cenário conhecido.
- `Restore-SharedLancamentoConcurrency-ThirdRun-LocalIntegration.ps1` — recuperação do terceiro cenário conhecido.
- `Export-PermissionMutationInventory.ps1` — gera inventário de mutações.
- `Export-PermissionWriteCallsites.ps1` — gera inventário estático dos callsites de escrita.

## Limites permanentes

- O clone de integração tem nome exato `supabase_db_enderecamento-integracao-local`; não aceitar containers de nome parecido.
- O sandbox é outro projeto e usa portas próprias. Não confundir as duas bases.
- Não usar `supabase link`, `supabase db push`, `supabase db reset --linked`, logs amplos ou chamadas de rede nesses procedimentos.
- Scripts de recuperação só devem ser usados com a fixture/baseline exatos esperados pelo próprio script. Não improvisar IDs nem repetir recuperações.
- Arquivos `.env*`, service-role keys e senhas não podem ser impressos, incluídos em ZIPs ou versionados.
