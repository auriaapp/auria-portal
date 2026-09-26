-- ============================================================================
--  Item 131 — lentidão do Painel de Custos (2026-09-26). Rodar no SQL Editor.
--  Reaplicável. NÃO muda o que ninguém vê: mesma assinatura, mesmas colunas,
--  mesmas regras de acesso. Só para de repetir trabalho idêntico por linha.
--
--  MEDIDO ANTES DE MEXER (sua consulta de 26/09):
--      nf_listar      -> nf_key() 2x   minha_role_auria() 3x   minha_empresa() 1x
--      fin_contratos  -> nf_key() 0x   minha_role_auria() 2x   minha_empresa() 1x
--      nf_bi          -> nf_key() 1x   minha_role_auria() 2x   minha_empresa() 1x
--
--  POR QUE ISSO CUSTA CARO: função `stable` no SELECT ou no WHERE é avaliada
--  LINHA A LINHA. nf_key() lê vault.decrypted_secrets (descriptografia), e
--  minha_role_auria()/minha_empresa() vão ao banco. Com N notas, eram ~2N
--  leituras do Vault + ~3N consultas de papel para produzir N linhas — sendo
--  que a chave e o papel são os MESMOS em todas elas.
--
--  A CORREÇÃO: ler cada um UMA vez em variável local. É tudo.
--
--  O SEGUNDO GANHO (financeiro_ve): ela devolve TRUE sempre que o papel não é
--  'financeiro' ou o usuário não tem recorte. Para gerente, analista e
--  super_admin era chamada uma vez por linha para sempre responder a mesma
--  coisa — e cada chamada faz mais um minha_role_auria() e até dois exists.
--  Agora a pergunta "tem recorte?" é resolvida uma vez, e a chamada só
--  sobrevive para o financeiro COM recorte. A regra continua morando dentro
--  de financeiro_ve(); não foi copiada para cá, para não criar duas verdades.
--
--  DE QUEBRA, DUAS CORREÇÕES DE SEGURANÇA (não são otimização):
--   . fin_contratos e nf_bi eram SECURITY DEFINER **sem search_path fixo** —
--     o vetor clássico de escalada de privilégio (quem chama escolheria de
--     qual esquema vêm as funções que elas usam). Agora travado, como
--     nf_listar já tinha.
--   . nf_bi usava pgp_sym_decrypt sem garantir o esquema 'extensions'.
--     Funcionava por sorte do search_path padrão do projeto.
--   . PAPEL NULO passava pela porta. `NULL not in ('financeiro',...)` é NULL, e
--     `if NULL then` é FALSO — logo a exceção nunca era levantada para quem
--     está autenticado mas não tem linha em usuarios_auria. Em nf_listar e
--     fin_contratos isso não vazava por acidente (o NULL derrubava o WHERE em
--     `empresa_id = NULL`), mas em nf_bi vazava DE VERDADE: emp_scope ficava
--     nulo e `(emp_scope is null or ...)` liberava TODAS as linhas — totais de
--     notas fiscais de todos os grupos, para qualquer conta autenticada.
--     Agora as três usam coalesce(v_role,'') e a porta fecha.
--
--  Uso 'create or replace' de propósito: ele PRESERVA os grants e FALHA em voz
--  alta se eu tiver errado qualquer coluna de retorno, em vez de trocar o
--  contrato em silêncio.
-- ============================================================================

-- ── nf_listar ───────────────────────────────────────────────────────────────
create or replace function public.nf_listar(
  p_empreendimento_id uuid default null, p_status text default null)
returns table(
  id uuid, empreendimento text, disciplina text, projetista text,
  parcela_numero int, nf_numero text, valor numeric, status text,
  emitida_em date, criado_em timestamptz, pdf_path text, construtora text,
  parcela_id uuid, contrato_id uuid, empreendimento_id uuid,
  origem text, fornecedor_cnpj text, construtora_id uuid, janela_id uuid, conteudo text, parcela_txt text)
language plpgsql security definer stable set search_path = public, extensions as $$
declare
  v_role text := public.minha_role_auria();
  v_emp  uuid := public.minha_empresa();
  v_uid  uuid := auth.uid();
  v_key  text;
  v_fin_restrito boolean;
begin
  if coalesce(v_role,'') not in ('financeiro','gerente','super_admin','analista') then
    raise exception 'Acesso restrito ao Painel de Custos.';
  end if;
  v_key := public.nf_key();                      -- UMA leitura do Vault, não 2N
  v_fin_restrito := (v_role = 'financeiro')
                    and exists (select 1 from public.financeiro_escopo_auria fe
                                 where fe.usuario_id = v_uid);
  return query
    select n.id, coalesce(e.nome, '— sem empreendimento —'), n.disciplina,
           coalesce(n.projetista_nome, n.projetista_email),
           p.numero,
           pgp_sym_decrypt(n.nf_numero_enc, v_key),
           pgp_sym_decrypt(n.valor_enc, v_key)::numeric,
           n.status, n.emitida_em, n.criado_em, n.pdf_path,
           coalesce(c.nome, c2.nome), n.parcela_id, n.contrato_id, n.empreendimento_id,
           n.origem, n.fornecedor_cnpj, coalesce(n.construtora_id, e.construtora_id), n.janela_id, n.conteudo, n.parcela_txt
    from public.notas_fiscais_auria n
    left join public.empreendimentos_auria e on e.id = n.empreendimento_id
    left join public.construtoras_auria c on c.id = e.construtora_id
    left join public.construtoras_auria c2 on c2.id = n.construtora_id
    left join public.parcelas_auria p on p.id = n.parcela_id
    where (v_role = 'super_admin' or n.empresa_id = v_emp)
      and (v_role <> 'analista'
           or exists (select 1 from public.analista_empreendimento_auria ae
                      where ae.analista_id = v_uid and ae.ativo = true
                        and ae.empreendimento_id = n.empreendimento_id))
      -- item 121B: recorte do administrativo financeiro (vazio = tudo)
      and (not v_fin_restrito
           or public.financeiro_ve(n.empreendimento_id, coalesce(n.construtora_id, e.construtora_id)))
      and (p_empreendimento_id is null or n.empreendimento_id = p_empreendimento_id)
      and (p_status is null or n.status = p_status)
    order by n.criado_em desc;
