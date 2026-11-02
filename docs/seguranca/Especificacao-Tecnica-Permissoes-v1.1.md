# Especificação técnica — Permissões configuráveis do Endereçamento

**Versão:** 1.1  
**Estado:** desenho técnico para implementação local; **não implementado**.  
**Referência de negócio:** `docs/seguranca/Matriz-Permissoes-v1.2.md` e `.csv`.  
**Restrições:** sem alteração de produção, sem DDL/DML de produção, sem publicação e sem dependência paga ou serviço de atualização em tempo real.

## 1. Objetivo e limites

Implementar permissões configuráveis por perfil e exceções por usuário, de modo que o mesmo direito de negócio seja respeitado no desktop, mobile, Postgres/RLS, RPCs e Edge Functions. A permissão de interface nunca será a única barreira de segurança.

A primeira versão mantém quatro perfis ativos para novas atribuições: `administrador`, `apoio`, `producao`, `visualizador`. `lideranca` permanece como valor legado temporário, não pode ser atribuído a novos usuários e não recebe permissões implícitas. A migração deve abortar no preflight se encontrar usuário `lideranca`; não se converte nem remove usuários automaticamente.

Fora do escopo v1: criar perfis personalizados, exceções de permissão administrativa para não administradores, alterações de negócio em fluxos de estoque ou refatoração ampla do `App.tsx`.

## 2. Achados concretos do snapshot do código

A análise do pacote do projeto identificou estes pontos a corrigir durante a implementação:

1. `src/constants/permissions.ts` contém uma matriz fixa `PERMISSIONS` e `canExecuteOperations`, mas não cobre todas as chaves de negócio da matriz nova.
2. `src/App.tsx` implementa `canAccessTab`, `hasAccess` e `mobileAllowedTabs` separadamente. Essas regras divergem por dispositivo e a regra `consulta` de `hasAccess` retorna acesso sem uma permissão específica.
3. `src/components/mobile/MobileShell.tsx` recebe `canExecute` como booleano genérico, que não distingue lançamento, transferência, processamento de lote, correção física e resolução de divergência.
4. `roleLabel` retorna o rótulo `Visualizador` no `default`, mesmo quando o perfil não é reconhecido. Isso é enganoso para diagnóstico; perfil inválido deve ser explicitamente inválido e nunca deve receber autorização por fallback.
5. `src/components/AdminUsersManagement.tsx` possui descrições e seleção de cinco perfis fixos; a função `supabase/functions/admin-users/index.ts` valida uma lista fixa de roles e administra usuários via Edge Function.
6. O frontend lê `profiles` para carregar o contexto de sessão em `loadCurrentAuthUser` e novamente após login. A implementação deve evitar acrescentar uma chamada de permissões separada se for possível combinar o contexto em uma RPC de leitura.
7. As políticas RLS/RPC existentes usam verificações fixas de perfil. Somente substituir os guards do frontend não protege chamadas diretas.

Esses achados são baseados no snapshot recebido. Antes de implementar, comparar os arquivos atuais de `C:\Projetos\endere-amento` e as definições de produção por consultas read-only, porque o snapshot pode ter divergido desde que foi gerado.

## 3. Regra de autorização efetiva

### 3.1 Precedência

Para uma chave existente e delegável:

1. Se o usuário for `administrador`, o acesso é concedido para as chaves conhecidas da aplicação; o Administrador não pode retirar de si mesmo as capacidades de contingência.
2. Para qualquer outro perfil, se houver override explícito `allow` ou `deny`, ele prevalece sobre a matriz-base.
3. Sem override, vale o valor explícito de `role_permissions` para o perfil.
4. Perfil desconhecido, chave desconhecida, ausência de configuração-base, falha de consulta ou matriz inconsistente resulta em negar ação protegida. Não usar fallback para Visualizador nem acesso total.
5. `lideranca` sem linha explícita de migração/aprovação não recebe grant. Preflight aborta se houver usuários ativos desse perfil.

