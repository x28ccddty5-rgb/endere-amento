# B7.1 — Tipo explícito na gravação genérica de estoque

## Escopo

- Atualiza `src/App.tsx` para enviar `p_operation_type` (`launch`, `transfer`, `physical_correction`) aos dois escritores atômicos.
- Recheca a permissão efetiva antes do fluxo.
- A RPC autoriza por `stock.launch.create`, `stock.transfer.create` ou `stock.physical_correction` e valida o formato do payload no servidor. O planejador de correção marca todo o histórico como `correcao_fisica`; para E1, calcula saldo anterior/final e exige UUID para cada operação.
- Lançamentos comuns podem abranger vários endereços, conforme o fluxo existente. Correção física fica limitada a um único escopo e todos os movimentos do seu payload precisam de marcador explícito de correção física. Transferência exige exatamente duas linhas de histórico em dois escopos E2/E3, uma `Saída` e uma `Entrada`, mesma referência/quantidade/restrição, e não pode mudar divergências.
- As assinaturas antigas não tipadas são substituídas por stubs fail-closed e perdem `EXECUTE` para `authenticated`, para impedir bypass através de uma chamada antiga. O wrapper novo chama a assinatura tipada.

## Pré-requisitos e limitações importantes

- Aplicar somente no clone de integração local identificado pelo script.
- A matriz precisa continuar 29/116/116 e B1/B2 + B6.1/B6.2A precisam estar presentes.
- A RPC de lote compartilhado `process_shared_lancamento_draft_batch_atomic` não existe no inventário do clone. Este patch não a cria e não valida o caminho de lote compartilhado. Como as assinaturas antigas falham fechadas, qualquer wrapper legado que ainda dependa delas não deve ser considerado compatível.
- Os caminhos dedicados `resolve_stock_divergence_atomic`, `reconcile_physical_address_atomic`, `zero_physical_divergence_address_atomic` e os escritores diretos de divergência permanecem sob uma trilha própria de autorização. Por isso, esta alteração **não fecha DML de tabela** e não é candidata a publicação isoladamente.
- Não testar movimentos reais neste runner; somente chamadas vazias dentro de transações revertidas.

## Aplicar e verificar

1. Extraia os arquivos preservando caminhos.
2. Execute `node --test tests/permission-typed-stock-mutation-contract.test.mjs`.
3. Execute `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Apply-TypedStockMutation-ToLocalIntegration.ps1`.
4. Confirme apenas depois que o container, banco e matriz forem identificados. Digite `APLICAR B7.1 TIPADO LOCAL`.
5. Se o runner bloquear ou falhar após a migration, não o repita. Envie a saída integral.

## Rollback

1. Reverter o `src/App.tsx` para os callsites antigos primeiro.
2. Executar `docs/sql/rollback/20261028090000_rollback_typed_stock_mutation_rpcs.sql` apenas no clone local.
3. Verificar que ambas as assinaturas tipadas foram removidas e as antigas restauradas.

A migration não revoga grants de tabelas nem modifica `slots`, `history`, `divergencias`, RLS ou a matriz.
