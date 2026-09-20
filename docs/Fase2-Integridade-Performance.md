# Fase 2 — ajustes seguros de integridade e performance

## Escopo executado

### Reconciliação de divergência
A regra operacional anterior foi preservada: ao corrigir fisicamente um endereço, todas as divergências **abertas** daquele mesmo endereço são encerradas juntas. Isso evita retrabalho para o responsável.

Registros já `Corrigida` não são alterados.

### Dashboard
Foram reduzidas varreduras e ordenações repetidas:
- resumo de slots calculado uma vez por alteração de `slots`;
- quantidades e descrições agrupadas por SKU em `Map`;
- produtos indexados por referência;
- última movimentação indexada por SKU;
- resumo da última sincronização calculado uma vez por alteração do histórico;
- datas futuras continuam excluídas do cálculo de última movimentação.

A regra visual e os números de capacidade existentes não foram redesenhados nesta fase.

## Fase 2 de segurança (Auth/RLS)

A migração definitiva para Supabase Auth + RLS foi deliberadamente **não aplicada** nesta fase porque o projeto ainda usa a tabela `users` como autenticação legada e o banco exportado não contém uma identificação de Auth (`auth.users`) que permita migrar senhas/usuários sem uma operação controlada.

Não é seguro criar uma migration automática baseada em suposições.

A próxima etapa de segurança deverá:
1. mapear usuários atuais para identidades do Supabase Auth;
2. definir como os usuários receberão/alterarão senhas;
3. criar perfil/role sem expor senha ao frontend;
4. criar policies por operação;
5. habilitar RLS tabela por tabela;
6. validar cada fluxo antes de bloquear o próximo;
7. manter plano de retorno durante a migração.

Nenhuma policy ou RLS foi alterada nesta fase.

## Validação

A validação estática completa depende de uma instalação Linux limpa das dependências. O `npm ci --offline` não foi possível porque pacotes não estavam disponíveis no cache deste ambiente; a tentativa de instalação online não completou dentro do ambiente de execução.

Portanto esta fase **não deve ser descrita como build validado**.

O código foi revisado estaticamente e a alteração foi mantida restrita aos componentes envolvidos.

## Dados

Nenhuma operação foi executada contra o Supabase.
Nenhuma tabela, slot, histórico ou divergência foi apagada ou alterada por esta entrega.
