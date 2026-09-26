import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY")!;
// Remetente verificado no Resend (ajuste para o seu domínio verificado)
const FROM_EMAIL       = Deno.env.get("FROM_EMAIL") || "Auria <convites@auria.solutions>";
const DEFAULT_REDIRECT = Deno.env.get("INVITE_REDIRECT") ||
  "https://auria.solutions/ativar_conta.html";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Item 141: o e-mail leva o token; o banco guarda só o SHA-256 dele. Se a
// tabela vazar (backup, chave de serviço exposta), o que sai de lá não abre
// conta nenhuma — é o mesmo princípio do "hashed_token" do Supabase.
async function criarConviteToken(
  admin: ReturnType<typeof createClient>,
  dados: { email: string; nome?: string; papel: string; user_id?: string | null;
           empresa_nome?: string | null; criado_por?: string | null },
): Promise<string> {
  const bruto = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bruto));
  const sha = Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  await admin.from("convite_token_auria").insert({
    token_sha: sha, email: dados.email, nome: dados.nome || null, papel: dados.papel,
    user_id: dados.user_id ?? null, empresa_nome: dados.empresa_nome ?? null,
    criado_por: dados.criado_por ?? null,
  });
  return bruto;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { email, nome, empresa_id, redirect_to } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "email obrigatório" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Gera o link de convite (cria o usuário em estado "convidado").
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { nome: nome || "", empresa_id: empresa_id || null, role: "analista" },
        redirectTo: redirect_to || DEFAULT_REDIRECT,
      },
    });
    if (linkErr) throw linkErr;
    // Link NO NOSSO DOMÍNIO (token_hash) — remetente e link no mesmo domínio evitam
    // que filtros corporativos (Microsoft 365) tratem o convite como phishing.
    // Cai no action_link do Supabase só se o hashed_token não vier.
    const _base = redirect_to || DEFAULT_REDIRECT;
    const _hashed = linkData?.properties?.hashed_token;
    // Item 141: link NOSSO, 5 dias. O hashed_token acima não vai no e-mail.
    const _tk = await criarConviteToken(admin, { email, nome, papel: "analista",
      user_id: linkData?.user?.id ?? null, empresa_nome: null,
      criado_por: null });
    const actionLink = `${_base}?convite=${_tk}`;

    // Garante o perfil do convidado já com role/empresa (service role ignora RLS).
    const newUserId = linkData?.user?.id;
    if (newUserId) {
      await admin.from("usuarios_auria").upsert({
        id: newUserId, email, nome: nome || "",
        role: "analista", empresa_id: empresa_id || null, ativo: true,
      }, { onConflict: "id" });
    }

    // 2. Envia o e-mail pelo Resend (entrega confiável).
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:auto;color:#1A2F4A">
        <div style="text-align:center;margin-bottom:22px">
          <img src="https://auria.solutions/logo_full.png" alt="Auria"
               width="170" style="max-width:170px;height:auto;display:inline-block">
        </div>
        <h2 style="color:#1A2F4A;font-size:18px">Você foi convidado(a) para o Auria</h2>
        <p>Olá${nome ? " " + nome : ""}, você foi convidado(a) para participar da
        coordenação de projetos no <b>Auria</b> como analista.</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${actionLink}" style="background:#E8960A;color:#fff;padding:13px 30px;
             border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
             Ativar minha conta</a>
        </p>
        <p style="font-size:12px;color:#64748B">Se o botão não funcionar, copie e cole este
        link no navegador:<br><span style="word-break:break-all">${actionLink}</span></p>
        <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0">
        <p style="font-size:12px;color:#94A3B8">Auria — Coordenação de Projetos</p>
      </div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        reply_to: "contato@auria.solutions",
        to: [email],
        subject: "Convite para o Auria — Coordenação de Projetos",
        html,
        // Versão texto: e-mail só-HTML pontua pior nos filtros corporativos.
        text: `Olá${nome ? " " + nome : ""},

Você foi convidado(a) para participar da coordenação de projetos no Auria como analista.

Para ativar sua conta, acesse:
${actionLink}

Auria — Coordenação de Projetos
https://auria.solutions`,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error("Falha no envio (Resend): " + t);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS },
    });

  } catch (err) {
    console.error("[invite-analista] Erro:", String(err));
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
