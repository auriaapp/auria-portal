-- ═══════════════════════════════════════════════════════════════════════════
-- Item 111 (2026-11-15): compartilhar análise com PROJETISTAS ESCOLHIDOS.
-- Decidido (mockups/app_analises_compartilhar_v2.html):
--   • a faixa "Projeto" passa a significar "Projetistas escolhidos": coordenação +
--     só as PESSOAS marcadas pelo dono (lista por pessoa, não por disciplina);
--   • "Todos os projetistas do empreendimento" é uma chave (todos_projetistas),
--     desligada por padrão, e inclui quem for designado depois;
--   • só o dono da análise muda faixa e lista; o projetista não vê a lista;
--   • Público continua para todos (o setor não entra no App da coordenação).
-- As 13 análises existentes são 'privada' → ninguém ganha nem perde acesso.
-- REVERSÃO no fim (comentada).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.analises_auria add column if not exists todos_projetistas boolean not null default false;

create table if not exists public.analise_compartilha_auria (
  analise_id    uuid not null references public.analises_auria(id) on delete cascade,
  projetista_id uuid not null references public.projetistas_auria(id) on delete cascade,
  incluido_por  uuid default auth.uid(),
  incluido_em   timestamptz not null default now(),
  primary key (analise_id, projetista_id)
);
create index if not exists analise_comp_pj_idx on public.analise_compartilha_auria(projetista_id);
alter table public.analise_compartilha_auria enable row level security;
-- Lê a lista: o dono e a coordenação do empreendimento. Projetista não vê quem mais recebeu.
create policy analise_comp_sel on public.analise_compartilha_auria for select to authenticated
  using (exists (select 1 from public.analises_auria a where a.id = analise_compartilha_auria.analise_id
                  and (a.criado_por = auth.uid() or public.estacao_pode(a.empreendimento_id))));
-- Sem política de escrita: só pela RPC analise_compartilhar.
revoke all on table public.analise_compartilha_auria from anon;

-- Regra de leitura nova (fora da API, como os demais helpers de RLS).
create or replace function cde_priv.analise_ve2(p_id uuid, p_emp uuid, p_vis text, p_dono uuid, p_todos boolean)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_dono = auth.uid()
      or (p_vis in ('Coordenação','Projeto') and estacao_pode(p_emp))
      or (p_vis = 'Projeto' and (
            (coalesce(p_todos,false) and apt_sou_fornecedor_emp(p_emp))
         or exists (select 1 from analise_compartilha_auria c
                      join projetistas_auria pr on pr.id = c.projetista_id
                     where c.analise_id = p_id and coalesce(pr.ativo,true)
                       and lower(pr.email) = lower(coalesce(auth.jwt()->>'email','-'))
                       and pj_ve_emp(p_emp, pr.fornecedor_id))))
      or (p_vis = 'Público' and apt_tem_acesso_emp(p_emp));
$$;
alter policy analises_faixa_sel   on public.analises_auria using (cde_priv.analise_ve2(id, empreendimento_id, visibilidade, criado_por, todos_projetistas));
alter policy analises_faixa_restr on public.analises_auria using (cde_priv.analise_ve2(id, empreendimento_id, visibilidade, criado_por, todos_projetistas));

-- Projetistas do empreendimento (designados + os dos fornecedores das disciplinas),
-- com as disciplinas de cada um. Só a coordenação consulta.
create or replace function public.analise_projetistas(p_emp uuid)
returns table(id uuid, nome text, email text, empresa text, discs text[], designado boolean)
language sql stable security definer set search_path to 'public' as $$
  with base as (
    select d.projetista_id pid, upper(d.disciplina) disc, true desig from projetista_designado_auria d where d.empreendimento_id = p_emp and d.projetista_id is not null
    union all
    select df.projetista_id, upper(df.disciplina), false from disciplina_fornecedor_auria df where df.empreendimento_id = p_emp and df.projetista_id is not null
    union all
    select pr.id, upper(df.disciplina), false from disciplina_fornecedor_auria df join projetistas_auria pr on pr.fornecedor_id = df.fornecedor_id
     where df.empreendimento_id = p_emp
  )
  select pr.id, pr.nome, lower(pr.email), coalesce(nullif(f.nome_fantasia,''), f.nome),
         array_agg(distinct b.disc order by b.disc), bool_or(b.desig)
    from base b join projetistas_auria pr on pr.id = b.pid and coalesce(pr.ativo,true)
    left join fornecedores_auria f on f.id = pr.fornecedor_id
   where public.estacao_pode(p_emp)
   group by pr.id, pr.nome, pr.email, f.nome_fantasia, f.nome;
$$;

-- Muda faixa + chave "todos" + lista de pessoas de uma vez. Só o dono da análise.
-- A lista fica guardada mesmo fora da faixa Projeto (volta marcada se voltar a ela),
-- mas só vale para leitura quando a faixa é Projeto.
create or replace function public.analise_compartilhar(p_id uuid, p_vis text, p_todos boolean, p_pessoas uuid[])
returns integer language plpgsql security definer set search_path to 'public' as $$
declare a record; v_fora int; v_n int;
begin
  select * into a from analises_auria where id = p_id;
  if a.id is null then raise exception 'Análise não encontrada.'; end if;
  if a.criado_por is distinct from auth.uid() then
    raise exception 'Só o dono da análise escolhe com quem compartilhar.' using errcode = '42501';
  end if;
  if p_vis not in ('privada','Coordenação','Projeto','Público') then raise exception 'Faixa inválida.'; end if;
  p_pessoas := coalesce(p_pessoas, '{}');
  select count(*) into v_fora from unnest(p_pessoas) x
   where x not in (select pp.id from analise_projetistas(a.empreendimento_id) pp);
  if v_fora > 0 then raise exception 'Há pessoa fora dos projetistas deste empreendimento.'; end if;
  update analises_auria set visibilidade = p_vis, todos_projetistas = (p_vis = 'Projeto' and coalesce(p_todos,false))
   where id = p_id;
  delete from analise_compartilha_auria where analise_id = p_id and projetista_id <> all(p_pessoas);
  insert into analise_compartilha_auria(analise_id, projetista_id)
  select p_id, x from unnest(p_pessoas) x on conflict do nothing;
  select count(*) into v_n from analise_compartilha_auria where analise_id = p_id;
  return v_n;
end $$;
revoke execute on function public.analise_compartilhar(uuid, text, boolean, uuid[]) from anon;
revoke execute on function public.analise_projetistas(uuid) from anon;

-- REVERSÃO:
-- alter policy analises_faixa_sel   on public.analises_auria using (analise_ve(empreendimento_id, visibilidade, criado_por));
-- alter policy analises_faixa_restr on public.analises_auria using (analise_ve(empreendimento_id, visibilidade, criado_por));
-- drop function if exists public.analise_compartilhar(uuid, text, boolean, uuid[]);
-- drop function if exists public.analise_projetistas(uuid);
-- drop function if exists cde_priv.analise_ve2(uuid, uuid, text, uuid, boolean);
-- drop table if exists public.analise_compartilha_auria;
-- alter table public.analises_auria drop column if exists todos_projetistas;
