# Auditoria e correções — Endereçamento Porto Brasil

## Escopo desta entrega

Esta entrega preserva os dados do Supabase e concentra-se em correções de comportamento e integridade no frontend.

### Correções aplicadas

1. **SKUs sem movimentação**
   - O Dashboard passou a calcular cada período a partir do conjunto completo de SKUs ativos, e não a partir da lista de 7 dias.
   - 7, 15, 30 e 60+ agora são filtros independentes.
   - `60+` não usa mais o sentinela visual `999`.
   - Datas ISO e datas antigas em `DD/MM/YYYY` são reconhecidas.
   - Movimentações futuras não são consideradas como movimentação recente.
   - O histórico do Dashboard permanece limitado a uma janela de 60 dias para evitar carregar todo o histórico no navegador.

2. **Última movimentação**
   - A consulta usada para identificar a última movimentação agora ignora registros com data futura.
   - Isso evita que um lançamento futuro seja apresentado como a última movimentação operacional.

3. **Endereços físicos E2/E3**
   - O cadastro atual de `slots` é tratado como fonte da existência física da posição.
   - Lançamentos E2/E3 em posição inexistente são bloqueados.
   - O processador não cria silenciosamente novas posições E2/E3.
   - Estoque 1 mantém o comportamento próprio de corredor/SKU e pode criar uma nova linha de SKU dentro de um corredor válido.

4. **Lançamento unitário**
   - Passou a reutilizar o mesmo processador sequencial usado pelo lote.
   - Entrada em posição ocupada por outro SKU gera divergência, em vez de permitir sobrescrita direta.
   - Saída divergente ou com saldo insuficiente segue a mesma regra do lote.
   - Isso reduz a duplicação de regra entre lançamento unitário e lote.

5. **Divergências**
   - A correção não cria uma posição física inexistente.
   - Corrigir uma divergência altera somente a divergência selecionada; divergências distintas da mesma posição não são marcadas automaticamente como corrigidas.
   - A persistência é aguardada e erros são informados ao usuário.

6. **Permissões de tela**
   - Perfis são normalizados para comparação interna (`administrador`, `lideranca`, `apoio`, `producao`, `visualizador`).
   - A matriz operacional informada foi aplicada no frontend.
   - Visualizador pode consultar as telas operacionais, mas não executar lançamentos/correções.
   - Gêmeo Digital e recursos administrativos avançados permanecem restritos ao Administrador.
   - O registro manual de snapshot de ocupação não aparece para o Visualizador.
   - Cadastro de usuários possui verificações adicionais no handler.

7. **Limpeza de ações locais perigosas**
   - Foram removidos da interface os comandos de limpar/excluir histórico/endereço que alteravam somente o estado/localStorage e não o Supabase.
   - Isso evita que a interface informe uma exclusão definitiva quando o banco continuaria intacto.
   - A exclusão/reset administrativo deve voltar somente depois de existir uma operação backend transacional e auditada.

8. **TypeScript e manutenção**
   - Corrigido `ImportMeta.env` com declaração local.
   - Corrigida duplicação de `onSelectSlot`.
   - Corrigido import ausente de `WarehouseSlot`.
   - Ajustados tipos assíncronos dos callbacks de divergência/usuários/endereço de corredor.
   - Removido log de URL do Supabase no frontend.
   - Produtos e usuários passaram a usar `select` explícito em vez de carregar colunas desnecessárias.

## O que deliberadamente NÃO foi alterado

- Dados existentes do Supabase.
- Posições bloqueadas/excluídas.
- Capacidades físicas atuais de E1/E2/E3.
- Modelo de dados do Supabase.
- Migração do login atual para Supabase Auth.
- RLS/policies.
- Migração para Supabase Auth.
- Transações/RPC no banco.
- Módulo de inventário.
- Projeção de capacidade.
- Aplicativo mobile.
- Gêmeo Digital 3D.

Esses itens dependem de uma segunda etapa de arquitetura/validação. Em especial, ativar RLS ou migrar o login sem mapear a autenticação atual poderia interromper o sistema em produção interna.

## Estado de segurança

**CONFIRMADO:** o login atual ainda utiliza a tabela `users` e compara senha no cliente. A tabela possui credenciais legíveis no export fornecido.

**CORRIGIDO nesta entrega:** a senha administrativa não fica mais hardcoded no frontend e o cadastro de usuários não é persistido em `localStorage`. O login legado continua temporariamente dependente da leitura da tabela `users`, portanto a exposição de credenciais pelo Data API ainda precisa ser eliminada com a migração para Supabase Auth.

**CONFIRMADO:** as tabelas operacionais atuais não estão protegidas por uma estratégia de RLS adequada ao modelo de usuários do aplicativo.

**NÃO CONCLUÍDO nesta entrega:** migração para Supabase Auth e RLS. Isso precisa ser feito em uma etapa própria, com plano de migração e teste para não bloquear os usuários existentes.

## Validação executada

- Análise estática dos fluxos e arquivos.
- Validação sintática de todos os arquivos `.ts`/`.tsx`.
- Typecheck isolado do processador de lançamentos: aprovado.
- Teste executável do processador de lançamentos:
  - saída parcial em posição existente;
  - divergência por SKU diferente;
  - rejeição de posição física inexistente;
  - posição E2 com módulo cadastrado com zero à esquerda.
- Typecheck completo com `tsc` usando stubs temporários somente para dependências de tipos ausentes no ambiente de auditoria: **0 erros de TypeScript no código do projeto**.
- Build Vite não pôde ser concluído neste ambiente porque o `node_modules` enviado foi instalado em Windows e contém binários nativos incompatíveis com Linux. O projeto entregue não inclui `node_modules`; execute `npm ci`/`npm install` no ambiente de destino.

## Próxima etapa

A próxima etapa técnica deve ser:

1. extrair o schema real do Supabase;
2. mapear `auth.users` ↔ perfil operacional;
3. desenhar RLS por perfil;
4. criar RPCs transacionais para lançamento e reconciliação;
5. migrar o login sem perder usuários;
6. criar testes de concorrência/falha parcial;
7. depois implementar projeção de capacidade;
8. então refinar o Gêmeo Digital conforme a planta;
9. posteriormente criar a interface mobile sobre a mesma camada de negócio.
