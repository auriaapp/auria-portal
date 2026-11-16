-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-16 — item 119 (mockups/app_instrucao_por_disciplina.html): INSTRUÇÃO POR DISCIPLINA.
--   Fica em apontamentos.participantes[disc].instrucao (jsonb, sem coluna nova).
--   • e-mail de apontamento novo: sem nenhuma instrução = como antes (um e-mail para todos);
--     com instrução = um e-mail por disciplina, com "O que é com você" no topo;
--   • e-mails de cobrança (cobranca_conjunto_html): cada linha leva a instrução da disciplina.
-- Aplicado como migração instrucao_por_disciplina.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.notif_novo_apontamento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare dest text[]; info text; corpo text; intro text; descr text; p record; ins text; pd text[]; tem_ins boolean;
begin
  if not public.auria_notif_once('apt|'||coalesce(NEW.id,'')) then return NEW; end if;
  info := '<table style="width:100%;border-collapse:collapse;margin:2px 0 16px">'
       || public.auria_email_row('Empreendimento', public.auria_esc(NEW.empreendimento))
       || public.auria_email_row('Disciplina',     public.auria_esc(NEW.disciplina))
       || public.auria_email_row('Tipo',           public.auria_esc(NEW.tipo))
       || public.auria_email_row('Criticidade',    public.auria_esc(NEW.prioridade))
       || public.auria_email_row('Prazo',          public.auria_esc(NEW.prazo_min))
       || '</table>';
  intro := '<p style="margin:0 0 14px;color:#334155;font-size:14px;line-height:1.5">Um novo apontamento foi registrado para você. Confira os detalhes e responda pelo portal.</p>';
  descr := case when coalesce(NEW.descricao,'')<>'' then
            '<p style="margin:0 0 4px;color:#64748B;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Descrição</p>'
            ||'<div style="background:#F8FAFC;border-left:3px solid #3B82F6;border-radius:6px;padding:12px 14px;color:#334155;font-size:14px;line-height:1.55">'||public.auria_esc(NEW.descricao)||'</div>'
          else '' end;
  tem_ins := exists(select 1 from jsonb_each(coalesce(NEW.participantes,'{}'::jsonb)) x where coalesce(trim(x.value->>'instrucao'),'')<>'');
  if not tem_ins then
    dest := public.auria_emails_participantes(NEW.participantes);
    corpo := intro||info||descr;
    perform public.auria_send_email(dest,'Auria — Novo apontamento: '||coalesce(NEW.titulo,NEW.id),
      public.auria_email_shell('Novo apontamento', coalesce(NEW.titulo,NEW.id), corpo, 'Abrir no App', public.auria_link_app(NEW.empreendimento_id, NEW.id)));
  else
    -- um e-mail por disciplina, cada um com a sua instrução no topo
    for p in select key, value from jsonb_each(coalesce(NEW.participantes,'{}'::jsonb)) loop
      pd := public.auria_emails_participantes(jsonb_build_object(p.key, p.value));
      continue when pd is null or coalesce(array_length(pd,1),0)=0;
      ins := nullif(trim(coalesce(p.value->>'instrucao','')),'');
      corpo := intro
        || case when ins is not null then
             '<div style="background:#FFF7EB;border-left:4px solid #F28C28;border-radius:6px;padding:10px 14px;margin:0 0 14px;color:#7C2D12;font-size:14px;line-height:1.5">'
             ||'<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#B45309;margin-bottom:3px">O que é com você · '||public.auria_esc(p.key)||'</div>'
             ||public.auria_esc(ins)||'</div>'
           else '' end
        || info || descr;
      perform public.auria_send_email(pd,'Auria — Novo apontamento: '||coalesce(NEW.titulo,NEW.id),
        public.auria_email_shell('Novo apontamento', coalesce(NEW.titulo,NEW.id), corpo, 'Abrir no App', public.auria_link_app(NEW.empreendimento_id, NEW.id)));
    end loop;
  end if;
  return NEW;
exception when others then return NEW;
end $function$;

-- cobrança: a instrução da disciplina aparece debaixo do título do apontamento
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cobranca_conjunto_html(uuid,text,text[],text,text)'::regprocedure);
  n := replace(d, $a$public.cob_data(p.value->>'prazo') prazo,$a$, $b$public.cob_data(p.value->>'prazo') prazo, nullif(trim(coalesce(p.value->>'instrucao','')),'') instr,$b$);
  if n = d then raise exception 'prazo não encontrado'; end if; d := n;
  n := replace(d, $a$'locs',b.locs,$a$, $b$'locs',b.locs,'ins',b.instr,$b$);
  if n = d then raise exception 'locs não encontrado'; end if; d := n;
  n := replace(d, $a$coalesce('<br><span style="font-size:11px;color:#C2410C">falta em '||public.auria_esc(x->>'locs')||'</span>','')$a$,
                  $b$coalesce('<br><span style="font-size:11px;color:#C2410C">falta em '||public.auria_esc(x->>'locs')||'</span>','')||case when coalesce(x->>'ins','')<>'' then '<div style="margin-top:4px;padding:5px 8px;background:#FFF7EB;border-left:3px solid #F28C28;font-size:12px;color:#7C2D12"><b>O que é com você:</b> '||public.auria_esc(x->>'ins')||'</div>' else '' end$b$);
  -- (auria_esc(null) devolve '' — por isso CASE e não coalesce; corrigido na migração instrucao_por_disciplina_fix_vazio)
  if n = d then raise exception 'título da linha não encontrado'; end if;
  execute n;
end $$;

-- REVERSÃO: recriar notif_novo_apontamento e cobranca_conjunto_html a partir das versões anteriores
-- (supabase_apt_pendencias_f3.sql / migração cobrar_disciplina) — os campos 'instrucao' no jsonb podem ficar.
