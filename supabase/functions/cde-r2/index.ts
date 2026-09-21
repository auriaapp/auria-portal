// ============================================================================
//  cde-r2 — presigned URLs para o bucket privado R2 (auria-cde)
//  ----------------------------------------------------------------------------
//  Recebe do browser um pedido de upload OU download e devolve uma URL curta
//  (5min) assinada com SigV4 para o browser bater direto no Cloudflare R2.
//  Nada trafega por este servidor — só a assinatura.
//
//  A permissão é validada com a MESMA função SQL usada pelo bucket Supabase
//  (cde_r2_pode), então analista/gerente/super_admin e projetistas seguem
//  exatamente as mesmas regras de acesso (incluindo concessões do analista).
//
//  Requer os secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//                     R2_BUCKET, R2_ENDPOINT.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY       = Deno.env.get("SUPABASE_ANON_KEY")!;
const R2_ACCOUNT_ID  = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY  = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_KEY  = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET      = Deno.env.get("R2_BUCKET") || "auria-cde";
const R2_ENDPOINT    = (Deno.env.get("R2_ENDPOINT") ||
  `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/,"");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// aws4fetch cuida do SigV4 completo (canonicalização + assinatura + query params).
const r2 = new AwsClient({
  accessKeyId:     R2_ACCESS_KEY,
  secretAccessKey: R2_SECRET_KEY,
  service: "s3",
  region:  "auto",         // R2 usa "auto"
});

// Presigned URL: assina uma requisição sem body e devolve a URL com os params
// (X-Amz-Signature etc). O browser depois faz PUT/GET nessa URL diretamente.
async function presign(method: "GET"|"PUT", path: string, contentType?: string, expiresSec = 300) {
  const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${encodePath(path)}`);
  url.searchParams.set("X-Amz-Expires", String(expiresSec));
  const headers: Record<string,string> = {};
  if (method === "PUT" && contentType) headers["content-type"] = contentType;
  const signed = await r2.sign(
    new Request(url.toString(), { method, headers }),
    { aws: { signQuery: true } },
  );
  return signed.url;
}

// Codifica cada segmento do path sem transformar "/" — mantém a estrutura
// <emp>/<codigo>/<revisao>/<arquivo>.
function encodePath(p: string) {
  return p.split("/").map(encodeURIComponent).join("/");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    // 1) Autentica o caller — o JWT tem que estar presente.
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return j({ error: "sem token" }, 401);
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: cu, error: cuErr } = await caller.auth.getUser();
    if (cuErr || !cu?.user) return j({ error: "não autenticado" }, 401);

    // 2) Lê o pedido.
    const body = await req.json().catch(() => ({}));
    const action: string = body?.action;         // "upload" | "download" | "frag-sizes"
    const path:   string = body?.path;

    // 74b: mede os .frag já convertidos que ainda não têm tamanho gravado (HEAD no R2) — só super_admin
    if (action === "frag-sizes") {
      const { data: perfil } = await caller.from("usuarios_auria").select("role").eq("id", cu.user.id).maybeSingle();
      if (!perfil || perfil.role !== "super_admin") return j({ error: "só o administrador do Auria" }, 403);
      const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: arqs, error: aErr } = await admin.from("cde_arquivo_auria").select("id,frag_path").eq("frag_status", "pronto").not("frag_path", "is", null).is("frag_bytes", null).limit(200);
      if (aErr) return j({ error: aErr.message + (/frag_bytes/.test(aErr.message) ? " — rode supabase_ceo_uso_frag.sql" : "") }, 500);
      let ok = 0, falhas = 0, bytes = 0;
      for (const a of (arqs || [])) {
        try {
          const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${encodePath(a.frag_path)}`);
          const signed = await r2.sign(new Request(url.toString(), { method: "HEAD" }));
          const r = await fetch(signed);
          const len = Number(r.headers.get("content-length") || 0);
          if (!r.ok || !len) { falhas++; continue; }
          await admin.from("cde_arquivo_auria").update({ frag_bytes: len }).eq("id", a.id); ok++; bytes += len;
        } catch (_) { falhas++; }
      }
      return j({ ok: true, medidos: ok, falhas, bytes, restantes: (arqs || []).length === 200 });
    }
    const contentType: string | undefined = body?.contentType;
    if (!path || (action !== "upload" && action !== "download")) {
      return j({ error: "parâmetros inválidos" }, 400);
    }
    // Bloqueia paths absolutos ou com traversal — o gate no banco também rejeita,
    // mas devolvemos 400 direto p/ economizar a viagem.
    if (path.startsWith("/") || path.includes("..") || path.length > 512) {
      return j({ error: "path inválido" }, 400);
    }

    // 3) Valida a permissão usando a MESMA função da RLS do Supabase.
    const write = action === "upload";
    const { data: pode, error: podeErr } = await caller.rpc("cde_r2_pode", { p_path: path, p_write: write });
    if (podeErr) return j({ error: "falha ao validar permissão: " + podeErr.message }, 500);
    if (!pode)   return j({ error: "sem permissão para este caminho" }, 403);

    // 4) Gera a URL assinada.
    const url = await presign(write ? "PUT" : "GET", path, contentType, 300);
    return j({ url, method: write ? "PUT" : "GET", expiresIn: 300, provider: "r2" });
  } catch (e) {
    return j({ error: (e as Error).message || String(e) }, 500);
  }
});
