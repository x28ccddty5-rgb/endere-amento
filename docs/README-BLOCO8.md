# Endereçamento — Bloco 8: histórico diário de ocupação e saldo por SKU

**Pacote local de implantação:** 2 de novembro de 2026  
**Projeto Supabase oficial:** `eltxmfgrbobinzchtxme`  
**Repositório/branch de referência:** `x28ccddty5-rgb/endere-amento` / `main`  
**Commit-base do frontend:** `f2c074e62ba72777b531d041112427d4a7d1d448`

## Objetivo fechado

Este pacote substitui a gravação da ocupação dependente do navegador por uma rotina nativa agendada no PostgreSQL e acrescenta uma fotografia diária consolidada dos saldos por SKU. A fotografia fica consultável no aplicativo por **referência ou descrição**, com seleção de data e exportação em **PDF e Excel**.

A solução usa somente recursos já presentes no projeto e recursos nativos do Supabase/PostgreSQL. Não adiciona Edge Function, `pg_net`, canal Realtime, dependência npm nem serviço de conversão pago.

## O que será entregue

1. **Gravação diária garantida no servidor:** Cron executa uma função SQL uma vez por dia, às 23h55 no horário de São Paulo. O banco atual usa Cron em GMT/UTC, então a expressão é `55 2 * * *` (02h55 UTC corresponde a 23h55 em São Paulo no dia anterior).
2. **Ocupação geral:** calcula posições ocupadas/livres, capacidade total, percentual, paletes E1 e total de peças, mantendo a regra operacional atual do Dashboard.
3. **Saldo histórico por SKU:** consolida todas as posições de cada referência em uma linha por data e referência, com saldos separados em E1, E2, E3 e total, mais quantidade de endereços com saldo.
4. **Catálogo completo:** produtos cadastrados sem saldo também recebem linha com saldo zero. Referências encontradas nos endereços, ainda que ausentes do catálogo, também entram. Saldo positivo sem referência fica em uma linha técnica `SEM REFERENCIA`, sem desaparecer da reconciliação.
5. **Consulta:** disponível no Histórico desktop e mobile. A busca é local sobre a fotografia do dia, procurando tanto na referência quanto na descrição, sem emitir request a cada tecla.
6. **Exportação:** PDF A4 paisagem com cabeçalho, data da fotografia, filtro aplicado e tabela paginada; Excel com abas de detalhes e resumo. Ambos usam os pacotes `jspdf`, `jspdf-autotable` e `xlsx` já existentes.
7. **Reconciliação:** a execução só conclui se a soma das fotografias por SKU for idêntica à soma positiva dos saldos na tabela `slots`. A função registra execução concluída, quantidade de linhas e totais em schema interno não exposto pela Data API.
8. **Controle de acesso:** leitura da fotografia por `history.view` + `stock.search`; PDF/Excel exigem também `reports.export`, usando o fluxo de autorização atual. Não há escrita direta dos usuários na nova tabela.

## O que foi corrigido em `occupancy_history`

A versão anterior só tentava gravar quando alguém abria o Dashboard com perfil capaz de gravar. O `setTimeout` do navegador era cancelado se o componente fosse desmontado, a pessoa navegasse para outra tela ou fechasse a aba. Logo, não havia garantia de uma linha diária.

Com este pacote:

- O navegador deixa de inserir/atualizar `occupancy_history`.
- O usuário comum conserva leitura conforme `dashboard.view`.
- Cron executa a rotina no banco mesmo sem ninguém conectado ao aplicativo.
- A restrição única por `snapshot_date` preserva uma linha por dia; executar novamente no mesmo dia atualiza essa linha, sem duplicar.
- A primeira fotografia é criada na aplicação da migration como linha-base do dia. O job das 23h55 atualiza o mesmo dia no fechamento.
- Durante a captura, a função adquire locks `SHARE` curtos nas tabelas de origem para manter saldo, catálogo e layout coerentes no mesmo instante. Leituras continuam liberadas; gravações nessas quatro tabelas aguardam a captura terminar.

