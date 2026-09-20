import { createClient } from "@supabase/supabase-js"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  })
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return null
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
    return {
      error: jsonResponse({ error: "Não autenticado." }, 401),
    }
  }

  const supabaseAdmin = getAdminClient()

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token)

  if (userError || !user) {
    return {
      error: jsonResponse({ error: "Sessão inválida." }, 401),
    }
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, username, name, role")
    .eq("id", user.id)
    .maybeSingle()

  if (profileError) {
    console.error("Erro ao consultar perfil:", profileError)
    return {
      error: jsonResponse({ error: "Não foi possível validar o perfil." }, 500),
    }
  }

  if (!profile || profile.role !== "administrador") {
    return {
      error: jsonResponse({ error: "Acesso não autorizado." }, 403),
    }
  }

  return { supabaseAdmin, user, profile }
}

async function listUsers(supabaseAdmin: ReturnType<typeof getAdminClient>) {
  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })

  if (authError) {
    console.error("Erro ao listar usuários Auth:", authError)
    return jsonResponse({ error: authError.message }, 500)
  }

  const userIds = authData.users.map((user) => user.id)

  let profiles: Array<{
    id: string
    username: string
    name: string
    role: string
  }> = []

  if (userIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, name, role")
      .in("id", userIds)

    if (error) {
      console.error("Erro ao listar profiles:", error)
      return jsonResponse({ error: error.message }, 500)
    }

    profiles = data ?? []
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))

  const users = authData.users
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
    .filter(Boolean)

  return jsonResponse({ users })
}

async function createUser(
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  body: {
    email?: string
    username?: string
    name?: string
    password?: string
    role?: string
  },
) {
  const email = body.email?.trim()
  const username = body.username?.trim()
  const name = body.name?.trim()
  const password = body.password
  const role = body.role?.trim()

  if (!email || !username || !name || !password || !role) {
    return jsonResponse(
      { error: "E-mail, login, nome, senha e perfil são obrigatórios." },
      400,
    )
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

  const { data: existingProfile, error: existingProfileError } =
    await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle()

  if (existingProfileError) {
    console.error("Erro ao verificar login:", existingProfileError)
    return jsonResponse({ error: existingProfileError.message }, 500)
  }

  if (existingProfile) {
    return jsonResponse({ error: "Login de usuário já cadastrado." }, 409)
  }

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

  if (authError || !authData.user) {
    return jsonResponse(
      { error: authError?.message ?? "Não foi possível criar o usuário." },
      400,
    )
  }

  const userId = authData.user.id

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .insert({
      id: userId,
      username,
      name,
      role,
    })

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(userId)
    console.error("Erro ao criar profile:", profileError)
    return jsonResponse(
      { error: "Usuário Auth criado, mas o perfil não pôde ser criado." },
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
  body: { id?: string; username?: string },
  currentUserId: string,
) {
  let targetUserId = body.id?.trim()

  // O frontend atual envia o username. O backend resolve o UUID
  // internamente para manter o service/secret key fora do navegador.
  if (!targetUserId && body.username?.trim()) {
    const username = body.username.trim()

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle()

    if (profileError) {
      console.error("Erro ao localizar usuário para exclusão:", profileError)
      return jsonResponse({ error: profileError.message }, 500)
    }

    if (!profile) {
      return jsonResponse({ error: "Usuário não encontrado." }, 404)
    }

    targetUserId = profile.id
  }

  if (!targetUserId) {
    return jsonResponse(
      { error: "ID ou login do usuário é obrigatório." },
      400,
    )
  }

  if (targetUserId === currentUserId) {
    return jsonResponse(
      {
        error:
          "O usuário administrador atual não pode excluir a própria conta.",
      },
      400,
    )
  }

  const { error: deleteError } =
    await supabaseAdmin.auth.admin.deleteUser(targetUserId)

  if (deleteError) {
    console.error("Erro ao excluir usuário Auth:", deleteError)
    return jsonResponse({ error: deleteError.message }, 400)
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
    const auth = await authenticateAdministrator(request)

    if ("error" in auth) {
      return auth.error
    }

    const { supabaseAdmin, user } = auth
    const body = await request.json()
    const operation = body?.operation

    switch (operation) {
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
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro interno." },
      500,
    )
  }
})
