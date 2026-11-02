# B8 — Autorização backend para correções físicas e divergências

## Escopo desta etapa

A migração `20261030100000_permission_stock_divergence_guards.sql` ajusta as rotinas transacionais já existentes e implementa a RPC dedicada `zero_physical_divergence_address_atomic`.

- `resolve_stock_divergence_atomic` consulta `divergences.resolve` no backend e passa a `SECURITY DEFINER`, com `search_path` vazio, para aplicar a permissão efetiva sem depender da lista fixa das políticas RLS antigas.
- `reconcile_physical_address_atomic` consulta `stock.physical_correction`; exige também `divergences.resolve` quando o payload inclui divergências para encerrar.
- `reconcile_physical_address_atomic_with_deletes` segue a mesma regra e mantém suas validações atuais de exclusão dos auxiliares.
- `zero_physical_divergence_address_atomic` é uma implementação própria. Não delega às RPCs de reconciliação porque o contrato do zeramento consolida históricos por SKU/restrição e exclui auxiliares de outra forma.
- A interface móvel consulta `stock.physical_correction` e `divergences.resolve` antes de iniciar o zeramento. A autorização real permanece no banco.

## Proteções da RPC de zeramento

A função exige confirmação explícita, sessão autenticada e ambas as permissões. Confere endereço E2/E3 canônico, fotografia completa de slots, linha-base única, IDs auxiliares canônicos, conjunto completo de divergências abertas, snapshot sem alterações concorrentes, saldo não negativo, restrições/galpões válidos e conjunto exato de exclusões.

O histórico é validado contra os saldos atuais bloqueados, com uma linha por SKU/restrição positiva. Posições auxiliares sem saldo não geram movimento, mas podem ser removidas quando seu ID/identidade é válido. O processo registra `physical_corrections`, zera a base, exclui somente os auxiliares enviados, insere o histórico e corrige as divergências na mesma transação. A tabela de layout não é alterada e posições inativas não são reativadas nem excluídas.

O `correctionId` e o fingerprint protegem contra repetição: mesma sessão + mesmo payload retorna `alreadyApplied`, incluindo a data, a hora e o operador originalmente gravados; reutilização com outro conteúdo ou outra sessão retorna conflito. A interface atualiza seu cache com esses metadados retornados pelo servidor, não com o relógio local.

## Fora do escopo

Esta etapa **não** revoga privilégios DML de `authenticated`, não altera políticas RLS e não migra o registro isolado de divergências novas por conflito. O helper `has_app_permission` ainda não contempla o perfil legado `lideranca`; esse perfil deve ser resolvido na fundação do catálogo antes de considerar a matriz de todos os perfis completa. Esses caminhos serão tratados após o inventário completo dos escritores, para não interromper gravações ainda existentes.

## Aplicação e validação

1. Aplicar somente no clone local com o comando PowerShell fornecido na conversa.
2. Executar `docs/sql/20261030100000_permission_stock_divergence_verify.sql` no clone.
3. Validar a função com fixtures sintéticos locais: sucesso com saldo, sucesso sem saldo, múltiplos SKUs/restrições consolidados, divergência concorrente, snapshot incompleto, auxiliar não canônico, confirmação ausente, negação de cada permissão, repetição idempotente e falha no meio da transação com rollback integral.
4. Não enviar ao Supabase Cloud até o fechamento das seis frentes de auditoria e a publicação única final.

O ambiente de edição desta etapa não possui `docker` nem `psql`; portanto, a migração ainda requer validação de sintaxe e execução no clone local do Windows antes de ser considerada concluída.
