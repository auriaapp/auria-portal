import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // Aceita chamada manual (POST) ou agendada (GET do Supabase Cron)
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Buscar IDs a apagar definitivamente
    const { data: toDelete, error: selErr } = await admin
      .from("empreendimentos_auria")
      .select("id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);

    if (selErr) throw selErr;

    const ids = (toDelete || []).map((r: { id: string }) => r.id);

    if (ids.length === 0) {
      return new Response(JSON.stringify({ deleted: 0, message: "Nenhum item expirado." }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Apagar vínculos analista → empreendimento
    await admin.from("analista_empreendimento_auria")
      .delete().in("empreendimento_id", ids);

    // 3. Apagar métricas
    await admin.from("metricas_diarias_auria")
      .delete().in("empreendimento_id", ids);

    // 4. Apagar os empreendimentos
    const { error: delErr } = await admin
      .from("empreendimentos_auria")
      .delete().in("id", ids);

    if (delErr) throw delErr;

    // 5. Tentar remover logos do Storage (melhor esforço)
    const logoPaths = ids.map((id: string) => `empreendimentos/${id}`);
    await admin.storage.from("logos").remove(logoPaths).catch(() => {});

    console.log(`[cleanup-archived] Apagados ${ids.length} empreendimentos expirados.`);

    return new Response(JSON.stringify({ deleted: ids.length, ids }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("[cleanup-archived] Erro:", String(err));
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
