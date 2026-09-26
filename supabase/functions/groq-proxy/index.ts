// ============================================================================
//  ia-proxy — proxy autenticado de IA (visão + texto) para o Auria.
//  (a função ainda tem slug "dynamic-task" no Supabase; o app chama por esse slug)
//
//  PRINCIPAL: Google Gemini (Flash) — visão/OCR forte de prancha, limite grátis
//  ~1M tokens/min (o Groq grátis trava em 8000/min, e a imagem de uma prancha
//  já passa disso). Chave FIXA (não expira): secret GEMINI_API_KEY.
//  RESERVA:   Groq (Llama/qwen) — usado se o Gemini falhar OU se não houver
//  GEMINI_API_KEY configurada (assim, sem a chave, nada muda e o Groq segue).
//
//  O cliente manda o MESMO corpo de sempre: { messages, hasImage?, temperature?,
//  max_tokens? } (mensagens no formato OpenAI: system + user com content string
//  ou array [{type:'text'|'image_url', ...}]). A chave nunca vai ao browser.
//
//  Secrets (painel Supabase → Edge Functions → Secrets):
//    GEMINI_API_KEY=AIza...   (https://aistudio.google.com/apikey)
//    GROQ_API_KEY=gsk_...     (reserva; já configurada)
//  Deploy: colar no editor da função e "Deploy updates" (ou `supabase functions deploy`).
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY       = Deno.env.get("SUPABASE_ANON_KEY")!;
const GROQ_API_KEY   = Deno.env.get("GROQ_API_KEY") || "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

// ════════════════════════════════════════════════════════════════════════════
//  GEMINI (principal)
// ════════════════════════════════════════════════════════════════════════════
// Ordem de preferência. O 2.5-flash tem "thinking" (raciocínio) — desligamos com
// thinkingBudget:0 p/ resposta direta e barata; o 2.0-flash nem tem thinking.
const GEMINI_PREF = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];

// Traduz as mensagens estilo OpenAI para o formato do Gemini.
function paraGemini(messages: any[]): { systemText: string; contents: any[] } {
  let systemText = "";
  const contents: any[] = [];
  const textoDe = (c: any): string =>
    typeof c === "string" ? c
      : Array.isArray(c) ? c.filter((x) => x?.type === "text").map((x) => x.text || "").join("\n")
      : "";

  for (const m of messages) {
    if (m?.role === "system") { systemText += (systemText ? "\n" : "") + textoDe(m.content); continue; }
    const role = m?.role === "assistant" ? "model" : "user";
    const parts: any[] = [];
    if (typeof m?.content === "string") {
      if (m.content) parts.push({ text: m.content });
    } else if (Array.isArray(m?.content)) {
      for (const it of m.content) {
        if (it?.type === "text") { if (it.text) parts.push({ text: it.text }); }
        else if (it?.type === "image_url") {
          const url = it?.image_url?.url || "";
          const mt = /^data:([^;]+);base64,/.exec(url);
          if (mt) parts.push({ inline_data: { mime_type: mt[1], data: url.slice(mt[0].length) } });
        }
      }
    }
    if (parts.length) contents.push({ role, parts });
  }
  return { systemText, contents };
}

// Chama o Gemini. Retorna { content, model } no sucesso, ou { erro } na falha,
// ou null se não há chave (→ cai no Groq sem ruído).
// ════════════════════════════════════════════════════════════════════════════
//  TEMPO — item 135 (2026-09-25)
//  Nenhum fetch daqui tinha timeout. Com o Gemini pendurado, a cadeia inteira
//  (3 modelos Gemini → lista de modelos do Groq → N candidatos) ficava presa e
//  o usuário via "carregando" para sempre, sem erro nenhum. Agora cada chamada
//  tem teto próprio e a requisição tem orçamento total: estourou, devolve o
//  diagnóstico em vez de pendurar.
// ════════════════════════════════════════════════════════════════════════════
const T_CHAMADA = 20000;   // teto de UMA tentativa de modelo
const T_TOTAL   = 45000;   // orçamento da requisição inteira

async function fetchT(url: string, init: RequestInit, deadline: number, teto = T_CHAMADA): Promise<Response> {
  const resta = deadline - Date.now();
  if (resta <= 0) throw new Error("tempo esgotado antes da chamada");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.min(teto, resta));
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`sem resposta em ${Math.round(Math.min(teto, resta)/1000)}s`);
    throw e;
  } finally { clearTimeout(t); }
}

