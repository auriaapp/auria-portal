-- ============================================================================
--  ITEM 80 — SIMULAÇÃO DE CRONOGRAMA (o que-se): coordenador ou projetista
--  altera datas/duração/% no Gantt do Auria; o sistema recalcula (fases e
--  tarefas seguintes) e a simulação pode ser SALVA (cenário nomeado) e/ou
--  exportada em Excel no modelo de importação do Prevision. NUNCA altera o
--  cronograma sincronizado: guarda só as diferenças (alteracoes) por tarefa.
--  Reaplicável. Requer supabase_cronograma_recorte.sql (cron_recorte_e_meu).
-- ============================================================================
create table if not exists public.cronograma_simulacao_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  fase              text,                                -- fase do Prevision (EXE…) ou null (importado)
  fonte             text not null default 'prevision',
  recorte_id        uuid references public.cronograma_recorte_auria(id) on delete set null,   -- simulação feita pelo projetista sobre o recorte
  nome              text not null,
  alteracoes        jsonb not null default '[]'::jsonb,  -- [{id, inicio, fim, pct, nome?}] valores NOVOS por tarefa
  base_em           timestamptz,                         -- sincronização de referência quando foi salva
  autor             uuid default auth.uid(),
  autor_nome        text,
  arquivada         boolean not null default false,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index if not exists idx_cron_sim_emp on public.cronograma_simulacao_auria(empreendimento_id, arquivada, atualizado_em desc);
alter table public.cronograma_simulacao_auria enable row level security;

-- leitura: quem vê o empreendimento (coordenação/gestão) + o autor
drop policy if exists cron_sim_sel on public.cronograma_simulacao_auria;
create policy cron_sim_sel on public.cronograma_simulacao_auria for select
  using (public.cde_pav_pode_ver(empreendimento_id) or autor = auth.uid());
-- escrita: só o autor, e só se tiver acesso ao empreendimento ou a um recorte dele
drop policy if exists cron_sim_ins on public.cronograma_simulacao_auria;
create policy cron_sim_ins on public.cronograma_simulacao_auria for insert
  with check (autor = auth.uid() and (public.cde_pav_pode_ver(empreendimento_id)
              or exists (select 1 from public.cronograma_recorte_auria r where r.id = recorte_id and public.cron_recorte_e_meu(r.empreendimento_id, r.disciplina))));
drop policy if exists cron_sim_upd on public.cronograma_simulacao_auria;
create policy cron_sim_upd on public.cronograma_simulacao_auria for update
  using (autor = auth.uid()) with check (autor = auth.uid());
grant select, insert, update on public.cronograma_simulacao_auria to authenticated;

-- nome do autor preenchido no servidor (o front não precisa saber)
create or replace function public.cron_sim_autor() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.autor_nome is null then select coalesce(nome, email) into new.autor_nome from public.usuarios_auria where id = auth.uid(); end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists trg_cron_sim_autor on public.cronograma_simulacao_auria;
create trigger trg_cron_sim_autor before insert or update on public.cronograma_simulacao_auria for each row execute function public.cron_sim_autor();

select 'cronograma_simulacao_auria' as item, exists(select 1 from pg_tables where tablename='cronograma_simulacao_auria') as ok;
