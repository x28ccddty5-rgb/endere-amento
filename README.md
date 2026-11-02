# Endereçamento — Porto Brasil Cerâmica

Aplicação interna para consulta e gestão do endereçamento físico e lógico dos estoques. O projeto reúne a aplicação web, funções Supabase, testes automatizados, scripts de integração local e documentação das auditorias.

> **Situação em 01/11/2026:** a Auditoria 03 foi validada no ambiente local. A preparação de publicação oficial continua em revisão. Não considerar este repositório autorizado para `db push`, migration remota ou deploy até concluir o preflight e obter aprovação explícita.

## Tecnologias

- React 19, TypeScript e Vite 6.
- Supabase Auth, PostgreSQL, RLS, RPCs e Edge Functions.
- Tailwind CSS, XLSX e jsPDF.
- Testes de contrato e regressão com Node.js Test Runner.

## Requisitos locais

- Node.js 20 ou superior (o ambiente do responsável utiliza Node 24).
- npm compatível com a versão de Node instalada.
- Para os testes de banco: Docker Desktop, Supabase CLI e PostgreSQL 17, conforme os scripts específicos.

## Configuração de ambiente

1. Use `.env.example` apenas como modelo.
2. Mantenha `.env.local`, `.env.integration.local` e `.env.permission-test.local` fora do Git e fora de pacotes compartilháveis.
3. `.env.local` aponta para o projeto oficial; não use esse modo para ensaios de mutação.
4. Para validação web com o clone local, inicie explicitamente o modo `integration`:

```powershell
npm ci
npm run dev -- --mode integration --host 0.0.0.0 --port 3000 --strictPort
```

O modo `integration` carrega `.env.integration.local`. Confirme a URL local antes de autenticar. A aplicação não deve ser iniciada com configuração ambígua durante testes de integração.

## Comandos de validação

```powershell
npm run lint
npm test
npm run build
```

- `lint` executa `tsc --noEmit`.
- `test` executa todos os arquivos `tests/*.test.mjs`, incluindo o loader TypeScript do projeto.
- `build` gera a build Vite de produção em `dist/`.

Os testes estáticos/de contrato não substituem os testes de integração PostgreSQL. Scripts que iniciam, resetam ou alteram bancos locais têm instruções e guards próprios; leia `scripts/README.md` antes de executá-los.

## Ambientes Supabase locais

Há dois ambientes distintos e não intercambiáveis:

- **Clone de integração:** container `supabase_db_enderecamento-integracao-local`, usado pelos scripts `*LocalIntegration.ps1`. Os scripts precisam validar o nome exato do container antes de aplicar SQL.
- **Sandbox de permissões:** projeto independente em `docs/seguranca/permission-sandbox`, com API local na porta 55321, PostgreSQL na 55433 e Studio na 55323. O script de inicialização executa `supabase db reset --local --yes` somente nesse sandbox descartável.

Nunca use o sandbox para dados operacionais. Nunca execute `supabase link`, `supabase db push`, `supabase db reset --linked` ou comandos remotos como substitutos dos scripts locais.

## Banco e migrations

As migrations de trabalho estão em `docs/sql/migrations/`, com verificações em `docs/sql/` e rollbacks em `docs/sql/rollback/`. Essa pasta **não é** a pasta convencional `supabase/migrations` do Supabase CLI. A presença de SQL ali não significa que `supabase db push` vá aplicá-lo. A ordem e o mecanismo oficial de versionamento ainda precisam ser reconciliados com o schema e o migration ledger do projeto hospedado.

Consulte `docs/sql/README.md` antes de qualquer execução. Algumas migrations não têm rollback dedicado e não podem ser revertidas com um `DROP` genérico.

## Regras operacionais essenciais

- O Supabase é a fonte oficial dos dados operacionais.
- E1 possui comportamento de corredor/SKU e não deve ser tratado como grade física comum.
- E2/E3 representam posições físicas; não criar posições silenciosamente nem reescrever IDs históricos por aproximação.
- Posições inativas devem permanecer inativas; não executar limpeza em massa de endereços ou histórico.
- Movimentações, transferências e correções críticas devem preservar atomicidade, idempotência, locks, divergências e histórico.
- Falha de autorização deve negar por padrão; ocultar botão ou aba não substitui RLS/RPC/Edge Function.
- Não adicionar polling ou Realtime para permissões sem justificativa e medição.

## Permissões configuráveis

A implementação local contém catálogo de 29 permissões e cinco perfis: Administrador, Apoio, Produção, Visualizador e Liderança. O painel permite configurar a matriz por perfil e exceções individuais delegáveis (`Herdar`, `Permitir`, `Negar`). Permissões exclusivas de Administrador não podem ser delegadas.

A interface, a persistência local e a revogação entre sessões foram validadas no ambiente de teste. A fundação correspondente ainda precisa ser reconciliada e implantada de forma coordenada no projeto oficial; não presumir que o banco hospedado já contém essas estruturas.

## Documentação

- [`docs/README.md`](docs/README.md) — índice geral.
- [`docs/seguranca/README.md`](docs/seguranca/README.md) — auditorias, fases B1–B8 e matriz v1.2.
- [`docs/sql/README.md`](docs/sql/README.md) — migrations, verificações e reversões.
- [`scripts/README.md`](scripts/README.md) — catálogo de scripts e limites de segurança.
- [`docs/seguranca/RELEASE-READINESS-20261101.md`](docs/seguranca/RELEASE-READINESS-20261101.md) — estado da revisão deste snapshot.

## Política de versionamento

Não usar `git add .` como substituto de revisão. Não versionar `.env*` real, `node_modules`, `dist`, estado `.temp`/`.branches` do Supabase, backups ou arquivos de swap. Preservar evidências de auditoria e não descartar alterações sem verificar diffs e dependências.
