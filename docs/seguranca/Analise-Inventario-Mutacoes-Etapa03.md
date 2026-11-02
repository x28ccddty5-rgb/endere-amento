# Análise do inventário de mutações — Etapa 03

**Fonte:** `permission-mutation-inventory.txt`, gerado em 29/10/2026 no container `supabase_db_enderecamento-integracao-local`.
**Modo:** somente leitura. Nenhuma alteração de banco foi executada por esta análise.

## Conclusão executiva

Ainda não é seguro aplicar a nova autorização às mutações. O banco de integração tem a estrutura operacional, mas não contém a fundação B1/B2/B5, nem os quatro perfis ativos que precisamos validar. Além disso, há caminhos de escrita direta autorizados por RLS e grants, enquanto as RPCs críticas usam listas fixas de perfis.

A próxima entrega deve ser um inventário estático das chamadas do código-fonte. Precisamos mapear cada RPC e cada `.from(...).insert/upsert/update/delete` aos módulos da aplicação antes de modificar políticas ou revogar privilégios.

## 1. Divergências entre o banco de integração e o modelo de permissões

O inventário confirma:

- PostgreSQL 17.6 no container de integração.
- Somente um perfil `administrador` e um `producao`; não há `apoio`, `visualizador` nem `lideranca` nessa base.
- Ausência de `permission_catalog`, `role_permissions`, `user_permission_overrides`, `permission_change_audit`, `has_app_permission`, `has_app_permissions` e `get_my_app_context`.
- O container está vinculado ao diretório `C:\Testes\ENDERECAMENTO_INTEGRACAO_LOCAL`, diferente do projeto de desenvolvimento `C:\Projetos\endere-amento`.

**Consequência:** o banco de integração não está pronto para testar a matriz final. A presença do schema de estoque não implica que ele tenha as migrations de permissão do sandbox separado.

## 2. Operações transacionais já encontradas

| Operação/função | Assinatura observada | Autorização atual observada | Tratamento proposto |
|---|---|---|---|
| Mutação atômica geral | `apply_stock_mutation_atomic(p_expected_slots, p_slots, p_expected_divergencias, p_divergencias, p_history)` | Lista fixa: administrador, liderança, apoio e produção | Não atribuir uma única permissão sem distinguir lançamento, correção física e metadados. Mapear todos os chamadores; depois usar wrappers com permissões por operação ou verificação estrita derivada do payload/diff. |
| Mutação atômica com exclusões | Mesmos argumentos + `p_delete_slot_ids text[]` | Lista fixa equivalente | Preservar histórico de saída, validações de identidade e atomicidade; autorizar conforme a operação original que chamou o fluxo. |
| Reconciliação física | `reconcile_physical_address_atomic(p_correction_id, p_address, p_expected_slots, p_slots, p_expected_divergencias, p_divergencias, p_history)` | Lista fixa inclui produção | Exigir a permissão específica de correção física; validar também a resolução da divergência quando a operação fizer as duas coisas. |
| Reconciliação física com exclusões | Assinatura anterior + `p_delete_slot_ids text[]` | Lista fixa equivalente | Mesmo tratamento, preservando idempotência e auditoria. |
| Resolução de divergência | `resolve_stock_divergence_atomic(p_expected_slots, p_slots, p_history, p_expected_divergencias, p_divergencias)` | Lista fixa inclui produção; metadados dizem `SECURITY DEFINER = false` | Exigir `divergences.resolve` no servidor e manter regras RLS de estoque/histórico; considerar que a operação também altera estoque. |
| Salvar estrutura de módulos | `save_warehouse_layout_atomic(p_expected_layout, p_layout)` | Administrador | Manter `warehouse.layout.manage`, sem ampliar acesso por herança. |
| Salvar posições físicas | `save_warehouse_positions_atomic(p_expected_positions, p_positions)` | Administrador | Manter `warehouse.layout.manage`, incluindo bloqueios por saldo e módulo. |
| Excluir módulo | `delete_warehouse_module(p_estoque, p_modulo)` | Verifica administrador dentro da função | Manter permissão administrativa de gestão da estrutura. |
| Excluir posição | `delete_warehouse_position(p_estoque, p_modulo, p_posicao)` | Verifica administrador dentro da função | Mesmo tratamento. |

