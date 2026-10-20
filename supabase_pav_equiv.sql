-- ============================================================================
-- Equivalência de pavimentos (2026-10-20)
-- A lista OFICIAL é a da ficha (cde_pavimento_auria: código + nome). Cada nome
-- que aparece num modelo IFC (IfcBuildingStorey) ou no cronograma da obra aponta
-- para um código da ficha. O Auria nunca altera o IFC: a equivalência mora aqui.
--   fonte = 'cronograma'  ou  o código do documento do modelo (ex.: PINI-ARQ-EX-001-MOD)
--   nome  = como está escrito na fonte (ex.: "10º PAVIMENTO_(P.A_0,07)", "Tipo 10")
--   pavimento = código da ficha (ex.: 10T); null = "não é pavimento" / ainda sem par
--   sugerido = true enquanto ninguém conferiu (o sistema propôs)
-- ============================================================================
create table if not exists public.cde_pav_equiv_auria(
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  fonte text not null,
  nome text not null,
  pavimento text,
  sugerido boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  primary key(empreendimento_id, fonte, nome));
alter table public.cde_pav_equiv_auria enable row level security;

drop policy if exists pveq_sel on public.cde_pav_equiv_auria;
create policy pveq_sel on public.cde_pav_equiv_auria for select
  using (coalesce(public.cde_pav_pode_ver(empreendimento_id),false) or coalesce(public.obra_crono_pode_ver(empreendimento_id),false));
-- conferir/corrigir: quem edita os pavimentos da ficha (gestão) ou a engenharia da obra
drop policy if exists pveq_upd on public.cde_pav_equiv_auria;
create policy pveq_upd on public.cde_pav_equiv_auria for update
  using (coalesce(public.estacao_edita(empreendimento_id),false) or coalesce(public.obra_pode_ferramenta(empreendimento_id),false))
  with check (coalesce(public.estacao_edita(empreendimento_id),false) or coalesce(public.obra_pode_ferramenta(empreendimento_id),false));
drop policy if exists pveq_del on public.cde_pav_equiv_auria;
create policy pveq_del on public.cde_pav_equiv_auria for delete
  using (coalesce(public.estacao_edita(empreendimento_id),false) or coalesce(public.obra_pode_ferramenta(empreendimento_id),false));
grant select, update, delete on public.cde_pav_equiv_auria to authenticated;

-- Registrar nomes novos (com a sugestão do sistema). Qualquer um que abra o modelo
-- pode registrar; nunca sobrescreve o que já existe (conferido ou não).
create or replace function public.pav_equiv_registrar(p_emp uuid, p_fonte text, p_itens jsonb)
returns int language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if not (coalesce(public.cde_pav_pode_ver(p_emp),false) or coalesce(public.obra_crono_pode_ver(p_emp),false)) then
    raise exception 'sem acesso a este empreendimento';
  end if;
  insert into public.cde_pav_equiv_auria(empreendimento_id,fonte,nome,pavimento,sugerido)
  select p_emp, left(p_fonte,120), left(x->>'nome',200), nullif(x->>'pavimento',''), true
    from jsonb_array_elements(p_itens) x
   where coalesce(x->>'nome','')<>''
  on conflict do nothing;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.pav_equiv_registrar(uuid,text,jsonb) from public, anon;
grant execute on function public.pav_equiv_registrar(uuid,text,jsonb) to authenticated;
