-- ============================================================================
--  ITEM 81 — KANBAN DO ANALISTA × CRONOGRAMA (opção). Quando o analista liga
--  "Tarefas do cronograma", as tarefas do Prevision (fase padrão, folhas, não
--  concluídas) dos empreendimentos dele em que ELE é o responsável viram cartões
--  no Kanban (tabela tarefas): título "WBS · nome", prazo = fim, prioridade Alta se
--  crítica, etiqueta origem='cronograma'. A sincronização atualiza título/prazo/
--  descrição, marca Concluído quando o Prevision finaliza e respeita cartões que o
--  analista descartou (ignorada). O status/prioridade que ele mexeu são mantidos.
--  Reaplicável. Requer supabase_prevision.sql.
-- ============================================================================
alter table public.tarefas add column if not exists origem            text;          -- 'cronograma' | null (manual)
alter table public.tarefas add column if not exists origem_id         uuid;          -- prevision_tarefa_auria.id
alter table public.tarefas add column if not exists empreendimento_id uuid;
alter table public.tarefas add column if not exists ignorada          boolean not null default false;
create unique index if not exists idx_tarefas_origem on public.tarefas(analista_id, origem_id) where origem_id is not null;

create table if not exists public.kanban_pref_auria (
  usuario_id  uuid primary key,
  cronograma  boolean not null default false,
  atualizado_em timestamptz default now()
);
alter table public.kanban_pref_auria enable row level security;
drop policy if exists kanban_pref_own on public.kanban_pref_auria;
create policy kanban_pref_own on public.kanban_pref_auria for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update on public.kanban_pref_auria to authenticated;

-- responsável bate com o usuário? (nome completo igual, ou 1º+último nome contidos)
create or replace function public.kanban_resp_e_eu(p_resp text[], p_nome text) returns boolean language sql immutable as $$
  select coalesce((
    select bool_or(
      lower(trim(r)) = lower(trim(p_nome))
      or (array_length(string_to_array(trim(p_nome),' '),1) >= 2
          and position(lower(split_part(trim(p_nome),' ',1)) in lower(r)) > 0
          and position(lower((string_to_array(trim(p_nome),' '))[array_length(string_to_array(trim(p_nome),' '),1)]) in lower(r)) > 0))
    from unnest(coalesce(p_resp,'{}'::text[])) r), false);
$$;

create or replace function public.kanban_sync_cronograma()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_nome text; v_novos int := 0; v_atual int := 0; v_concl int := 0; r record; v_id uuid; v_st text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select coalesce(nome,'') into v_nome from public.usuarios_auria where id = v_uid;
  if trim(v_nome) = '' then return jsonb_build_object('ok', false, 'erro', 'Seu cadastro não tem nome — o Prevision identifica o responsável pelo nome.'); end if;
  perform 1 from public.kanban_pref_auria where usuario_id = v_uid and cronograma;
  if not found then return jsonb_build_object('ok', true, 'ativo', false, 'novos', 0, 'atualizados', 0, 'concluidos', 0); end if;

  for r in
    select t.id, t.empreendimento_id, t.fase, t.wbs, t.nome, t.fim, t.critica, t.kanban, t.real, t.kanban_status, t.removida_em, e.nome as emp, e.codigo as sigla
      from public.prevision_tarefa_auria t
      join public.prevision_vinculo_auria v on v.id = t.vinculo_id and v.ativo and v.padrao
      join public.empreendimentos_auria e on e.id = t.empreendimento_id
     where public.estacao_pode(t.empreendimento_id)
       and public.kanban_resp_e_eu(t.responsaveis, v_nome)
       and not exists (select 1 from public.prevision_tarefa_auria c where c.projeto_id = t.projeto_id and c.removida_em is null and c.wbs like t.wbs||'.%')
  loop
    select id, status into v_id, v_st from public.tarefas where analista_id = v_uid and origem_id = r.id;
    if v_id is null then
      if r.removida_em is not null or coalesce(r.kanban_status,'') = 'finished' or coalesce(r.real,0) >= 1 then continue; end if;   -- já concluída: não cria
      insert into public.tarefas (analista_id, titulo, descricao, prioridade, status, prazo, origem, origem_id, empreendimento_id)
      values (v_uid, coalesce(r.wbs,'')||' · '||coalesce(r.nome,''),
              coalesce(r.sigla, r.emp)||' · cronograma '||coalesce(r.fase,'')||case when r.kanban is not null then ' · '||r.kanban else '' end||case when r.critica then ' · crítica' else '' end,
              case when r.critica then 'Alta' else 'Média' end, 'A fazer', r.fim, 'cronograma', r.id, r.empreendimento_id);
      v_novos := v_novos + 1;
    else
      if r.removida_em is not null or coalesce(r.kanban_status,'') = 'finished' or coalesce(r.real,0) >= 1 then
        if v_st is distinct from 'Concluído' then update public.tarefas set status = 'Concluído' where id = v_id; v_concl := v_concl + 1; end if;
      else
        update public.tarefas set titulo = coalesce(r.wbs,'')||' · '||coalesce(r.nome,''),
               descricao = coalesce(r.sigla, r.emp)||' · cronograma '||coalesce(r.fase,'')||case when r.kanban is not null then ' · '||r.kanban else '' end||case when r.critica then ' · crítica' else '' end,
               prazo = r.fim, prioridade = case when r.critica then 'Alta' else prioridade end
         where id = v_id and not ignorada;
        v_atual := v_atual + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'ativo', true, 'novos', v_novos, 'atualizados', v_atual, 'concluidos', v_concl, 'nome', v_nome);
end $$;
grant execute on function public.kanban_sync_cronograma() to authenticated;