O relatório contém as definições completas das funções críticas. Este documento resume apenas os contratos relevantes para a decisão de autorização.

## 3. RPCs esperadas que não foram encontradas

Nenhuma sobrecarga foi encontrada para:

- `process_shared_lancamento_draft_batch_atomic`
- `zero_physical_divergence_address_atomic`
- `get_shared_lancamento_batch_result`
- `get_shared_lancamento_draft`
- `get_my_app_context`
- `has_app_permission`
- `has_app_permissions`

Isso é uma ausência de catálogo com as assinaturas procuradas, não prova isolada de que o frontend ainda as chame. Precisamos comparar com o inventário estático do código antes de decidir se essas funções estão ausentes, têm outros nomes ou pertencem a uma versão não aplicada.

## 4. DML direto detectado pelo banco

`authenticated` tem grants `INSERT`, `UPDATE` e `DELETE` em oito tabelas: `divergencias`, `history`, `occupancy_history`, `products`, `profiles`, `slots`, `warehouse_layout` e `warehouse_layout_positions`.

O grant isoladamente não comprova que cada mutação esteja permitida: as políticas RLS ainda filtram operações. Porém, as políticas atuais dão acesso de escrita diretamente, baseado em perfil, em partes importantes:

- `slots`: `INSERT`/`UPDATE` para administrador, liderança, apoio e produção.
- `history`: `INSERT` para esses mesmos perfis.
- `divergencias`: `INSERT`/`UPDATE` para esses perfis.
- `occupancy_history`: `INSERT`/`UPDATE` para esses perfis.
- `products`: `INSERT`/`UPDATE`/`DELETE` para administrador e liderança.
- `warehouse_layout` e `warehouse_layout_positions`: escrita administrativa; exclusões têm RPCs próprias.

**Risco principal:** escrita direta em `slots`, `history` ou `divergencias` pode contornar as garantias transacionais das RPCs de estoque, caso a política permita a operação. Não basta proteger as RPCs; é necessário migrar todos os chamadores e, só depois, reduzir os grants/políticas diretas de forma testada.

Em `profiles`, os grants DML aparecem no catálogo, mas a política listada é apenas leitura da própria linha. A inexistência de política `INSERT`/`UPDATE`/`DELETE` impede inferir que essas gravações estejam autorizadas por RLS. Ainda assim, convém revogar grants desnecessários ao terminar a transição.

## 5. Informações que ainda faltam

O arquivo de banco não identifica os locais de chamada no código TypeScript. Também não forneceu linhas explícitas de inventário de triggers; portanto, não devemos concluir que não existam triggers. Antes de fechar a migration de autorização, precisamos confirmar:

1. Todos os pontos de chamada das RPCs acima e eventuais nomes alternativos.
2. Todas as chamadas de escrita direta por tabela, incluindo fluxos móveis, lote compartilhado, divergências, cadastro de SKU, layout e snapshots.
3. Triggers e dependências que possam executar gravações auxiliares.
4. Quais caminhos usam a mutação atômica geral para lançamento, correção física ou apenas metadados.

## 6. Próximo procedimento

Executar o script `scripts/Export-PermissionWriteCallsites.ps1` entregue com este pacote. Ele faz uma leitura estática dos diretórios `src`, `supabase/functions` e `server.ts` (se existir), sem acessar o banco, rede ou arquivos `.env`. O relatório resultante será:

`docs/seguranca/permission-write-callsite-inventory.txt`

Com esse mapa, preparar uma única proposta de migração por grupos de operações, com:

- permissões exatas por tipo de mutação;
- alterações às RPCs e políticas RLS necessárias;
- migração de todos os chamadores antes de revogar DML;
- teste positivo/negativo por perfil;
- rollback versionado e verificação pós-migração.

**Nenhuma migration de autorização de mutações deve ser executada até que o inventário do código confirme os chamadores e os caminhos alternativos.**
