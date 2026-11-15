-- ═══════════════════════════════════════════════════════════════════════════
-- Item 113 fase 3 (2026-11-15): a pendência manda na conclusão por disciplina.
-- Depende de supabase_apt_pendencias.sql (fase 2).
--
--   • participantes.{disciplina}.conclusao passa a ser CALCULADA: todas as
--     pendências da disciplina resolvidas → data da última; alguma pendente → vazia.
--     Como a cobrança (cobranca_devidas / cobranca_conjunto_html / cobrar_agora)
--     já ignora participante com conclusão, quem resolveu sai da cobrança e do
--     atraso sem mexer na régua.
--   • prazo_min / atrasado / dias_atraso / conclusao do apontamento são
--     recalculados junto (mesma regra do calcPrazos do App: só disciplina sem
--     conclusão conta para prazo e atraso).
--   • Caminho inverso: a coordenação digitar a conclusão de uma disciplina no
--     editor resolve as pendências dela; apagar a data reabre.
--   • E-mail de cobrança: abaixo do título do apontamento, "falta em SB1, SB2"
--     (só quando o apontamento tem mais de um local).
-- REVERSÃO no fim (comentada).
-- ═══════════════════════════════════════════════════════════════════════════

-- Recalcula conclusão por disciplina + colunas-resumo de UM apontamento.
-- Só grava se algo mudou. Grava com auria.pend_rpc=1 (o gatilho não reprocessa).
create or replace function cde_priv.apt_pend_concl(p_emp uuid, p_apt text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare a record; v_parts jsonb; k text; v jsonb; st record; v_c text; v_flag text;
        v_hoje date := (now() at time zone 'America/Fortaleza')::date; v_pmin date; v_cmax date; v_atr int;
begin
  select * into a from apontamentos where empreendimento_id = p_emp and id = p_apt;
  if not found or jsonb_typeof(a.participantes) is distinct from 'object' then return; end if;
  v_parts := a.participantes;
  for k, v in select e.key, e.value from jsonb_each(a.participantes) e loop
    if jsonb_typeof(v) <> 'object' or coalesce(v->>'nivel','Pendência') <> 'Pendência' then continue; end if;
    select count(*) n, count(*) filter (where estado = 'pendente') np, max(resolvido_em) ult into st
      from apontamento_pendencia_auria
     where empreendimento_id = p_emp and apontamento_id = p_apt and disciplina = k;
    if st.n = 0 then continue; end if;
    v_c := coalesce(trim(v->>'conclusao'),'');
    if st.np > 0 then v_c := '';
    elsif v_c = '' then
      v_c := coalesce(nullif(trim(a.conclusao),''), to_char(coalesce(st.ult, now()) at time zone 'America/Fortaleza','DD/MM/YYYY'));
    end if;
    if v_c is distinct from coalesce(v->>'conclusao','') then
      v_parts := jsonb_set(v_parts, array[k,'conclusao'], to_jsonb(v_c), true);
    end if;
  end loop;
  if v_parts = a.participantes then return; end if;

  select min(public.cob_data(x.value->>'prazo')) filter (where coalesce(trim(x.value->>'conclusao'),'') = ''),
         max(public.cob_data(x.value->>'conclusao'))
    into v_pmin, v_cmax
    from jsonb_each(v_parts) x where jsonb_typeof(x.value) = 'object';
  v_atr := case when v_pmin < v_hoje then v_hoje - v_pmin else 0 end;

  v_flag := coalesce(current_setting('auria.pend_rpc', true),'');
  perform set_config('auria.pend_rpc', '1', true);
  update apontamentos
     set participantes = v_parts,
         prazo_min   = coalesce(to_char(v_pmin,'DD/MM/YYYY'),''),
         conclusao   = coalesce(to_char(v_cmax,'DD/MM/YYYY'),''),
         atrasado    = v_atr > 0,
         dias_atraso = v_atr
   where empreendimento_id = p_emp and id = p_apt;
  perform set_config('auria.pend_rpc', v_flag, true);
end $$;

-- Gatilho: + caminho inverso (conclusão digitada) + recálculo da conclusão.
create or replace function cde_priv.apt_pend_trg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_old jsonb; v_new jsonb;
begin
  if new.empreendimento_id is null then return new; end if;
  -- Nunca derruba o salvar do apontamento: se o cálculo falhar, só avisa no log.
  begin
  perform cde_priv.apt_pend_sync(new.empreendimento_id, new.id);
  if coalesce(current_setting('auria.pend_rpc', true),'') <> '1' then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      if new.status = 'Resolvido' then
        update apontamento_pendencia_auria set estado='resolvido', resolvido_em=coalesce(resolvido_em, now()),
               resolvido_por=coalesce(resolvido_por, auth.uid())
         where empreendimento_id=new.empreendimento_id and apontamento_id=new.id and estado='pendente';
      elsif old.status = 'Resolvido' then
        update apontamento_pendencia_auria set estado='pendente', resolvido_em=null, resolvido_por=null, resolvido_por_nome=null
         where empreendimento_id=new.empreendimento_id and apontamento_id=new.id;
      end if;
    end if;
    -- Conclusão digitada/apagada à mão numa disciplina → resolve/reabre só ela.
    if tg_op = 'UPDATE' and new.participantes is distinct from old.participantes then
      v_old := case when jsonb_typeof(old.participantes)='object' then old.participantes else '{}'::jsonb end;
      v_new := case when jsonb_typeof(new.participantes)='object' then new.participantes else '{}'::jsonb end;
      update apontamento_pendencia_auria set estado='resolvido', resolvido_em=now(), resolvido_por=auth.uid()
       where empreendimento_id=new.empreendimento_id and apontamento_id=new.id and estado='pendente'
         and disciplina in (select e.key from jsonb_each(v_new) e
                             where coalesce(trim(e.value->>'conclusao'),'') <> ''
                               and coalesce(trim(v_old->e.key->>'conclusao'),'') = '');
      update apontamento_pendencia_auria set estado='pendente', resolvido_em=null, resolvido_por=null, resolvido_por_nome=null
       where empreendimento_id=new.empreendimento_id and apontamento_id=new.id and estado='resolvido'
         and disciplina in (select e.key from jsonb_each(v_new) e
                             where coalesce(trim(e.value->>'conclusao'),'') = ''
                               and coalesce(trim(v_old->e.key->>'conclusao'),'') <> '');
    end if;
    perform cde_priv.apt_pend_concl(new.empreendimento_id, new.id);
  end if;
  exception when others then
    raise warning 'apt_pend_trg %/%: %', new.empreendimento_id, new.id, sqlerrm;
  end;
  return new;
end $$;

-- RPC: agora também recalcula a conclusão por disciplina antes de fechar/reabrir.
create or replace function public.apt_pend_marcar(p_emp uuid, p_apt text, p_ids uuid[], p_resolvido boolean)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_falta int; v_status text; v_nome text;
begin
  if not (eh_coordenador_emp(p_emp) or coalesce(minha_role_auria(),'') = 'super_admin') then
    raise exception 'Só a coordenação do empreendimento marca pendências.' using errcode = '42501';
  end if;
  select status into v_status from apontamentos where empreendimento_id = p_emp and id = p_apt;
  if not found then raise exception 'Apontamento não encontrado.'; end if;
  select nome into v_nome from usuarios_auria where id = auth.uid();
  update apontamento_pendencia_auria
     set estado = case when p_resolvido then 'resolvido' else 'pendente' end,
         resolvido_em = case when p_resolvido then now() end,
         resolvido_por = case when p_resolvido then auth.uid() end,
         resolvido_por_nome = case when p_resolvido then v_nome end
   where empreendimento_id = p_emp and apontamento_id = p_apt and id = any(p_ids);
  perform cde_priv.apt_pend_concl(p_emp, p_apt);
  select count(*) into v_falta from apontamento_pendencia_auria
   where empreendimento_id = p_emp and apontamento_id = p_apt and estado = 'pendente';
  perform set_config('auria.pend_rpc', '1', true);
  if v_falta = 0 and v_status is distinct from 'Resolvido' then
    update apontamentos set status = 'Resolvido' where empreendimento_id = p_emp and id = p_apt;
  elsif v_falta > 0 and v_status = 'Resolvido' then
    update apontamentos set status = 'Em aberto' where empreendimento_id = p_emp and id = p_apt;
  end if;
  perform set_config('auria.pend_rpc', '', true);
  return v_falta;
end $$;

-- E-mail de cobrança: "falta em SB1, SB2" sob o título (só com mais de um local).
-- Edita a função viva por substituição de texto (três trechos), conferindo cada um.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cobranca_conjunto_html(uuid,text,text[],text,text)'::regprocedure);
  if position('falta em' in d) > 0 then return; end if;   -- já aplicado
  n := replace(d, $a$public.cob_data(p.value->>'prazo') prazo$a$,
    $b$public.cob_data(p.value->>'prazo') prazo,
             (select case when count(distinct pv.local_key) > 1 then
                       string_agg(distinct case when pv.estado='pendente' then coalesce(nullif(pv.pav,''),'prancha') end, ', ') end
                from public.apontamento_pendencia_auria pv
               where pv.empreendimento_id = a.empreendimento_id and pv.apontamento_id = a.id and pv.disciplina = p.key) locs$b$);
  if n = d then raise exception 'trecho 1 não encontrado'; end if; d := n;
  n := replace(d, $a$'prazo',b.prazo,$a$, $b$'prazo',b.prazo,'locs',b.locs,$b$);
  if n = d then raise exception 'trecho 2 não encontrado'; end if; d := n;
  n := replace(d, $a$public.auria_esc(coalesce(x->>'t',''))||'</td>'$a$,
    $b$public.auria_esc(coalesce(x->>'t',''))||coalesce('<br><span style="font-size:11px;color:#C2410C">falta em '||public.auria_esc(x->>'locs')||'</span>','')||'</td>'$b$);
  if n = d then raise exception 'trecho 3 não encontrado'; end if;
  execute n;
end $$;

-- Apontamentos que já existem: alinha a conclusão por disciplina com as pendências.
do $$ declare r record; begin
  for r in select empreendimento_id, id from apontamentos where empreendimento_id is not null loop
    perform cde_priv.apt_pend_concl(r.empreendimento_id, r.id);
  end loop;
end $$;

-- REVERSÃO: reaplicar supabase_apt_pendencias.sql (apt_pend_trg / apt_pend_marcar
-- da fase 2), recriar cobranca_conjunto_html sem a coluna locs e
-- drop function if exists cde_priv.apt_pend_concl(uuid, text);
