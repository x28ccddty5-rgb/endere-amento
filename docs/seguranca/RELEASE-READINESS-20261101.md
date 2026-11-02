# Release readiness — snapshot de 01/11/2026

## Resultado desta revisão isolada

- Última rodada de confirmação nesta cópia: `npm run lint` aprovado; `npm test` com **308/308** testes aprovados; `git -c core.whitespace=cr-at-eol diff --check` aprovado.
- O pacote de patch de organização foi conferido por manifesto SHA-256: 17 entradas, zero ausentes e zero divergências.

- Branch/HEAD do ZIP: `main` / `806388af8682c885cedf9890d422dbbd04e73ceb`; `origin/main` apontava para o mesmo commit no snapshot.
- Auditoria 03 local: usuário confirmou 307 testes, TypeScript e build aprovados no Windows; painel validado em dois navegadores e revogação de acesso observada sem novo login.
- Reexecução nesta cópia Linux: `npm run lint` aprovado; suíte completa aprovada após atualização do contrato do sandbox (**308 testes**).
- Build Vite nesta cópia não foi reproduzível: `node_modules` foi empacotado do Windows, sem o pacote opcional `@rollup/rollup-linux-x64-gnu`; o shim `.bin/vite` também não preservou permissão executável POSIX. Isso é limitação do ambiente do ZIP; não altera a aprovação de build já feita no Windows, mas exige nova confirmação `npm run build` no Windows após aplicar este patch de organização.
- Nenhum banco foi conectado; nenhum SQL, migration, DDL, DML, grant, policy, push ou deploy foi executado nesta revisão.
- Inspeção do histórico Git: houve um `.env` em commits ancestrais com somente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`; o payload JWT da chave foi verificado como `role=anon`. Não foi encontrada `service_role` nesse arquivo. A chave é pública por desenho, mas o arquivo continua fora do versionamento atual e não deve ser reintroduzido. Nenhum valor da chave foi copiado para relatórios ou pacotes.

## Organização proposta/realizada neste patch

- Restaurar README principal e criar índices para `docs/`, `docs/seguranca/`, `docs/sql/` e `scripts/`.
- Adicionar comando `npm test` para a suíte completa.
- Atualizar o nome privado do pacote de `react-example` para `enderecamento-estoque`.
- Ignorar estado `.temp`/`.branches`, backups e swap files.
- Arquivar instruções e manifesto antigos do pacote Ponto 03 como evidência, sem apagar os documentos.
- Gerar manifesto SHA-256 atualizado da lista de arquivos do pacote histórico.
- Substituir a senha fixa compartilhada do sandbox por uma senha aleatória gerada com `RandomNumberGenerator` a cada preparação local.

## Itens que impedem liberação oficial

1. O projeto principal ainda não possui `supabase/migrations`; o conjunto de trabalho continua em `docs/sql/migrations`. O fluxo oficial de versionamento/aplicação precisa ser decidido e reconciliado com o ledger.
2. Cinco migrations não têm rollback dedicado: `20261030100000`, `20261030110000`, `20261031120000`, `20261031130000`, `20261031140000`. O estado anterior de funções, seeds, policies e ACLs precisa ser preservado e a recuperação ensaiada no clone.
3. O projeto Supabase oficial não foi alterado e não contém a fundação configurável de permissões conforme preflight read-only anterior.
4. Quatro diffs são apenas finais de linha e não devem ser staged como alterações funcionais: `src/data/mockStorage.ts`, `src/lib/sharedLancamentoDraft.ts`, `tests/sharedLancamentoDraft.test.mjs`, `tests/ts-transpile-loader.mjs`. Restaurá-los somente após confirmar `git diff --quiet --ignore-space-at-eol HEAD -- <path>` para cada um. `docs/README_RASCUNHO_COMPARTILHADO.md` recebeu um aviso histórico intencional; preservar essa alteração documental.
5. A exclusão antiga do `README.md` é resolvida pelo novo README deste patch. `docs/README_CORRECAO.md` e `docs/README_RASCUNHO_COMPARTILHADO.md` foram marcados explicitamente como registros históricos, sem apagar o conteúdo original.
6. `src/App.tsx.backup-before-helpers-*`, `deno.json.bak_*`, `.temp`, `.branches`, `.env*` reais, `node_modules`, `dist` e `.git` não devem entrar em pacotes de compartilhamento/commits.
7. O build precisa ser executado no Windows do projeto após a aplicação do patch de organização.

## Gate do próximo commit local

- Aplicar o patch de organização e conferir o backup.
- Rodar `npm ci` somente se houver necessidade real de sincronizar dependências; não apagar o lockfile nem executar `npm update` geral.
- Rodar `npm run lint`, `npm test` e `npm run build` no Windows.
- Executar `git -c core.whitespace=cr-at-eol diff --check` e revisar diff real.
- Staging explícito por lista aprovada; não usar `git add .`.
- Criar commit local em branch candidata; não fazer push. A Vercel pode publicar automaticamente após push, portanto o push exige autorização e plano coordenado de banco.