async function chamarGemini(messages: any[], temperature: number, max_tokens: number, deadline: number, trilha: string[]):
  Promise<{ content?: string; model?: string; erro?: string } | null> {
  if (!GEMINI_API_KEY) return null;
  const { systemText, contents } = paraGemini(messages);
  if (!contents.length) return { erro: "sem conteúdo p/ enviar" };

  let ultimo = "sem modelo";
  for (const model of GEMINI_PREF) {
    if (Date.now() >= deadline) { ultimo = "tempo esgotado"; break; }
    const body: any = {
      contents,
      generationConfig: { temperature, maxOutputTokens: max_tokens },
    };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    if (/2\.5|flash-latest/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    try {
      const t0 = Date.now();
      const r = await fetchT(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        deadline,
      );
      trilha.push(`gemini/${model}: HTTP ${r.status} em ${Date.now() - t0}ms`);
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        const cand = data?.candidates?.[0];
        const txt = (cand?.content?.parts || []).map((p: any) => p?.text || "").join("").trim();
        if (txt) return { content: txt, model: "google/" + model };
        // Vazio: bloqueio de segurança ou corte → tenta o próximo modelo.
        ultimo = "resposta vazia" + (cand?.finishReason ? ` (${cand.finishReason})` : "") +
                 (data?.promptFeedback?.blockReason ? ` [bloqueio: ${data.promptFeedback.blockReason}]` : "");
        continue;
      }
      ultimo = data?.error?.message || `HTTP ${r.status}`;
      // 400/404 (modelo/param) → tenta o próximo; 429/500 → idem (próximo/Groq).
    } catch (e) {
      ultimo = String((e as Error)?.message || e);
      trilha.push(`gemini/${model}: ${ultimo}`);
    }
  }
  return { erro: ultimo };
}

// ════════════════════════════════════════════════════════════════════════════
//  GROQ (reserva) — auto-cura por descoberta dinâmica de modelos vivos.
// ════════════════════════════════════════════════════════════════════════════
const VISION_PREF = [
  "qwen/qwen3.6-27b",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
];
const TEXT_PREF = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "qwen/qwen3.6-27b",
];
const VISION_FALLBACK = [...VISION_PREF];
const TEXT_FALLBACK   = [...TEXT_PREF];

const NAO_CHAT = /whisper|tts|guard|embed|moderation/i;
const EH_VISAO = /llama-4|scout|maverick|vision|llava|pixtral|multimodal|[-_]vl\b|[-_]vl[-_]|qwen.*vl|qwen3\.6|qwen3-omni|qwen.*omni/i;

let MODELS_CACHE: { ids: string[]; ts: number } | null = null;
const CACHE_MS = 30 * 60 * 1000;

async function modelosVivos(deadline: number, force = false): Promise<string[]> {
  const agora = Date.now();
  if (!force && MODELS_CACHE && (agora - MODELS_CACHE.ts) < CACHE_MS) return MODELS_CACHE.ids;
  try {
    const r = await fetchT("https://api.groq.com/openai/v1/models", {
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
    }, deadline, 8000);
    const data = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(data?.data)) {
      const ids = data.data.filter((m: any) => m?.id && m?.active !== false).map((m: any) => String(m.id));
      MODELS_CACHE = { ids, ts: agora };
      return ids;
    }
  } catch (_e) { /* rede: cai no fallback abaixo */ }
  return MODELS_CACHE?.ids ?? [];
}

function filaCandidatos(vivos: string[], hasImage: boolean): string[] {
  const vivosSet = new Set(vivos);
  const pref = hasImage ? VISION_PREF : TEXT_PREF;
  const fila: string[] = [];
  for (const id of pref) if (vivosSet.has(id)) fila.push(id);
  if (vivos.length) {
    const candidatos = vivos.filter((id) => !NAO_CHAT.test(id));
    const rankeados = candidatos
      .filter((id) => hasImage ? EH_VISAO.test(id) : true)
      .sort((a, b) => pontua(b, hasImage) - pontua(a, hasImage));
    for (const id of rankeados) if (!fila.includes(id)) fila.push(id);
    return fila;
  }
  return hasImage ? VISION_FALLBACK : TEXT_FALLBACK;
}

function pontua(id: string, hasImage: boolean): number {
  let s = 0;
  if (/llama/i.test(id)) s += 10;
  if (/llama-4/i.test(id)) s += 8;
  if (/llama-3\.3/i.test(id)) s += 6;
  if (/70b/i.test(id)) s += 5;
  if (/instruct|versatile/i.test(id)) s += 2;
  if (/8b|instant|mini/i.test(id)) s -= 2;
  if (/preview/i.test(id)) s -= 1;
  if (hasImage && EH_VISAO.test(id)) s += 4;
  return s;
}

