# Etapa 03 — B6.1: gravações individuais do cadastro de produtos

## O que muda

- Cadastro individual exige `products.create`.
- Edição individual exige `products.edit`.
- Exclusão exige `products.delete_deactivate`, uma permissão administrativa não delegável.
- Com `VITE_PERMISSION_ENFORCEMENT_MODE=live`, a interface usa o contexto carregado e consulta novamente a permissão no PostgreSQL antes de cada gravação. Em caso de erro, bloqueia a operação.
- O acesso à aba Base de Dados passa a respeitar `products.view` no modo de enforcement.
- O RLS do banco passa a autorizar INSERT, UPDATE e DELETE por essas chaves, em vez de conceder as três ações a qualquer usuário dos papéis antigos `administrador`/`lideranca`.
- A policy SELECT existente e os grants atuais são preservados nesta fatia. Isso é intencional: os dados de produtos também são carregados pelos fluxos operacionais. A leitura por escopo precisa ser tratada separadamente sem quebrar lançamentos/pesquisas.

## Arquivos desta fatia

- `src/App.tsx`
- `src/components/BaseDeDadosPanel.tsx`
- `docs/sql/migrations/20261028060000_permission_product_mutations.sql`
- `docs/sql/20261028060000_permission_product_mutations_verify.sql`
- `docs/sql/rollback/20261028060000_rollback_permission_product_mutations.sql`
- `tests/permission-product-mutation-contract.test.mjs`

## Ordem de aplicação no clone local de integração

1. Confirmar que o alvo é o banco do container `enderecamento-integracao-local` em `127.0.0.1:55442`; não usar projeto remoto/produção.
2. Executar o preflight já existente de B1 e conferir os perfis. A migração da fundação falha intencionalmente se houver perfil `lideranca` ativo ou papel desconhecido.
3. Se a fundação ainda não estiver aplicada nesse clone, aplicar `docs/sql/migrations/20261028010000_permission_foundation.sql` e verificar com `docs/sql/20261028010000_permission_foundation_verify.sql`.
4. Aplicar `docs/sql/migrations/20261028020000_permission_admin_write_rpcs.sql` e executar seus testes/verify.
5. Executar `node --test tests/permission-product-mutation-contract.test.mjs`.
6. Aplicar `docs/sql/migrations/20261028060000_permission_product_mutations.sql` **somente nesse clone**, então executar o script `...60000...verify.sql`.
7. Testar pela interface autenticada: Administrador cria/edita/exclui; Visualizador não vê ações de escrita; usuário com `products.create` delegado consegue apenas criar; usuário com `products.edit` delegado consegue apenas editar; usuário sem chave é negado; usuário comum não consegue excluir mesmo tentando chamar a tabela diretamente.
8. Só depois desses testes considerar a próxima fatia. Não revogar grants de outras tabelas nem mexer nas RPCs de estoque nesta etapa.

## Limitações e próximo passo

Esta fatia não conclui a segurança de todas as operações. O inventário anterior aponta caminhos diretos em `slots`, `history`, `divergencias` e `occupancy_history`, além de RPCs operacionais que não aparecem no banco de integração auditado. Eles continuam pendentes e devem ser tratados em B6.2/B7, antes de encerrar a Etapa 03. Nenhuma alteração de produção deve ser executada sem autorização explícita.
