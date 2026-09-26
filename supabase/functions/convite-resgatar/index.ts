import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
//  convite-resgatar — item 141 (2026-09-26)
//
//  Troca o NOSSO token de convite (válido 3 dias) por um token do Supabase de
//  uso imediato. É isto que permite dar 3 dias ao convite sem subir o prazo
//  global do projeto — que também governa o link de RECUPERAÇÃO DE SENHA.
//
//  A sequência importa: o link do Supabase só nasce AQUI, no momento em que a
//  pessoa clica. As 24h dele nunca chegam a correr.
//
//  Endpoint público por necessidade (quem abre o convite não tem sessão), mas
//  só faz algo com um token de 32 bytes que ninguém adivinha. Erros são
//  propositalmente genéricos: não dizemos se o e-mail existe nem se o token
//  existe — só que não dá para continuar.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_REDIRECT = Deno.env.get("INVITE_REDIRECT") ||
  "https://auria.solutions/ativar_conta.html";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { token, redirect_to } = await req.json().catch(() => ({}));
    if (!token || String(token).length < 20) return j({ error: "convite_invalido" }, 400);

    // Busca pelo HASH: o token cru nunca é gravado, então nem o banco nem um
    // backup dele servem para abrir conta.
    const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
    const sha = Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data: cv } = await admin.from("convite_token_auria")
      .select("id,email,nome,papel,user_id,expira_em,usado_em,tentativas")
      .eq("token_sha", sha).maybeSingle();

    // Mesma resposta para token inexistente, já usado e vencido: quem está
    // sondando não aprende nada com a diferença.
    if (!cv) return j({ error: "convite_invalido" }, 400);
    await admin.from("convite_token_auria")
      .update({ tentativas: (cv.tentativas || 0) + 1 }).eq("id", cv.id);

    if (cv.usado_em) return j({ error: "convite_usado" }, 400);
    if (new Date(cv.expira_em) < new Date()) return j({ error: "convite_vencido" }, 400);

    // O link do Supabase nasce agora. 'invite' falha se a conta já confirmou;
    // nesse caso 'recovery' resolve (a pessoa define a senha do mesmo jeito).
    const base = redirect_to || DEFAULT_REDIRECT;
    let hashed: string | undefined;
    let tipo: "invite" | "recovery" = "invite";

    const inv = await admin.auth.admin.generateLink({
      type: "invite", email: cv.email, options: { redirectTo: base },
    });
    hashed = inv.data?.properties?.hashed_token;

    if (!hashed) {
      tipo = "recovery";
      const rec = await admin.auth.admin.generateLink({
        type: "recovery", email: cv.email, options: { redirectTo: base },
      });
      hashed = rec.data?.properties?.hashed_token;
    }
    if (!hashed) return j({ error: "nao_foi_possivel" }, 500);

    // Uso único: marcado ANTES de devolver. Se a pessoa fechar a aba agora, o
    // convite já era — melhor que um token reutilizável circulando por e-mail.
    await admin.from("convite_token_auria")
      .update({ usado_em: new Date().toISOString() }).eq("id", cv.id);

    return j({ success: true, token_hash: hashed, type: tipo, email: cv.email, nome: cv.nome });
  } catch (err) {
    console.error("[convite-resgatar]", String(err));
    return j({ error: "nao_foi_possivel" }, 500);
  }
});
