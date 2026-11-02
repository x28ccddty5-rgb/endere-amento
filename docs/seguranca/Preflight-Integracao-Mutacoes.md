# Preflight de integração local — permissões de mutações

**Somente leitura. Não aplicar mudanças.**

A etapa de permissões de mutações precisa ser validada sobre um clone local que contenha o schema de estoque e as RPCs transacionais existentes. O sandbox `permission-sandbox` é intencionalmente reduzido e não possui `slots`, `history`, `divergencias` nem as funções centrais de estoque.

O script `scripts/Diagnose-PermissionIntegration.ps1` consulta exclusivamente o container Docker já existente `supabase_db_enderecamento-integracao-local`. Ele não cria/reinicia/para containers, não faz `db reset`, `db push`, link remoto, DDL ou DML. Se o container não estiver em execução, o script para e lista os containers disponíveis.

## Como executar

Na raiz do projeto:

```powershell
Set-Location C:\Projetos\endere-amento
node --test tests\permission-integration-preflight-contract.test.mjs
if ($LASTEXITCODE -ne 0) { throw "Teste do diagnóstico falhou. Pare aqui." }

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Projetos\endere-amento\scripts\Diagnose-PermissionIntegration.ps1"
if ($LASTEXITCODE -ne 0) { throw "Diagnóstico falhou. Envie a saída completa." }
```

## Como interpretar

- O relatório lista tabelas, funções e políticas atuais, grants diretos e a distribuição de perfis.
- `permission_catalog`/`role_permissions`/`user_permission_overrides`/`permission_change_audit` e `has_app_permission`/`has_app_permissions` mostram se B1/B2/B5 já existem nesse banco de integração.
- A saída serve como preflight para planejar a próxima migration. Nenhuma migration de mutações deve ser aplicada antes de verificar se esse banco já contém as tabelas de permissões, o schema de estoque esperado e as RPCs auditadas.
- Não compartilhe secrets ou tokens; o script não os seleciona.
