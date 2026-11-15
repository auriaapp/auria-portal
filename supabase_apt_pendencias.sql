-- ═══════════════════════════════════════════════════════════════════════════
-- Item 113 fase 2 (2026-11-15): pendência por DISCIPLINA × LOCAL do apontamento.
-- local_key = 'pav:<código>' quando o pavimento é conhecido; senão o id da prancha; sem pin 2D = 'geral'.
-- Regras decididas com o usuário (mockups/app_apontamento_pendencias.html):
--   • local = prancha de um pin 2D (pid; sem pid = prancha do apontamento);
--     sem pin 2D → um local só, 'geral';
--   • disciplina = participantes com nível "Pendência" (sem nenhum → a
--     disciplina do apontamento);
--   • dois estados: pendente → resolvido; só a coordenação marca;
--   • o apontamento vira Resolvido sozinho quando a última pendência resolve,
--     e volta a "Em aberto" se uma for reaberta;
--   • status mudado À MÃO para Resolvido resolve todas; reaberto à mão reabre todas.
-- Linhas nascem e somem sozinhas (gatilho em apontamentos); o cliente só lê e
-- marca pela RPC apt_pend_marcar.
-- REVERSÃO (no fim do arquivo, comentada).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.apontamento_pendencia_auria (
  id                 uuid primary key default gen_random_uuid(),
  empreendimento_id  uuid not null,
  apontamento_id     text not null,
  local_key          text not null,             -- prancha_id (texto) ou 'geral'
  prancha_id         uuid,
  pav                text default '',           -- código do pavimento (local_txt do documento do CDE)
  disciplina         text not null,
  estado             text not null default 'pendente' check (estado in ('pendente','resolvido')),
  resolvido_em       timestamptz,
  resolvido_por      uuid,
  resolvido_por_nome text,
  criado_em          timestamptz not null default now(),
  unique (empreendimento_id, apontamento_id, local_key, disciplina),
  foreign key (empreendimento_id, apontamento_id) references public.apontamentos(empreendimento_id, id) on delete cascade on update cascade
);
create index if not exists apt_pend_apt_idx on public.apontamento_pendencia_auria(empreendimento_id, apontamento_id);

alter table public.apontamento_pendencia_auria enable row level security;
-- Lê quem lê o apontamento (a RLS de apontamentos vale dentro do exists).
create policy apt_pend_sel on public.apontamento_pendencia_auria for select to authenticated
  using (exists (select 1 from public.apontamentos a
                  where a.empreendimento_id = apontamento_pendencia_auria.empreendimento_id
                    and a.id = apontamento_pendencia_auria.apontamento_id));
-- Sem política de INSERT/UPDATE/DELETE: com RLS ligada, ninguém grava direto; só as
-- funções abaixo (definer). Anônimo não tem política de leitura.

