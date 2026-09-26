import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
//  invite-obra — convida alguém para o RAMO OBRA de um empreendimento.
//  Espelha invite-projetista/invite-setor no fluxo (generateLink + token_hash +
//  Resend, com remetente, links e imagens no MESMO domínio auria.solutions —
//  regra de onboarding que já quebrou entrega no Microsoft 365).
//
//  TRÊS DIFERENÇAS EM RELAÇÃO AO invite-setor:
//   1. Vincula à obra e ao NÍVEL na mesma chamada (o convite de setor só criava
//      a conta; a vinculação era um passo separado).
//   2. Exige estacao_pode() no empreendimento ALVO — sem isso, um analista de
//      uma empresa convidaria para a obra de outra.
//   3. E-mail próprio, listando as funções específicas daquele nível de obra.
//
//  ESCOPO DESTA VERSÃO (Fase 3a): só a COORDENAÇÃO convida (analista/gerente/
//  super_admin), que é como o engenheiro chefe entra — direto, sem aval, porque
//  a coordenação É quem avaliza. O convite feito pelo próprio chefe/coord. de
//  campo passa por fila de aprovação e é a Fase 3b.
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

const NIVEIS = ["eng_chefe", "coord_campo", "equipe_campo"] as const;
type Nivel = typeof NIVEIS[number];

const ROTULO: Record<Nivel, string> = {
  eng_chefe:    "Gerente de campo (engenheiro chefe)",
  coord_campo:  "Coordenação de campo",
  equipe_campo: "Equipe de campo",
};

// O que cada nível passa a poder — é isto que o e-mail mostra, para a pessoa
// saber o que ganhou sem precisar explorar o sistema.
const FUNCOES: Record<Nivel, string[]> = {
  eng_chefe: [
    "Ver <b>todos</b> os arquivos da obra, inclusive revisões ainda em análise",
    "Baixar as pranchas liberadas para obra (A1) e liberadas com ressalvas (B1)",
    "Abrir apontamentos sobre a prancha e sobre o modelo 3D",
    "Gerar e organizar os <b>QR Codes</b> para afixar no canteiro",
    "Registrar o <b>diário de obra</b>",
    "Convidar a sua equipe de campo (com aval da coordenação)",
  ],
  coord_campo: [
    "Ver e baixar as pranchas liberadas para obra (A1) e com ressalvas (B1)",
    "Abrir e editar apontamentos sobre a prancha e sobre o modelo 3D",
    "Receber aviso por e-mail a cada apontamento aberto na obra",
    "Gerar e organizar os <b>QR Codes</b> para afixar no canteiro",
    "Registrar o <b>diário de obra</b>",
  ],
  equipe_campo: [
    "Ver e baixar as pranchas liberadas para obra (A1) e com ressalvas (B1)",
    "Consultar os modelos 3D da obra",
    "Abrir apontamentos sobre a prancha e sobre o modelo 3D",
  ],
};

// Papéis que NÃO podem ser convertidos em 'obra': cada pessoa tem um papel só,
// e rebaixar um analista/gerente aqui quebraria o acesso dele em silêncio.
const ROLES_CONFLITANTES = ["analista", "gerente", "super_admin", "projetista", "financeiro"];

