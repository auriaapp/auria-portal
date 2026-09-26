-- ============================================================================
--  Item 144 (parte B) — ANTES de repontar as contas super_admin, medir o que
--  de fato depende de minha_empresa(). SÓ LÊ. Consulta única. (2026-09-26)
--
--  O MAPA JÁ MOSTROU: as duas contas super_admin (tiago-arq, tvmedeiros) estão
--  no "Grupo Diagonal" 2668ff51, que tem 0 construtoras, 0 empreendimentos e
--  nenhum outro usuário. O Grupo Diagonal de verdade é 23f3387f (3 construtoras,
--  2 empreendimentos, 7 pessoas).
--
--  MAS repontar só é a correção certa se existir código que filtra por
--  minha_empresa() SEM a saída de super_admin. Onde a saída existe, o grupo da
--  conta é irrelevante e mexer nela só adicionaria risco.
--
--  Esta consulta lista toda função de public que usa minha_empresa() e diz se
--  ela também trata 'super_admin'. É leitura de catálogo — honesta como serviço.
--
--  ATENÇÃO ao ler: "SEM saida super_admin" é um INDÍCIO, não um veredito. A
--  função pode escapar por outro caminho. Serve para eu saber onde olhar.
-- ============================================================================

select case when p.prosrc like '%super_admin%' then 'B. tem saida de super_admin'
            else                                    'A. SEM saida de super_admin' end as grupo,
       p.proname                                                                       as funcao,
       case when p.prosecdef then 'security definer' else 'invoker' end                as tipo,
       (length(p.prosrc)-length(replace(p.prosrc,'minha_empresa()','')))
         / length('minha_empresa()')                                                   as usa_minha_empresa,
       coalesce(array_to_string(p.proconfig,', '),'(SEM search_path)')                 as search_path
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosrc like '%minha_empresa()%'
   and p.proname not like 'auria_diag%'
 order by 1, 2;
