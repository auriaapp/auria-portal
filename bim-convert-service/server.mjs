// ============================================================================
//  Auria — serviço de conversão IFC → Fragments (Cloud Run)
//  ----------------------------------------------------------------------------
//  Serviço de fundo (não é chamado pelo browser): recebe um pedido do CDE
//  (via edge function, nunca direto — o segredo fica só aqui e na edge
//  function), baixa o IFC do R2, converte com o That Open (mesma lógica
//  validada no bim-poc/), sobe o .frag de volta pro R2 ao lado do original,
//  e atualiza o status em cde_arquivo_auria pra o CDE saber quando está pronto.
//
//  A requisição fica ABERTA até a conversão terminar (síncrono) — o Cloud Run
//  só garante CPU alocada enquanto há uma requisição em curso, então é assim
//  que se evita processamento "invisível" sendo pausado no meio. Quem chama
//  (a edge function) dispara e NÃO espera a resposta — o sinal de "terminou"
//  é o frag_status no banco, não a resposta HTTP.
//
//  Variáveis de ambiente exigidas: ver README.md desta pasta.
// ============================================================================
import express from "express";
import { AwsClient } from "aws4fetch";
import * as FRAGS from "@thatopen/fragments";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const PORT = process.env.PORT || 8080;
const TRIGGER_SECRET = process.env.TRIGGER_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET || "auria-cde";
const R2_ENDPOINT = (process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, "");
// Teto de segurança: recusa converter (com erro claro) em vez de arriscar o
// container ser morto por OOM sem deixar rastro. Calibrado com folga sobre a
// medição real (780MB IFC -> 3,2GB de pico; ver bim-poc/) para a memória
// configurada no deploy (ajuste MAX_IFC_MB junto se mudar --memory no deploy).
const MAX_IFC_MB = Number(process.env.MAX_IFC_MB || 1200);

for (const [k, v] of Object.entries({ TRIGGER_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY })) {
  if (!v) { console.error(`[boot] variável de ambiente faltando: ${k}`); process.exit(1); }
}

const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });

// wasm do web-ifc: mesma técnica do bim-poc — aponta pro pacote LOCAL, então
// JS e wasm têm sempre a mesma versão.
const wasmDir = path.dirname(require.resolve("web-ifc")) + path.sep;

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

async function r2Get(objectPath) {
  const url = `${R2_ENDPOINT}/${R2_BUCKET}/${encodePath(objectPath)}`;
  const resp = await r2.fetch(url, { method: "GET" });
  if (!resp.ok) throw new Error(`R2 GET ${resp.status} (${objectPath}): ${(await resp.text().catch(() => "")).slice(0, 300)}`);
  return new Uint8Array(await resp.arrayBuffer());
}
async function r2Put(objectPath, bytes, contentType) {
  const url = `${R2_ENDPOINT}/${R2_BUCKET}/${encodePath(objectPath)}`;
  const headers = contentType ? { "content-type": contentType } : {};
  const resp = await r2.fetch(url, { method: "PUT", headers, body: bytes });
  if (!resp.ok) throw new Error(`R2 PUT ${resp.status} (${objectPath}): ${(await resp.text().catch(() => "")).slice(0, 300)}`);
}