### 3.2 Permissões administrativas não delegáveis

Estas chaves não podem ser liberadas por override individual e continuam exclusivas de Administrador: `users.view`, `users.manage`, `permissions.manage`, `configuration.manage`, `database.manage`, `products.import_bulk`, `products.delete_deactivate`, `warehouse.layout.manage`.

`products.create` e `products.edit` são delegáveis separadamente. `map.view`, `map.metadata.edit`, `stock.physical_correction` e `warehouse.layout.manage` continuam sendo direitos distintos. Ver o mapa não autoriza editar metadados, corrigir saldo ou alterar a estrutura física.

**Correção documental da v1.1:** `dashboard.view` permite exceção individual. A matriz CSV anterior indicava `Não`, em conflito com a instrução expressa de que o Administrador deve poder conceder acesso individual a uma aba/ação. A implementação deve usar a v1.1 corrigida.

### 3.3 Exportação

`reports.export` é comum a formatos PDF/Excel/CSV, mas não amplia os dados disponíveis. A operação de exportação deve exigir:

- `reports.export = true`; e
- permissão de leitura do módulo/escopo que será exportado; e
- os filtros/linhas exportados devem ser exatamente os dados autorizados àquela pessoa.

Exemplo: Produção pode exportar os resultados autorizados da pesquisa, mas não pode exportar histórico ou base de produtos sem as respectivas permissões de leitura.

### 3.4 Leitura versus escrita

- `map.view` controla acesso à experiência visual do mapa; `stock.details.view` controla os detalhes de estoque retornados. Se uma pessoa tiver acesso ao mapa sem permissão de detalhe, não se deve liberar uma consulta irrestrita de `slots` só para preencher o mapa.
- `warehouse.layout.view` controla consulta da estrutura física; `warehouse.layout.manage` controla suas alterações.
- `products.view`/`database.view` autorizam leitura das telas correspondentes; `products.create`, `products.edit`, `products.import_bulk` e `products.delete_deactivate` são direitos separados.
- `stock.launch.create`, `stock.transfer.create`, `stock.batch.process`, `stock.physical_correction` e `divergences.resolve` são ações diferentes. Não usar `canExecuteOperations` como autorização única.
- O escopo exato das colunas entregues pela pesquisa de Produção precisa ser conferido contra o schema real de `products`/`slots`. Se a tabela contém campos que Produção não deve consultar, usar RPC/view com projeção limitada em vez de conceder `SELECT` integral.

## 4. Arquitetura de dados proposta

As tabelas abaixo são um desenho, não SQL executável.

### 4.1 `permission_catalog`

Uma linha por chave estável: `permission_key` (PK), rótulo, descrição, grupo, nível de risco, `admin_only`, `user_override_allowed`, `active`, `sort_order`.

A lista de chaves deve corresponder à matriz v1.2, com 29 chaves. A chave `stock.launch.view` separa a permissão de abrir/consultar a tela de lançamentos da chave `stock.launch.create`, que autoriza a gravação. A interface administrativa recebe o catálogo por uma única resposta agregada; não busca cada chave individualmente.

### 4.2 `role_permissions`

Uma linha explícita para cada par perfil ativo/chave, incluindo `allowed = true/false`, `updated_at` e `updated_by`. Chave única `(role, permission_key)`. Não inferir permissão a partir da ausência da linha; ausência é negada e sinaliza configuração incompleta.

A primeira versão deve gravar todas as combinações: 4 perfis ativos × 29 chaves = 116 linhas. O seed precisa validar exatamente esse total e garantir que todas as chaves esperadas estejam presentes uma única vez.

### 4.3 `user_permission_overrides`

Uma linha por `(user_id, permission_key)`; decisão limitada a `allow`/`deny`; ausência da linha significa herdar. Incluir `updated_at` e `updated_by`. Não permitir override para chaves `admin_only` ou qualquer chave cujo catálogo marque `user_override_allowed = false`.

