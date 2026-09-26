-- ============================================================================
--  DIAGNÓSTICO 2026-09-25 — itens 134 (chave duplicada), 137 (RT sumido)
--  e 131 (lentidão do Painel de Custos).
--
--  Rodar no SQL Editor do Supabase. É TUDO SELECT — não altera nada.
--  Rode um bloco de cada vez (ou tudo de uma vez e olhe as 5 saídas).
-- ============================================================================


-- ── 1) Item 134: por que o apontamento estourou a unicidade ────────────────
--  A tabela tem duas unicidades concorrentes. Esta consulta diz QUAL das duas
--  hipóteses é a verdadeira.
select 'linhas com empreendimento_id NULO' as caso, count(*)::text as valor
  from public.apontamentos where empreendimento_id is null
union all
select 'nomes de empreendimento repetidos em empreendimentos_auria',
       coalesce((select count(*)::text from (
         select nome from public.empreendimentos_auria
          where deleted_at is null group by nome having count(*) > 1) x), '0')
union all
select 'pares (nome, id) com mais de um empreendimento_id',
       coalesce((select count(*)::text from (
         select empreendimento, id from public.apontamentos
          group by empreendimento, id
         having count(distinct coalesce(empreendimento_id::text,'-')) > 1) y), '0');


-- ── 1b) Item 134: as linhas exatas que colidem (se houver) ─────────────────
--  Se a consulta acima acusou algo, esta mostra quais são.
select a.empreendimento, a.id,
       count(*)                                      as linhas,
       count(distinct coalesce(a.empreendimento_id::text,'(nulo)')) as ids_distintos,
       string_agg(distinct coalesce(a.empreendimento_id::text,'(nulo)'), ' | ') as quais
  from public.apontamentos a
 group by a.empreendimento, a.id
having count(*) > 1
    or count(distinct coalesce(a.empreendimento_id::text,'(nulo)')) > 1
 order by 1, 2
 limit 50;


-- ── 1c) Item 134: as duas unicidades que existem hoje na tabela ────────────
select con.conname as constraint_nome,
       pg_get_constraintdef(con.oid) as definicao
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
 where c.relname = 'apontamentos' and con.contype in ('u','p')
 order by con.conname;


-- ── 2) Item 137: o analista consegue LER projetistas_auria? ────────────────
--  Se não vier nenhuma policy de SELECT que valha para o analista, é essa a
--  causa do seletor "Responsável…" vazio.
select pol.polname as policy_nome,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                       when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as comando,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
 where c.relname = 'projetistas_auria'
 order by pol.polname;


-- ── 2b) Item 137: confirma que o RT está mesmo gravado ─────────────────────
select f.nome as fornecedor, p.nome as pessoa, p.email,
       p.eh_rt, p.eh_adm_fin, p.ativo, p.disciplinas
  from public.projetistas_auria p
  join public.fornecedores_auria f on f.id = p.fornecedor_id
 where f.nome ilike '%mexxa%'
 order by p.nome;


-- ── 3) Item 131: tamanho do problema e custo real da listagem ──────────────
--  O EXPLAIN mostra o tempo; o que interessa é comparar com a contagem.
select 'notas fiscais cadastradas' as item, count(*)::text as valor
  from public.notas_fiscais_auria
union all
select 'contratos cadastrados', count(*)::text from public.contratos_auria
union all
select 'parcelas cadastradas', count(*)::text from public.parcelas_auria;

explain (analyze, buffers, format text) select * from public.nf_listar();
