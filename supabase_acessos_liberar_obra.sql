-- ============================================================================
--  Item 147 (parte 2) — a matriz passa a devolver o modo de liberação p/ obra
--  Rodar DEPOIS de supabase_liberar_obra.sql. Reaplicável.
--
--  cde_acessos_do_emp é a RPC que monta a tela de Acessos do analista. Sem a
--  coluna liberar_obra aqui, o seletor novo da matriz nasceria sempre em "não",
--  apagando a escolha a cada recarga — o tipo de meia-aplicação que já nos
--  custou caro esta semana.
-- ============================================================================

drop function if exists public.cde_acessos_do_emp(uuid);
create or replace function public.cde_acessos_do_emp(p_emp uuid)
returns table(
  acesso_id            uuid,
  tipo                 text,
  sujeito_id           uuid,
  nome                 text,
  email                text,
  bloqueado            boolean,
  disc_contratadas     text[],
  disciplinas          text[],
  todas_disciplinas    boolean,
  ver_nao_publicado    boolean,
  download             boolean,
  upload               boolean,
  excluir_s0           boolean,
  ler_apont            boolean,
  abrir_apont          boolean,
  editar_apont_proprio boolean,
  bim_ver              boolean,
  bim_ler_apont        boolean,
  bim_abrir_apont      boolean,
  disciplinas_upload   text[],
  liberar_obra         text
)
language sql security definer stable
set search_path to 'public'
as $$
  select null::uuid, 'coordenacao', u.id, u.nome, u.email,
         true,
         null::text[], '{}'::text[], true,
         true, true, true, true, true, true, true, true, true, true, '{}'::text[], 'nao'
    from public.analista_empreendimento_auria ae
    join public.usuarios_auria u on u.id = ae.analista_id
   where ae.empreendimento_id = p_emp and coalesce(ae.ativo, true)
     and public.estacao_pode(p_emp)
  union all
  select a.id, 'interno', u.id, u.nome, u.email,
         false,
         null::text[],
         a.disciplinas, a.todas_disciplinas, a.ver_nao_publicado, a.download, a.upload,
         a.excluir_s0, a.ler_apont, a.abrir_apont, a.editar_apont_proprio,
         a.bim_ver, a.bim_ler_apont, a.bim_abrir_apont, coalesce(a.disciplinas_upload,'{}'::text[]),
         coalesce(a.liberar_obra,'nao')
    from public.cde_acesso_auria a
    join public.usuarios_auria u on u.id = a.usuario_id
   where a.empreendimento_id = p_emp and public.estacao_pode(p_emp)
  union all
  select a.id, 'fornecedor', f.id, f.nome, f.email_contato,
         false,
         coalesce((select array_agg(distinct df2.disciplina)
                     from public.disciplina_fornecedor_auria df2
                    where df2.empreendimento_id = p_emp and df2.fornecedor_id = f.id), '{}'::text[]),
         coalesce(a.disciplinas, '{}'::text[]), coalesce(a.todas_disciplinas, false),
         coalesce(a.ver_nao_publicado, false), coalesce(a.download, true), coalesce(a.upload, false),
         coalesce(a.excluir_s0, false), coalesce(a.ler_apont, false), coalesce(a.abrir_apont, false),
         coalesce(a.editar_apont_proprio, false),
         coalesce(a.bim_ver, false), coalesce(a.bim_ler_apont, false), coalesce(a.bim_abrir_apont, false),
         coalesce(a.disciplinas_upload, '{}'::text[]),
         coalesce(a.liberar_obra, 'nao')
    from (select distinct empreendimento_id, fornecedor_id
            from public.disciplina_fornecedor_auria where empreendimento_id = p_emp) df
    join public.fornecedores_auria f on f.id = df.fornecedor_id
    left join public.cde_acesso_auria a
           on a.empreendimento_id = p_emp and a.fornecedor_id = f.id
   where public.estacao_pode(p_emp)
  order by 6 desc, 2, 4;
$$;
grant execute on function public.cde_acessos_do_emp(uuid) to authenticated;

select 'cde_acessos_do_emp devolve liberar_obra' as item,
       exists(select 1 from pg_proc p
               where p.proname='cde_acessos_do_emp'
                 and pg_get_function_result(p.oid) like '%liberar_obra%')::text as valor;
