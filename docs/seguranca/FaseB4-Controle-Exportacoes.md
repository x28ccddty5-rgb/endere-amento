> **Atualização em 31/10/2026 — regra vigente:** este documento registra a fase histórica de implementação. A regra final é `reports.export` + `stock.search` para a Pesquisa; a projeção Excel/PDF é fixa com 12 campos operacionais, nunca inclui `slots.id`, e não varia por perfil. `stock.details.view` não controla mais os campos exportados. Consulte a seção 11 da matriz v1.2 para a regra de leitura, filtros e Realtime.

# Fase B4 — Controle de exportações pela matriz de permissões

**Status:** integração local preparada; ainda não publicada.  
**Escopo desta fatia:** aplicar `reports.export` às exportações de relatórios do frontend quando o modo de enforcement estiver explicitamente ativo contra o Supabase local de teste.

## Comportamento

- O modo de enforcement fica desligado por padrão.
- Em Vite DEV, o modo `live` só é aceito quando `VITE_SUPABASE_URL` aponta para localhost/127.0.0.1/::1.
- Quando ativo, o app carrega `get_my_app_context()` após a autenticação e exige identidade compatível, matriz completa, 29 chaves booleanas conhecidas e nenhuma permissão concedida ao perfil legado `lideranca`.
- A interface esconde as ações de exportação de relatório quando `reports.export` não está permitido ou o contexto não foi validado.
- Imediatamente antes de criar o arquivo/imprimir, o app chama `has_app_permission('reports.export')`. Falha, resposta inválida ou negação bloqueia a ação.
- O sandbox de permissões passa a gerar `VITE_PERMISSION_ENFORCEMENT_MODE=live` no `.env.permission-test.local`. Não se deve executar novamente `Start-PermissionSandbox.ps1` só para alterar essa variável, pois o script faz reset do banco do sandbox.

## Ações abrangidas

- Endereçamento: exportação XLSX e PDF.
- Histórico: exportação CSV.
- Divergências: exportação CSV, PDF e impressão.
- Dashboard: CSV de SKUs parados.
- Análise de SKUs: CSV de ranking.
- Consultor: PDF executivo.
- Plano de consolidação: PDF.

O XLSX de layout de importação permanece disponível como modelo fixo (não é exportação de dados consultados). Essa decisão deve ser reavaliada se o arquivo passar a conter dados operacionais reais.

## Limite de segurança conhecido

Esta fase controla as ações normais de exportação dentro da aplicação. Não transforma `reports.export` em barreira contra extração manual de dados já disponibilizados ao navegador. Enquanto consultas diretas/RLS permitirem a leitura de linhas, um usuário ainda poderá tentar copiar dados por DevTools/API. Antes da implantação definitiva, revisar o escopo de leitura/RLS e decidir se algum relatório sensível exige endpoint/RPC de exportação server-side. Não afirmar que essa fase sozinha impede exfiltração por API.

## Validações internas executadas

- `npm run lint`: aprovado.
- Testes focados `app-permission-export-gate.test.mjs`: 6/6 aprovados.
- Testes combinados de catálogo, resolvedor, painel administrativo, contrato SQL, B1/B2 e sandbox: 71/71 aprovados.
- Build completo não foi validado neste ambiente Linux porque `node_modules` contém o pacote nativo de Rollup para Windows e falta `@rollup/rollup-linux-x64-gnu`. Executar `npm run build` no Windows do projeto.

## Próxima validação local do app

1. Atualizar apenas o `.env.permission-test.local` para incluir `VITE_PERMISSION_ENFORCEMENT_MODE=live`, verificando antes que `VITE_SUPABASE_URL` é `http://127.0.0.1:55321`.
2. Reiniciar apenas o servidor Vite, não o sandbox; não executar novamente o script de inicialização (ele reseta o sandbox).
3. Entrar no app principal `/` como `rafael-permissoes@local.test` (Apoio; `reports.export=false`, sem override): exportações de relatório devem ficar ocultas e os handlers devem bloquear.
4. Entrar como `visualizador-permissoes@local.test` (Visualizador; exportação permitida): a ação deve aparecer, e a tentativa chama `has_app_permission` antes de exportar. Como o sandbox não contém o estoque do projeto, exportações com dados vazios podem mostrar aviso de nenhum registro; isso não é falha de permissão.
5. Confirmar que o comportamento normal da aplicação permanece inalterado quando o modo de enforcement está desligado.

## Fora do escopo desta fase

- Não altera permissões de navegação de cada módulo.
- Não substitui RLS/RPCs de operações de estoque.
- Não muda políticas de leitura das tabelas.
- Não publica Edge Functions nem altera a produção.

## Atualização B5 — escopo por módulo

A partir da Fase B5, a checagem não deve considerar apenas `reports.export`. Cada exportação também exige a permissão de leitura correspondente ao seu módulo. A implementação chama `public.has_app_permissions(text[])`, em uma única ida ao banco, para validar a permissão global e todas as chaves de escopo. A migration aditiva correspondente é `20261028050000_permission_scoped_check.sql` e tem rollback próprio.

Mapeamento atual: Endereçamento → `stock.search`; Histórico → `history.view`; Divergências → `divergences.view`; CSV detalhado do Dashboard → `dashboard.view` + `stock.details.view`; PDF executivo do Consultor → `consultor.use`; plano de consolidação → `products.view` + `stock.details.view`. O XLSX de layout continua sendo um modelo fixo de importação, não um relatório de dados operacionais.

Isso ainda não substitui a auditoria de leitura/RLS: dados que já chegaram ao navegador precisam ser limitados no backend pelo escopo de leitura apropriado.


## Fase B5 — escopo de exportação e projeção de pesquisa

A checagem global `reports.export` deve ser combinada com a permissão da origem. Nos relatórios do Endereçamento, `stock.search` autoriza exportação dos campos mínimos de pesquisa; `stock.details.view` é obrigatório para incluir saldo, chacote, movimentos, responsável, restrição e observação. A RPC `has_app_permissions(text[])` valida todas as chaves em uma única chamada. Isso não substitui RLS nem protege dados já expostos por consultas diretas, que seguem como auditoria separada.
