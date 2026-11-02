# Documentação do Endereçamento

Este índice separa documentação operacional, auditoria de segurança e artefatos SQL. Preserve os arquivos de fase e as evidências; use os índices para encontrar a fonte atual sem apagar o histórico.

## Segurança e permissões

- [`seguranca/README.md`](seguranca/README.md) — mapa das auditorias e fases B1–B8.
- [`seguranca/Matriz-Permissoes-v1.2.md`](seguranca/Matriz-Permissoes-v1.2.md) e CSV correspondente — matriz aprovada de referência.
- [`seguranca/Especificacao-Tecnica-Permissoes-v1.1.md`](seguranca/Especificacao-Tecnica-Permissoes-v1.1.md) — especificação técnica anterior; consulte junto da matriz v1.2 e dos documentos de implementação mais recentes.
- [`seguranca/permission-sandbox/`](seguranca/permission-sandbox/) — projeto Supabase local isolado para testes do painel.
- [`seguranca/evidence/`](seguranca/evidence/) — instruções e manifestos históricos preservados.

## Banco de dados

- [`sql/README.md`](sql/README.md) — inventário e alertas de execução.
- [`sql/migrations/`](sql/migrations/) — migrations de desenvolvimento, não conectadas automaticamente ao Supabase CLI principal.
- [`sql/rollback/`](sql/rollback/) — rollbacks dedicados disponíveis.
- Scripts `verify`, `preflight` e `smoke` ficam na pasta `sql/`; verifique o cabeçalho e as pré-condições antes de executar.

## Correções e operações

- [`README_CORRECAO.md`](README_CORRECAO.md) — correção de divergências em desktop/mobile.
- [`README_RASCUNHO_COMPARTILHADO.md`](README_RASCUNHO_COMPARTILHADO.md) — registro histórico da implementação do rascunho compartilhado; não é uma instrução para reaplicar migrations.
- [`RESTRICOES_E2_E3_ORIGINAIS.md`](RESTRICOES_E2_E3_ORIGINAIS.md), [`Arquitetura.md`](Arquitetura.md), [`Auditoria-e-Correcao.md`](Auditoria-e-Correcao.md) e demais relatórios legados — preservar como histórico; validar datas e escopo antes de usá-los como instrução atual.
