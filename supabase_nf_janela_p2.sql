-- ============================================================================
--  Item 40 — FASE 2 da janela de recebimento de NFs (2026-09-21)
--  Rodar no SQL Editor do Supabase (depois de supabase_nf_janela.sql).
--
--  1) nf_vincular_parcela / nf_desvincular_parcela — o financeiro liga uma NF que
--     chegou pelo link público (origem 'externa', sem parcela) a uma parcela do
--     contrato; a parcela vira 'faturada' (ou 'paga' se a NF já estiver paga).
--  2) nf_janela_lembrete() — 2 dias antes de fechar, lembra por e-mail os
--     projetistas com parcela AUTORIZADA (aprovação do coordenador/gestor) e ainda
--     sem NF, e os e-mails extras da janela. Roda no pg_cron às 8h (Fortaleza).
--  3) E-mail "Faturamento autorizado" passa a dizer se a janela está aberta (e até
--     quando) ou quando abre a próxima — a APROVAÇÃO é o único gatilho do aviso.
--  4) fin_parcelas_vinculaveis(nf) — lista as parcelas candidatas para o modal.
-- ============================================================================

alter table public.notas_fiscais_auria
  add column if not exists vinculado_por   uuid,
  add column if not exists vinculado_em    timestamptz,
  add column if not exists vinc_status_ant text;          -- status da parcela antes do vínculo (p/ desfazer)
alter table public.nf_janela_auria
  add column if not exists lembrete_em timestamptz;

-- ── 1) Vincular / desvincular NF externa a parcela ──────────────────────────
create or replace function public.fin_parcelas_vinculaveis(p_nf uuid)
returns table(parcela_id uuid, contrato_id uuid, empreendimento_id uuid, empreendimento text, construtora text,
              disciplina text, projetista text, contrato text, numero int, descricao text, valor numeric,
              vencimento date, status text, sugerida boolean)
language plpgsql security definer stable set search_path = public as $$
declare n record;
begin
  if public.minha_role_auria() not in ('financeiro','super_admin') then raise exception 'Só o financeiro vincula NF.'; end if;
  select * into n from public.notas_fiscais_auria x where x.id = p_nf
     and (public.minha_role_auria() = 'super_admin' or x.empresa_id = public.minha_empresa());
  if n.id is null then raise exception 'NF não encontrada.'; end if;
  return query
    select p.id, ct.id, e.id, e.nome, c2.nome, ct.disciplina,
           coalesce(ct.projetista_nome, ct.projetista_email), coalesce(ct.objeto, ct.numero),
           p.numero, p.descricao, p.valor, p.vencimento, p.status,
           -- sugerida: mesma construtora + mesmo empreendimento/disciplina informados na NF, ou mesmo e-mail do projetista
           (n.empreendimento_id is not null and e.id = n.empreendimento_id)
             and (n.disciplina is null or lower(ct.disciplina) = lower(n.disciplina))
             or (n.projetista_email is not null and lower(ct.projetista_email) = lower(n.projetista_email))
      from public.parcelas_auria p
      join public.contratos_auria ct on ct.id = p.contrato_id
      join public.empreendimentos_auria e on e.id = ct.empreendimento_id
      left join public.construtoras_auria c2 on c2.id = e.construtora_id
     where e.empresa_id = n.empresa_id
       and (n.construtora_id is null or e.construtora_id = n.construtora_id)
       and ct.status = 'ativo'
       and p.status in ('a_faturar','solicitada','autorizada')
       and not exists (select 1 from public.notas_fiscais_auria o where o.parcela_id = p.id and o.status <> 'cancelada')
     order by 14 desc, e.nome, ct.disciplina, p.numero;
end $$;
grant execute on function public.fin_parcelas_vinculaveis(uuid) to authenticated;

