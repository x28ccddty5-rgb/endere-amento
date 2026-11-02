# Smoke test B1/B2 — integração local

## Objetivo

Confirmar a fundação B1/B2 já aplicada no container local `supabase_db_enderecamento-integracao-local`: seed (29 permissões/116 concessões), contexto do administrador, matriz administrativa, contexto de Produção, falha fechada e negação de RPCs administrativas para o perfil Produção.

## Executar

Na raiz `C:\Projetos\endere-amento`:

```powershell
node --test tests/permission-foundation-local-smoke-contract.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-PermissionFoundation-LocalIntegration.ps1
```

O script verifica os labels Docker de projeto e diretório. Não inicia nem encerra containers, não usa URL/chave remota e não altera políticas ou permissões. Não é um script de migração.

## O que é testado

- 29 chaves ativas e 116 linhas distintas da matriz;
- todas as RPCs B1/B2 esperadas;
- contexto do administrador e leitura da matriz administrativa;
- acesso direto bloqueado às tabelas internas de permissões;
- contexto do perfil Produção, chave desconhecida negada, `permissions.manage` negada e `stock.search` permitida;
- negação por `PERMISSION_ADMIN_REQUIRED` nas três RPCs administrativas para Produção.

## Limite importante

O teste usa a conexão Postgres local, muda para o papel `authenticated` e define `request.jwt.claim.sub` com o ID de um perfil existente. Isso testa a lógica server-side das funções e permissões, mas **não** testa login GoTrue, emissão de JWT nem o transporte REST/PostgREST. Um teste HTTP de login pode ser adicionado depois se as credenciais locais dos perfis de integração forem conhecidas, mas não são necessárias para este smoke test.

Todas as chamadas ficam em transação e terminam em `ROLLBACK`; as duas RPCs de escrita usam payload vazio e devem ser recusadas antes de qualquer alteração. Se algum resultado divergir, pare, envie a saída integral e não aplique B6.1/B6.2A no banco ainda.
