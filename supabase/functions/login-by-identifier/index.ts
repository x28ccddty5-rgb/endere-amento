import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withSupabase } from "@supabase/server";

type LoginBody = {
  identifier?: unknown;
  password?: unknown;
};

const MAX_IDENTIFIER_LENGTH = 100;
const MAX_PASSWORD_LENGTH = 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/**
 * Escapa caracteres especiais de LIKE/ILIKE para que o identificador
 * seja tratado como texto literal, e não como um padrão fornecido pelo cliente.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Método não permitido." }, 405);
    }

    let body: LoginBody;

    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Requisição inválida." }, 400);
    }

    const identifier =
      typeof body.identifier === "string" ? body.identifier.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!identifier || !password) {
      return jsonResponse(
        { error: "Informe o usuário/e-mail e a senha." },
        400,
      );
    }

    // Evita entradas excessivas e caracteres de controle em identificadores.
    if (
      identifier.length > MAX_IDENTIFIER_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH ||
      /[\u0000-\u001F\u007F]/.test(identifier)
    ) {
      return jsonResponse(
        { error: "Usuário ou senha incorretos." },
        401,
      );
    }

    const normalizedIdentifier = identifier.toLowerCase();
    const pattern = escapeLikePattern(normalizedIdentifier);

    // Busca username isoladamente. Não interpolar entrada do usuário em .or().
    const { data: usernameMatches, error: usernameError } =
      await ctx.supabaseAdmin
        .from("profiles")
        .select("id,username,name,role")
        .ilike("username", pattern)
        .limit(2);

    if (usernameError) {
      console.error("Erro ao localizar perfil por login:", usernameError);
      return jsonResponse(
        { error: "Não foi possível concluir a autenticação." },
        500,
      );
    }

    let profile: {
      id: string;
      username: string;
      name: string;
      role: string;
    } | null = null;

    if (usernameMatches?.length === 1) {
      profile = usernameMatches[0];
    } else if (usernameMatches?.length === 0) {
      // Só procura pelo nome se não houve username correspondente.
      const { data: nameMatches, error: nameError } = await ctx.supabaseAdmin
        .from("profiles")
        .select("id,username,name,role")
        .ilike("name", pattern)
        .limit(2);

      if (nameError) {
        console.error("Erro ao localizar perfil por nome:", nameError);
        return jsonResponse(
          { error: "Não foi possível concluir a autenticação." },
          500,
        );
      }

      // Nome só serve como identificador se corresponder a um único perfil.
      if (nameMatches?.length === 1) {
        profile = nameMatches[0];
      }
    }

    // Não revela se o identificador existe nem se o nome é ambíguo.
    if (!profile) {
      return jsonResponse({ error: "Usuário ou senha incorretos." }, 401);
    }

    const { data: authUserData, error: authUserError } =
      await ctx.supabaseAdmin.auth.admin.getUserById(profile.id);

    if (authUserError || !authUserData.user?.email) {
      console.error("Erro ao localizar conta de autenticação:", authUserError);
      return jsonResponse(
        { error: "Não foi possível concluir a autenticação." },
        500,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");

    if (!supabaseUrl || !publishableKeysRaw) {
      console.error("Configuração pública do Supabase não está disponível.");
      return jsonResponse(
        { error: "Configuração de autenticação indisponível." },
        500,
      );
    }

    let publishableKeys: Record<string, string>;

    try {
      publishableKeys = JSON.parse(publishableKeysRaw);
    } catch (error) {
      console.error("SUPABASE_PUBLISHABLE_KEYS inválido:", error);
      return jsonResponse(
        { error: "Configuração de autenticação inválida." },
        500,
      );
    }

    const publishableKey = publishableKeys.default;

    if (!publishableKey) {
      console.error("Chave publishable padrão não encontrada.");
      return jsonResponse(
        { error: "Configuração de autenticação indisponível." },
        500,
      );
    }

    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data: authData, error: authError } =
      await authClient.auth.signInWithPassword({
        email: authUserData.user.email,
        password,
      });

    if (authError || !authData.session || !authData.user) {
      if (authError?.status === 429) {
        return jsonResponse(
          { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
          429,
        );
      }

      return jsonResponse({ error: "Usuário ou senha incorretos." }, 401);
    }

    return jsonResponse(
      {
        session: authData.session,
        user: {
          id: profile.id,
          username: profile.username,
          name: profile.name,
          role: profile.role,
        },
      },
      200,
    );
  }),
};
