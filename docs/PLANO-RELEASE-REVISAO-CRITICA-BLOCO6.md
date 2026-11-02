# Endereçamento — Preparação para produção | Bloco 6

**Data:** 02/11/2026  
**Escopo:** reconciliação de histórico, dependências de migrations, segurança do corte e preparação de baseline.  
**Estado remoto:** somente leitura durante esta etapa. Nenhum DDL, DML, GRANT, REVOKE, migration, repair ou deploy foi executado.

## 1. Resultado do Bloco 5

O histórico foi recuperado no projeto local e `supabase migration list` confirmou correspondência local/remota:

| Versão | Migration |
|---|---|
| `20261012164134` | `return_stale_slot_conflicts_without_database_errors` |
| `20261012221223` | `prevent_postgrest_rpc_retry` |

A recuperação usou o Session Pooler `aws-1-us-east-2.pooler.supabase.com:5432`, com usuário `postgres.eltxmfgrbobinzchtxme`. O script confirmou leitura remota e escrita apenas em arquivos locais. Não houve alteração no ledger remoto.

A CLI utilizada foi `2.118.0`; não há motivo para atualizá-la durante esta preparação.

## 2. Estado remoto confirmado

Projeto oficial: `eltxmfgrbobinzchtxme` (`endereçamento`), PostgreSQL 17.6.1.

| Componente | Estado atual |
|---|---|
| `permission_catalog`, `role_permissions`, `user_permission_overrides`, `permission_change_audit` | Ausentes (0/4) |
| `has_app_permission(text)` / `has_app_permissions(text[])` | Ausentes |
| `has_app_role(text[])` | Presente |
| `update_slot_metadata_atomic(jsonb,jsonb)` | Ausente |
| RPCs de layout | Presentes |
| Escritores genéricos antigos sem `p_operation_type` | Presentes; `authenticated` EXECUTE |
| Escritores tipados com `p_operation_type` | Ausentes |
| RPC do lote compartilhado | Presente, versão legada |
| `record_stock_conflict_divergences_atomic(text,jsonb)` | Ausente |
| RPC de zeramento físico | Presente |
| RPCs de reconciliação física | Presentes |
| `resolve_stock_divergence_atomic` | Presente, atualmente não `SECURITY DEFINER`; 8 `P0001`, 0 `40001` |

Perfis atuais: Administrador 1, Apoio 9, Produção 1, Visualizador 3. A matriz de produção ainda é baseada em `has_app_role`; a matriz configurável de cinco perfis não está instalada.

### Dados compartilhados que precisam permanecer intactos

| Estrutura | Linhas atuais |
|---|---:|
| `lancamento_drafts` (legado) | 7 |
| `lancamento_draft_legacy_quarantine` | 8 |
| `lancamento_draft_control` | 1 |
| `lancamento_draft_lines` | 0 |
| `lancamento_draft_archive_lines` | 1.030 |
| `lancamento_batch_runs` | 41 |

As verificações somente de leitura anteriores não identificaram divergência entre payloads arquivados e os registros legados correspondentes. Não recriar, copiar, limpar nem remover estas estruturas durante a implantação.

## 3. Descoberta crítica: B8 não pode substituir as funções atuais como está

A migration local `20261030100000_permission_stock_divergence_guards.sql` substitui quatro funções que já existem em produção. A comparação de `pg_proc.prosrc` mostrou que os corpos locais não são idênticos aos corpos remotos:

| Função | Produção (chars) | Migration local (aprox. chars) | Situação |
|---|---:|---:|---|
| `reconcile_physical_address_atomic` | 36.995 | 36.451 | Diferente; preservar lógica atual e revisar diff |
| `reconcile_physical_address_atomic_with_deletes` | 12.918 | 12.932 | Diferente; preservar lógica atual e revisar diff |
| `resolve_stock_divergence_atomic` | 14.012 | 14.066 | Diferente; além disso produção não é SECURITY DEFINER |
| `zero_physical_divergence_address_atomic` | 33.387 | 26.344 | Diferença material; bloqueio de liberação |

A função remota de zeramento contém proteções que não aparecem na versão local, incluindo validações de identidade do histórico, proteção de metadados de auditoria, validação do snapshot final limitado à posição-base e verificações de identidade auxiliar. A versão local contém outras verificações, mas não é substituta equivalente. Não se pode afirmar que o corpo local preserva toda a semântica de produção.

**Ação necessária:** reconstruir a alteração de autorização B8 como um patch sobre os corpos remotos atuais. Manter as proteções operacionais já existentes e adicionar apenas os guards granulares necessários. O resultado precisa ser revisado como diff de corpo completo; não reutilizar `CREATE OR REPLACE` da migration local sem essa reconciliação.

