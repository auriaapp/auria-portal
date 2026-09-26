-- ============================================================================
--  Item 153 (parte 2) — as RPCs do Painel de Custos falam em disciplinas[]
--  Rodar DEPOIS de supabase_contrato_disciplinas.sql. Reaplicável.
--
--  fin_contrato_salvar passa a aceitar 'disciplinas' (lista) e continua
--  aceitando 'disciplina' (singular) de quem ainda não migrou — a tela velha
--  não quebra enquanto a nova não sobe.
--
--  Também passa a gravar fornecedor_id: sem ele, o gatilho que cria os vínculos
--  disciplina→fornecedor não tem em quem se pendurar, e o contrato continuaria
--  nascendo com as disciplinas "sem responsável".
-- ============================================================================

create or replace function public.fin_contrato_ler(p_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_grupo uuid := public.minha_empresa(); r jsonb;
begin
  if public.minha_role_auria() not in ('financeiro','gerente','super_admin') then raise exception 'Acesso restrito ao Painel de Custos.'; end if;
  select jsonb_build_object('id',ct.id,'empreendimento_id',ct.empreendimento_id,'projetista_email',ct.projetista_email,'projetista_nome',ct.projetista_nome,
           'disciplina',ct.disciplina,'disciplinas',coalesce(ct.disciplinas,array[ct.disciplina]),'numero',ct.numero,'objeto',ct.objeto,'valor_total',ct.valor_total,'data_assinatura',ct.data_assinatura,
           'data_inicio',ct.data_inicio,'data_fim',ct.data_fim,'status',ct.status,
           'parcelas', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'descricao',p.descricao,'valor',p.valor,'vencimento',p.vencimento,'status',p.status,
                                   'tem_nf', exists(select 1 from public.notas_fiscais_auria n where n.parcela_id = p.id and n.status <> 'cancelada')) order by p.numero)
                                  from public.parcelas_auria p where p.contrato_id = ct.id), '[]'::jsonb))
    into r
    from public.contratos_auria ct join public.empreendimentos_auria e on e.id = ct.empreendimento_id
   where ct.id = p_id and (public.minha_role_auria() = 'super_admin' or e.empresa_id = v_grupo);
  if r is null then raise exception 'Contrato não encontrado.'; end if;
  return r;
end $$;
grant execute on function public.fin_contrato_ler(uuid) to authenticated;

