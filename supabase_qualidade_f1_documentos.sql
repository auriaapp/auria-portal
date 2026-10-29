-- ============================================================================
--  Qualidade F1 — Controle de documentos (ISO 9001 7.5 / PBQP-H SiAC)  2026-10-28
--  1) Revisão passa por elaboração → verificação → aprovação antes de publicar
--     (grupo_it_minuta_auria). Quem elaborou não verifica nem aprova.
--  2) Distribuição: cada documento diz quem precisa ler (papéis da obra e
--     setores) e em quais obras; revisão vigente exige ciência ("li e
--     entendi"), com cobrança por e-mail (cron it-ciencia-cobranca).
--     Pendência é CALCULADA (quem entra depois na obra também deve ciência).
--  3) Cópia controlada obsoleta ganha registro de recolhimento/destruição.
--  Aditivo: grupo_it_publicar continua existindo (importação de pasta usa,
--  pois são documentos já aprovados em papel).
-- ============================================================================

-- ── 1. Minuta (revisão em aprovação) ────────────────────────────────────────
create table if not exists public.grupo_it_minuta_auria (
  id uuid primary key default gen_random_uuid(),
  it_id uuid not null references public.grupo_it_auria(id) on delete cascade,
  grupo_id uuid not null,
  revisao text not null,
  arquivo_path text not null, arquivo_nome text, bytes bigint,
  observacao text, texto_busca text,
  sol_ids uuid[] not null default '{}',
  situacao text not null default 'verificacao' check (situacao in ('verificacao','aprovacao','devolvida','publicada','cancelada')),
  elaborado_por uuid default auth.uid(), elaborado_nome text, elaborado_em timestamptz not null default now(),
  verificado_por uuid, verificado_nome text, verificado_em timestamptz, verificacao_obs text,
  aprovado_por uuid, aprovado_nome text, aprovado_em timestamptz,
  devolvido_por uuid, devolvido_nome text, devolvido_em timestamptz, devolvido_motivo text,
  revisao_id uuid references public.grupo_it_revisao_auria(id) on delete set null
);
create index if not exists grupo_it_minuta_it_idx on public.grupo_it_minuta_auria(it_id);
create unique index if not exists grupo_it_minuta_aberta_uq on public.grupo_it_minuta_auria(it_id) where situacao in ('verificacao','aprovacao');
alter table public.grupo_it_minuta_auria enable row level security;
drop policy if exists grupo_itmin_sel on public.grupo_it_minuta_auria;
create policy grupo_itmin_sel on public.grupo_it_minuta_auria for select using (public.grupo_pode_editar(grupo_id,'its'));

-- assinatura do ciclo gravada também na revisão publicada (histórico)
alter table public.grupo_it_revisao_auria add column if not exists elaborado_nome text;
alter table public.grupo_it_revisao_auria add column if not exists verificado_nome text;
alter table public.grupo_it_revisao_auria add column if not exists aprovado_nome text;
alter table public.grupo_it_revisao_auria add column if not exists minuta_id uuid;

create or replace function public._it_nome() returns text language sql stable security definer set search_path to 'public' as
$$ select coalesce(nome,email) from public.usuarios_auria where id = auth.uid() $$;

