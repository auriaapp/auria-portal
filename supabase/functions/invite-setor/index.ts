import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
//  invite-setor — convida um funcionário INTERNO da construtora. Espelha
//  invite-projetista: mesmo fluxo de generateLink + Resend + link no próprio
//  domínio. O que varia é a role gravada e o texto do e-mail.
//
//  Item 127: passou a atender DOIS papéis, pelo parâmetro `role`:
//    · 'setor'      (padrão) — consulta do CDE; quem chama pode ser analista.
//    · 'financeiro' — administrativo financeiro do grupo (Painel de Custos);
//                     só gestão convida.
//  Sem `role` no corpo, o comportamento é o de antes — nada que já chama esta
//  função precisa mudar.
//
//  O acesso do setor a CADA empreendimento é dado à parte (cde_acesso_auria) e
//  o recorte do financeiro também (financeiro_escopo_auria): o convite só cria
//  a conta. O empresa_id vem do perfil de QUEM CONVIDA — sem ele o usuário não
//  aparece na lista de usuários do grupo.
// ============================================================================

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
): Promise<{ id: string; email?: string } | null> {
  const alvo = String(email).toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const achou = users.find(
      (u: { email?: string }) => (u.email || "").toLowerCase() === alvo,
    );
    if (achou) return achou as { id: string; email?: string };
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
    const { data: cprof } = await admin.from("usuarios_auria").select("role, empresa_id").eq("id", cu.user.id).single();
    if (!cprof || !["analista", "gerente", "super_admin"].includes(cprof.role)) return j({ error: "sem permissão" }, 403);

    const body = await req.json();
    const { email, nome, redirect_to, empresa_nome } = body;
    if (!email) return j({ error: "email obrigatório" }, 400);

    // Papel a criar. Qualquer valor fora da lista cai em 'setor' de propósito:
    // esta função nunca deve virar um caminho para fabricar gerente/analista.
    const role: "setor" | "financeiro" = body.role === "financeiro" ? "financeiro" : "setor";
    if (role === "financeiro" && !["gerente", "super_admin"].includes(cprof.role)) {
      return j({ error: "só a gestão convida o administrativo financeiro" }, 403);
    }
    const grupoId = cprof.empresa_id || null;
    if (!grupoId) return j({ error: "seu usuário não está vinculado a um grupo" }, 400);

    // Já existe conta com esse e-mail? Não recria — só informa (a atribuição ao
    // empreendimento é feita à parte, então uma conta existente é reaproveitada).
    const existente = await acharUsuarioPorEmail(admin, email);
    if (existente) {
      // Não promovemos ninguém em silêncio: devolvemos o papel atual para a
      // tela explicar por que o convite não mudou nada.
      const { data: perfil } = await admin.from("usuarios_auria")
        .select("role").eq("id", existente.id).maybeSingle();
      return j({ success: true, ja_existia: true, user_id: existente.id, role_atual: perfil?.role || null });
    }

    // 1. Gera link de convite (cria o usuário "convidado" já com a role certa).
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { nome: nome || "", role, empresa_id: grupoId },
        redirectTo: redirect_to || DEFAULT_REDIRECT,
      },
    });
    if (linkErr) throw linkErr;
    const _base = redirect_to || DEFAULT_REDIRECT;
    const _hashed = linkData?.properties?.hashed_token;
    const actionLink = _hashed
      ? `${_base}?token_hash=${_hashed}&type=invite`
      : linkData?.properties?.action_link;
    if (!actionLink) throw new Error("Não foi possível gerar o link de convite.");

    // Perfil do convidado (service role ignora RLS).
    const newUserId = linkData?.user?.id;
    if (newUserId) {
      await admin.from("usuarios_auria").upsert({
        id: newUserId, email, nome: nome || "", role, empresa_id: grupoId, ativo: true,
      }, { onConflict: "id" });
    }

    // 2. Envia o e-mail pelo Resend (domínio verificado → não cai em spam).
    const quem = empresa_nome ? "a equipe da <b>" + empresa_nome + "</b>" : "a equipe de coordenação";
    const quemTxt = empresa_nome ? "A equipe da " + empresa_nome : "A equipe de coordenação";
    const T = role === "financeiro"
      ? {
        assunto: "Convite para o Auria — Painel de Custos",
        titulo: "Você recebeu acesso ao Painel de Custos",
        corpo: `Olá${nome ? " " + nome : ""}, ${quem} liberou o seu acesso ao <b>Painel de Custos</b> do Auria, ` +
          `onde ficam os <b>contratos, as parcelas e as notas fiscais</b> dos empreendimentos sob sua responsabilidade.`,
        corpoTxt: `${quemTxt} liberou o seu acesso ao Painel de Custos do Auria, onde ficam os contratos, as parcelas e as notas fiscais dos empreendimentos sob sua responsabilidade.`,
      }
      : {
        assunto: "Convite para o Auria — Acesso ao CDE",
        titulo: "Você recebeu acesso ao CDE",
        corpo: `Olá${nome ? " " + nome : ""}, ${quem} liberou o seu acesso de consulta ao ` +
          `<b>Ambiente Comum de Dados (CDE)</b> do Auria. Você poderá <b>visualizar e baixar</b> ` +
          `os arquivos liberados dos empreendimentos aos quais foi vinculado(a).`,
        corpoTxt: `${quemTxt} liberou o seu acesso de consulta ao Ambiente Comum de Dados (CDE) do Auria. Você poderá visualizar e baixar os arquivos liberados dos empreendimentos aos quais foi vinculado(a).`,
      };
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:auto;color:#1A2F4A;padding:8px">
        <div style="text-align:center;margin-bottom:22px">
          <img src="https://auria.solutions/logo_full.png" alt="Auria"
               width="170" style="max-width:170px;height:auto;display:inline-block">
        </div>
        <p style="font-size:12px;letter-spacing:.08em;color:#94A3B8;text-transform:uppercase;margin:0 0 6px">Bem-vindo à Auria</p>
        <h2 style="color:#1A2F4A;font-size:20px;margin:0 0 12px">${T.titulo}</h2>
        <p style="line-height:1.6">${T.corpo}</p>
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
        subject: T.assunto, html,
        text: `Olá${nome ? " " + nome : ""},

${T.corpoTxt}

Para definir sua senha e acessar, acesse:
${actionLink}

O link é válido por 24 horas.

Auria — Coordenação de Projetos
https://auria.solutions`,
      }),
    });
    if (!resp.ok) throw new Error("Falha no envio (Resend): " + (await resp.text()));

    return j({ success: true, user_id: newUserId, role });
  } catch (err) {
    console.error("[invite-setor]", String(err));
    return j({ error: String(err) }, 500);
  }
});
