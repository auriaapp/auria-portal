-- ============================================================================
--  139 — DUAS auria_emails_equipe coexistem (achado 2026-09-26). SÓ LÊ.
--
--  A conferência do 144 devolveu DUAS linhas para auria_emails_equipe: uma
--  "CASA POR NOME" e outra "por id". São sobrecargas — mesmo nome, assinaturas
--  diferentes. A correção do 139 criou a versão por ID, mas a antiga por NOME
--  NÃO FOI REMOVIDA.
--
--  POR QUE ISSO IMPORTA: o Postgres escolhe a sobrecarga pelo TIPO do
--  argumento. Um chamador que passe text continua caindo na versão por nome —
--  a que juntava as equipes de quatro "Diagonal by Pininfarina" e mandava
--  e-mail para gente de outro grupo. A versão nova não protege esse caminho.
--
--  Esta consulta responde três coisas de uma vez:
--    1. quais são as duas assinaturas, e qual casa por nome
--    2. QUEM chama auria_emails_equipe, e com o quê
--    3. quais gatilhos estão ativos nas tabelas que disparam aviso
--
--  Consulta única (o SQL Editor só mostra o último comando).
--  Exclui as próprias sondas de diagnóstico do LIKE, para não contar a si mesma.
-- ============================================================================

select * from (

  select '1. AS DUAS VERSOES'                                        as secao,
         p.oid::regprocedure::text                                   as item,
         case when p.prosrc like '%e.nome%' then '>>> CASA POR NOME (a do 139) <<<'
              else 'por id - correta' end                            as valor,
         'definer=' || p.prosecdef::text || '  ' ||
           coalesce(array_to_string(p.proconfig,', '),'(SEM search_path)') as detalhe
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'auria_emails_equipe'

  union all
  -- Quem chama. Se algum chamador passar TEXT, ele cai na versão por nome.
  select '2. QUEM CHAMA',
         p.oid::regprocedure::text,
         case when p.prosrc like '%auria_emails_equipe(%nome%' then 'passa algo com "nome" - SUSPEITO'
              else 'conferir o argumento' end,
         substring(p.prosrc from '[^;]*auria_emails_equipe[^;]{0,90}')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc like '%auria_emails_equipe%'
     and p.proname <> 'auria_emails_equipe'
     and p.proname not like 'auria_diag%'

  union all
  -- Gatilhos ativos: são eles que disparam os avisos por e-mail.
  select '3. GATILHOS ATIVOS',
         c.relname || ' -> ' || t.tgname,
         case when t.tgenabled = 'D' then 'DESLIGADO' else 'ativo' end,
         p.proname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc  p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal
     and n.nspname = 'public'
     and p.prosrc like '%auria_emails_equipe%'

) z order by 1, 2;

-- Esperado DEPOIS da correção: a seção 1 com UMA linha só ("por id - correta").
-- Hoje ela tem duas, e é por isso que o 139 não está totalmente fechado.
