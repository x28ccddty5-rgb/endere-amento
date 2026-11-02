/**
 * Catálogo de permissões consumido pelo frontend.
 *
 * As chaves e os metadados estruturais devem permanecer sincronizados com
 * public.permission_catalog. A autorização efetiva é calculada no PostgreSQL
 * e consultada pelo appPermissionService; este arquivo fornece tipagem,
 * descrições para a interface e valores de referência para preview.
 */
export type ActiveAppRole =
  | "administrador"
  | "apoio"
  | "producao"
  | "visualizador"
  | "lideranca";

export type KnownAppRole = ActiveAppRole;
export type PermissionOverride = "inherit" | "allow" | "deny";

export const ACTIVE_APP_ROLES = [
  "administrador",
  "apoio",
  "producao",
  "visualizador",
  "lideranca",
] as const satisfies readonly ActiveAppRole[];

export const PERMISSION_CATALOG = [
  {
    key: "dashboard.view",
    group: "Dashboard",
    label: "Consultar Dashboard",
    description: "Consultar indicadores operacionais consolidados.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: true, lideranca: false },
  },
  {
    key: "stock.search",
    group: "Pesquisa de estoque",
    label: "Pesquisar SKU e endereço",
    description: "Consultar a base operacional completa de estoque (14 campos) e utilizar os filtros da Pesquisa.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: true, visualizador: true, lideranca: true },
  },
  {
    key: "stock.details.view",
    isDeprecated: true,
    group: "Pesquisa de estoque",
    label: "Consultar detalhes do estoque",
    description: "Chave legada descontinuada; não controla mais campos exibidos, filtros, exportação ou leitura da Pesquisa.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: false, visualizador: true, lideranca: false },
  },
  {
    key: "stock.launch.view",
    group: "Lançamentos",
    label: "Abrir tela de lançamentos",
    description: "Consultar a tela e o fluxo de lançamento sem, por si só, autorizar gravação.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: false, visualizador: true, lideranca: false },
  },
  {
    key: "stock.launch.create",
    group: "Lançamentos",
    label: "Registrar entrada ou saída",
    description: "Executar lançamento normal de entrada/saída de estoque.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "stock.transfer.create",
    group: "Lançamentos",
    label: "Transferir entre posições",
    description: "Registrar transferência entre posições; permissão separada de entrada/saída.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "stock.batch.process",
    group: "Lançamentos",
    label: "Processar lote compartilhado",
    description: "Executar processamento de lote de lançamentos compartilhados.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "stock.physical_correction",
    group: "Mapa do estoque",
    label: "Corrigir saldo físico",
    description: "Alterar saldo/identidade pelo fluxo transacional de correção física do mapa.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "history.view",
    group: "Histórico",
    label: "Consultar histórico",
    description: "Consultar movimentações de estoque autorizadas.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: false, visualizador: true, lideranca: false },
  },
  {
    key: "divergences.view",
    group: "Divergências",
    label: "Consultar divergências",
    description: "Visualizar divergências sem autorizar sua resolução.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: false, visualizador: true, lideranca: false },
  },
  {
    key: "divergences.resolve",
    group: "Divergências",
    label: "Resolver divergências",
    description: "Executar ações de correção e resolução de divergências.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "products.view",
    group: "Produtos e SKUs",
    label: "Consultar cadastro de produtos",
    description: "Abrir e consultar a base de produtos e SKUs.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: true, lideranca: false },
  },
  {
    key: "products.create",
    group: "Produtos e SKUs",
    label: "Cadastrar SKU individual",
    description: "Criar um novo SKU individualmente.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "products.edit",
    group: "Produtos e SKUs",
    label: "Editar SKU individual",
    description: "Alterar dados de um SKU individualmente.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "products.import_bulk",
    group: "Produtos e SKUs",
    label: "Importar/atualizar base em lote",
    description: "Importar ou atualizar muitos produtos por vez. Exclusivo de Administrador.",
    userOverrideAllowed: false,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "products.delete_deactivate",
    group: "Produtos e SKUs",
    label: "Excluir/desativar SKU",
    description: "Excluir ou desativar um produto. Exclusivo de Administrador.",
    userOverrideAllowed: false,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "map.view",
    group: "Mapa do estoque",
    label: "Visualizar mapa físico",
    description: "Consultar o gêmeo digital do estoque sem implicar edição ou correção de saldo.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: false, visualizador: true, lideranca: false },
  },
  {
    key: "map.metadata.edit",
    group: "Mapa do estoque",
    label: "Editar metadados do mapa",
    description: "Editar campos não financeiros do mapa, sem autorizar correção física de saldo.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "warehouse.layout.view",
    group: "Estrutura do estoque",
    label: "Consultar estrutura física",
    description: "Consultar cadastro de módulos, posições e capacidades.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: true, lideranca: false },
  },
  {
    key: "warehouse.layout.manage",
    group: "Estrutura do estoque",
    label: "Administrar estrutura física",
    description: "Criar, editar, ativar/desativar ou remover módulos/posições. Exclusivo de Administrador.",
    userOverrideAllowed: false,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "consultor.use",
    group: "Consultor IA",
    label: "Usar Consultor de Estoque",
    description: "Consultar recomendações do Consultor de Estoque, respeitando o escopo de dados autorizado.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: true, producao: true, visualizador: true, lideranca: false },
  },
  {
    key: "reports.export",
    group: "Exportações",
    label: "Exportar dados e relatórios",
    description: "Autorizar exportação em qualquer formato, limitada aos módulos/dados que o usuário pode consultar.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: false, producao: true, visualizador: true, lideranca: false },
  },
  {
    key: "database.view",
    group: "Base de dados",
    label: "Consultar base de dados",
    description: "Abrir a base de dados em leitura, sem conceder ações de manutenção.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: true, lideranca: false },
  },
  {
    key: "database.manage",
    group: "Base de dados",
    label: "Administrar base de dados",
    description: "Executar operações administrativas gerais na base. Exclusivo de Administrador.",
    userOverrideAllowed: false,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "users.view",
    group: "Usuários e permissões",
    label: "Consultar usuários",
    description: "Visualizar a administração de usuários. Exclusivo de Administrador.",
    userOverrideAllowed: false,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "users.manage",
    group: "Usuários e permissões",
    label: "Administrar usuários",
    description: "Criar, alterar, desativar ou excluir usuários conforme as proteções administrativas.",
    userOverrideAllowed: false,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "permissions.manage",
    group: "Usuários e permissões",
    label: "Administrar permissões",
    description: "Alterar permissões-base e exceções individuais. Exclusivo de Administrador.",
    userOverrideAllowed: false,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
  {
    key: "configuration.view",
    group: "Configurações",
    label: "Consultar configurações não secretas",
    description: "Visualizar parâmetros não secretos, sem mostrar credenciais, chaves ou segredos.",
    userOverrideAllowed: true,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: true, lideranca: false },
  },
  {
    key: "configuration.manage",
    group: "Configurações",
    label: "Administrar configurações",
    description: "Alterar configurações administrativas. Exclusivo de Administrador.",
    userOverrideAllowed: false,
    defaults: { administrador: true, apoio: false, producao: false, visualizador: false, lideranca: false },
  },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

export const PERMISSION_KEYS = PERMISSION_CATALOG.map((item) => item.key) as PermissionKey[];

export const ADMIN_ONLY_PERMISSION_KEYS = PERMISSION_CATALOG
  .filter((item) => !item.userOverrideAllowed)
  .map((item) => item.key) as PermissionKey[];

const catalogByKey = new Map<string, (typeof PERMISSION_CATALOG)[number]>(
  PERMISSION_CATALOG.map((item) => [item.key, item]),
);

export function normalizeKnownAppRole(role: string | null | undefined): KnownAppRole | null {
  const normalized = (role ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (ACTIVE_APP_ROLES.includes(normalized as KnownAppRole)) {
    return normalized as KnownAppRole;
  }

  return null;
}

export function getPermissionDefinition(key: string) {
  return catalogByKey.get(key) ?? null;
}

export function isKnownPermissionKey(key: string): key is PermissionKey {
  return catalogByKey.has(key);
}
