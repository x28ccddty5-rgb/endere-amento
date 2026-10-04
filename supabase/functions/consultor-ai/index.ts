import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

type ConsultorBody = {
  question?: string;
  deterministicResponse?: string;
  context?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_CONTEXT_CHARS = 9000;
const MAX_QUESTION_CHARS = 1000;
const MAX_RESPONSE_CHARS = 4000;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Método não permitido." }, 405);
    }

    const userId = ctx.userClaims?.id;
    if (!userId) {
      return jsonResponse({ error: "Usuário não autenticado." }, 401);
    }

    let body: ConsultorBody;

    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Requisição inválida." }, 400);
    }

    const question = body.question?.trim().slice(0, MAX_QUESTION_CHARS);
    const deterministicResponse = body.deterministicResponse
      ?.trim()
      .slice(0, MAX_RESPONSE_CHARS);
    const context = body.context?.trim().slice(0, MAX_CONTEXT_CHARS);

    if (!question) {
      return jsonResponse({ error: "A pergunta é obrigatória." }, 400);
    }

    if (!context) {
      return jsonResponse({ error: "O contexto do Consultor é obrigatório." }, 400);
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      console.error("GEMINI_API_KEY não configurada.");
      return jsonResponse(
        { error: "A IA do Consultor ainda não está configurada." },
        503,
      );
    }

    const model = Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;

    const prompt = `
Você é o Consultor IA do sistema de estoque da Porto Brasil.

Sua função é interpretar a pergunta do operador e explicar os dados reais fornecidos pelo sistema.

REGRAS OBRIGATÓRIAS:
- Use somente os fatos presentes no CONTEXTO.
- Nunca invente SKU, saldo, posição, quantidade, data, divergência ou movimentação.
- Não altere nem sugira alteração direta no banco.
- Não trate uma hipótese como fato.
- Se os dados não forem suficientes para responder, diga claramente que os dados disponíveis não são suficientes.
- Se houver um resultado determinístico, preserve seus fatos e apenas explique, compare ou complemente quando isso for solicitado.
- Não mencione "prompt", "contexto", "modelo", "LLM", "API" ou detalhes internos.
- Responda em português do Brasil.
- Seja objetivo e operacional.
- Não faça mais de uma recomendação principal quando os dados permitirem uma conclusão clara.
- Quando uma recomendação depender de condição física não registrada, deixe essa limitação explícita.
- Para estratégia de estoque, explique a concentração real do SKU, a proximidade dos módulos, a consolidação, a redução de dispersão, a ocupação/capacidade e as restrições. Não transforme a análise em uma opinião genérica.
- Para armazenagem, trate o plano determinístico como fonte de verdade: uma "opção" é um plano completo, não uma única vaga.
- Para armazenagem em gaiola, trate E3 como uma combinação física de 2 paletes E2. As chaves válidas são A+B, C+D e E+F no mesmo módulo. Não invente outras combinações.
- Quando o resultado determinístico apresentar várias opções ou uma distribuição de múltiplos paletes, preserve exatamente as posições, quantidades e combinações fornecidas.
- Se o resultado já apresentar concentração, ranking, plano ou roteiro, explique esses dados em vez de substituí-los por outra estratégia.

PERGUNTA:
${question}

RESULTADO DETERMINÍSTICO EXISTENTE:
${deterministicResponse || "Nenhum resultado determinístico foi produzido."}

CONTEXTO:
${context}
`.trim();

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 500,
          },
        }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        console.error("Erro retornado pelo Gemini:", {
          status: response.status,
          statusText: response.statusText,
          payload,
          userId,
        });

        if (response.status === 429) {
          return jsonResponse(
            { error: "A cota gratuita da IA foi atingida. Tente novamente mais tarde." },
            429,
          );
        }

        return jsonResponse(
          { error: "A IA não pôde processar esta pergunta agora." },
          502,
        );
      }

      const answer = payload?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text || "")
        .join("")
        .trim()
        .slice(0, MAX_RESPONSE_CHARS);

      if (!answer) {
        return jsonResponse(
          { error: "A IA não retornou uma resposta utilizável." },
          502,
        );
      }

      return jsonResponse({
        answer,
        model,
      });
    } catch (error) {
      console.error("Falha na chamada do Gemini:", error);

      if (error instanceof DOMException && error.name === "AbortError") {
        return jsonResponse(
          { error: "A IA demorou mais que o limite permitido." },
          504,
        );
      }

      return jsonResponse(
        { error: "Não foi possível consultar a IA agora." },
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
  }),
};
