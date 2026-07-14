// ============================================================================
//  groq-proxy — proxy autenticado para a API da Groq (Llama 4, com visão).
//  A chave GROQ_API_KEY fica como SECRET do Supabase e NUNCA vai ao browser.
//  O cliente manda { messages, hasImage?, temperature?, max_tokens? } com o JWT
//  do usuário no header Authorization; a função valida o login e encaminha.
//
//  Deploy:   supabase functions deploy groq-proxy
//  Secret:   supabase secrets set GROQ_API_KEY=gsk_xxx
//            (ou no painel: Edge Functions → Secrets)
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!;
const GROQ_API_KEY  = Deno.env.get("GROQ_API_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!GROQ_API_KEY) return json({ error: "GROQ_API_KEY não configurada no Supabase." }, 500);

    // 1) Exige usuário autenticado (qualquer papel logado do Auria).
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Não autenticado." }, 401);

    // 2) Corpo: array de mensagens (system + histórico + turno atual) + flags.
    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages) ? body.messages : null;
    if (!messages || !messages.length) return json({ error: "messages ausente." }, 400);
    const hasImage    = !!body?.hasImage;
    const temperature = typeof body?.temperature === "number" ? body.temperature : 0.2;
    const max_tokens  = typeof body?.max_tokens === "number" ? body.max_tokens : 800;

    // 3) Modelos (com visão quando há imagem) + fallback.
    const models = hasImage
      ? ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"]
      : ["meta-llama/llama-4-scout-17b-16e-instruct", "llama-3.1-8b-instant", "llama3-8b-8192"];

    let ultimoErro = "Nenhum modelo disponível";
    for (const model of models) {
      try {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, temperature, max_tokens }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data?.choices?.length) {
          return json({ content: (data.choices[0].message?.content || "").trim(), model });
        }
        ultimoErro = data?.error?.message || `HTTP ${r.status}`;
        if (r.status !== 429 && r.status !== 503) break;   // erro não-transitório → não tenta outros
      } catch (e) {
        ultimoErro = String(e);
      }
    }
    return json({ error: "IA indisponível: " + ultimoErro }, 502);

  } catch (err) {
    console.error("[groq-proxy]", String(err));
    return json({ error: String(err) }, 500);
  }
});
