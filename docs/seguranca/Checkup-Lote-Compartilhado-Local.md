# Checkup do contrato de lançamento compartilhado — somente leitura

## Por que este checkup existe

A B7.1 foi verificada no clone local. O runner reportou `SHARED_BATCH_RPC|false`. O frontend ainda usa `process_shared_lancamento_draft_batch_atomic` para concluir lotes compartilhados; a saída do banco não confirma essa RPC nem a família restante.

O SQL versionado em `docs/sql/20261024_shared_lancamento_draft.sql` é uma migração histórica. A função de lote definida nessa versão chama `apply_stock_mutation_atomic` e `apply_stock_mutation_atomic_with_deletes` sem `p_operation_type`. A B7.1 substituiu essas assinaturas legadas por wrappers que lançam `STOCK_OPERATION_TYPE_REQUIRED`. Por isso, **não execute a migração histórica como está após B7.1**.

## O que o script faz

- Confirma o container `supabase_db_enderecamento-integracao-local`, os labels Docker e o banco PostgreSQL 17.
- Inspeciona a tabela legada `lancamento_drafts`, as cinco tabelas da versão compartilhada e as colunas presentes.
- Inspeciona a família de seis RPCs do rascunho compartilhado.
- Lista assinaturas, `SECURITY DEFINER`, `search_path` e privilégio `EXECUTE` das funções escritoras de estoque.
- Lista funções públicas com corpo que referencia escritores de estoque.
- Mostra contagens dos perfis e disponibilidade do ledger de migrations.
- Não lê linhas de rascunho e não grava, altera, revoga ou concede nada.

## Execução

Na raiz `C:\Projetos\endere-amento`:

```powershell
node --test tests/shared-launch-contract-readonly.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Inspect-SharedLaunchContract-LocalIntegration.ps1
```

O runner não pede confirmação porque executa apenas consultas de catálogo e `information_schema`.

## Decisão após o resultado

- Se `lancamento_drafts` não existir, a migração histórica irá bloquear no seu preflight. Precisaremos descobrir qual versão da base de integração corresponde ao frontend antes de criar tabelas.
- Se as tabelas compartilhadas existirem parcialmente, não tentar uma instalação nova; revisar e reconciliar o estado parcial.
- Se a família estiver ausente e a tabela legada existir, ainda não executar o arquivo histórico sem ajuste: a RPC de processamento precisa invocar o escritor tipado com `p_operation_type = 'launch'` e exigir `stock.launch.create`, mantendo o controle de idempotência, geração, revisão, bloqueios de escopo e rollback transacional.
- Não revogar DML direto enquanto todos os fluxos de lote e operações dedicadas não tiverem sido testados.

Nada deste checkup altera ou autoriza mudanças no Supabase de produção.
