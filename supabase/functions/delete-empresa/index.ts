import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { empresa_id, usuario_ids } = await req.json();
    if (!empresa_id) {
      return new Response(JSON.stringify({ error: "empresa_id obrigatório" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // 1. Apagar vínculos analista-empreendimento
    await admin.from('analista_empreendimento_auria').delete().eq('empreendimento_id',
      admin.from('empreendimentos_auria').select('id').eq('empresa_id', empresa_id)
    );

    // 2. Apagar empreendimentos
    await admin.from('empreendimentos_auria').delete().eq('empresa_id', empresa_id);

    // 3. Apagar convites
    await admin.from('convites_auria').delete().eq('empresa_id', empresa_id);

    // 4. Apagar métricas
    await admin.from('metricas_diarias_auria').delete().eq('empresa_id', empresa_id);

    // 5. Apagar logs
    await admin.from('logs_acesso_auria').delete().eq('empresa_id', empresa_id);

    // 6. Apagar chamados
    await admin.from('chamados_auria').delete().eq('empresa_id', empresa_id);

    // 7. Apagar usuários da tabela
    await admin.from('usuarios_auria').delete().eq('empresa_id', empresa_id);

    // 8. Apagar usuários do Supabase Auth
    if (usuario_ids && usuario_ids.length > 0) {
      for (const uid of usuario_ids) {
        await admin.auth.admin.deleteUser(uid);
      }
    }

    // 9. Apagar a empresa
    const { error } = await admin.from('empresas_auria').delete().eq('id', empresa_id);
    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS },
    });

  } catch (err) {
    console.error("Erro:", String(err));
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
