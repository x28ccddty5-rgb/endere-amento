# Endereçamento — Porto Brasil Cerâmica

Sistema interno de controle físico e lógico de endereçamento de estoque.

## Stack

- React + TypeScript
- Vite
- Supabase
- Tailwind CSS
- XLSX / PDF
- Google GenAI (recursos de consultor em evolução)

## Executar localmente

```bash
npm ci
npm run dev
```

O projeto utiliza as variáveis:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Use `.env.example` como referência. Não versionar `.env`.

## Validação

```bash
npm run lint
npm run build
```

## Regras importantes

- O Supabase é a fonte oficial dos dados operacionais.
- E2/E3 usam o cadastro de `slots` como registro das posições físicas existentes.
- O sistema não deve criar silenciosamente posições físicas novas em E2/E3.
- E1 possui comportamento próprio de corredor/SKU e não deve ser tratado como uma grade comum.
- Entrada em posição ocupada por outro SKU gera divergência.
- Saída com SKU divergente ou saldo insuficiente gera divergência.
- Saída total deixa a posição vazia, mas nunca remove o cadastro da posição.
- Movimentações são ordenadas por data + hora nos lançamentos em lote.
- Visualizador consulta, mas não executa operações.
- Recursos avançados administrativos permanecem restritos.

## Segurança

A autenticação atual ainda é uma implementação legada baseada na tabela `users`. A migração para Supabase Auth + RLS é uma etapa posterior e deliberadamente não foi aplicada nesta entrega para evitar indisponibilidade.

Consulte `docs/Auditoria-Correcoes-Fase1.md`.

## Documentação

- `docs/Auditoria-Correcoes-Fase1.md` — mudanças, evidências e limitações.
- `docs/Supabase-Coleta-ReadOnly.sql.md` — consultas somente leitura para a próxima auditoria de schema/RLS.


## Estado desta entrega

Fase 2: preservação da reconciliação por endereço e otimizações seguras do Dashboard. A migração definitiva para Supabase Auth/RLS permanece planejada e não foi aplicada sem uma estratégia de migração de usuários.
