-- ============================================================================
--  Item 112 — comentários por tarefa do cronograma (2026-09-23)
--  Rodar no SQL Editor do Supabase.
--
--  A tarefa vem do Prevision (prevision_tarefa_auria) e é reescrita a cada
--  sincronização — por isso o comentário mora numa tabela nossa, amarrada pelo
--  id da tarefa e pelo empreendimento. Quem enxerga o empreendimento lê; quem
--  tem edição (coordenador/gestão) escreve; cada um apaga o que escreveu.
-- ============================================================================

create table if not exists public.cronograma_comentario_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  tarefa_id         uuid not null,              -- prevision_tarefa_auria.id
  tarefa_wbs        text,                       -- guardado para sobreviver a uma troca de fase
  tarefa_nome       text,
  texto             text not null,
  autor_id          uuid,
  autor_nome        text,
  criado_em         timestamptz default now()
);
create index if not exists idx_cron_com_tar on public.cronograma_comentario_auria(tarefa_id, criado_em desc);
create index if not exists idx_cron_com_emp on public.cronograma_comentario_auria(empreendimento_id, criado_em desc);

alter table public.cronograma_comentario_auria enable row level security;

drop policy if exists croncom_sel on public.cronograma_comentario_auria;
create policy croncom_sel on public.cronograma_comentario_auria for select
  using (public.cde_pav_pode_ver(empreendimento_id));

drop policy if exists croncom_ins on public.cronograma_comentario_auria;
create policy croncom_ins on public.cronograma_comentario_auria for insert
  with check (public.estacao_edita(empreendimento_id) and autor_id = auth.uid());

drop policy if exists croncom_del on public.cronograma_comentario_auria;
create policy croncom_del on public.cronograma_comentario_auria for delete
  using (autor_id = auth.uid() or public.minha_role_auria() in ('gerente','super_admin'));

grant select, insert, delete on public.cronograma_comentario_auria to authenticated;
revoke all on public.cronograma_comentario_auria from anon;

-- Quantos comentários por tarefa (para o marcador na linha do cronograma) + os textos.
create or replace function public.cronograma_comentarios(p_emp uuid)
returns table(tarefa_id uuid, n int, ultimo text, ultimo_autor text, ultimo_em timestamptz)
language sql security definer stable set search_path = public as $$
  select c.tarefa_id, count(*)::int as n,
         (array_agg(c.texto order by c.criado_em desc))[1],
         (array_agg(coalesce(c.autor_nome,'') order by c.criado_em desc))[1],
         max(c.criado_em)
    from public.cronograma_comentario_auria c
   where c.empreendimento_id = p_emp and public.cde_pav_pode_ver(p_emp)
   group by c.tarefa_id;
$$;
grant execute on function public.cronograma_comentarios(uuid) to authenticated;

select 'cronograma_comentario_auria' as item,
       exists(select 1 from information_schema.tables where table_name='cronograma_comentario_auria') as ok
union all select 'cronograma_comentarios', exists(select 1 from pg_proc where proname='cronograma_comentarios');
