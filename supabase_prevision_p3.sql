-- ============================================================================
--  ITEM 77 (passo 2b) — LOG de quem definiu a fase padrão do cronograma
--  (coordenador ou gestão). Grava no vínculo (estado atual) e num histórico.
--  Reaplicável. Requer supabase_prevision.sql e supabase_prevision_p2.sql.
-- ============================================================================
alter table public.prevision_vinculo_auria add column if not exists padrao_por      uuid;
alter table public.prevision_vinculo_auria add column if not exists padrao_por_nome text;
alter table public.prevision_vinculo_auria add column if not exists padrao_em       timestamptz;

create table if not exists public.prevision_log_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  vinculo_id        uuid references public.prevision_vinculo_auria(id) on delete set null,
  acao              text not null,          -- padrao | vinculo | sync
  fase              text,
  detalhe           text,
  por               uuid,
  por_nome          text,
  quando            timestamptz not null default now()
);
create index if not exists idx_pv_log_emp on public.prevision_log_auria(empreendimento_id, quando desc);
alter table public.prevision_log_auria enable row level security;
drop policy if exists pv_log_sel on public.prevision_log_auria;
create policy pv_log_sel on public.prevision_log_auria for select using (public.cde_pav_pode_ver(empreendimento_id));
grant select on public.prevision_log_auria to authenticated;

-- fase padrão: coordenador com edição OU gestão; registra quem/quando + histórico
create or replace function public.prevision_set_padrao(p_emp uuid, p_vinculo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_nome text; v_fase text;
begin
  if not public.estacao_edita(p_emp) then raise exception 'Só a coordenação ou a gestão do empreendimento define a fase padrão.'; end if;
  select coalesce(nome, email) into v_nome from public.usuarios_auria where id = auth.uid();
  select fase into v_fase from public.prevision_vinculo_auria where id = p_vinculo and empreendimento_id = p_emp and ativo;
  if v_fase is null then raise exception 'Vínculo não encontrado.'; end if;
  update public.prevision_vinculo_auria set padrao = (id = p_vinculo),
         padrao_por = case when id = p_vinculo then auth.uid() else padrao_por end,
         padrao_por_nome = case when id = p_vinculo then v_nome else padrao_por_nome end,
         padrao_em = case when id = p_vinculo then now() else padrao_em end
   where empreendimento_id = p_emp and ativo;
  insert into public.prevision_log_auria (empreendimento_id, vinculo_id, acao, fase, detalhe, por, por_nome)
  values (p_emp, p_vinculo, 'padrao', v_fase, 'Fase padrão do cronograma: '||v_fase, auth.uid(), v_nome);
end $$;
grant execute on function public.prevision_set_padrao(uuid, uuid) to authenticated;

-- cronograma_ler passa a devolver quem definiu o padrão (no vínculo e na lista de fases) + últimos registros do log
create or replace function public.cronograma_ler(p_emp uuid, p_fase text default null)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_vinc record; v_fases jsonb; v_tarefas jsonb; v_edita boolean; v_log jsonb;
begin
  if not public.cde_pav_pode_ver(p_emp) then raise exception 'Sem acesso a este empreendimento.'; end if;
  v_edita := public.estacao_edita(p_emp);
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'fase',v.fase,'projeto_nome',v.projeto_nome,'padrao',v.padrao,
           'sincronizado_em',v.sincronizado_em,'n_tarefas',v.n_tarefas,'sync_erro',v.sync_erro,
           'padrao_por_nome',v.padrao_por_nome,'padrao_em',v.padrao_em)
           order by array_position(array['INC','PROD','ORC','EXE'], v.fase) nulls last, v.fase), '[]'::jsonb)
    into v_fases from public.prevision_vinculo_auria v where v.empreendimento_id = p_emp and v.ativo;
  select coalesce(jsonb_agg(jsonb_build_object('acao',l.acao,'fase',l.fase,'detalhe',l.detalhe,'por_nome',l.por_nome,'quando',l.quando) order by l.quando desc), '[]'::jsonb)
    into v_log from (select * from public.prevision_log_auria where empreendimento_id = p_emp order by quando desc limit 10) l;

  select * into v_vinc from public.prevision_vinculo_auria v
   where v.empreendimento_id = p_emp and v.ativo and (p_fase is null or v.fase = upper(p_fase))
   order by (p_fase is not null and v.fase = upper(p_fase)) desc, v.padrao desc,
            array_position(array['EXE','PROD','ORC','INC'], v.fase) nulls last
   limit 1;

  if v_vinc.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'tarefa_id', t.tarefa_id, 'nome', t.nome, 'wbs', t.wbs, 'nivel', greatest(coalesce(t.nivel,1)-1,0),
             'data_inicio', t.ini, 'data_fim', t.fim,
             'progresso', round(coalesce(t.real,0)*100), 'previsto', round(coalesce(t.prev,0)*100),
             'tipo', case when exists (select 1 from public.prevision_tarefa_auria c where c.projeto_id = t.projeto_id and c.removida_em is null and c.wbs like t.wbs || '.%') then 'fase'
                          when coalesce(t.duracao,1) = 0 then 'marco' else 'tarefa' end,
             'critica', t.critica, 'kanban', t.kanban, 'kanban_status', t.kanban_status,
             'responsaveis', t.responsaveis, 'etiquetas', t.etiquetas, 'colunas', t.colunas,
             'atraso_base', t.atraso_base, 'atraso_data', t.atraso_data, 'custo', t.custo,
             'base_ini', t.base_ini, 'base_fim', t.base_fim, 'marco_medicao', t.marco_medicao
           ) order by (select array_agg(lpad(regexp_replace(x,'[^0-9]','','g'),6,'0')) from unnest(string_to_array(coalesce(t.wbs,'0'),'.')) x)), '[]'::jsonb)
      into v_tarefas
      from public.prevision_tarefa_auria t
     where t.vinculo_id = v_vinc.id and t.removida_em is null;
    return jsonb_build_object('fonte','prevision','fase',v_vinc.fase,'vinculo',jsonb_build_object('id',v_vinc.id,'fase',v_vinc.fase,
             'projeto_nome',v_vinc.projeto_nome,'padrao',v_vinc.padrao,'sincronizado_em',v_vinc.sincronizado_em,'sync_erro',v_vinc.sync_erro,
             'padrao_por_nome',v_vinc.padrao_por_nome,'padrao_em',v_vinc.padrao_em),
             'fases',v_fases,'pode_editar',v_edita,'log',v_log,'tarefas',v_tarefas);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'nome',c.nome,'wbs',c.wbs,'nivel',coalesce(c.nivel,0),
           'data_inicio',c.data_inicio,'data_fim',c.data_fim,'progresso',coalesce(c.progresso,0),'tipo',coalesce(c.tipo,'tarefa'),'ordem',c.ordem)
           order by c.ordem), '[]'::jsonb)
    into v_tarefas from public.cronograma_auria c where c.empreendimento_id = p_emp;
  return jsonb_build_object('fonte','auria','fase',null,'vinculo',null,'fases',v_fases,'pode_editar',v_edita,'log',v_log,'tarefas',v_tarefas);
end $$;
grant execute on function public.cronograma_ler(uuid, text) to authenticated;

select 'prevision_log_auria' as item, exists(select 1 from pg_tables where tablename='prevision_log_auria') as ok
union all select 'padrao_por_nome', exists(select 1 from information_schema.columns where table_name='prevision_vinculo_auria' and column_name='padrao_por_nome');
