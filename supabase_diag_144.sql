-- ============================================================================
--  Item 144 — duplicatas de empresa e de empreendimento. SÓ LÊ. (2026-09-26)
--
--  UMA CONSULTA SÓ, de propósito: o SQL Editor do Supabase exibe apenas o
--  resultado do ÚLTIMO comando do script. Diagnóstico em vários SELECTs perde
--  tudo o que vem acima — foi o que aconteceu nas rodadas anteriores.
--
--  POR QUE IMPORTA: as contas super_admin estão amarradas a um "Grupo Diagonal"
--  VAZIO. Toda regra que filtra por empresa_id se comporta de forma imprevisível
--  para elas — e foi a colisão de NOME entre quatro "Diagonal by Pininfarina"
--  que causou o incidente 139 (e-mail para a equipe errada).
--
--  Nada aqui apaga nem altera nada. Repontar conta de super_admin é irreversível
--  na prática (depois não dá para saber qual era o valor errado original), então
--  quero o mapa inteiro antes de propor qualquer update.
--
--  Honesto como serviço: lê as tabelas direto, sem minha_empresa() nem
--  minha_role_auria(), que são nulos no SQL Editor.
-- ============================================================================

with grupos as (
  select g.id, g.nome,
         (select count(*) from public.construtoras_auria ct where ct.grupo_id = g.id) as constr,
         (select count(*) from public.empreendimentos_auria e
           where e.empresa_id = g.id and e.deleted_at is null)                        as ativos,
         (select count(*) from public.empreendimentos_auria e
           where e.empresa_id = g.id and e.deleted_at is not null)                    as arquiv,
         (select count(*) from public.usuarios_auria u where u.empresa_id = g.id)     as usus,
         (select string_agg(u.role || ':' || split_part(coalesce(u.email,'?'),'@',1), ', ' order by u.role)
            from public.usuarios_auria u where u.empresa_id = g.id)                   as quem
    from public.empresas_auria g
),
emp_dup as (
  select lower(trim(e.nome)) as chave, count(*) as n
    from public.empreendimentos_auria e group by 1 having count(*) > 1
),
grp_dup as (
  select lower(trim(nome)) as chave, count(*) as n
    from public.empresas_auria group by 1 having count(*) > 1
)
select * from (

  select '1 GRUPOS' as secao,
         g.nome                                                      as item,
         g.id::text                                                  as id,
         'constr=' || g.constr || '  ativos=' || g.ativos ||
         '  arquiv=' || g.arquiv || '  usuarios=' || g.usus          as numeros,
         coalesce(g.quem,'(ninguem dentro)')                         as detalhe,
         1 as ord, g.ativos as ord2, g.nome as ord3
    from grupos g

  union all
  select '2 GRUPO NOME REPETIDO', g.nome, g.id::text,
         'este nome aparece ' || d.n || 'x',
         'ativos=' || g.ativos || ' usuarios=' || g.usus,
         2, 0, g.nome
    from grupos g join grp_dup d on d.chave = lower(trim(g.nome))

  union all
  select '3 EMPREEND NOME REPETIDO', e.nome, e.id::text,
         case when e.deleted_at is null then '>>> ATIVO <<<'
              else 'arquivado ' || to_char(e.deleted_at,'DD/MM/YY') end,
         'grupo: ' || coalesce(g.nome,'(sem grupo)'),
         3, 0, e.nome || coalesce(to_char(e.deleted_at,'YYYYMMDD'),'0')
    from public.empreendimentos_auria e
    join emp_dup d on d.chave = lower(trim(e.nome))
    left join public.empresas_auria g on g.id = e.empresa_id

  union all
  select '4 SUPER_ADMIN / GERENTE', u.role || ' - ' || coalesce(u.email,'?'),
         coalesce(u.empresa_id::text,'(SEM empresa_id)'),
         case when u.empresa_id is null then 'SEM GRUPO'
              else 'grupo: ' || coalesce(g.nome,'(GRUPO INEXISTENTE)') end,
         'empreend ativos nesse grupo: ' ||
           coalesce((select count(*)::text from public.empreendimentos_auria e
                      where e.empresa_id = u.empresa_id and e.deleted_at is null),'-'),
         4, 0, u.role || coalesce(u.email,'')
    from public.usuarios_auria u
    left join public.empresas_auria g on g.id = u.empresa_id
   where u.role in ('super_admin','gerente')

) z
order by ord, ord2 desc, ord3;
