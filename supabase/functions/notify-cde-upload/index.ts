// ============================================================================
//  notify-cde-upload — avisa analistas + gestores quando arquivos entram no CDE
//  ----------------------------------------------------------------------------
//  Chamado pelo cde_obra.html após um recebimento em lote. Recebe:
//    { emp_id, itens: [{codigo, disciplina, disciplinaLabel, revisao, novo}] }
//  Resolve os destinatários (analistas designados ao empreendimento + gestores
//  da empresa), menos quem subiu, e envia um e-mail (Resend) no padrão Auria.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY       = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") || "Auria <convites@auria.solutions>";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Item = { codigo: string; disciplina?: string; disciplinaLabel?: string; revisao?: string;
              novo?: boolean; titulo?: string; motivo?: string };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    // Quem chamou (o analista/gestor que subiu) — para não notificar a si mesmo.
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: cu } = await caller.auth.getUser();
    if (!cu?.user) return j({ error: "não autenticado" }, 401);
    const meuEmail = (cu.user.email || "").toLowerCase();

    const body = await req.json().catch(() => ({}));
    const emp_id: string = body?.emp_id;
    const itens: Item[] = Array.isArray(body?.itens) ? body.itens : [];
    if (!emp_id || !itens.length) return j({ error: "emp_id e itens obrigatórios" }, 400);

    const { data: emp } = await admin.from("empreendimentos_auria")
      .select("id,nome,empresa_id").eq("id", emp_id).single();
    if (!emp) return j({ error: "empreendimento não encontrado" }, 404);

    // Destinatários: analistas designados (ativos) + gestores/super_admin da empresa.
    const dest = new Map<string, string>();
    const { data: vinc } = await admin.from("analista_empreendimento_auria")
      .select("analista_id,ativo,silenciar,aviso_cde").eq("empreendimento_id", emp_id).eq("ativo", true);
    // item 42: quem silenciou não recebe; item 43: só quem escolheu aviso 'upload'
    // (o 'diario' vai no resumo das 17h pelo pg_cron; 'nenhum' não recebe).
    const ids = (vinc || [])
      .filter((v: { silenciar?: boolean; aviso_cde?: string }) => !v.silenciar && (v.aviso_cde || "upload") === "upload")
      .map((v: { analista_id: string }) => v.analista_id);
    if (ids.length) {
      const { data: us } = await admin.from("usuarios_auria").select("email,nome").in("id", ids);
      (us || []).forEach((u: { email?: string; nome?: string }) => { if (u.email) dest.set(u.email, u.nome || ""); });
    }
    // SEGURANÇA (2026-09-25): o super_admin é a conta de OPERAÇÃO do Auria, não
    // um membro da empresa do cliente. Estava nesta lista e recebia aviso de
    // toda entrega de todo cliente. Destinatário aqui é só a gestão do cliente.
    if (emp.empresa_id) {
      const { data: gs } = await admin.from("usuarios_auria")
        .select("email,nome,role").eq("empresa_id", emp.empresa_id).in("role", ["gerente"]);
      (gs || []).forEach((u: { email?: string; nome?: string }) => { if (u.email) dest.set(u.email, u.nome || ""); });
    }
    dest.delete(meuEmail);                               // não manda para quem subiu
    for (const k of [...dest.keys()]) if (k.toLowerCase() === meuEmail) dest.delete(k);
    if (!dest.size) return j({ success: true, enviados: 0 });

    // Agrupa os itens por disciplina para a lista do e-mail.
    const porDisc: Record<string, Item[]> = {};
    for (const it of itens) {
      const k = it.disciplinaLabel || it.disciplina || "—";
      (porDisc[k] = porDisc[k] || []).push(it);
    }
    const linhasHtml = Object.keys(porDisc).sort().map((disc) => `
      <p style="margin:14px 0 4px;font-size:12px;font-weight:700;color:#1D4ED8;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(disc)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${porDisc[disc].map((it) => `
          <tr>
            <td style="padding:6px 0;font-family:ui-monospace,Consolas,monospace;vertical-align:top">
              ${escapeHtml(it.codigo)}
              ${it.titulo ? `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#334155;font-weight:600;margin-top:2px">${escapeHtml(it.titulo)}</div>` : ""}
              ${it.motivo ? `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#854F0B;margin-top:3px"><b>Revisado:</b> ${escapeHtml(it.motivo)}</div>` : ""}
            </td>
            <td style="padding:6px 0;text-align:right;color:#64748B;vertical-align:top;white-space:nowrap">rev ${escapeHtml(it.revisao || "—")} · ${it.novo ? "novo" : "nova revisão"}</td>
          </tr>`).join("")}
      </table>`).join("");

    const linhasText = Object.keys(porDisc).sort().map((disc) =>
      disc + ":\n" + porDisc[disc].map((it) =>
        `  - ${it.codigo}${it.titulo ? " — " + it.titulo : ""}  (rev ${it.revisao || "—"} · ${it.novo ? "novo" : "nova revisão"})`
        + (it.motivo ? `\n      revisado: ${it.motivo}` : "")).join("\n")
    ).join("\n\n");

    const total = itens.length;
    const cdeUrl = `https://auria.solutions/cde_obra.html?emp=${emp_id}`;
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:auto;color:#1A2F4A;padding:8px">
        <div style="text-align:center;margin-bottom:20px">
          <img src="https://auria.solutions/logo_full.png" alt="Auria" width="150" style="max-width:150px;height:auto">
        </div>
        <p style="font-size:12px;letter-spacing:.08em;color:#94A3B8;text-transform:uppercase;margin:0 0 6px">Novos arquivos no CDE</p>
        <h2 style="color:#1A2F4A;font-size:19px;margin:0 0 6px">${total} documento(s) recebido(s)</h2>
        <p style="font-size:14px;color:#475569;margin:0 0 8px">Empreendimento <b>${escapeHtml(emp.nome)}</b></p>
        ${linhasHtml}
        <p style="text-align:center;margin:26px 0 10px">
          <a href="${cdeUrl}" style="background:#0E7490;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
            Abrir o CDE
          </a>
        </p>
        <p style="font-size:12px;color:#64748B;line-height:1.6">No CDE você confere os arquivos, confirma o recebimento ao projetista e conduz a análise até a liberação para obra.</p>
        <hr style="border:none;border-top:1px solid #E2E8F0;margin:22px 0">
        <p style="font-size:11px;color:#94A3B8">Auria — Coordenação de Projetos</p>
      </div>`;

    const text = `${total} documento(s) recebido(s) no CDE do empreendimento ${emp.nome}.

${linhasText}

Abra o CDE: ${cdeUrl}

Auria — Coordenação de Projetos
https://auria.solutions`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        reply_to: "contato@auria.solutions",
        to: [...dest.keys()],
        subject: `Auria — Novos arquivos no CDE (${emp.nome})`,
        html,
        text,
      }),
    });
    if (!resp.ok) throw new Error("Falha no envio (Resend): " + (await resp.text()));

    return j({ success: true, enviados: dest.size });
  } catch (err) {
    console.error("[notify-cde-upload]", String(err));
    return j({ error: String(err) }, 500);
  }
});
