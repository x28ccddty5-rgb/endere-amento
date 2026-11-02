# Auditoria 03 — Correções de sessão, listagem administrativa e catálogo

## Causa raiz da lista vazia

O `useEffect` que carregava `admin-users` era declarado antes do efeito que reagia à mudança de `authUserId`. No login, os dois efeitos executavam no mesmo ciclo do React:

1. O carregamento iniciava e capturava a geração anterior em `sessionDataGenerationRef`.
2. O efeito de troca de sessão incrementava a geração, limpava usuários e invalidava a resposta recém-iniciada.
3. Quando a Edge Function respondia, o resultado era descartado por não pertencer à geração atual.

A função, o Auth e o banco de integração podiam retornar dois usuários com HTTP 200, mas o estado React permanecia vazio. O carregamento agora ocorre depois da limpeza da sessão, com dependências em `authUserId` e `currentUser`.

## Proteção da interface

Falhas de rede ou respostas inválidas não são mais representadas como uma lista vazia. A tela diferencia carregamento, erro e ausência real de usuários, e permite uma tentativa manual de recarga. Não há polling nem repetição automática.

## Causa raiz do bloqueio da matriz

O metadado `description` de `permission_catalog.stock.details.view` estava diferente do texto exato no catálogo frontend. O parser compara os metadados literalmente e interrompe o carregamento ao detectar a divergência.

A migração SQL alinha somente essa descrição. Ela aceita o valor novo como idempotente, altera apenas o valor antigo conhecido e falha diante de qualquer outro valor inesperado.

## Aplicação na integração local

O pacote inclui `APLICAR-CORRECOES-AUDITORIA03.ps1`. Extraia o ZIP em uma pasta separada e execute o script. Ele:

1. Confirma que o destino é `C:\Projetos\endere-amento` e que `.env.integration.local` aponta para `127.0.0.1:55441`.
2. Faz backup dos arquivos que serão substituídos.
3. Aplica os arquivos corrigidos.
4. Executa TypeScript (`npm run lint`), o teste de regressão e o build.
5. Altera somente a descrição conhecida de `stock.details.view` no container exato `supabase_db_enderecamento-integracao-local` e executa a verificação SQL.

O script não chama Cloud, não faz deploy, não altera senhas, usuários, papéis ou permissões, e não toca em produção. Não há polling nem repetição automática.

## Rollback

O rollback SQL está em `docs/sql/rollback/20261031170000_permission_stock_details_description_alignment_rollback.sql`. Ele só restaura a descrição antiga se o campo ainda contiver exatamente o valor introduzido pela migração. Os arquivos anteriores ficam em um diretório identificado dentro de `%TEMP%`, informado ao final do instalador.
