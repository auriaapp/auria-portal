-- ============================================================================
--  Item 139 — PROVAR o caminho do vazamento (2026-09-25)
--  Cole tudo e dê Run. Uma tabela só. Não altera nada.
--
--  Por que este arquivo existe: a consulta anterior disse que as duas contas
--  super_admin alcançavam ZERO empreendimentos — o que contradiz o e-mail ter
--  chegado. Ou a contagem enganou (empresa_id do empreendimento diferente do
--  empresa_id do usuário), ou o destinatário entrou por OUTRA porta: estar
--  vinculado como analista, ou ter papel gerente além do super_admin.
--
--  Aqui a lista de destinatários é reconstruída EXATAMENTE como a Edge Function
--  notify-fatura-solicitada monta, e cada linha diz POR QUE aquele e-mail entra.
-- ============================================================================

create or replace function public.auria_diag_vazamento()
returns table(secao text, item text, valor text)
language plpgsql security definer set search_path = public as $$
declare v text; r record; v_emp uuid; v_empresa uuid;
begin
  -- Empreendimento do contrato da Mexxa (o do pedido de faturamento)
  begin
    execute $q$select c.empreendimento_id from public.contratos_auria c
             where c.projetista_email ilike '%mexxa%'
             order by c.criado_em desc nulls last limit 1$q$ into v_emp;
  exception when others then v_emp := null; end;

  if v_emp is null then
    begin execute $q$select id from public.empreendimentos_auria
                     where nome ilike '%pininfarina%' limit 1$q$ into v_emp;
    exception when others then v_emp := null; end;
  end if;

  secao:='alvo'; item:='empreendimento do contrato';
  begin execute 'select coalesce(nome,''?'') from public.empreendimentos_auria where id=$1'
        into v using v_emp;
  exception when others then v:='ERRO: '||sqlerrm; end;
  valor:=coalesce(v,'NÃO ENCONTRADO'); return next;

  begin execute 'select empresa_id::text from public.empreendimentos_auria where id=$1'
        into v using v_emp;
  exception when others then v:='ERRO: '||sqlerrm; end;
  item:='empresa_id DESTE empreendimento'; valor:=coalesce(v,'(nulo)'); return next;
  begin v_empresa := v::uuid; exception when others then v_empresa := null; end;

  -- Quem a função escolheria: analistas vinculados
  secao:='destinatarios';
  begin
    for r in execute $q$select u.email as e,
             'analista VINCULADO ao empreendimento (role='||coalesce(u.role,'?')||')' as p
        from public.analista_empreendimento_auria ae
        join public.usuarios_auria u on u.id = ae.analista_id
       where ae.empreendimento_id = $1 and ae.ativo = true and u.email is not null$q$
      using v_emp
    loop item:=r.e; valor:=r.p; return next; end loop;
  exception when others then item:='(analistas)'; valor:='ERRO: '||sqlerrm; return next; end;

  -- Quem a função escolheria: gestão da empresa (regra ANTIGA, com super_admin)
  begin
    for r in execute $q$select u.email as e,
             'papel '||u.role||' com empresa_id IGUAL ao do empreendimento' as p
        from public.usuarios_auria u
       where u.empresa_id = $1 and u.role in ('gerente','super_admin') and u.email is not null$q$
      using v_empresa
    loop item:=r.e; valor:=r.p; return next; end loop;
  exception when others then item:='(gestao)'; valor:='ERRO: '||sqlerrm; return next; end;

  -- As contas suspeitas, vistas de todos os ângulos
  secao:='contas suspeitas';
  begin
    for r in execute $q$select u.email as e,
             'role='||coalesce(u.role,'?')
             ||' · empresa_id='||coalesce(u.empresa_id::text,'(nulo)')
             ||' · vinculado como analista neste emp: '
             ||(case when exists (select 1 from public.analista_empreendimento_auria ae
                                   where ae.analista_id=u.id and ae.empreendimento_id=$1 and ae.ativo)
                     then 'SIM' else 'nao' end)
             ||' · empresa_id bate com a do emp: '
             ||(case when u.empresa_id = $2 then 'SIM' else 'nao' end) as p
        from public.usuarios_auria u
       where u.email in ('tvmedeiros@gmail.com','tiago-arq@outlook.com')$q$
      using v_emp, v_empresa
    loop item:=r.e; valor:=r.p; return next; end loop;
  exception when others then item:='(suspeitas)'; valor:='ERRO: '||sqlerrm; return next; end;

  -- Conferência da contagem que deu zero
  secao:='hierarquia';
  begin
    for r in execute $q$select coalesce(em.nome,'(sem nome)')||' ['||em.id::text||']' as e,
             (select count(*)::text from public.empreendimentos_auria e2 where e2.empresa_id = em.id)
             ||' empreendimento(s)' as p
        from public.empresas_auria em order by 1$q$
    loop item:=r.e; valor:=r.p; return next; end loop;
  exception when others then item:='(empresas)'; valor:='ERRO: '||sqlerrm; return next; end;
end $$;

select * from public.auria_diag_vazamento();
