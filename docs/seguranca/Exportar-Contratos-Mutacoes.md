# Inventário dos contratos de mutação — somente leitura

Este script precisa ser executado antes de projetar a migração que conectará permissões configuráveis às operações de estoque.

## O que coleta

- Rótulos Docker do container local de integração já existente.
- Distribuição de perfis e colunas/constraints de `profiles`.
- Todas as overloads e definições SQL de RPCs críticas conhecidas, com `SECURITY DEFINER`, `search_path`, proprietário e ACL de execução.
- Funções relacionadas a estoque, divergências, estrutura, lançamentos, snapshots, produtos e permissões.
- Políticas RLS e privilégios DML para tabelas operacionais.
- Triggers que podem executar código adicional nas gravações.
- Presença do catálogo de migrações Supabase.

## Garantias

O script consulta somente o container `supabase_db_enderecamento-integracao-local` se ele já estiver em execução. Não inicia, para, reinicia, remove ou reseta containers; não roda DDL/DML, `supabase link`, `db push` ou migrações. Se o container não estiver ativo, o script para.

O relatório inclui texto das definições de funções, mas não seleciona linhas de estoque, tokens, chaves ou senhas. Ainda assim, revise o arquivo antes de compartilhá-lo; funções podem conter nomes internos de objetos ou mensagens do sistema.

## Execução

```powershell
Set-Location C:\Projetos\endere-amento
node --test tests\permission-mutation-inventory-contract.test.mjs
if ($LASTEXITCODE -ne 0) { throw "Teste do inventário falhou. Pare aqui." }
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Projetos\endere-amento\scripts\Export-PermissionMutationInventory.ps1"
if ($LASTEXITCODE -ne 0) { throw "Inventário falhou. Envie a mensagem completa." }
```

Depois, anexe `docs\seguranca\permission-mutation-inventory.txt` à conversa. Não execute migrations de autorização de mutação antes da revisão deste inventário.
