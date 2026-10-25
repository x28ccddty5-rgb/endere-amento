# Rascunho compartilhado e lançamento em lote — implantação

## Estado da publicação

A migração SQL foi aplicada no projeto Supabase `eltxmfgrbobinzchtxme` em 25/10/2026. A conferência somente de leitura posterior confirmou:

- As cinco tabelas novas existem e RLS está habilitado.
- As sete funções esperadas existem.
- As tabelas não concedem acesso direto a `anon`, `authenticated` ou `service_role`.
- As RPCs de uso do rascunho têm EXECUTE para `authenticated` e não para `anon`, `service_role` ou `PUBLIC`; a função helper não é executável diretamente por esses papéis.
- As RPCs legadas de estoque continuam presentes e executáveis por `authenticated`.
- Os oito rascunhos legados (238 linhas) foram copiados exatamente para a quarentena (`exact_mismatches = 0`).
- O controle singleton existe e as linhas ativas, linhas arquivadas e lotes processados estavam zerados na conferência.

**Não execute novamente `20261024_shared_lancamento_draft.sql` em produção.** Este arquivo está incluído para versionar a definição que foi aplicada e facilitar auditoria futura. É uma migração transacional que falha se as tabelas/funções candidatas já existirem.

## Código e testes

O frontend usa o rascunho único compartilhado e as RPCs de leitura, upsert por linha, exclusão, limpeza, consulta de resultado idempotente e processamento transacional. A identidade de cada operador fica nos metadados de auditoria; ela não separa os lotes.

Validação local feita no Windows para a versão V2: `npm run lint`, `npm run build` e 39/39 testes passaram. O `App.tsx` deste pacote preserva a alteração de rótulo da versão de produção (commit `ec754558552535b57ac50aa07b48a82c4add8492`) e contém a implementação compartilhada já validada.

## Arquivos neste update

- `src/App.tsx` — substituir. Implementação compartilhada e rótulo sincronizado com a produção.
- `docs/sql/20261024_shared_lancamento_draft.sql` — adicionar/substituir como registro da migração já aplicada; não executar novamente.
- `docs/sql/20261025_verify_shared_lancamento_draft.sql` — verificações somente de leitura para auditoria posterior.
- `docs/sql/90_ROLLBACK_OPEN_TRANSACTION.sql` — usar somente quando a própria sessão mantiver transação aberta/abortada.
- `docs/sql/99_ROLLBACK_SHARED_DRAFT_BEFORE_USE.sql` — rollback de emergência somente antes de o novo frontend receber dados; ele se recusa a remover estruturas se houver dados operacionais ou divergências de quarentena.

Preserve `docs/README_CORRECAO.md`; ele não faz parte desta implementação e não deve ser apagado nem incluído por engano no commit.

## Ordem para Git e Vercel

1. Copie os arquivos do pacote para a raiz `C:\Projetos\endere-amento`, mantendo os caminhos.
2. Execute `npm run lint`, `npm run build` e os testes documentados na conversa.
3. Verifique `git status --short`, `git diff --check`, e o diff dos arquivos que serão commitados.
4. Faça commit apenas dos arquivos da implementação (não use `git add .`).
5. A branch remota `main` tem um commit posterior ao HEAD local inicial: `ec754558...`, que altera o cabeçalho da coluna para “Data da Movimentação”. O `App.tsx` do pacote já preserva esse ajuste. Faça `git fetch origin`, rebasing do commit local sobre `origin/main` e só então `git push origin main`.
6. O projeto Vercel `endere-amento` está conectado ao repositório `x28ccddty5-rgb/endere-amento` e usa deploy por Git. Confira a implantação `READY` e o commit/SHA antes de retomar a operação.
7. Após o deploy, faça o teste funcional controlado com dois computadores: cada um adiciona linhas diferentes, sincroniza, e uma única pessoa processa o lote completo. Confirme saldos, histórico, divergências, resultado idempotente e novo rascunho.

Se o rebase apresentar conflito, não force push. Preserve ambos: a implementação do rascunho compartilhado e a alteração do cabeçalho para “Data da Movimentação”; envie o conflito para revisão.
