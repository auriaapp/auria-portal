-- ============================================================================
--  ITEM 77d — MARCOS DE MEDIÇÃO × PARCELAS.
--  O coordenador amarra uma parcela do contrato a uma tarefa do Prevision
--  (parcelas_auria.prevision_tarefa_id). A tarefa vira "marco de medição"
--  (prevision_tarefa_auria.marco_medicao). Quando a sincronização traz a tarefa
--  FINALIZADA (kanban_status 'finished' ou realizado 100%), a parcela fica
--  LIBERÁVEL: aparece para coordenador/adm-fin/projetista e sai um e-mail
--  (uma vez por parcela). Nada muda de status sozinho — quem fatura é o fluxo
--  normal (projetista solicita → coordenador autoriza…). Reaplicável.
--  Requer supabase_prevision.sql, _p2 e _p3.
-- ============================================================================
alter table public.parcelas_auria add column if not exists prevision_tarefa_id uuid references public.prevision_tarefa_auria(id) on delete set null;
create index if not exists idx_parc_pvtarefa on public.parcelas_auria(prevision_tarefa_id);

-- 1) marco_medicao acompanha as parcelas: true enquanto alguma parcela apontar para a tarefa
create or replace function public.pv_marco_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.prevision_tarefa_id is not null then
    update public.prevision_tarefa_auria t set marco_medicao = exists (select 1 from public.parcelas_auria p where p.prevision_tarefa_id = t.id)
     where t.id = old.prevision_tarefa_id;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.prevision_tarefa_id is not null then
    update public.prevision_tarefa_auria set marco_medicao = true where id = new.prevision_tarefa_id;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_pv_marco_sync on public.parcelas_auria;
create trigger trg_pv_marco_sync after insert or update of prevision_tarefa_id or delete on public.parcelas_auria
  for each row execute function public.pv_marco_sync();

-- 2) tarefa concluída?
create or replace function public.pv_tarefa_concluida(t public.prevision_tarefa_auria) returns boolean language sql immutable as $$
  select coalesce(t.kanban_status,'') = 'finished' or coalesce(t.real,0) >= 1;
$$;

-- 3) parcelas liberáveis (marco concluído no Prevision e parcela ainda "a faturar")
--    Quem vê: mesma régua de leitura do empreendimento (coordenador/gestão/adm-fin da empresa) +
--    o projetista dono do contrato (só as dele).
create or replace function public.parcelas_liberaveis(p_emp uuid default null)
returns table (parcela_id uuid, contrato_id uuid, empreendimento_id uuid, empreendimento text, disciplina text, projetista text, projetista_email text,
               numero int, descricao text, valor numeric, vencimento date, status text,
               tarefa text, wbs text, tarefa_fim date, tarefa_kanban text, concluida_em timestamptz)
language sql security definer stable set search_path = public as $$
  select p.id, c.id, e.id, e.nome, c.disciplina, coalesce(c.projetista_nome, c.projetista_email), c.projetista_email,
         p.numero, p.descricao, p.valor, p.vencimento, p.status,
         t.nome, t.wbs, t.fim, t.kanban, t.atualizado_em
    from public.parcelas_auria p
    join public.contratos_auria c on c.id = p.contrato_id
    join public.empreendimentos_auria e on e.id = c.empreendimento_id
    join public.prevision_tarefa_auria t on t.id = p.prevision_tarefa_id
   where (p_emp is null or e.id = p_emp)
     and p.status = 'a_faturar' and t.removida_em is null and public.pv_tarefa_concluida(t)
     and (public.cde_pav_pode_ver(e.id)
          or lower(c.projetista_email) = lower(coalesce((select u.email from public.usuarios_auria u where u.id = auth.uid()), '')))
   order by e.nome, c.disciplina, p.numero;
$$;
grant execute on function public.parcelas_liberaveis(uuid) to authenticated;

