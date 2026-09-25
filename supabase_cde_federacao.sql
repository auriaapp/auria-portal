-- ============================================================================
--  Item 100 — FEDERAÇÃO salva no CDE (2026-09-24)
--  Rodar no SQL Editor do Supabase.
--
--  O coordenador escolhe os modelos, abre federado e SALVA a composição. Ela
--  vira um card na aba BIM (azul claro), e abrir esse card monta a cena com a
--  ÚLTIMA REVISÃO de cada componente — quem federa uma vez não precisa refazer
--  a seleção a cada revisão nova.
--
--  Guardamos os DOCUMENTOS (não os arquivos): o arquivo muda a cada revisão, o
--  documento é a identidade da prancha/modelo. A resolução para o .frag vigente
--  é feita na hora, por cde_federacao_abrir().
-- ============================================================================

create table if not exists public.cde_federacao_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  nome              text not null,
  documentos        uuid[] not null default '{}',     -- cde_documento_auria.id dos componentes
  observacao        text,
  criado_por        uuid,
  criado_por_nome   text,
  criado_em         timestamptz default now(),
  atualizado_em     timestamptz default now()
);
create index if not exists idx_cde_fed_emp on public.cde_federacao_auria(empreendimento_id);

alter table public.cde_federacao_auria enable row level security;

-- Ver: quem enxerga o empreendimento. Criar/editar/apagar: quem tem edição nele.
drop policy if exists cdefed_sel on public.cde_federacao_auria;
create policy cdefed_sel on public.cde_federacao_auria for select
  using (public.cde_pav_pode_ver(empreendimento_id));
drop policy if exists cdefed_w on public.cde_federacao_auria;
create policy cdefed_w on public.cde_federacao_auria for all
  using (public.estacao_edita(empreendimento_id))
  with check (public.estacao_edita(empreendimento_id));
grant select, insert, update, delete on public.cde_federacao_auria to authenticated;
revoke all on public.cde_federacao_auria from anon;

-- Lista para o card: nome, quantos componentes e quantos estão prontos hoje.
create or replace function public.cde_federacoes(p_emp uuid)
returns table(id uuid, nome text, observacao text, documentos uuid[],
              n_componentes int, n_prontos int, criado_por_nome text, atualizado_em timestamptz)
language sql security definer stable set search_path = public as $$
  select f.id, f.nome, f.observacao, f.documentos,
         coalesce(array_length(f.documentos,1),0),
         (select count(*)::int from unnest(f.documentos) d(doc)
           where exists (
             select 1 from public.cde_revisao_auria r
             join public.cde_arquivo_auria a on a.revisao_id = r.id
            where r.documento_id = d.doc and a.frag_status = 'pronto' and a.frag_path is not null)),
         f.criado_por_nome, f.atualizado_em
    from public.cde_federacao_auria f
   where f.empreendimento_id = p_emp and public.cde_pav_pode_ver(p_emp)
   order by f.nome;
$$;
grant execute on function public.cde_federacoes(uuid) to authenticated;

-- Abrir: resolve a REVISÃO VIGENTE de cada componente e devolve o que carregar.
-- Componente sem .frag pronto volta com pronto=false para a tela avisar por nome.
create or replace function public.cde_federacao_abrir(p_fed uuid)
returns table(documento_id uuid, codigo text, disciplina text, revisao text,
              frag_path text, storage_provider text, pronto boolean)
language sql security definer stable set search_path = public as $$
  with fed as (
    select f.* from public.cde_federacao_auria f
     where f.id = p_fed and public.cde_pav_pode_ver(f.empreendimento_id)
  ), comp as (
    select d.id as documento_id, d.codigo, d.disciplina,
           (select r.id from public.cde_revisao_auria r
             where r.documento_id = d.id order by r.recebido_em desc nulls last limit 1) as rev_id
      from fed, unnest(fed.documentos) x(doc)
      join public.cde_documento_auria d on d.id = x.doc
  )
  select c.documento_id, c.codigo, c.disciplina,
         (select r.revisao from public.cde_revisao_auria r where r.id = c.rev_id),
         a.frag_path, coalesce(a.storage_provider,'r2'),
         (a.frag_path is not null and a.frag_status = 'pronto')
    from comp c
    left join lateral (
      select a.frag_path, a.frag_status, a.storage_provider
        from public.cde_arquivo_auria a
       where a.revisao_id = c.rev_id and lower(coalesce(a.extensao,'')) = 'ifc'
       order by (a.frag_status = 'pronto') desc limit 1) a on true
   order by c.codigo;
$$;
grant execute on function public.cde_federacao_abrir(uuid) to authenticated;

select 'cde_federacao_auria' as item,
       exists(select 1 from information_schema.tables where table_name='cde_federacao_auria') as ok
union all select 'cde_federacoes', exists(select 1 from pg_proc where proname='cde_federacoes')
union all select 'cde_federacao_abrir', exists(select 1 from pg_proc where proname='cde_federacao_abrir');
