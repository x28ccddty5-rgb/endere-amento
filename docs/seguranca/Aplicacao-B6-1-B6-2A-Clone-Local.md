# Aplicação B6.1 + B6.2A no clone local de integração

## Objetivo

Aplicar as migrations já revisadas de autorização do cadastro individual de produtos (B6.1) e da RPC restrita de edição de metadados do endereço (B6.2A), exclusivamente em `supabase_db_enderecamento-integracao-local`.

## Pré-requisitos

1. B1/B2 aplicadas e smoke testadas no mesmo banco.
2. Os arquivos de migration, verificação e rollback das duas fatias estão presentes no projeto.
3. `products` está com RLS habilitado e as três policies antigas (`products_insert_management`, `products_update_management`, `products_delete_management`) são exatamente o estado prévio conhecido.
4. As colunas `id`, `estoque`, `modulo`, `posicao`, `referencia`, `descricao`, `saldo`, `dataChacote`, `galpao`, `restricao` e `observacao` existem em `slots`.
5. Ainda não existe a RPC `update_slot_metadata_atomic(jsonb,jsonb)`.

## Execução

Da raiz `C:\Projetos\endere-amento`:

```powershell
node --test tests/permission-product-metadata-integration-apply-contract.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Apply-PermissionProductAndMetadata-ToLocalIntegration.ps1
```

O script só prossegue se o container, labels, workdir e banco coincidem com o alvo esperado e se a matriz é 29/116. Exige a confirmação literal `APLICAR B6.1 B6.2A LOCAL`.

## O que é testado após as migrations

- Policies de escrita de products usam `products.create`, `products.edit` e `products.delete_deactivate` de forma separada.
- A policy de leitura `products_select_authenticated` permanece presente.
- No perfil administrador as três permissões base são verdadeiras; em Produção são falsas.
- A RPC de metadados existe, `authenticated` pode executar e `PUBLIC` não.
- Uma chamada com payload vazio sob perfil Produção é recusada por `PERMISSION_DENIED:map.metadata.edit`.
- Uma chamada com payload vazio sob perfil administrador avança até `INVALID_SLOT_METADATA_PAYLOAD`, provando que não foi barrada na autorização.
- Ambas as chamadas de smoke são revertidas e não alteram produtos ou estoque.

## Limites

- Não testa o login GoTrue/REST nem a edição real de um slot com payload completo.
- Não revoga grants diretos em `products`, `slots`, `history` ou `divergencias`.
- Não instala as RPCs operacionais de estoque que faltam no inventário.
- Não aplica nada no Supabase Cloud/produção.

## Se houver falha após B6.1

Não execute o script novamente: o preflight deverá detectar estado parcial e bloquear repetição. Guarde a saída integral. Antes de usar o rollback, confirme a política que está instalada e siga `docs/sql/rollback/20261028060000_rollback_permission_product_mutations.sql` somente no clone local. Se B6.2A já foi instalada, a remoção da função deve ocorrer somente depois do rollback do código que a chama.
