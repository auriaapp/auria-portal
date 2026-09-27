// ============================================================================
//  notify-cde-recepcao — analista CONFIRMA ao projetista que os arquivos
//  daquele documento foram recebidos no CDE.
//  ----------------------------------------------------------------------------
//  Chamado pelo cde.html. Recebe { documento_id, disciplina_label }.
//  Resolve o(s) projetista(s) da disciplina naquele empreendimento
//  (disciplina_fornecedor_auria -> fornecedores_auria/projetistas_auria) e
//  envia um e-mail de confirmação de recebimento (padrão Auria).
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: cu } = await caller.auth.getUser();
    if (!cu?.user) return j({ error: "não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const documento_id: string = body?.documento_id;
    const disciplinaLabel: string = body?.disciplina_label || "";
    if (!documento_id) return j({ error: "documento_id obrigatório" }, 400);

    // Documento → empreendimento + disciplina (código)
    const { data: doc } = await admin.from("cde_documento_auria")
      .select("id,codigo,titulo,disciplina,empreendimento_id").eq("id", documento_id).single();
    if (!doc) return j({ error: "documento não encontrado" }, 404);

    const { data: emp } = await admin.from("empreendimentos_auria")
      .select("id,nome").eq("id", doc.empreendimento_id).single();

    // Fornecedor da disciplina neste empreendimento (casa pelo nome OU pelo código)
    const alvos = [disciplinaLabel, doc.disciplina].filter(Boolean);
    const { data: dfs } = await admin.from("disciplina_fornecedor_auria")
      .select("fornecedor_id,disciplina").eq("empreendimento_id", doc.empreendimento_id).in("disciplina", alvos);
    const fornIds = [...new Set((dfs || []).map((d: { fornecedor_id: string }) => d.fornecedor_id))];

    const dest = new Map<string, string>();
    if (fornIds.length) {
      const { data: projs } = await admin.from("projetistas_auria")
        .select("nome,email,ativo,fornecedor_id").in("fornecedor_id", fornIds);
      (projs || []).forEach((p: { email?: string; nome?: string; ativo?: boolean }) => {
        if (p.email && p.ativo !== false) dest.set(p.email.toLowerCase(), p.nome || "");
      });
      // fallback: e-mail de contato do fornecedor
      const { data: forns } = await admin.from("fornecedores_auria")
        .select("nome,email_contato").in("id", fornIds);
      (forns || []).forEach((f: { email_contato?: string; nome?: string }) => {
        if (f.email_contato && !dest.size) dest.set(f.email_contato.toLowerCase(), f.nome || "");
      });
    }
    if (!dest.size) return j({ success: true, enviados: 0, aviso: "Nenhum projetista cadastrado para a disciplina." });

    const disc = disciplinaLabel || doc.disciplina || "—";
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:auto;color:#1A2F4A;padding:8px">
        <div style="text-align:center;margin-bottom:20px">
          <img src="https://auria.solutions/logo_full.png" alt="Auria" width="150" style="max-width:150px;height:auto">
        </div>
        <p style="font-size:12px;letter-spacing:.08em;color:#94A3B8;text-transform:uppercase;margin:0 0 6px">Confirmação de recebimento</p>
        <h2 style="color:#1A2F4A;font-size:19px;margin:0 0 12px">Recebemos seu arquivo no CDE</h2>
        <p style="font-size:14px;color:#475569;line-height:1.6">A coordenação confirma o recebimento do documento abaixo. Ele entrou no fluxo de análise da Auria.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0 8px">
          <tr><td style="padding:6px 0;color:#64748B">Empreendimento</td><td style="padding:6px 0;text-align:right"><b>${escapeHtml(emp?.nome || "—")}</b></td></tr>
          <tr><td style="padding:6px 0;color:#64748B">Disciplina</td><td style="padding:6px 0;text-align:right">${escapeHtml(disc)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B">Documento</td><td style="padding:6px 0;text-align:right;font-family:ui-monospace,Consolas,monospace">${escapeHtml(doc.codigo)}</td></tr>
        </table>
        <p style="font-size:13px;color:#64748B;line-height:1.6">Quando o documento for analisado, você será avisado sobre a liberação (ou eventuais ressalvas) pela coordenação.</p>
        <hr style="border:none;border-top:1px solid #E2E8F0;margin:22px 0">
        <p style="font-size:11px;color:#94A3B8">Auria — Coordenação de Projetos</p>
      </div>`;
    const text = `Confirmação de recebimento — Auria

Recebemos no CDE o documento ${doc.codigo} (${disc}) do empreendimento ${emp?.nome || "—"}.
Ele entrou no fluxo de análise. Você será avisado sobre a liberação.

Auria — Coordenação de Projetos
https://auria.solutions`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        reply_to: "contato@auria.solutions",
        to: [...dest.keys()],
        subject: `Auria — Recebimento confirmado: ${doc.codigo}`,
        html, text,
      }),
    });
    if (!resp.ok) throw new Error("Falha no envio (Resend): " + (await resp.text()));

    return j({ success: true, enviados: dest.size, destinatarios: [...dest.keys()] });
  } catch (err) {
    console.error("[notify-cde-recepcao]", String(err));
    return j({ error: String(err) }, 500);
  }
});
