# Teste de autorização efetiva — sandbox local

Este script valida o contrato de autorização B1/B2 contra a instância Supabase local na porta 55321. Ele **não** altera a matriz. As duas tentativas de escrita usam `p_changes: []`, de modo que, mesmo se uma autorização regredir, o payload vazio é inválido e não pode salvar uma permissão.

## Executar

Na raiz `C:\Projetos\endere-amento`, com o sandbox ativo:

```powershell
node --test tests/permission-backend-smoke-contract.test.mjs
node scripts/Test-PermissionBackend.mjs
```

A senha temporária é `LocalPermissao!2026`. Para substituir a senha sem editar o arquivo:

```powershell
$env:PERMISSION_SANDBOX_PASSWORD = "SENHA_LOCAL_ATUAL"
node scripts/Test-PermissionBackend.mjs
Remove-Item Env:PERMISSION_SANDBOX_PASSWORD
```

O script aborta se a URL não for `localhost`, `127.0.0.1` ou `::1` na porta 55321. Ele não usa `service_role`, não escreve variáveis no disco, não modifica a matriz e não imprime tokens.

## O que comprova

- login de Administrador e Rafael no sandbox;
- completude da matriz e acordo entre o override salvo, a decisão efetiva do contexto e `has_app_permission`;
- negação para chave desconhecida;
- chamadas administrativas recusadas para Rafael;
- acesso direto à tabela interna da matriz recusado.

## Limite

Este teste valida o helper de autorização B1 e os controles administrativos B2. **Não** comprova que os botões de exportação ou as operações do aplicativo principal já consultem essas permissões. A integração dos módulos da aplicação, RLS e RPCs operacionais é uma fase subsequente.
