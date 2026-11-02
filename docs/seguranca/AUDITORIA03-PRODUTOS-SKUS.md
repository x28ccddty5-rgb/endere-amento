# Auditoria 03 — correção de Produtos e SKUs e validação de exportação

## Diagnóstico do painel Produtos e SKUs

O componente `BaseDeDadosPanel` comparava cada SKU com toda a coleção de posições. Para cada produto, executava `slots.filter(...)` e acessava diretamente `s.referencia.toUpperCase()` sem validar o valor.

O modelo operacional admite posições vazias, e registros desse tipo podem ter `referencia` nula ou vazia. Um único registro incompleto podia lançar `TypeError` durante a renderização do painel. Além disso, a combinação de milhares de produtos com milhares de posições criava processamento O(produtos x posições), seguido da montagem de todos os registros simultaneamente no DOM.

A correção:

- normaliza e valida produtos antes de renderizar; registros sem SKU válida são ignorados apenas na apresentação e contabilizados em um aviso, sem alterar a base;
- trata referências nulas/vazias em posições vazias sem lançar exceção;
- agrega os saldos por SKU em uma única passagem pelas posições (O(posições));
- pagina a lista em lotes de 100 itens, limitando o DOM e o trabalho de renderização;
- preserva a busca por referência e descrição;
- envia `permissionEnforcementEnabled` e o resolvedor atual de permissões ao painel, para que criar, editar e excluir sejam apresentados de acordo com permissões separadas.

## Troca de perfil e tela vazia

Ao sair, o app levava `activeTab` para `dashboard`. Ao entrar com um perfil que não possui `dashboard.view`, o desktop podia manter uma aba proibida selecionada e não renderizar conteúdo, embora outras abas estivessem liberadas. Foi adicionado um fallback que seleciona a primeira aba permitida após o contexto de permissões ficar pronto. Não altera concessões ou dados.

## RPC de exportação ausente

O frontend usa `public.has_app_permissions(text[])` para revalidar as permissões antes da exportação. A captura da integração mostrou HTTP 404 porque a RPC não estava no banco local. A migração antiga dessa RPC foi criada para uma matriz de quatro perfis (116 linhas); a matriz atual da Auditoria 03 contém cinco perfis configuráveis/de base e 145 combinações (29 x 5).

Foi criada uma migração aditiva específica para o contrato atual. Ela:

- exige 29 permissões ativas, 145 linhas e exatamente cinco perfis conhecidos;
- cria/substitui somente `public.has_app_permissions(text[])`;
- mantém `SECURITY DEFINER`, `search_path` vazio, entrada limitada a oito chaves e falha fechada;
- revoga execução de `PUBLIC` e `anon`, concedendo-a somente a `authenticated`;
- não altera catálogo, concessões, perfis, usuários, estoque ou histórico;
- solicita recarga do schema cache do PostgREST.

Se um perfil não tiver `reports.export` ou a permissão de leitura do módulo, a exportação continuará corretamente bloqueada pela regra de autorização, mas sem o erro técnico de RPC inexistente.

## Validações

- `npm run lint`: aprovado.
- Suíte automatizada completa: 306 testes aprovados, 0 falhas.
- Build: precisa ser executado no Windows do projeto. A cópia usada nesta validação não possui o binário opcional `@rollup/rollup-linux-x64-gnu`; o instalador executa `npm run build` no Windows antes de qualquer SQL.

## Escopo

O instalador verifica `.env.integration.local` apontando exatamente para `http://127.0.0.1:55441`, confirma que os containers `supabase_db_enderecamento-integracao-local` e `supabase_edge_runtime_enderecamento-integracao-local` estão ativos e só então aplica os arquivos e a migração. Não chama Supabase Cloud, Vercel, nem containers de produção.
