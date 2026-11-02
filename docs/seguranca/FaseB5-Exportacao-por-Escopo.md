> **Atualização em 31/10/2026 — regra vigente:** este documento registra a fase histórica de implementação. A regra final é `reports.export` + `stock.search` para a Pesquisa; a projeção Excel/PDF é fixa com 12 campos operacionais, nunca inclui `slots.id`, e não varia por perfil. `stock.details.view` não controla mais os campos exportados. Consulte a seção 11 da matriz v1.2 para a regra de leitura, filtros e Realtime.

# Fase B5 — Autorizar exportação pelo escopo do módulo

**Status:** preparada para validação no Supabase local; não publicada.

## Objetivo

Evitar que a permissão geral `reports.export` seja suficiente para exportar um relatório de um módulo que o usuário não pode consultar. A checagem passa a exigir `reports.export` e as permissões de escopo daquele relatório.

## RPC

A nova função `public.has_app_permissions(text[])` avalia até oito chaves em uma chamada ao banco. Retorna `false` em caso de sessão ausente, lista nula/vazia, quantidade excessiva, chave desconhecida/inativa, chave repetida ou qualquer permissão negada. `SECURITY DEFINER` fixa `search_path` vazio e o `EXECUTE` é concedido somente a `authenticated`.

O frontend valida o contexto de sessão e repete a checagem em uma única chamada imediatamente antes de gerar o arquivo ou iniciar a impressão. Falha de RPC bloqueia a exportação.

## Escopos aplicados nesta fase

- XLSX/PDF de Endereçamento: `reports.export` + `stock.search`; `stock.details.view` determina se o relatório inclui saldos, chacote, última movimentação, responsável, restrição e observação. Sem essa chave, o arquivo inclui somente estoque, módulo, posição, SKU e descrição, sem saldo total no cabeçalho.
- CSV de Histórico: `reports.export` + `history.view`.
- CSV/PDF/impressão de Divergências: `reports.export` + `divergences.view`.
- CSV de lista detalhada do Dashboard/SKUs parados: `reports.export` + `dashboard.view` + `stock.details.view`.
- PDF executivo do Consultor: `reports.export` + `consultor.use`.
- PDF de plano de consolidação: `reports.export` + `products.view` + `stock.details.view` (handler guardado, embora a busca estática atual não encontre botão que o invoque).
- O XLSX `layout_porto_brasil.xlsx` permanece exceção: é um modelo fixo com linha sintética para importação, não exporta dados de estoque. Reavaliar se passar a conter dados reais.

Os escopos acima não substituem a revisão de RLS para consultas diretas. O relatório é gerado no navegador e a camada de RLS deve continuar limitando quais linhas/colunas o usuário consegue consultar.

## Ordem de validação local

1. Executar os testes estáticos `tests/permission-scoped-export-contract.test.mjs`, `tests/app-permission-export-gate.test.mjs` e `tests/stock-search-export-projection.test.mjs`.
2. Aplicar somente a nova migration no projeto `docs/seguranca/permission-sandbox`, sem reset:
   `supabase migration up --local`.
3. Executar `docs/sql/20261028050000_permission_scoped_check_verify.sql` e `docs/sql/20261028050000_permission_scoped_check_smoke_test.psql` no banco do sandbox local.
4. Reiniciar apenas o Vite de teste (não reiniciar o sandbox) e verificar Rafael/Apoio, Produção e Visualizador.

## Rollback

1. Voltar o frontend para a versão anterior que não chama `has_app_permissions`.
2. Executar `docs/sql/rollback/20261028050000_rollback_permission_scoped_check.sql` no sandbox/teste.
3. O rollback elimina somente a nova RPC, sem `CASCADE`, sem apagar tabelas e sem alterar a matriz B1/B2.

Não executar no Supabase de produção nesta fase.
