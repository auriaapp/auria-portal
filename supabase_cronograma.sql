-- ============================================================
-- AURIA — Cronograma por empreendimento
-- Cole e execute no SQL Editor do Supabase.
-- Cada empreendimento tem suas próprias tarefas (independente de
-- prancha/disciplina). Edição pelo painel da gestão.
-- ============================================================

create table if not exists public.cronograma_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  nome              text not null,
  data_inicio       date,
  data_fim          date,
  progresso         int  default 0 check (progresso between 0 and 100),
  ordem             int  default 0,
  criado_em         timestamptz default now(),
  atualizado_em     timestamptz default now()
);

-- Estrutura/hierarquia vinda do MS Project (preservada no painel)
alter table public.cronograma_auria add column if not exists nivel int default 0;
alter table public.cronograma_auria add column if not exists tipo  text default 'tarefa'; -- tarefa | fase | marco
alter table public.cronograma_auria add column if not exists wbs   text;

create index if not exists idx_cronograma_emp
  on public.cronograma_auria(empreendimento_id, ordem);

alter table public.cronograma_auria enable row level security;

-- Gerente/super_admin da empresa dona do empreendimento: acesso total.
drop policy if exists "cron_ger_all" on public.cronograma_auria;
create policy "cron_ger_all" on public.cronograma_auria for all using (
  exists (
    select 1 from public.empreendimentos_auria e
    where e.id = empreendimento_id
      and e.empresa_id = public.minha_empresa()
  )
) with check (
  exists (
    select 1 from public.empreendimentos_auria e
    where e.id = empreendimento_id
      and e.empresa_id = public.minha_empresa()
  )
);

-- Analista com acesso ao empreendimento: pode visualizar.
drop policy if exists "cron_ana_sel" on public.cronograma_auria;
create policy "cron_ana_sel" on public.cronograma_auria for select using (
  exists (
    select 1 from public.analista_empreendimento_auria ae
    where ae.analista_id = auth.uid()
      and ae.empreendimento_id = empreendimento_id
      and ae.ativo = true
  )
);

-- ============================================================
-- LOG de publicações/edições do cronograma (quem e quando)
-- ============================================================
create table if not exists public.cronograma_log_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  usuario_nome      text,
  usuario_email     text,
  acao              text default 'publicou',  -- publicou | editou
  quando            timestamptz default now()
);

create index if not exists idx_cronlog_emp
  on public.cronograma_log_auria(empreendimento_id, quando desc);

alter table public.cronograma_log_auria enable row level security;

drop policy if exists "cronlog_ger_all" on public.cronograma_log_auria;
create policy "cronlog_ger_all" on public.cronograma_log_auria for all using (
  exists (select 1 from public.empreendimentos_auria e
    where e.id = empreendimento_id and e.empresa_id = public.minha_empresa())
) with check (
  exists (select 1 from public.empreendimentos_auria e
    where e.id = empreendimento_id and e.empresa_id = public.minha_empresa())
);

drop policy if exists "cronlog_ana" on public.cronograma_log_auria;
create policy "cronlog_ana" on public.cronograma_log_auria for all using (
  exists (select 1 from public.analista_empreendimento_auria ae
    where ae.analista_id = auth.uid() and ae.empreendimento_id = empreendimento_id and ae.ativo = true)
) with check (
  exists (select 1 from public.analista_empreendimento_auria ae
    where ae.analista_id = auth.uid() and ae.empreendimento_id = empreendimento_id and ae.ativo = true)
);

NOTIFY pgrst, 'reload schema';
