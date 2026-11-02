# Smoke test transacional B6.2A — clone local

## Objetivo

Exercitar a RPC `public.update_slot_metadata_atomic(jsonb,jsonb)` por um caminho real de atualização no banco local de integração, não apenas o erro de payload vazio:

1. `producao` deve ser recusado com `PERMISSION_DENIED:map.metadata.edit` antes de validar o payload.
2. `administrador` deve atualizar temporariamente `observacao` de um slot com metadados válidos.
3. O teste confere que `dataChacote`, `galpao`, `restricao` e `observacao` ficaram nos valores esperados e que o restante da linha permaneceu idêntico.
4. A transação é revertida, e uma verificação posterior confirma que o marcador não persiste.

## Execução

Na raiz `C:\Projetos\endere-amento`:

```powershell
node --test tests/permission-metadata-rpc-rollback-smoke-contract.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-PermissionMetadataRpc-LocalIntegration.ps1
```

O script valida labels do container `supabase_db_enderecamento-integracao-local`, o workdir esperado, a fundação 29/116, a existência da RPC e um slot elegível. Exige confirmação literal `TESTAR RPC METADADOS COM ROLLBACK LOCAL`.

## Segurança/limites

- Não executa migrations, não altera policies/grants, não modifica saldos/SKU/histórico e não encerra/reinicia containers.
- A edição temporária ocorre somente dentro de uma transação revertida. Se houver erro antes do `ROLLBACK`, o `psql` encerra a conexão e o PostgreSQL reverte a transação aberta.
- O teste usa o papel `authenticated` com claims locais de perfis. Não valida login GoTrue/REST nem substitui teste manual da edição móvel.
- Não aplicar em produção.
