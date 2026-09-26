-- ============================================================================
--  AUDITORIA DA CLASSE INTEIRA — todas as funções SECURITY DEFINER (2026-09-26)
--  SÓ LÊ. Consulta única. Item 160.
--
--  POR QUE EXISTE: os defeitos de segurança que apareceram esta semana (papel
--  nulo passando pela porta no nf_bi, search_path solto no fin_contratos e no
--  nf_bi) foram todos encontrados POR ACASO, enquanto eu mexia em outra coisa.
--  Foram escritos aqui, um de cada vez, em sessões diferentes — cada um com um
--  guarda um pouco diferente do anterior, e nada nunca olhou a classe toda.
--  Achar por acidente não é método. Esta consulta olha todas de uma vez.
--
--  O QUE ELA TESTA — propriedades, não palavras:
--    A. search_path travado?      (sem ele: escalada de privilégio)
--    B. tem guarda de papel?      (definer sem guarda roda como dono)
--    C. a guarda sobrevive a papel NULO?
--         `NULL not in (...)` é NULL, e `if NULL then` é FALSO — a exceção
--         nunca é levantada para quem está autenticado sem linha em
--         usuarios_auria. Foi exatamente o furo do nf_bi.
--         Só conta como fechado quem usa coalesce(...) no teste.
--    D. quem pode executar (authenticated? anon?)
--    E. sobrecargas: mesmo nome com assinaturas diferentes
--
--  COMO LER: a coluna `risco` ordena do pior para o melhor. Ela é um INDÍCIO,
--  não um veredito — uma função pode ser segura por outro caminho. Serve para
--  dizer ONDE OLHAR, e nenhuma linha daqui vira correção sem eu ler o corpo.
--  (Aprendi isso hoje dando dois alarmes falsos por testar palavra.)
-- ============================================================================

with f as (
  select p.oid,
         p.proname,
         p.oid::regprocedure::text                                as assinatura,
         p.prosrc                                                 as src,
         (p.proconfig is not null
          and array_to_string(p.proconfig,',') like '%search_path%') as tem_sp,
         -- guarda de papel: chama minha_role_auria() e levanta exceção
         (p.prosrc like '%minha_role_auria()%' and p.prosrc ilike '%raise exception%') as tem_guarda,
         -- guarda que sobrevive a NULL: o teste passa por coalesce
         (p.prosrc ilike '%coalesce(%role%' or p.prosrc ilike '%coalesce(minha_role_auria()%') as guarda_null_ok,
         (p.prosrc like '%minha_role_auria()%')                   as usa_papel,
         has_function_privilege('anon',          p.oid, 'execute') as anon_pode,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_pode,
         count(*) over (partition by p.proname)                   as sobrecargas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef                       -- só SECURITY DEFINER
     and p.proname not like 'auria_diag%'  -- não contar as minhas sondas
)
select case
         when usa_papel and tem_guarda and not guarda_null_ok then '1 CRITICO - guarda cai com papel NULO'
         when not tem_sp                                      then '2 ALTO - sem search_path travado'
         when anon_pode                                       then '3 REVER - anon pode executar'
         when usa_papel and not tem_guarda                    then '4 REVER - usa papel mas nao levanta excecao'
         else                                                      '5 ok pelos testes daqui'
       end                                                     as risco,
       assinatura,
       case when tem_sp then 'sim' else 'NAO' end              as search_path,
       case when not usa_papel then '-'
            when not tem_guarda then 'so filtra'
            when guarda_null_ok then 'sim, com coalesce'
            else 'sim, SEM coalesce' end                       as guarda_papel,
       case when anon_pode then 'anon+auth' when auth_pode then 'authenticated' else 'ninguem' end as quem_executa,
       case when sobrecargas > 1 then sobrecargas::text || ' assinaturas' else '' end as sobrecarga
  from f
 order by 1, 2;