-- Recalcula as linhas de UM apontamento (acrescenta o que falta, tira o que sobrou).
create or replace function cde_priv.apt_pend_sync(p_emp uuid, p_apt text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare a record;
begin
  select * into a from apontamentos where empreendimento_id = p_emp and id = p_apt;
  if not found then return; end if;
  with discs as (
    select k as disc from jsonb_each(case when jsonb_typeof(a.participantes)='object' then a.participantes else '{}'::jsonb end) e(k,v)
     where coalesce(v->>'nivel','Pendência') = 'Pendência'
  ), d as (
    select disc from discs
    union all select coalesce(nullif(a.disciplina,''),'—') where not exists (select 1 from discs)
  ), pins as (
    select distinct coalesce(nullif(p->>'pid',''), a.prancha_id::text) as pid
      from jsonb_array_elements(case when jsonb_typeof(a.pontos_json)='array' then a.pontos_json else '[]'::jsonb end) p
     where coalesce(p->>'k3d','') in ('','false')
  ), l as (
    select pid, case when pid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then pid::uuid end as prancha_id
      from pins where pid is not null
  ), lp as (
    -- local = PAVIMENTO quando o documento do CDE diz qual é (pins em ARQ e EST do
    -- mesmo pavimento são um local só); senão, a própria prancha.
    select l.pid, l.prancha_id, coalesce(upper(trim(doc.local_txt)),'') as pav
      from l left join pranchas_auria pr on pr.id = l.prancha_id
             left join cde_documento_auria doc on doc.id = pr.cde_documento_id
  ), loc as (
    (select distinct on (k) k as local_key, prancha_id, pav from (
      select case when pav <> '' then 'pav:'||pav else pid end as k, prancha_id, pav from lp) z
     order by k, prancha_id)
    union all select 'geral', null::uuid, '' where not exists (select 1 from l)
  ), alvo as (
    select loc.local_key, loc.prancha_id, d.disc, loc.pav from loc cross join d
  ), apaga as (
    delete from apontamento_pendencia_auria x
     where x.empreendimento_id = p_emp and x.apontamento_id = p_apt
       and not exists (select 1 from alvo where alvo.local_key = x.local_key and alvo.disc = x.disciplina)
  )
  insert into apontamento_pendencia_auria(empreendimento_id, apontamento_id, local_key, prancha_id, pav, disciplina, estado, resolvido_em)
  select p_emp, p_apt, alvo.local_key, alvo.prancha_id, alvo.pav, alvo.disc,
         case when a.status = 'Resolvido' then 'resolvido' else 'pendente' end,
         case when a.status = 'Resolvido' then now() end
    from alvo
  on conflict (empreendimento_id, apontamento_id, local_key, disciplina)
  do update set pav = excluded.pav, prancha_id = excluded.prancha_id;
end $$;

-- Gatilho em apontamentos: mantém as linhas e acompanha o status mudado à mão.
create or replace function cde_priv.apt_pend_trg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.empreendimento_id is null then return new; end if;
  -- Nunca derruba o salvar do apontamento: se o cálculo falhar, só avisa no log.
  begin
  perform cde_priv.apt_pend_sync(new.empreendimento_id, new.id);
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and coalesce(current_setting('auria.pend_rpc', true),'') <> '1' then
    if new.status = 'Resolvido' then
      update apontamento_pendencia_auria set estado='resolvido', resolvido_em=coalesce(resolvido_em, now()),
             resolvido_por=coalesce(resolvido_por, auth.uid())
       where empreendimento_id=new.empreendimento_id and apontamento_id=new.id and estado='pendente';
    elsif old.status = 'Resolvido' then
      update apontamento_pendencia_auria set estado='pendente', resolvido_em=null, resolvido_por=null, resolvido_por_nome=null
       where empreendimento_id=new.empreendimento_id and apontamento_id=new.id;
    end if;
  end if;
  exception when others then
    raise warning 'apt_pend_trg %/%: %', new.empreendimento_id, new.id, sqlerrm;
  end;
  return new;
end $$;
create trigger trg_zz_apt_pend after insert or update of pontos_json, participantes, disciplina, prancha_id, status
  on public.apontamentos for each row execute function cde_priv.apt_pend_trg();

-- Marca/desmarca pendências (só coordenação do empreendimento ou super_admin).
-- Fecha/reabre o apontamento conforme sobrar pendência. Devolve quantas ainda faltam.
create or replace function public.apt_pend_marcar(p_emp uuid, p_apt text, p_ids uuid[], p_resolvido boolean)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_falta int; v_status text; v_nome text;
begin
  if not (eh_coordenador_emp(p_emp) or coalesce(minha_role_auria(),'') = 'super_admin') then
    raise exception 'Só a coordenação do empreendimento marca pendências.' using errcode = '42501';
  end if;
  select status into v_status from apontamentos where empreendimento_id = p_emp and id = p_apt;
  if not found then raise exception 'Apontamento não encontrado.'; end if;
  select nome into v_nome from usuarios_auria where id = auth.uid();
  update apontamento_pendencia_auria
     set estado = case when p_resolvido then 'resolvido' else 'pendente' end,
         resolvido_em = case when p_resolvido then now() end,
         resolvido_por = case when p_resolvido then auth.uid() end,
         resolvido_por_nome = case when p_resolvido then v_nome end
   where empreendimento_id = p_emp and apontamento_id = p_apt and id = any(p_ids);
  select count(*) into v_falta from apontamento_pendencia_auria
   where empreendimento_id = p_emp and apontamento_id = p_apt and estado = 'pendente';
  perform set_config('auria.pend_rpc', '1', true);
  if v_falta = 0 and v_status is distinct from 'Resolvido' then
    update apontamentos set status = 'Resolvido' where empreendimento_id = p_emp and id = p_apt;
  elsif v_falta > 0 and v_status = 'Resolvido' then
    update apontamentos set status = 'Em aberto' where empreendimento_id = p_emp and id = p_apt;
  end if;
  perform set_config('auria.pend_rpc', '', true);
  return v_falta;
end $$;

-- apt_pend_sync e apt_pend_trg ficam em cde_priv (fora do alcance da API). A RPC
-- apt_pend_marcar recusa quem não é coordenação (anônimo inclusive).

-- Apontamentos que já existem: uma linha por disciplina × local.
do $$ declare r record; begin
  for r in select empreendimento_id, id from apontamentos where empreendimento_id is not null loop
    perform cde_priv.apt_pend_sync(r.empreendimento_id, r.id);
  end loop;
end $$;

-- REVERSÃO:
-- drop trigger if exists trg_zz_apt_pend on public.apontamentos;
-- drop function if exists public.apt_pend_marcar(uuid, text, uuid[], boolean);
-- drop function if exists cde_priv.apt_pend_trg();
-- drop function if exists cde_priv.apt_pend_sync(uuid, text);
-- drop table if exists public.apontamento_pendencia_auria;

-- 2026-11-15: sem login não tem nenhuma permissão nesta tabela (migração revoke_anon_tabelas_113_108).
revoke all on table public.apontamento_pendencia_auria from anon;
