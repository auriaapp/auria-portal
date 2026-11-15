-- ═══════════════════════════════════════════════════════════════════════════
-- Item 113 fase 4 (2026-11-15): "Vincular a…" — apontamentos DIFERENTES que
-- dependem um do outro (ex.: shaft menor na ARQ-5 → tubulação HID-2 → furo EST-3).
-- Decidido (mockups/app_apontamento_varios_pavimentos.html, seção 4):
--   • cada um mantém seu status, disciplina, responsável e prazo;
--   • resolver um AVISA os outros (linha no histórico deles), mas não fecha;
--   • sempre dentro do mesmo empreendimento; quem vê os dois vê o vínculo.
-- Diferente do grupo_id (frente 2D × BIM do MESMO problema), que continua igual.
-- REVERSÃO no fim (comentada).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.apontamento_vinculo_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null,
  apt_a             text not null,      -- par guardado em ordem (apt_a < apt_b): sem duplicata A-B / B-A
  apt_b             text not null,
  criado_por        uuid default auth.uid(),
  criado_por_nome   text,
  criado_em         timestamptz not null default now(),
  check (apt_a < apt_b),
  unique (empreendimento_id, apt_a, apt_b),
  foreign key (empreendimento_id, apt_a) references public.apontamentos(empreendimento_id, id) on delete cascade on update cascade,
  foreign key (empreendimento_id, apt_b) references public.apontamentos(empreendimento_id, id) on delete cascade on update cascade
);
create index if not exists apt_vinc_b_idx on public.apontamento_vinculo_auria(empreendimento_id, apt_b);

alter table public.apontamento_vinculo_auria enable row level security;
-- Lê quem lê OS DOIS apontamentos (a RLS de apontamentos vale dentro dos exists).
create policy apt_vinc_sel on public.apontamento_vinculo_auria for select to authenticated
  using (exists (select 1 from public.apontamentos a where a.empreendimento_id = apontamento_vinculo_auria.empreendimento_id and a.id = apontamento_vinculo_auria.apt_a)
     and exists (select 1 from public.apontamentos b where b.empreendimento_id = apontamento_vinculo_auria.empreendimento_id and b.id = apontamento_vinculo_auria.apt_b));
-- Sem política de escrita: só pelas RPCs abaixo.

-- Liga (p_ligar = true) ou desliga dois apontamentos. Quem edita apontamentos do
-- empreendimento (apt_acesso_edita: coordenação/analista ativo, gerente; não visualizador).
create or replace function public.apt_vinc(p_emp uuid, p_a text, p_b text, p_ligar boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $$
declare x text := least(p_a, p_b); y text := greatest(p_a, p_b); v_nome text;
begin
  if not public.apt_acesso_edita(p_emp, (select nome from empreendimentos_auria where id = p_emp)) then
    raise exception 'Só a coordenação do empreendimento vincula apontamentos.' using errcode = '42501';
  end if;
  if x = y then raise exception 'Um apontamento não se vincula a ele mesmo.'; end if;
  if p_ligar then
    if (select count(*) from apontamentos where empreendimento_id = p_emp and id in (x, y)) < 2 then
      raise exception 'Apontamento não encontrado neste empreendimento.';
    end if;
    select nome into v_nome from usuarios_auria where id = auth.uid();
    insert into apontamento_vinculo_auria(empreendimento_id, apt_a, apt_b, criado_por, criado_por_nome)
    values (p_emp, x, y, auth.uid(), v_nome) on conflict do nothing;
  else
    delete from apontamento_vinculo_auria where empreendimento_id = p_emp and apt_a = x and apt_b = y;
  end if;
end $$;

-- Aviso: quando um apontamento vira Resolvido, cada vinculado ainda aberto ganha uma
-- linha no histórico do sistema. Nunca derruba o salvar.
create or replace function cde_priv.apt_vinc_aviso_trg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  if new.empreendimento_id is null or new.status is not distinct from old.status or new.status <> 'Resolvido' then return new; end if;
  begin
    for r in
      select o.id from apontamento_vinculo_auria v
        join apontamentos o on o.empreendimento_id = v.empreendimento_id
                           and o.id = case when v.apt_a = new.id then v.apt_b else v.apt_a end
       where v.empreendimento_id = new.empreendimento_id and new.id in (v.apt_a, v.apt_b)
         and coalesce(o.status,'') not in ('Resolvido','Reprovado','Retirado')
    loop
      update apontamentos
         set log_json = coalesce(case when jsonb_typeof(log_json)='array' then log_json end,'[]'::jsonb)
                        || jsonb_build_array(jsonb_build_object(
                             'data', to_char(now() at time zone 'America/Fortaleza','DD/MM/YYYY'),
                             'texto', 'Vinculado '||new.id||' foi resolvido. Este continua em aberto.',
                             'tipo', 'sistema', 'autor', 'Auria'))
       where empreendimento_id = new.empreendimento_id and id = r.id;
    end loop;
  exception when others then
    raise warning 'apt_vinc_aviso %/%: %', new.empreendimento_id, new.id, sqlerrm;
  end;
  return new;
end $$;
create trigger trg_zz_apt_vinc_aviso after update of status on public.apontamentos
  for each row execute function cde_priv.apt_vinc_aviso_trg();

-- REVERSÃO:
-- drop trigger if exists trg_zz_apt_vinc_aviso on public.apontamentos;
-- drop function if exists cde_priv.apt_vinc_aviso_trg();
-- drop function if exists public.apt_vinc(uuid, text, text, boolean);
-- drop table if exists public.apontamento_vinculo_auria;
