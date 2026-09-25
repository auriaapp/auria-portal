-- ============================================================================
--  Itens 127 e 129 — usuários de SETOR e OBRA aparecendo na lista (2026-09-24)
--  Rodar no SQL Editor do Supabase.
--
--  Dois defeitos achados ao construir o "+ Adicionar usuário":
--
--  1) invite-setor e invite-obra criavam o perfil SEM empresa_id. Como
--     gestao_usuarios_do_grupo filtra por empresa_id, essas pessoas existiam,
--     acessavam o CDE — e não apareciam em lugar nenhum na gestão. A Edge
--     Function já foi corrigida (passa a gravar o grupo de quem convida);
--     aqui fica o backfill de quem foi criado antes.
--
--  2) A equipe de OBRA nunca aparecia: a consulta exigia linha em
--     cde_acesso_auria, e invite-obra só escreve obra_empreendimento_auria.
--     A função abaixo passa a aceitar as DUAS origens.
--
--  Nada é apagado: o backfill só preenche empresa_id que estava nulo.
-- ============================================================================

-- ── 1. Backfill do grupo, a partir dos empreendimentos a que a pessoa já
--       tem acesso. Quem tiver acesso a empreendimentos de grupos diferentes
--       (não deveria acontecer) fica de fora de propósito, para não chutar.
with origem as (
  select u.id as usuario_id, min(e.empresa_id::text)::uuid as empresa_id,
         count(distinct e.empresa_id) as n_grupos
    from public.usuarios_auria u
    join public.empreendimentos_auria e
      on exists (select 1 from public.cde_acesso_auria a
                  where a.usuario_id = u.id and a.empreendimento_id = e.id)
      or exists (select 1 from public.obra_empreendimento_auria ob
                  where ob.usuario_id = u.id and ob.empreendimento_id = e.id
                    and coalesce(ob.ativo,true))
   where u.empresa_id is null
     and u.role in ('setor','obra')
   group by u.id
)
update public.usuarios_auria u
   set empresa_id = o.empresa_id
  from origem o
 where u.id = o.usuario_id and o.n_grupos = 1;

