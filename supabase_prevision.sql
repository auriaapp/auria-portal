-- ============================================================================
--  ITEM 77 (etapa 2, passo 1) — INTEGRAÇÃO PREVISION: vínculo + tarefas espelho.
--  Sentido único Prevision → Auria (a API deles é só leitura). Quem escreve nas
--  tabelas é a Edge Function `prevision` (service role); o front só lê e, via
--  RPC, escolhe a FASE PADRÃO do empreendimento (coordenador ou gestão).
--  Nada é apagado: tarefa que some no Prevision recebe removida_em. Reaplicável.
-- ============================================================================

-- 1) Vínculo: 1 empreendimento ↔ N projetos do Prevision (um por FASE).
--    fase = prefixo do nome do projeto no Prevision (EXE/PROD/ORC/INC…), OUTRA se não reconhecido.
create table if not exists public.prevision_vinculo_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  fase              text not null,                      -- EXE | PROD | ORC | INC | OUTRA
  projeto_id        text not null,                      -- id (uuid) do projeto no Prevision
  projeto_nome      text,
  plataforma        text not null default 'incorporacao', -- incorporacao | obra
  padrao            boolean not null default false,     -- fase exibida por padrão no Auria
  ativo             boolean not null default true,      -- desvincular = ativo=false (não apaga)
  sincronizado_em   timestamptz,
  sync_erro         text,
  n_tarefas         int default 0,
  criado_por        uuid default auth.uid(),
  criado_em         timestamptz not null default now(),
  unique (empreendimento_id, projeto_id)
);
create index if not exists idx_pv_vinc_emp on public.prevision_vinculo_auria(empreendimento_id, ativo);

-- 2) Tarefas espelho (o cronograma do Prevision, normalizado pela Edge Function).
create table if not exists public.prevision_tarefa_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  vinculo_id        uuid references public.prevision_vinculo_auria(id) on delete cascade,
  fase              text not null,
  projeto_id        text not null,
  tarefa_id         text not null,                      -- id da tarefa no Prevision
  wbs               text,
  nivel             int,                                -- profundidade do WBS (1 = raiz)
  nome              text,
  ini               date, fim date, duracao numeric, custo numeric,
  prev              numeric, real numeric,              -- frações 0–1 (como o Prevision entrega)
  base_prev         numeric, base_ini date, base_fim date,
  atraso_base       numeric, atraso_data numeric,
  critica           boolean default false,
  kanban            text, kanban_status text,           -- ex.: Finalizado / finished
  responsaveis      text[] default '{}',
  etiquetas         text[] default '{}',
  colunas           jsonb default '{}'::jsonb,          -- colunas do Gantt da empresa (IDP, Projetista, COD, Obra…)
  marco_medicao     boolean not null default false,     -- 77d: marcado pelo coordenador (passo 3)
  removida_em       timestamptz,                        -- sumiu no Prevision (não apagamos)
  atualizado_em     timestamptz not null default now(),
  unique (projeto_id, tarefa_id)
);
create index if not exists idx_pv_tar_emp   on public.prevision_tarefa_auria(empreendimento_id, fase, removida_em);
create index if not exists idx_pv_tar_wbs   on public.prevision_tarefa_auria(projeto_id, wbs);

-- 3) RLS: leitura = quem vê o empreendimento (mesma régua dos pavimentos); escrita = service role
--    (Edge Function) e, para o vínculo, a gestão do empreendimento.
alter table public.prevision_vinculo_auria enable row level security;
alter table public.prevision_tarefa_auria  enable row level security;
drop policy if exists pv_vinc_sel on public.prevision_vinculo_auria;
create policy pv_vinc_sel on public.prevision_vinculo_auria for select using (public.cde_pav_pode_ver(empreendimento_id));
drop policy if exists pv_vinc_adm on public.prevision_vinculo_auria;
create policy pv_vinc_adm on public.prevision_vinculo_auria for all
  using (public.estacao_pode(empreendimento_id)) with check (public.estacao_pode(empreendimento_id));
drop policy if exists pv_tar_sel on public.prevision_tarefa_auria;
create policy pv_tar_sel on public.prevision_tarefa_auria for select using (public.cde_pav_pode_ver(empreendimento_id));
grant select on public.prevision_vinculo_auria, public.prevision_tarefa_auria to authenticated;
grant insert, update on public.prevision_vinculo_auria to authenticated;

-- 4) Fase padrão do empreendimento (coordenador com edição OU gestão). Uma só por empreendimento.
create or replace function public.prevision_set_padrao(p_emp uuid, p_vinculo uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.estacao_edita(p_emp) then raise exception 'Só a coordenação ou a gestão do empreendimento define a fase padrão.'; end if;
  update public.prevision_vinculo_auria set padrao = (id = p_vinculo) where empreendimento_id = p_emp and ativo;
end $$;
grant execute on function public.prevision_set_padrao(uuid, uuid) to authenticated;

-- 5) Resumo por empreendimento (cards): fase padrão, avanço da raiz, tarefas críticas atrasadas.
create or replace function public.prevision_resumo(p_emp uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case when not public.cde_pav_pode_ver(p_emp) then null else
    (select jsonb_build_object(
      'vinculos', (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'fase',v.fase,'projeto_nome',v.projeto_nome,'padrao',v.padrao,
                    'sincronizado_em',v.sincronizado_em,'n_tarefas',v.n_tarefas,'sync_erro',v.sync_erro) order by v.padrao desc, v.fase), '[]'::jsonb)
                    from public.prevision_vinculo_auria v where v.empreendimento_id = p_emp and v.ativo),
      'raiz', (select jsonb_build_object('fase',t.fase,'nome',t.nome,'ini',t.ini,'fim',t.fim,'prev',t.prev,'real',t.real,'kanban',t.kanban)
                 from public.prevision_tarefa_auria t join public.prevision_vinculo_auria v on v.id = t.vinculo_id
                where t.empreendimento_id = p_emp and v.padrao and t.removida_em is null and t.nivel = 1 limit 1),
      'criticas_atrasadas', (select count(*) from public.prevision_tarefa_auria t join public.prevision_vinculo_auria v on v.id = t.vinculo_id
                where t.empreendimento_id = p_emp and v.padrao and t.removida_em is null and t.critica
                  and coalesce(t.kanban_status,'') <> 'finished' and t.fim < current_date)
    )) end;
$$;
grant execute on function public.prevision_resumo(uuid) to authenticated;

select 'prevision_vinculo_auria' as tabela, exists(select 1 from pg_tables where tablename='prevision_vinculo_auria') as ok
union all select 'prevision_tarefa_auria', exists(select 1 from pg_tables where tablename='prevision_tarefa_auria')
union all select 'prevision_set_padrao', exists(select 1 from pg_proc where proname='prevision_set_padrao')
union all select 'prevision_resumo', exists(select 1 from pg_proc where proname='prevision_resumo');