// listUsers() devolve SÓ a primeira página (perPage padrão = 50). Procurar
// apenas nela faz o convite concluir "não existe" para quem existe — e aí o
// generateLink falha com "email already registered". Percorre as páginas até
// achar ou esgotar. (invite-setor e invite-projetista têm o mesmo defeito.)
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
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Quem chama: precisa ser da coordenação ──────────────────────────────
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: cu } = await caller.auth.getUser();
    if (!cu?.user) return j({ error: "não autenticado" }, 401);
    const { data: cprof } = await admin.from("usuarios_auria").select("role").eq("id", cu.user.id).single();
    if (!cprof || !["analista", "gerente", "super_admin"].includes(cprof.role)) {
      return j({ error: "sem permissão" }, 403);
    }

    const { email, nome, nivel, empreendimento_id, redirect_to, empresa_nome } = await req.json();
    if (!email)             return j({ error: "email obrigatório" }, 400);
    if (!empreendimento_id) return j({ error: "empreendimento_id obrigatório" }, 400);
    if (!NIVEIS.includes(nivel)) {
      return j({ error: `nível inválido — use um de: ${NIVEIS.join(", ")}` }, 400);
    }
    const nv = nivel as Nivel;

    // ── O chamador pode gerir ESTE empreendimento? ──────────────────────────
    //    estacao_pode roda com o JWT do chamador (não com o service role), que
    //    é justamente o ponto: responde pela permissão de quem pediu.
    // estacao_edita: exclui o analista visualizador (item 13) — ele não convida.
    const { data: pode, error: podeErr } = await caller.rpc("estacao_edita", { p_emp: empreendimento_id });
    if (podeErr) throw podeErr;
    if (pode !== true) return j({ error: "sem permissão neste empreendimento" }, 403);

    // ── Conta já existe? Reaproveita, não recria ────────────────────────────
    const existente = await acharUsuarioPorEmail(admin, email);

    let userId: string | undefined;
    let actionLink: string | undefined;
    let jaExistia = false;

    if (existente) {
      jaExistia = true;
      userId = existente.id;
      const { data: perfil } = await admin.from("usuarios_auria").select("role").eq("id", userId).maybeSingle();
      const roleAtual = perfil?.role || null;
      if (roleAtual && ROLES_CONFLITANTES.includes(roleAtual)) {
        return j({
          error: `Este e-mail já está cadastrado como "${roleAtual}" no Auria. ` +
                 `Cada pessoa tem um papel só — para movê-la para a obra, ` +
                 `a gestão precisa alterar o papel dela primeiro.`,
        }, 409);
      }
      await admin.from("usuarios_auria")
        .update({ role: "obra", ativo: true }).eq("id", userId);
    } else {
      // 1. Gera o link de convite (cria o usuário convidado já com role 'obra').
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: {
          data: { nome: nome || "", role: "obra" },
          redirectTo: redirect_to || DEFAULT_REDIRECT,
        },
      });
      if (linkErr) throw linkErr;

      const _base   = redirect_to || DEFAULT_REDIRECT;
      const _hashed = linkData?.properties?.hashed_token;
      // Item 141: link NOSSO, 5 dias. O hashed_token acima não vai no e-mail.
      const _tk = await criarConviteToken(admin, { email, nome, papel: "obra",
        user_id: linkData?.user?.id ?? null, empresa_nome: empresa_nome ?? null,
        criado_por: cu?.user?.id ?? null });
      actionLink = `${_base}?convite=${_tk}`;

      userId = linkData?.user?.id;
      if (userId) {
        await admin.from("usuarios_auria").upsert({
          id: userId, email, nome: nome || "", role: "obra", ativo: true,
        }, { onConflict: "id" });
      }
    }

    if (!userId) throw new Error("Não foi possível determinar o usuário convidado.");

    // ── Vincula à obra no nível pedido e aplica o preset de flags ───────────
    const { error: vincErr } = await admin.from("obra_empreendimento_auria").upsert({
      empreendimento_id, usuario_id: userId, nivel: nv, ativo: true, criado_por: cu.user.id,
    }, { onConflict: "empreendimento_id,usuario_id" });
    if (vincErr) throw vincErr;

    // O preset é a fonte única das flags por nível — não duplicar essa regra aqui.
    const { error: presetErr } = await admin.rpc("obra_preset_acesso", {
      p_emp: empreendimento_id, p_usuario: userId, p_nivel: nv,
    });
    if (presetErr) throw presetErr;

    // Conta que já existia não recebe link de senha — ela já tem a dela.
    if (jaExistia) return j({ success: true, ja_existia: true, user_id: userId, nivel: nv });

    // ── E-mail de convite, específico da obra ───────────────────────────────
    const itens = FUNCOES[nv].map(
      (f) => `<li style="margin:0 0 7px;line-height:1.55">${f}</li>`,
    ).join("");

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:auto;color:#1A2F4A;padding:8px">
        <div style="text-align:center;margin-bottom:22px">
          <img src="https://auria.solutions/logo_full.png" alt="Auria"
               width="170" style="max-width:170px;height:auto;display:inline-block">
        </div>
        <p style="font-size:12px;letter-spacing:.08em;color:#94A3B8;text-transform:uppercase;margin:0 0 6px">Acesso de obra</p>
        <h2 style="color:#1A2F4A;font-size:20px;margin:0 0 12px">Você recebeu acesso à obra no Auria</h2>
        <p style="line-height:1.6">Olá${nome ? " " + nome : ""}, ${empresa_nome ? "a equipe da <b>" + empresa_nome + "</b>" : "a equipe de coordenação"}
        liberou o seu acesso como <b>${ROTULO[nv]}</b>. O Auria é onde a obra encontra sempre a
        <b>última revisão liberada</b> de cada prancha — sem versão velha circulando no canteiro.</p>

        <div style="background:#FBEEDC;border-left:3px solid #BF6410;border-radius:8px;padding:14px 18px;margin:22px 0">
          <p style="margin:0 0 9px;font-size:13px;font-weight:bold;color:#BF6410">O que você pode fazer</p>
          <ul style="margin:0;padding-left:18px;font-size:14px;color:#1A2F4A">${itens}</ul>
        </div>

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

    const textoItens = FUNCOES[nv]
      .map((f) => "- " + f.replace(/<\/?b>/g, ""))
      .join("\n");

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL, reply_to: "contato@auria.solutions", to: [email],
        subject: "Convite para o Auria — Acesso à obra", html,
        text: `Olá${nome ? " " + nome : ""},

${empresa_nome ? "A equipe da " + empresa_nome : "A equipe de coordenação"} liberou o seu acesso como ${ROTULO[nv]}. O Auria é onde a obra encontra sempre a última revisão liberada de cada prancha.

O que você pode fazer:
${textoItens}

Para definir sua senha e acessar:
${actionLink}

O link é válido por 24 horas.

Auria — Coordenação de Projetos
https://auria.solutions`,
      }),
    });
    if (!resp.ok) throw new Error("Falha no envio (Resend): " + (await resp.text()));

    return j({ success: true, user_id: userId, nivel: nv });
  } catch (err) {
    console.error("[invite-obra]", String(err));
    return j({ error: String(err) }, 500);
  }
});
