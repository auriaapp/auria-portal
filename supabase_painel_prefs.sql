-- Preferências de visualização dos painéis (cards/gráficos do Painel da Gestão).
-- Duas camadas: a do próprio usuário e o "padrão do setor" (grupo), que só
-- gerente/super_admin grava. Leitura: própria → setor → padrão do código.
create table if not exists public.painel_prefs_auria (
  id           uuid primary key default gen_random_uuid(),
  grupo_id     uuid not null,
  usuario_id   uuid,                       -- null = padrão do setor
  painel       text not null,
  config       jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
create unique index if not exists painel_prefs_auria_uk
  on public.painel_prefs_auria (grupo_id, coalesce(usuario_id,'00000000-0000-0000-0000-000000000000'::uuid), painel);
alter table public.painel_prefs_auria enable row level security;
-- sem policies: acesso só pelas RPCs abaixo
revoke all on public.painel_prefs_auria from anon, authenticated;

create or replace function public.painel_prefs_get(p_painel text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_grp uuid := public.minha_empresa();
begin
  if v_uid is null then raise exception 'Sem sessão.'; end if;
  return jsonb_build_object(
    'meu',   (select config from painel_prefs_auria where grupo_id=v_grp and usuario_id=v_uid and painel=p_painel),
    'setor', (select config from painel_prefs_auria where grupo_id=v_grp and usuario_id is null and painel=p_painel));
end $$;

create or replace function public.painel_prefs_set(p_painel text, p_escopo text, p_config jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_grp uuid := public.minha_empresa(); v_role text := public.minha_role_auria();
begin
  if v_uid is null or v_grp is null then raise exception 'Sem sessão.'; end if;
  if p_escopo not in ('meu','setor') then raise exception 'Escopo inválido.'; end if;
  if p_escopo='setor' and coalesce(v_role,'') not in ('gerente','super_admin') then
    raise exception 'Só a gestão define o padrão do setor.'; end if;
  if p_config is null then  -- null = apagar (volta a herdar)
    delete from painel_prefs_auria where grupo_id=v_grp and painel=p_painel
      and ((p_escopo='meu' and usuario_id=v_uid) or (p_escopo='setor' and usuario_id is null));
    return;
  end if;
  insert into painel_prefs_auria(grupo_id,usuario_id,painel,config,atualizado_por)
  values (v_grp, case when p_escopo='meu' then v_uid end, p_painel, p_config, v_uid)
  on conflict (grupo_id, coalesce(usuario_id,'00000000-0000-0000-0000-000000000000'::uuid), painel)
  do update set config=excluded.config, atualizado_em=now(), atualizado_por=v_uid;
end $$;

revoke all on function public.painel_prefs_get(text) from public, anon;
revoke all on function public.painel_prefs_set(text,text,jsonb) from public, anon;
grant execute on function public.painel_prefs_get(text) to authenticated;
grant execute on function public.painel_prefs_set(text,text,jsonb) to authenticated;