## Consulta e exportação

A tela usa a permissão existente `history.view`; não cria chave de permissão nova. Para carregar os saldos por SKU, a política do banco exige também `stock.search`, pois a informação deriva da base operacional de estoque. A exportação usa `reports.export` + `history.view` e mantém a limitação de acesso a dados da tela.

Campos exportados: referência, descrição, saldo E1, saldo E2, saldo E3, saldo total e quantidade de endereços com saldo. A planilha tem uma aba de linhas detalhadas e outra com data, captura, filtro e totais exibidos.

## Supabase Free: cabe no plano?

**Sim, dentro dos limites atuais, sem produto pago adicional**, desde que o crescimento seja monitorado:

- O `pg_cron` é uma extensão PostgreSQL nativa habilitável no projeto. Um job executa SQL diretamente; não invoca Edge Function nem `pg_net`.
- O banco oficial medido nesta revisão tinha aproximadamente **26 MB** frente ao limite Free de **500 MB por projeto**.
- O catálogo consultado tinha **202 produtos**. Uma linha por produto por dia equivale a cerca de **73.730 linhas/ano**, mais eventual linha sem referência e índices. É um volume inicial pequeno, mas a ocupação real deve ser monitorada após algumas semanas.
- Não há Realtime nem Edge Function novo. A tela faz uma leitura paginada por data, carrega no máximo o conjunto diário e aplica a pesquisa por referência/descrição no navegador.
- O Free não inclui backup automático diário/PITR. Portanto, antes da implantação é obrigatório realizar um backup lógico externo e manter uma rotina manual de exportação do banco fora do Supabase.

Limites e documentação oficial consultada para esta revisão: plano Free 500 MB de banco, 5 GB de egress, quotas de Edge Functions/Realtime; Cron usa `pg_cron` e registra execuções em `cron.job_run_details`.

- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/cron/install
- https://supabase.com/docs/guides/database/extensions/pg_cron

O Free não é uma garantia de armazenamento ilimitado nem de backup. Se o histórico crescer, monitorar tamanho do banco e egress; arquivamento ou upgrade só deve ser considerado quando houver evidência de necessidade.

## Histórico anterior à implantação

Não preencher artificialmente saldos por SKU para datas anteriores à primeira fotografia deste pacote. A auditoria somente leitura encontrou 23.363 movimentos, mas apenas 176 possuem o par `saldoAnterior`/`saldoFinal`; há formatos de data diferentes, eventos sem referência e datas suspeitas. A reversão matemática de entradas/saídas contra os snapshots gerais existentes divergiu significativamente (mais de 200 mil peças em algumas datas de outubro). Portanto, não é tecnicamente correto apresentar esse cálculo como saldo real.

A interface informa explicitamente quando uma data não possui fotografia. O histórico gerencial confiável por SKU começa na aplicação do Bloco 8. Uma reconstrução retroativa, caso desejada depois, deve ser um projeto separado, classificado como estimativa e reconciliado com fonte externa/TOTVS — nunca mesclado silenciosamente aos snapshots oficiais.

## Arquivos do pacote

- `src/App.tsx` — integração no Histórico desktop e passagem da permissão de exportação.
- `src/components/DashboardCards.tsx` — remove gravação manual/automática pelo navegador; conserva leitura.
- `src/components/StockBalanceHistoryPanel.tsx` — tela de consulta, busca por referência/descrição, PDF e Excel.
- `src/components/mobile/MobileShell.tsx` — integração equivalente no Histórico mobile.
- `supabase/migrations/20261102181100_daily_stock_snapshots.sql` — tabela, RLS, função, extensão Cron, job e primeira fotografia.
- `docs/sql/VERIFY_DAILY_STOCK_SNAPSHOTS.sql` — verificação somente leitura.
- `docs/sql/DIAGNOSTICO_HISTORICO_LEGADO.sql` — diagnóstico somente leitura, sem backfill.
- `docs/sql/ROLLBACK_DAILY_STOCK_SNAPSHOTS.sql` — para job, restaura acesso anterior a occupancy_history e preserva dados novos.
- `tests/daily-stock-snapshot-package.test.mjs` — contratos estáticos focados no pacote.
- `Install-DailyStockHistoryPackage.ps1` — instalador com backup e verificações locais.

