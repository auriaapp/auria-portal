-- ============================================================================
--  Item 121 — página USUÁRIOS por tipo, na gestão (2026-09-24)
--  Rodar no SQL Editor do Supabase.
--
--  "Quem é o quê" está espalhado por três lugares (usuarios_auria.role,
--  analista_empreendimento_auria e a matriz de acessos do CDE) — e assim deve
--  continuar: esta RPC só REÚNE para a tela, sem criar uma quarta verdade.
--
--  Tipos devolvidos: gestor · analista · financeiro · setor (cliente interno /
--  equipe de obra) · fornecedor · convite (ainda não aceito).
--
--  Acrescenta também o ESCOPO do adm-fin (financeiro_escopo_auria): por empresa
--  e/ou por empreendimento. Sem nenhuma linha, o financeiro enxerga o grupo
--  inteiro — como hoje; com linhas, passa a ser o recorte dele.
-- ============================================================================

create table if not exists public.financeiro_escopo_auria (
  id                uuid primary key default gen_random_uuid(),
  usuario_id        uuid not null references public.usuarios_auria(id) on delete cascade,
  empresa_id        uuid not null references public.empresas_auria(id) on delete cascade,   -- grupo (tenant)
  construtora_id    uuid references public.construtoras_auria(id) on delete cascade,
  empreendimento_id uuid references public.empreendimentos_auria(id) on delete cascade,
  criado_por        uuid,
  criado_em         timestamptz default now(),
  constraint fin_escopo_alvo_chk check (construtora_id is not null or empreendimento_id is not null)
);
create index if not exists idx_fin_escopo_usr on public.financeiro_escopo_auria(usuario_id);
create unique index if not exists uq_fin_escopo_constr on public.financeiro_escopo_auria(usuario_id, construtora_id)
  where construtora_id is not null and empreendimento_id is null;
create unique index if not exists uq_fin_escopo_emp on public.financeiro_escopo_auria(usuario_id, empreendimento_id)
  where empreendimento_id is not null;

alter table public.financeiro_escopo_auria enable row level security;
drop policy if exists finesc_gestao on public.financeiro_escopo_auria;
create policy finesc_gestao on public.financeiro_escopo_auria for all
  using (empresa_id = public.minha_empresa() and public.minha_role_auria() in ('gerente','super_admin'))
  with check (empresa_id = public.minha_empresa() and public.minha_role_auria() in ('gerente','super_admin'));
drop policy if exists finesc_proprio on public.financeiro_escopo_auria;
create policy finesc_proprio on public.financeiro_escopo_auria for select
  using (usuario_id = auth.uid());
grant select, insert, delete on public.financeiro_escopo_auria to authenticated;
revoke all on public.financeiro_escopo_auria from anon;

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
  -- Setores / clientes internos e equipe de obra (linha na matriz do CDE)
  select 'setor'::text, u.id, u.nome, u.email,
         (select ob.nivel from public.obra_empreendimento_auria ob
           where ob.usuario_id = u.id and coalesce(ob.ativo,true) limit 1),
         coalesce(u.ativo,true), u.ultimo_acesso, u.criado_em,
         jsonb_build_object(
           'empreendimentos',
           coalesce((select jsonb_agg(distinct jsonb_build_object('id', e.id, 'nome', e.nome, 'sigla', e.codigo))
                       from public.cde_acesso_auria a
                       join public.empreendimentos_auria e on e.id = a.empreendimento_id
                      where a.usuario_id = u.id and e.empresa_id = v_grp), '[]'::jsonb),
           'disciplinas',
           coalesce((select jsonb_agg(distinct x) from public.cde_acesso_auria a2, unnest(a2.disciplinas) x
                      where a2.usuario_id = u.id), '[]'::jsonb))
    from public.usuarios_auria u
   where u.empresa_id = v_grp
     and u.role not in ('gerente','super_admin','analista','financeiro')
     and exists (select 1 from public.cde_acesso_auria a
                  join public.empreendimentos_auria e on e.id = a.empreendimento_id
                 where a.usuario_id = u.id and e.empresa_id = v_grp)

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

-- ── Escopo do adm-fin: definir (substitui o conjunto do usuário) ────────────
create or replace function public.financeiro_escopo_set(p_usuario uuid, p_construtoras uuid[], p_empreendimentos uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_grp uuid := public.minha_empresa(); v_n int := 0;
begin
  if public.minha_role_auria() not in ('gerente','super_admin') then raise exception 'Só a gestão define o escopo do financeiro.'; end if;
  if not exists (select 1 from public.usuarios_auria u where u.id = p_usuario and u.empresa_id = v_grp and u.role = 'financeiro') then
    raise exception 'Usuário não é do financeiro deste grupo.';
  end if;
  delete from public.financeiro_escopo_auria where usuario_id = p_usuario;
  insert into public.financeiro_escopo_auria(usuario_id, empresa_id, construtora_id, criado_por)
    select p_usuario, v_grp, c.id, auth.uid() from public.construtoras_auria c
     where c.id = any(coalesce(p_construtoras,'{}')) and c.grupo_id = v_grp;
  get diagnostics v_n = row_count;
  insert into public.financeiro_escopo_auria(usuario_id, empresa_id, empreendimento_id, criado_por)
    select p_usuario, v_grp, e.id, auth.uid() from public.empreendimentos_auria e
     where e.id = any(coalesce(p_empreendimentos,'{}')) and e.empresa_id = v_grp;
  return jsonb_build_object('ok', true, 'construtoras', v_n,
                            'empreendimentos', coalesce(array_length(p_empreendimentos,1),0));
end $$;
grant execute on function public.financeiro_escopo_set(uuid, uuid[], uuid[]) to authenticated;

-- Empreendimentos que ESTE financeiro enxerga (vazio no escopo = todos do grupo).
create or replace function public.financeiro_meus_emps()
returns setof uuid language sql security definer stable set search_path = public as $$
  select e.id from public.empreendimentos_auria e
   where e.empresa_id = public.minha_empresa()
     and (
       not exists (select 1 from public.financeiro_escopo_auria fe where fe.usuario_id = auth.uid())
       or exists (select 1 from public.financeiro_escopo_auria fe
                   where fe.usuario_id = auth.uid()
                     and (fe.empreendimento_id = e.id or fe.construtora_id = e.construtora_id))
     );
$$;
grant execute on function public.financeiro_meus_emps() to authenticated;

select 'financeiro_escopo_auria' as item,
       exists(select 1 from information_schema.tables where table_name='financeiro_escopo_auria') as ok
union all select 'gestao_usuarios_do_grupo', exists(select 1 from pg_proc where proname='gestao_usuarios_do_grupo')
union all select 'financeiro_escopo_set', exists(select 1 from pg_proc where proname='financeiro_escopo_set')
union all select 'financeiro_meus_emps', exists(select 1 from pg_proc where proname='financeiro_meus_emps');
