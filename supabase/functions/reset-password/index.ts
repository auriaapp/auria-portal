// ============================================================================
//  reset-password — "Esqueci minha senha" (via Resend, mesmo padrão dos
//  outros e-mails do Auria: invite-analista, invite-projetista, send-welcome-email)
//  ----------------------------------------------------------------------------
//  POR QUE NÃO sb.auth.resetPasswordForEmail() direto do cliente: aquele
//  método usa o envio de e-mail NATIVO do Supabase (SMTP do projeto), que no
//  plano gratuito tem limite muito baixo (poucos e-mails/hora) e pode
//  demorar/falhar sem aviso claro. Aqui, como em todo o resto do Auria, o
//  link é gerado com o service role e o e-mail sai pelo Resend — rápido,
//  confiável, e com a marca do Auria (não o template genérico do Supabase).
//
//  Anti-enumeração: SEMPRE devolve {success:true}, exista ou não o e-mail —
//  só dispara o envio de fato quando o generateLink funciona.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") || "Auria <convites@auria.solutions>";
const ATIVAR_URL     = Deno.env.get("INVITE_REDIRECT") || "https://auria.solutions/ativar_conta.html";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { email } = await req.json().catch(() => ({}));
    if (!email || typeof email !== "string") return j({ error: "e-mail obrigatório" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    // Gera o link de recovery. Se o e-mail não tiver conta, generateLink FALHA
    // ("User not found") — aí não enviamos nada, mas respondemos success:true
    // do mesmo jeito (não revela se a conta existe).
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: ATIVAR_URL },
    });
    if (linkErr || !linkData) {
      console.log("reset-password: generateLink falhou (provável e-mail inexistente):", String(linkErr));
      return j({ success: true });
    }

    const hashed = linkData?.properties?.hashed_token;
    const actionLink = hashed
      ? `${ATIVAR_URL}?token_hash=${hashed}&type=recovery`
      : linkData?.properties?.action_link;
    if (!actionLink) { console.error("reset-password: sem action_link"); return j({ success: true }); }

    const nome = (linkData?.user?.user_metadata as { nome?: string } | undefined)?.nome || "";

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:auto;color:#1A2F4A;padding:8px">
        <div style="text-align:center;margin-bottom:22px">
          <img src="https://auria.solutions/logo_full.png" alt="Auria" width="170" style="max-width:170px;height:auto;display:inline-block">
        </div>
        <p style="font-size:12px;letter-spacing:.08em;color:#94A3B8;text-transform:uppercase;margin:0 0 6px">Redefinição de senha</p>
        <h2 style="color:#1A2F4A;font-size:19px;margin:0 0 12px">Redefina sua senha no Auria</h2>
        <p style="font-size:14px;color:#475569;line-height:1.6">Olá${nome ? " " + escapeHtml(nome) : ""}, recebemos um pedido para redefinir a senha da sua conta. Se não foi você, pode ignorar este e-mail com segurança — sua senha não será alterada.</p>
        <p style="text-align:center;margin:28px 0 10px">
          <a href="${actionLink}" style="background:#E8960A;color:#ffffff;padding:14px 32px;border-radius:8px;
             text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">
            Definir nova senha
          </a>
        </p>
        <p style="text-align:center;font-size:12px;color:#94A3B8;margin:0 0 22px">O link é válido por 1 hora.</p>
        <p style="font-size:12px;color:#64748B;line-height:1.6">
          Se o botão acima não funcionar, copie e cole este endereço no navegador:<br>
          <a href="${actionLink}" style="color:#1D4ED8;word-break:break-all">${actionLink}</a>
        </p>
        <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0">
        <p style="font-size:11px;color:#94A3B8">Auria</p>
      </div>`;

    const text = `Redefinição de senha — Auria

Olá${nome ? " " + nome : ""}, recebemos um pedido para redefinir a senha da sua conta.
Se não foi você, ignore este e-mail — sua senha não será alterada.

Para definir uma nova senha, acesse:
${actionLink}

O link é válido por 1 hora.

Auria
https://auria.solutions`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        reply_to: "contato@auria.solutions",
        to: [email],
        subject: "Auria — Redefinição de senha",
        html, text,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("reset-password: Resend falhou:", resp.status, t);
      // Não vaza detalhe do provedor de e-mail pro cliente — só loga.
      return j({ success: true });
    }

    return j({ success: true });
  } catch (err) {
    console.error("[reset-password] Erro:", String(err));
    // Mesmo em erro inesperado, não revela nada específico ao cliente.
    return j({ success: true });
  }
});