## Ordem de implantação

1. **Backup externo:** gerar dump lógico do banco antes de qualquer DDL. O Free não tem PITR/backups automáticos diários. A documentação oficial recomenda exportação via Supabase CLI e cópia fora do projeto. No PowerShell, após confirmar `supabase db dump --help` e que o projeto está linkado, use:

   ```powershell
   $backup = Join-Path $env:USERPROFILE ("Downloads\ENDERECAMENTO-BACKUP-BLOCO8-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
   New-Item -ItemType Directory -Path $backup -Force | Out-Null
   supabase db dump --linked --file (Join-Path $backup "schema.sql")
   supabase db dump --linked --role-only --file (Join-Path $backup "roles.sql")
   supabase db dump --linked --data-only --use-copy --file (Join-Path $backup "data.sql")
   ```

   O `db dump` usa Docker para executar `pg_dump`; os três arquivos devem ser conferidos e copiados para outro local físico/seguro antes da migration. Não incluir os dumps no GitHub. <https://supabase.com/docs/guides/platform/backups> e <https://supabase.com/docs/reference/cli/introduction>.
2. **Instalação local:** rodar `Install-DailyStockHistoryPackage.ps1` no projeto `C:\Projetos\endere-amento`. O instalador só copia arquivos e gera backup local; não conecta ao Supabase.
3. **Revisão de migration:** conferir `20261102181100_daily_stock_snapshots.sql` e confirmar no `supabase migration list` que as migrations A/C/D anteriores continuam alinhadas. A migration do Bloco 8 deve ser a única pendente.
4. **Aplicação em janela controlada:** `supabase db push` aplica uma migration transacional. Ela cria `pg_cron`, a tabela, políticas, função, um único job e a fotografia inicial. Se qualquer preflight ou reconciliação falhar, a transação inteira é revertida.
5. **Deploy do frontend:** enviar as quatro alterações de frontend para GitHub `main`; isso pode disparar deploy automático da Vercel. O frontend novo precisa estar publicado para consulta e exportação.
6. **Verificação:** executar `VERIFY_DAILY_STOCK_SNAPSHOTS.sql`, conferir o total da fotografia contra `slots`, confirmar apenas um job `55 2 * * *`, conferir RLS/privilegios e validar uma consulta/exportação com perfis permitidos.
7. **Fechamento:** conferir a primeira atualização de 23h55 em São Paulo no `cron.job_run_details` e a linha do mesmo dia em `occupancy_history` e `stock_balance_snapshots`.

Não executar `ROLLBACK_DAILY_STOCK_SNAPSHOTS.sql` como etapa normal; ele só deve ser usado se houver rollback coordenado do frontend/feature. Ele preserva a tabela nova e o histórico já capturado.

## Limites conhecidos / decisão de desenho

- Fotografia é no fechamento diário, não intradiária. Para saber saldo às 10h de uma data passada será necessário usar trilha transacional confiável com saldo anterior/final ou adicionar uma trilha de eventos mais forte.
- O snapshot E1 usa a paletização atual do cadastro. Mudança futura de paletização pode alterar a métrica de paletes de ocupação em dias subsequentes; o saldo em peças permanece independente.
- O saldo é consolidado por referência, não por endereço. A tela mostra também a divisão por estoque E1/E2/E3.
- A função usa apenas estoque atual na hora de rodar; nunca cria datas passadas, nem completa lacunas antigas.
- Se a quantidade diária de referências superar 5.000, a tela bloqueia a leitura com erro explícito em vez de truncar silenciosamente.

## Estado do pacote

Este ZIP é um **release candidate local**. Nenhuma migration deste Bloco 8 foi aplicada ao Supabase oficial e nenhum deploy foi realizado por este pacote. A instalação local deve ser seguida da revisão e da sequência acima.
