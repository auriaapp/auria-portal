import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL       = Deno.env.get("FROM_EMAIL") || "Auria <convites@auria.solutions>";
const DEFAULT_REDIRECT = Deno.env.get("INVITE_REDIRECT") ||
  "https://auria.solutions/ativar_conta.html";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// listUsers() devolve SÓ a primeira página (perPage padrão = 50). Procurar
// apenas nela faz o convite concluir "não existe" para quem existe — e aí o
// generateLink falha com "email already registered". Percorre as páginas até
// achar ou esgotar. (Mesma abordagem do invite-obra.)
async function acharUsuarioPorEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<{ id: string; email?: string; last_sign_in_at?: string | null } | null> {
  const alvo = String(email).toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const achou = users.find(
      (u: { email?: string }) => (u.email || "").toLowerCase() === alvo,
    );
    if (achou) return achou as { id: string; email?: string; last_sign_in_at?: string | null };
    if (users.length < perPage) return null;   // era a última página
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Quem chama precisa ser analista, gerente ou super_admin
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: cu } = await caller.auth.getUser();
    if (!cu?.user) return j({ error: "não autenticado" }, 401);
    const { data: cprof } = await admin.from("usuarios_auria").select("role").eq("id", cu.user.id).single();
    if (!cprof || !["analista", "gerente", "super_admin"].includes(cprof.role)) return j({ error: "sem permissão" }, 403);

    const { email, nome, redirect_to, empresa_nome } = await req.json();
    if (!email) return j({ error: "email obrigatório" }, 400);

    // CONVIDADO NÃO É CADASTRADO.
    //  generateLink cria a conta no auth NA HORA do primeiro convite. Como este
    //  trecho só olhava "existe usuário com este e-mail?", toda segunda tentativa
    //  respondia "já está cadastrado" e NÃO reenviava nada — mesmo com a pessoa
    //  nunca tendo aberto o link. Era o relato: link vencido em 24h, e reenviar
    //  impossível. (2026-09-25)
    //
    //  O que separa os dois casos é last_sign_in_at:
    //    · nulo        → convidado que nunca entrou  → gera link novo e REENVIA
    //    · preenchido  → conta de verdade, em uso    → não mexe; manda recuperar senha
    const existente = await acharUsuarioPorEmail(admin, email);
    const nuncaEntrou = !!existente && !existente.last_sign_in_at;
    if (existente && !nuncaEntrou) {
      return j({
        success: true, ja_existia: true, ativo: true,
        aviso: "Este e-mail já tem conta ativa no Auria — ele deve entrar normalmente ou usar 'Esqueci minha senha'.",
      });
    }
    const reenvio = nuncaEntrou;

    // 1. Gera o link. Para quem nunca entrou, é um convite NOVO para o mesmo
    //    usuário — o link antigo deixa de valer, que é o comportamento desejado.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { nome: nome || "", role: "projetista" },
        redirectTo: redirect_to || DEFAULT_REDIRECT,
      },
    });
    if (linkErr) throw linkErr;
    // Link NO NOSSO DOMÍNIO (token_hash) — remetente e link no mesmo domínio evitam
    // que filtros corporativos (Microsoft 365) tratem o convite como phishing.
    // Cai no action_link do Supabase só se o hashed_token não vier.
    const _base = redirect_to || DEFAULT_REDIRECT;
    const _hashed = linkData?.properties?.hashed_token;
    // Item 141: o link que vai no e-mail é o NOSSO, com validade de 5 dias.
    // O token do Supabase (hashed_token acima) NÃO é usado aqui — ele nasce só
    // no resgate, em convite-resgatar. Assim o convite dura 5 dias sem precisar
    // subir o "Email OTP expiration" do projeto, que é global e governa também
    // o link de RECUPERAÇÃO DE SENHA.
    const _tk = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    await admin.from("convite_token_auria").insert({
      token: _tk, email, nome: nome || null, papel: "projetista",
      user_id: linkData?.user?.id ?? existente?.id ?? null, empresa_nome: empresa_nome || null, criado_por: cu?.user?.id ?? null,
    });
    const actionLink = `${_base}?convite=${_tk}`;

    // Perfil do convidado (service role ignora RLS).
    const newUserId = linkData?.user?.id || existente?.id;
    if (newUserId) {
      await admin.from("usuarios_auria").upsert({
        id: newUserId, email, nome: nome || "", role: "projetista", ativo: true,
      }, { onConflict: "id" });
    }

    // 2. Envia o e-mail pelo Resend (domínio verificado → não cai em spam).
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:auto;color:#1A2F4A;padding:8px">
        <div style="text-align:center;margin-bottom:22px">
          <img src="https://auria.solutions/logo_full.png" alt="Auria"
               width="170" style="max-width:170px;height:auto;display:inline-block">
        </div>
        <p style="font-size:12px;letter-spacing:.08em;color:#94A3B8;text-transform:uppercase;margin:0 0 6px">Bem-vindo à Auria</p>
        <h2 style="color:#1A2F4A;font-size:20px;margin:0 0 12px">Você foi convidado(a) como projetista</h2>
        <p style="line-height:1.6">Olá${nome ? " " + nome : ""}, ${empresa_nome ? "a equipe da <b>" + empresa_nome + "</b>" : "a equipe de coordenação"}
        convidou você para acompanhar seus <b>contratos, faturas e apontamentos</b> no <b>Painel do Projetista</b> do Auria.</p>
        <p style="text-align:center;margin:28px 0 10px">
          <a href="${actionLink}"
             style="background:#E8960A;color:#ffffff;padding:14px 32px;border-radius:8px;
                    text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">
            Definir minha senha e acessar
          </a>
        </p>
        <p style="text-align:center;font-size:12px;color:#94A3B8;margin:0 0 22px">O link é válido por 24 horas.</p>
        <p style="font-size:12px;color:#64748B;line-height:1.6">
          Se o botão acima não funcionar, copie e cole este endereço no navegador:<br>
          <a href="${actionLink}" style="color:#1D4ED8;word-break:break-all">${actionLink}</a>
        </p>
        <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0">
        <p style="font-size:11px;color:#94A3B8">Auria — Coordenação de Projetos</p>
      </div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL, reply_to: "contato@auria.solutions", to: [email],
        subject: "Convite para o Auria — Painel do Projetista", html,
        // Versão texto: e-mail só-HTML pontua pior nos filtros corporativos.
        text: `Olá${nome ? " " + nome : ""},

${empresa_nome ? "A equipe da " + empresa_nome : "A equipe de coordenação"} convidou você para acompanhar seus contratos, faturas e apontamentos no Painel do Projetista do Auria.

Para definir sua senha e acessar, acesse:
${actionLink}

O link é válido por 24 horas.

Auria — Coordenação de Projetos
https://auria.solutions`,
      }),
    });
    if (!resp.ok) throw new Error("Falha no envio (Resend): " + (await resp.text()));

    return j({ success: true, reenvio, user_id: newUserId });
  } catch (err) {
    console.error("[invite-projetista]", String(err));
    return j({ error: String(err) }, 500);
  }
});
