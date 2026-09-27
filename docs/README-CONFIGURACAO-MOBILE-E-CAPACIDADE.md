# Configuração E2/E3 + capacidade dinâmica + administração mobile

## Objetivo

Esta revisão faz três ajustes relacionados:

1. Dashboard e indicadores passam a usar as posições ativas de E2/E3 cadastradas em `warehouse_layout_positions`.
2. O Gêmeo Digital usa a configuração oficial para módulos, posições e total físico de E2/E3.
3. No Mobile, os módulos **Base** e **Config.** ficam disponíveis somente para o perfil Administrador.

## Arquivos alterados

- `src/App.tsx`
- `src/components/DashboardCards.tsx`
- `src/components/InteractiveMapa.tsx`
- `src/components/mobile/MobileShell.tsx`
- `src/components/WarehouseLayoutPanel.tsx` (versão v2 já validada para a regra do E1)

## Regras

### E1

Continua sendo capacidade estimada por rua. Não há comparação da capacidade com a ocupação estimada no salvamento.

### E2/E3

A capacidade física usada pelos indicadores é a quantidade de posições `ativo = true` em `warehouse_layout_positions`.

- E2: posições ativas configuradas.
- E3: posições ativas configuradas.

Slots ocupados são contados somente quando correspondem a uma posição física ativa configurada.

## Gêmeo Digital

O mapa já recebia `warehousePositions` e os usa para:

- listar módulos ativos;
- listar posições do módulo;
- separar posições ativas/inativas;
- desenhar somente as posições ativas.

Nesta revisão, os totais de capacidade/ocupação também deixam de usar os números fixos antigos.

### Observação importante

Ainda existem no `InteractiveMapa.tsx` regras antigas de **limite de ocupação por posição/paletização** (`positionLimits` e `specialLimits`). Elas não definem o total físico de E2/E3; definem o estado visual de alerta de determinadas posições.

Elas foram preservadas nesta revisão para não alterar uma regra operacional sem confirmação. Se a intenção for que esses limites também sejam configuráveis, isso deve ser tratado como uma etapa separada.

## Mobile

O Mobile recebe duas novas abas administrativas:

- `Base` → Base de Dados
- `Config.` → Configuração de Estoque

Somente Administrador recebe essas abas.

A configuração reutiliza o mesmo `WarehouseLayoutPanel`, portanto não cria uma segunda regra de negócio. O conteúdo pode ter rolagem horizontal para a tabela de configuração.

## Validação

- `npx tsc --noEmit`: passou sem erros nesta revisão.
- `npm run build`: não pôde ser executado neste ambiente Linux porque o `vite` do `node_modules` recebido no ZIP não tinha permissão de execução. No Windows do projeto, deve ser executado novamente.

Não foi criada migration SQL nesta revisão.
