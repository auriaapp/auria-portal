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
