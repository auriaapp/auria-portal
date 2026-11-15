-- ═══════════════════════════════════════════════════════════════════════════
-- Item 108 (2026-11-15): pastas PESSOAIS de análises do App.
-- Decidido (mockups/app_analises_pastas.html + app_analises_barra_pastas.html):
--   • a pasta é de cada pessoa; a mesma análise compartilhada pode estar em
--     pastas diferentes para pessoas diferentes;
--   • até 2 níveis (pasta › subpasta);
--   • excluir pasta → as análises de dentro vão para "Soltas" (só some a ligação,
--     a análise nunca é apagada junto); subpastas saem junto.
-- REVERSÃO no fim (comentada).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.analise_pasta_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  dono              uuid not null default auth.uid(),
  nome              text not null check (length(trim(nome)) between 1 and 80),
  pasta_mae         uuid references public.analise_pasta_auria(id) on delete cascade,
  ordem             int not null default 0,
  criado_em         timestamptz not null default now()
);
create index if not exists analise_pasta_dono_idx on public.analise_pasta_auria(dono, empreendimento_id);

-- Onde a análise está, PARA ESTA PESSOA. Sem linha = "Soltas".
create table if not exists public.analise_na_pasta_auria (
  pessoa     uuid not null default auth.uid(),
  analise_id uuid not null references public.analises_auria(id) on delete cascade,
  pasta_id   uuid not null references public.analise_pasta_auria(id) on delete cascade,
  movido_em  timestamptz not null default now(),
  primary key (pessoa, analise_id)
);
create index if not exists analise_na_pasta_pasta_idx on public.analise_na_pasta_auria(pasta_id);

-- Regras: subpasta só 1 nível, mesma pessoa e mesmo empreendimento.
create or replace function cde_priv.analise_pasta_chk()
returns trigger language plpgsql set search_path to 'public' as $$
declare m record;
begin
  if new.pasta_mae is not null then
    select * into m from analise_pasta_auria where id = new.pasta_mae;
    if m.id is null or m.dono <> new.dono or m.empreendimento_id <> new.empreendimento_id then
      raise exception 'Pasta-mãe inválida.';
    end if;
    if m.pasta_mae is not null then raise exception 'As pastas têm no máximo 2 níveis.'; end if;
    if new.id = new.pasta_mae then raise exception 'Pasta-mãe inválida.'; end if;
    if exists (select 1 from analise_pasta_auria f where f.pasta_mae = new.id) then
      raise exception 'Uma pasta com subpastas não pode virar subpasta.';
    end if;
  end if;
  return new;
end $$;
create trigger trg_analise_pasta_chk before insert or update on public.analise_pasta_auria
  for each row execute function cde_priv.analise_pasta_chk();

-- A ligação só vale para pasta da própria pessoa, no mesmo empreendimento da análise.
create or replace function cde_priv.analise_na_pasta_chk()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from analise_pasta_auria p join analises_auria a on a.id = new.analise_id
                  where p.id = new.pasta_id and p.dono = new.pessoa and p.empreendimento_id = a.empreendimento_id) then
    raise exception 'Pasta inválida para esta análise.';
  end if;
  return new;
end $$;
create trigger trg_analise_na_pasta_chk before insert or update on public.analise_na_pasta_auria
  for each row execute function cde_priv.analise_na_pasta_chk();

alter table public.analise_pasta_auria enable row level security;
alter table public.analise_na_pasta_auria enable row level security;

-- Pastas: só o dono, e só em empreendimento a que ele tem acesso.
create policy analise_pasta_dono on public.analise_pasta_auria for all to authenticated
  using (dono = auth.uid())
  with check (dono = auth.uid() and (public.estacao_pode(empreendimento_id) or public.apt_tem_acesso_emp(empreendimento_id)));

-- Ligações: só a própria pessoa, e só com análise que ela VÊ (a RLS de análises vale no exists).
create policy analise_na_pasta_dono on public.analise_na_pasta_auria for all to authenticated
  using (pessoa = auth.uid())
  with check (pessoa = auth.uid() and exists (select 1 from public.analises_auria a where a.id = analise_na_pasta_auria.analise_id));

-- REVERSÃO:
-- drop table if exists public.analise_na_pasta_auria;
-- drop table if exists public.analise_pasta_auria;
-- drop function if exists cde_priv.analise_pasta_chk();
-- drop function if exists cde_priv.analise_na_pasta_chk();

-- 2026-11-15: sem login não tem nenhuma permissão nesta tabela (migração revoke_anon_tabelas_113_108).
revoke all on table public.analise_pasta_auria from anon;
revoke all on table public.analise_na_pasta_auria from anon;
