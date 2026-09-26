-- ============================================================================
--  Item 149 — conferência honesta (2026-09-26). Só lê.
--
--  A conferência anterior ficou enganosa por culpa dela mesma: usava
--  "where e.nome = 'Diagonal by Pininfarina' limit 1" SEM filtrar arquivado,
--  então podia pegar um homônimo. Esta aqui mostra os fatos, não um resumo.
--
--  Duas perguntas:
--   1. Existe mais de um empreendimento com esse nome? (é a explicação de como
--      um gerente do Grupo Teste entrava na lista de um empreendimento do
--      Grupo Diagonal: a função ANTIGA casava por NOME e não filtrava
--      arquivado, devolvendo a união das duas equipes.)
--   2. Qual chamador ainda usa a versão por nome?
-- ============================================================================

create or replace function public.auria_diag_149b()
returns table(secao text, item text, valor text)
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  ---------------------------------------------------- homônimos
  secao := '1 · empreendimentos com nome repetido';
  begin
    for r in execute $q$select e.nome||'  ['||e.id::text||']' as k,
             'grupo: '||coalesce(g.nome,'(sem grupo)')
             ||' · arquivado: '||(case when e.deleted_at is null then 'não' else to_char(e.deleted_at,'DD/MM/YYYY') end)
             ||' · equipe: '||coalesce(array_to_string(public.auria_emails_equipe(e.id), ', '),'(ninguém)') as p
        from public.empreendimentos_auria e
        left join public.empresas_auria g on g.id = e.empresa_id
       where e.nome in (select nome from public.empreendimentos_auria group by nome having count(*) > 1)
       order by e.nome, e.deleted_at nulls first$q$
    loop item := r.k; valor := r.p; return next; end loop;
    if not found then item := '(nenhum nome repetido)'; valor := 'nem contando os arquivados'; return next; end if;
  exception when others then item:='(homônimos)'; valor:='ERRO: '||sqlerrm; return next; end;

  ------------------------------------- o empreendimento REAL do contrato
  secao := '2 · o empreendimento do contrato da Mexxa';
  begin
    for r in execute $q$select coalesce(e.nome,'?')||'  ['||e.id::text||']' as k,
             'grupo: '||coalesce(g.nome,'?')
             ||' · arquivado: '||(case when e.deleted_at is null then 'não' else 'SIM' end)
             ||' · equipe HOJE (por id): '||coalesce(array_to_string(public.auria_emails_equipe(e.id), ', '),'(ninguém)') as p
        from public.contratos_auria ct
        join public.empreendimentos_auria e on e.id = ct.empreendimento_id
        left join public.empresas_auria g on g.id = e.empresa_id
       where ct.projetista_email ilike '%mexxa%' limit 3$q$
    loop item := r.k; valor := r.p; return next; end loop;
  exception when others then item:='(contrato)'; valor:='ERRO: '||sqlerrm; return next; end;

  ------------------------------------- o que a ponte por NOME devolveria
  secao := '3 · a ponte por nome, agora';
  begin
    for r in execute $q$select 'auria_emails_equipe(''Diagonal by Pininfarina'')' as k,
             coalesce(array_to_string(public.auria_emails_equipe('Diagonal by Pininfarina'::text), ', '),
                      '(vazio — nome ambíguo, e a ponte se recusa a chutar)') as p$q$
    loop item := r.k; valor := r.p; return next; end loop;
  exception when others then item:='(ponte)'; valor:='ERRO: '||sqlerrm; return next; end;

  ------------------------------------- quem ainda chama por nome
  secao := '4 · chamador que ainda usa NOME';
  begin
    for r in execute $q$select p.proname as k,
             substring(p.prosrc from position('auria_emails_equipe' in p.prosrc) for 60) as p
        from pg_proc p
       where p.prosrc like '%auria_emails_equipe%'
         and p.proname <> 'auria_emails_equipe'
       order by 1$q$
    loop item := r.k; valor := r.p; return next; end loop;
  exception when others then item:='(chamadores)'; valor:='ERRO: '||sqlerrm; return next; end;
end $$;

select * from public.auria_diag_149b();
