-- ============================================================================
--  ITEM 79 — EXPORTAR CRONOGRAMA PARA O PROJETISTA (recorte por disciplina).
--  O coordenador marca tarefas no Gantt e envia para uma DISCIPLINA: o recorte
--  fica salvo (um vigente por empreendimento × disciplina; reenviar substitui),
--  o projetista da disciplina vê o Gantt só com essas tarefas no painel dele
--  (sempre atualizado pela sincronização) e recebe e-mail com a tabela.
--  Vale para cronograma do Prevision (prevision_tarefa_auria) e importado
--  (cronograma_auria) — guarda os ids da fonte. Reaplicável.
-- ============================================================================
create table if not exists public.cronograma_recorte_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  disciplina        text not null,
  fonte             text not null default 'prevision',   -- prevision | auria
  fase              text,                                -- fase do Prevision (EXE…) de onde veio
  tarefa_ids        uuid[] not null default '{}',
  mensagem          text,
  enviado_por       uuid,
  enviado_por_nome  text,
  enviado_em        timestamptz not null default now(),
  destinatarios     text[] default '{}',
  unique (empreendimento_id, disciplina)
);
alter table public.cronograma_recorte_auria enable row level security;

-- e-mail do usuário logado (projetista) casa com projetistas_auria → fornecedor → disciplina do empreendimento
create or replace function public.cron_recorte_e_meu(p_emp uuid, p_disc text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.disciplina_fornecedor_auria df
      join public.projetistas_auria p on p.fornecedor_id = df.fornecedor_id and p.ativo is distinct from false
     where df.empreendimento_id = p_emp and df.disciplina = p_disc
       and lower(p.email) = lower(coalesce((select u.email from public.usuarios_auria u where u.id = auth.uid()), (select email from auth.users where id = auth.uid()), '')));
$$;
grant execute on function public.cron_recorte_e_meu(uuid, text) to authenticated;

drop policy if exists cron_rec_sel on public.cronograma_recorte_auria;
create policy cron_rec_sel on public.cronograma_recorte_auria for select
  using (public.cde_pav_pode_ver(empreendimento_id) or public.cron_recorte_e_meu(empreendimento_id, disciplina));
grant select on public.cronograma_recorte_auria to authenticated;

