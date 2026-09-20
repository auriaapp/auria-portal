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
//        { acao:'sugerir', empreendimento_id }             → projetos do Prevision cuja sigla bate com o empreendimento
//        { acao:'vincular', empreendimento_id, projetos:[{id,nome}] } → grava/ativa vínculos (fase = prefixo do nome); os
//                                                             não listados ficam ativo=false; padrão = EXE (ou o 1º) se nenhum
//        { acao:'sync', empreendimento_id? }               → baixa as tarefas de cada vínculo ativo p/ prevision_tarefa_auria
//                                                             (sem id: todos os empreendimentos do grupo do usuário)
//  Verify JWT: ON. Quem pode: gerente ou super_admin.
//  Secrets: PREVISION_API_KEY (+ opcional PREVISION_API_URL; padrão https://api.prevision.com.br).
//  Item 77f: header "x-auria-cron: <PREVISION_CRON_SECRET>" (chamada do pg_cron via pg_net, Bearer = anon key)
//  → sincroniza todos os vínculos ativos, sem usuário. Ver supabase_prevision_p5.sql.
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
// Fase = prefixo do nome do projeto no Prevision (convenção da empresa: EXE-I007-CBML, PROD-V038-MUND-R00…)
const FASES = ["EXE", "PROD", "ORC", "INC"];
function faseDe(nome: string) { const p = String(nome || "").trim().toUpperCase().split(/[-_ ]/)[0]; return FASES.includes(p) ? p : "OUTRA"; }
// Segmentos do nome (EXE, I007, CBML…) para casar com a sigla do empreendimento do Auria
function segmentos(nome: string) { return String(nome || "").toUpperCase().split(/[-_ ]+/).filter(Boolean); }
// Projeto de Incorporação com as tarefas normalizadas (aceita camelCase real e snake_case do schema)
async function projetoTarefas(id: string) {
  const raw = await pvGet("/incorporation/api/v1/projects/" + encodeURIComponent(id));
  const p = (raw && raw.project) || raw || {};
  let tasks: any[] = Array.isArray(p.tasks) && p.tasks.length ? p.tasks : [];
  if (!tasks.length && Array.isArray(p.phases)) p.phases.forEach((f: any) => { (f.tasks || []).forEach((t: any) => tasks.push(t)); });
  const g = (t: any, camel: string, snake: string) => t[camel] !== undefined ? t[camel] : t[snake];
  const num = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);
  const dt = (v: any) => v ? String(v).slice(0, 10) : null;
  const norm = tasks.map((t: any) => {
    const wbs = g(t, "wbsCode", "wbs_code");
    return {
      id: String(t.id), wbs, nivel: wbs ? String(wbs).split(".").length : null, nome: t.name,
      ini: dt(g(t, "startDate", "start_date")), fim: dt(g(t, "endDate", "end_date")), duracao: num(t.duration), custo: num(t.cost),
      prev: num(g(t, "expectedProgress", "expected_progress")), real: num(g(t, "realizedProgress", "realized_progress")),
      base_prev: num(g(t, "baselineProgress", "baseline_progress")), base_ini: dt(g(t, "baselineStartDate", "baseline_start_date")), base_fim: dt(g(t, "baselineEndDate", "baseline_end_date")),
      atraso_base: num(g(t, "currentBaselineDelay", "current_baseline_delay")), atraso_data: num(g(t, "currentDateDelay", "current_date_delay")),
      critica: !!g(t, "isCritical", "is_critical"),
      kanban: (g(t, "kanbanSteps", "kanban_steps") || {}).name || null, kanban_status: (g(t, "kanbanSteps", "kanban_steps") || {}).status || null,
      responsaveis: (t.responsibles || []).map((x: any) => x.name).filter(Boolean), etiquetas: (t.labels || []).map((x: any) => x.title).filter(Boolean),
      colunas: Object.fromEntries(((g(t, "ganttColumns", "gantt_columns")) || []).filter((c: any) => c && c.name).map((c: any) => [c.name, c.value])),
    };
  });
  return { id: String(p.id || p.project_id || id), nome: p.name, reference_date: dt(g(p, "referenceDate", "reference_date")), n_tasks: norm.length, tasks: norm };
}
// Sincroniza UM vínculo: upsert das tarefas (chave projeto_id+tarefa_id), marca as que sumiram, atualiza o vínculo.
async function syncVinculo(admin: any, v: any) {
  try {
    const pr = await projetoTarefas(v.projeto_id);
    const agora = new Date().toISOString();
    const rows = pr.tasks.map((t: any) => ({
      empreendimento_id: v.empreendimento_id, vinculo_id: v.id, fase: v.fase, projeto_id: v.projeto_id, tarefa_id: t.id,
      wbs: t.wbs, nivel: t.nivel, nome: t.nome, ini: t.ini, fim: t.fim, duracao: t.duracao, custo: t.custo, prev: t.prev, real: t.real,
      base_prev: t.base_prev, base_ini: t.base_ini, base_fim: t.base_fim, atraso_base: t.atraso_base, atraso_data: t.atraso_data,
      critica: t.critica, kanban: t.kanban, kanban_status: t.kanban_status, responsaveis: t.responsaveis, etiquetas: t.etiquetas, colunas: t.colunas,
      removida_em: null, atualizado_em: agora,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin.from("prevision_tarefa_auria").upsert(rows.slice(i, i + 200), { onConflict: "projeto_id,tarefa_id" });
      if (error) throw new Error("gravar tarefas: " + error.message);
    }
    // sumiram no Prevision → removida_em (nunca apaga)
    const ids = new Set(rows.map((r: any) => r.tarefa_id));
    const { data: exist } = await admin.from("prevision_tarefa_auria").select("id,tarefa_id").eq("projeto_id", v.projeto_id).is("removida_em", null);
    const sumiram = (exist || []).filter((e: any) => !ids.has(e.tarefa_id)).map((e: any) => e.id);
    if (sumiram.length) await admin.from("prevision_tarefa_auria").update({ removida_em: agora }).in("id", sumiram);
    await admin.from("prevision_vinculo_auria").update({ sincronizado_em: agora, sync_erro: null, n_tarefas: rows.length, projeto_nome: pr.nome || v.projeto_nome }).eq("id", v.id);
    return { vinculo: v.id, fase: v.fase, projeto: pr.nome || v.projeto_nome, tarefas: rows.length, removidas: sumiram.length };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    await admin.from("prevision_vinculo_auria").update({ sync_erro: msg.slice(0, 500) }).eq("id", v.id);
    return { vinculo: v.id, fase: v.fase, projeto: v.projeto_nome, erro: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return j({ error: "sem sessão" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Item 77f: modo CRON (pg_cron → pg_net → aqui, com segredo próprio; sem usuário) ──
    //  Sincroniza TODOS os vínculos ativos, de todos os grupos. Segredo: PREVISION_CRON_SECRET
    //  (mesmo valor nos Secrets da função e no Vault do banco).
    const cronSecret = (Deno.env.get("PREVISION_CRON_SECRET") || "").trim();
    const cronHdr = (req.headers.get("x-auria-cron") || "").trim();
    if (cronHdr) {
      if (!cronSecret) return j({ error: "PREVISION_CRON_SECRET não configurada nos Secrets da função" }, 500);
      if (cronHdr !== cronSecret) return j({ error: "segredo do cron inválido (Vault ≠ Secret da função)" }, 403);
      if (!PV_KEY) return j({ ok: false, error: "PREVISION_API_KEY não configurada" }, 500);
      const { data: vincs, error } = await admin.from("prevision_vinculo_auria").select("*").eq("ativo", true);
      if (error) return j({ ok: false, error: error.message }, 500);
      const res = []; for (const v of (vincs || [])) res.push(await syncVinculo(admin, v));
      const erros = res.filter((r: any) => r.erro).length;
      try{ const porEmp: Record<string, any[]> = {}; res.forEach((r: any) => { const v = (vincs || []).find((x: any) => x.id === r.vinculo); if (v) (porEmp[v.empreendimento_id] = porEmp[v.empreendimento_id] || []).push(r); });
        const logs = Object.entries(porEmp).map(([emp, rs]) => ({ empreendimento_id: emp, acao: "sync", detalhe: "Automática: " + rs.map((r: any) => r.fase + ": " + (r.erro ? "erro" : r.tarefas + " tarefas")).join(" · "), por: null, por_nome: "Sincronização automática" }));
        if (logs.length) await admin.from("prevision_log_auria").insert(logs); }catch(_){}
      return j({ ok: true, modo: "cron", vinculos: res.length, erros, sync: res });
    }

    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return j({ error: "sessão inválida" }, 401);
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
      const pr = await projetoTarefas(id);
      return j({ ok: true, projeto: pr });
    }
    // ── Etapa 2 · passo 1: vínculo + sincronização ─────────────────────────
    const empDoUsuario = async (empId: string) => {
      const { data: e } = await admin.from("empreendimentos_auria").select("id,nome,codigo,empresa_id").eq("id", empId).maybeSingle();
      if (!e) throw new Error("empreendimento não encontrado");
      if (perfil.role !== "super_admin" && e.empresa_id !== perfil.empresa_id) throw new Error("empreendimento fora do seu grupo");
      return e;
    };
    if (acao === "sugerir") {
      const e = await empDoUsuario(String(body.empreendimento_id || ""));
      const sigla = String(e.codigo || "").trim().toUpperCase();
      const todos = lista(await pvGet("/incorporation/api/v1/projects"));
      const { data: vincs } = await admin.from("prevision_vinculo_auria").select("id,projeto_id,projeto_nome,fase,padrao,ativo,sincronizado_em,n_tarefas,sync_erro").eq("empreendimento_id", e.id);
      const vinculados = new Set((vincs || []).filter((v: any) => v.ativo).map((v: any) => v.projeto_id));
      const sugest = todos.map((p: any) => ({ ...p, fase: faseDe(p.nome), bate: sigla ? segmentos(p.nome).includes(sigla) : false, vinculado: vinculados.has(p.id) }));
      return j({ ok: true, sigla, sugeridos: sugest.filter((p: any) => p.bate || p.vinculado), todos: sugest, vinculos: vincs || [] });
    }
    if (acao === "vincular") {
      const e = await empDoUsuario(String(body.empreendimento_id || ""));
      const escolhidos: any[] = Array.isArray(body.projetos) ? body.projetos : [];
      const ids = escolhidos.map((p) => String(p.id));
      // desativa os que saíram (não apaga: tarefas espelho ficam com o vínculo inativo)
      const { data: atuais } = await admin.from("prevision_vinculo_auria").select("id,projeto_id,padrao,ativo").eq("empreendimento_id", e.id);
      for (const v of (atuais || [])) if (v.ativo && !ids.includes(v.projeto_id)) await admin.from("prevision_vinculo_auria").update({ ativo: false, padrao: false }).eq("id", v.id);
      for (const p of escolhidos) {
        const { error } = await admin.from("prevision_vinculo_auria").upsert({ empreendimento_id: e.id, projeto_id: String(p.id), projeto_nome: String(p.nome || ""), fase: faseDe(p.nome), plataforma: "incorporacao", ativo: true, criado_por: user.id }, { onConflict: "empreendimento_id,projeto_id" });
        if (error) throw new Error("gravar vínculo: " + error.message);
      }
      // padrão: mantém o existente; senão EXE; senão o primeiro
      const { data: ativos } = await admin.from("prevision_vinculo_auria").select("id,fase,padrao").eq("empreendimento_id", e.id).eq("ativo", true);
      if (ativos && ativos.length && !ativos.some((v: any) => v.padrao)) {
        const pad = ativos.find((v: any) => v.fase === "EXE") || ativos[0];
        await admin.from("prevision_vinculo_auria").update({ padrao: true }).eq("id", pad.id);
      }
      // sincroniza na hora
      const { data: vincs } = await admin.from("prevision_vinculo_auria").select("*").eq("empreendimento_id", e.id).eq("ativo", true);
      const res = []; for (const v of (vincs || [])) res.push(await syncVinculo(admin, v));
      try{ const { data: quem } = await admin.from("usuarios_auria").select("nome,email").eq("id", user.id).maybeSingle();
        await admin.from("prevision_log_auria").insert({ empreendimento_id: e.id, acao: "vinculo", detalhe: "Vínculos: " + ((vincs || []).map((v: any) => v.fase + " " + (v.projeto_nome || "")).join(", ") || "nenhum"), por: user.id, por_nome: (quem && (quem.nome || quem.email)) || null }); }catch(_){ /* log é opcional (tabela do p3) */ }
      return j({ ok: true, vinculos: vincs || [], sync: res });
    }
    if (acao === "sync") {
      let q = admin.from("prevision_vinculo_auria").select("*, empreendimentos_auria!inner(empresa_id)").eq("ativo", true);
      if (body.empreendimento_id) { await empDoUsuario(String(body.empreendimento_id)); q = q.eq("empreendimento_id", String(body.empreendimento_id)); }
      else if (perfil.role !== "super_admin") q = q.eq("empreendimentos_auria.empresa_id", perfil.empresa_id);
      const { data: vincs, error } = await q; if (error) throw new Error(error.message);
      const res = []; for (const v of (vincs || [])) res.push(await syncVinculo(admin, v));
      if (body.empreendimento_id) { try{ const { data: quem } = await admin.from("usuarios_auria").select("nome,email").eq("id", user.id).maybeSingle();
        await admin.from("prevision_log_auria").insert({ empreendimento_id: String(body.empreendimento_id), acao: "sync", detalhe: res.map((r: any) => r.fase + ": " + (r.erro ? "erro" : r.tarefas + " tarefas")).join(" · "), por: user.id, por_nome: (quem && (quem.nome || quem.email)) || null }); }catch(_){} }
      return j({ ok: true, n: res.length, sync: res });
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
