-- ============================================================================
--  Item 149 — auria_emails_equipe passa a receber o ID do empreendimento
--  Rodar no SQL Editor. Reaplicável.
--
--  POR QUÊ: a função resolvia destinatário pelo NOME do empreendimento. É a
--  mesma fragilidade que quebrou o item 134, onde 9 de 10 apontamentos tinham o
--  nome desatualizado. Com nome, um aviso pode:
--    · não achar ninguém (some em silêncio), se o nome guardado mudou;
--    · achar a equipe de OUTRO empreendimento, se dois compartilharem o nome.
--  Para um aviso que carrega valor de contrato, os dois desfechos são ruins.
--
--  O QUE MUDA: a versão canônica passa a ser auria_emails_equipe(uuid). A
--  versão antiga (text) continua existindo como PONTE — mas agora, se o nome
--  não resolver para exatamente UM empreendimento, ela devolve vazio em vez de
--  chutar. Melhor um aviso que não sai do que um aviso para a equipe errada.
--
--  Os 5 chamadores foram convertidos e vão abaixo, recriados a partir do que
--  está no repositório (não reescritos de memória).
-- ============================================================================

-- ── A versão canônica: por ID ─────────────────────────────────────────────
--  super_admin continua fora: é conta de operação do Auria, não destinatário
--  da correspondência do cliente (ver incidente do item 139).
create or replace function public.auria_emails_equipe(p_emp uuid)
returns text[] language sql security definer stable set search_path = public as $$
  select array_agg(distinct u.email)
    from public.usuarios_auria u
   where u.email is not null and (
     u.id in (select ae.analista_id
                from public.analista_empreendimento_auria ae
               where ae.empreendimento_id = p_emp and ae.ativo = true)
     or (u.role = 'gerente'
         and u.empresa_id = (select e.empresa_id from public.empreendimentos_auria e where e.id = p_emp)));
$$;
grant execute on function public.auria_emails_equipe(uuid) to authenticated;

-- ── A ponte, para quem ainda chamar por nome ──────────────────────────────
create or replace function public.auria_emails_equipe(nome_emp text)
returns text[] language plpgsql security definer stable set search_path = public as $$
declare v_id uuid; v_n int;
begin
  select count(*), min(e.id::text)::uuid into v_n, v_id
    from public.empreendimentos_auria e
   where e.nome = nome_emp and e.deleted_at is null;
  -- Zero ou mais de um: não dá para saber de quem é a equipe. Não chuta.
  if coalesce(v_n,0) <> 1 then return null; end if;
  return public.auria_emails_equipe(v_id);
end $$;
grant execute on function public.auria_emails_equipe(text) to authenticated;

comment on function public.auria_emails_equipe(text) is
  'DEPRECIADO (item 149): use a versão por uuid. Esta resolve o nome e devolve vazio se for ambíguo.';

-- ── Chamador: notif_parcela_status (aviso de faturamento — foi este o do incidente) ──
create or replace function public.notif_parcela_status()
returns trigger language plpgsql security definer as $$
declare c record; dest text[]; info text; corpo text;
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;

  select ct.projetista_email, ct.projetista_nome, ct.numero, ct.objeto, ct.disciplina, e.nome as emp_nome, e.id as emp_id, e.empresa_id
    into c
  from public.contratos_auria ct
  join public.empreendimentos_auria e on e.id = ct.empreendimento_id
  where ct.id = NEW.contrato_id;

  if not public.auria_notif_once('parc|'||NEW.id::text||'|'||NEW.status) then return NEW; end if;

  info := '<table style="width:100%;border-collapse:collapse;margin:2px 0 16px">'
       || public.auria_email_row('Empreendimento', public.auria_esc(c.emp_nome))
       || public.auria_email_row('Disciplina',     public.auria_esc(c.disciplina))
       || public.auria_email_row('Projetista',     public.auria_esc(coalesce(c.projetista_nome, c.projetista_email)))
       || public.auria_email_row('Contrato',       public.auria_esc(coalesce(c.objeto, c.numero)))
       || public.auria_email_row('Parcela',        'nº '||NEW.numero)
       || public.auria_email_row('Valor',          public.auria_brl(NEW.valor))
       || '</table>';

  if NEW.status = 'solicitada' then
    dest  := public.auria_emails_equipe(c.emp_id);
    corpo := '<p style="margin:0 0 12px;color:#334155;font-size:14px">O projetista solicitou o faturamento de uma parcela. Abra o painel para <b>autorizar</b> ou <b>recusar</b>.</p>'||info;
    perform public.auria_send_email(dest,
      'Auria — Solicitação de faturamento ('||coalesce(c.emp_nome,'')||')',
      public.auria_email_shell('Solicitação de faturamento', 'Parcela nº '||NEW.numero||' — '||coalesce(c.emp_nome,''),
                               corpo, 'Abrir para autorizar', public.auria_link('analista')));

  elsif NEW.status = 'autorizada' and c.projetista_email is not null then
    corpo := '<p style="margin:0 0 12px;color:#334155;font-size:14px">A coordenação <b>autorizou</b> o faturamento desta parcela. Você já pode emitir a nota fiscal.</p>'
          || '<p style="margin:0 0 12px;color:#334155;font-size:14px">' || public.nf_janela_frase(c.empresa_id) || '</p>' || info;
    perform public.auria_send_email(array[c.projetista_email],
      'Auria — Faturamento autorizado ('||coalesce(c.emp_nome,'')||')',
      public.auria_email_shell('Faturamento autorizado', 'Parcela nº '||NEW.numero||' — '||coalesce(c.emp_nome,''),
                               corpo, 'Abrir o portal', public.auria_link('projetista')));
  end if;
  return NEW;
