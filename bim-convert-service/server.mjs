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
  marcarStatus(arquivoId, { frag_progress: pct }).catch(() => {});
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
    await marcarStatus(arquivoId, { frag_status: "processando", frag_error: null, frag_progress: 0 });

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

    await marcarStatus(arquivoId, { frag_status: "pronto", frag_path: fragPath, frag_error: null, frag_progress: null });
    // 74b: tamanho do .frag (painel do CEO › Uso & armazenamento). Em chamada separada: se a coluna ainda não
    // existir no banco (supabase_ceo_uso_frag.sql), o status "pronto" acima já foi gravado.
    await marcarStatus(arquivoId, { frag_bytes: fragBytes.byteLength });
    res.status(200).json({ success: true, fragPath, tempoSeg: Number(seg.toFixed(1)) });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 500);
    console.error(`[convert] falhou (arquivo=${arquivoId}):`, msg);
    await marcarStatus(arquivoId, { frag_status: "erro", frag_error: msg, frag_progress: null });
    res.status(500).json({ error: msg });
  } finally {
    progressoPorArquivo.delete(arquivoId);
    fasesPorArquivo.delete(arquivoId);
  }
});

app.listen(PORT, () => console.log(`[boot] ouvindo na porta ${PORT}`));