create or replace function public.fin_contrato_salvar(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_grupo uuid := public.minha_empresa(); v_id uuid; v_emp uuid; x jsonb; v_ids uuid[] := '{}'; v_pid uuid; v_soma numeric;
        v_discs text[];
begin
  if public.minha_role_auria() not in ('financeiro','super_admin') then raise exception 'Só o financeiro cadastra contratos aqui.'; end if;
  v_emp := (p->>'empreendimento_id')::uuid;
  if v_emp is null then raise exception 'Informe o empreendimento.'; end if;
  if not exists (select 1 from public.empreendimentos_auria e where e.id = v_emp and (public.minha_role_auria() = 'super_admin' or e.empresa_id = v_grupo)) then
    raise exception 'Empreendimento inválido.';
  end if;
  if nullif(trim(p->>'projetista_email'),'') is null then raise exception 'Informe o e-mail do fornecedor/projetista.'; end if;
  if coalesce((p->>'valor_total')::numeric,0) <= 0 then raise exception 'Informe o valor total do contrato.'; end if;
  if jsonb_array_length(coalesce(p->'parcelas','[]'::jsonb)) = 0 then raise exception 'Informe ao menos uma parcela.'; end if;
  select sum((e->>'valor')::numeric) into v_soma from jsonb_array_elements(p->'parcelas') e;
  if abs(coalesce(v_soma,0) - (p->>'valor_total')::numeric) > 0.05 then
    raise exception 'A soma das parcelas (%) difere do valor total (%).', v_soma, (p->>'valor_total')::numeric;
  end if;

  -- Item 153: o contrato pode cobrir VÁRIAS disciplinas. Aceita a lista nova e
  -- continua aceitando a singular de quem ainda não migrou.
  select coalesce(
           (select array_agg(distinct trim(d)) from jsonb_array_elements_text(p->'disciplinas') d
             where coalesce(trim(d),'') <> ''),
           case when coalesce(trim(p->>'disciplina'),'') <> '' then array[trim(p->>'disciplina')] end
         ) into v_discs;
  if v_discs is null or array_length(v_discs,1) is null then raise exception 'Informe ao menos uma disciplina.'; end if;

  v_id := (p->>'id')::uuid;
  if v_id is null then
    insert into public.contratos_auria(empreendimento_id, projetista_email, projetista_nome, disciplina, disciplinas, numero, objeto, valor_total,
                                       data_assinatura, data_inicio, data_fim, status, criado_por, fornecedor_id)
    values (v_emp, lower(trim(p->>'projetista_email')), nullif(trim(p->>'projetista_nome'),''), nullif(trim(p->>'disciplina'),''), v_discs,
            nullif(trim(p->>'numero'),''), nullif(trim(p->>'objeto'),''), (p->>'valor_total')::numeric,
            nullif(p->>'data_assinatura','')::date, nullif(p->>'data_inicio','')::date, nullif(p->>'data_fim','')::date,
            coalesce(nullif(p->>'status',''),'ativo'), auth.uid(), nullif(p->>'fornecedor_id','')::uuid)
    returning id into v_id;
  else
    if not exists (select 1 from public.contratos_auria ct join public.empreendimentos_auria e on e.id = ct.empreendimento_id
                    where ct.id = v_id and (public.minha_role_auria() = 'super_admin' or e.empresa_id = v_grupo)) then
      raise exception 'Contrato não encontrado.';
    end if;
    update public.contratos_auria set empreendimento_id = v_emp, projetista_email = lower(trim(p->>'projetista_email')),
           projetista_nome = nullif(trim(p->>'projetista_nome'),''), disciplinas = v_discs,
           fornecedor_id = coalesce(nullif(p->>'fornecedor_id','')::uuid, fornecedor_id),
           numero = nullif(trim(p->>'numero'),''), objeto = nullif(trim(p->>'objeto'),''), valor_total = (p->>'valor_total')::numeric,
           data_assinatura = nullif(p->>'data_assinatura','')::date, data_inicio = nullif(p->>'data_inicio','')::date, data_fim = nullif(p->>'data_fim','')::date,
           status = coalesce(nullif(p->>'status',''), status), atualizado_em = now()
     where id = v_id;
  end if;

  -- parcelas: cria/atualiza as enviadas; remove as que sumiram (só se ainda 'a_faturar' e sem NF)
  for x in select * from jsonb_array_elements(p->'parcelas') loop
    v_pid := nullif(x->>'id','')::uuid;
    if v_pid is not null and exists (select 1 from public.parcelas_auria q where q.id = v_pid and q.contrato_id = v_id) then
      update public.parcelas_auria set numero = (x->>'numero')::int, descricao = nullif(trim(x->>'descricao'),''),
             valor = case when status in ('faturada','paga') then valor else (x->>'valor')::numeric end,
             vencimento = nullif(x->>'vencimento','')::date
       where id = v_pid;
    else
      insert into public.parcelas_auria(contrato_id, numero, descricao, valor, vencimento, status)
      values (v_id, (x->>'numero')::int, nullif(trim(x->>'descricao'),''), (x->>'valor')::numeric, nullif(x->>'vencimento','')::date, 'a_faturar')
      returning id into v_pid;
    end if;
    v_ids := v_ids || v_pid;
  end loop;
  delete from public.parcelas_auria q where q.contrato_id = v_id and not (q.id = any(v_ids)) and q.status = 'a_faturar'
     and not exists (select 1 from public.notas_fiscais_auria n where n.parcela_id = q.id);
  return v_id;
end $$;
grant execute on function public.fin_contrato_salvar(jsonb) to authenticated;


select 'fin_contrato_salvar aceita disciplinas[]' as item,
       (exists (select 1 from pg_proc where proname='fin_contrato_salvar' and prosrc like '%v_discs%'))::text as valor
union all select 'fin_contrato_salvar grava fornecedor_id',
       (exists (select 1 from pg_proc where proname='fin_contrato_salvar' and prosrc like '%fornecedor_id%'))::text
union all select 'fin_contrato_ler devolve disciplinas[]',
       (exists (select 1 from pg_proc where proname='fin_contrato_ler' and prosrc like '%disciplinas%'))::text;
