-- ============================================================================
--  Item 148 — disciplinas que existem DE FATO no empreendimento (2026-09-26)
--  Rodar no SQL Editor. Reaplicável. Só lê.
--
--  A matriz de acessos mostrava as ~88 disciplinas da convenção para cada
--  fornecedor, quando só um punhado tem documento naquele empreendimento. O
--  resto é palheiro que o coordenador precisa varrer a olho para achar a sigla.
--
--  Esta RPC devolve as que têm documento ali, para a tela separar o que importa
--  do que é só possibilidade da convenção.
-- ============================================================================

create or replace function public.cde_disc_com_doc(p_emp uuid)
returns text[]
language sql security definer stable set search_path = public
as $$
  select coalesce(array_agg(distinct d.disciplina), '{}'::text[])
    from public.cde_documento_auria d
   where d.empreendimento_id = p_emp
     and coalesce(d.disciplina,'') <> ''
     and coalesce(d.arquivado,false) = false
     and public.estacao_pode(p_emp);
$$;
grant execute on function public.cde_disc_com_doc(uuid) to authenticated;

select 'cde_disc_com_doc' as item,
       (to_regprocedure('public.cde_disc_com_doc(uuid)') is not null)::text as valor;
