// ============================================================================
//  qr-view — visualização PÚBLICA de uma prancha por QR code (só-leitura).
//  Só devolve a última revisão LIBERADA (status A1/B1). Nunca revisão não liberada.
//  RÁPIDO: UMA chamada ao banco (RPC cde_qr_dados devolve tudo pronto) + assinatura
//  das URLs (R2 local; Supabase Storage 1 chamada). Sem @supabase/supabase-js.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SRK          = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const R2_ACCOUNT_ID= Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY= Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_KEY= Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET    = Deno.env.get("R2_BUCKET") || "auria-cde";
const R2_ENDPOINT  = (Deno.env.get("R2_ENDPOINT") ||
  `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, "");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const H = { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" };

const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY, service: "s3", region: "auto" });
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
async function signR2(path: string, exp = 300) {
  const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${encPath(path)}`);
  url.searchParams.set("X-Amz-Expires", String(exp));
  const s = await r2.sign(new Request(url.toString(), { method: "GET" }), { aws: { signQuery: true } });
  return s.url;
}
async function signSupa(path: string, exp = 300): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/cde/${encPath(path)}`,
    { method: "POST", headers: H, body: JSON.stringify({ expiresIn: exp }) });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));

    // QR do MODELO FEDERADO: { fed: token } → só os .frag da última revisão LIBERADA
    // de cada modelo; o que não está liberado vem só como código em "faltam".
    const fedTok: string = (body?.fed || "").trim();
    if (fedTok) {
      if (!/^[a-f0-9]{16,64}$/i.test(fedTok)) return j({ error: "token inválido" }, 400);
      const rf = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cde_qr_fed_dados`,
        { method: "POST", headers: H, body: JSON.stringify({ p_token: fedTok }) });
      const fd = rf.ok ? await rf.json().catch(() => null) : null;
      if (!fd || !fd.fed) return j({ error: "não encontrado" }, 404);
      const modelos = await Promise.all((fd.modelos || []).map(async (m: any) => ({
        codigo: m.codigo, disciplina: m.disciplina, revisao: m.revisao, aid: m.aid, frag: await signR2(m.frag_path),
      })));
      return j({ ok: true, fed: fd.fed, modelos, faltam: fd.faltam || [], apontamentos: fd.apontamentos || [],
                 hasNewerUnreleased: !!fd.hasNewerUnreleased });
    }

    const token: string = (body?.token || "").trim();
    if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) return j({ error: "token inválido" }, 400);

    // 1) UMA chamada: a RPC devolve doc + revisão liberada + arquivos + apontamentos.
    const rr = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cde_qr_dados`,
      { method: "POST", headers: H, body: JSON.stringify({ p_token: token }) });
    const data = rr.ok ? await rr.json().catch(() => null) : null;
    if (!data || !data.doc) return j({ error: "não encontrado" }, 404);

    const cab = data.doc;
    const lib = data.lib;
    if (!lib) return j({ ok: true, doc: cab, released: null, hasNewerUnreleased: !!data.temRevisoes });

    // 2) Assina PDF (R2 local / Supabase 1 chamada) e IFC/fragments (R2), em paralelo.
    const pdf = data.pdf;
    const [pdfUrl, fragUrl] = await Promise.all([
      pdf?.storage_path ? (pdf.storage_provider === "r2" ? signR2(pdf.storage_path) : signSupa(pdf.storage_path)) : Promise.resolve(null),
      data.frag_path ? signR2(data.frag_path) : Promise.resolve(null),
    ]);

    return j({
      ok: true, doc: cab,
      released: { revisao: lib.revisao, status: lib.status, pdf: pdfUrl, frag: fragUrl },
      apontamentos: data.apontamentos || [],
      hasNewerUnreleased: !!data.hasNewerUnreleased,
    });
  } catch (e) {
    return j({ error: (e as Error).message || String(e) }, 500);
  }
});