exception when others then return NEW;
end $$;

-- ── Chamador: notif_msg_apontamento (projetista respondeu no apontamento) ──
create or replace function public.notif_msg_apontamento()
returns trigger language plpgsql security definer as $$
declare n_old int; n_new int; m jsonb; prev jsonb; de text; dest text[]; info text; corpo text;
begin
  n_old := coalesce(jsonb_array_length(OLD.mensagens),0);
  n_new := coalesce(jsonb_array_length(NEW.mensagens),0);
  if n_new <= n_old then return NEW; end if;
  m  := NEW.mensagens -> (n_new-1);
  de := coalesce(m->>'de','');
  -- anti-duplicata: se a última mensagem repete a anterior (mesmo texto/autor/data), ignora
  prev := case when n_new >= 2 then NEW.mensagens -> (n_new-2) else null end;
  if prev is not null
     and coalesce(prev->>'texto','')=coalesce(m->>'texto','')
     and coalesce(prev->>'de','')  =coalesce(m->>'de','')
     and coalesce(prev->>'data','') =coalesce(m->>'data','') then
    return NEW;
  end if;
  -- não repete o aviso desta mesma mensagem (mesmo que haja linhas duplicadas)
  if not public.auria_notif_once('msg|'||coalesce(NEW.id,'')||'|'||coalesce(m->>'data','')
       ||'|'||coalesce(m->>'de','')||'|'||md5(coalesce(m->>'texto',''))) then
    return NEW;
  end if;

  info := '<table style="width:100%;border-collapse:collapse;margin:2px 0 14px">'
       || public.auria_email_row('Empreendimento', public.auria_esc(NEW.empreendimento))
       || public.auria_email_row('Disciplina',     public.auria_esc(NEW.disciplina))
       || public.auria_email_row('Apontamento',    public.auria_esc(coalesce(NEW.id,'')))
       || '</table>';

  if de = 'projetista' then
    dest  := public.auria_emails_equipe(NEW.empreendimento_id);
    corpo := '<p style="margin:0 0 12px;color:#334155;font-size:14px">O projetista <b>'
             ||public.auria_esc(coalesce(m->>'nome', m->>'email','—'))||'</b> respondeu no apontamento:</p>'
          || info
          || '<div style="background:#F8FAFC;border-left:3px solid #3B82F6;border-radius:6px;padding:12px 14px;color:#334155;font-size:14px;line-height:1.55">'||public.auria_esc(m->>'texto')||'</div>';
    perform public.auria_send_email(dest,
      'Auria — Nova mensagem do projetista ('||coalesce(NEW.id,'')||')',
      public.auria_email_shell('Nova mensagem do projetista', coalesce(NEW.titulo, NEW.id), corpo,
                               'Abrir no painel', public.auria_link('analista')));
  elsif de = 'analista' then
    dest  := public.auria_emails_participantes(NEW.participantes);
    corpo := '<p style="margin:0 0 12px;color:#334155;font-size:14px">A coordenação enviou uma mensagem no apontamento:</p>'
          || info
          || '<div style="background:#F8FAFC;border-left:3px solid #F59E0B;border-radius:6px;padding:12px 14px;color:#334155;font-size:14px;line-height:1.55">'||public.auria_esc(m->>'texto')||'</div>';
    perform public.auria_send_email(dest,
      'Auria — Nova mensagem da coordenação ('||coalesce(NEW.id,'')||')',
      public.auria_email_shell('Mensagem da coordenação', coalesce(NEW.titulo, NEW.id), corpo,
                               'Abrir no portal', public.auria_link('projetista')));
  end if;
  return NEW;