// Update direto via PostgREST (fetch), sem o SDK @supabase/supabase-js: o SDK
// inicializa um RealtimeClient (WebSocket) mesmo sem usar realtime, e isso
// derruba o processo no Node 20 sem WebSocket nativo — não vale a dependência
// inteira só pra um UPDATE.
async function marcarStatus(arquivoId, campos) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/cde_arquivo_auria?id=eq.${encodeURIComponent(arquivoId)}`;
    const resp = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(campos),
    });
    if (!resp.ok) console.error("[db] update falhou:", resp.status, (await resp.text().catch(() => "")).slice(0, 300));
  } catch (e) { console.error("[db] não conseguiu marcar status:", e && e.message || e); }
}

// ── Item 125: indexação do TEXTO dos PDFs no servidor ─────────────────────
//  Antes isso rodava no navegador (pdf.js na fila do CDE): dependia da aba
//  aberta e levava minutos num acúmulo. Aqui é o mesmo caminho do IFC — o banco
//  chama, o serviço baixa, processa e grava.
async function sbGet(tabela, query) {
  const url = `${SUPABASE_URL}/rest/v1/${tabela}?${query}`;
  const resp = await fetch(url, { headers: {
    "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!resp.ok) throw new Error(`PostgREST ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
  return await resp.json();
}
async function sbPatch(tabela, query, campos) {
  const url = `${SUPABASE_URL}/rest/v1/${tabela}?${query}`;
  const resp = await fetch(url, { method: "PATCH", headers: {
    "Content-Type": "application/json", "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Prefer": "return=minimal" }, body: JSON.stringify(campos) });
  if (!resp.ok) throw new Error(`PostgREST ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
}
// O arquivo pode estar no R2 (pesados) ou no Storage do Supabase (bucket cde).
async function baixarArquivo(storagePath, provider) {
  if ((provider || "supabase") === "r2") return await r2Get(storagePath);
  const url = `${SUPABASE_URL}/storage/v1/object/cde/${encodePath(storagePath)}`;
  const resp = await fetch(url, { headers: {
    "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!resp.ok) throw new Error(`Storage ${resp.status} (${storagePath})`);
  return new Uint8Array(await resp.arrayBuffer());
}
// pdfjs é carregado sob demanda: quem só converte IFC não paga por ele.
let _pdfjs = null;
async function pdfjs() {
  if (!_pdfjs) _pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return _pdfjs;
}
const MAX_PAGINAS = Number(process.env.MAX_PDF_PAGINAS || 80);
const MAX_TEXTO  = Number(process.env.MAX_PDF_TEXTO || 20000);
async function extrairTexto(bytes) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false }).promise;
  const n = Math.min(doc.numPages, MAX_PAGINAS);
  const partes = [];
  for (let i = 1; i <= n; i++) {
    try {
      const pg = await doc.getPage(i);
      const tc = await pg.getTextContent();
      partes.push(tc.items.map((it) => it.str).join(" "));
    } catch (_) { /* página ilegível não invalida o resto */ }
  }
  try { await doc.destroy(); } catch (_) {}
  return partes.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO);
}
// Indexa UM documento: acha o PDF principal da revisão mais recente e grava.
async function indexarDocumento(docId) {
  const revs = await sbGet("cde_revisao_auria",
    `documento_id=eq.${docId}&select=id,recebido_em&order=recebido_em.desc&limit=1`);
  if (!revs.length) { await sbPatch("cde_documento_auria", `id=eq.${docId}`, { texto_busca: "", texto_em: new Date().toISOString() }); return { doc: docId, vazio: true, motivo: "sem revisão" }; }
  const arqs = await sbGet("cde_arquivo_auria",
    `revisao_id=eq.${revs[0].id}&select=nome,extensao,storage_path,storage_provider,eh_principal`);
  const pdfs = arqs.filter((a) => String(a.extensao || "").toLowerCase() === "pdf");
  const pdf = pdfs.find((a) => a.eh_principal) || pdfs[0];
  if (!pdf) { await sbPatch("cde_documento_auria", `id=eq.${docId}`, { texto_busca: "", texto_em: new Date().toISOString() }); return { doc: docId, vazio: true, motivo: "sem PDF" }; }
  const bytes = await baixarArquivo(pdf.storage_path, pdf.storage_provider);
  const texto = await extrairTexto(bytes);
  await sbPatch("cde_documento_auria", `id=eq.${docId}`, { texto_busca: texto, texto_em: new Date().toISOString() });
  return { doc: docId, chars: texto.length };
}

// Progresso: o IfcImporter reporta 4 fases sequenciais (geometrias, atributos,
// relações, conversão final), cada uma indo de 0 a 1 — combinamos num único
// 0-100 assumindo peso igual entre elas (não temos dado real do custo relativo
// de cada fase, mas é uma aproximação razoável pra uma barra de progresso).
const FASES_IFC = ["geometries", "attributes", "relations", "conversion"];
const progressoPorArquivo = new Map(); // arquivoId -> { pct, ts } — throttle do PATCH
// Cronômetro por fase. Existe para diagnóstico: o tempo TOTAL não distingue
// "modelo com muita geometria" de "modelo com muito dado", e sem essa quebra
// não dá para dizer por que um IFC pequeno demora mais que um grande.
const fasesPorArquivo = new Map(); // arquivoId -> { atual, t0, tempos:{} }

function marcoFase(arquivoId, fase) {
  const agora = Date.now();
  let f = fasesPorArquivo.get(arquivoId);
  if (!f) { f = { atual: null, t0: agora, tempos: {} }; fasesPorArquivo.set(arquivoId, f); }
  if (f.atual === fase) return;
  if (f.atual) {
    const seg = (agora - f.t0) / 1000;
    f.tempos[f.atual] = Number(((f.tempos[f.atual] || 0) + seg).toFixed(1));
    console.log(`[fase] ${f.atual} levou ${seg.toFixed(1)}s (arquivo=${arquivoId})`);
  }
  f.atual = fase; f.t0 = agora;
}
function fecharFases(arquivoId) {
  const f = fasesPorArquivo.get(arquivoId);
  if (!f) return null;
  if (f.atual) f.tempos[f.atual] = Number(((f.tempos[f.atual] || 0) + (Date.now() - f.t0) / 1000).toFixed(1));
  fasesPorArquivo.delete(arquivoId);
  return f.tempos;
}

function reportarProgresso(arquivoId, progress, data) {
  const idx = FASES_IFC.indexOf(data && data.process);
  if (idx < 0) return;
  marcoFase(arquivoId, data.process);
  const p = Math.max(0, Math.min(1, progress || 0));
  const pct = Math.round(((idx + p) / FASES_IFC.length) * 100);

  const anterior = progressoPorArquivo.get(arquivoId) || { pct: -1, ts: 0 };
  const agora = Date.now();
  if (pct === anterior.pct) return;
  if (pct - anterior.pct < 5 && agora - anterior.ts < 3000) return;

  progressoPorArquivo.set(arquivoId, { pct, ts: agora });
  // frag_heartbeat: sinal de vida para o watchdog (supabase_cde_frag_watchdog.sql).
  // Sem ele, um container morto por memória/timeout deixaria o arquivo em
  // "processando…" para sempre — o watchdog reenfileira quem parou de carimbar.
  marcarStatus(arquivoId, { frag_progress: pct, frag_heartbeat: new Date().toISOString() }).catch(() => {});
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Healthcheck — o Cloud Run usa isso pra saber se o container subiu.
app.get("/", (_req, res) => res.status(200).send("ok"));

app.post("/convert", async (req, res) => {
  const secret = req.get("X-Auria-Secret");
  if (!secret || secret !== TRIGGER_SECRET) return res.status(401).json({ error: "não autorizado" });

  const { arquivoId, path: ifcPath } = req.body || {};
  if (!arquivoId || !ifcPath) return res.status(400).json({ error: "arquivoId e path são obrigatórios" });
  if (!/\.ifc$/i.test(ifcPath)) return res.status(400).json({ error: "só converte .ifc" });

  const fragPath = ifcPath.replace(/\.ifc$/i, ".frag");
  const t0 = Date.now();
  console.log(`[convert] iniciando arquivo=${arquivoId} path=${ifcPath}`);

  try {
    await marcarStatus(arquivoId, { frag_status: "processando", frag_error: null, frag_progress: 0,
      frag_inicio: new Date().toISOString(), frag_heartbeat: new Date().toISOString() });
    // batimento fixo a cada 60s: as fases longas do IfcImporter ficam minutos sem reportar progresso
    var bat = setInterval(() => { marcarStatus(arquivoId, { frag_heartbeat: new Date().toISOString() }).catch(() => {}); }, 60000);

    const ifcBytes = await r2Get(ifcPath);
    const mb = ifcBytes.length / 1048576;
    console.log(`[convert] IFC baixado: ${mb.toFixed(1)} MB`);
    if (mb > MAX_IFC_MB) {
      throw new Error(`IFC de ${mb.toFixed(0)}MB excede o limite deste serviço (${MAX_IFC_MB}MB) — considere dividir o modelo por disciplina/pavimento.`);
    }

    const serializer = new FRAGS.IfcImporter();
    serializer.wasm = { absolute: true, path: wasmDir };
    const fragBytes = await serializer.process({
      bytes: ifcBytes,
      progressCallback: (progress, data) => reportarProgresso(arquivoId, progress, data),
    });

    const fases = fecharFases(arquivoId);
    await r2Put(fragPath, new Uint8Array(fragBytes), "application/octet-stream");
    const seg = (Date.now() - t0) / 1000;
    console.log(`[convert] concluído em ${seg.toFixed(1)}s — .frag ${(fragBytes.byteLength / 1048576).toFixed(1)} MB`
      + ` — ${mb.toFixed(1)}MB de IFC, ${(seg/mb).toFixed(2)}s por MB`);
    if (fases) console.log(`[convert] por fase: ${JSON.stringify(fases)}`);

    clearInterval(bat);
    await marcarStatus(arquivoId, { frag_status: "pronto", frag_path: fragPath, frag_error: null, frag_progress: null, frag_tentativas: 0 });
    // 74b: tamanho do .frag (painel do CEO › Uso & armazenamento). Em chamada separada: se a coluna ainda não
    // existir no banco (supabase_ceo_uso_frag.sql), o status "pronto" acima já foi gravado.
    await marcarStatus(arquivoId, { frag_bytes: fragBytes.byteLength });
    res.status(200).json({ success: true, fragPath, tempoSeg: Number(seg.toFixed(1)) });
  } catch (e) {
    clearInterval(bat);
    const msg = String((e && e.message) || e).slice(0, 500);
    console.error(`[convert] falhou (arquivo=${arquivoId}):`, msg);
    await marcarStatus(arquivoId, { frag_status: "erro", frag_error: msg, frag_progress: null });
    res.status(500).json({ error: msg });
  } finally {
    progressoPorArquivo.delete(arquivoId);
    fasesPorArquivo.delete(arquivoId);
  }
});

// Item 125: indexa o texto de UM documento (chamado pelo gatilho do upload).
app.post("/index-pdf", async (req, res) => {
  const secret = req.get("X-Auria-Secret");
  if (!secret || secret !== TRIGGER_SECRET) return res.status(401).json({ error: "não autorizado" });
  const { documentoId } = req.body || {};
  if (!documentoId) return res.status(400).json({ error: "documentoId é obrigatório" });
  try {
    const r = await indexarDocumento(documentoId);
    console.log(`[index] ${documentoId}: ${r.chars != null ? r.chars + " caracteres" : "vazio (" + r.motivo + ")"}`);
    res.status(200).json({ success: true, ...r });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    console.error(`[index] falhou (${documentoId}):`, msg);
    res.status(500).json({ error: msg });
  }
});

// Lote: pega os documentos ainda sem texto_em e processa até `limite`.
// Serve para o acúmulo e para reprocessar quando a extração melhora.
app.post("/index-pdf-lote", async (req, res) => {
  const secret = req.get("X-Auria-Secret");
  if (!secret || secret !== TRIGGER_SECRET) return res.status(401).json({ error: "não autorizado" });
  const limite = Math.min(Number((req.body || {}).limite || 25), 200);
  const emp = (req.body || {}).empreendimentoId;
  try {
    const filtro = `texto_em=is.null&select=id,codigo${emp ? `&empreendimento_id=eq.${emp}` : ""}&limit=${limite}`;
    const docs = await sbGet("cde_documento_auria", filtro);
    let ok = 0, vazios = 0, falhas = 0;
    for (const d of docs) {
      try { const r = await indexarDocumento(d.id); if (r.vazio || !r.chars) vazios++; else ok++; }
      catch (e) { falhas++; console.error(`[index-lote] ${d.codigo || d.id}:`, String((e && e.message) || e).slice(0, 200)); }
    }
    const restam = await sbGet("cde_documento_auria", `texto_em=is.null&select=id${emp ? `&empreendimento_id=eq.${emp}` : ""}&limit=1000`);
    console.log(`[index-lote] ${ok} com texto · ${vazios} sem texto · ${falhas} falha(s) · restam ${restam.length}`);
    res.status(200).json({ success: true, processados: docs.length, com_texto: ok, sem_texto: vazios, falhas, restam: restam.length });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    console.error("[index-lote] falhou:", msg);
    res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => console.log(`[boot] ouvindo na porta ${PORT}`));
