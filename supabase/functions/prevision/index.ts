// ============================================================================
//  prevision — ponte Auria ↔ Prevision (item 77). Etapa 1: DIAGNÓSTICO.
//  Usa a API REST nova do Prevision (OpenAPI em https://api.prevision.com.br):
//  header "Authorization: Bearer <token>" — token gerado em Configurações › API Token
//  (Prevision Incorporação e/ou Obra; o token vale para as plataformas marcadas).
//  A chave fica SÓ no secret PREVISION_API_KEY; o front nunca a vê. Só leitura.
//
//  body: { acao:'ping' }                → { ok, incorporacao:[{id,nome}], obra:[{id,nome}] }
//        { acao:'projetos' }            → idem (lista para o vínculo)
//        { acao:'projeto', id }         → { ok, projeto:{ id, nome, n_tasks, tasks:[{wbs,nome,ini,fim,prev,real,kanban,colunas…}] } }
//        { acao:'get', path, query? }   → repasse controlado de um GET da API (explorar durante a integração)
//  Verify JWT: ON. Quem pode: gerente ou super_admin.
//  Secrets: PREVISION_API_KEY (+ opcional PREVISION_API_URL; padrão https://api.prevision.com.br).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PV_KEY       = (Deno.env.get("PREVISION_API_KEY") || "").trim().replace(/^(token|bearer)\s+/i, "").replace(/^["']|["']$/g, "");
const PV_URL       = (Deno.env.get("PREVISION_API_URL") || "https://api.prevision.com.br").trim().replace(/\/+$/, "");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// GET na API REST. Devolve o JSON ou lança erro com o status e a mensagem do Prevision.
async function pvGet(path: string, query?: Record<string, string>) {
  const url = new URL(PV_URL + path);
  Object.entries(query || {}).forEach(([k, v]) => { if (v != null && v !== "") url.searchParams.set(k, String(v)); });
  const r = await fetch(url.toString(), { headers: { "Accept": "application/json", "Authorization": "Bearer " + PV_KEY } });
  const txt = await r.text();
  let body: any = null; try { body = JSON.parse(txt); } catch (_) { /* não-JSON */ }
  if (!r.ok) {
    const msg = body?.error?.message || body?.message || body?.detail || txt.slice(0, 200);
    if (r.status === 401 || r.status === 403) throw new Error("Prevision recusou o token (HTTP " + r.status + (msg ? ": " + msg : "") + "). Confira se o token foi criado para esta plataforma (Incorporação/Obra) e se não expirou.");
    throw new Error("Prevision HTTP " + r.status + (msg ? ": " + msg : "") + " em " + path);
  }
  return body;
}
const lista = (o: any) => ((o && o.projects) || []).map((p: any) => ({ id: String(p.id), nome: p.name }));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return j({ error: "sem sessão" }, 401);
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return j({ error: "sessão inválida" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: perfil } = await admin.from("usuarios_auria").select("role,empresa_id").eq("id", user.id).maybeSingle();
    if (!perfil || !["gerente", "super_admin"].includes(perfil.role)) return j({ error: "só a gestão usa a integração com o Prevision" }, 403);

    if (!PV_KEY) return j({ ok: false, error: "PREVISION_API_KEY não configurada nos Secrets" }, 500);
    if (/\s/.test(PV_KEY)) return j({ ok: false, error: "PREVISION_API_KEY contém espaço/quebra de linha — cole só o token, numa linha. Tamanho atual: " + PV_KEY.length }, 500);

    const body = await req.json().catch(() => ({}));
    const acao = String(body.acao || "ping");

    if (acao === "ping" || acao === "projetos") {
      // As duas plataformas: o token pode valer para uma só — a outra devolve 401/403 e vira aviso, não erro.
      const out: any = { ok: true, chave_len: PV_KEY.length, incorporacao: [], obra: [], avisos: [] };
      try { out.incorporacao = lista(await pvGet("/incorporation/api/v1/projects")); } catch (e) { out.avisos.push("Incorporação: " + (e as Error).message); }
      try { out.obra = lista(await pvGet("/construction/api/v1/projects")); } catch (e) { out.avisos.push("Obra: " + (e as Error).message); }
      if (!out.incorporacao.length && !out.obra.length) { out.ok = false; out.error = out.avisos.join(" | ") || "Nenhum projeto acessível com este token."; }
      return j(out);
    }
    if (acao === "projeto") {
      const id = String(body.id || "").replace(/[^A-Za-z0-9_-]/g, ""); if (!id) return j({ error: "id obrigatório" }, 400);
      // Forma REAL da resposta (2026-09): { project:{ id, name, tasks?:[…], phases:[{…deprecated, tasks:[…]}] } },
      // campos em camelCase (expectedProgress, kanbanSteps, ganttColumns…). O schema publicado diz snake_case
      // e "tasks fora de phases" — aceita os dois.
      const raw = await pvGet("/incorporation/api/v1/projects/" + encodeURIComponent(id));
      const p = (raw && raw.project) || raw || {};
      let tasks: any[] = Array.isArray(p.tasks) && p.tasks.length ? p.tasks : [];
      if (!tasks.length && Array.isArray(p.phases)) p.phases.forEach((f: any) => { (f.tasks || []).forEach((t: any) => tasks.push(t)); });
      const g = (t: any, camel: string, snake: string) => t[camel] !== undefined ? t[camel] : t[snake];
      const norm = tasks.map((t: any) => ({
        id: t.id, wbs: g(t, "wbsCode", "wbs_code"), nome: t.name,
        ini: g(t, "startDate", "start_date"), fim: g(t, "endDate", "end_date"), duracao: t.duration, custo: t.cost,
        prev: g(t, "expectedProgress", "expected_progress"), real: g(t, "realizedProgress", "realized_progress"),
        base_prev: g(t, "baselineProgress", "baseline_progress"), base_ini: g(t, "baselineStartDate", "baseline_start_date"), base_fim: g(t, "baselineEndDate", "baseline_end_date"),
        atraso_base: g(t, "currentBaselineDelay", "current_baseline_delay"), atraso_data: g(t, "currentDateDelay", "current_date_delay"),
        critica: g(t, "isCritical", "is_critical"),
        kanban: (g(t, "kanbanSteps", "kanban_steps") || {}).name, kanban_status: (g(t, "kanbanSteps", "kanban_steps") || {}).status,
        responsaveis: (t.responsibles || []).map((x: any) => x.name), etiquetas: (t.labels || []).map((x: any) => x.title),
        colunas: Object.fromEntries(((g(t, "ganttColumns", "gantt_columns")) || []).map((c: any) => [c.name, c.value])),
      }));
      return j({ ok: true, projeto: { id: p.id || p.project_id, nome: p.name, reference_date: g(p, "referenceDate", "reference_date"), n_tasks: norm.length, tasks: norm } });
    }
    if (acao === "get") {
      // repasse controlado (só GET, só caminhos da API) para explorar o schema durante a integração
      const path = String(body.path || ""); if (!/^\/(incorporation|construction|construction-schedule|cost-management)\/api\/v1\/[A-Za-z0-9_\-\/{}]+$/.test(path)) return j({ error: "path inválido" }, 400);
      return j({ ok: true, data: await pvGet(path, body.query || {}) });
    }
    return j({ error: "acao desconhecida" }, 400);
  } catch (e) {
    return j({ ok: false, error: String((e as Error)?.message || e) }, 200);
  }
});