create or replace function public.it_minuta_enviar(p_it uuid, p_revisao text, p_path text, p_nome text, p_bytes bigint, p_obs text, p_sols uuid[], p_texto text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_grupo uuid; v_id uuid;
begin
  select grupo_id into v_grupo from public.grupo_it_auria where id = p_it;
  if v_grupo is null then raise exception 'Documento não encontrado.'; end if;
  if not public.grupo_pode_editar(v_grupo,'its') then raise exception 'Só a Qualidade elabora revisões.'; end if;
  if coalesce(trim(p_revisao),'') = '' then raise exception 'Informe a revisão.'; end if;
  if p_path is null or p_path not like v_grupo::text || '/_its/%' then raise exception 'Caminho do arquivo inválido.'; end if;
  if exists (select 1 from public.grupo_it_minuta_auria where it_id = p_it and situacao in ('verificacao','aprovacao')) then
    raise exception 'Já existe uma revisão deste documento em aprovação.'; end if;
  if exists (select 1 from public.grupo_it_revisao_auria where it_id = p_it and revisao = trim(p_revisao)) then
    raise exception 'A revisão % já foi publicada.', trim(p_revisao); end if;
  update public.grupo_it_minuta_auria set situacao = 'cancelada' where it_id = p_it and situacao = 'devolvida';
  insert into public.grupo_it_minuta_auria (it_id, grupo_id, revisao, arquivo_path, arquivo_nome, bytes, observacao, texto_busca, sol_ids, elaborado_nome)
  values (p_it, v_grupo, trim(p_revisao), p_path, p_nome, p_bytes, nullif(trim(coalesce(p_obs,'')),''), left(p_texto,400000), coalesce(p_sols,'{}'), public._it_nome())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.it_minuta_verificar(p_id uuid, p_ok boolean, p_obs text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m record;
begin
  select * into m from public.grupo_it_minuta_auria where id = p_id for update;
  if m.id is null then raise exception 'Revisão não encontrada.'; end if;
  if not public.grupo_pode_editar(m.grupo_id,'its') then raise exception 'Sem permissão.'; end if;
  if m.situacao <> 'verificacao' then raise exception 'Esta revisão não está aguardando verificação.'; end if;
  if m.elaborado_por = auth.uid() then raise exception 'Quem elaborou não pode verificar a própria revisão.'; end if;
  if p_ok then
    update public.grupo_it_minuta_auria set situacao='aprovacao', verificado_por=auth.uid(), verificado_nome=public._it_nome(), verificado_em=now(), verificacao_obs=nullif(trim(coalesce(p_obs,'')),'') where id = p_id;
  else
    if length(trim(coalesce(p_obs,''))) < 5 then raise exception 'Diga o que precisa ser corrigido (mínimo 5 caracteres).'; end if;
    update public.grupo_it_minuta_auria set situacao='devolvida', devolvido_por=auth.uid(), devolvido_nome=public._it_nome(), devolvido_em=now(), devolvido_motivo=trim(p_obs) where id = p_id;
  end if;
end $$;

create or replace function public.it_minuta_aprovar(p_id uuid, p_ok boolean, p_obs text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare m record; v_rev uuid; s uuid;
begin
  select * into m from public.grupo_it_minuta_auria where id = p_id for update;
  if m.id is null then raise exception 'Revisão não encontrada.'; end if;
  if not public.grupo_pode_editar(m.grupo_id,'its') then raise exception 'Sem permissão.'; end if;
  if m.situacao <> 'aprovacao' then raise exception 'Esta revisão não está aguardando aprovação.'; end if;
  if m.elaborado_por = auth.uid() then raise exception 'Quem elaborou não pode aprovar a própria revisão.'; end if;
  if not p_ok then
    if length(trim(coalesce(p_obs,''))) < 5 then raise exception 'Diga o que precisa ser corrigido (mínimo 5 caracteres).'; end if;
    update public.grupo_it_minuta_auria set situacao='devolvida', devolvido_por=auth.uid(), devolvido_nome=public._it_nome(), devolvido_em=now(), devolvido_motivo=trim(p_obs) where id = p_id;
    return null;
  end if;
  v_rev := public.grupo_it_publicar(m.it_id, m.revisao, m.arquivo_path, m.arquivo_nome, m.bytes, m.observacao);
  update public.grupo_it_revisao_auria set texto_busca = m.texto_busca, elaborado_nome = m.elaborado_nome, verificado_nome = m.verificado_nome,
         aprovado_nome = public._it_nome(), minuta_id = m.id where id = v_rev;
  update public.grupo_it_minuta_auria set situacao='publicada', aprovado_por=auth.uid(), aprovado_nome=public._it_nome(), aprovado_em=now(), revisao_id=v_rev where id = p_id;
  foreach s in array m.sol_ids loop
    begin perform public.it_solicitacao_responder(s, 'atendida', 'Atendida na revisão ' || m.revisao || '.', v_rev); exception when others then null; end;
  end loop;
  return v_rev;
end $$;

create or replace function public.it_minuta_cancelar(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m record;
begin
  select * into m from public.grupo_it_minuta_auria where id = p_id;
  if m.id is null or not public.grupo_pode_editar(m.grupo_id,'its') then raise exception 'Sem permissão.'; end if;
  if m.situacao not in ('verificacao','aprovacao','devolvida') then raise exception 'Esta revisão já foi encerrada.'; end if;
  update public.grupo_it_minuta_auria set situacao = 'cancelada' where id = p_id;
end $$;

-- e-mails do ciclo: entra em verificação/aprovação → os outros da Qualidade; devolvida/publicada → quem elaborou
create or replace function public.notif_it_minuta()
returns trigger language plpgsql security definer set search_path to 'public','extensions' as $$
declare i record; v_to text[]; v_tit text; v_txt text;
begin
  if TG_OP = 'UPDATE' and NEW.situacao = OLD.situacao then return NEW; end if;
  select * into i from public.grupo_it_auria where id = NEW.it_id;
  if NEW.situacao in ('verificacao','aprovacao') then
    select array_agg(u.email) into v_to from public.usuarios_auria u
     where u.empresa_id = NEW.grupo_id and u.role = 'setor' and u.setor_area = 'qualidade' and coalesce(u.ativo,true)
       and u.id is distinct from NEW.elaborado_por and u.email is not null;
    v_tit := case NEW.situacao when 'verificacao' then 'Revisão para verificar' else 'Revisão para aprovar' end;
    v_txt := case NEW.situacao when 'verificacao' then public.auria_esc(coalesce(NEW.elaborado_nome,'')) || ' elaborou uma revisão nova. Confira o conteúdo contra a norma e o processo antes de seguir para aprovação.'
             else public.auria_esc(coalesce(NEW.verificado_nome,'')) || ' verificou a revisão. Ao aprovar, ela é publicada e passa a valer para as obras.' end;
  elsif NEW.situacao in ('devolvida','publicada') then
    select array[u.email] into v_to from public.usuarios_auria u where u.id = NEW.elaborado_por and u.email is not null;
    v_tit := case NEW.situacao when 'devolvida' then 'Revisão devolvida' else 'Revisão publicada' end;
    v_txt := case NEW.situacao when 'devolvida' then 'Sua revisão foi devolvida por ' || public.auria_esc(coalesce(NEW.devolvido_nome,'')) || ': <b>' || public.auria_esc(coalesce(NEW.devolvido_motivo,'')) || '</b>'
             else 'Sua revisão foi aprovada por ' || public.auria_esc(coalesce(NEW.aprovado_nome,'')) || ' e já vale para as obras.' end;
  else return NEW; end if;
  if v_to is null or array_length(v_to,1) is null then return NEW; end if;
  begin
    if public.auria_notif_once('itmin|' || NEW.id || '|' || NEW.situacao) then
      perform public.auria_send_email(v_to, 'Auria — ' || v_tit || ': ' || i.codigo || ' rev. ' || NEW.revisao,
        public.auria_email_shell(v_tit, i.codigo || ' — ' || i.titulo,
          '<p style="margin:0 0 12px;color:#334155;font-size:14px">' || v_txt || '</p><table style="width:100%;border-collapse:collapse;margin:2px 0 16px">'
          || public.auria_email_row('Documento', public.auria_esc(i.codigo || ' — ' || i.titulo))
          || public.auria_email_row('Revisão', public.auria_esc(NEW.revisao))
          || coalesce(public.auria_email_row('O que mudou', public.auria_esc(NEW.observacao)),'') || '</table>',
          'Abrir o painel da Qualidade', 'https://auria.solutions/qualidade.html'));
    end if;
  exception when others then null;
  end;
  return NEW;
end $$;
drop trigger if exists trg_it_minuta on public.grupo_it_minuta_auria;
create trigger trg_it_minuta after insert or update of situacao on public.grupo_it_minuta_auria
  for each row execute function public.notif_it_minuta();

-- ── 2. Distribuição + ciência ───────────────────────────────────────────────
-- publicos: 'eng_chefe','coord_campo','equipe_campo','seguranca' (papéis da obra) e 'setor:<area>'
create table if not exists public.grupo_it_dist_auria (
  it_id uuid primary key references public.grupo_it_auria(id) on delete cascade,
  grupo_id uuid not null,
  publicos text[] not null default '{}',
  obras uuid[],                       -- null = todas as obras do grupo
  atualizado_em timestamptz not null default now(), atualizado_nome text
);
alter table public.grupo_it_dist_auria enable row level security;
drop policy if exists grupo_itdist_sel on public.grupo_it_dist_auria;
create policy grupo_itdist_sel on public.grupo_it_dist_auria for select using (public.grupo_pode_ler(grupo_id));

create table if not exists public.grupo_it_ciencia_auria (
  revisao_id uuid not null references public.grupo_it_revisao_auria(id) on delete cascade,
  usuario_id uuid not null default auth.uid(),
  ciente_em timestamptz not null default now(),
  primary key (revisao_id, usuario_id)
);
alter table public.grupo_it_ciencia_auria enable row level security;
drop policy if exists grupo_itci_sel on public.grupo_it_ciencia_auria;
create policy grupo_itci_sel on public.grupo_it_ciencia_auria for select using (
  usuario_id = auth.uid() or exists (select 1 from public.grupo_it_revisao_auria r join public.grupo_it_auria i on i.id = r.it_id
     where r.id = revisao_id and public.grupo_pode_editar(i.grupo_id,'its')));

create or replace function public.it_dist_salvar(p_it uuid, p_publicos text[], p_obras uuid[])
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_grupo uuid;
begin
  select grupo_id into v_grupo from public.grupo_it_auria where id = p_it;
  if v_grupo is null or not public.grupo_pode_editar(v_grupo,'its') then raise exception 'Sem permissão.'; end if;
  insert into public.grupo_it_dist_auria (it_id, grupo_id, publicos, obras, atualizado_em, atualizado_nome)
  values (p_it, v_grupo, coalesce(p_publicos,'{}'), case when coalesce(array_length(p_obras,1),0) = 0 then null else p_obras end, now(), public._it_nome())
  on conflict (it_id) do update set publicos = excluded.publicos, obras = excluded.obras, atualizado_em = now(), atualizado_nome = excluded.atualizado_nome;
end $$;

-- Quem deve ciência de qual revisão vigente (uma linha por pessoa × obra; setor sem obra).
create or replace function public._it_ciencia_alvo(p_grupo uuid)
returns table(it_id uuid, codigo text, titulo text, revisao_id uuid, revisao text, publicado_em timestamptz,
              usuario_id uuid, nome text, email text, empreendimento_id uuid, obra text, publico text, ciente_em timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with docs as (
    select i.id it_id, i.codigo, i.titulo, r.id revisao_id, r.revisao, r.publicado_em, d.publicos, d.obras
      from public.grupo_it_auria i
      join public.grupo_it_revisao_auria r on r.it_id = i.id and r.vigente
      join public.grupo_it_dist_auria d on d.it_id = i.id
     where i.grupo_id = p_grupo and i.ativo and cardinality(d.publicos) > 0
  ), alvo as (
    select dc.*, o.usuario_id, o.empreendimento_id, e.nome obra, o.nivel publico
      from docs dc
      join public.empreendimentos_auria e on e.empresa_id = p_grupo and (dc.obras is null or e.id = any(dc.obras))
      join public.obra_empreendimento_auria o on o.empreendimento_id = e.id and coalesce(o.ativo,true) and o.nivel = any(dc.publicos)
    union all
    select dc.*, u.id, null::uuid, null::text, 'setor:' || u.setor_area
      from docs dc join public.usuarios_auria u on u.empresa_id = p_grupo and u.role = 'setor' and ('setor:' || u.setor_area) = any(dc.publicos)
  )
  select a.it_id, a.codigo, a.titulo, a.revisao_id, a.revisao, a.publicado_em, a.usuario_id, coalesce(u.nome,u.email), u.email,
         a.empreendimento_id, a.obra, a.publico, c.ciente_em
    from alvo a
    join public.usuarios_auria u on u.id = a.usuario_id and coalesce(u.ativo,true)
    left join public.grupo_it_ciencia_auria c on c.revisao_id = a.revisao_id and c.usuario_id = a.usuario_id;
$$;
revoke all on function public._it_ciencia_alvo(uuid) from anon, public, authenticated;

-- Painel da Qualidade: tudo do grupo.
create or replace function public.it_ciencia_painel(p_grupo uuid)
returns table(it_id uuid, codigo text, titulo text, revisao_id uuid, revisao text, publicado_em timestamptz,
              usuario_id uuid, nome text, email text, empreendimento_id uuid, obra text, publico text, ciente_em timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.grupo_pode_editar(p_grupo,'its') then raise exception 'Sem permissão.'; end if;
  return query select * from public._it_ciencia_alvo(p_grupo);
end $$;

-- Cada pessoa: o que ela ainda deve ler.
create or replace function public.it_minhas_ciencias()
returns table(it_id uuid, codigo text, titulo text, revisao_id uuid, revisao text, publicado_em timestamptz, ext text, lido boolean)
language sql stable security definer set search_path to 'public' as $$
  select distinct a.it_id, a.codigo, a.titulo, a.revisao_id, a.revisao, a.publicado_em,
         lower(regexp_replace(r.arquivo_path, '^.*\.', '')),
         exists (select 1 from public.grupo_it_visualizacao_auria v where v.revisao_id = a.revisao_id and v.usuario_id = auth.uid())
    from public._it_ciencia_alvo(public.minha_empresa()) a
    join public.grupo_it_revisao_auria r on r.id = a.revisao_id
   where a.usuario_id = auth.uid() and a.ciente_em is null
   order by a.publicado_em;
$$;

-- "Li e entendi": só depois de abrir a revisão (a abertura fica registrada em grupo_it_visualizacao_auria).
create or replace function public.it_ciente(p_revisao uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.grupo_it_visualizacao_auria where revisao_id = p_revisao and usuario_id = auth.uid()) then
    raise exception 'Abra o documento antes de confirmar a leitura.'; end if;
  if not exists (select 1 from public._it_ciencia_alvo(public.minha_empresa()) a where a.revisao_id = p_revisao and a.usuario_id = auth.uid()) then
    raise exception 'Este documento não está na sua lista de leitura obrigatória.'; end if;
  insert into public.grupo_it_ciencia_auria (revisao_id, usuario_id) values (p_revisao, auth.uid()) on conflict do nothing;
end $$;

-- Cobrança: resumo por pessoa, dias úteis, no máximo a cada 2 dias.
create or replace function public.it_cobrar_ciencia()
returns int language plpgsql security definer set search_path to 'public','extensions' as $$
declare g record; p record; n int := 0;
begin
  for g in select id from public.empresas_auria where coalesce(ativo,true) loop
    for p in
      select a.usuario_id, a.email, a.nome, string_agg(distinct public.auria_email_row(a.codigo || ' rev. ' || a.revisao, public.auria_esc(a.titulo)), '') linhas, count(distinct a.revisao_id) q
        from public._it_ciencia_alvo(g.id) a
       where a.ciente_em is null and a.email is not null and a.publicado_em < now() - interval '12 hours'
       group by a.usuario_id, a.email, a.nome
    loop
      begin
        if public.auria_notif_once('itci|' || p.usuario_id || '|' || floor(extract(epoch from now()) / 172800)::text) then
          perform public.auria_send_email(array[p.email], 'Auria — ' || p.q || ' documento(s) aguardando sua leitura',
            public.auria_email_shell('Leitura obrigatória', 'Documentos da qualidade',
              '<p style="margin:0 0 12px;color:#334155;font-size:14px">Olá, ' || public.auria_esc(p.nome) || '. Estes documentos foram revisados e a Qualidade pede que você leia e confirme a ciência:</p>'
              || '<table style="width:100%;border-collapse:collapse;margin:2px 0 16px">' || p.linhas || '</table>',
              'Ler e confirmar', 'https://auria.solutions/'));
          n := n + 1;
        end if;
      exception when others then null;
      end;
    end loop;
  end loop;
  return n;
end $$;

-- ── 3. Recolhimento de cópia controlada ─────────────────────────────────────
alter table public.grupo_it_copia_auria add column if not exists recolhida_em timestamptz;
alter table public.grupo_it_copia_auria add column if not exists recolhida_destino text check (recolhida_destino in ('recolhida','destruida'));
alter table public.grupo_it_copia_auria add column if not exists recolhida_por uuid;
alter table public.grupo_it_copia_auria add column if not exists recolhida_nome text;
alter table public.grupo_it_copia_auria add column if not exists recolhida_obs text;

create or replace function public.it_copia_recolher(p_id uuid, p_destino text, p_obs text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  select * into c from public.grupo_it_copia_auria where id = p_id for update;
  if c.id is null then raise exception 'Cópia não encontrada.'; end if;
  if not (public.grupo_pode_editar(c.grupo_id,'its') or c.responsavel_id = auth.uid()) then raise exception 'Sem permissão.'; end if;
  if c.obsoleta_em is null then raise exception 'Só cópia obsoleta é recolhida.'; end if;
  if c.recolhida_em is not null then raise exception 'Esta cópia já foi recolhida.'; end if;
  if p_destino not in ('recolhida','destruida') then raise exception 'Destino inválido.'; end if;
  update public.grupo_it_copia_auria set recolhida_em = now(), recolhida_destino = p_destino, recolhida_por = auth.uid(),
         recolhida_nome = public._it_nome(), recolhida_obs = nullif(trim(coalesce(p_obs,'')),'') where id = p_id;
end $$;

-- ── Permissões ──────────────────────────────────────────────────────────────
revoke all on function public.it_minuta_enviar(uuid,text,text,text,bigint,text,uuid[],text), public.it_minuta_verificar(uuid,boolean,text),
  public.it_minuta_aprovar(uuid,boolean,text), public.it_minuta_cancelar(uuid), public.it_dist_salvar(uuid,text[],uuid[]),
  public.it_ciencia_painel(uuid), public.it_minhas_ciencias(), public.it_ciente(uuid), public.it_copia_recolher(uuid,text,text),
  public.it_cobrar_ciencia(), public._it_nome() from anon, public;
grant execute on function public.it_minuta_enviar(uuid,text,text,text,bigint,text,uuid[],text), public.it_minuta_verificar(uuid,boolean,text),
  public.it_minuta_aprovar(uuid,boolean,text), public.it_minuta_cancelar(uuid), public.it_dist_salvar(uuid,text[],uuid[]),
  public.it_ciencia_painel(uuid), public.it_minhas_ciencias(), public.it_ciente(uuid), public.it_copia_recolher(uuid,text,text) to authenticated;

select cron.unschedule('it-ciencia-cobranca') where exists (select 1 from cron.job where jobname = 'it-ciencia-cobranca');
select cron.schedule('it-ciencia-cobranca', '30 11 * * 1-5', $$select public.it_cobrar_ciencia()$$);
