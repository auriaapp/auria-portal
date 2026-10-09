-- ============================================================================
--  DIÁRIO DE OBRA — D2b: FECHAR (campo) + VISTO do engenheiro chefe (2026-10-09)
--  · Fechar o dia: coord_campo OU eng_chefe (antes só eng_chefe).
--  · Ao fechar grava fechado_hash = SHA-256 do conteúdo do dia (código de
--    verificação impresso no PDF; adendo não altera o hash do dia fechado).
--  · Visto: só eng_chefe, só em diário fechado, uma vez (visto_em/visto_nome).
--  · Guard: visto/hash só mudam pelas funções. Reaplicável.
-- ============================================================================
alter table public.cde_rdo_auria add column if not exists visto_em     timestamptz;
alter table public.cde_rdo_auria add column if not exists visto_nome   text;
alter table public.cde_rdo_auria add column if not exists fechado_hash text;

create or replace function public.rdo_conteudo_hash(r public.cde_rdo_auria)
returns text language sql immutable as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'emp', r.empreendimento_id, 'data', r.data, 'clima_manha', r.clima_manha, 'clima_tarde', r.clima_tarde,
    'efetivo', r.efetivo, 'equipamentos', r.equipamentos, 'atividades', r.atividades, 'ocorrencias', r.ocorrencias,
    'observacoes', r.observacoes, 'fotos', r.fotos)::text, 'UTF8')), 'hex');
$$;

create or replace function public.cde_rdo_guard()
returns trigger language plpgsql as $$
begin
  if current_setting('auria.rdo_rpc', true) = '1' then new.atualizado_em := now(); return new; end if;
  if tg_op = 'INSERT' then
    new.fechado_em := null; new.fechado_nome := null; new.adendos := '[]'::jsonb;
    new.visto_em := null; new.visto_nome := null; new.fechado_hash := null;
    new.autor_nome := coalesce(new.autor_nome, (select coalesce(nome,email) from public.usuarios_auria where id = auth.uid()));
    return new;
  end if;
  if old.fechado_em is not null then
    raise exception 'O diário de % está FECHADO. Para acrescentar algo, use "Adendo".', to_char(old.data, 'DD/MM/YYYY');
  end if;
  if new.fechado_em is distinct from old.fechado_em or new.fechado_nome is distinct from old.fechado_nome
     or new.adendos is distinct from old.adendos or new.data is distinct from old.data
     or new.empreendimento_id is distinct from old.empreendimento_id
     or new.visto_em is distinct from old.visto_em or new.visto_nome is distinct from old.visto_nome
     or new.fechado_hash is distinct from old.fechado_hash then
    raise exception 'Fechamento, visto, adendos e data do diário mudam só pelos botões.';
  end if;
  new.atualizado_em := now();
  return new;
end $$;

create or replace function public.rdo_fechar(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r public.cde_rdo_auria;
begin
  select * into r from public.cde_rdo_auria where id = p_id for update;
  if r.id is null then raise exception 'Diário não encontrado.'; end if;
  if coalesce(public.obra_nivel(r.empreendimento_id),'') not in ('eng_chefe','coord_campo') then
    raise exception 'Só o engenheiro chefe ou o coordenador de campo fecham o diário.'; end if;
  if r.fechado_em is not null then raise exception 'Este diário já está fechado.'; end if;
  if r.data > current_date then raise exception 'Não se fecha diário de data futura.'; end if;
  perform set_config('auria.rdo_rpc','1',true);
  update public.cde_rdo_auria set fechado_em = now(),
         fechado_nome = (select coalesce(nome,email) from public.usuarios_auria where id = auth.uid()),
         fechado_hash = public.rdo_conteudo_hash(r)
   where id = p_id;
  perform set_config('auria.rdo_rpc','0',true);
end $$;

create or replace function public.rdo_visar(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r public.cde_rdo_auria;
begin
  select * into r from public.cde_rdo_auria where id = p_id for update;
  if r.id is null then raise exception 'Diário não encontrado.'; end if;
  if public.obra_nivel(r.empreendimento_id) is distinct from 'eng_chefe' then raise exception 'Só o engenheiro chefe dá o visto.'; end if;
  if r.fechado_em is null then raise exception 'Feche o dia antes de dar o visto.'; end if;
  if r.visto_em is not null then raise exception 'Este diário já tem visto.'; end if;
  perform set_config('auria.rdo_rpc','1',true);
  update public.cde_rdo_auria set visto_em = now(),
         visto_nome = (select coalesce(nome,email) from public.usuarios_auria where id = auth.uid()),
         fechado_hash = coalesce(fechado_hash, public.rdo_conteudo_hash(r))
   where id = p_id;
  perform set_config('auria.rdo_rpc','0',true);
end $$;
grant execute on function public.rdo_fechar(uuid), public.rdo_visar(uuid) to authenticated;
revoke all on function public.rdo_fechar(uuid), public.rdo_visar(uuid) from anon, public;
revoke all on function public.rdo_conteudo_hash(public.cde_rdo_auria) from anon, public;

select 'colunas' as item, (select count(*) from information_schema.columns where table_schema='public' and table_name='cde_rdo_auria' and column_name in ('visto_em','visto_nome','fechado_hash'))=3 as ok
union all select 'fechar aceita coord_campo', exists(select 1 from pg_proc where proname='rdo_fechar' and prosrc like '%coord_campo%')
union all select 'visar', exists(select 1 from pg_proc where proname='rdo_visar')
union all select 'guard protege visto', exists(select 1 from pg_proc where proname='cde_rdo_guard' and prosrc like '%visto_em%');
