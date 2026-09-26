-- ============================================================================
--  DIAGNÓSTICO ÚNICO — 2026-09-25
--  Cole TUDO no SQL Editor e dê Run uma vez só. Sai UMA tabela com todas as
--  respostas (o editor do Supabase só mostra o resultado da ÚLTIMA instrução —
--  por isso os arquivos anteriores pareciam devolver só o EXPLAIN).
--
--  Só lê. Cada sonda roda isolada: se uma tabela ou coluna não existir, aquela
--  linha vem com "ERRO: ..." e as demais continuam.
--
--  Cobre: 134 (chave duplicada nos apontamentos), 137 (RT que não aparece),
--         131 (volume do Painel de Custos) e 138 (leitura de disciplina extra).
-- ============================================================================

create or replace function public.auria_diag_20260925()
returns table(secao text, item text, valor text)
language plpgsql security definer set search_path = public as $$
declare v text; r record;
begin
  ---------------------------------------------------------------- 134
  begin execute 'select count(*)::text from public.apontamentos where empreendimento_id is null' into v;
  exception when others then v:='ERRO: '||sqlerrm; end;
  secao:='134 apontamentos'; item:='linhas com empreendimento_id NULO'; valor:=v; return next;

  begin execute $q$select count(*)::text from (
        select nome from public.empreendimentos_auria
         where deleted_at is null group by nome having count(*)>1) x$q$ into v;
  exception when others then v:='ERRO: '||sqlerrm; end;
  item:='nomes de empreendimento REPETIDOS'; valor:=v; return next;

  begin execute $q$select count(*)::text from (
        select empreendimento, id from public.apontamentos
         group by empreendimento, id
        having count(distinct coalesce(empreendimento_id::text,'-'))>1) y$q$ into v;
  exception when others then v:='ERRO: '||sqlerrm; end;
  item:='pares (nome,id) com empreendimento_id divergente'; valor:=v; return next;

  begin
    for r in execute $q$select a.empreendimento||' / '||a.id as k,
             count(*)::text||' linha(s), ids: '||
             string_agg(distinct coalesce(a.empreendimento_id::text,'(nulo)'), ' | ') as d
        from public.apontamentos a
       group by a.empreendimento, a.id
      having count(*)>1 or count(distinct coalesce(a.empreendimento_id::text,'(nulo)'))>1
       order by 1 limit 15$q$
    loop item:='colisão: '||r.k; valor:=r.d; return next; end loop;
  exception when others then item:='colisões (falhou)'; valor:='ERRO: '||sqlerrm; return next; end;

  begin
    for r in execute $q$select con.conname as n, pg_get_constraintdef(con.oid) as d
        from pg_constraint con join pg_class c on c.oid=con.conrelid
       where c.relname='apontamentos' and con.contype in ('u','p') order by 1$q$
    loop item:='unicidade '||r.n; valor:=r.d; return next; end loop;
  exception when others then item:='unicidades (falhou)'; valor:='ERRO: '||sqlerrm; return next; end;

  ---------------------------------------------------------------- 137
  secao:='137 RT / projetistas';
  begin execute $q$select case when relrowsecurity then 'SIM' else 'NAO' end
          from pg_class where relname='projetistas_auria'$q$ into v;
  exception when others then v:='ERRO: '||sqlerrm; end;
  item:='RLS ligada em projetistas_auria?'; valor:=coalesce(v,'tabela não encontrada'); return next;

  begin
    for r in execute $q$select pol.polname as n,
             (case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                              when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end)
             ||' USING '||coalesce(pg_get_expr(pol.polqual,pol.polrelid),'(sem)') as d
        from pg_policy pol join pg_class c on c.oid=pol.polrelid
       where c.relname='projetistas_auria' order by 1$q$
    loop item:='policy '||r.n; valor:=r.d; return next; end loop;
  exception when others then item:='policies (falhou)'; valor:='ERRO: '||sqlerrm; return next; end;

  begin execute $q$select count(*)::text from pg_policy pol join pg_class c on c.oid=pol.polrelid
       where c.relname='projetistas_auria'$q$ into v;
  exception when others then v:='ERRO: '||sqlerrm; end;
  item:='total de policies'; valor:=v; return next;

  begin
    for r in execute $q$select p.nome||' <'||coalesce(p.email,'')||'>' as k,
             'RT='||coalesce(p.eh_rt::text,'?')||' admfin='||coalesce(p.eh_adm_fin::text,'?')
             ||' ativo='||coalesce(p.ativo::text,'?')||' discs='||coalesce(p.disciplinas::text,'-') as d
        from public.projetistas_auria p
        join public.fornecedores_auria f on f.id=p.fornecedor_id
       where f.nome ilike '%mexxa%' order by 1$q$
    loop item:='pessoa '||r.k; valor:=r.d; return next; end loop;
  exception when others then item:='pessoas Mexxa (falhou)'; valor:='ERRO: '||sqlerrm; return next; end;

  ---------------------------------------------------------------- 131
  secao:='131 custos';
  begin execute 'select count(*)::text from public.notas_fiscais_auria' into v;
  exception when others then v:='ERRO: '||sqlerrm; end;
  item:='notas fiscais'; valor:=v; return next;
  begin execute 'select count(*)::text from public.contratos_auria' into v;
  exception when others then v:='ERRO: '||sqlerrm; end;
  item:='contratos'; valor:=v; return next;
  begin execute 'select count(*)::text from public.parcelas_auria' into v;
  exception when others then v:='ERRO: '||sqlerrm; end;
  item:='parcelas'; valor:=v; return next;

  ---------------------------------------------------------------- 138
  secao:='138 fornecedor';
  begin
    for r in execute $q$select coalesce(f.nome,'?')||' @ '||coalesce(e.nome,'?') as k,
             've='||coalesce(a.disciplinas::text,'{}')
             ||' envia='||coalesce(a.disciplinas_upload::text,'(coluna nao existe)')
             ||' todas='||coalesce(a.todas_disciplinas::text,'?')
             ||' N-PUB='||coalesce(a.ver_nao_publicado::text,'?')
             ||' baixar='||coalesce(a.download::text,'?') as d
        from public.cde_acesso_auria a
        join public.empreendimentos_auria e on e.id=a.empreendimento_id
        left join public.fornecedores_auria f on f.id=a.fornecedor_id
       where a.fornecedor_id is not null order by 1$q$
    loop item:='matriz '||r.k; valor:=r.d; return next; end loop;
  exception when others then item:='matriz fornecedor (falhou)'; valor:='ERRO: '||sqlerrm; return next; end;

  begin
    for r in execute $q$select d.disciplina as k,
             count(*)::text||' doc(s) · liberadas: '
             ||count(*) filter (where r2.status in ('A1','B1','AS_BUILT'))::text
             ||' · status: '||string_agg(distinct r2.status, ',' order by r2.status) as d
        from public.cde_documento_auria d
        join lateral (select r3.status from public.cde_revisao_auria r3
                       where r3.documento_id=d.id
                       order by r3.recebido_em desc nulls last limit 1) r2 on true
       where coalesce(d.arquivado,false)=false
         and d.empreendimento_id in (select distinct empreendimento_id
                                       from public.cde_acesso_auria where fornecedor_id is not null)
       group by d.disciplina order by 1$q$
    loop item:='disciplina '||r.k; valor:=r.d; return next; end loop;
  exception when others then item:='status por disciplina (falhou)'; valor:='ERRO: '||sqlerrm; return next; end;
end $$;

-- ESTA é a última instrução, então é a que o editor mostra:
select * from public.auria_diag_20260925();