Ao trocar perfil de uma pessoa, remover os overrides comuns desse usuário na mesma transação ou exigir reaplicação confirmada pelo Administrador; recomendação v1: resetar os overrides para herdar, registrar isso na auditoria e informar quais acessos serão alterados.

### 4.4 `permission_change_audit`

Um evento consolidado por salvamento administrativo: autor, horário, alvo (perfil ou usuário), chaves alteradas, valores anteriores e posteriores. Não criar evento por checkbox, renderização ou leitura. Não registrar senha, token, chave de API ou segredo.

### 4.5 Privilégios das tabelas

Não conceder escrita direta dessas tabelas ao cliente `authenticated` ou `anon`. A leitura/escrita da configuração será feita por RPCs autorizadas no servidor. Verificar e explicitar ACLs; não depender de grants históricos implícitos.

## 5. RPCs e limites de responsabilidade

### 5.1 `get_my_app_context()`

Objetivo: substituir, quando viável, a leitura de `profiles` usada no carregamento inicial/renovação da sessão e retornar em uma chamada `user_id`, `username`, `name`, `role` e mapa efetivo de permissões. A função deriva o usuário exclusivamente de `auth.uid()`; não aceita um user ID arbitrário do cliente. Deve falhar com erro seguro se a conta/perfil ou a matriz estiverem inválidos.

Isso evita uma chamada adicional de API para cada sessão: uma leitura de contexto já necessária passa a incluir permissões. Não se deve fazer uma RPC por chave.

### 5.2 `get_permission_admin_matrix()`

Retorna catálogo, permissões-base e overrides necessários à tela de administração em uma única chamada. Somente Administrador pode executá-la. A interface trabalha com rascunho local e envia as alterações em lote.

### 5.3 `save_permission_configuration(...)`

RPC administrativa única para salvar alterações de perfil e/ou usuário. Requisitos:

- Verificar `auth.uid()` e perfil Administrador dentro da própria função.
- Validar todas as chaves, perfis e valores antes de alterar qualquer linha.
- Rejeitar chaves desconhecidas, duplicadas, `admin_only` em override ou valores fora do catálogo.
- Salvar permissões e evento de auditoria na mesma transação; ou grava tudo, ou nada.
- Proteger o último Administrador e impedir que a UI altere as próprias capacidades administrativas críticas.
- Receber o conjunto final de diferenças em lote, não enviar uma chamada por toggle. Opcionalmente aceitar `request_id` único para evitar auditoria duplicada por duplo clique/repetição de uma requisição.
- Retornar resultado resumido e chave do evento de auditoria, nunca segredos.

### 5.4 `has_app_permission(permission_key)`

Helper interno para RLS/RPCs, derivando sempre o ator por `auth.uid()` e sem aceitar `user_id` fornecido pelo cliente. Deve retornar `false` para chave desconhecida, perfil inválido ou configuração incompleta. Preferir `STABLE`, schema qualificado, `SECURITY DEFINER` com `SET search_path = ''`, objetos qualificados e ACL explícita. A propriedade `SECURITY DEFINER` deve ser revisada por segurança; não basta adicioná-la automaticamente.

Nas políticas RLS que avaliam várias linhas, usar a forma `(select public.has_app_permission('permission.key'))` quando adequada para evitar recalcular a verificação a cada linha. Isso deve ser comprovado com `EXPLAIN` e teste em banco local; não adicionar índices ou triggers sem evidência.

## 6. Integração com os fluxos existentes

### 6.1 Frontend

- Substituir permissões fixas de navegação por `can(permissionKey)` derivado do contexto da sessão.
- Desktop e `MobileShell` usam a mesma matriz efetiva; o layout pode variar, o direito de negócio não.
- Trocar o booleano genérico `canExecute` por verificações por ação; a UI não deve decidir permissões apenas por `role`.
- Exibir a rota/tela somente depois de o contexto de permissões carregar; se falhar, bloquear ações protegidas e mostrar erro controlado sem retry em loop.
- Ao logout/troca de usuário, limpar imediatamente permissões, dados protegidos e tela ativa antes de carregar a nova sessão.
- Após salvar mudanças, atualizar a matriz do Administrador. Outros usuários recebem mudanças no próximo login/renovação ou atualização manual; sem Realtime, polling ou sessão forçada. O backend usa a configuração vigente em cada operação protegida.
- `roleLabel` não deve converter perfil desconhecido em `Visualizador`; mostrar estado inválido e negar ações.

