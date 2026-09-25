-- ============================================================================
--  Item 121 (parte B) — o escopo do adm-fin passa a VALER (2026-09-24)
--  Rodar no SQL Editor do Supabase (depois de supabase_gestao_usuarios.sql).
--
--  O recorte é aplicado no SERVIDOR, dentro das mesmas RPCs que o Painel de
--  Custos já usa (nf_listar e fin_contratos) — filtrar só na tela seria
--  aparência de restrição, não restrição.
--
--  Sem nenhuma linha em financeiro_escopo_auria, nada muda: o usuário continua
--  vendo o grupo inteiro. Gerente, super_admin e analista não são afetados.
-- ============================================================================

-- Este usuário (quando é do financeiro com recorte) enxerga este empreendimento?
create or replace function public.financeiro_ve(p_emp uuid, p_constr uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case when public.minha_role_auria() <> 'financeiro' then true
         when not exists (select 1 from public.financeiro_escopo_auria fe where fe.usuario_id = auth.uid()) then true
         else exists (
           select 1 from public.financeiro_escopo_auria fe
            where fe.usuario_id = auth.uid()
              and ( (fe.empreendimento_id is not null and fe.empreendimento_id = p_emp)
                 or (fe.construtora_id  is not null and fe.construtora_id  = coalesce(
                        p_constr, (select e.construtora_id from public.empreendimentos_auria e where e.id = p_emp))) ))
    end;
$$;
grant execute on function public.financeiro_ve(uuid, uuid) to authenticated;

-- ── nf_listar: mesma função, com o recorte do financeiro ────────────────────
drop function if exists public.nf_listar(uuid, text);
create function public.nf_listar(
  p_empreendimento_id uuid default null, p_status text default null)
returns table(
  id uuid, empreendimento text, disciplina text, projetista text,
  parcela_numero int, nf_numero text, valor numeric, status text,
  emitida_em date, criado_em timestamptz, pdf_path text, construtora text,
  parcela_id uuid, contrato_id uuid, empreendimento_id uuid,
  origem text, fornecedor_cnpj text, construtora_id uuid, janela_id uuid, conteudo text, parcela_txt text)
language plpgsql security definer stable set search_path = public, extensions as $$
begin
  if public.minha_role_auria() not in ('financeiro','gerente','super_admin','analista') then
    raise exception 'Acesso restrito ao Painel de Custos.';
  end if;
  return query
    select n.id, coalesce(e.nome, '— sem empreendimento —'), n.disciplina,
           coalesce(n.projetista_nome, n.projetista_email),
           p.numero,
           pgp_sym_decrypt(n.nf_numero_enc, public.nf_key()),
           pgp_sym_decrypt(n.valor_enc, public.nf_key())::numeric,
           n.status, n.emitida_em, n.criado_em, n.pdf_path,
           coalesce(c.nome, c2.nome), n.parcela_id, n.contrato_id, n.empreendimento_id,
           n.origem, n.fornecedor_cnpj, coalesce(n.construtora_id, e.construtora_id), n.janela_id, n.conteudo, n.parcela_txt
    from public.notas_fiscais_auria n
    left join public.empreendimentos_auria e on e.id = n.empreendimento_id
    left join public.construtoras_auria c on c.id = e.construtora_id
    left join public.construtoras_auria c2 on c2.id = n.construtora_id
    left join public.parcelas_auria p on p.id = n.parcela_id
    where (public.minha_role_auria() = 'super_admin' or n.empresa_id = public.minha_empresa())
      and (public.minha_role_auria() <> 'analista'
           or exists (select 1 from public.analista_empreendimento_auria ae
                      where ae.analista_id = auth.uid() and ae.ativo = true
                        and ae.empreendimento_id = n.empreendimento_id))
      -- item 121B: recorte do administrativo financeiro (vazio = tudo)
      and public.financeiro_ve(n.empreendimento_id, coalesce(n.construtora_id, e.construtora_id))
      and (p_empreendimento_id is null or n.empreendimento_id = p_empreendimento_id)
      and (p_status is null or n.status = p_status)
    order by n.criado_em desc;
end $$;
grant execute on function public.nf_listar(uuid,text) to authenticated;

-- ── fin_contratos: idem ─────────────────────────────────────────────────────
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
      and public.financeiro_ve(e.id, e.construtora_id)          -- item 121B
      and (p_empreendimento_id is null or ct.empreendimento_id = p_empreendimento_id)
    order by e.nome, ct.disciplina;
end $$;
grant execute on function public.fin_contratos(uuid) to authenticated;

-- Resumo do recorte para a tela avisar o usuário (vazio = grupo inteiro).
create or replace function public.financeiro_meu_escopo()
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'tem_recorte', exists (select 1 from public.financeiro_escopo_auria fe where fe.usuario_id = auth.uid()),
    'construtoras', coalesce((select jsonb_agg(c.nome order by c.nome)
                                from public.financeiro_escopo_auria fe
                                join public.construtoras_auria c on c.id = fe.construtora_id
                               where fe.usuario_id = auth.uid()), '[]'::jsonb),
    'empreendimentos', coalesce((select jsonb_agg(coalesce(e.codigo, e.nome) order by e.nome)
                                   from public.financeiro_escopo_auria fe
                                   join public.empreendimentos_auria e on e.id = fe.empreendimento_id
                                  where fe.usuario_id = auth.uid()), '[]'::jsonb));
$$;
grant execute on function public.financeiro_meu_escopo() to authenticated;

select 'financeiro_ve' as item, exists(select 1 from pg_proc where proname='financeiro_ve') as ok
union all select 'nf_listar (recorte)', exists(select 1 from pg_proc where proname='nf_listar')
union all select 'fin_contratos (recorte)', exists(select 1 from pg_proc where proname='fin_contratos')
union all select 'financeiro_meu_escopo', exists(select 1 from pg_proc where proname='financeiro_meu_escopo');