-- ── ENVIAR (coordenador com edição ou gestão) ───────────────────────────────
create or replace function public.cronograma_recorte_enviar(p_emp uuid, p_disciplina text, p_tarefas uuid[], p_mensagem text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nome text; v_emp record; v_fonte text := 'auria'; v_fase text; v_dest text[]; v_rot text; v_conv jsonb;
        v_linhas text := ''; v_n int := 0; r record; v_id uuid; v_forn text;
begin
  if not public.estacao_edita(p_emp) then raise exception 'Só a coordenação ou a gestão do empreendimento envia o cronograma.'; end if;
  if p_disciplina is null or p_disciplina = '' then raise exception 'Informe a disciplina.'; end if;
  if p_tarefas is null or array_length(p_tarefas,1) is null then raise exception 'Marque ao menos uma tarefa.'; end if;
  select coalesce(nome, email) into v_nome from public.usuarios_auria where id = auth.uid();
  select * into v_emp from public.empreendimentos_auria where id = p_emp;

  -- fonte: tarefas do Prevision (fase padrão/qualquer) ou do cronograma importado
  if exists (select 1 from public.prevision_tarefa_auria t where t.id = any(p_tarefas)) then
    v_fonte := 'prevision';
    select t.fase into v_fase from public.prevision_tarefa_auria t where t.id = any(p_tarefas) limit 1;
    for r in select t.wbs, t.nome, t.ini, t.fim, round(coalesce(t.prev,0)*100) as prev, round(coalesce(t.real,0)*100) as real, t.kanban, t.critica,
                    exists (select 1 from public.prevision_tarefa_auria c where c.projeto_id = t.projeto_id and c.removida_em is null and c.wbs like t.wbs||'.%') as fase_
               from public.prevision_tarefa_auria t where t.id = any(p_tarefas) and t.removida_em is null
              order by (select array_agg(lpad(regexp_replace(x,'[^0-9]','','g'),6,'0')) from unnest(string_to_array(coalesce(t.wbs,'0'),'.')) x)
    loop
      v_n := v_n + 1;
      v_linhas := v_linhas || '<tr'||case when r.fase_ then ' style="background:#F6F9FC;font-weight:700"' else '' end||'>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-family:Consolas,monospace;color:#64748B;font-size:12px">'||public.auria_esc(coalesce(r.wbs,''))||'</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:13px">'||public.auria_esc(coalesce(r.nome,''))||case when r.critica and not r.fase_ then ' <span style="background:#E8960A;color:#231703;font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px">crítica</span>' else '' end||'</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;white-space:nowrap;font-size:12px">'||coalesce(to_char(r.ini,'DD/MM/YY'),'—')||'</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;white-space:nowrap;font-size:12px">'||coalesce(to_char(r.fim,'DD/MM/YY'),'—')||'</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;text-align:right;font-size:12px">'||r.prev||'%</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;text-align:right;font-size:12px;font-weight:700">'||r.real||'%</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px">'||public.auria_esc(coalesce(r.kanban,''))||'</td></tr>';
    end loop;
  else
    for r in select c.wbs, c.nome, c.data_inicio as ini, c.data_fim as fim, coalesce(c.progresso,0) as real, c.tipo
               from public.cronograma_auria c where c.id = any(p_tarefas) order by c.ordem
    loop
      v_n := v_n + 1;
      v_linhas := v_linhas || '<tr'||case when r.tipo='fase' then ' style="background:#F6F9FC;font-weight:700"' else '' end||'>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-family:Consolas,monospace;color:#64748B;font-size:12px">'||public.auria_esc(coalesce(r.wbs,''))||'</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:13px">'||public.auria_esc(coalesce(r.nome,''))||'</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;white-space:nowrap;font-size:12px">'||coalesce(to_char(r.ini,'DD/MM/YY'),'—')||'</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;white-space:nowrap;font-size:12px">'||coalesce(to_char(r.fim,'DD/MM/YY'),'—')||'</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;text-align:right;font-size:12px">—</td>'
        || '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;text-align:right;font-size:12px;font-weight:700">'||r.real||'%</td><td></td></tr>';
    end loop;
  end if;
  if v_n = 0 then raise exception 'Nenhuma das tarefas marcadas existe mais.'; end if;

  -- rótulo da disciplina na convenção (ex.: EST → Estrutura) e fornecedor
  begin
    select c.campos into v_conv from public.cde_convencao_auria c join public.empreendimentos_auria e on e.construtora_id = c.construtora_id where e.id = p_emp limit 1;
    select x->>'rotulo' into v_rot from jsonb_array_elements(coalesce(v_conv,'[]'::jsonb)) f, jsonb_array_elements(coalesce(f->'dominio','[]'::jsonb)) x
     where f->>'mapeia' = 'disciplina' and jsonb_typeof(x) = 'object' and x->>'v' = p_disciplina limit 1;
  exception when others then v_rot := null; end;
  select f.nome into v_forn from public.disciplina_fornecedor_auria df join public.fornecedores_auria f on f.id = df.fornecedor_id
   where df.empreendimento_id = p_emp and df.disciplina in (p_disciplina, coalesce(v_rot, p_disciplina)) limit 1;

  -- destinatários: projetistas do fornecedor da disciplina (senão o e-mail de contato do fornecedor)
  select array_agg(distinct lower(p.email)) into v_dest
    from public.disciplina_fornecedor_auria df join public.projetistas_auria p on p.fornecedor_id = df.fornecedor_id and p.ativo is distinct from false
   where df.empreendimento_id = p_emp and df.disciplina in (p_disciplina, coalesce(v_rot, p_disciplina)) and p.email is not null;
  if v_dest is null or array_length(v_dest,1) is null then
    select array_agg(distinct lower(f.email_contato)) into v_dest from public.disciplina_fornecedor_auria df join public.fornecedores_auria f on f.id = df.fornecedor_id
     where df.empreendimento_id = p_emp and df.disciplina in (p_disciplina, coalesce(v_rot, p_disciplina)) and f.email_contato is not null;
  end if;

  insert into public.cronograma_recorte_auria (empreendimento_id, disciplina, fonte, fase, tarefa_ids, mensagem, enviado_por, enviado_por_nome, enviado_em, destinatarios)
  values (p_emp, p_disciplina, v_fonte, v_fase, p_tarefas, nullif(trim(coalesce(p_mensagem,'')),''), auth.uid(), v_nome, now(), coalesce(v_dest,'{}'))
  on conflict (empreendimento_id, disciplina) do update
    set fonte = excluded.fonte, fase = excluded.fase, tarefa_ids = excluded.tarefa_ids, mensagem = excluded.mensagem,
        enviado_por = excluded.enviado_por, enviado_por_nome = excluded.enviado_por_nome, enviado_em = now(), destinatarios = excluded.destinatarios
  returning id into v_id;

  begin
    insert into public.prevision_log_auria (empreendimento_id, acao, fase, detalhe, por, por_nome)
    values (p_emp, 'recorte', v_fase, 'Cronograma enviado ao projetista · '||p_disciplina||' · '||v_n||' tarefa(s)'||case when v_dest is not null then ' · '||array_to_string(v_dest,', ') else ' · sem destinatário' end, auth.uid(), v_nome);
  exception when others then null; end;

  if v_dest is not null and array_length(v_dest,1) > 0 then
    perform public.auria_send_email(v_dest,
      'Cronograma — '||coalesce(v_emp.nome,'')||' · '||coalesce(v_rot, p_disciplina),
      public.auria_email_shell('Auria · Cronograma',
        'Cronograma de '||public.auria_esc(coalesce(v_rot, p_disciplina))||' — '||public.auria_esc(coalesce(v_emp.nome,'')),
        '<p>'||public.auria_esc(coalesce(v_nome,'A coordenação'))||' enviou o cronograma das suas atividades'||case when v_forn is not null then ' ('||public.auria_esc(v_forn)||')' else '' end||'. Ele fica disponível no seu painel e é atualizado automaticamente.</p>'
        || case when p_mensagem is not null and trim(p_mensagem) <> '' then '<p style="background:#FEF3E2;border-left:3px solid #E8960A;padding:8px 12px;border-radius:6px">'||public.auria_esc(p_mensagem)||'</p>' else '' end
        || '<table style="border-collapse:collapse;width:100%;margin-top:10px"><thead><tr style="background:#1E3A5F;color:#fff">'
        || '<th style="padding:6px 8px;text-align:left;font-size:11px">WBS</th><th style="padding:6px 8px;text-align:left;font-size:11px">Tarefa</th><th style="padding:6px 8px;text-align:left;font-size:11px">Início</th><th style="padding:6px 8px;text-align:left;font-size:11px">Fim</th><th style="padding:6px 8px;text-align:right;font-size:11px">Previsto</th><th style="padding:6px 8px;text-align:right;font-size:11px">Realizado</th><th style="padding:6px 8px;text-align:left;font-size:11px">Situação</th></tr></thead><tbody>'
        || v_linhas || '</tbody></table><p style="color:#64748B;font-size:12px;margin-top:10px">'||v_n||' tarefa(s) · enviado em '||to_char(now() at time zone 'America/Fortaleza','DD/MM/YYYY HH24:MI')||'</p>',
        'Abrir no meu painel', 'https://auria.solutions/projetista.html'),
      null, null);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'tarefas', v_n, 'destinatarios', coalesce(v_dest,'{}'::text[]), 'enviado', (v_dest is not null and array_length(v_dest,1) > 0));