Também foram encontrados textos portugueses corrompidos por mojibake na migration B8 local (`corre├º├úo`, `posi├º├úo`, etc.). Corrigir os textos antes de qualquer liberação, sem alterar códigos/contratos.

## 4. Contradições encontradas nos drafts anteriores

### 4.1 B11.7 está no lado errado do corte

A migration `20261031150000_permission_read_scope_alignment.sql` (B11.5) espera que `stock.details.view` tenha a descrição intermediária:

`Chave legada descontinuada; não controla campos exibidos nem a leitura da Pesquisa.`

A migration `20261031170000_permission_stock_details_description_alignment.sql` (B11.7) transforma essa descrição no texto final. Portanto:

- B11.5 precisa ocorrer antes de B11.7.
- B11.7 não pode ser pré-requisito da Fase C que executa B11.5 internamente.
- Remover B11.7 do preflight da Fase C e executá-la como etapa posterior, depois da B11.5.

### 4.2 A Fase A antiga não completava os pré-requisitos da Fase C

O draft da ponte B7.1/shared atualiza as sete RPCs compartilhadas existentes e cria as duas sobrecargas tipadas sem remover os escritores antigos. Porém, o preflight da Fase C também exige B9, B10, B12 e os helpers de permissão em cinco perfis. A Fase A precisa ser expandida/organizada para incluir:

1. Fundation B1/B2/B5 e B6.1/B6.2A;
2. escritores tipados e ponte das RPCs do lote compartilhado (sem recriar tabelas/dados);
3. B9 — expansão da matriz para Liderança;
4. B10 — RPC de registro de divergências de conflito;
5. B12 — helper `has_app_permissions` para cinco perfis.

B8 deve sair da Fase A e entrar na mesma transação coordenada do corte final, depois que o novo frontend estiver pronto. Assim, os guards das rotinas de correção não mudam antecipadamente enquanto ainda há sessões da versão antiga. B6.2B, B11 e B11.5 também permanecem no corte final.


### 4.3 A ordem por timestamp dos fontes não é a ordem de release

O arquivo B11.5 tem timestamp `20261031150000`, enquanto B12 (cinco perfis) tem `20261101010000`. Porém, a Fase C exige B12 antes do corte e aplica B11.5 dentro do corte. Se copiarmos os 15 arquivos para `supabase/migrations` com os timestamps originais, o Supabase CLI os ordenará por timestamp e B11.5 ficará antes de B12. A release precisa de um **novo conjunto de IDs de migration, em ordem de dependência**, sem alterar os dois históricos recuperados. A alternativa é uma sequência manual com `migration repair` por versão, mas isso também altera o ledger e requer aprovação.

## 5. Sequência de implantação revisada

| Fase | Conteúdo | Condição de avanço |
|---|---|---|
| 0 — baseline e ledger | Capturar dump `public` somente de estrutura; revisar; preparar baseline; não marcar como aplicada até aprovação | Snapshot conferido e plano de recuperação aceito |
| A1 — fundação aditiva | B1, B2, B5, B6.1 e B6.2A, adaptadas apenas se o preflight indicar diferença real | Catálogo 29 chaves/116 linhas e RPCs administrativas presentes |
| A2 — compatibilidade | B7.1 tipada + bridge compartilhada, mantendo as duas assinaturas antigas disponíveis | RPCs novas ativas; funções compartilhadas preservadas; dados antigos intactos |
| A3 — autorização aditiva | B9, B10 e B12; ajustar grants Leadership somente conforme a matriz aprovada | Cinco perfis/145 linhas; `has_app_permissions` disponível |
| B — frontend compatível | Preparar/publicar o novo código com RPC callsites atualizados e flags controladas; Preview isolado de produção | Nova versão disponível e janela de manutenção definida; sessões antigas fechadas |
| C — corte final | Em transação coordenada: aplicar B8 reconstruída sobre funções remotas, revogar EXECUTE das duas sobrecargas antigas, aplicar B6.2B, B11 e B11.5 | DML direto bloqueado sem perda de SELECT; seis policies de SELECT e grants esperados |
| D — acabamento | Aplicar B11.7 após B11.5; confirmar/ativar flags `live` no frontend na mesma janela de encerramento | App novo e banco novo alinhados |

**Importante:** a publicação do novo frontend e a revogação de escritores antigos precisam ser coordenadas em janela de manutenção. O código novo deve chegar com os callsites de escrita já usando as RPCs tipadas/compartilhadas. Não deixar usuários operando com uma combinação em que a interface antiga ainda tenta DML direto e o banco já o revogou. O enforcement `live` precisa ser ativado quando B8/B6.2B/B11/B11.5 estiverem efetivos; as abas e PWAs antigas devem ser encerradas e reabertas. A configuração exata das flags deve ser confirmada nos arquivos Vite/Vercel, sem presumir que `skipWaiting()` recarregue JavaScript já aberto.

