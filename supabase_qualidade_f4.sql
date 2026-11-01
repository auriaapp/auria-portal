-- ============================================================================
--  Qualidade F4 — 2026-11-01
--  1) NC: "Empreiteiro" vira "Equipe / frente responsável" (texto livre, com
--     sugestão das equipes já usadas na obra). O grupo incorpora e constrói;
--     a avaliação é por obra e por empresa do grupo (indicadores no front,
--     auria_indicadores.js — leitura das tabelas que a Qualidade já enxerga).
--  nc_empreiteiro_auria / nc_auria.empreiteiro_id ficam (vazios) por segurança.
-- ============================================================================
alter table public.nc_auria add column if not exists equipe text;

drop function if exists public.nc_analise_salvar(uuid,text,text,jsonb,text,text,text,uuid,text);
create or replace function public.nc_analise_salvar(p_id uuid, p_contencao text, p_metodo text, p_causa jsonb, p_causa_raiz text,
                                                    p_tipo text, p_gravidade text, p_equipe text, p_servico text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare n record;
begin
  select * into n from public.nc_auria where id = p_id for update;
  if n.id is null or not public.nc_pode_tratar(n.empreendimento_id) then raise exception 'Sem permissão.'; end if;
  if n.situacao not in ('aberta','plano') then raise exception 'A análise só pode mudar antes da aprovação do plano.'; end if;
  update public.nc_auria set
    contencao = nullif(trim(coalesce(p_contencao,'')),''),
    contencao_nome = case when coalesce(trim(p_contencao),'') <> coalesce(contencao,'') then public._it_nome() else contencao_nome end,
    contencao_em = case when coalesce(trim(p_contencao),'') <> coalesce(contencao,'') then now() else contencao_em end,
    causa_metodo = p_metodo, causa = coalesce(p_causa,'{}'), causa_raiz = nullif(trim(coalesce(p_causa_raiz,'')),''),
    tipo = coalesce(p_tipo, tipo), gravidade = coalesce(p_gravidade, gravidade), equipe = nullif(trim(coalesce(p_equipe,'')),''),
    servico = coalesce(nullif(trim(coalesce(p_servico,'')),''), servico),
    reincidente_de = coalesce(reincidente_de, public._nc_reincidencia(n.grupo_id, coalesce(nullif(trim(coalesce(p_servico,'')),''), n.servico), n.id)),
    atualizado_em = now()
  where id = p_id;
end $$;
revoke all on function public.nc_analise_salvar(uuid,text,text,jsonb,text,text,text,text,text) from anon, public;
grant execute on function public.nc_analise_salvar(uuid,text,text,jsonb,text,text,text,text,text) to authenticated;