-- ── 2. A lista de usuários passa a enxergar a equipe de obra ───────────────
-- ── A tela: todos os usuários do grupo, com tipo e escopo resumido ──────────
create or replace function public.gestao_usuarios_do_grupo()
returns table(
  tipo         text,      -- gestor | analista | financeiro | setor | fornecedor | convite
  sujeito_id   uuid,
  nome         text,
  email        text,
  papel        text,      -- coordenador/visualizador (analista) · nível (obra) · role
  ativo        boolean,
  ultimo_acesso timestamptz,
  criado_em    timestamptz,
  escopo       jsonb      -- {empreendimentos:[{id,nome,papel}], construtoras:[…], disciplinas:[…], total:n}
)
language plpgsql security definer stable set search_path = public as $$
declare v_grp uuid := public.minha_empresa();
begin
  if public.minha_role_auria() not in ('gerente','super_admin') then
    raise exception 'Acesso restrito à gestão.';
  end if;

  return query
  -- Gestores do grupo
  select 'gestor'::text, u.id, u.nome, u.email, u.role, coalesce(u.ativo,true), u.ultimo_acesso, u.criado_em,
         jsonb_build_object('total', (select count(*) from public.empreendimentos_auria e
                                       where e.empresa_id = v_grp and e.deleted_at is null))
    from public.usuarios_auria u
   where u.empresa_id = v_grp and u.role in ('gerente','super_admin')

  union all
  -- Analistas, com os empreendimentos e o papel em cada um
  select 'analista'::text, u.id, u.nome, u.email, null, coalesce(u.ativo,true), u.ultimo_acesso, u.criado_em,
         jsonb_build_object(
           'empreendimentos',
           coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'sigla', e.codigo,
                                                         'papel', coalesce(ae.papel,'coordenador'))
                                      order by e.nome)
                       from public.analista_empreendimento_auria ae
                       join public.empreendimentos_auria e on e.id = ae.empreendimento_id
                      where ae.analista_id = u.id and coalesce(ae.ativo,true) and e.deleted_at is null), '[]'::jsonb))
    from public.usuarios_auria u
   where u.empresa_id = v_grp and u.role = 'analista'

  union all
  -- Administrativo financeiro, com o recorte (vazio = grupo inteiro)
  select 'financeiro'::text, u.id, u.nome, u.email, null, coalesce(u.ativo,true), u.ultimo_acesso, u.criado_em,
         jsonb_build_object(
           'construtoras',
           coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) order by c.nome)
                       from public.financeiro_escopo_auria fe
                       join public.construtoras_auria c on c.id = fe.construtora_id
                      where fe.usuario_id = u.id), '[]'::jsonb),
           'empreendimentos',
           coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'sigla', e.codigo) order by e.nome)
                       from public.financeiro_escopo_auria fe
                       join public.empreendimentos_auria e on e.id = fe.empreendimento_id
                      where fe.usuario_id = u.id), '[]'::jsonb))
    from public.usuarios_auria u
   where u.empresa_id = v_grp and u.role = 'financeiro'

  union all
  -- Setores / clientes internos e equipe de obra.
  --  · o SETOR entra pela matriz do CDE (cde_acesso_auria);
  --  · a OBRA entra por obra_empreendimento_auria e NUNCA ganha linha na
  --    matriz — invite-obra só cria o vínculo de obra. Enquanto esta consulta
  --    exigia a matriz, a equipe de obra inteira ficava fora da lista (item 129).
  -- O papel (nível de campo) continua sendo o que separa um do outro na tela.
  select 'setor'::text, u.id, u.nome, u.email,
         (select ob.nivel from public.obra_empreendimento_auria ob
           where ob.usuario_id = u.id and coalesce(ob.ativo,true) limit 1),
         coalesce(u.ativo,true), u.ultimo_acesso, u.criado_em,
         jsonb_build_object(
           'empreendimentos',
           coalesce((select jsonb_agg(distinct jsonb_build_object('id', e.id, 'nome', e.nome, 'sigla', e.codigo))
                       from public.empreendimentos_auria e
                      where e.empresa_id = v_grp and e.deleted_at is null
                        and (exists (select 1 from public.cde_acesso_auria a
                                      where a.usuario_id = u.id and a.empreendimento_id = e.id)
                          or exists (select 1 from public.obra_empreendimento_auria ob2
                                      where ob2.usuario_id = u.id and ob2.empreendimento_id = e.id
                                        and coalesce(ob2.ativo,true)))), '[]'::jsonb),
           'disciplinas',
           coalesce((select jsonb_agg(distinct x) from public.cde_acesso_auria a2, unnest(a2.disciplinas) x
                      where a2.usuario_id = u.id), '[]'::jsonb))
    from public.usuarios_auria u
   where u.empresa_id = v_grp
     and u.role not in ('gerente','super_admin','analista','financeiro')
     and (exists (select 1 from public.cde_acesso_auria a
                   join public.empreendimentos_auria e on e.id = a.empreendimento_id
                  where a.usuario_id = u.id and e.empresa_id = v_grp)
       or exists (select 1 from public.obra_empreendimento_auria ob
                   join public.empreendimentos_auria e on e.id = ob.empreendimento_id
                  where ob.usuario_id = u.id and coalesce(ob.ativo,true) and e.empresa_id = v_grp))

  union all
  -- Fornecedores (empresa), com empreendimentos e disciplinas que atendem
  select 'fornecedor'::text, f.id, f.nome, f.email_contato, null, true, null, f.criado_em,
         jsonb_build_object(
           'empreendimentos',
           coalesce((select jsonb_agg(distinct jsonb_build_object('id', e.id, 'nome', e.nome, 'sigla', e.codigo))
                       from public.disciplina_fornecedor_auria df
                       join public.empreendimentos_auria e on e.id = df.empreendimento_id
                      where df.fornecedor_id = f.id and e.empresa_id = v_grp), '[]'::jsonb),
           'disciplinas',
           coalesce((select jsonb_agg(distinct df2.disciplina)
                       from public.disciplina_fornecedor_auria df2
                       join public.empreendimentos_auria e2 on e2.id = df2.empreendimento_id
                      where df2.fornecedor_id = f.id and e2.empresa_id = v_grp), '[]'::jsonb),
           'pessoas',
           coalesce((select jsonb_agg(jsonb_build_object('nome', p.nome, 'email', p.email, 'rt', coalesce(p.eh_rt,false))
                                      order by p.nome)
                       from public.projetistas_auria p where p.fornecedor_id = f.id and coalesce(p.ativo,true)), '[]'::jsonb))
    from public.fornecedores_auria f
   where f.empresa_id = v_grp

  union all
  -- Convites ainda não aceitos
  select 'convite'::text, c.id, null, c.email, c.role, not coalesce(c.aceito,false), null, c.criado_em,
         jsonb_build_object('expira_em', c.expira_em)
    from public.convites_auria c
   where c.empresa_id = v_grp and not coalesce(c.aceito,false)
     and not exists (select 1 from public.usuarios_auria u2
                      where lower(u2.email) = lower(c.email) and u2.empresa_id = v_grp);
end $$;
grant execute on function public.gestao_usuarios_do_grupo() to authenticated;

-- Conferência: quantos setor/obra ainda estão sem grupo (ideal: 0) e quantos
-- da obra a lista já enxerga.
select 'setor/obra sem empresa_id' as item, count(*)::text as valor
  from public.usuarios_auria where empresa_id is null and role in ('setor','obra')
union all
select 'usuarios com vinculo de obra', count(distinct usuario_id)::text
  from public.obra_empreendimento_auria where coalesce(ativo,true);
