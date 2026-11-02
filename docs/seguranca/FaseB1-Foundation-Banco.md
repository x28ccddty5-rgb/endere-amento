# Etapa 03 — Fase B1: base de autorização no banco

**Estado:** preparada para validação em banco local/teste; não executada em produção.

## Escopo desta fatia

A migration é aditiva. Cria o catálogo de permissões, a matriz-base dos quatro perfis ativos, a tabela de exceções individuais e a auditoria de mudanças, além de RPCs de leitura do contexto e da matriz administrativa. Não substitui políticas RLS existentes, não modifica RPCs de estoque, não altera dados de estoque e ainda não oferece uma RPC para salvar permissões. O frontend ainda não está conectado a essa fundação.

A migration foi colocada em `docs/sql/migrations/` porque o projeto atual não contém um histórico completo da CLI Supabase. Não mover para `supabase/migrations` sem antes estabelecer e validar um baseline completo.

## Arquivos

- `docs/sql/20261028010000_permission_foundation_preflight.sql`: diagnóstico somente leitura.
- `docs/sql/migrations/20261028010000_permission_foundation.sql`: migration aditiva e transacional.
- `docs/sql/20261028010000_permission_foundation_verify.sql`: verifica contagens, RLS, ACLs e configuração de segurança.
- `docs/sql/rollback/20261028010000_rollback_permission_foundation.sql`: rollback protegido; recusa reverter se houver overrides, auditoria ou mudanças no catálogo/matriz.
- `tests/permission-sql-contract.test.mjs`: testes estáticos que comparam os seeds SQL com o catálogo TypeScript.

## Ordem de validação — apenas banco isolado

1. Confirme no cliente SQL que a conexão é realmente o PostgreSQL local/teste `enderecamento_test`, e não o Supabase de produção.
2. Execute `20261028010000_permission_foundation_preflight.sql`.
3. Só prossiga se os pré-requisitos estiverem verdes: `profiles_table_exists`, `anon_role_exists`, `authenticated_role_exists`, `auth_uid_function_exists` e `required_profile_columns_exist` devem ser `true`; `administrator_profiles` deve ser maior que zero e `unknown_role_profiles` deve ser zero. `legacy_lideranca_profiles` é informativo: perfis Liderança existentes podem permanecer durante a transição, não recebem matriz-base nem exceções nesta versão e são negados pela nova camada de autorização. Não os exclua nem altere o perfil para fazer o preflight passar. Se qualquer outro pré-requisito falhar, pare e encaminhe o resultado/erro para revisão; não ajuste o banco improvisadamente.
4. Execute `migrations/20261028010000_permission_foundation.sql` na mesma base isolada.
5. Execute `20261028010000_permission_foundation_verify.sql`. Deve concluir sem exceções, retornar 29 permissões ativas, 116 grants explícitos e 4 tabelas com RLS.
6. Se houver erro, pare. Não repita a migration cegamente nem leve o script para produção. Compartilhe a mensagem integral de erro para corrigir o SQL.

**Não executar nenhum desses arquivos no SQL Editor do Supabase de produção.** Esta validação ainda não autoriza deploy ou migração de produção.

## Rollback

Use o rollback somente se a migration tiver sido aplicada na base local/teste e ainda não houver integração da aplicação nem dados de configuração/auditoria. O script contém guardas de integridade e deve abortar se detectar dados ou diferenças inesperadas. Não retire as guardas para forçar reversão. Antes de qualquer futura reversão em produção será necessário um plano separado, snapshot/export e aprovação explícita.

## Validações automatizadas realizadas nesta preparação

- `npm run lint`: passou no snapshot de validação.
- Bateria combinada: 81 testes passaram, zero falhas.
- Esses testes incluem regressões existentes, resolução pura de permissões e contratos estáticos da migration/rollback.
- **Limitação:** não havia PostgreSQL/psql/Docker disponível no ambiente de execução desta preparação. Portanto, a migration SQL ainda não foi executada contra um servidor PostgreSQL real; os passos acima são a única validação externa necessária nesta fatia.
