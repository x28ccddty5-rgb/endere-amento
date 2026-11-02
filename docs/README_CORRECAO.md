# Correção de divergências — desktop e mobile

> **Registro histórico de pacote — instruções não vigentes para publicação.** Este arquivo documenta uma entrega anterior de correção de divergências. Os caminhos, commits, versões e procedimentos citados refletem aquele pacote e não devem ser executados ou usados para commit/push/deploy sem nova revisão. Use o README principal e o mapa de release atual para os procedimentos vigentes. Nenhuma instrução deste registro autoriza mudanças no Supabase oficial ou na Vercel.

## Arquivos para substituir/criar

1. Substituir `src/App.tsx`.
2. Substituir `src/components/DivergenciasPanel.tsx`.
3. Criar `src/lib/divergenceResolution.ts`.
4. Substituir `tests/cloud_stock_regressions.test.mjs`.

`src/components/mobile/MobileShell.tsx` não precisa ser substituído: ele já chama o handler compartilhado do App.

## O que muda

- Desktop usa o mesmo handler do mobile para seleção segura do slot, histórico e transação atômica.
- Se a divergência selecionada contiver um snapshot antigo, o código só usa um slot ocupado quando outra divergência aberta no mesmo endereço confirma SKU e restrição atuais.
- Se houver mais de um slot ocupado confirmado, ou um ID E1/auxiliar precisar mudar de identidade, a operação continua bloqueada com mensagem explicativa.
- Todas as divergências abertas no mesmo endereço físico normalizado são atualizadas junto com o slot e o histórico na RPC já existente.
- O snapshot esperado para comparação atômica usa `slotsRef.current`, a mesma fonte síncrona que alimenta a reconciliação.
- O botão desktop fica desabilitado durante a confirmação para prevenir duplo acionamento.

## Validação

Executar na raiz do projeto, separadamente:

```powershell
npm run lint
npm run build
node --import tsx --test tests/cloud_stock_regressions.test.mjs
```

Nenhuma migration, alteração no Supabase, commit, push ou deploy foi executado durante a preparação deste pacote.
