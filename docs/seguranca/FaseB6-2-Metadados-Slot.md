# Etapa 03 — B6.2A: edição de metadados via RPC restrita

## Escopo

A edição móvel altera somente `dataChacote`, `galpao`, `restricao` e `observacao`. Não deve escrever `saldo`, referência, descrição, identidade física, histórico nem divergências.

O cliente revalida `map.metadata.edit` antes da chamada. A RPC `public.update_slot_metadata_atomic(jsonb,jsonb)` verifica a mesma permissão no PostgreSQL, bloqueia a linha com `FOR UPDATE`, compara a fotografia esperada (incluindo saldo/SKU/endereço e os metadados atuais) e atualiza somente as quatro colunas permitidas. Em caso de conflito, a operação é negada sem retry automático. A mesma revisão removeu o helper de inserção direta do histórico que não tinha chamadores ativos; os movimentos válidos permanecem gravados pelas RPCs transacionais existentes.

## Arquivos desta fatia

- `src/App.tsx`
- `docs/sql/migrations/20261028070000_permission_slot_metadata_atomic.sql`
- `docs/sql/20261028070000_permission_slot_metadata_verify.sql`
- `docs/sql/rollback/20261028070000_rollback_permission_slot_metadata_atomic.sql`
- `tests/permission-slot-metadata-contract.test.mjs`

## Ordem no clone local de integração

1. Esta versão de `src/App.tsx` acumula a alteração B6.1. Se B6.1 ainda não foi aplicado, aplique primeiro o pacote B6.1 completo ou use a versão cumulativa e inclua também `src/components/BaseDeDadosPanel.tsx` do B6.1.
2. Executar `npm run lint` e `node --test tests/permission-slot-metadata-contract.test.mjs tests/permission-product-mutation-contract.test.mjs`.
3. Confirmar B1/B2 e aplicar **somente** `20261028070000_permission_slot_metadata_atomic.sql` no clone local.
4. Executar `20261028070000_permission_slot_metadata_verify.sql`.
5. Com usuários autenticados de teste, validar: usuário sem `map.metadata.edit` recebe negação; usuário com a chave consegue editar metadados; tentativa de enviar saldo/SKU/endereço alterados no payload não muda esses campos; fotografia desatualizada é negada; galpão 12 exige restrição `autorizacao`.
6. **Não revogar ainda o DML direto em `slots`.** O inventário mostrou que o código atual chama `process_shared_lancamento_draft_batch_atomic` e `zero_physical_divergence_address_atomic`, mas esses contratos não aparecem no banco local de integração auditado. O bloqueio do DML só deve ser liberado após reconciliação desses contratos, revisão de todos os escritores e teste dos fluxos operacionais.

## Rollback

Para B6.2A, reverta `src/App.tsx` para a versão anterior ao patch e só então execute o rollback SQL para remover a RPC. Não remova a RPC antes de reverter o código que a chama.

## Segurança e limites

- Não executar em produção.
- A RPC não faz retry e não usa fallback para DML direto.
- O patch retira o `upsert` direto de `slots` do código de edição móvel, mas **não conclui o fechamento de todos os acessos diretos no banco**. Esse fechamento é deliberadamente adiado até que os contratos operacionais ausentes sejam reconciliados.