## 6. Mudanças de permissão exigem aceite operacional

A matriz v1.2 não é neutra para os usuários existentes. Os nove usuários Apoio e o usuário Produção podem perder funções que hoje eram autorizadas por listas fixas de papel. A matrix seed não concede automaticamente permissões que não foram listadas como permitidas.

Antes de aplicar a matriz configurável, registrar a decisão sobre:
- Produção poder ou não criar lançamentos, transferir, processar lote e resolver divergências;
- Apoio poder ou não corrigir fisicamente e resolver divergências;
- Liderança ter somente `stock.search` como leitura-base inicial (B11.5), com demais permissões negadas até configuração;
- quem será responsável por aprovar exceções individuais.

Não criar overrides automáticos para preservar o comportamento antigo sem aprovação, pois isso esvaziaria a intenção da matriz granular.

## 7. Segurança e preservação de escopo

- `products`: manter os grants de DML e as três policies granulares `products.create`, `products.edit`, `products.delete_deactivate`.
- `occupancy_history`: permanece fora do escopo desta revogação; não alterar Realtime nem políticas nesta release.
- `slots`, `history`, `divergencias`, `warehouse_layout`, `warehouse_layout_positions`: corte direto somente depois de RPCs e frontend compatíveis.
- Posições inativas e IDs auxiliares: não limpar, reescrever ou normalizar em lote.
- Lançamentos compartilhados: não reaplicar `20261024_shared_lancamento_draft.sql`, não copiar quarentena, não recriar tabelas, não apagar os 1.030 arquivos históricos nem os 41 lotes.

## 8. Baseline Supabase: caminho recomendado, ainda não executado

O projeto principal não tinha `supabase/migrations`; as 15 migrations de trabalho estão em `docs/sql/migrations`. A pasta de trabalho não é consumida automaticamente pelo Supabase CLI.

O histórico local/remoto agora está alinhado para as duas migrations antigas. O próximo passo seguro é capturar um dump somente de estrutura de `public` com `supabase db dump --linked --schema public -f <arquivo> --keep-comments` (CLI v2). A documentação oficial descreve `db dump` como exportação via `pg_dump`, sem dados por padrão e sem alterar o schema remoto. `migration list` e `db dump` estão entre os comandos de leitura; `migration repair` altera somente o ledger e não aplica SQL. Ver:

- [Supabase CLI workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase db dump / referência](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [Comandos read-only e target remoto](https://supabase.com/docs/guides/local-development/local-and-hosted-projects)
- [Como o ledger e migration repair funcionam](https://supabase.com/docs/guides/deployment/database-migrations)

A baseline não deve ser criada/registrada até revisar o dump completo. Uma hipótese de baseline é um timestamp anterior a `20261012164134`, seguido pelas duas migrations recuperadas. O dump deve ser comparado à definição da função histórica e aos objetos existentes antes de definir o timestamp e a forma final. O registro da baseline no ledger com `migration repair --status applied` é uma escrita remota e exige aprovação específica; não executar nesta fase.

O dump de schema não inclui dados de Auth/Profiles. Além disso, B1 exige ao menos um perfil administrador no preflight; um `db reset` limpo precisará de bootstrap local de Auth/perfil antes da B1 ou de ajuste de desenho de fixture. Não afirmar que o baseline torna, por si só, a reconstrução local completa.

## 9. Gates de publicação ainda abertos

1. Dump de schema `public` capturado, revisado e armazenado em local seguro.
2. Estratégia de baseline aprovada, incluindo registro remoto separado.
3. B8 refeito sobre a versão atual das funções de produção e com textos UTF-8 corretos.
4. Fase A expandida para B9/B10/B12; B11.7 movido para depois de B11.5.
5. Aceite da matriz de permissões por papel (especialmente Produção e Apoio).
6. Ambiente Preview Vercel isolado do Supabase oficial; hoje o Preview está apontando para o projeto de produção.
7. Estratégia PWA para encerrar abas antigas antes da revogação de DML.
8. Snapshot exato de funções/policies/grants/ACLs guardado antes do corte.
9. Aprovação separada para migrations de produção e para o deploy Vercel.

## 10. Estado desta etapa

- Histórico das duas migrations antigas: alinhado e confirmado.
- Dump baseline: script preparado, ainda não executado.
- Produção: sem alterações nesta etapa.
- GitHub/Vercel: sem alterações nesta etapa.
- Testes: não repetidos; a evidência de aprovação local anterior permanece encerrada.
- Liberação: **BLOQUEADA** até resolver B8, sequência de migrations, matriz operacional e Preview isolado.
