import { createClient } from "@supabase/supabase-js"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const AUTH_USERS_PAGE_SIZE = 1000
const AUTH_USERS_MAX_PAGES = 100
const PROFILE_LOOKUP_CHUNK_SIZE = 500
const MAX_USERNAME_LENGTH = 64
const MAX_NAME_LENGTH = 120
const MAX_EMAIL_LENGTH = 254
const MAX_PASSWORD_LENGTH = 128

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  })
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") ?? ""
  if (!authorization.toLowerCase().startsWith("bearer ")) return null
  return authorization.slice("Bearer ".length).trim()
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const secretKey =
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !secretKey) {
    throw new Error("Configuração segura do Supabase não encontrada.")
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function authenticateAdministrator(request: Request) {
  const token = getBearerToken(request)

  if (!token) {
    return { error: jsonResponse({ error: "Não autenticado." }, 401) }
  }

  const supabaseAdmin = getAdminClient()
  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token)

  if (userError || !user) {
    return { error: jsonResponse({ error: "Sessão inválida." }, 401) }
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, username, name, role")
    .eq("id", user.id)
    .maybeSingle()

  if (profileError) {
    console.error("Erro ao consultar perfil do administrador:", profileError)
    return {
      error: jsonResponse(
        { error: "Não foi possível validar o perfil." },
        500,
      ),
    }
  }

  if (!profile || profile.role !== "administrador") {
    return { error: jsonResponse({ error: "Acesso não autorizado." }, 403) }
  }

  return { supabaseAdmin, user, profile }
}

async function listUsers(supabaseAdmin: ReturnType<typeof getAdminClient>) {
  const authUsers: Array<{ id: string; email?: string | null }> = []
  let reachedEnd = false

  for (let page = 1; page <= AUTH_USERS_MAX_PAGES; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: AUTH_USERS_PAGE_SIZE,
    })

    if (error) {
      console.error("Erro ao listar usuários do Auth:", error)
      return jsonResponse(
        { error: "Não foi possível listar os usuários." },
        500,
      )
    }

    authUsers.push(...data.users.map((user) => ({
      id: user.id,
      email: user.email ?? "",
    })))

    if (data.users.length < AUTH_USERS_PAGE_SIZE) {
      reachedEnd = true
      break
    }
  }

  if (!reachedEnd) {
    console.error("Limite de paginação da lista administrativa foi atingido.")
    return jsonResponse(
      { error: "A lista de usuários excede o limite de consulta seguro." },
      413,
    )
  }

  const userIds = authUsers.map((user) => user.id)
  const profiles: Array<{
    id: string
    username: string
    name: string
    role: string
  }> = []

  // Consulta em lotes para não produzir um filtro .in() excessivamente grande.
  for (let start = 0; start < userIds.length; start += PROFILE_LOOKUP_CHUNK_SIZE) {
    const userIdChunk = userIds.slice(start, start + PROFILE_LOOKUP_CHUNK_SIZE)
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, name, role")
      .in("id", userIdChunk)

    if (error) {
      console.error("Erro ao consultar perfis administrativos:", error)
      return jsonResponse(
        { error: "Não foi possível carregar os perfis dos usuários." },
        500,
      )
    }

    profiles.push(...(data ?? []))
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const users = authUsers
    .map((user) => {
      const profile = profileById.get(user.id)
      if (!profile) return null

      return {
        id: user.id,
        email: user.email ?? "",
        username: profile.username,
        name: profile.name,
        role: profile.role,
      }
    })
    .filter((user) => user !== null)

  return jsonResponse({ users })
}

