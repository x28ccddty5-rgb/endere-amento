# Sandbox isolado para testar persistência de permissões

**Objetivo:** validar a tela real `PermissionManagementPanel` contra RPCs reais B1/B2 executando em um Supabase local descartável. Isso não é produção nem altera o Supabase hospedado.

## Segurança e escopo

- A stack tem `project_id = enderecamento-permission-test`, API local na porta 55321 e PostgreSQL local na porta 55433.
- Realtime, Storage, Analytics, Edge Runtime e SMTP local estão desligados; não são necessários para testar permissões.
- O projeto sandbox fica nesta pasta própria, fora do `supabase/` principal. As migrations B1/B2 são copiadas pelo script a partir dos arquivos já validados em `docs/sql/migrations/`.
- A página `permission-test.html` é servida somente pelo Vite em modo de desenvolvimento. A build normal do aplicativo continua usando `index.html` como entrada, sem incluir a página de teste.
- `VITE_PERMISSION_ADMIN_MODE=live` só é escrito em `.env.permission-test.local` junto de uma URL `localhost` validada. A chave `SERVICE_ROLE_KEY` é usada apenas dentro do script de provisionamento e nunca gravada no arquivo `.env`.
- Os usuários e senha são fixtures locais temporárias. Nunca use esses dados em qualquer projeto remoto.

## Preparação e execução (Windows/PowerShell)

1. Inicie o Docker Desktop e aguarde ficar pronto.
2. A partir da raiz `C:\Projetos\endere-amento`, execute:

   ```powershell
   Set-Location C:\Projetos\endere-amento
   .\scripts\Start-PermissionSandbox.ps1
   ```

3. O script inicia somente a stack com `project_id` de teste, executa `supabase db reset --local --yes`, cria cinco contas de Auth locais, associa os perfis aos IDs gerados pela Auth e cria `.env.permission-test.local`.
4. Depois, inicie o Vite em uma porta separada:

   ```powershell
   npm run dev -- --mode permission-test --port 3001
   ```

5. Abra `http://127.0.0.1:3001/permission-test.html` e entre com:
   - E-mail: `admin-permissoes@local.test`
   - Senha: a senha aleatória exibida uma única vez no console pelo script de preparação. Ela é temporária, compartilhada apenas entre as contas locais deste sandbox e muda a cada reset.

6. Na aba **Exceções por usuário**, selecione **Rafael Teste**, marque `reports.export` como **Negar** e salve.
7. Recarregue a página, entre novamente e confirme que a exceção continua **Negar**. Isso testa a persistência de ponta a ponta usando o painel e a RPC `save_user_permission_overrides` no Supabase local.
8. Como validação adicional rápida, altere uma permissão-base do perfil Apoio e salve. Recarregue para confirmar que continua igual.

## Reset e parada

- Para zerar somente este sandbox e voltar à matriz-base original, execute:

  ```powershell
  Set-Location C:\Projetos\endere-amento\docs\seguranca\permission-sandbox
  ..\..\..\node_modules\.bin\supabase.cmd db reset --local --yes
  ```

  Depois rode novamente `scripts/Start-PermissionSandbox.ps1` para recriar contas e `.env.permission-test.local`.
- Para parar a stack local preservando os dados atuais, execute na mesma pasta:

  ```powershell
  ..\..\..\node_modules\.bin\supabase.cmd stop
  ```

## Não executar

Não use `supabase db push`, `supabase db reset --linked`, `supabase link` ou comandos de deploy. Não copie este sandbox para `supabase/migrations` principal e não ative `VITE_PERMISSION_ADMIN_MODE=live` no `.env.local` remoto.

## O que este teste NÃO prova

Ele prova que o painel consegue salvar e recarregar a matriz e as exceções no banco Supabase local. Ele ainda não prova que todos os botões/mutações operacionais do aplicativo usam essas permissões; essa integração é a próxima fase, seguida de testes RLS/RPC/Edge Function.