exception when others then return NEW;
end $$;

-- ── Chamador: pv_marco_concluido_email (marco do cronograma concluído) ──
create or replace function public.pv_marco_concluido_email() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_dest text[]; v_corpo text; v_emp text;
begin
  if not public.pv_tarefa_concluida(new) or public.pv_tarefa_concluida(old) then return new; end if;   -- só na transição p/ concluída
  select e.nome into v_emp from public.empreendimentos_auria e where e.id = new.empreendimento_id;
  for r in select p.id, p.numero, p.descricao, p.valor, c.disciplina, c.projetista_email, coalesce(c.projetista_nome, c.projetista_email) as projetista
             from public.parcelas_auria p join public.contratos_auria c on c.id = p.contrato_id
            where p.prevision_tarefa_id = new.id and p.status = 'a_faturar'
  loop
    if not public.auria_notif_once('pv_marco|'||r.id) then continue; end if;
    -- coordenação + gestão (equipe) + adm-fin da empresa + projetista do contrato
    select array_agg(distinct em) into v_dest from (
      select unnest(coalesce(public.auria_emails_equipe(new.empreendimento_id), '{}')) as em
      union select u.email from public.usuarios_auria u join public.empreendimentos_auria e on e.empresa_id = u.empresa_id
             where e.id = new.empreendimento_id and u.role = 'financeiro' and u.email is not null
      union select r.projetista_email where r.projetista_email is not null) x where em is not null;
    if v_dest is null or array_length(v_dest,1) is null then continue; end if;
    v_corpo := '<p>O marco de medição <b>'||public.auria_esc(coalesce(new.wbs,'')||' '||coalesce(new.nome,''))||'</b> foi concluído no cronograma.</p>'
            || '<p>Com isso a parcela <b>'||r.numero||'</b>'||case when r.descricao is not null then ' — '||public.auria_esc(r.descricao) else '' end
            || ' ('||public.auria_esc(coalesce(r.disciplina,''))||' · '||public.auria_esc(r.projetista)||') no valor de <b>R$ '||to_char(coalesce(r.valor,0),'FM999G999G990D00')||'</b> está <b>liberável para faturamento</b>.</p>'
            || '<p>Projetista: solicite o faturamento pelo seu painel. Coordenação: autorize quando a solicitação chegar.</p>';
    perform public.auria_send_email(v_dest, 'Parcela liberável — '||coalesce(v_emp,'')||' · '||coalesce(r.disciplina,''),
      public.auria_email_shell('Auria · Custos', 'Marco concluído: parcela '||r.numero||' liberável', v_corpo, 'Abrir o Auria', 'https://auria.solutions/'),
      null, null);
  end loop;
  return new;
end $$;