create or replace function public.nf_vincular_parcela(p_nf uuid, p_parcela uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n record; c record;
begin
  if public.minha_role_auria() not in ('financeiro','super_admin') then raise exception 'Só o financeiro vincula NF.'; end if;
  select * into n from public.notas_fiscais_auria x where x.id = p_nf
     and (public.minha_role_auria() = 'super_admin' or x.empresa_id = public.minha_empresa());
  if n.id is null then raise exception 'NF não encontrada.'; end if;
  if n.parcela_id is not null then raise exception 'Esta NF já está vinculada a uma parcela.'; end if;
  if n.status = 'cancelada' then raise exception 'NF cancelada não pode ser vinculada.'; end if;

  select p.id, p.status as parc_status, ct.id as contrato_id, ct.disciplina, ct.projetista_nome, ct.projetista_email,
         e.id as emp_id, e.empresa_id, e.construtora_id
    into c
    from public.parcelas_auria p
    join public.contratos_auria ct on ct.id = p.contrato_id
    join public.empreendimentos_auria e on e.id = ct.empreendimento_id
   where p.id = p_parcela;
  if c.id is null then raise exception 'Parcela não encontrada.'; end if;
  if c.empresa_id <> n.empresa_id then raise exception 'Parcela de outro grupo.'; end if;
  if c.parc_status not in ('a_faturar','solicitada','autorizada') then
    raise exception 'A parcela já está % — escolha outra.', c.parc_status;
  end if;
  if exists (select 1 from public.notas_fiscais_auria o where o.parcela_id = p_parcela and o.status <> 'cancelada') then
    raise exception 'Esta parcela já tem NF.';
  end if;

  update public.notas_fiscais_auria set
      parcela_id = p_parcela, contrato_id = c.contrato_id, empreendimento_id = c.emp_id,
      construtora_id = coalesce(c.construtora_id, construtora_id),
      disciplina = coalesce(disciplina, c.disciplina),
      projetista_nome = coalesce(c.projetista_nome, projetista_nome),
      vinculado_por = auth.uid(), vinculado_em = now(), vinc_status_ant = c.parc_status
    where id = p_nf;
  update public.parcelas_auria set
      status = case when n.status = 'paga' then 'paga' else 'faturada' end,
      data_faturamento = coalesce(data_faturamento, coalesce(n.emitida_em::timestamptz, now())),
      data_pagamento = case when n.status = 'paga' then coalesce(data_pagamento, now()) else data_pagamento end
    where id = p_parcela;
  insert into public.parcela_eventos_auria(parcela_id, evento, por_email, por_nome, por_role, observacao)
    select p_parcela, 'faturou', u.email, coalesce(u.nome, u.email), 'financeiro', 'NF recebida pelo link público vinculada pelo financeiro'
      from public.usuarios_auria u where u.id = auth.uid();
end $$;
grant execute on function public.nf_vincular_parcela(uuid, uuid) to authenticated;

create or replace function public.nf_desvincular_parcela(p_nf uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n record;
begin
  if public.minha_role_auria() not in ('financeiro','super_admin') then raise exception 'Só o financeiro desvincula NF.'; end if;
  select * into n from public.notas_fiscais_auria x where x.id = p_nf
     and (public.minha_role_auria() = 'super_admin' or x.empresa_id = public.minha_empresa());
  if n.id is null then raise exception 'NF não encontrada.'; end if;
  if n.origem <> 'externa' or n.vinculado_em is null then raise exception 'Só NF vinculada pelo financeiro pode ser desvinculada.'; end if;
  update public.parcelas_auria set status = coalesce(n.vinc_status_ant, 'autorizada'), data_faturamento = null, data_pagamento = null
    where id = n.parcela_id and status in ('faturada','paga');
  update public.notas_fiscais_auria set parcela_id = null, contrato_id = null,
      vinculado_por = null, vinculado_em = null, vinc_status_ant = null
    where id = p_nf;
end $$;
grant execute on function public.nf_desvincular_parcela(uuid) to authenticated;

-- ── 2) Lembrete 2 dias antes de fechar (pg_cron) ────────────────────────────
create or replace function public.nf_janela_lembrete()
returns int language plpgsql security definer set search_path = public as $$
declare j record; r record; v_nome text; v_fin text; v_link text; v_corpo text; v_fecha text; v_n int := 0; v_extra text[];
begin
  for j in
    select * from public.nf_janela_auria x
     where x.lembrete_em is null and x.abre_em <= now()
       and x.fecha_em > now() and x.fecha_em <= now() + interval '2 days'
  loop
    begin
      select g.nome into v_nome from public.empresas_auria g where g.id = j.empresa_id;
      select u.email into v_fin from public.usuarios_auria u where u.id = j.criado_por;
      v_fecha := to_char(j.fecha_em at time zone 'America/Fortaleza', 'DD/MM "às" HH24:MI');
      v_link  := 'https://auria.solutions/nf.html?t=' || j.token;

      -- projetistas com parcela AUTORIZADA pelo coordenador/gestor e ainda sem NF
      for r in
        select distinct lower(ct.projetista_email) as email, coalesce(ct.projetista_nome, ct.projetista_email) as nome
          from public.parcelas_auria pa
          join public.contratos_auria ct on ct.id = pa.contrato_id
          join public.empreendimentos_auria e on e.id = ct.empreendimento_id
         where e.empresa_id = j.empresa_id and ct.status = 'ativo' and pa.status = 'autorizada'
           and coalesce(ct.projetista_email,'') <> ''
           and not exists (select 1 from public.notas_fiscais_auria o where o.parcela_id = pa.id and o.status <> 'cancelada')
      loop
        v_corpo := 'Olá, ' || public.auria_esc(r.nome) || '.<br><br>O recebimento de notas fiscais de <b>' || public.auria_esc(coalesce(v_nome,'')) ||
                   '</b>' || coalesce(' (competência <b>'||public.auria_esc(j.competencia)||'</b>)','') ||
                   ' fecha em <b>' || v_fecha || '</b>.' ||
                   '<br><br>Você tem parcela(s) autorizada(s) pela coordenação ainda sem nota fiscal. Envie pelo Painel do Projetista antes do prazo.' ||
                   coalesce('<br><br>'||public.auria_esc(j.mensagem),'');
        perform public.auria_send_email(array[r.email],
          'Recebimento de NF fecha em ' || to_char(j.fecha_em at time zone 'America/Fortaleza','DD/MM'),
          public.auria_email_shell('Notas fiscais', 'Último prazo para enviar a NF', v_corpo, 'Abrir Painel do Projetista', 'https://auria.solutions/projetista.html'),
          null, v_fin);
        v_n := v_n + 1;
      end loop;

      -- e-mails extras (escritórios sem cadastro) que ainda não enviaram NF nesta janela
      select array_agg(x) into v_extra
        from (select distinct lower(trim(y)) as x from unnest(j.emails_extra) y where trim(y) <> '') s
       where not exists (select 1 from public.notas_fiscais_auria o
                          where o.janela_id = j.id and o.status <> 'cancelada' and lower(o.projetista_email) = s.x);
      if coalesce(array_length(v_extra,1),0) > 0 then
        v_corpo := 'O recebimento de notas fiscais de <b>' || public.auria_esc(coalesce(v_nome,'')) || '</b>' ||
                   coalesce(' (competência <b>'||public.auria_esc(j.competencia)||'</b>)','') ||
                   ' fecha em <b>' || v_fecha || '</b>. Depois disso o link não aceita envios.' ||
                   coalesce('<br><br>'||public.auria_esc(j.mensagem),'');
        perform public.auria_send_email(v_extra,
          'Recebimento de NF fecha em ' || to_char(j.fecha_em at time zone 'America/Fortaleza','DD/MM'),
          public.auria_email_shell('Notas fiscais', 'Último prazo para enviar a NF', v_corpo, 'Enviar nota fiscal', v_link),
          null, v_fin);
        v_n := v_n + coalesce(array_length(v_extra,1),0);
      end if;

      update public.nf_janela_auria set lembrete_em = now() where id = j.id;
    exception when others then
      raise notice 'nf_janela_lembrete janela %: %', j.id, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;
revoke all on function public.nf_janela_lembrete() from public, anon, authenticated;

create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('nf-janela-lembrete'); exception when others then null; end $$;
select cron.schedule('nf-janela-lembrete', '0 11 * * *', $job$ select public.nf_janela_lembrete(); $job$);   -- 08:00 Fortaleza

-- ── 3) "Faturamento autorizado" informa a janela (a aprovação é o gatilho) ──
create or replace function public.nf_janela_frase(p_empresa uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when j.id is not null then
      'O recebimento de NF está <b>aberto até ' || to_char(j.fecha_em at time zone 'America/Fortaleza','DD/MM "às" HH24:MI') || '</b>.'
    when nx.abre_em is not null then
      'O recebimento de NF está fechado no momento; a próxima janela abre em <b>' ||
      to_char(nx.abre_em at time zone 'America/Fortaleza','DD/MM') || '</b> e vai até <b>' ||
      to_char(nx.fecha_em at time zone 'America/Fortaleza','DD/MM') || '</b> — você será avisado.'
    else 'O recebimento de NF está fechado no momento; o financeiro avisa quando abrir a próxima janela.' end
  from (select 1) z
  left join lateral (select x.id, x.fecha_em from public.nf_janela_auria x
                      where x.empresa_id = p_empresa and now() between x.abre_em and x.fecha_em
                      order by x.fecha_em desc limit 1) j on true
  left join lateral (select x.abre_em, x.fecha_em from public.nf_janela_auria x
                      where x.empresa_id = p_empresa and x.abre_em > now() order by x.abre_em limit 1) nx on true;
$$;

create or replace function public.notif_parcela_status()
returns trigger language plpgsql security definer as $$
declare c record; dest text[]; info text; corpo text;
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;

  select ct.projetista_email, ct.projetista_nome, ct.numero, ct.objeto, ct.disciplina, e.nome as emp_nome, e.empresa_id
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
    dest  := public.auria_emails_equipe(c.emp_nome);
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

-- ── conferência ─────────────────────────────────────────────────────────────
select 'nf_vincular_parcela' as item, exists(select 1 from pg_proc where proname='nf_vincular_parcela') as ok
union all select 'nf_desvincular_parcela', exists(select 1 from pg_proc where proname='nf_desvincular_parcela')
union all select 'fin_parcelas_vinculaveis', exists(select 1 from pg_proc where proname='fin_parcelas_vinculaveis')
union all select 'nf_janela_lembrete', exists(select 1 from pg_proc where proname='nf_janela_lembrete')
union all select 'nf_janela_frase', exists(select 1 from pg_proc where proname='nf_janela_frase')
union all select 'cron nf-janela-lembrete', exists(select 1 from cron.job where jobname='nf-janela-lembrete')
union all select 'nf_janela_auria.lembrete_em', exists(select 1 from information_schema.columns where table_name='nf_janela_auria' and column_name='lembrete_em');
