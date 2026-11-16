-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-15 — pendências da auditoria mockup × entrega (backlog do App):
--   E1 (113): botão "Cobrar" POR DISCIPLINA no bloco "Por disciplina" do editor
--      (mockups/app_apontamento_pendencias.html, seção 2). Nova RPC
--      cobranca_cobrar_disc = cobranca_cobrar_agora só para UMA disciplina
--      (mesmas travas: estacao_pode, nada de "Coordenação", só participante pendente).
--      Criada a partir do corpo vivo de cobranca_cobrar_agora, conferindo cada troca.
--   D5 (111): quem não está logado deixa de poder CHAMAR as RPCs novas
--      (o Supabase dá EXECUTE a PUBLIC por padrão; elas já recusavam/voltavam vazio).
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cobranca_cobrar_agora(uuid,text,boolean)'::regprocedure);
  n := replace(d, 'public.cobranca_cobrar_agora(p_emp uuid, p_apt text, p_conjunto boolean DEFAULT false)',
                  'public.cobranca_cobrar_disc(p_emp uuid, p_apt text, p_disc text, p_conjunto boolean DEFAULT false)');
  if n = d then raise exception 'assinatura não encontrada'; end if; d := n;
  n := replace(d, $a$where coalesce(trim(p.value->>'conclusao'),'') = '' and trim(x) like '%@%'$a$,
                  $b$where coalesce(trim(p.value->>'conclusao'),'') = '' and trim(x) like '%@%' and p.key = p_disc$b$);
  if n = d then raise exception 'filtro dos participantes não encontrado'; end if;
  execute n;
end $$;

revoke execute on function public.cobranca_cobrar_disc(uuid, text, text, boolean) from public, anon;
grant  execute on function public.cobranca_cobrar_disc(uuid, text, text, boolean) to authenticated;
revoke execute on function public.analise_compartilhar(uuid, text, boolean, uuid[]) from public, anon;
grant  execute on function public.analise_compartilhar(uuid, text, boolean, uuid[]) to authenticated;
revoke execute on function public.analise_projetistas(uuid) from public, anon;
grant  execute on function public.analise_projetistas(uuid) to authenticated;

-- REVERSÃO:
-- drop function if exists public.cobranca_cobrar_disc(uuid, text, text, boolean);
-- grant execute on function public.analise_compartilhar(uuid, text, boolean, uuid[]) to public;
-- grant execute on function public.analise_projetistas(uuid) to public;
