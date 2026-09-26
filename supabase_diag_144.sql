-- ============================================================================
--  Item 144 — duplicatas de empresa e de empreendimento. SÓ LÊ. (2026-09-26)
--
--  POR QUE IMPORTA: as duas contas super_admin estão amarradas a um "Grupo
--  Diagonal" VAZIO. Toda regra que filtra por empresa_id se comporta de forma
--  imprevisível para elas — e foi a colisão de NOME entre quatro "Diagonal by
--  Pininfarina" que causou o incidente 139 (e-mail para a equipe errada).
--
--  Nada aqui apaga nada. Eu preciso ver o mapa completo antes de propor
--  qualquer movimento, porque repontar conta de super_admin é irreversível na
--  prática (não dá para saber depois qual era o valor "errado" original).
--
--  Honesto como serviço: lê as tabelas direto, sem passar por minha_empresa()
--  ou minha_role_auria() — que são nulos no SQL Editor.
-- ============================================================================

-- ── 1. Os grupos, e o que cada um realmente tem pendurado ──────────────────
select g.id,
       g.nome,
       g.criado_em,
       (select count(*) from public.construtoras_auria  ct where ct.grupo_id   = g.id) as construtoras,
       (select count(*) from public.empreendimentos_auria e
         where e.empresa_id = g.id and e.deleted_at is null)                           as empreend_ativos,
       (select count(*) from public.empreendimentos_auria e
         where e.empresa_id = g.id and e.deleted_at is not null)                       as empreend_arquivados,
       (select count(*) from public.usuarios_auria u where u.empresa_id = g.id)        as usuarios,
       (select string_agg(u.role || ':' || coalesce(u.email,'?'), ' | ' order by u.role)
          from public.usuarios_auria u where u.empresa_id = g.id)                      as quem_esta_dentro
  from public.empresas_auria g
 order by 5 desc, 2;


-- ── 2. Grupos com NOME repetido (é isso que confunde busca e relatório) ────
select lower(trim(nome)) as nome_normalizado,
       count(*)          as quantos,
       string_agg(id::text, ' | ' order by criado_em)   as ids,
       string_agg(nome,    ' | ' order by criado_em)    as grafias
  from public.empresas_auria
 group by 1
having count(*) > 1
 order by 2 desc;


-- ── 3. Empreendimentos com NOME repetido — a causa do incidente 139 ───────
select lower(trim(e.nome)) as nome_normalizado,
       count(*)            as quantos,
       count(*) filter (where e.deleted_at is null)     as ativos,
       count(*) filter (where e.deleted_at is not null) as arquivados,
       string_agg(coalesce(g.nome,'(sem grupo)') || ' -> ' || e.id::text ||
                  case when e.deleted_at is null then '  [ATIVO]'
                       else '  [arquivado ' || to_char(e.deleted_at,'DD/MM/YY') || ']' end,
                  E'\n' order by e.deleted_at nulls first) as onde_estao
  from public.empreendimentos_auria e
  left join public.empresas_auria g on g.id = e.empresa_id
 group by 1
having count(*) > 1
 order by 2 desc;


-- ── 4. As contas de super_admin e gerente: para onde apontam hoje ─────────
select u.role,
       u.email,
       u.empresa_id,
       coalesce(g.nome,'(GRUPO INEXISTENTE)')                                    as grupo_atual,
       (select count(*) from public.empreendimentos_auria e
         where e.empresa_id = u.empresa_id and e.deleted_at is null)             as empreend_no_grupo_atual,
       u.ultimo_acesso
  from public.usuarios_auria u
  left join public.empresas_auria g on g.id = u.empresa_id
 where u.role in ('super_admin','gerente')
 order by u.role, u.email;


-- ── 5. O que ficaria órfão se um grupo fosse mexido ───────────────────────
--  (linhas que apontam para grupo que não existe mais — se houver, é bug
--   antigo, não consequência de nada que faremos)
select 'usuarios_auria'        as tabela, count(*) as apontam_para_grupo_inexistente
  from public.usuarios_auria u
 where u.empresa_id is not null
   and not exists (select 1 from public.empresas_auria g where g.id = u.empresa_id)
union all
select 'empreendimentos_auria', count(*)
  from public.empreendimentos_auria e
 where e.empresa_id is not null
   and not exists (select 1 from public.empresas_auria g where g.id = e.empresa_id)
union all
select 'construtoras_auria', count(*)
  from public.construtoras_auria ct
 where ct.grupo_id is not null
   and not exists (select 1 from public.empresas_auria g where g.id = ct.grupo_id);
