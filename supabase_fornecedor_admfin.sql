-- ============================================================================
--  Item 123 — responsável ADM-FIN do fornecedor (2026-09-24)
--  Rodar no SQL Editor do Supabase.
--
--  Quem cuida de contrato e nota fiscal no escritório normalmente não é o
--  projetista nem o RT. Ele entra como PESSOA do fornecedor (projetistas_auria,
--  onde o RT também mora) com a marca eh_adm_fin — reaproveitando convite,
--  login e o painel do projetista, que já tem contratos, parcelas e envio de NF.
--
--  No painel, quem é só adm-fin vê apenas a parte de FATURAMENTO: sem
--  apontamentos, sem entregas de prancha, sem cronograma.
-- ============================================================================

alter table public.projetistas_auria
  add column if not exists eh_adm_fin boolean not null default false;

comment on column public.projetistas_auria.eh_adm_fin is
  'Responsável administrativo/financeiro do fornecedor: painel só de faturamento (item 123)';

-- forn_meu passa a dizer QUEM é o usuário logado dentro do fornecedor.
drop function if exists public.forn_meu();
create function public.forn_meu()
returns table (id uuid, nome text, logo_url text, cnpj text, eh_adm_fin boolean, eh_rt boolean, pessoa_nome text)
language sql security definer stable set search_path to 'public' as $$
  select f.id, f.nome, f.logo_url, f.cnpj,
         coalesce(p.eh_adm_fin,false), coalesce(p.eh_rt,false), p.nome
    from public.fornecedores_auria f
    left join public.projetistas_auria p
           on p.fornecedor_id = f.id
          and lower(p.email) = lower(coalesce(auth.jwt()->>'email',''))
          and coalesce(p.ativo,true)
   where f.id = public.forn_do_projetista()
   limit 1;
$$;
grant execute on function public.forn_meu() to authenticated;
revoke execute on function public.forn_meu() from anon;

-- Atalho para as telas: o usuário logado é só administrativo do fornecedor?
create or replace function public.sou_adm_fin_fornecedor()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.projetistas_auria p
     where lower(p.email) = lower(coalesce(auth.jwt()->>'email',''))
       and coalesce(p.ativo,true) and coalesce(p.eh_adm_fin,false)
  );
$$;
grant execute on function public.sou_adm_fin_fornecedor() to authenticated;

select 'projetistas_auria.eh_adm_fin' as item,
       exists(select 1 from information_schema.columns where table_name='projetistas_auria' and column_name='eh_adm_fin') as ok
union all select 'forn_meu (adm-fin)', exists(select 1 from pg_proc where proname='forn_meu')
union all select 'sou_adm_fin_fornecedor', exists(select 1 from pg_proc where proname='sou_adm_fin_fornecedor');