end $$;
grant execute on function public.cronograma_recorte_enviar(uuid, text, uuid[], text) to authenticated;

-- ── LER recortes (coordenação: do empreendimento; projetista: os seus) ──────
create or replace function public.cronograma_recortes(p_emp uuid default null)
returns table (id uuid, empreendimento_id uuid, empreendimento text, sigla text, disciplina text, fonte text, fase text, n_tarefas int,
               mensagem text, enviado_por_nome text, enviado_em timestamptz, destinatarios text[], tarefa_ids uuid[])
language sql security definer stable set search_path = public as $$
  select r.id, r.empreendimento_id, e.nome, e.codigo, r.disciplina, r.fonte, r.fase, coalesce(array_length(r.tarefa_ids,1),0),
         r.mensagem, r.enviado_por_nome, r.enviado_em, r.destinatarios, r.tarefa_ids
    from public.cronograma_recorte_auria r join public.empreendimentos_auria e on e.id = r.empreendimento_id
   where (p_emp is null or r.empreendimento_id = p_emp)
     and (public.cde_pav_pode_ver(r.empreendimento_id) or public.cron_recorte_e_meu(r.empreendimento_id, r.disciplina))
   order by e.nome, r.disciplina;
$$;
grant execute on function public.cronograma_recortes(uuid) to authenticated;

