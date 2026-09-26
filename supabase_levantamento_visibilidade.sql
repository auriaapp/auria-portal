-- ============================================================================
--  LEVANTAMENTO — item 146: quem ganha e quem perde com a visibilidade por ISO
--  Cole TUDO no SQL Editor e dê Run uma vez. Sai UMA tabela. Não altera nada.
--
--  Antes de ligar qualquer enforcement, este levantamento responde:
--    · quantos apontamentos existem em cada faixa (e com que grafias);
--    · quem hoje lê o quê;
--    · quem GANHA acesso (fornecedores, que hoje não leem nem o Público);
--    · quem PERDE acesso (setor/obra que hoje lê a faixa "Projeto" sem o flag,
--      e apontamentos de disciplina que a matriz do sujeito não libera).
--
--  Regra proposta, para referência:
--    Coordenação → só a equipe, sempre
--    Projeto     → equipe + quem tiver o flag "ler_apont"
--    Público     → todos com acesso, ESCOPADO pelas disciplinas que enxergam
-- ============================================================================

create or replace function public.auria_levantamento_visib()
returns table(secao text, item text, valor text)
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  ------------------------------------------------------------------ faixas
  secao := '1 · faixas existentes';
  begin
    for r in execute $q$select coalesce(a.visibilidade,'(vazio)') as k, count(*)::text as n
        from public.apontamentos a group by 1 order by 2 desc$q$
    loop item := 'visibilidade "'||r.k||'"'; valor := r.n||' apontamento(s)'; return next; end loop;
  exception when others then item:='(faixas)'; valor:='ERRO: '||sqlerrm; return next; end;

  begin
    for r in execute $q$select e.nome as k,
             count(*) filter (where a.visibilidade = 'Coordenação')::text||' coord · '||
             count(*) filter (where a.visibilidade = 'Projeto')::text||' projeto · '||
             count(*) filter (where a.visibilidade = 'Público')::text||' público · '||
             count(*) filter (where a.visibilidade not in ('Coordenação','Projeto','Público')
                                 or a.visibilidade is null)::text||' outros' as n
        from public.apontamentos a
        join public.empreendimentos_auria e on e.id = a.empreendimento_id
       group by e.nome order by count(*) desc limit 12$q$
    loop item := r.k; valor := r.n; return next; end loop;
  exception when others then item:='(por empreendimento)'; valor:='ERRO: '||sqlerrm; return next; end;

  ------------------------------------------------- estado atual do flag
  secao := '2 · flag "Ler ap." hoje';
  begin
    for r in execute $q$select
             (case when a.fornecedor_id is not null then 'fornecedor' else 'usuário (setor/obra)' end)
             ||' · ler_apont '||(case when coalesce(a.ler_apont,false) then 'MARCADO' else 'desmarcado' end) as k,
             count(*)::text||' linha(s) na matriz' as n
        from public.cde_acesso_auria a group by 1 order by 1$q$
    loop item := r.k; valor := r.n; return next; end loop;
  exception when others then item:='(flags)'; valor:='ERRO: '||sqlerrm; return next; end;

  ------------------------------------------------------------------ ganham
  secao := '3 · GANHAM (fornecedor não lê nem o Público hoje)';
  begin
    for r in execute $q$select coalesce(f.nome,'?')||' @ '||coalesce(e.nome,'?') as k,
             (select count(*) from public.apontamentos ap
               where ap.empreendimento_id = a.empreendimento_id
                 and ap.visibilidade = 'Público'
                 and ( a.todas_disciplinas
                       or upper(coalesce(ap.disciplina,'')) = any(select upper(x) from unnest(a.disciplinas) x)
                       or upper(coalesce(ap.disciplina,'')) = any(select upper(x) from unnest(coalesce(a.disc_contr,'{}')) x)
                     ))::text
             ||' apontamento(s) público(s) nas disciplinas que ele vê' as n
        from public.cde_acesso_auria a
        join public.fornecedores_auria f on f.id = a.fornecedor_id
        join public.empreendimentos_auria e on e.id = a.empreendimento_id
        left join lateral (select array_agg(df.disciplina) as disc_contr
                             from public.disciplina_fornecedor_auria df
                            where df.fornecedor_id = a.fornecedor_id
                              and df.empreendimento_id = a.empreendimento_id) dc on true
       where a.fornecedor_id is not null
       order by 1$q$
    loop item := r.k; valor := r.n; return next; end loop;
  exception when others then
    -- a lateral com alias pode não resolver em versões antigas: versão simples
    begin
      for r in execute $q$select coalesce(f.nome,'?')||' @ '||coalesce(e.nome,'?') as k,
               (select count(*) from public.apontamentos ap
                 where ap.empreendimento_id = a.empreendimento_id
                   and ap.visibilidade = 'Público'
                   and ( a.todas_disciplinas
                         or upper(coalesce(ap.disciplina,'')) = any(select upper(x) from unnest(a.disciplinas) x)
                       ))::text||' apontamento(s) público(s) nas disciplinas marcadas' as n
          from public.cde_acesso_auria a
          join public.fornecedores_auria f on f.id = a.fornecedor_id
          join public.empreendimentos_auria e on e.id = a.empreendimento_id
         where a.fornecedor_id is not null order by 1$q$
      loop item := r.k; valor := r.n; return next; end loop;
    exception when others then item:='(ganham)'; valor:='ERRO: '||sqlerrm; return next; end;
  end;

  ------------------------------------------------------------------ perdem
  secao := '4 · PERDEM a faixa Projeto (flag desmarcado)';
  begin
    for r in execute $q$select coalesce(u.nome,u.email,'?')||' ['||coalesce(u.role,'?')||'] @ '||coalesce(e.nome,'?') as k,
             (select count(*) from public.apontamentos ap
               where ap.empreendimento_id = a.empreendimento_id
                 and ap.visibilidade = 'Projeto')::text
             ||' apontamento(s) de Projeto que ele lê HOJE e deixaria de ler' as n
        from public.cde_acesso_auria a
        join public.usuarios_auria u on u.id = a.usuario_id
        join public.empreendimentos_auria e on e.id = a.empreendimento_id
       where a.usuario_id is not null and not coalesce(a.ler_apont,false)
       order by 1$q$
    loop item := r.k; valor := r.n; return next; end loop;
    if not found then item:='(ninguém)'; valor:='nenhum usuário perde a faixa Projeto'; return next; end if;
  exception when others then item:='(perdem projeto)'; valor:='ERRO: '||sqlerrm; return next; end;

  secao := '5 · PERDEM por disciplina (Público fora do escopo dele)';
  begin
    for r in execute $q$select coalesce(u.nome,u.email,'?')||' ['||coalesce(u.role,'?')||'] @ '||coalesce(e.nome,'?') as k,
             (select count(*) from public.apontamentos ap
               where ap.empreendimento_id = a.empreendimento_id
                 and ap.visibilidade in ('Público','Projeto')
                 and not a.todas_disciplinas
                 and upper(coalesce(ap.disciplina,'')) <> all(select upper(x) from unnest(a.disciplinas) x))::text
             ||' apontamento(s) de disciplina que a matriz dele NÃO libera' as n
        from public.cde_acesso_auria a
        join public.usuarios_auria u on u.id = a.usuario_id
        join public.empreendimentos_auria e on e.id = a.empreendimento_id
       where a.usuario_id is not null
       order by 1$q$
    loop item := r.k; valor := r.n; return next; end loop;
    if not found then item:='(ninguém)'; valor:='nenhum usuário perde por recorte de disciplina'; return next; end if;
  exception when others then item:='(perdem disciplina)'; valor:='ERRO: '||sqlerrm; return next; end;

  ------------------------------------------------------- disciplinas soltas
  secao := '6 · risco de grafia';
  begin
    for r in execute $q$select 'apontamentos sem disciplina preenchida' as k, count(*)::text as n
        from public.apontamentos where coalesce(disciplina,'') = ''$q$
    loop item := r.k; valor := r.n||' — estes ficariam INVISÍVEIS num recorte por disciplina'; return next; end loop;
  exception when others then item:='(sem disciplina)'; valor:='ERRO: '||sqlerrm; return next; end;

  begin
    for r in execute $q$select 'grafias distintas de disciplina em apontamentos' as k,
             count(distinct upper(coalesce(disciplina,'')))::text as n from public.apontamentos$q$
    loop item := r.k; valor := r.n; return next; end loop;
  exception when others then item:='(grafias)'; valor:='ERRO: '||sqlerrm; return next; end;
end $$;

select * from public.auria_levantamento_visib();
