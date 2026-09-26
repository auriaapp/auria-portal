-- ============================================================================
--  Item 155 — onde estão as disciplinas da convenção (2026-09-26). Só lê.
--
--  A conferência anterior devolveu 0, mas pode ser culpa dela: no SQL Editor
--  você roda como SERVIÇO, então minha_empresa() é nulo e o filtro da RPC
--  derruba tudo — mesmo que o dado esteja lá. (Mesma armadilha do EXPLAIN do
--  nf_listar.)
--
--  Esta consulta olha o dado CRU: quantas convenções existem, de quem são, e
--  o que cada uma guarda no campo de disciplina.
-- ============================================================================

-- 1) As convenções e o campo de disciplina de cada uma
select coalesce(g.nome, '(sem grupo)')                       as grupo,
       coalesce(ct.nome, '(sem construtora)')                as construtora,
       coalesce(c.nome, '(sem nome)')                        as convencao,
       jsonb_array_length(coalesce(c.campos,'[]'::jsonb))    as qtd_campos,
       coalesce((select count(*) from jsonb_array_elements(c.campos) f
                  where f->>'mapeia' = 'disciplina'), 0)     as campos_de_disciplina,
       coalesce((select jsonb_array_length(coalesce(f->'dominio','[]'::jsonb))
                   from jsonb_array_elements(c.campos) f
                  where f->>'mapeia' = 'disciplina' limit 1), 0) as itens_no_dominio
  from public.cde_convencao_auria c
  left join public.empresas_auria     g  on g.id  = c.grupo_id
  left join public.construtoras_auria ct on ct.id = c.construtora_id
 order by 1, 2;


-- 2) Como o campo de disciplina está escrito (os nomes das chaves importam:
--    a RPC procura 'mapeia' e 'dominio'; se a convenção usar outro nome, é por
--    isso que vem vazio)
select coalesce(c.nome,'(sem nome)') as convencao,
       f->>'rotulo'                  as campo_rotulo,
       f->>'mapeia'                  as mapeia,
       left(f::text, 300)            as json_do_campo
  from public.cde_convencao_auria c
  cross join lateral jsonb_array_elements(coalesce(c.campos,'[]'::jsonb)) f
 where f::text ilike '%discipl%'
 limit 10;


-- 3) O domínio propriamente dito, item a item
select coalesce(c.nome,'(sem nome)') as convencao,
       d#>>'{}'                      as item_cru,
       d->>'v'                       as chave_v,
       d->>'rotulo'                  as chave_rotulo
  from public.cde_convencao_auria c
  cross join lateral jsonb_array_elements(coalesce(c.campos,'[]'::jsonb)) f
  cross join lateral jsonb_array_elements(coalesce(f->'dominio','[]'::jsonb)) d
 where f->>'mapeia' = 'disciplina'
 limit 20;
