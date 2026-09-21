-- ============================================================================
--  ITEM 74 — Uso de dados e gasto (painel do CEO). Só super_admin.
--  ceo_uso(): bytes por bucket/provedor e por empreendimento → empresa → grupo,
--  contagens (documentos, revisões, arquivos, apontamentos, usuários), tamanho
--  do banco, cotas e preços (tabela ceo_cotas_auria, editável no painel).
--  Fontes: storage.objects (metadata->>'size') para os buckets do Supabase;
--  cde_arquivo_auria.tamanho_bytes para o R2 + frag_bytes dos modelos 3D convertidos
--  (74b; ver supabase_ceo_uso_frag.sql). Reaplicável.
-- ============================================================================
create table if not exists public.ceo_cotas_auria (
  id                  int primary key default 1 check (id = 1),
  storage_supabase_gb numeric not null default 100,    -- plano Pro: 100 GB incluídos
  r2_gb               numeric not null default 10,     -- R2: 10 GB grátis/mês
  db_gb               numeric not null default 8,      -- plano Pro: 8 GB de banco
  preco_gb_supabase   numeric not null default 0.021,  -- USD/GB-mês acima da cota
  preco_gb_r2         numeric not null default 0.015,  -- USD/GB-mês acima da cota
  cambio              numeric not null default 5.50,   -- R$ por USD (para a estimativa)
  atualizado_em       timestamptz default now()
);
insert into public.ceo_cotas_auria (id) values (1) on conflict (id) do nothing;
alter table public.ceo_cotas_auria enable row level security;
drop policy if exists ceo_cotas_sa on public.ceo_cotas_auria;
create policy ceo_cotas_sa on public.ceo_cotas_auria for all
  using (public.minha_role_auria() = 'super_admin') with check (public.minha_role_auria() = 'super_admin');
grant select, update on public.ceo_cotas_auria to authenticated;

