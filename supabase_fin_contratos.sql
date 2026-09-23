-- ============================================================================
--  Adm-fin cadastra contratos (2026-09-21) — item 40 fase 2b
--  Rodar no SQL Editor do Supabase.
--
--  O financeiro cadastra o contrato (fornecedor, empreendimento, disciplina,
--  valor total, parcelas em %) e só então consegue vincular as NFs que chegam
--  pelo link público. Mesmas tabelas do analista (contratos_auria/parcelas_auria):
--  o fluxo solicitar → coordenador autoriza → NF continua igual.
--
--  • fin_cadastro_base()        → empreendimentos, fornecedores (+projetistas) e disciplinas do grupo
--  • fin_contrato_ler(id)       → cabeçalho + parcelas (p/ editar)
--  • fin_contrato_salvar(jsonb) → cria/edita; parcelas faturadas/pagas não são alteradas
-- ============================================================================

create or replace function public.fin_cadastro_base()
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_grupo uuid := public.minha_empresa();
begin
  if public.minha_role_auria() not in ('financeiro','gerente','super_admin') then raise exception 'Acesso restrito ao Painel de Custos.'; end if;
  return jsonb_build_object(
    'empreendimentos', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'nome',e.nome,'codigo',e.codigo,'construtora',c.nome,'construtora_id',e.construtora_id) order by e.nome)
                                   from public.empreendimentos_auria e left join public.construtoras_auria c on c.id = e.construtora_id
                                  where e.empresa_id = v_grupo and e.deleted_at is null), '[]'::jsonb),
    'fornecedores', coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'nome',f.nome,'cnpj',f.cnpj,'email',f.email_contato,'disciplinas',f.disciplinas,
                                 'projetistas', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'email',p.email,'disciplinas',p.disciplinas) order by p.nome)
                                                            from public.projetistas_auria p where p.fornecedor_id = f.id and coalesce(p.ativo,true)), '[]'::jsonb)) order by f.nome)
                                from public.fornecedores_auria f where f.empresa_id = v_grupo), '[]'::jsonb),
    'disciplinas', coalesce((select jsonb_agg(distinct d order by d) from (
                       select ct.disciplina as d from public.contratos_auria ct join public.empreendimentos_auria e on e.id = ct.empreendimento_id where e.empresa_id = v_grupo and ct.disciplina is not null
                       union select n.disciplina from public.notas_fiscais_auria n where n.empresa_id = v_grupo and n.disciplina is not null
                       union select unnest(f.disciplinas) from public.fornecedores_auria f where f.empresa_id = v_grupo) s), '[]'::jsonb));
end $$;
grant execute on function public.fin_cadastro_base() to authenticated;

create or replace function public.fin_contrato_ler(p_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_grupo uuid := public.minha_empresa(); r jsonb;
begin
  if public.minha_role_auria() not in ('financeiro','gerente','super_admin') then raise exception 'Acesso restrito ao Painel de Custos.'; end if;
  select jsonb_build_object('id',ct.id,'empreendimento_id',ct.empreendimento_id,'projetista_email',ct.projetista_email,'projetista_nome',ct.projetista_nome,
           'disciplina',ct.disciplina,'numero',ct.numero,'objeto',ct.objeto,'valor_total',ct.valor_total,'data_assinatura',ct.data_assinatura,
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

-- p: {id?, empreendimento_id, projetista_email, projetista_nome, disciplina, numero, objeto, valor_total,
--     data_assinatura, data_inicio, data_fim, status, parcelas:[{id?, numero, descricao, valor, vencimento}]}
create or replace function public.fin_contrato_salvar(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_grupo uuid := public.minha_empresa(); v_id uuid; v_emp uuid; x jsonb; v_ids uuid[] := '{}'; v_pid uuid; v_soma numeric;
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

  v_id := (p->>'id')::uuid;
  if v_id is null then
    insert into public.contratos_auria(empreendimento_id, projetista_email, projetista_nome, disciplina, numero, objeto, valor_total,
                                       data_assinatura, data_inicio, data_fim, status, criado_por)
    values (v_emp, lower(trim(p->>'projetista_email')), nullif(trim(p->>'projetista_nome'),''), nullif(trim(p->>'disciplina'),''),
            nullif(trim(p->>'numero'),''), nullif(trim(p->>'objeto'),''), (p->>'valor_total')::numeric,
            nullif(p->>'data_assinatura','')::date, nullif(p->>'data_inicio','')::date, nullif(p->>'data_fim','')::date,
            coalesce(nullif(p->>'status',''),'ativo'), auth.uid())
    returning id into v_id;
  else
    if not exists (select 1 from public.contratos_auria ct join public.empreendimentos_auria e on e.id = ct.empreendimento_id
                    where ct.id = v_id and (public.minha_role_auria() = 'super_admin' or e.empresa_id = v_grupo)) then
      raise exception 'Contrato não encontrado.';
    end if;
    update public.contratos_auria set empreendimento_id = v_emp, projetista_email = lower(trim(p->>'projetista_email')),
           projetista_nome = nullif(trim(p->>'projetista_nome'),''), disciplina = nullif(trim(p->>'disciplina'),''),
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

select 'fin_cadastro_base' as item, exists(select 1 from pg_proc where proname='fin_cadastro_base') as ok
union all select 'fin_contrato_ler', exists(select 1 from pg_proc where proname='fin_contrato_ler')
union all select 'fin_contrato_salvar', exists(select 1 from pg_proc where proname='fin_contrato_salvar');
