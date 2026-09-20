export type AppRole =
  | "administrador"
  | "lideranca"
  | "apoio"
  | "producao"
  | "visualizador";

/**
 * Converte as representações antigas/atuais de perfil para uma chave única.
 * A regra de autorização usa sempre estas chaves internas, enquanto a UI
 * continua exibindo os rótulos em português.
 */
export const normalizeRole = (role?: string | null): AppRole | "" => {
  const normalized = (role || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    normalized === "administrador" ||
    normalized === "lideranca" ||
    normalized === "apoio" ||
    normalized === "producao" ||
    normalized === "visualizador"
  ) {
    return normalized;
  }

  return "";
};

export const roleLabel = (role: string):
  | "Administrador"
  | "Liderança"
  | "Apoio"
  | "Produção"
  | "Visualizador" => {
  switch (normalizeRole(role)) {
    case "administrador": return "Administrador";
    case "lideranca": return "Liderança";
    case "apoio": return "Apoio";
    case "producao": return "Produção";
    default: return "Visualizador";
  }
};

export const PERMISSIONS = {
  dashboard: ["administrador", "lideranca", "visualizador"],
  busca: ["administrador", "lideranca", "apoio", "producao", "visualizador"],
  lancamento: ["administrador", "lideranca", "apoio", "producao", "visualizador"],
  historico: ["administrador", "lideranca", "apoio", "producao", "visualizador"],
  divergencias: ["administrador", "lideranca", "apoio", "producao", "visualizador"],
  baseDados: ["administrador", "lideranca", "visualizador"],
  usuarios: ["administrador"],
  configuracao: ["administrador"],
} as const satisfies Record<string, readonly AppRole[]>;

export const canAccessPermission = (
  role: string | null | undefined,
  permission: keyof typeof PERMISSIONS
): boolean => {
  const normalizedRole = normalizeRole(role);
  return normalizedRole !== "" && (PERMISSIONS[permission] as readonly string[]).includes(normalizedRole);
};

export const canExecuteOperations = (role: string | null | undefined): boolean => {
  const normalizedRole = normalizeRole(role);
  return (["administrador", "lideranca", "apoio", "producao"] as readonly string[]).includes(normalizedRole);
};

export const isAdmin = (role: string | null | undefined): boolean =>
  normalizeRole(role) === "administrador";

export const isReadOnlyRole = (role: string | null | undefined): boolean =>
  normalizeRole(role) === "visualizador";
