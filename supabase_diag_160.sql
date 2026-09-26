-- ============================================================================
--  Item 160 — o que a auditoria achou, e o que eu preciso antes de corrigir.
--  SÓ LÊ. Consulta única. (2026-09-26)
--
--  A AUDITORIA MOSTROU DUAS COISAS, e é importante não confundir uma com a
--  outra nem inflar nenhuma das duas:
--
--  (1) ~160 funções aparecem como "anon pode executar". Isso NÃO são 160
--      problemas. É UM: no Postgres toda função nasce com EXECUTE para PUBLIC,
--      e ninguém nunca revogou. Na maioria delas o anon não tira nada, porque
--      por dentro elas filtram por auth.uid(), que é nulo para ele.
--
--  (2) 15 funções têm guarda de papel que NÃO sobrevive a papel nulo — a mesma
--      forma que eu provei explorável no nf_bi. `NULL not in (...)` é NULL, e
--      `if NULL then` é FALSO, então a exceção nunca é levantada.
--
--  É o CRUZAMENTO de (1) e (2) que importa: guarda que não fecha + alcançável
--  por quem não tem perfil. Mas eu ainda NÃO afirmo que as 15 são exploráveis
--  — só que têm a mesma forma. Hoje eu já dei dois alarmes falsos por concluir
--  a partir da forma; não vou repetir. Esta consulta traz o que falta para eu
--  decidir com o corpo na mão.
--
--  A IDEIA DE CORREÇÃO (uma linha, fecha as 15 de uma vez): fazer
--  minha_role_auria() devolver '' em vez de NULL. Aí `'' not in (...)` é
--  VERDADEIRO e a exceção passa a ser levantada em todas elas, sem eu precisar
--  reescrever nenhuma. Para isso preciso de duas garantias, que a consulta dá:
--    . o corpo atual da função (ela não existe em arquivo nenhum do repo)
--    . que ninguém dependa do NULL (quem faz `is null` quebraria)
-- ============================================================================

select * from (

  select '1. o corpo de minha_role_auria' as secao,
         p.oid::regprocedure::text        as item,
         pg_get_functiondef(p.oid)        as detalhe
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('minha_role_auria','minha_empresa')

  union all
  -- Se aparecer QUALQUER linha aqui, a ideia do '' está descartada e eu corrijo
  -- as 15 uma a uma.
  select '2. QUEM DEPENDE DO NULL (tem de vir vazio)',
         p.oid::regprocedure::text,
         substring(p.prosrc from '[^;]{0,120}minha_role_auria\(\)\s+is\s+n[^;]{0,60}')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~* 'minha_role_auria\(\)\s+is\s+(not\s+)?null'
     and p.proname not like 'auria_diag%'

  union all
  -- A guarda das 15, para eu ver a forma exata de cada uma.
  select '3. a guarda das 15',
         p.oid::regprocedure::text,
         coalesce(substring(p.prosrc from '(?i)if[^;]{0,220}minha_role_auria[^;]{0,220}'),
                  '(nao achei a linha - ler o corpo)')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.prosrc like '%minha_role_auria()%'
     and p.prosrc ilike '%raise exception%'
     and not (p.prosrc ilike '%coalesce(%role%' or p.prosrc ilike '%coalesce(minha_role_auria()%')
     and p.proname not like 'auria_diag%'

) z order by 1, 2;

-- Esperado: a seção 2 VAZIA. Se vier alguma linha, a correção de uma linha não
-- serve e eu vou uma a uma.
