# Auditoria de segurança e permissões

## Estado em 01/11/2026

A Etapa 03 — Permissões configuráveis — foi validada no ambiente local: painel administrativo, matriz de 29 permissões, cinco perfis, exceções individuais, testes automatizados e revogação observada entre dois navegadores sem novo login. Isso **não** libera o projeto oficial. A estrutura remota, as policies, as RPCs e os grants ainda precisam ser reconciliados e implantados em janela controlada.

## Ordem técnica das fases

| Fase | Conteúdo | Artefatos principais |
|---|---|---|
| B1 | Fundação do catálogo e matriz-base | `FaseB1-Foundation-Banco.md`, `Aplicacao-B1-B2-Integracao-Local.md` |
| B2 | RPCs administrativas de escrita | `FaseB2-RPCs-Escrita-Permissoes.md` |
| B3 | Painel administrativo | `FaseB3-Painel-Permissoes.md`, `PermissionManagementPanel.tsx` |
| B4–B5 | Exportação por escopo | `FaseB4-Controle-Exportacoes.md`, `FaseB5-Exportacao-por-Escopo.md` |
| B6 | Produtos, metadados e RLS | `FaseB6-Produtos-Permissoes.md`, `FaseB6-2-Metadados-Slot.md`, `Aplicacao-B6-1-B6-2A-Clone-Local.md` |
| B7.1 | Escritores tipados de estoque | `FaseB7-1-Operacao-Tipada-Estoque.md` |
| B8 | Correções físicas e divergências | `B8-Autorizacao-Correcoes-Fisicas-Divergencias.md` |

A matriz operacional consolidada é `Matriz-Permissoes-v1.2.md` e `Matriz-Permissoes-v1.2.csv`. Mantenha as duas sincronizadas; não criar uma segunda matriz paralela.

## Relatórios e inventários

- `Analise-Inventario-Mutacoes-Etapa03.md` — inventário e análise de escritores.
- `permission-mutation-inventory.txt` — inventário mais recente de mutações na data do relatório.
- `permission-mutation-inventory-20261029-archive.txt` — fotografia histórica, não substitui o inventário atual.
- `permission-write-callsite-inventory.txt` — callsites atuais no snapshot correspondente.
- `permission-write-callsite-inventory-20261029-archive.txt` — arquivo histórico.
- `Checkup-Lote-Compartilhado-Local.md`, `Preflight-Integracao-Mutacoes.md`, `Teste-Backend-Permissoes.md` — evidências e procedimentos locais.

Relatórios datados são evidências de um momento; antes de usá-los para decisão de implantação, comparar com o código e schema atuais.

## Sandbox de permissões

`permission-sandbox/` é um projeto Supabase local separado, com migrations próprias. Não é a pasta de migrations do projeto principal. Seu script de inicialização reseta apenas o sandbox nomeado `enderecamento-permission-test`; nunca executar o reset em projeto linkado/remoto. Os artefatos `.temp` e `.branches` são estado local e não devem ser versionados.

## Regras permanentes

- Administrador é o único perfil que gerencia usuários e permissões.
- Acesso negado por padrão; perfil/chave/matriz incompletos não concedem acesso.
- Exceções individuais só são possíveis para chaves delegáveis.
- Frontend não é fronteira de segurança: RLS, RPC e Edge Functions precisam validar a decisão vigente.
- Movimentações de estoque continuam transacionais, atômicas e auditáveis.
- Não usar polling ou canal Realtime adicional para atualizar permissões.
- Não alterar o Supabase oficial, grants, policies ou Vercel sem preflight read-only, rollback revisado e autorização explícita.