### 6.2 RLS e leituras diretas

Fazer inventário tabela por tabela e política por política: operação, política atual, chave de permissão, colunas/campos entregues e consumidor na interface. Em Postgres, políticas permissivas podem combinar-se por `OR`; adicionar uma política mais restritiva sem remover/substituir a política antiga pode deixar o acesso antigo intacto. O plano de migração deve substituir explicitamente cada política relevante e testar que não sobrou caminho permissivo antigo.

Quando uma tabela contém mais campos do que um perfil deve ver, RLS por linha não é suficiente para restringir colunas. Usar view/RPC com projeção mínima ou privilégios de coluna cuidadosamente auditados; não liberar `SELECT` irrestrito para tornar a pesquisa funcionar.

### 6.3 RPCs de estoque

Inventariar todas as RPCs por classe de negócio e aplicar a permissão correspondente dentro de cada função antes de alterar dados. Pelo menos revisar:

- lançamento normal/atômico;
- transferência;
- processamento de lote e rascunho compartilhado;
- correção física pelo mapa;
- resolução/zeragem de divergências;
- edição de metadados;
- alteração da estrutura física;
- manutenção/importação/exclusão de SKU.

Não substituir todos os `has_app_role(...)` por uma chave única sem avaliar a semântica de cada função. Preservar atomicidade, locks, validações de snapshot, IDs canônicos, histórico, divergências e idempotência já existentes. As mutações de estoque continuam pelas RPCs transacionais atuais; a configuração de permissões não cria escrita direta para contornar controles.

### 6.4 Edge Functions

- `admin-users` permanece para ações de administração de usuários que precisam dela; validar o chamador no servidor. Na criação de usuários, permitir apenas os quatro perfis ativos; manter `lideranca` como legado não atribuível.
- `consultor-ai` verifica `consultor.use` dentro da invocação já existente antes de acessar dados ou gerar resposta. Não criar uma Edge Function separada de autorização nem uma invocação extra por clique.
- Para operações que já passam por RLS/RPC, não criar Edge Function adicional. A checagem deve ocorrer na mesma operação do backend sempre que possível.
- Falha de autorização deve retornar erro controlado, sem retry automático infinito e sem log por renderização/tentativa repetida.

## 7. Carga, latência e plano Free

Premissas da arquitetura: uma chamada agregada de contexto por login/renovação (preferencialmente substituindo a leitura atual de `profiles`); uma chamada administrativa para carregar a matriz ao abrir a página; uma RPC por salvamento em lote; zero polling; zero canal Realtime novo; zero invocação de Edge Function adicional por operação rotineira.

Estimativa de leitura de contexto usando 22 dias úteis:

| Usuários | Sessões por usuário/dia | Leituras de contexto/mês |
|---:|---:|---:|
| 10 | 1 | 220 |
| 10 | 2 | 440 |
| 30 | 1 | 660 |
| 30 | 2 | 1.320 |

A tabela é estimativa de novas leituras de contexto, não de todo o uso Supabase. A implementação deve medir em ambiente isolado: requests por login, p50/p95 do carregamento, tempo das funções auxiliares de RLS, volume de negações e comportamento com 10/30 sessões concorrentes. Não instalar polling, Realtime, bibliotecas/serviços pagos ou retry genérico. A checagem do Consultor ocorre dentro da Edge Function existente: não adiciona invocação Edge, embora possa adicionar uma consulta SQL por uso do Consultor; medir essa latência.

