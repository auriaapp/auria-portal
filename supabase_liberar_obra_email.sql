-- ============================================================================
--  Item 147 (parte 3) — os avisos por e-mail da liberação para obra
--  Rodar DEPOIS de supabase_liberar_obra.sql. Reaplicável.
--
--  POR QUE: a tela promete "a coordenação é avisada" na liberação direta, e o
--  projetista fica sem saber se o pedido dele foi aceito. Sem estes e-mails, a
--  interface promete o que o sistema não cumpre — o defeito que mais apareceu
--  nesta semana.
--
--  DE QUEBRA, uma correção de entrega: auria_link() e o logo de
--  auria_email_shell() ainda apontavam para auriaapp.github.io, enquanto o
--  remetente é @auria.solutions. Essa divergência de domínio entre remetente e
--  links foi exatamente o que fez o Microsoft 365 tratar o convite como
--  phishing. Tudo passa a apontar para auria.solutions.
-- ============================================================================

-- ── 1) Remetente, links e imagens no MESMO domínio ────────────────────────
create or replace function public.auria_link(qual text)
returns text language sql immutable as $$
  select case qual when 'analista'
    then 'https://auria.solutions/painel_analista.html'
    when 'projetista' then 'https://auria.solutions/projetista.html'
    else 'https://auria.solutions/index.html' end;
$$;

-- Mesmo molde de sempre; muda só a origem do logo. (Recriar a função, e não
-- mexer em pg_proc na marra, que catálogo de sistema não se edita.)
create or replace function public.auria_email_shell(eyebrow text, titulo text, corpo text, cta_label text, cta_url text)
returns text language sql immutable as $$
  select
   '<div style="background:#EEF2F7;padding:26px 12px;font-family:Segoe UI,Arial,sans-serif">'
   ||'<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(15,23,42,.08)">'
   ||  '<div style="text-align:center;padding:28px 24px 14px">'
   ||    '<img src="https://auria.solutions/logo_full.png" alt="Auria" width="150" style="width:150px;max-width:62%;height:auto">'
   ||  '</div>'
   ||  '<div style="height:3px;background:linear-gradient(90deg,#F59E0B,#3B82F6)"></div>'
   ||  '<div style="padding:26px 30px">'
   ||    '<p style="margin:0 0 6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#2563EB;font-weight:700">'||coalesce(eyebrow,'')||'</p>'
   ||    '<h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;color:#1A2F4A">'||coalesce(titulo,'')||'</h1>'
   ||    coalesce(corpo,'')
   ||    case when coalesce(cta_url,'')<>'' then
             '<div style="text-align:center;margin:28px 0 4px"><a href="'||cta_url||'" style="display:inline-block;background:#3B82F6;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 32px;border-radius:9px">'||coalesce(cta_label,'Abrir')||'</a></div>'
           else '' end
   ||  '</div>'
   ||  '<div style="padding:16px 30px;background:#F8FAFC;border-top:1px solid #EEF2F7;color:#94A3B8;font-size:11px;line-height:1.6">Auria — Plataforma de Coordenação de Projetos<br>Aviso automático · não é necessário responder este e-mail.</div>'
   ||'</div></div>';
$$;


-- ── 2) Liberação DIRETA: a coordenação fica sabendo na hora ───────────────
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
  v_dest := public.auria_emails_equipe(v_emp_nome);

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


