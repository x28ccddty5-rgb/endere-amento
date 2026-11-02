# SQL: migrations, verificações e reversões

## Aviso de execução

Os arquivos versionados em `docs/sql/migrations/` são o conjunto de trabalho da auditoria. O projeto principal não possui `supabase/migrations/`; portanto, **não presumir que `supabase db push` detecte ou aplique estes arquivos**. O sandbox em `docs/seguranca/permission-sandbox/supabase/migrations/` é independente e não deve ser copiado para o projeto principal automaticamente.

Os scripts PowerShell da pasta `scripts/` aplicam migrations apenas a containers locais com nomes e pré-condições explícitas. Leia cada script e seu teste de contrato antes de executar. Nenhuma migration deste inventário está autorizada para o Supabase oficial neste momento.

## Inventário das 15 migrations

| Migration | Escopo | Reversão registrada |
|---|---|---|
| `20261028010000_permission_foundation.sql` | B1 — catálogo, matriz e tabelas-base | rollback/20261028010000_rollback_permission_foundation.sql |
| `20261028020000_permission_admin_write_rpcs.sql` | B2 — RPCs administrativas de matriz e exceções | rollback/20261028020000_rollback_permission_write_rpcs.sql |
| `20261028050000_permission_scoped_check.sql` | Checagem de permissão por escopo | rollback/20261028050000_rollback_permission_scoped_check.sql |
| `20261028060000_permission_product_mutations.sql` | B6.1 — escrita granular de produtos | rollback/20261028060000_rollback_permission_product_mutations.sql |
| `20261028070000_permission_slot_metadata_atomic.sql` | B6.2A — atualização atômica de metadados | rollback/20261028070000_rollback_permission_slot_metadata_atomic.sql |
| `20261028090000_typed_stock_mutation_rpcs.sql` | B7.1 — escritores tipados de estoque | rollback/20261028090000_rollback_typed_stock_mutation_rpcs.sql |
| `20261029000000_shared_lancamento_draft_permission_compat.sql` | Compatibilidade do rascunho compartilhado | ../99_ROLLBACK_SHARED_DRAFT_BEFORE_USE.sql (emergência condicionada a não existir dado operacional) |
| `20261030100000_permission_stock_divergence_guards.sql` | B8 — guards de correção física/divergência | SEM rollback dedicado: exige restauração das definições anteriores das funções alteradas |
| `20261030110000_permission_lideranca_configuravel.sql` | Matriz configurável do perfil Liderança | SEM rollback dedicado: exige plano para restaurar seeds/estado anterior |
| `20261031120000_record_stock_conflict_divergences_atomic.sql` | RPC atômica para registrar divergências de conflito | SEM rollback dedicado: validar callsites e compatibilidade antes de remover/substituir |
| `20261031130000_permission_catalog_rls_b62b.sql` | B6.2B — policies RLS e ACL de catálogo | SEM rollback dedicado: exige snapshot e restauração exata das policies/ACLs anteriores |
| `20261031140000_revoke_direct_stock_table_dml.sql` | Revogação de DML direto em tabelas operacionais | SEM rollback dedicado: exige ACLs prévias exatas; nunca restaurar grants genéricos |
| `20261031150000_permission_read_scope_alignment.sql` | Alinhamento de escopo de leitura | rollback/20261031150000_permission_read_scope_alignment_rollback.sql |
| `20261031170000_permission_stock_details_description_alignment.sql` | Alinhamento de descrição/detalhes da pesquisa | rollback/20261031170000_permission_stock_details_description_alignment_rollback.sql |
| `20261101010000_permission_scoped_check_five_role_alignment.sql` | Alinhamento da RPC de escopo à matriz 5 perfis | rollback/20261101010000_rollback_permission_scoped_check_five_role_alignment.sql |

**Cinco migrations não têm rollback dedicado:** `20261030100000`, `20261030110000`, `20261031120000`, `20261031130000` e `20261031140000`. Isso não significa que devam ser removidas ou que o rollback seja simplesmente um `DROP`. Cada uma altera funções, matriz, RLS/policies, ACLs ou caminhos usados pelo frontend. A reversão requer reconstruir e validar o estado anterior no clone; em especial, a migration `20261031140000` exige os grants exatos capturados no preflight.

A migration de rascunho compartilhado possui um rollback de emergência fora da pasta `rollback/`: `99_ROLLBACK_SHARED_DRAFT_BEFORE_USE.sql`. Ele se recusa a remover estruturas se houver linhas ativas/arquivadas/lotes ou divergência da quarentena. Não é uma reversão geral após uso operacional.

`90_ROLLBACK_OPEN_TRANSACTION.sql` executa apenas `ROLLBACK` na mesma sessão que mantém transação aberta/abortada; não é rollback de migration.

## Tipos de arquivo em `docs/sql/`

- `migrations/`: mudanças de schema/funções/policies/grants; revisar pré-requisitos e ordem.
- `rollback/`: reversões dedicadas, com escopo específico.
- `*_preflight.sql` e `*_verify.sql`: em geral consultas de inspeção; conferir o conteúdo e se são estritamente read-only.
- `*_smoke*.sql` / `*.psql`: podem abrir transações, criar fixtures ou executar chamadas; usar apenas no ambiente local explicitamente indicado e conferir cleanup/rollback.
- `*_recovery*`, `*_restore*`, `*_session_a/b*`: recuperação de fixtures sintéticas de concorrência; executar somente com IDs e baseline esperados no clone local.
- `habilitar_realtime_slots.sql`: alteração de publicação Realtime; não é uma consulta read-only nem deve ser executada sem avaliação específica.
- `20261024_shared_lancamento_draft.sql`: artefato histórico de implantação anterior; a documentação adjacente proíbe reaplicá-lo em produção.

## Ordem e controle

1. Confirmar branch/HEAD e lista de arquivos exatos.
2. Conferir o schema e o migration ledger do ambiente-alvo somente por leitura. A presença de objeto não prova qual migration o criou; ausência no ledger não prova que o objeto não exista.
3. Rodar preflight no clone correspondente à estrutura oficial.
4. Aplicar uma migration por vez no clone, executar a verificação associada e conferir o estado pós-execução.
5. Preparar reversão/roll-forward específica e testar antes de uma janela oficial.
6. Na produção, coordenar frontend, RPCs, RLS, grants e pausa de gravação quando necessário.
7. Obter autorização explícita separada para mudanças de banco e deploy.

Não executar `DROP`, `REVOKE`, `GRANT`, `db reset`, `db push` ou migration remota como limpeza exploratória. Não usar a produção como ambiente de teste.