Não gravar um log por tentativa negada repetida. Auditoria completa é obrigatória para alterações administrativas de permissões; erros repetidos de autorização devem ter log limitado/deduplicado sem perder o evento original da ação administrativa.

## 8. Sequência de implementação e implantação

### Fase A — Preflight somente leitura

1. Reconfirmar snapshot do código local e rodar auditoria read-only atualizada de políticas, grants, funções e Edge Functions.
2. Exportar definições exatas de todas as políticas/functions que serão alteradas e guardar versão/checksum.
3. Confirmar que não existe usuário `lideranca`; caso exista, abortar e discutir cada conta.
4. Inventariar consultas de `profiles`, `products`, `slots`, `history`, `divergencias`, `occupancy_history`, `warehouse_layout` e tabelas usadas pelo Dashboard/pesquisa; identificar campos sensíveis.
5. Criar banco local isolado a partir de schema/contratos necessários; não usar produção como ambiente de teste.

### Fase B — Banco de teste local

1. Aplicar as tabelas/catálogo e seed em banco local.
2. Verificar 29 chaves únicas, 116 combinações de matriz para os quatro perfis, sem duplicatas e sem permissões faltantes.
3. Aplicar helpers, RPCs e RLS localmente; verificar que nenhuma política permissiva antiga permanece onde deveria ter sido substituída.
4. Rodar testes positivos/negativos de API/RPC com JWT de usuários de teste por perfil; nunca usar chave `service_role` no frontend.
5. Medir `EXPLAIN`, p50/p95 e número de requests com 10 e 30 usuários simulados.

### Fase C — Aplicação local

1. Centralizar catálogo de chaves/labels e helpers no frontend.
2. Substituir guards de desktop/mobile e ações pelo contexto efetivo.
3. Construir a página de administração: matriz por perfil, exceções por usuário, visão efetiva, rascunho, salvar/desfazer e resumo de impacto.
4. Adicionar migração de usuário/admin para `lideranca` não atribuível sem excluir o valor legado.
5. Rodar todos os testes de permissão e regressões de estoque.

### Fase D — Preparação do pacote futuro

1. Versionar a migração de avanço, seed, verificação e rollback correspondente; não executar no banco de produção nesta fase.
2. O rollback deve restaurar exatamente as definições anteriores de RLS/RPC/Edge Function, desativar o novo caminho de autorização e manter as tabelas novas/registro de auditoria preservados inicialmente. A remoção física das tabelas novas só ocorre em uma etapa posterior, após conferência, nunca automaticamente no primeiro rollback.
3. Testar também o par rollback de banco + versão anterior de frontend. Um rollback somente do código não basta se as políticas novas estiverem ativas.
4. Publicação só com autorização expressa e com janela, verificação pós-migração e condição objetiva de abortar.

## 9. Contrato de testes — obrigatório antes de qualquer deploy

### 9.1 Matriz e precedência

- Todas as 29 chaves estão no catálogo e nos tipos do frontend sem duplicatas.
- Todas as 116 combinações de perfil/chave existem para os quatro perfis ativos.
- Cada acesso-base permitido e negado coincide com `docs/seguranca/Matriz-Permissoes-v1.2.csv`.
- Override `Herdar` usa a base; `allow` concede chave delegável; `deny` remove chave delegável.
- Override não concede chaves administrativas exclusivas.
- `dashboard.view` aceita exceção individual; confirmar porque a versão anterior da CSV tinha a célula inconsistente.
- Perfil desconhecido, chave desconhecida, base ausente e falha de leitura negam ações sensíveis.
- `lideranca` não pode ser atribuída a novos usuários; o preflight interrompe se encontrar usuários legados.
- Trocar perfil remove/resetta overrides conforme a regra v1 e audita a mudança.

### 9.2 Autorização de UI e backend

Para cada chave relevante, testar positivo e negativo: aba/botão, chamada direta REST/RLS, chamada RPC, Edge Function quando usada e ausência de mutação em caso de negação. Os cenários não podem parar só na verificação do frontend.

Testes críticos obrigatórios:

