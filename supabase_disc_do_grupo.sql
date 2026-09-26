-- ============================================================================
--  Item 155 — a lista de disciplinas vem da CONVENÇÃO, não de uma lista fixa
--  (2026-09-26). Rodar no SQL Editor. Só lê; reaplicável.
--
--  O PROBLEMA: o cadastro de fornecedor oferecia "Arquitetura, Estrutura
--  Concreto, Estrutura Metálica, Instalações Hidrossanitárias…" — uma lista
--  CHUMBADA no código (DISC_OPTS, em painel_analista.html), de antes de existir
--  o menu Disciplinas. Quem cadastra a convenção da construtora não via as
--  próprias disciplinas ali, e as grafias divergiam das do CDE.
--
--  A fonte certa é cde_convencao_auria: o campo cujo `mapeia` é 'disciplina'
--  guarda o domínio {v: código, rotulo: nome}. É o mesmo lugar que o menu
--  Disciplinas edita e que o CDE usa para validar o nome do arquivo.
-- ============================================================================

create or replace function public.disc_do_grupo()
returns table(codigo text, nome text)
language sql security definer stable set search_path = public
as $$
  select codigo, min(nome) as nome
    from (
      select upper(trim(coalesce(d->>'v', d#>>'{}'))) as codigo,
             nullif(trim(coalesce(d->>'rotulo', d->>'nome', d->>'v', d#>>'{}')),'') as nome
        from public.cde_convencao_auria c
        cross join lateral jsonb_array_elements(coalesce(c.campos,'[]'::jsonb)) f
        cross join lateral jsonb_array_elements(coalesce(f->'dominio','[]'::jsonb)) d
       where f->>'mapeia' = 'disciplina'
         and ( c.grupo_id = public.minha_empresa()
               or c.construtora_id in (select ct.id from public.construtoras_auria ct
                                        where ct.grupo_id = public.minha_empresa())
               or public.minha_role_auria() = 'super_admin' )
    ) s
   where coalesce(codigo,'') <> ''
   group by codigo
   order by 2, 1;
$$;
grant execute on function public.disc_do_grupo() to authenticated;

comment on function public.disc_do_grupo() is
  'Disciplinas da convenção do grupo (item 155). Substitui a lista fixa DISC_OPTS do painel do analista.';

select 'disc_do_grupo existe' as item,
       (to_regprocedure('public.disc_do_grupo()') is not null)::text as valor
union all
select 'quantas disciplinas ela devolve',
       coalesce((select count(*)::text from public.disc_do_grupo()), '0')
union all
select 'amostra',
       coalesce((select string_agg(codigo||' — '||coalesce(nome,codigo), ' · ')
                   from (select codigo, nome from public.disc_do_grupo() limit 8) x), '(vazio)');
