# Validação local recomendada

Depois de substituir o projeto:

```powershell
npm ci
npm run lint
npm run build
npm run dev
```

Se `npm ci` apresentar problema de cache/dependência, não copie `node_modules` de outro sistema operacional.

## Testes funcionais mínimos

### Dashboard
1. Abrir Dashboard.
2. Abrir SKUs parados.
3. Testar 7, 15, 30 e 60+.
4. Pesquisar SKU.
5. Exportar CSV.
6. Confirmar que nenhum SKU aparece como 999.

### Lançamento
1. Entrada em posição vazia.
2. Entrada do mesmo SKU na mesma posição.
3. Entrada de SKU diferente em posição ocupada.
4. Saída parcial.
5. Saída total.
6. Saída acima do saldo.
7. Endereço E2/E3 inexistente.
8. Confirmar que posição vazia continua cadastrada.

### Divergência
1. Criar duas divergências abertas na mesma posição.
2. Corrigir uma delas.
3. Confirmar que ambas ficam `Corrigida`.
4. Confirmar que uma divergência de outra posição permanece `Aberta`.
5. Confirmar que registros já corrigidos não são alterados.

### Segurança atual
1. Entrar com cada perfil.
2. Confirmar telas permitidas.
3. Confirmar que Visualizador não executa operações.
4. Confirmar que somente Administrador acessa administração.

## Build no Linux sem depender do Windows

O problema anterior de build era causado por `node_modules` com binários nativos de Windows.

A solução correta é instalar as dependências no próprio ambiente Linux:

```bash
rm -rf node_modules
npm ci
npm run lint
npm run build
```

No Windows, use:

```powershell
Remove-Item -Recurse -Force node_modules
npm ci
npm run lint
npm run build
```

Não copie `node_modules` entre Windows e Linux.

O projeto usa Vite/esbuild/Rollup, que possuem binários específicos da plataforma.

## Importante

`npm run lint`/`npm run build` devem ser considerados evidência de validação somente quando o comando terminar com código 0 no ambiente correspondente.