const EH_RACIOCINIO = /qwen3|deepseek|[-_]r1\b|qwq/i;

// Retorna { content, model } no sucesso ou { erro } na falha.
async function chamarGroq(messages: any[], hasImage: boolean, temperature: number, max_tokens: number, deadline: number, trilha: string[]):
  Promise<{ content?: string; model?: string; erro?: string }> {
  if (!GROQ_API_KEY) return { erro: "GROQ_API_KEY não configurada" };
  let vivos = await modelosVivos(deadline);
  let candidatos = filaCandidatos(vivos, hasImage);
  if (hasImage && vivos.length && !candidatos.length) {
    return { erro: "conta Groq sem modelo com imagem. Ativos: " + vivos.join(", ") };
  }
  let ultimoErro = "nenhum modelo disponível";
  let jaRedescobriu = false;
  for (let i = 0; i < candidatos.length; i++) {
    const model = candidatos[i];
    if (Date.now() >= deadline) { ultimoErro = "tempo esgotado"; break; }
    try {
      const reqBody: Record<string, unknown> = { model, messages, temperature, max_tokens };
      if (EH_RACIOCINIO.test(model)) reqBody.reasoning_effort = "none";
      let r = await fetchT("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      }, deadline);
      trilha.push(`groq/${model}: HTTP ${r.status}`);
      if (!r.ok && r.status === 400 && reqBody.reasoning_effort) {
        delete reqBody.reasoning_effort;
        r = await fetchT("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        }, deadline);
      }
      const data = await r.json().catch(() => ({}));
      if (r.ok && data?.choices?.length) {
        return { content: (data.choices[0].message?.content || "").trim(), model };
      }
      ultimoErro = data?.error?.message || `HTTP ${r.status}`;
      if (r.status === 401 || r.status === 403) break;
      if ((r.status === 400 || r.status === 404) && !jaRedescobriu) {
        jaRedescobriu = true;
        vivos = await modelosVivos(deadline, true);
        candidatos = filaCandidatos(vivos, hasImage);
        i = -1;
        continue;
      }
    } catch (e) {
      ultimoErro = String(e);
    }
  }
  const diag = vivos.length ? " | modelos ativos: " + vivos.join(", ") : "";
  return { erro: ultimoErro + diag };
}

// ════════════════════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!GEMINI_API_KEY && !GROQ_API_KEY) return json({ error: "Nenhuma IA configurada (defina GEMINI_API_KEY ou GROQ_API_KEY)." }, 500);

    // 1) Exige usuário autenticado (qualquer papel logado do Auria).
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Não autenticado." }, 401);

    // 2) Corpo: mensagens (formato OpenAI) + flags.
    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages) ? body.messages : null;
    if (!messages || !messages.length) return json({ error: "messages ausente." }, 400);
    const hasImage    = !!body?.hasImage;
    // Modo diagnóstico: o SERVIDOR diz o que aconteceu (qual modelo respondeu,
    // quanto demorou, que erro veio). Nunca devolve a chave — ela nem sai daqui.
    const diag        = body?.diag === true;
    const deadline    = Date.now() + T_TOTAL;
    const trilha: string[] = [];
    const temperature = typeof body?.temperature === "number" ? body.temperature : 0.2;
    const max_tokens  = typeof body?.max_tokens === "number" ? body.max_tokens : 800;

    // 3) PRINCIPAL: Gemini. (null = sem chave → pula direto pro Groq, sem erro.)
    const g = await chamarGemini(messages, temperature, max_tokens, deadline, trilha);
    if (g && g.content) return json(diag ? { content: g.content, model: g.model, trilha } : { content: g.content, model: g.model });
    const erroGemini = g?.erro || (GEMINI_API_KEY ? "" : "sem GEMINI_API_KEY");

    // 4) RESERVA: Groq.
    const q = await chamarGroq(messages, hasImage, temperature, max_tokens, deadline, trilha);
    if (q.content) return json(diag ? { content: q.content, model: q.model, trilha } : { content: q.content, model: q.model });

    // 5) Ambos falharam: devolve o diagnóstico dos dois.
    const partes = [];
    if (erroGemini) partes.push("Gemini: " + erroGemini);
    if (q.erro)     partes.push("Groq: " + q.erro);
    return json({ error: "IA indisponível — " + partes.join(" | "),
                  tempo_ms: T_TOTAL - (deadline - Date.now()), trilha }, 502);

  } catch (err) {
    console.error("[ia-proxy]", String(err));
    return json({ error: String(err) }, 500);
  }
});
