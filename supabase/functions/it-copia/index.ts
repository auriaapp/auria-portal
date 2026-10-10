// ============================================================================
//  it-copia — entrega o PDF da biblioteca normativa do grupo, CARIMBADO.
//  ----------------------------------------------------------------------------
//  Quem não mantém a biblioteca não lê o arquivo cru no R2 (cde_r2_pode bloqueia
//  _its/). Tudo passa por aqui:
//    modo "ver"   → visualização; carimbo "CÓPIA NÃO CONTROLADA" + nome/data
//                   (registra em grupo_it_visualizacao_auria)
//    modo "copia" → cópia controlada p/ uma obra + responsável + quantidade;
//                   registra em grupo_it_copia_auria e carimba nº/obra/resp.
//  A permissão é decidida no banco (it_ver_path / it_copia_registrar), com o
//  JWT do próprio usuário.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { PDFDocument, StandardFonts, rgb, degrees } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const R2_ACCOUNT   = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_BUCKET    = Deno.env.get("R2_BUCKET") || "auria-cde";
const R2_ENDPOINT  = (Deno.env.get("R2_ENDPOINT") || `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`).replace(/\/+$/, "");
const r2 = new AwsClient({ accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!, secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!, service: "s3", region: "auto" });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-copia-numero",
};
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
// Helvetica padrão só cobre WinAnsi: troca o que ela não desenha.
const ansi = (s: string) => String(s || "").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return j({ error: "sem token" }, 401);
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: cu } = await caller.auth.getUser();
    if (!cu?.user) return j({ error: "não autenticado" }, 401);

    const b = await req.json().catch(() => ({}));
    const modo = b?.modo === "copia" ? "copia" : "ver";
    if (!b?.revisao_id) return j({ error: "revisão não informada" }, 400);
    const hoje = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

    let path = "", linhas: string[] = [], faixa = "", numero: number | null = null;
    if (modo === "copia") {
      const { data, error } = await caller.rpc("it_copia_registrar", {
        p_revisao: b.revisao_id, p_emp: b.empreendimento_id, p_resp: b.responsavel_id, p_qtd: Number(b.quantidade) || 1 });
      if (error) return j({ error: error.message }, 403);
      const c = data?.[0]; if (!c) return j({ error: "não foi possível registrar a cópia" }, 403);
      path = c.arquivo_path; numero = c.numero;
      faixa = `COPIA CONTROLADA N. ${c.numero}`;
      linhas = [`${c.codigo} rev. ${c.revisao} - Obra: ${c.obra} - Responsavel: ${c.responsavel}`,
                `Emitida por ${c.emitente} em ${hoje}. Valida enquanto esta for a revisao vigente.`];
    } else {
      const { data, error } = await caller.rpc("it_ver_path", { p_revisao: b.revisao_id });
      if (error) return j({ error: error.message }, 403);
      const v = data?.[0]; if (!v) return j({ error: "sem permissão" }, 403);
      path = v.arquivo_path;
      faixa = v.vigente ? "COPIA NAO CONTROLADA" : "REVISAO OBSOLETA - SOMENTE CONSULTA";
      linhas = [`${v.codigo} rev. ${v.revisao} - visualizado por ${v.usuario} em ${hoje}`,
                v.vigente ? "Para uso na obra, emita a copia controlada." : "Nao usar na obra."];
    }
    if (!path) return j({ error: "documento sem arquivo" }, 404);

    const signed = await r2.sign(new Request(`${R2_ENDPOINT}/${R2_BUCKET}/${encodePath(path)}`, { method: "GET" }));
    const resp = await fetch(signed);
    if (!resp.ok) return j({ error: "falha ao ler o arquivo (" + resp.status + ")" }, 502);

    const pdf = await PDFDocument.load(await resp.arrayBuffer(), { ignoreEncryption: true });
    const fb = await pdf.embedFont(StandardFonts.HelveticaBold), fr = await pdf.embedFont(StandardFonts.Helvetica);
    const cor = modo === "copia" ? rgb(0.11, 0.23, 0.37) : rgb(0.75, 0.22, 0.17);
    for (const pg of pdf.getPages()) {
      const { width: w, height: h } = pg.getSize();
      const s = Math.max(0.8, Math.min(w, h) / 595);           // escala p/ folhas grandes (A1/A0)
      // faixa no rodapé
      pg.drawRectangle({ x: 0, y: 0, width: w, height: 30 * s, color: rgb(1, 1, 1), opacity: 0.85 });
      pg.drawText(ansi(faixa), { x: 10 * s, y: 17 * s, size: 9 * s, font: fb, color: cor });
      pg.drawText(ansi(linhas[0]), { x: 10 * s, y: 9 * s, size: 6.5 * s, font: fr, color: rgb(0.2, 0.25, 0.33) });
      pg.drawText(ansi(linhas[1]), { x: 10 * s, y: 2.5 * s, size: 6 * s, font: fr, color: rgb(0.4, 0.45, 0.5) });
      // marca d'água diagonal discreta
      const t = ansi(faixa), sz = 34 * s, tw = fb.widthOfTextAtSize(t, sz);
      pg.drawText(t, { x: w / 2 - tw / 2 * 0.7, y: h / 2 - tw / 2 * 0.7, size: sz, font: fb, color: cor, opacity: 0.08, rotate: degrees(45) });
    }
    const out = await pdf.save();
    return new Response(out, { headers: { ...CORS, "Content-Type": "application/pdf", ...(numero ? { "x-copia-numero": String(numero) } : {}) } });
  } catch (e) {
    return j({ error: (e as Error).message || String(e) }, 500);
  }
});
