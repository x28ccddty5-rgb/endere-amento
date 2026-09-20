import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withSupabase } from "@supabase/server";

type LoginBody = {
  identifier?: string;
  password?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return Response.json(
        { error: "Método não permitido." },
        { status: 405, headers: corsHeaders },
      );
    }

    let body: LoginBody;

    try {
      body = await req.json();
    } catch {
      return Response.json(
        { error: "Requisição inválida." },
        { status: 400, headers: corsHeaders },
      );
    }

    const identifier = body.identifier?.trim();
    const password = body.password;

    if (!identifier || !password) {
      return Response.json(
        { error: "Informe o usuário/e-mail e a senha." },
        { status: 400, headers: corsHeaders },
      );
    }

    const normalizedIdentifier = identifier.toLowerCase();

    const { data: profiles, error: profileError } = await ctx.supabaseAdmin
      .from("profiles")
      .select("id,username,name,role")
      .or(
        `username.ilike.${normalizedIdentifier},name.ilike.${normalizedIdentifier}`,
      )
      .limit(2);

    if (profileError) {
      console.error("Erro ao localizar perfil:", profileError);

      return Response.json(
        { error: "Não foi possível localizar o usuário." },
        { status: 500, headers: corsHeaders },
      );
    }

    if (!profiles || profiles.length === 0) {
      return Response.json(
        { error: "Usuário ou senha incorretos." },
        { status: 401, headers: corsHeaders },
      );
    }

    if (profiles.length > 1) {
      return Response.json(
        { error: "O identificador informado corresponde a mais de um usuário." },
        { status: 409, headers: corsHeaders },
      );
    }

    const profile = profiles[0];

    const { data: authUserData, error: authUserError } =
      await ctx.supabaseAdmin.auth.admin.getUserById(profile.id);

    if (authUserError || !authUserData.user?.email) {
      console.error("Erro ao localizar usuário do Auth:", authUserError);

      return Response.json(
        { error: "Não foi possível localizar a conta de autenticação." },
        { status: 500, headers: corsHeaders },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");

    if (!supabaseUrl || !publishableKeysRaw) {
      console.error("Configuração pública do Supabase não está disponível.");

      return Response.json(
        { error: "Configuração de autenticação indisponível." },
        { status: 500, headers: corsHeaders },
      );
    }

    let publishableKeys: Record<string, string>;

    try {
      publishableKeys = JSON.parse(publishableKeysRaw);
    } catch (error) {
      console.error("SUPABASE_PUBLISHABLE_KEYS inválido:", error);

      return Response.json(
        { error: "Configuração de autenticação inválida." },
        { status: 500, headers: corsHeaders },
      );
    }

    const publishableKey = publishableKeys.default;

    if (!publishableKey) {
      console.error("Chave publishable padrão não encontrada.");

      return Response.json(
        { error: "Configuração de autenticação indisponível." },
        { status: 500, headers: corsHeaders },
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
      return Response.json(
        { error: "Usuário ou senha incorretos." },
        { status: 401, headers: corsHeaders },
      );
    }

    return Response.json(
      {
        session: authData.session,
        user: {
          id: profile.id,
          username: profile.username,
          name: profile.name,
          role: profile.role,
        },
      },
      { status: 200, headers: corsHeaders },
    );
  }),
};