end $$;
grant execute on function public.nf_listar(uuid,text) to authenticated;


-- ── fin_contratos ───────────────────────────────────────────────────────────
create or replace function public.fin_contratos(p_empreendimento_id uuid default null)
returns table(
  contrato_id uuid, empreendimento_id uuid, empreendimento text, construtora text,
  disciplina text, objeto text, numero text, projetista text,
  valor_total numeric, parcelas jsonb)
language plpgsql security definer stable set search_path = public as $$
declare
  v_role text := public.minha_role_auria();
  v_emp  uuid := public.minha_empresa();
  v_uid  uuid := auth.uid();
  v_fin_restrito boolean;
begin
  if coalesce(v_role,'') not in ('financeiro','gerente','super_admin') then
    raise exception 'Acesso restrito ao Painel de Custos.';
  end if;
  v_fin_restrito := (v_role = 'financeiro')
                    and exists (select 1 from public.financeiro_escopo_auria fe
                                 where fe.usuario_id = v_uid);
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
    where (v_role = 'super_admin' or e.empresa_id = v_emp)
      and (not v_fin_restrito or public.financeiro_ve(e.id, e.construtora_id))   -- item 121B
      and (p_empreendimento_id is null or ct.empreendimento_id = p_empreendimento_id)
    order by e.nome, ct.disciplina;
end $$;
grant execute on function public.fin_contratos(uuid) to authenticated;


-- ── nf_bi ───────────────────────────────────────────────────────────────────
create or replace function public.nf_bi(
  p_de date default (date_trunc('month', now()))::date,
  p_ate date default (now())::date)
returns jsonb
language plpgsql security definer stable set search_path = public, extensions as $$
declare emp_scope uuid; total_n int; total_v numeric; por_emp jsonb; por_disc jsonb; por_mes jsonb;
        v_role text := public.minha_role_auria();
        v_key  text;
begin
  if coalesce(v_role,'') not in ('financeiro','gerente','super_admin') then
    raise exception 'Acesso restrito ao Painel de Custos.';
  end if;
  emp_scope := case when v_role = 'super_admin' then null else public.minha_empresa() end;
  v_key     := public.nf_key();

  with base as (
    select n.*, pgp_sym_decrypt(n.valor_enc, v_key)::numeric as valor,
           e.nome as emp_nome
    from public.notas_fiscais_auria n
    join public.empreendimentos_auria e on e.id = n.empreendimento_id
    where (emp_scope is null or n.empresa_id = emp_scope)
      and n.criado_em::date between p_de and p_ate
  )
  select count(*), coalesce(sum(valor),0) into total_n, total_v from base;

  select coalesce(jsonb_agg(x order by x->>'valor' desc),'[]') into por_emp from (
    select jsonb_build_object('nome',emp_nome,'n',count(*),'valor',coalesce(sum(valor),0)) x
    from base group by emp_nome) q;

  select coalesce(jsonb_agg(x),'[]') into por_disc from (
    select jsonb_build_object('nome',coalesce(disciplina,'—'),'n',count(*),'valor',coalesce(sum(valor),0)) x
    from base group by disciplina) q;

  select coalesce(jsonb_agg(x order by x->>'mes'),'[]') into por_mes from (
    select jsonb_build_object('mes',to_char(criado_em,'YYYY-MM'),'n',count(*),'valor',coalesce(sum(valor),0)) x
    from base group by to_char(criado_em,'YYYY-MM')) q;

  return jsonb_build_object('de',p_de,'ate',p_ate,'total_notas',total_n,'total_valor',total_v,
                            'por_empreendimento',por_emp,'por_disciplina',por_disc,'por_mes',por_mes);
end $$;
grant execute on function public.nf_bi(date,date) to authenticated;


-- ── conferência (honesta como serviço: só estrutura e contagem de código) ───
select p.proname,
       (length(p.prosrc)-length(replace(p.prosrc,'nf_key()','')))/length('nf_key()')                     as chamadas_nf_key,
       (length(p.prosrc)-length(replace(p.prosrc,'minha_role_auria()','')))/length('minha_role_auria()') as chamadas_role,
       (length(p.prosrc)-length(replace(p.prosrc,'minha_empresa()','')))/length('minha_empresa()')       as chamadas_empresa,
       coalesce(array_to_string(p.proconfig,', '),'(SEM search_path!)')                                  as search_path
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('nf_listar','fin_contratos','nf_bi')
 order by 1;
-- Esperado: cada uma com nf_key/role/empresa no MÁXIMO 1 (a atribuição), e as
-- três com search_path travado. Antes: nf_listar tinha 2/3/1, e fin_contratos
-- e nf_bi estavam SEM search_path.