select 'tarefas.origem' as item, exists(select 1 from information_schema.columns where table_name='tarefas' and column_name='origem') as ok
union all select 'kanban_pref_auria', exists(select 1 from pg_tables where tablename='kanban_pref_auria')
union all select 'kanban_sync_cronograma', exists(select 1 from pg_proc where proname='kanban_sync_cronograma');

-- ── 81b: ENVIAR AO KANBAN a partir do cronograma (seleção manual, sem depender do nome) ─────────
create or replace function public.kanban_add_cronograma(p_tarefas uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r record; v_novos int := 0; v_ja int := 0; v_id uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  for r in select t.id, t.empreendimento_id, t.fase, t.wbs, t.nome, t.fim, t.critica, t.kanban, e.nome as emp, e.codigo as sigla
             from public.prevision_tarefa_auria t join public.empreendimentos_auria e on e.id = t.empreendimento_id
            where t.id = any(p_tarefas) and t.removida_em is null and public.cde_pav_pode_ver(t.empreendimento_id)
              and not exists (select 1 from public.prevision_tarefa_auria c where c.projeto_id = t.projeto_id and c.removida_em is null and c.wbs like t.wbs||'.%')
  loop
    select id into v_id from public.tarefas where analista_id = v_uid and origem_id = r.id;
    if v_id is not null then update public.tarefas set ignorada = false where id = v_id; v_ja := v_ja + 1; continue; end if;
    insert into public.tarefas (analista_id, titulo, descricao, prioridade, status, prazo, origem, origem_id, empreendimento_id)
    values (v_uid, coalesce(r.wbs,'')||' · '||coalesce(r.nome,''),
            coalesce(r.sigla, r.emp)||' · cronograma '||coalesce(r.fase,'')||case when r.kanban is not null then ' · '||r.kanban else '' end||case when r.critica then ' · crítica' else '' end,
            case when r.critica then 'Alta' else 'Média' end, 'A fazer', r.fim, 'cronograma', r.id, r.empreendimento_id);
    v_novos := v_novos + 1;
  end loop;
  return jsonb_build_object('ok', true, 'novos', v_novos, 'ja_existiam', v_ja);
end $$;
grant execute on function public.kanban_add_cronograma(uuid[]) to authenticated;

-- sincronização passa a cuidar também dos cartões enviados manualmente (mesmo sem a opção automática ligada)
create or replace function public.kanban_sync_cronograma()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_nome text; v_auto boolean := false; v_novos int := 0; v_atual int := 0; v_concl int := 0; r record; v_id uuid; v_st text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select coalesce(nome,'') into v_nome from public.usuarios_auria where id = v_uid;
  select cronograma into v_auto from public.kanban_pref_auria where usuario_id = v_uid; v_auto := coalesce(v_auto,false);
  for r in
    select t.id, t.empreendimento_id, t.fase, t.wbs, t.nome, t.fim, t.critica, t.kanban, t.real, t.kanban_status, t.removida_em, e.nome as emp, e.codigo as sigla,
           (k.id is not null) as tem_cartao
      from public.prevision_tarefa_auria t
      join public.empreendimentos_auria e on e.id = t.empreendimento_id
      left join public.tarefas k on k.analista_id = v_uid and k.origem_id = t.id
     where (k.id is not null                                                       -- cartão já existe (manual ou automático)
            or (v_auto and trim(v_nome) <> '' and public.estacao_pode(t.empreendimento_id) and public.kanban_resp_e_eu(t.responsaveis, v_nome)
                and exists (select 1 from public.prevision_vinculo_auria v where v.id = t.vinculo_id and v.ativo and v.padrao)))
       and not exists (select 1 from public.prevision_tarefa_auria c where c.projeto_id = t.projeto_id and c.removida_em is null and c.wbs like t.wbs||'.%')
  loop
    select id, status into v_id, v_st from public.tarefas where analista_id = v_uid and origem_id = r.id;
    if v_id is null then
      if r.removida_em is not null or coalesce(r.kanban_status,'') = 'finished' or coalesce(r.real,0) >= 1 then continue; end if;
      insert into public.tarefas (analista_id, titulo, descricao, prioridade, status, prazo, origem, origem_id, empreendimento_id)
      values (v_uid, coalesce(r.wbs,'')||' · '||coalesce(r.nome,''),
              coalesce(r.sigla, r.emp)||' · cronograma '||coalesce(r.fase,'')||case when r.kanban is not null then ' · '||r.kanban else '' end||case when r.critica then ' · crítica' else '' end,
              case when r.critica then 'Alta' else 'Média' end, 'A fazer', r.fim, 'cronograma', r.id, r.empreendimento_id);
      v_novos := v_novos + 1;
    else
      if r.removida_em is not null or coalesce(r.kanban_status,'') = 'finished' or coalesce(r.real,0) >= 1 then
        if v_st is distinct from 'Concluído' then update public.tarefas set status = 'Concluído' where id = v_id; v_concl := v_concl + 1; end if;
      else
        update public.tarefas set titulo = coalesce(r.wbs,'')||' · '||coalesce(r.nome,''),
               descricao = coalesce(r.sigla, r.emp)||' · cronograma '||coalesce(r.fase,'')||case when r.kanban is not null then ' · '||r.kanban else '' end||case when r.critica then ' · crítica' else '' end,
               prazo = r.fim, prioridade = case when r.critica then 'Alta' else prioridade end
         where id = v_id and not ignorada;
        v_atual := v_atual + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'ativo', v_auto, 'novos', v_novos, 'atualizados', v_atual, 'concluidos', v_concl, 'nome', v_nome);
end $$;
grant execute on function public.kanban_sync_cronograma() to authenticated;

select 'kanban_add_cronograma' as item, exists(select 1 from pg_proc where proname='kanban_add_cronograma') as ok;
