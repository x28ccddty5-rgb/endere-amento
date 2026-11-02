# Etapa 03 — Fase B3: painel administrativo de permissões

## Escopo

Esta fatia adiciona a interface de administração de permissões e a camada de cliente para RPCs existentes da fundação B1/B2. Não substitui ainda os guards de navegação nem as políticas antigas de estoque.

## Modo de execução seguro

- `npm run dev` abre por padrão uma prévia local com matriz simulada.
- Na prévia, nenhum RPC de permissões é chamado e salvar altera somente o estado local da página.
- Mesmo se `VITE_PERMISSION_ADMIN_MODE=live` for configurado acidentalmente no Vite dev, chamadas reais ficam bloqueadas quando `VITE_SUPABASE_URL` aponta para host remoto.
- Em build de produção, a tela fica desligada por padrão. O modo `live` precisa ser ativado explicitamente somente no pacote de publicação coordenada, depois de a fundação B1/B2 existir no Supabase de destino.
- Nenhum polling ou Realtime foi acrescentado.

## Interface

- Subaba **Permissões** dentro de Controle de Usuários, somente para Administrador.
- Configuração-base dos perfis Apoio, Produção e Visualizador; Administrador mantém acesso total; Liderança permanece legado e não pode receber novas atribuições.
- Exceções individuais com três estados: Herdar, Permitir e Negar.
- Permissões não delegáveis aparecem bloqueadas.
- Pesquisa por módulo, nome ou descrição, status de salvamento, proteção contra descartar alterações sem confirmação.
- A lista de usuários recebe o ID retornado pela Edge Function existente para identificar corretamente a exceção individual.

## Comunicação com backend no modo live

- Carregamento inicial: 1 chamada `get_permission_admin_matrix` quando a subaba de permissões é aberta.
- Salvamento do perfil: 1 chamada `save_role_permission_changes` apenas quando houver diferenças.
- Salvamento individual: 1 chamada `save_user_permission_overrides` apenas quando houver diferenças.
- Atualização manual: 1 chamada por clique; sem polling.
- Tabelas novas continuam inacessíveis diretamente pelo cliente. As RPCs B1/B2 validam autorização no backend.

## Validação

Testar `npm run lint`, `node --import tsx --test tests/permission-admin-model.test.mjs` e `npm run build`. A matriz no modo preview não comprova a autorização real do Supabase; testes de chamadas diretas continuam necessários antes de ativar o modo live.

## Não fazer

Não definir `VITE_PERMISSION_ADMIN_MODE=live` no ambiente local atual, porque a aplicação usa `.env.local` com URL remota de produção. Não publicar nem executar SQL adicional como parte desta fase.