-- ── Chamador: cde_obra_liberar (liberação para obra — item 147) ──
create or replace function public.cde_obra_liberar(p_rev uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_emp uuid; v_disc text; v_status text; v_cod text; v_tit text; v_rev text;
  v_modo text; v_estado text; v_nome text; v_emp_nome text; v_dest text[];
begin
  select d.empreendimento_id, d.disciplina, r.status, d.codigo, d.titulo, r.revisao
    into v_emp, v_disc, v_status, v_cod, v_tit, v_rev
    from public.cde_revisao_auria r
    join public.cde_documento_auria d on d.id = r.documento_id
   where r.id = p_rev;
  if v_emp is null then raise exception 'Revisão não encontrada.'; end if;

  if not public.cde_upload_pode(v_emp, v_disc) then
    raise exception 'Você não entrega a disciplina desta prancha.';
  end if;

  select max(a.liberar_obra) into v_modo
    from public.cde_acesso_auria a
    join public.projetistas_auria pr on pr.fornecedor_id = a.fornecedor_id
   where a.empreendimento_id = v_emp
     and lower(pr.email) = lower(coalesce(auth.jwt()->>'email',''))
     and coalesce(pr.ativo,true);
  v_modo := coalesce(v_modo,'nao');
  if v_modo = 'nao' then
    raise exception 'A coordenação não liberou este fornecedor para enviar pranchas direto à obra.';
  end if;

  if v_status in ('A1','B1','AS_BUILT') then
    return jsonb_build_object('ok', false, 'motivo', 'Esta revisão já está liberada.');
  end if;

  select nome into v_emp_nome from public.empreendimentos_auria where id = v_emp;
  v_nome := coalesce(
    (select p.nome from public.projetistas_auria p
      where lower(p.email) = lower(coalesce(auth.jwt()->>'email','')) limit 1),
    auth.jwt()->>'email');
  v_dest := public.auria_emails_equipe(v_emp);

  if v_modo = 'direto' then
    select estado into v_estado from public.cde_status_auria where codigo = 'A1';
    update public.cde_revisao_auria
       set status = 'A1', estado = coalesce(v_estado, estado),
           aprovado_por = auth.uid(), aprovado_em = now(),
           lib_pedida_em = null, lib_pedida_por = null, lib_pedida_nome = null
     where id = p_rev;
    insert into public.cde_evento_auria(revisao_id, acao, de_status, para_status,
                                        usuario_id, usuario_nome, nota)
      values (p_rev, 'status', v_status, 'A1', auth.uid(), v_nome,
              'Liberado para obra pelo projetista, por delegação da coordenação.');

    -- Conferência DEPOIS do fato: a coordenação precisa saber que saiu.
    if v_dest is not null and array_length(v_dest,1) > 0 then
      perform public.auria_send_email(v_dest,
        'Liberado para obra: ' || coalesce(v_cod,'') || ' — ' || coalesce(v_emp_nome,''),
        public.auria_email_shell('Liberação para obra',
          public.auria_esc(coalesce(v_cod,'')) || ' foi liberada direto para a obra',
          '<b>' || public.auria_esc(v_nome) || '</b> liberou a revisão <b>' || public.auria_esc(coalesce(v_rev,'')) ||
          '</b> de <b>' || public.auria_esc(coalesce(v_cod,'')) || '</b> (' || public.auria_esc(coalesce(v_tit,'')) ||
          ') para a obra, usando a delegação que a coordenação concedeu ao fornecedor.<br><br>' ||
          'A prancha já está valendo como <b>liberada (A1)</b> em ' || public.auria_esc(coalesce(v_emp_nome,'')) ||
          '. Se não deveria ter saído, mude o status no CDE.',
          'Abrir o CDE', public.auria_link('analista')));
    end if;
    return jsonb_build_object('ok', true, 'modo', 'direto', 'codigo', v_cod);
  end if;

  update public.cde_revisao_auria
     set lib_pedida_em = now(), lib_pedida_por = auth.uid(), lib_pedida_nome = v_nome
   where id = p_rev;
  insert into public.cde_evento_auria(revisao_id, acao, usuario_id, usuario_nome, nota)
    values (p_rev, 'pedido_obra', auth.uid(), v_nome,
            'Projetista sinalizou que a prancha está pronta para a obra.');

  if v_dest is not null and array_length(v_dest,1) > 0 then
    perform public.auria_send_email(v_dest,
      'Pronta para a obra: ' || coalesce(v_cod,'') || ' — aguardando sua liberação',
      public.auria_email_shell('Pedido de liberação',
        public.auria_esc(coalesce(v_cod,'')) || ' está pronta para a obra',
        '<b>' || public.auria_esc(v_nome) || '</b> marcou a revisão <b>' || public.auria_esc(coalesce(v_rev,'')) ||
        '</b> de <b>' || public.auria_esc(coalesce(v_cod,'')) || '</b> (' || public.auria_esc(coalesce(v_tit,'')) ||
        ') como pronta para a obra em ' || public.auria_esc(coalesce(v_emp_nome,'')) || '.<br><br>' ||
        'Ela <b>ainda não saiu</b>: abra o CDE e confirme em “Pedidos da obra”.',
        'Ver os pedidos', public.auria_link('analista')));
  end if;
  return jsonb_build_object('ok', true, 'modo', 'confirmar', 'codigo', v_cod);
end $$;
grant execute on function public.cde_obra_liberar(uuid) to authenticated;


-- ── Conferência ────────────────────────────────────────────────────────────
select 'auria_emails_equipe(uuid) existe' as item,
       (to_regprocedure('public.auria_emails_equipe(uuid)') is not null)::text as valor
union all select 'ponte por nome continua',
       (to_regprocedure('public.auria_emails_equipe(text)') is not null)::text
union all select 'chamadores ainda usando NOME (esperado 0)',
       (select count(*)::text from pg_proc
         where proname in ('notif_parcela_status','notif_msg_apontamento','notif_novo_apontamento',
                           'pv_marco_concluido_email','cde_obra_liberar')
           and (prosrc like '%auria_emails_equipe(c.emp_nome)%'
             or prosrc like '%auria_emails_equipe(NEW.empreendimento)%'
             or prosrc like '%auria_emails_equipe(v_emp)%'
             or prosrc like '%auria_emails_equipe(v_emp_nome)%'))
union all select 'destinatarios de Diagonal by Pininfarina agora',
       coalesce((select array_to_string(public.auria_emails_equipe(e.id), ', ')
                   from public.empreendimentos_auria e
                  where e.nome = 'Diagonal by Pininfarina' limit 1), '(nenhum)');
