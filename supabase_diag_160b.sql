-- ============================================================================
--  Item 160 — a pergunta que decide entre a correção de UMA LINHA e a de 15.
--  SÓ LÊ. Consulta única. (2026-09-26)
--
--  O PLANO ERA: fazer minha_role_auria() devolver '' em vez de NULL, e com
--  isso as 15 guardas quebradas passariam a levantar exceção sem eu reescrever
--  nenhuma delas. As três formas encontradas (<>, not in, not(... or ...))
--  todas fecham com ''.
--
--  O QUE ME FEZ PARAR: em GUARDA DE FUNÇÃO, `not in` com NULL hoje PERMITE, e
--  '' faz NEGAR — é o conserto. Em POLICY DE RLS é o contrário: um
--  `using (minha_role_auria() <> 'setor')` hoje com NULL NEGA (NULL é falsy),
--  e com '' viraria TRUE, ou seja PERMITIRIA. A mesma linha que conserta a
--  função abriria a policy.
--
--  Então a pergunta é só uma: existe policy (ou filtro dentro de função) que
--  use minha_role_auria() em TESTE NEGATIVO? Se existir, a correção de uma
--  linha está descartada e eu vou nas 15, uma a uma, com coalesce.
--
--  Também olho o mesmo padrão dentro dos corpos de função, em posição de
--  FILTRO (não de guarda) — lá o risco é idêntico: a linha hoje derruba a
--  linha do resultado, e com '' passaria a deixar passar.
-- ============================================================================

select * from (

  -- ── policies ────────────────────────────────────────────────────────────
  select '1. POLICIES com minha_role_auria'                       as secao,
         c.relname || ' / ' || pol.polname                        as item,
         case when coalesce(pg_get_expr(pol.polqual,      pol.polrelid),'') ~* 'minha_role_auria\(\)\s*(<>|!=)'
                or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),'') ~* 'minha_role_auria\(\)\s*(<>|!=)'
                or coalesce(pg_get_expr(pol.polqual,      pol.polrelid),'') ~* 'not\s+\(?\s*\(?minha_role_auria'
                or coalesce(pg_get_expr(pol.polqual,      pol.polrelid),'') ~* 'minha_role_auria\(\)\s*<>\s*ALL'
              then '>>> TESTE NEGATIVO - com '''' passaria a PERMITIR <<<'
              else 'teste positivo - equivalente, seguro' end      as veredito,
         left(coalesce(pg_get_expr(pol.polqual, pol.polrelid),
                       pg_get_expr(pol.polwithcheck, pol.polrelid),''), 220) as expressao
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and (coalesce(pg_get_expr(pol.polqual,      pol.polrelid),'') like '%minha_role_auria%'
       or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),'') like '%minha_role_auria%')

  union all
  -- ── o mesmo padrão dentro de função, mas em posição de FILTRO ──────────
  --  Heurística: usa <> ou "not in" com o papel E NÃO levanta exceção logo
  --  depois. Indício de onde olhar, não veredito — hoje eu já errei dois
  --  alarmes por tratar forma como prova.
  select '2. FUNCOES com teste negativo de papel',
         p.oid::regprocedure::text,
         case when p.prosrc ilike '%raise exception%' then 'tem raise - conferir se o teste negativo e guarda ou filtro'
              else '>>> SEM raise - e FILTRO, com '''' mudaria o resultado <<<' end,
         coalesce(substring(p.prosrc from '(?i)[^;]{0,60}minha_role_auria\(\)\s*(<>|!=|not in)[^;]{0,120}'),'')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~* 'minha_role_auria\(\)\s*(<>|!=|not in)'
     and p.proname not like 'auria_diag%'

) z order by 1, 3 desc, 2;

-- Esperado para a correção de UMA LINHA ser viável: nenhuma linha com ">>>".
-- Qualquer ">>>" e eu abandono o atalho e corrijo as 15 individualmente.
