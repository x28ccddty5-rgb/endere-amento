# Etapa 03 — Fase B2: RPCs administrativas de gravação

**Estado:** preparada para validação local; não executar em produção.

## O que esta migration adiciona

- `public.save_role_permission_changes(text, jsonb)`: atualiza as permissões-base dos perfis `apoio`, `producao` e `visualizador`.
- `public.save_user_permission_overrides(uuid, jsonb)`: define exceções individuais `allow`, `deny` ou `inherit` (que remove a exceção e herda do perfil).
- As duas funções exigem sessão autenticada e perfil `administrador` validado no servidor.
- As operações são transacionais, aplicam somente diferenças reais e registram auditoria com ator, alvo e alterações efetivas.
- `products.import_bulk`, `products.delete_deactivate` e outras chaves `is_admin_only` não podem ser concedidas a perfis não administradores nem por exceção individual.
- Liderança continua como perfil legado não configurável; Administrador não pode ser alvo de exceções individuais nem ter sua matriz alterada por essa RPC.
- Tabelas, políticas RLS atuais e RPCs de estoque não são alteradas.

## Arquivos

- `docs/sql/migrations/20261028020000_permission_admin_write_rpcs.sql`
- `docs/sql/20261028020000_permission_write_rpcs_verify.sql`
- `docs/sql/20261028020000_permission_write_rpcs_smoke_test.psql` (prova transacional com `ROLLBACK`)
- `docs/sql/rollback/20261028020000_rollback_permission_write_rpcs.sql`
- `tests/permission-write-rpc-contract.test.mjs`

## Ordem de execução em ambiente local/teste

1. Execute primeiro `node --test tests/permission-write-rpc-contract.test.mjs`.
2. Só se todos os testes passarem, aplique `20261028020000_permission_admin_write_rpcs.sql` em `enderecamento_test`.
3. Execute `20261028020000_permission_write_rpcs_verify.sql` na mesma base.
4. Execute `20261028020000_permission_write_rpcs_smoke_test.psql`; ele altera um valor e restaura-o dentro de uma transação e termina com `ROLLBACK`, sem persistir mudanças de permissão/auditoria.
5. Não altere manualmente as tabelas. A migração ainda não conecta o frontend aos novos RPCs.
6. Se ocorrer qualquer erro, pare e envie a saída completa. Não execute a migration novamente sem revisar o estado.

## Rollback

O rollback remove apenas as duas novas RPCs, sem `CASCADE`, e verifica que as quatro tabelas da fundação continuam presentes. Não apaga a matriz, overrides ou auditoria. É apenas para o ambiente local/teste nesta fase.

## Limitações de validação

Os testes de contrato são estáticos; eles não substituem uma prova de autorização via sessão `authenticated`. Após a migration e a verificação de catálogo, a próxima etapa será executar testes transacionais no banco local com sessão de Administrador e sessão não administradora, sempre em transação reversível, antes de ligar o frontend.
