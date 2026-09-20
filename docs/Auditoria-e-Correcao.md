# Auditoria e correção segura — Endereçamento

## Objetivo

Corrigir o indicador visual de SKUs sem movimentação sem alterar dados do Supabase e sem refatorar o sistema.

## Correção aplicada

### `src/App.tsx`
- O Dashboard passou a carregar histórico de 60 dias em vez de 30.
- Isso permite calcular corretamente a faixa `60+` sem precisar carregar todo o histórico.

### `src/components/DashboardCards.tsx`
- Referências de SKU são normalizadas para comparação (`trim + uppercase`).
- Datas operacionais ISO (`YYYY-MM-DD`) são calculadas sem depender de conversão UTC/local.
- Movimentações futuras/fora da janela não são consideradas como movimentações recentes.
- O valor sentinela `999` foi eliminado da apresentação.
- Quando não existe movimentação dentro dos 60 dias carregados, a tabela apresenta `60+`.
- O filtro `7 / 15 / 30 / 60+` continua usando o mesmo conjunto de dados do CSV do drawer.
- O arquivo também recebeu tipagem explícita para os conjuntos de referências, eliminando o erro de TypeScript dessa área.

## Evidência da causa

O Dashboard calculava `diasParado = 999` quando não encontrava o SKU no `history` carregado.

Ao mesmo tempo, `App.tsx` limitava o histórico carregado no Dashboard a 30 dias.

Portanto, uma movimentação ocorrida há mais de 30 dias não estava disponível para o cálculo e era convertida artificialmente em `999`. Como a tabela ordena por `diasParado` decrescente, esses registros apareciam primeiro e davam a impressão de que os botões de período não estavam atualizando a tabela.

## Auditoria adicional

### CONFIRMADO — alto risco
As ações administrativas `Limpar Planilha` e `Excluir todos os registros` alteram apenas estado/localStorage no código atual. Elas não executam `delete`, `update` ou `upsert` correspondente no Supabase.

Isso significa que a interface pode informar que os dados foram limpos enquanto os dados reais permanecem no banco.

**Não alterei essas rotinas nesta correção**, justamente para não tocar em dados operacionais consolidados sem uma estratégia transacional e uma confirmação adicional.

### CONFIRMADO — alto risco
`handleDeleteHistoryItem` também remove somente do estado/localStorage e não exclui o registro da tabela `history`.

### CONFIRMADO — alto risco de segurança
O login atual não usa Supabase Auth. A tabela `users` é carregada para o navegador, incluindo o campo `password`, e as senhas são armazenadas em texto puro. Existe ainda uma credencial administrativa inicial no código.

Isso deve ser tratado como projeto de segurança separado, não misturado com a correção do Dashboard.

### CONFIRMADO — integridade transacional
Lançamentos são persistidos em etapas separadas:
1. slots
2. history
3. divergências

Se uma etapa posterior falhar, pode existir persistência parcial.

A reconciliação de divergências também depende de múltiplas chamadas assíncronas separadas.

### CONFIRMADO — dívida de tipagem
O `npm run lint` atual possui erros pré-existentes em outras partes do projeto:
- inconsistências de capitalização/tipo dos papéis de usuário em `App.tsx`;
- tipos em `DivergenciasPanel.tsx`;
- import ausente em `SkuAnalysisDrawer.tsx`;
- `onSelectSlot` duplicado em `VerticalModuleMap.tsx`;
- `ImportMeta.env` sem declaração de tipos em `supabase.ts`.

O erro que existia em `DashboardCards.tsx` nessa região deixou de aparecer após a correção.

### DESCONHECIDO
Não há migrations/schema SQL do Supabase no ZIP. Portanto não é possível confirmar, a partir deste projeto, se RLS e policies protegem corretamente `users`, `slots`, `history`, `divergencias` e `products`.

Também não é possível confirmar a quantidade real de registros do banco sem consultar o ambiente Supabase.

## Processo mapeado

UI
→ estado React
→ validação
→ processamento sequencial
→ persistência Supabase
→ atualização do estado
→ apresentação

Principais fluxos:
- Login → usuários
- Dashboard → slots + histórico + divergências + produtos
- Lançamento unitário → slot → histórico
- Lançamento em lote → validação → processamento sequencial → slots → histórico → divergências
- Divergência → correção → slots + divergência + histórico
- Histórico → consulta paginada
- Produtos → CRUD
- Exportações → consulta/estado da tela

## Próxima etapa recomendada

Antes de qualquer alteração estrutural no banco, fazer uma segunda etapa de auditoria focada em:
1. RLS/policies do Supabase;
2. transações/RPC para lançamentos e reconciliações;
3. proteção do histórico contra exclusão;
4. migração do login para Supabase Auth;
5. remoção de senhas do frontend;
6. rotinas de limpeza administrativa com confirmação, backup e operação transacional;
7. correção dos erros de TypeScript existentes;
8. testes de concorrência e falha parcial.

## Validação realizada

- Análise estática do código atual.
- `npm run lint`: executado. O projeto ainda falha por erros pré-existentes em outros arquivos; `DashboardCards.tsx` não aparece mais entre os erros.
- Build Vite: não concluído neste ambiente porque o `node_modules` enviado foi instalado para Windows e contém binários nativos incompatíveis com Linux, incluindo Rollup/esbuild.

Não foi feita nenhuma operação contra o banco Supabase e nenhum dado operacional foi alterado.