-- 4) e-mail quando o marco CONCLUI (na sincronização) e há parcela a faturar amarrada — uma vez por parcela
create or replace function public.pv_marco_concluido_email() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_dest text[]; v_corpo text; v_emp text;
begin
  if not public.pv_tarefa_concluida(new) or public.pv_tarefa_concluida(old) then return new; end if;   -- só na transição p/ concluída
  select e.nome into v_emp from public.empreendimentos_auria e where e.id = new.empreendimento_id;
  for r in select p.id, p.numero, p.descricao, p.valor, c.disciplina, c.projetista_email, coalesce(c.projetista_nome, c.projetista_email) as projetista
             from public.parcelas_auria p join public.contratos_auria c on c.id = p.contrato_id
            where p.prevision_tarefa_id = new.id and p.status = 'a_faturar'
  loop
    if not public.auria_notif_once('pv_marco|'||r.id) then continue; end if;
    -- coordenação + gestão (equipe) + adm-fin da empresa + projetista do contrato
    select array_agg(distinct em) into v_dest from (
      select unnest(coalesce(public.auria_emails_equipe(v_emp), '{}')) as em
      union select u.email from public.usuarios_auria u join public.empreendimentos_auria e on e.empresa_id = u.empresa_id
             where e.id = new.empreendimento_id and u.role = 'financeiro' and u.email is not null
      union select r.projetista_email where r.projetista_email is not null) x where em is not null;
    if v_dest is null or array_length(v_dest,1) is null then continue; end if;
    v_corpo := '<p>O marco de medição <b>'||public.auria_esc(coalesce(new.wbs,'')||' '||coalesce(new.nome,''))||'</b> foi concluído no cronograma.</p>'
            || '<p>Com isso a parcela <b>'||r.numero||'</b>'||case when r.descricao is not null then ' — '||public.auria_esc(r.descricao) else '' end
            || ' ('||public.auria_esc(coalesce(r.disciplina,''))||' · '||public.auria_esc(r.projetista)||') no valor de <b>R$ '||to_char(coalesce(r.valor,0),'FM999G999G990D00')||'</b> está <b>liberável para faturamento</b>.</p>'
            || '<p>Projetista: solicite o faturamento pelo seu painel. Coordenação: autorize quando a solicitação chegar.</p>';
    perform public.auria_send_email(v_dest, 'Parcela liberável — '||coalesce(v_emp,'')||' · '||coalesce(r.disciplina,''),
      public.auria_email_shell('Auria · Custos', 'Marco concluído: parcela '||r.numero||' liberável', v_corpo, 'Abrir o Auria', 'https://auria.solutions/'),
      null, null);
  end loop;
  return new;
end $$;
drop trigger if exists trg_pv_marco_concluido on public.prevision_tarefa_auria;
create trigger trg_pv_marco_concluido after update of kanban_status, real on public.prevision_tarefa_auria
  for each row when (new.marco_medicao) execute function public.pv_marco_concluido_email();

-- 5) fin_contratos (adm-fin) passa a devolver o marco de cada parcela
create or replace function public.fin_contratos(p_empreendimento_id uuid default null)
returns table(
  contrato_id uuid, empreendimento_id uuid, empreendimento text, construtora text,
  disciplina text, objeto text, numero text, projetista text,
  valor_total numeric, parcelas jsonb)
language plpgsql security definer stable as $$
begin
  if public.minha_role_auria() not in ('financeiro','gerente','super_admin') then
    raise exception 'Acesso restrito ao Painel de Custos.';
  end if;
  return query
    select ct.id, e.id, e.nome, c2.nome, ct.disciplina, ct.objeto, ct.numero,
           coalesce(ct.projetista_nome, ct.projetista_email),
           ct.valor_total,
           coalesce((select jsonb_agg(jsonb_build_object(
               'id',p.id,'numero',p.numero,'descricao',p.descricao,'valor',p.valor,
               'vencimento',p.vencimento,'status',p.status,
               'marco', case when t.id is null then null else jsonb_build_object('nome',t.nome,'wbs',t.wbs,'fim',t.fim,'concluida',public.pv_tarefa_concluida(t)) end) order by p.numero)
             from public.parcelas_auria p left join public.prevision_tarefa_auria t on t.id = p.prevision_tarefa_id
             where p.contrato_id = ct.id), '[]'::jsonb)
    from public.contratos_auria ct
    join public.empreendimentos_auria e on e.id = ct.empreendimento_id
    left join public.construtoras_auria c2 on c2.id = e.construtora_id
    where (public.minha_role_auria() = 'super_admin' or e.empresa_id = public.minha_empresa())
      and (p_empreendimento_id is null or ct.empreendimento_id = p_empreendimento_id)
    order by e.nome, ct.disciplina;
end $$;
grant execute on function public.fin_contratos(uuid) to authenticated;

select 'prevision_tarefa_id' as item, exists(select 1 from information_schema.columns where table_name='parcelas_auria' and column_name='prevision_tarefa_id') as ok
union all select 'parcelas_liberaveis', exists(select 1 from pg_proc where proname='parcelas_liberaveis')
union all select 'trg_pv_marco_concluido', exists(select 1 from pg_trigger where tgname='trg_pv_marco_concluido')
union all select 'fin_contratos (marco)', exists(select 1 from pg_proc where proname='fin_contratos');
