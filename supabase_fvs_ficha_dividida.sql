-- Ficha FVS dividida com o modelo (2026-11-07).
-- Aditivo: coluna nova + função nova. Nada existente muda de comportamento.
--   fvs_inspecao_auria.concretagem_id : liga a ficha 009 à concretagem (caminhões, CPs, mapa).
--   fvs_salvar_vinculo : grava peças e concretagem da ficha. A tabela não tem política de
--   UPDATE; escrita passa por função, com a mesma regra de quem preenche (fvs_salvar_itens).

alter table public.fvs_inspecao_auria
  add column if not exists concretagem_id uuid references public.conc_concretagem_auria(id) on delete set null;

create index if not exists fvs_inspecao_concretagem_idx
  on public.fvs_inspecao_auria (concretagem_id) where concretagem_id is not null;

create or replace function public.fvs_salvar_vinculo(p_id uuid, p_elementos jsonb, p_concretagem uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.fvs_inspecao_auria;
begin
  select * into v from public.fvs_inspecao_auria where id = p_id for update;
  if v.id is null then raise exception 'Ficha não encontrada.'; end if;
  if not coalesce(public.fvs_pode_inspecionar(v.empreendimento_id, v.tipo), false) then
    raise exception 'Só a equipe da obra preenche fichas.'; end if;
  if v.situacao not in ('aberta','em_verificacao') then
    raise exception 'A ficha não está em preenchimento (situação: %).', v.situacao; end if;
  if p_elementos is not null and jsonb_typeof(p_elementos) <> 'array' then
    raise exception 'Lista de peças inválida.'; end if;
  if p_concretagem is not null and not exists (
       select 1 from public.conc_concretagem_auria c where c.id = p_concretagem and c.empreendimento_id = v.empreendimento_id) then
    raise exception 'Concretagem de outro empreendimento.'; end if;
  update public.fvs_inspecao_auria
     set elementos = coalesce(p_elementos, '[]'::jsonb), concretagem_id = p_concretagem, atualizado_em = now()
   where id = p_id;
end $$;

revoke all on function public.fvs_salvar_vinculo(uuid, jsonb, uuid) from public, anon;
grant execute on function public.fvs_salvar_vinculo(uuid, jsonb, uuid) to authenticated;

-- 2026-11-08 · Nova ficha como no Construpoint: agendar para uma data e parceiro (quem executou).
-- Aditivo. A ficha agendada nasce 'aberta' (o gatilho fvs_inspecao_nasce manda na situação);
-- a data só organiza a lista "Para hoje". Parceiro é texto livre: o grupo incorpora e constrói,
-- não há avaliação de empreiteiro.
alter table public.fvs_inspecao_auria add column if not exists agendada_para date;
alter table public.fvs_inspecao_auria add column if not exists parceiro text check (parceiro is null or length(parceiro) <= 80);