async function createUser(
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  body: Record<string, unknown>,
) {
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : ""
  const username = typeof body.username === "string"
    ? body.username.trim().toLowerCase()
    : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""
  const password = typeof body.password === "string" ? body.password : ""
  const role = typeof body.role === "string" ? body.role.trim() : ""

  if (!email || !username || !name || !password || !role) {
    return jsonResponse(
      { error: "E-mail, login, nome, senha e perfil são obrigatórios." },
      400,
    )
  }

  if (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Informe um e-mail válido." }, 400)
  }

  if (
    username.length < 3 ||
    username.length > MAX_USERNAME_LENGTH ||
    !/^[a-z0-9._-]+$/.test(username)
  ) {
    return jsonResponse(
      {
        error:
          "O login deve ter entre 3 e 64 caracteres e conter apenas letras, números, ponto, hífen ou sublinhado.",
      },
      400,
    )
  }

  if (name.length > MAX_NAME_LENGTH) {
    return jsonResponse({ error: "O nome excede o tamanho permitido." }, 400)
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return jsonResponse({ error: "A senha excede o tamanho permitido." }, 400)
  }

  const allowedRoles = [
    "administrador",
    "lideranca",
    "apoio",
    "producao",
    "visualizador",
  ]

  if (!allowedRoles.includes(role)) {
    return jsonResponse({ error: "Perfil inválido." }, 400)
  }

  // Escape caracteres de padrão SQL para comparar o login literalmente.
  const usernamePattern = username.replace(/[\\%_]/g, "\\$&")
  const { data: existingProfiles, error: existingProfileError } =
    await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", usernamePattern)
      .limit(1)

  if (existingProfileError) {
    console.error("Erro ao verificar login:", existingProfileError)
    return jsonResponse(
      { error: "Não foi possível validar o login informado." },
      500,
    )
  }

  if (existingProfiles && existingProfiles.length > 0) {
    return jsonResponse({ error: "Login de usuário já cadastrado." }, 409)
  }

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

  if (authError || !authData.user) {
    console.error("Erro ao criar conta no Auth:", authError)
    return jsonResponse(
      { error: "Não foi possível criar a conta. Verifique o e-mail e a senha." },
      400,
    )
  }

  const userId = authData.user.id
  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .insert({ id: userId, username, name, role })

  if (profileError) {
    const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (rollbackError) {
      console.error("Falha ao desfazer criação da conta Auth:", rollbackError)
    }
    console.error("Erro ao criar perfil:", profileError)

    if (profileError.code === "23505") {
      return jsonResponse({ error: "Login de usuário já cadastrado." }, 409)
    }

    return jsonResponse(
      { error: "A conta não pôde ser concluída; a operação foi cancelada." },
      500,
    )
  }

  return jsonResponse(
    {
      user: {
        id: userId,
        email,
        username,
        name,
        role,
      },
    },
    201,
  )
}

async function deleteUser(
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  body: Record<string, unknown>,
  currentUserId: string,
) {
  const requestedId = typeof body.id === "string" ? body.id.trim() : ""
  const requestedUsername = typeof body.username === "string"
    ? body.username.trim()
    : ""

  if (Boolean(requestedId) === Boolean(requestedUsername)) {
    return jsonResponse(
      { error: "Informe somente o ID ou o login do usuário a excluir." },
      400,
    )
  }

  let profileQuery = supabaseAdmin
    .from("profiles")
    .select("id, username, role")

  profileQuery = requestedId
    ? profileQuery.eq("id", requestedId)
    : profileQuery.eq("username", requestedUsername)

  const { data: targetProfile, error: profileError } = await profileQuery.maybeSingle()

  if (profileError) {
    console.error("Erro ao localizar perfil para exclusão:", profileError)
    return jsonResponse({ error: "Não foi possível localizar o usuário." }, 500)
  }

  if (!targetProfile) {
    return jsonResponse({ error: "Usuário não encontrado." }, 404)
  }

  const targetUserId = targetProfile.id
  const normalizedTargetUsername = targetProfile.username.trim().toLowerCase()

  if (targetUserId === currentUserId) {
    return jsonResponse(
      { error: "O administrador conectado não pode excluir a própria conta." },
      400,
    )
  }

  // A conta administrativa principal precisa continuar protegida no servidor,
  // mesmo que alguém chame a função diretamente sem passar pela interface.
  if (normalizedTargetUsername === "adm") {
    return jsonResponse(
      { error: "A conta administrativa principal é protegida." },
      400,
    )
  }

  if (targetProfile.role === "administrador") {
    const { count, error: adminCountError } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "administrador")

    if (adminCountError) {
      console.error("Erro ao verificar administradores restantes:", adminCountError)
      return jsonResponse(
        { error: "Não foi possível verificar os administradores restantes." },
        500,
      )
    }

    if ((count ?? 0) <= 1) {
      return jsonResponse(
        { error: "Não é permitido excluir o último administrador." },
        400,
      )
    }
  }

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId)

  if (deleteError) {
    console.error("Erro ao excluir usuário Auth:", deleteError)
    return jsonResponse({ error: "Não foi possível excluir o usuário." }, 400)
  }

  return jsonResponse({ success: true })
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders })
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405)
  }

  try {
    // Authenticate before parsing user-controlled JSON to reject unauthenticated
    // requests as early as possible.
    const auth = await authenticateAdministrator(request)

    if ("error" in auth) {
      return auth.error
    }

    const { supabaseAdmin, user } = auth
    let parsedBody: unknown
    try {
      parsedBody = await request.json()
    } catch {
      return jsonResponse({ error: "Corpo da requisição inválido." }, 400)
    }

    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return jsonResponse({ error: "Corpo da requisição inválido." }, 400)
    }

    const body = parsedBody as Record<string, unknown>

    switch (body.operation) {
      case "list":
        return await listUsers(supabaseAdmin)
      case "create":
        return await createUser(supabaseAdmin, body)
      case "delete":
        return await deleteUser(supabaseAdmin, body, user.id)
      default:
        return jsonResponse({ error: "Operação inválida." }, 400)
    }
  } catch (error) {
    console.error("Erro inesperado em admin-users:", error)
    return jsonResponse({ error: "Erro interno ao processar a operação." }, 500)
  }
})
