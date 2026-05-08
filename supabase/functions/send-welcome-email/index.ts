import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const PAINEL_URL = "https://auriaapp.github.io/auria-portal/auria_gerencia.html";
const LOGO_URL   = "https://auriaapp.github.io/auria-portal/logo_full.png";

serve(async (req) => {
  // CORS para chamadas do frontend
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { gerNome, gerEmail, empNome, plano } = await req.json();

    if (!gerEmail || !empNome) {
      return new Response(JSON.stringify({ error: "Campos obrigatórios ausentes" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const planoLabel = plano === "enterprise" ? "Enterprise"
                     : plano === "professional" ? "Professional"
                     : "Basic";

    const emailHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bem-vindo à Auria</title>
</head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:40px 20px">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#0F172A 0%,#1E3A5F 60%,#1D4ED8 100%);padding:40px 48px;text-align:center">
            <img src="${LOGO_URL}" alt="Auria" style="height:72px;object-fit:contain;display:block;margin:0 auto 16px">
            <p style="margin:0;color:rgba(255,255,255,0.7);font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:600">Plataforma de Gestão de Obras</p>
          </td>
        </tr>

        <!-- SAUDAÇÃO -->
        <tr>
          <td style="padding:48px 48px 0">
            <p style="margin:0 0 8px;font-size:13px;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:600">Bem-vindo à família Auria</p>
            <h1 style="margin:0 0 24px;font-size:28px;color:#0F172A;font-weight:800;line-height:1.2">
              Olá, ${gerNome || "Gestor"}! É um prazer tê-lo conosco. 👋
            </h1>
            <p style="margin:0 0 16px;font-size:16px;color:#475569;line-height:1.7">
              A empresa <strong style="color:#1E3A5F">${empNome}</strong> foi cadastrada com sucesso na plataforma Auria com o plano <strong>${planoLabel}</strong>. Estamos muito felizes em tê-los como clientes e prontos para transformar a gestão das suas obras.
            </p>
            <p style="margin:0 0 32px;font-size:16px;color:#475569;line-height:1.7">
              A Auria foi criada para dar à sua equipe uma visão completa, ágil e inteligente de cada empreendimento — do primeiro apontamento até a entrega final.
            </p>
          </td>
        </tr>

        <!-- DIFERENCIAL -->
        <tr>
          <td style="padding:0 48px">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#EFF6FF;border-radius:12px;border-left:4px solid #1D4ED8">
              <tr>
                <td style="padding:24px 28px">
                  <p style="margin:0 0 12px;font-size:13px;color:#1D4ED8;text-transform:uppercase;letter-spacing:1px;font-weight:700">⚡ O diferencial Auria Desktop</p>
                  <p style="margin:0;font-size:15px;color:#1E3A5F;line-height:1.7">
                    Nosso aplicativo desktop roda diretamente nos computadores da sua equipe de campo — <strong>sem depender de internet</strong> para registrar apontamentos, anexar fotos e gerar relatórios em tempo real. Quando a conexão retorna, tudo sincroniza automaticamente com a nuvem.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FEATURES -->
        <tr>
          <td style="padding:32px 48px 0">
            <p style="margin:0 0 20px;font-size:15px;color:#0F172A;font-weight:700">O que você tem disponível agora:</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="50%" style="padding-right:12px;padding-bottom:12px;vertical-align:top">
                  <table cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:10px;width:100%">
                    <tr><td style="padding:16px 18px">
                      <p style="margin:0 0 6px;font-size:20px">📊</p>
                      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#0F172A">Painel da Gestão</p>
                      <p style="margin:0;font-size:13px;color:#64748B;line-height:1.5">Acompanhe todos os empreendimentos, analistas e apontamentos em tempo real.</p>
                    </td></tr>
                  </table>
                </td>
                <td width="50%" style="padding-left:12px;padding-bottom:12px;vertical-align:top">
                  <table cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:10px;width:100%">
                    <tr><td style="padding:16px 18px">
                      <p style="margin:0 0 6px;font-size:20px">🏗️</p>
                      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#0F172A">Gestão de Obras</p>
                      <p style="margin:0;font-size:13px;color:#64748B;line-height:1.5">Cadastre empreendimentos, pavimentos e atribua analistas por projeto.</p>
                    </td></tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td width="50%" style="padding-right:12px;vertical-align:top">
                  <table cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:10px;width:100%">
                    <tr><td style="padding:16px 18px">
                      <p style="margin:0 0 6px;font-size:20px">📱</p>
                      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#0F172A">App Desktop</p>
                      <p style="margin:0;font-size:13px;color:#64748B;line-height:1.5">Apontamentos offline, fotos e relatórios automáticos pelos analistas de campo.</p>
                    </td></tr>
                  </table>
                </td>
                <td width="50%" style="padding-left:12px;vertical-align:top">
                  <table cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:10px;width:100%">
                    <tr><td style="padding:16px 18px">
                      <p style="margin:0 0 6px;font-size:20px">📈</p>
                      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#0F172A">Métricas e KPIs</p>
                      <p style="margin:0;font-size:13px;color:#64748B;line-height:1.5">Indicadores de desempenho atualizados diariamente por empreendimento.</p>
                    </td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:36px 48px;text-align:center">
            <p style="margin:0 0 20px;font-size:16px;color:#475569">Acesse agora o seu Painel da Gestão e comece a configurar seus empreendimentos:</p>
            <a href="${PAINEL_URL}" style="display:inline-block;background:linear-gradient(135deg,#1D4ED8,#1E3A5F);color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:16px 40px;border-radius:10px;letter-spacing:0.5px">
              Acessar Painel da Gestão →
            </a>
          </td>
        </tr>

        <!-- SUPORTE -->
        <tr>
          <td style="padding:0 48px 40px">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E2E8F0;padding-top:24px">
              <tr>
                <td>
                  <p style="margin:0 0 8px;font-size:14px;color:#475569;line-height:1.6">
                    Precisa de ajuda para começar? Nossa equipe está disponível para apoiar na configuração inicial, treinamento da equipe e qualquer dúvida que surgir.
                  </p>
                  <p style="margin:0;font-size:14px;color:#94A3B8">
                    Com muito prazer em fazer parte da sua jornada,<br>
                    <strong style="color:#1E3A5F">Equipe Auria</strong>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#F8FAFC;padding:20px 48px;text-align:center;border-top:1px solid #E2E8F0">
            <p style="margin:0;font-size:12px;color:#94A3B8">
              © 2026 Auria — Plataforma de Gestão de Obras · Todos os direitos reservados
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Enviar via Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Auria <onboarding@resend.dev>",
        to: [gerEmail],
        subject: `Bem-vindo à Auria, ${gerNome || empNome}! 🚀`,
        html: emailHtml,
      }),
    });

    const resBody = await res.json();

    if (!res.ok) {
      console.error("Resend error:", resBody);
      return new Response(JSON.stringify({ error: resBody }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: resBody.id }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (err) {
    console.error("Edge Function error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