-- cronograma_ler com recorte: devolve só as tarefas do recorte (quem pode ver o recorte pode ler)
create or replace function public.cronograma_ler_recorte(p_recorte uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare r record; v_tarefas jsonb;
begin
  select * into r from public.cronograma_recorte_auria x where x.id = p_recorte;
  if r.id is null then raise exception 'Recorte não encontrado.'; end if;
  if not (public.cde_pav_pode_ver(r.empreendimento_id) or public.cron_recorte_e_meu(r.empreendimento_id, r.disciplina)) then raise exception 'Sem acesso a este cronograma.'; end if;
  if r.fonte = 'prevision' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'nome', t.nome, 'wbs', t.wbs, 'nivel', greatest(coalesce(t.nivel,1)-1,0), 'data_inicio', t.ini, 'data_fim', t.fim,
             'progresso', round(coalesce(t.real,0)*100), 'previsto', round(coalesce(t.prev,0)*100),
             'tipo', case when exists (select 1 from public.prevision_tarefa_auria c where c.projeto_id = t.projeto_id and c.removida_em is null and c.wbs like t.wbs||'.%' and c.id = any(r.tarefa_ids)) then 'fase' when coalesce(t.duracao,1)=0 then 'marco' else 'tarefa' end,
             'critica', t.critica, 'kanban', t.kanban, 'kanban_status', t.kanban_status, 'responsaveis', t.responsaveis, 'removida', t.removida_em is not null
           ) order by (select array_agg(lpad(regexp_replace(x,'[^0-9]','','g'),6,'0')) from unnest(string_to_array(coalesce(t.wbs,'0'),'.')) x)), '[]'::jsonb)
      into v_tarefas from public.prevision_tarefa_auria t where t.id = any(r.tarefa_ids);
  else
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'nome',c.nome,'wbs',c.wbs,'nivel',coalesce(c.nivel,0),'data_inicio',c.data_inicio,'data_fim',c.data_fim,
             'progresso',coalesce(c.progresso,0),'tipo',coalesce(c.tipo,'tarefa')) order by c.ordem), '[]'::jsonb)
      into v_tarefas from public.cronograma_auria c where c.id = any(r.tarefa_ids);
  end if;
  return jsonb_build_object('fonte', r.fonte, 'fase', r.fase, 'recorte', jsonb_build_object('id', r.id, 'disciplina', r.disciplina, 'mensagem', r.mensagem,
           'enviado_por_nome', r.enviado_por_nome, 'enviado_em', r.enviado_em), 'pode_editar', false, 'fases', '[]'::jsonb, 'tarefas', v_tarefas);
end $$;
grant execute on function public.cronograma_ler_recorte(uuid) to authenticated;

select 'cronograma_recorte_auria' as item, exists(select 1 from pg_tables where tablename='cronograma_recorte_auria') as ok
union all select 'cronograma_recorte_enviar', exists(select 1 from pg_proc where proname='cronograma_recorte_enviar')
union all select 'cronograma_recortes', exists(select 1 from pg_proc where proname='cronograma_recortes')
union all select 'cronograma_ler_recorte', exists(select 1 from pg_proc where proname='cronograma_ler_recorte');