create or replace function public.ceo_uso()
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare v jsonb; v_emps jsonb; v_buckets jsonb; v_db jsonb; v_cotas jsonb; v_tot jsonb;
begin
  if public.minha_role_auria() <> 'super_admin' then raise exception 'Só o administrador do Auria.'; end if;

  -- bytes por objeto, já atribuídos a um empreendimento/grupo quando o caminho permite
  create temp table if not exists _uso_obj on commit drop as
  select o.bucket_id, o.name, coalesce((o.metadata->>'size')::bigint, 0) as bytes,
         split_part(o.name,'/',1) as s1, split_part(o.name,'/',2) as s2
    from storage.objects o
   where o.bucket_id in ('cde','notas-fiscais','apontamentos','logos','cotacoes');

  with emp as (
    select e.id, e.nome, e.codigo, e.construtora_id, e.empresa_id as grupo_id, e.deleted_at
      from public.empreendimentos_auria e
  ),
  cde as (   -- bucket cde: <emp>/<codigo>/<rev>/<arquivo>
    select s1::uuid as emp_id, sum(bytes) as bytes, count(*) as n
      from _uso_obj where bucket_id = 'cde' and s1 ~ '^[0-9a-f-]{36}$' group by s1
  ),
  r2 as (    -- modelos pesados no R2 (tamanho gravado na linha do arquivo)
    select d.empreendimento_id as emp_id,
           sum(case when a.storage_provider = 'r2' then coalesce(a.tamanho_bytes,0) else 0 end) + sum(coalesce(a.frag_bytes,0)) as bytes,   -- 74b: + .frag convertidos
           count(*) filter (where a.storage_provider = 'r2') + count(*) filter (where a.frag_bytes > 0) as n
      from public.cde_arquivo_auria a
      join public.cde_revisao_auria r on r.id = a.revisao_id
      join public.cde_documento_auria d on d.id = r.documento_id
     where a.storage_provider = 'r2' or a.frag_bytes > 0 group by d.empreendimento_id
  ),
  nf as (    -- notas fiscais: casa pelo caminho gravado
    select n.empreendimento_id as emp_id, sum(u.bytes) as bytes, count(*) as n
      from _uso_obj u join public.notas_fiscais_auria n on n.pdf_path = u.name
     where u.bucket_id = 'notas-fiscais' group by n.empreendimento_id
  ),
  rdo as (   -- fotos do diário: rdo/<emp>/...
    select s2::uuid as emp_id, sum(bytes) as bytes, count(*) as n
      from _uso_obj where bucket_id = 'apontamentos' and s1 = 'rdo' and s2 ~ '^[0-9a-f-]{36}$' group by s2
  ),
  logo as (  -- logos: empreendimentos/<emp>/...
    select s2::uuid as emp_id, sum(bytes) as bytes, count(*) as n
      from _uso_obj where bucket_id = 'logos' and s1 = 'empreendimentos' and s2 ~ '^[0-9a-f-]{36}$' group by s2
  ),
  cot as (   -- cotações/propostas/MDE: <emp>/<cotacao>/...
    select s1::uuid as emp_id, sum(bytes) as bytes, count(*) as n
      from _uso_obj where bucket_id = 'cotacoes' and s1 ~ '^[0-9a-f-]{36}$' group by s1
  ),
  docs as (
    select d.empreendimento_id as emp_id, count(distinct d.id) as docs, count(distinct r.id) as revs, count(a.id) as arqs
      from public.cde_documento_auria d
      left join public.cde_revisao_auria r on r.documento_id = d.id
      left join public.cde_arquivo_auria a on a.revisao_id = r.id
     group by d.empreendimento_id
  ),
  apts as ( select empreendimento_id as emp_id, count(*) as apts from public.apontamentos group by empreendimento_id )
  select coalesce(jsonb_agg(jsonb_build_object(
           'emp_id', emp.id, 'emp', emp.nome, 'sigla', emp.codigo, 'arquivado', emp.deleted_at is not null,
           'construtora_id', emp.construtora_id, 'construtora', c.nome,
           'grupo_id', emp.grupo_id, 'grupo', g.nome,
           'cde_bytes', coalesce(cde.bytes,0), 'cde_n', coalesce(cde.n,0),
           'r2_bytes', coalesce(r2.bytes,0), 'r2_n', coalesce(r2.n,0),
           'nf_bytes', coalesce(nf.bytes,0), 'nf_n', coalesce(nf.n,0),
           'rdo_bytes', coalesce(rdo.bytes,0), 'logo_bytes', coalesce(logo.bytes,0), 'cot_bytes', coalesce(cot.bytes,0),
           'docs', coalesce(docs.docs,0), 'revs', coalesce(docs.revs,0), 'arqs', coalesce(docs.arqs,0), 'apts', coalesce(apts.apts,0)
         ) order by g.nome, c.nome, emp.nome), '[]'::jsonb)
    into v_emps
    from emp
    left join public.construtoras_auria c on c.id = emp.construtora_id
    left join public.empresas_auria g on g.id = emp.grupo_id
    left join cde on cde.emp_id = emp.id left join r2 on r2.emp_id = emp.id left join nf on nf.emp_id = emp.id
    left join rdo on rdo.emp_id = emp.id left join logo on logo.emp_id = emp.id left join cot on cot.emp_id = emp.id
    left join docs on docs.emp_id = emp.id left join apts on apts.emp_id = emp.id;

  -- totais por bucket (inclui o que não se atribui a empreendimento: prints por usuário, logos de grupo/empresa)
  select coalesce(jsonb_object_agg(bucket_id, jsonb_build_object('bytes', bytes, 'n', n)), '{}'::jsonb) into v_buckets
    from (select bucket_id, sum(bytes) as bytes, count(*) as n from _uso_obj group by bucket_id) b;

  -- prints de apontamentos por GRUPO (caminho começa pelo usuário)
  with pr as (
    select u.empresa_id as grupo_id, sum(o.bytes) as bytes, count(*) as n
      from _uso_obj o join public.usuarios_auria u on u.id::text = o.s1
     where o.bucket_id = 'apontamentos' and o.s1 <> 'rdo' group by u.empresa_id )
  select coalesce(jsonb_agg(jsonb_build_object('grupo_id', grupo_id, 'bytes', bytes, 'n', n)), '[]'::jsonb) into v
    from pr;

  -- banco
  select jsonb_build_object(
           'total_bytes', pg_database_size(current_database()),
           'tabelas', (select coalesce(jsonb_agg(jsonb_build_object('nome', t.relname, 'bytes', t.bytes) order by t.bytes desc), '[]'::jsonb)
                         from (select c.relname, pg_total_relation_size(c.oid) as bytes
                                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                where n.nspname = 'public' and c.relkind = 'r' and pg_total_relation_size(c.oid) > 0
                                order by 2 desc limit 25) t))
    into v_db;

  select to_jsonb(k) into v_cotas from public.ceo_cotas_auria k where k.id = 1;

  select jsonb_build_object(
           'r2_bytes', coalesce((select sum(case when storage_provider = 'r2' then coalesce(tamanho_bytes,0) else 0 end) + sum(coalesce(frag_bytes,0)) from public.cde_arquivo_auria),0),
           'frag_bytes', coalesce((select sum(coalesce(frag_bytes,0)) from public.cde_arquivo_auria),0),
           'frag_sem_tamanho', (select count(*) from public.cde_arquivo_auria where frag_status = 'pronto' and frag_path is not null and frag_bytes is null),
           'usuarios', (select count(*) from public.usuarios_auria),
           'grupos', (select count(*) from public.empresas_auria),
           'empresas', (select count(*) from public.construtoras_auria),
           'empreendimentos', (select count(*) from public.empreendimentos_auria where deleted_at is null),
           'documentos', (select count(*) from public.cde_documento_auria),
           'apontamentos', (select count(*) from public.apontamentos))
    into v_tot;

  return jsonb_build_object('emps', v_emps, 'buckets', v_buckets, 'prints_por_grupo', v, 'db', v_db, 'cotas', v_cotas, 'totais', v_tot, 'gerado_em', now());
end $$;
grant execute on function public.ceo_uso() to authenticated;
revoke execute on function public.ceo_uso() from anon;

select 'ceo_uso' as fn, exists(select 1 from pg_proc where proname='ceo_uso') as ok, (select count(*) from public.ceo_cotas_auria) as cotas;
