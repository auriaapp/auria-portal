// ============================================================================
//  prevision — ponte Auria ↔ Prevision (item 77). Etapa 1: DIAGNÓSTICO.
//  A chave da API do Prevision fica SÓ aqui (secret PREVISION_API_KEY); o front
//  nunca a vê. GraphQL, só leitura: POST https://api.prevision.com.br/graphql
//  com header "UserAuthorization: token <chave>".
//
//  body: { acao:'ping' }      → { ok, empresa:{id,nome} }              (a chave funciona?)
//        { acao:'projetos' }  → { ok, projetos:[{id,nome,area,fase}] } (IDs para vincular)
//        { acao:'query', query, variables }  → repasse controlado (só gerente/super_admin)
//  Verify JWT: ON. Quem pode: gerente ou super_admin.
//  Secrets: PREVISION_API_KEY (+ SUPABASE_URL/ANON/SERVICE_ROLE, já existentes).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PV_KEY       = (Deno.env.get("PREVISION_API_KEY") || "").trim().replace(/^token\s+/i, "");
const PV_URL       = "https://api.prevision.com.br/graphql";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const r = await fetch(PV_URL, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json", "UserAuthorization": "token " + PV_KEY },
    body: JSON.stringify({ query, variables }),
  });
  const txt = await r.text();
  let body: any = null; try { body = JSON.parse(txt); } catch (_) { /* não-JSON */ }
  if (!r.ok) throw new Error("Prevision HTTP " + r.status + ": " + (body?.error?.message || body?.errors?.[0]?.message || txt.slice(0, 200)));
  if (body?.errors?.length) throw new Error("Prevision GraphQL: " + body.errors.map((e: any) => e.message).join("; "));
  return body?.data;
}

const Q_PING = `query Ping { me { id name } }`;
const Q_PROJETOS = `query Projects($first: Int, $after: String) {
  me { id name projectsPage(first: $first, after: $after) {
    totalCount pageInfo { hasNextPage endCursor } nodes { id name area phase } } } }`;

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
    if (!/^[A-Za-z0-9]{20,40}$/.test(PV_KEY)) return j({ ok: false, error: "PREVISION_API_KEY com formato inesperado (esperado: 24 caracteres alfanuméricos, sem 'token ', sem aspas). Tamanho atual: " + PV_KEY.length }, 500);

    const body = await req.json().catch(() => ({}));
    const acao = String(body.acao || "ping");

    if (acao === "ping") {
      const d = await gql(Q_PING);
      return j({ ok: true, empresa: { id: d?.me?.id, nome: d?.me?.name } });
    }
    if (acao === "projetos") {
      const out: any[] = []; let after = ""; let total = 0;
      for (let pag = 0; pag < 20; pag++) {
        const d = await gql(Q_PROJETOS, { first: 50, after });
        const p = d?.me?.projectsPage; if (!p) break;
        total = p.totalCount || 0;
        (p.nodes || []).forEach((n: any) => out.push({ id: n.id, nome: n.name, area: n.area, fase: n.phase }));
        if (!p.pageInfo?.hasNextPage) break; after = p.pageInfo.endCursor;
      }
      return j({ ok: true, empresa: { nome: (await gql(Q_PING))?.me?.name }, total, projetos: out });
    }
    if (acao === "query") {
      // repasse controlado para explorar o schema durante a integração (só leitura; a API do Prevision já é só leitura)
      const q = String(body.query || ""); if (!q || q.length > 20000 || /\bmutation\b/i.test(q)) return j({ error: "query inválida" }, 400);
      const d = await gql(q, body.variables || {});
      return j({ ok: true, data: d });
    }
    return j({ error: "acao desconhecida" }, 400);
  } catch (e) {
    return j({ ok: false, error: String((e as Error)?.message || e) }, 200);
  }
});