-- ── 3) Resposta da coordenação: o projetista fica sabendo ─────────────────
create or replace function public.cde_obra_confirmar(p_rev uuid, p_ok boolean, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_emp uuid; v_status text; v_estado text; v_nome text;
  v_cod text; v_rev text; v_emp_nome text; v_pediu uuid; v_email text;
begin
  select d.empreendimento_id, r.status, d.codigo, r.revisao, r.lib_pedida_por
    into v_emp, v_status, v_cod, v_rev, v_pediu
    from public.cde_revisao_auria r
    join public.cde_documento_auria d on d.id = r.documento_id
   where r.id = p_rev;
  if v_emp is null then raise exception 'Revisão não encontrada.'; end if;
  if not public.estacao_edita(v_emp) then
    raise exception 'Só a coordenação confirma a liberação para a obra.';
  end if;

  select nome into v_emp_nome from public.empreendimentos_auria where id = v_emp;
  v_nome := coalesce((select u.nome from public.usuarios_auria u where u.id = auth.uid()),
                     auth.jwt()->>'email');
  select u.email into v_email from public.usuarios_auria u where u.id = v_pediu;

  if not p_ok then
    update public.cde_revisao_auria
       set lib_pedida_em = null, lib_pedida_por = null, lib_pedida_nome = null
     where id = p_rev;
    insert into public.cde_evento_auria(revisao_id, acao, usuario_id, usuario_nome, nota)
      values (p_rev, 'pedido_obra', auth.uid(), v_nome,
              coalesce('Pedido de liberação para obra recusado: '||p_nota,
                       'Pedido de liberação para obra recusado.'));
    if v_email is not null then
      perform public.auria_send_email(array[v_email],
        'Não liberada para a obra: ' || coalesce(v_cod,''),
        public.auria_email_shell('Pedido de liberação',
          public.auria_esc(coalesce(v_cod,'')) || ' não foi liberada',
          'A coordenação analisou seu pedido de liberação da revisão <b>' || public.auria_esc(coalesce(v_rev,'')) ||
          '</b> de <b>' || public.auria_esc(coalesce(v_cod,'')) || '</b> em ' ||
          public.auria_esc(coalesce(v_emp_nome,'')) || ' e <b>não liberou</b> desta vez.' ||
          coalesce('<br><br>Motivo: ' || public.auria_esc(p_nota), '') ||
          '<br><br>A prancha continua como estava.',
          'Abrir o painel', public.auria_link('projetista')));
    end if;
    return jsonb_build_object('ok', true, 'liberado', false);
  end if;

  select estado into v_estado from public.cde_status_auria where codigo = 'A1';
  update public.cde_revisao_auria
     set status = 'A1', estado = coalesce(v_estado, estado),
         aprovado_por = auth.uid(), aprovado_em = now(),
         lib_pedida_em = null, lib_pedida_por = null, lib_pedida_nome = null
   where id = p_rev;
  insert into public.cde_evento_auria(revisao_id, acao, de_status, para_status,
                                      usuario_id, usuario_nome, nota)
    values (p_rev, 'status', v_status, 'A1', auth.uid(), v_nome,
            coalesce(p_nota, 'Liberado para obra a pedido do projetista.'));

  if v_email is not null then
    perform public.auria_send_email(array[v_email],
      'Liberada para a obra: ' || coalesce(v_cod,''),
      public.auria_email_shell('Liberação para obra',
        public.auria_esc(coalesce(v_cod,'')) || ' foi liberada para a obra',
        'A coordenação liberou a revisão <b>' || public.auria_esc(coalesce(v_rev,'')) ||
        '</b> de <b>' || public.auria_esc(coalesce(v_cod,'')) || '</b> em ' ||
        public.auria_esc(coalesce(v_emp_nome,'')) || '. A obra já consegue ver e baixar.',
        'Abrir o painel', public.auria_link('projetista')));
  end if;
  return jsonb_build_object('ok', true, 'liberado', true);
end $$;
grant execute on function public.cde_obra_confirmar(uuid, boolean, text) to authenticated;


-- ── Conferência ────────────────────────────────────────────────────────────
select 'links de e-mail em auria.solutions' as item,
       (public.auria_link('analista') like '%auria.solutions%')::text as valor
union all select 'logo do e-mail em auria.solutions',
       (not exists (select 1 from pg_proc where proname='auria_email_shell'
                     and prosrc like '%auriaapp.github.io%'))::text
union all select 'cde_obra_liberar manda e-mail',
       (exists (select 1 from pg_proc where proname='cde_obra_liberar'
                 and prosrc like '%auria_send_email%'))::text
union all select 'cde_obra_confirmar manda e-mail',
       (exists (select 1 from pg_proc where proname='cde_obra_confirmar'
                 and prosrc like '%auria_send_email%'))::text;
