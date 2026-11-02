# Etapa 03 — Instalar fundação B1/B2 no clone local de integração

## Propósito

O inventário de 2026-10-29 indicou que `supabase_db_enderecamento-integracao-local` contém os perfis operacionais, mas ainda não possui a fundação de permissões (`permission_catalog`, `role_permissions`, `user_permission_overrides`, `permission_change_audit`) nem as respectivas RPCs. As fatias B6.1 e B6.2A dependem de `has_app_permission(text)`, por isso não devem ter suas migrations executadas antes de B1/B2.

## O que o script faz

`scripts/Apply-PermissionFoundation-ToLocalIntegration.ps1` identifica **somente** o container `supabase_db_enderecamento-integracao-local`; exige o label do projeto Docker e o diretório de trabalho esperados; verifica a conexão, tabelas, colunas, `auth.uid()`, papéis e ausência de instalação parcial; exige a frase de confirmação `APLICAR B1 B2 LOCAL`; aplica B1, executa sua verificação, aplica B2 e executa sua verificação.

Não inicia, reinicia ou remove containers. Não busca um container alternativo. Não aceita URL remota. Não altera policies operacionais nem revoga DML direto nas tabelas de estoque. Não executa o smoke test autenticado, que será separado.

## Pré-condições conhecidas

O inventário anterior mostrou `administrador: 1` e `producao: 1` e nenhum dos objetos de fundação. A execução ainda confirma tudo novamente antes de pedir autorização.

## Execução no Windows

Em PowerShell:

```powershell
Set-Location C:\Projetos\endere-amento
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Apply-PermissionFoundation-ToLocalIntegration.ps1
```

Leia o alvo exibido antes de digitar a confirmação. Se qualquer pré-requisito falhar, pare e compartilhe toda a saída. Não ajuste o script para ultrapassar a trava.

## Se houver erro parcial

B1 e B2 são executadas em transações separadas. Se B1 e sua verificação concluírem, mas B2 falhar, B1 poderá permanecer aplicada. **Não execute o script novamente**: ele detectará objetos existentes e bloqueará a repetição. Envie a saída do erro para uma correção direcionada.

## Após concluir

1. Revisar a saída de B1 (29 permissões ativas, 116 linhas-base, RLS e ACLs conforme o arquivo de verificação).
2. Revisar a saída de B2 (duas RPCs administrativas, `SECURITY DEFINER`, `search_path` seguro e EXECUTE restrito a `authenticated`).
3. Executar o smoke test autenticado de B2 com sessão de teste, confirmando concessão e negação.
4. Só então aplicar a migration B6.1 e testar a RPC B6.2A no mesmo clone local.

**Nunca executar este script contra produção.** Ele valida labels locais específicos e não usa nenhuma credencial ou URL remota.