- Apoio sem override não exporta, não corrige saldo pelo mapa, não edita metadados do mapa e não altera a estrutura física.
- Apoio com override de uma ação consegue somente essa ação, sem ganhar permissões adjacentes.
- Produção pesquisa e exporta resultado de pesquisa, mas não acessa histórico/base detalhada nem executa operação de estoque.
- Visualizador consulta áreas previstas, mapa/estrutura e consultor, mas toda mutação é negada; configuração exibida em leitura não revela segredos.
- `reports.export` sozinho não permite ler/exportar uma tela que a pessoa não pode consultar.
- `products.create` não implica `products.edit`, importação em lote ou exclusão.
- `map.view` não implica `map.metadata.edit`, `stock.physical_correction` ou `warehouse.layout.manage`.
- Usuário comum tenta alterar matriz/override diretamente por REST e via RPC: negado.
- Último Administrador não perde suas permissões administrativas nem pode ser excluído/rebaixado sem mecanismo de contingência aprovado.

### 9.3 Regressão e operação

- Lançamento normal, transferência, lote, correção física, resolução de divergência, leitura de histórico, alterações de layout e cadastros continuam com suas transações, histórico e idempotência.
- Desktop e mobile aplicam a mesma regra de negócio.
- Troca de usuário/logout limpa o contexto e não mostra dados protegidos da sessão anterior.
- Falha de rede/permissões não dispara retry em loop; logs e consultas permanecem limitados.
- `npm run lint`, todos os testes existentes (`cloud_stock_regressions`, `zeroPhysicalAddressPlan`, `sharedLancamentoDraft`), os novos testes de permissões e `npm run build` passam no Windows do projeto.

## 10. Testes feitos nesta análise interna

- Os três conjuntos de testes existentes no snapshot foram executados com o loader TypeScript portátil: **55 passaram, 0 falharam**.
- A tentativa de `npm run lint` no snapshot Linux não foi conclusiva: o diretório extraído não continha dependências de aplicação como `react`, `jspdf`, `vite` e respectivos tipos. Não foi feita instalação de dependências nem acesso à internet; o lint deve ser validado no Windows do projeto quando houver implementação.
- A matriz v1 foi verificada e surgiu uma inconsistência: `dashboard.view` dizia não permitir override, apesar da instrução do responsável de que o Administrador pode liberar uma aba para um usuário específico. A revisão v1.1 corrigiu essa célula. A revisão v1.2 adicionou `stock.launch.view`, para permitir que Visualizador veja a tela de lançamento sem poder gravar. A implementação deve manter `stock.launch.view` separada de `stock.launch.create`.
- Os testes existentes exercitam integridade de estoque, não a futura autorização RLS/RPC. Não afirmar segurança de backend até que os testes de integração com JWT/roles sejam executados em banco local/teste.

## 11. Critérios de saída

A implementação não está pronta até todos estes pontos serem verdadeiros:

- [ ] O catálogo e matriz v1.2 estão refletidos em código e banco, sem drift.
- [ ] Todas as políticas RLS permissivas antigas foram substituídas/revisadas e não restam caminhos alternativos de escrita/leitura.
- [ ] Todas as RPCs e Edge Functions críticas verificam a chave correta no backend.
- [ ] Todos os testes positivos/negativos e regressões passam no Windows do projeto.
- [ ] Desempenho e consumo foram medidos em ambiente isolado; não há polling/Realtime novo nem Edge Function por operação normal.
- [ ] Snapshot e rollback SQL foram revistos e testados; rollback de banco e frontend são compatíveis.
- [ ] Mudanças de acesso por perfil e usuário foram comparadas com a matriz e aprovadas pelo responsável.
- [ ] Produção permanece intacta até autorização explícita.

**Este documento não autoriza qualquer alteração na produção.** O catálogo/resolvedor local é apenas a primeira camada isolada; sua integração com sessão, RLS, RPCs e Edge Functions continua pendente de implementação e testes antes de qualquer futura publicação.
