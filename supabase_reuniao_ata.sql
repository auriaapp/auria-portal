-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-22 — backlog do App item 128 (mockups/app_ata_reuniao.html, aprovado):
--   ATA DE REUNIÃO dentro da análise. Uma análise tem várias reuniões; cada reunião tem
--   itens numerados (o balão na prancha é marcação da análise com dados.reuniao/dados.item).
--   Tipos: info | decisao | acao | discutir. Responsável = sigla da disciplina ou 'COORD'
--   (coordenação: fica só na ata). Ação pode virar apontamento (apontamento_id).
--   Recorte da prancha em volta do balão vai para a ata (JPEG, < 300 KB).
--   reuniao_enviar_ata: manda a ata por e-mail aos presentes (só e-mails conhecidos:
--   usuários e projetistas do Auria), cada um com as suas ações em destaque.
-- Aplicado como migração reuniao_ata.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.reuniao_auria (
  id                uuid primary key default gen_random_uuid(),
  analise_id        uuid not null references public.analises_auria(id) on delete cascade,
  empreendimento_id uuid not null,
  titulo            text not null default 'Reunião de projeto' check (length(titulo) <= 120),
  data              date not null default current_date,
  hora_ini          text check (hora_ini is null or hora_ini ~ '^\d{2}:\d{2}$'),
  hora_fim          text check (hora_fim is null or hora_fim ~ '^\d{2}:\d{2}$'),
  modo              text not null default 'presencial' check (modo in ('presencial','online')),
  estado            text not null default 'pauta' check (estado in ('pauta','andamento','encerrada')),
  presentes         jsonb not null default '[]'::jsonb,
  conduzida_por     uuid default auth.uid(),
  conduzida_nome    text,
  ata_emitida_em    timestamptz,
  ata_enviada_em    timestamptz,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index if not exists reuniao_auria_analise on public.reuniao_auria(analise_id);

create table if not exists public.reuniao_item_auria (
  id              uuid primary key default gen_random_uuid(),
  reuniao_id      uuid not null references public.reuniao_auria(id) on delete cascade,
  numero          integer not null,
  tipo            text not null default 'discutir' check (tipo in ('info','decisao','acao','discutir')),
  texto           text not null default '' check (length(texto) <= 2000),
  resp_disc       text check (resp_disc is null or length(resp_disc) <= 20),
  resp_nome       text check (resp_nome is null or length(resp_nome) <= 120),
  prazo           date,
  apontamento_id  text,
  recorte         text check (recorte is null or length(recorte) < 300000),
  origem_item_id  uuid,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists reuniao_item_auria_reuniao on public.reuniao_item_auria(reuniao_id);

alter table public.reuniao_auria enable row level security;
alter table public.reuniao_item_auria enable row level security;
revoke all on public.reuniao_auria from anon;
revoke all on public.reuniao_item_auria from anon;
grant select, insert, update, delete on public.reuniao_auria to authenticated;
grant select, insert, update, delete on public.reuniao_item_auria to authenticated;

-- Ver: quem enxerga a análise (a RLS de analises_auria decide dentro do exists).
drop policy if exists reuniao_sel on public.reuniao_auria;
create policy reuniao_sel on public.reuniao_auria for select to authenticated
  using (exists (select 1 from public.analises_auria a where a.id = analise_id));
-- Gravar: só o dono da análise (quem conduz). Reunião online (item 136) amplia depois.
drop policy if exists reuniao_dono on public.reuniao_auria;
create policy reuniao_dono on public.reuniao_auria for all to authenticated
  using (exists (select 1 from public.analises_auria a where a.id = analise_id and a.criado_por = auth.uid()))
  with check (exists (select 1 from public.analises_auria a where a.id = analise_id and a.criado_por = auth.uid()
                      and a.empreendimento_id = reuniao_auria.empreendimento_id));

drop policy if exists reuniao_item_sel on public.reuniao_item_auria;
create policy reuniao_item_sel on public.reuniao_item_auria for select to authenticated
  using (exists (select 1 from public.reuniao_auria r where r.id = reuniao_id));
drop policy if exists reuniao_item_dono on public.reuniao_item_auria;
create policy reuniao_item_dono on public.reuniao_item_auria for all to authenticated
  using (exists (select 1 from public.reuniao_auria r join public.analises_auria a on a.id = r.analise_id
                 where r.id = reuniao_id and a.criado_por = auth.uid()))
  with check (exists (select 1 from public.reuniao_auria r join public.analises_auria a on a.id = r.analise_id
                      where r.id = reuniao_id and a.criado_por = auth.uid()));

-- ── E-mail da ata ───────────────────────────────────────────────────────────
-- p_dest: [{email, discs:[ 'ARQ', ... ]}] — as ações das disciplinas da pessoa saem em destaque.
create or replace function public.reuniao_enviar_ata(p_reuniao uuid, p_dest jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  r record; an record; emp record; d jsonb; em text; discs text[]; n int := 0;
  it record; corpo text; acoes text; itens text; minhas int; tp text; cor text; dt text;
begin
  select * into r from reuniao_auria where id = p_reuniao;
  if r.id is null then raise exception 'reunião não encontrada'; end if;
  select * into an from analises_auria where id = r.analise_id;
  if an.criado_por is distinct from auth.uid() then raise exception 'só quem conduz a reunião envia a ata'; end if;
  select nome, codigo into emp from empreendimentos_auria where id = r.empreendimento_id;
  dt := to_char(r.data, 'DD/MM/YYYY');

  for d in select * from jsonb_array_elements(coalesce(p_dest, '[]'::jsonb)) loop
    em := lower(trim(coalesce(d->>'email', '')));
    continue when em = '' or position('@' in em) = 0;
    -- só e-mails conhecidos do Auria (usuário ou projetista): nada de enviar para endereço digitado
    continue when not exists (select 1 from usuarios_auria u where lower(u.email) = em)
              and not exists (select 1 from projetistas_auria p where lower(p.email) = em);
    discs := array(select upper(jsonb_array_elements_text(coalesce(d->'discs', '[]'::jsonb))));

    itens := ''; acoes := ''; minhas := 0;
    for it in select * from reuniao_item_auria where reuniao_id = r.id order by numero loop
      tp := case it.tipo when 'decisao' then 'DECISÃO' when 'acao' then 'AÇÃO' when 'info' then 'INFORMAÇÃO' else 'PARA DISCUTIR' end;
      cor := case it.tipo when 'decisao' then '#2F855A' when 'acao' then '#C2410C' when 'info' then '#3465A4' else '#64748B' end;
      itens := itens || '<tr><td style="padding:9px 8px 9px 0;vertical-align:top;width:26px"><span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;background:#1E3A5F;color:#fff;font-size:11px;font-weight:800;text-align:center">'
        || it.numero || '</span></td><td style="padding:9px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#1A2F4A">'
        || '<span style="font-size:10px;font-weight:800;color:' || cor || ';letter-spacing:.06em">' || tp || '</span>'
        || case when coalesce(it.resp_disc,'') <> '' then ' <span style="font-family:Consolas,monospace;font-size:11px;font-weight:700;color:#1E3A5F">' || public.auria_esc(it.resp_disc) || '</span>' else '' end
        || '<br>' || public.auria_esc(it.texto)
        || case when it.prazo is not null then '<br><span style="color:#64748B;font-size:12px">Prazo ' || to_char(it.prazo,'DD/MM/YYYY') || '</span>' else '' end
        || case when coalesce(it.apontamento_id,'') <> '' then ' <span style="color:#64748B;font-size:12px">· apontamento ' || public.auria_esc(it.apontamento_id) || '</span>' else '' end
        || '</td></tr>';
      if it.tipo = 'acao' and coalesce(it.resp_disc,'') <> '' and upper(it.resp_disc) = any(discs) then
        minhas := minhas + 1;
        acoes := acoes || '<tr><td style="padding:8px 10px;border-bottom:1px solid #FDE7CF;font-size:13px;color:#1A2F4A"><b>Item ' || it.numero || '</b> · '
          || public.auria_esc(it.texto)
          || case when it.prazo is not null then '<br><span style="color:#C2410C;font-weight:700;font-size:12px">Prazo ' || to_char(it.prazo,'DD/MM/YYYY') || '</span>' else '' end
          || '</td></tr>';
      end if;
    end loop;

    corpo := '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">'
      || public.auria_email_row('Empreendimento', public.auria_esc(coalesce(emp.codigo || ' · ', '') || coalesce(emp.nome,'')))
      || public.auria_email_row('Reunião', public.auria_esc(dt || coalesce(' · ' || r.hora_ini, '') || coalesce('–' || r.hora_fim, '') || ' · ' || r.modo))
      || public.auria_email_row('Conduzida por', public.auria_esc(r.conduzida_nome))
      || '</table>'
      || case when minhas > 0 then '<p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.06em;color:#C2410C">SUAS AÇÕES (' || minhas || ')</p>'
           || '<table style="width:100%;border-collapse:collapse;background:#FFF7ED;border:1px solid #FDE7CF;border-radius:8px;margin-bottom:18px">' || acoes || '</table>' else '' end
      || '<p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.06em;color:#1E3A5F">ITENS DA REUNIÃO</p>'
      || '<table style="width:100%;border-collapse:collapse">' || itens || '</table>'
      || '<p style="margin:16px 0 0;font-size:12px;color:#64748B">A ata em PDF, com o recorte da prancha de cada item, fica com quem conduziu a reunião.</p>';

    perform public.auria_send_email(array[em], 'Ata da reunião ' || dt || ' · ' || coalesce(emp.nome,''),
      public.auria_email_shell('Ata de reunião', public.auria_esc(r.titulo), corpo, null, null), null,
      (select u.email from usuarios_auria u where u.id = auth.uid()));   -- resposta vai para quem conduziu
    n := n + 1;
  end loop;
  if n > 0 then update reuniao_auria set ata_enviada_em = now() where id = r.id; end if;
  return n;
end $$;
revoke all on function public.reuniao_enviar_ata(uuid, jsonb) from public, anon;
grant execute on function public.reuniao_enviar_ata(uuid, jsonb) to authenticated;

-- REVERSÃO:
-- drop function if exists public.reuniao_enviar_ata(uuid, jsonb);
-- drop table if exists public.reuniao_item_auria;
-- drop table if exists public.reuniao_auria;
