import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY       = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") || "Auria <convites@auria.solutions>";
const PORTAL_ANALISTA = "https://auria.solutions/painel_analista.html";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const brl = (v: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verifica autenticação do chamador (projetista logado)
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: cu } = await caller.auth.getUser();
    if (!cu?.user) return j({ error: "não autenticado" }, 401);

    const { parcela_id } = await req.json();
    if (!parcela_id) return j({ error: "parcela_id obrigatório" }, 400);

    // Parcela → contrato → empreendimento (service role ignora RLS)
    const { data: parc } = await admin.from("parcelas_auria")
      .select("id,numero,descricao,valor,contrato_id").eq("id", parcela_id).single();
    if (!parc) return j({ error: "parcela não encontrada" }, 404);

    const { data: ctr } = await admin.from("contratos_auria")
      .select("id,numero,objeto,disciplina,projetista_nome,projetista_email,empreendimento_id")
      .eq("id", parc.contrato_id).single();
    if (!ctr) return j({ error: "contrato não encontrado" }, 404);

    const { data: emp } = await admin.from("empreendimentos_auria")
      .select("id,nome,empresa_id").eq("id", ctr.empreendimento_id).single();

    // Destinatários: analistas com acesso ao empreendimento + gestores da empresa
    const dest = new Map<string, string>(); // email -> nome
    const { data: vinc } = await admin.from("analista_empreendimento_auria")
      .select("analista_id,ativo").eq("empreendimento_id", ctr.empreendimento_id).eq("ativo", true);
    const ids = (vinc || []).map((v: { analista_id: string }) => v.analista_id);
    if (ids.length) {
      const { data: us } = await admin.from("usuarios_auria").select("email,nome").in("id", ids);
      (us || []).forEach((u: { email?: string; nome?: string }) => { if (u.email) dest.set(u.email, u.nome || ""); });
    }
    // SEGURANÇA (2026-09-25): o super_admin é a conta de OPERAÇÃO do Auria, não
    // um membro da empresa do cliente. Ele estava nesta lista e por isso recebia
    // e-mails de negócio de todos os clientes — inclusive valores de contrato.
    // Destinatário aqui é só a gestão do cliente; alerta de plataforma é outra coisa.
    if (emp?.empresa_id) {
      const { data: gs } = await admin.from("usuarios_auria")
        .select("email,nome,role").eq("empresa_id", emp.empresa_id).in("role", ["gerente"]);
      (gs || []).forEach((u: { email?: string; nome?: string }) => { if (u.email) dest.set(u.email, u.nome || ""); });
    }
    if (!dest.size) return j({ success: true, enviados: 0 });

    const proj = ctr.projetista_nome || ctr.projetista_email || "Projetista";
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:auto;color:#1A2F4A;padding:8px">
        <div style="text-align:center;margin-bottom:20px">
          <img src="https://auria.solutions/logo_full.png" alt="Auria" width="150" style="max-width:150px;height:auto">
        </div>
        <p style="font-size:12px;letter-spacing:.08em;color:#94A3B8;text-transform:uppercase;margin:0 0 6px">Solicitação de faturamento</p>
        <h2 style="color:#1A2F4A;font-size:19px;margin:0 0 12px">💵 ${proj} solicitou o faturamento de uma parcela</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 20px">
          <tr><td style="padding:6px 0;color:#64748B">Empreendimento</td><td style="padding:6px 0;text-align:right"><b>${emp?.nome || "—"}</b></td></tr>
          <tr><td style="padding:6px 0;color:#64748B">Disciplina</td><td style="padding:6px 0;text-align:right">${ctr.disciplina || "—"}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B">Contrato</td><td style="padding:6px 0;text-align:right">${ctr.objeto || ctr.numero || "—"}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B">Parcela</td><td style="padding:6px 0;text-align:right">#${parc.numero} — ${parc.descricao || ""}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B">Valor</td><td style="padding:6px 0;text-align:right"><b>${brl(parc.valor)}</b></td></tr>
        </table>
        <p style="text-align:center;margin:24px 0 10px">
          <a href="${PORTAL_ANALISTA}" style="background:#3B82F6;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
            Abrir o painel para autorizar
          </a>
        </p>
        <p style="font-size:12px;color:#64748B;line-height:1.6">No painel: aba <b>Contratos &amp; Faturas</b> → abra o contrato → autorize (✅) ou recuse (❌) a parcela.</p>
        <hr style="border:none;border-top:1px solid #E2E8F0;margin:22px 0">
        <p style="font-size:11px;color:#94A3B8">Auria — Coordenação de Projetos</p>
      </div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        reply_to: "contato@auria.solutions",
        to: [...dest.keys()],
        subject: `Auria — ${proj} solicitou faturamento (${emp?.nome || "empreendimento"})`,
        html,
        // Versão texto: e-mail só-HTML pontua pior nos filtros corporativos.
        text: `${proj} solicitou faturamento no empreendimento ${emp?.nome || "—"}.

Acesse o painel para analisar a solicitação:
https://auria.solutions/painel_analista.html

Auria — Coordenação de Projetos`,
      }),
    });
    if (!resp.ok) throw new Error("Falha no envio (Resend): " + (await resp.text()));

    return j({ success: true, enviados: dest.size });
  } catch (err) {
    console.error("[notify-fatura-solicitada]", String(err));
    return j({ error: String(err) }, 500);
  }
});
