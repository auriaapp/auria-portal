-- ============================================================================
--  Item 139 — segunda rodada: o remetente certo (2026-09-26)
--  Cole tudo e dê Run. Uma tabela. Só lê.
--
--  A primeira investigação olhou a Edge Function notify-fatura-solicitada e
--  provou que o e-mail NÃO saiu por ela. Mas o aviso de "solicitação de
--  faturamento" também sai de um GATILHO SQL (notif_parcela_status), que eu não
--  tinha auditado. E ele resolve destinatário assim:
--
--      dest := public.auria_emails_equipe(c.emp_nome);
--
--  Por NOME do empreendimento — a mesma fragilidade que causou o item 134.
--  Se o nome guardado no contrato não for exatamente o nome atual do
--  empreendimento, essa função pode não achar ninguém… ou achar a equipe de
--  OUTRO empreendimento.
--
--  E há uma segunda pista: existem ALIASES com '+' usados em teste
--  (tvmedeiros+proj@, tvmedeiros+ana@). O Gmail entrega todos em
--  tvmedeiros@gmail.com — e a consulta anterior procurou só o endereço exato.
-- ============================================================================

create or replace function public.auria_diag_139b()
returns table(secao text, item text, valor text)
language plpgsql security definer set search_path = public as $$
declare v text; r record;
begin
  ---------------------------------------------------------- aliases com '+'
  secao := '1 · contas que caem no mesmo Gmail';
  begin
    for r in execute $q$select u.email as e,
             'papel '||coalesce(u.role,'?')||' · grupo '||coalesce(u.empresa_id::text,'(nulo)') as p
        from public.usuarios_auria u
       where lower(u.email) like 'tvmedeiros+%' or lower(u.email) like 'tiago%+%'
       order by 1$q$
    loop item := r.e; valor := r.p; return next; end loop;
    if not found then item := '(nenhum alias com +)'; valor := 'não é por aqui'; return next; end if;
  exception when others then item:='(aliases)'; valor:='ERRO: '||sqlerrm; return next; end;

  begin
    for r in execute $q$select p.email as e, 'projetista de '||coalesce(f.nome,'?') as p
        from public.projetistas_auria p
        left join public.fornecedores_auria f on f.id = p.fornecedor_id
       where lower(p.email) like '%+%' order by 1$q$
    loop item := 'projetista '||r.e; valor := r.p; return next; end loop;
  exception when others then null; end;

  ---------------------------------------------- o nome guardado no contrato
  secao := '2 · o nome que o gatilho usa';
  begin
    for r in execute $q$select coalesce(ct.numero, ct.objeto, ct.id::text) as k,
             'emp_id='||coalesce(ct.empreendimento_id::text,'(nulo)')
             ||' · nome do empreendimento hoje: '||coalesce(e.nome,'(não encontrado)') as p
        from public.contratos_auria ct
        left join public.empreendimentos_auria e on e.id = ct.empreendimento_id
       where ct.projetista_email ilike '%mexxa%' order by 1$q$
    loop item := 'contrato '||r.k; valor := r.p; return next; end loop;
    if not found then item:='(nenhum contrato da Mexxa)'; valor:='—'; return next; end if;
  exception when others then item:='(contrato)'; valor:='ERRO: '||sqlerrm; return next; end;

  ------------------------------------- quem auria_emails_equipe devolve HOJE
  secao := '3 · destinatários que a função devolve';
  begin
    for r in execute $q$select e.nome as k,
             coalesce(array_to_string(public.auria_emails_equipe(e.nome), ', '), '(ninguém)') as p
        from public.empreendimentos_auria e
       where e.deleted_at is null
       order by e.nome limit 12$q$
    loop item := r.k; valor := r.p; return next; end loop;
  exception when others then item:='(equipe)'; valor:='ERRO: '||sqlerrm; return next; end;

  ---------------------------------------------- e-mails realmente disparados
  secao := '4 · avisos já registrados';
  begin
    for r in execute $q$select left(n.chave, 70) as k, to_char(n.criado_em,'DD/MM HH24:MI') as p
        from public.notif_enviadas n
       order by n.criado_em desc limit 12$q$
    loop item := r.k; valor := r.p; return next; end loop;
    if not found then item:='(nenhum registro)'; valor:='a tabela notif_enviadas está vazia'; return next; end if;
  exception when others then item:='(notif_enviadas)'; valor:='ERRO: '||sqlerrm; return next; end;
end $$;

select * from public.auria_diag_139b();
