-- ============================================================================
--  Item 40 — JANELA DE RECEBIMENTO DE NFs (adm-fin)
--  • nf_janela_auria: o adm-fin abre/fecha o recebimento com datas; token do link
--    público (nf.html?t=TOKEN) para escritório SEM cadastro.
--  • notas_fiscais_auria aceita NF sem parcela (origem 'externa'), sempre com a
--    construtora (construtora_id) — separação por empresa.
--  • nf_enviar (projetista cadastrado) e nf_enviar_externa (Edge Function)
--    só aceitam com janela ABERTA. Chave exige_contrato prepara a fase 2
--    (só NF com contrato).
--  • nf_janela_abrir manda e-mail aos projetistas com parcela autorizada e à
--    lista de e-mails extras (link público).
--  Reaplicável.
-- ============================================================================

-- ── 1) NF sem contrato + construtora ────────────────────────────────────────
alter table public.notas_fiscais_auria alter column parcela_id drop not null;
alter table public.notas_fiscais_auria
  add column if not exists origem           text not null default 'contrato',
  add column if not exists construtora_id   uuid references public.construtoras_auria(id) on delete set null,
  add column if not exists fornecedor_razao text,
  add column if not exists fornecedor_cnpj  text,
  add column if not exists conteudo         text,      -- conteúdo entregue (descrição do projetista)
  add column if not exists parcela_txt      text,      -- parcela informada em texto livre (NF externa)
  add column if not exists janela_id        uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='nf_origem_chk') then
    alter table public.notas_fiscais_auria add constraint nf_origem_chk check (origem in ('contrato','externa'));
  end if;
end $$;
-- backfill: construtora das NFs antigas vem do empreendimento
update public.notas_fiscais_auria n set construtora_id = e.construtora_id
  from public.empreendimentos_auria e
 where e.id = n.empreendimento_id and n.construtora_id is null;

-- ── 2) Janela ───────────────────────────────────────────────────────────────
create table if not exists public.nf_janela_auria (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas_auria(id) on delete cascade,   -- grupo
  competencia    text,                                   -- '2026-09'
  abre_em        timestamptz not null,
  fecha_em       timestamptz not null,
  mensagem       text,
  exige_contrato boolean not null default false,         -- fase 2: só NF com parcela
  token          text unique not null default md5(gen_random_uuid()::text || clock_timestamp()::text),
  emails_extra   text[] not null default '{}',
  criado_por     uuid,
  criado_em      timestamptz default now(),
  check (fecha_em > abre_em)
);
create index if not exists nf_janela_emp_idx on public.nf_janela_auria(empresa_id, abre_em desc);
alter table public.nf_janela_auria enable row level security;
drop policy if exists nfj_fin_sel on public.nf_janela_auria;
create policy nfj_fin_sel on public.nf_janela_auria for select
  using (empresa_id = public.minha_empresa() and public.minha_role_auria() in ('financeiro','gerente','super_admin'));
drop policy if exists nfj_fin_w on public.nf_janela_auria;
create policy nfj_fin_w on public.nf_janela_auria for all
  using (empresa_id = public.minha_empresa() and public.minha_role_auria() in ('financeiro','super_admin'))
  with check (empresa_id = public.minha_empresa() and public.minha_role_auria() in ('financeiro','super_admin'));
grant select, insert, update, delete on public.nf_janela_auria to authenticated;
revoke all on public.nf_janela_auria from anon;

-- Janela aberta AGORA para um grupo (ou null)
create or replace function public.nf_janela_aberta(p_empresa uuid)
returns public.nf_janela_auria language sql stable security definer set search_path = public as $$
  select j from public.nf_janela_auria j
   where j.empresa_id = p_empresa and now() between j.abre_em and j.fecha_em
   order by j.fecha_em desc limit 1;
$$;

-- Estado para o PROJETISTA (a partir de uma parcela do contrato dele)
drop function if exists public.nf_janela_status_parcela(uuid);
create function public.nf_janela_status_parcela(p_parcela_id uuid)
returns table(aberta boolean, abre_em timestamptz, fecha_em timestamptz, mensagem text, proxima_abre timestamptz, proxima_fecha timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid; j public.nf_janela_auria; p record;
begin
  select e.empresa_id into v_emp
    from public.parcelas_auria pa
    join public.contratos_auria ct on ct.id = pa.contrato_id
    join public.empreendimentos_auria e on e.id = ct.empreendimento_id
   where pa.id = p_parcela_id;
  if v_emp is null then return; end if;
  j := public.nf_janela_aberta(v_emp);
  select x.abre_em, x.fecha_em into p from public.nf_janela_auria x
   where x.empresa_id = v_emp and x.abre_em > now() order by x.abre_em limit 1;
  return query select (j.id is not null), j.abre_em, j.fecha_em, j.mensagem, p.abre_em, p.fecha_em;
end $$;
grant execute on function public.nf_janela_status_parcela(uuid) to authenticated;

-- ── 3) nf_enviar (projetista cadastrado) respeita a janela ─────────────────
--  Assinatura nova: + conteúdo entregue, data de emissão e CNPJ do emissor.
drop function if exists public.nf_enviar(uuid, numeric, text, text);
create or replace function public.nf_enviar(
  p_parcela_id uuid, p_valor numeric, p_nf_numero text, p_pdf_path text,
  p_conteudo text default null, p_emitida_em date default null, p_cnpj text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare c record; v_id uuid; j public.nf_janela_auria; nx record;
begin
  select p.contrato_id, p.status as parc_status,
         ct.empreendimento_id, ct.disciplina, ct.projetista_nome, ct.projetista_email,
         e.empresa_id, e.construtora_id
    into c
  from public.parcelas_auria p
  join public.contratos_auria ct on ct.id = p.contrato_id
  join public.empreendimentos_auria e on e.id = ct.empreendimento_id
  where p.id = p_parcela_id;
  if c.contrato_id is null then raise exception 'Parcela não encontrada.'; end if;
  if lower(coalesce(c.projetista_email,'')) <> lower(auth.jwt() ->> 'email') then
    raise exception 'Sem permissão para enviar NF desta parcela.';
  end if;
  if c.parc_status <> 'autorizada' then
    raise exception 'A parcela precisa estar AUTORIZADA para enviar a NF.';
  end if;
  -- janela de recebimento
  j := public.nf_janela_aberta(c.empresa_id);
  if j.id is null then
    select x.abre_em, x.fecha_em into nx from public.nf_janela_auria x
     where x.empresa_id = c.empresa_id and x.abre_em > now() order by x.abre_em limit 1;
    if nx.abre_em is not null then
      raise exception 'Recebimento de NF fechado. Próxima janela: % a %.',
        to_char(nx.abre_em at time zone 'America/Fortaleza','DD/MM'), to_char(nx.fecha_em at time zone 'America/Fortaleza','DD/MM');
    end if;
    raise exception 'Recebimento de NF fechado. Aguarde a abertura da próxima janela pelo financeiro.';
  end if;

  insert into public.notas_fiscais_auria(
      parcela_id, contrato_id, empreendimento_id, empresa_id, construtora_id, disciplina,
      projetista_nome, projetista_email, fornecedor_cnpj, conteudo,
      nf_numero_enc, valor_enc, pdf_path, emitida_em, origem, janela_id)
  values (
      p_parcela_id, c.contrato_id, c.empreendimento_id, c.empresa_id, c.construtora_id, c.disciplina,
      c.projetista_nome, c.projetista_email,
      nullif(regexp_replace(coalesce(p_cnpj,''),'\D','','g'),''), nullif(trim(coalesce(p_conteudo,'')),''),
      pgp_sym_encrypt(coalesce(p_nf_numero,''), public.nf_key()),
      pgp_sym_encrypt((coalesce(p_valor,0))::text, public.nf_key()),
      p_pdf_path, coalesce(p_emitida_em, current_date), 'contrato', j.id)
  returning id into v_id;

  update public.parcelas_auria set status='faturada' where id = p_parcela_id;
  return v_id;
end $$;

-- ── 4) Página pública: contexto pelo token (anon) ───────────────────────────
drop function if exists public.nf_janela_publica(text);
create function public.nf_janela_publica(p_token text)
returns table(grupo text, logo_url text, competencia text, abre_em timestamptz, fecha_em timestamptz,
              mensagem text, aberta boolean, exige_contrato boolean, empreendimentos jsonb, construtoras jsonb)
language plpgsql stable security definer set search_path = public as $$
declare j record;
begin
  select x.*, g.nome as grupo_nome, g.logo_url as grupo_logo into j
    from public.nf_janela_auria x join public.empresas_auria g on g.id = x.empresa_id
   where x.token = p_token;
  if j.id is null then return; end if;
  return query select
    j.grupo_nome, j.grupo_logo, j.competencia, j.abre_em, j.fecha_em, j.mensagem,
    (now() between j.abre_em and j.fecha_em), j.exige_contrato,
    coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'nome',e.nome,'construtora_id',e.construtora_id) order by e.nome)
                from public.empreendimentos_auria e
               where e.empresa_id = j.empresa_id and e.ativo and e.deleted_at is null), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nome',c.nome) order by c.nome)
                from public.construtoras_auria c where c.grupo_id = j.empresa_id and c.ativo), '[]'::jsonb);
end $$;
grant execute on function public.nf_janela_publica(text) to anon, authenticated;

-- ── 5) NF externa (chamada pela Edge Function nf-enviar-publica, service role) ─
drop function if exists public.nf_enviar_externa(text, uuid, uuid, text, text, text, text, text, numeric, text, date);
drop function if exists public.nf_enviar_externa(text, uuid, uuid, text, text, text, text, text, numeric, text, date, text, text);
create function public.nf_enviar_externa(
  p_token text, p_empreendimento_id uuid, p_construtora_id uuid, p_disciplina text,
  p_razao text, p_cnpj text, p_email text, p_nf_numero text, p_valor numeric, p_pdf_path text, p_emitida_em date,
  p_conteudo text default null, p_parcela_txt text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare j record; v_constr uuid; v_id uuid;
begin
  select * into j from public.nf_janela_auria where token = p_token;
  if j.id is null then raise exception 'Link inválido.'; end if;
  if not (now() between j.abre_em and j.fecha_em) then raise exception 'Recebimento de NF fechado.'; end if;
  if j.exige_contrato then raise exception 'Este grupo só recebe NF de contratos cadastrados. Use o Painel do Projetista.'; end if;
  -- construtora: do empreendimento (se informado) ou escolhida diretamente
  if p_empreendimento_id is not null then
    select e.construtora_id into v_constr from public.empreendimentos_auria e
     where e.id = p_empreendimento_id and e.empresa_id = j.empresa_id;
    if not found then raise exception 'Empreendimento inválido.'; end if;
  end if;
  v_constr := coalesce(v_constr, p_construtora_id);
  if v_constr is null then raise exception 'Informe a empresa (construtora) ou o empreendimento.'; end if;
  if not exists (select 1 from public.construtoras_auria c where c.id = v_constr and c.grupo_id = j.empresa_id) then
    raise exception 'Empresa inválida.';
  end if;
  insert into public.notas_fiscais_auria(
      parcela_id, contrato_id, empreendimento_id, empresa_id, construtora_id, disciplina,
      projetista_nome, projetista_email, fornecedor_razao, fornecedor_cnpj, conteudo, parcela_txt,
      nf_numero_enc, valor_enc, pdf_path, emitida_em, origem, janela_id)
  values (
      null, null, p_empreendimento_id, j.empresa_id, v_constr, nullif(trim(p_disciplina),''),
      p_razao, lower(p_email), p_razao, nullif(regexp_replace(coalesce(p_cnpj,''),'\D','','g'),''),
      nullif(trim(coalesce(p_conteudo,'')),''), nullif(trim(coalesce(p_parcela_txt,'')),''),
      pgp_sym_encrypt(coalesce(p_nf_numero,''), public.nf_key()),
      pgp_sym_encrypt((coalesce(p_valor,0))::text, public.nf_key()),
      p_pdf_path, coalesce(p_emitida_em, current_date), 'externa', j.id)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.nf_enviar_externa(text, uuid, uuid, text, text, text, text, text, numeric, text, date, text, text) from public, anon, authenticated;

-- ── 6) nf_listar devolve origem/fornecedor/construtora (NF sem contrato) ───
drop function if exists public.nf_listar(uuid, text);
create function public.nf_listar(
  p_empreendimento_id uuid default null, p_status text default null)
returns table(
  id uuid, empreendimento text, disciplina text, projetista text,
  parcela_numero int, nf_numero text, valor numeric, status text,
  emitida_em date, criado_em timestamptz, pdf_path text, construtora text,
  parcela_id uuid, contrato_id uuid, empreendimento_id uuid,
  origem text, fornecedor_cnpj text, construtora_id uuid, janela_id uuid, conteudo text, parcela_txt text)
language plpgsql security definer stable set search_path = public, extensions as $$
begin
  if public.minha_role_auria() not in ('financeiro','gerente','super_admin','analista') then
    raise exception 'Acesso restrito ao Painel de Custos.';
  end if;
  return query
    select n.id, coalesce(e.nome, '— sem empreendimento —'), n.disciplina,
           coalesce(n.projetista_nome, n.projetista_email),
           p.numero,
           pgp_sym_decrypt(n.nf_numero_enc, public.nf_key()),
           pgp_sym_decrypt(n.valor_enc, public.nf_key())::numeric,
           n.status, n.emitida_em, n.criado_em, n.pdf_path,
           coalesce(c.nome, c2.nome), n.parcela_id, n.contrato_id, n.empreendimento_id,
           n.origem, n.fornecedor_cnpj, coalesce(n.construtora_id, e.construtora_id), n.janela_id, n.conteudo, n.parcela_txt
    from public.notas_fiscais_auria n
    left join public.empreendimentos_auria e on e.id = n.empreendimento_id
    left join public.construtoras_auria c on c.id = e.construtora_id
    left join public.construtoras_auria c2 on c2.id = n.construtora_id
    left join public.parcelas_auria p on p.id = n.parcela_id
    where (public.minha_role_auria() = 'super_admin' or n.empresa_id = public.minha_empresa())
      and (public.minha_role_auria() <> 'analista'
           or exists (select 1 from public.analista_empreendimento_auria ae
                      where ae.analista_id = auth.uid() and ae.ativo = true
                        and ae.empreendimento_id = n.empreendimento_id))
      and (p_empreendimento_id is null or n.empreendimento_id = p_empreendimento_id)
      and (p_status is null or n.status = p_status)
    order by n.criado_em desc;
end $$;
grant execute on function public.nf_listar(uuid,text) to authenticated;

-- ── 7) Abrir janela + avisos (financeiro) ───────────────────────────────────
drop function if exists public.nf_janela_abrir(timestamptz, timestamptz, text, text, text[], boolean);
create function public.nf_janela_abrir(
  p_abre timestamptz, p_fecha timestamptz, p_competencia text, p_mensagem text,
  p_emails_extra text[] default '{}', p_exige_contrato boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_grupo uuid; v_id uuid; v_tok text; v_link text; v_corpo text; v_periodo text; v_nome text; v_fin text; r record;
begin
  if public.minha_role_auria() not in ('financeiro','super_admin') then raise exception 'Só o financeiro abre janela de NF.'; end if;
  v_grupo := public.minha_empresa();
  if p_fecha <= p_abre then raise exception 'O fechamento precisa ser depois da abertura.'; end if;
  if exists (select 1 from public.nf_janela_auria x where x.empresa_id = v_grupo and x.abre_em < p_fecha and x.fecha_em > p_abre) then
    raise exception 'Já existe uma janela nesse período.';
  end if;
  insert into public.nf_janela_auria(empresa_id, competencia, abre_em, fecha_em, mensagem, emails_extra, exige_contrato, criado_por)
  values (v_grupo, nullif(p_competencia,''), p_abre, p_fecha, nullif(p_mensagem,''), coalesce(p_emails_extra,'{}'), coalesce(p_exige_contrato,false), auth.uid())
  returning id, token into v_id, v_tok;

  select g.nome into v_nome from public.empresas_auria g where g.id = v_grupo;
  select u.email into v_fin from public.usuarios_auria u where u.id = auth.uid();
  v_link := 'https://auria.solutions/nf.html?t=' || v_tok;
  v_periodo := to_char(p_abre at time zone 'America/Fortaleza','DD/MM') || ' a ' || to_char(p_fecha at time zone 'America/Fortaleza','DD/MM/YYYY');

  -- projetistas com parcela AUTORIZADA e ainda sem NF → link do painel
  for r in
    select distinct lower(ct.projetista_email) as email, coalesce(ct.projetista_nome, ct.projetista_email) as nome
      from public.parcelas_auria pa
      join public.contratos_auria ct on ct.id = pa.contrato_id
      join public.empreendimentos_auria e on e.id = ct.empreendimento_id
     where e.empresa_id = v_grupo and ct.status = 'ativo' and pa.status = 'autorizada'
       and coalesce(ct.projetista_email,'') <> ''
  loop
    v_corpo := 'Olá, ' || public.auria_esc(r.nome) || '.<br><br>O financeiro de <b>' || public.auria_esc(coalesce(v_nome,'')) ||
               '</b> abriu o recebimento de notas fiscais' || coalesce(' da competência <b>'||public.auria_esc(p_competencia)||'</b>','') ||
               ': <b>' || v_periodo || '</b>.' ||
               coalesce('<br><br>'||public.auria_esc(p_mensagem),'') ||
               '<br><br>Você tem parcela(s) autorizada(s) aguardando NF. Envie pelo Painel do Projetista dentro do prazo.';
    perform public.auria_send_email(array[r.email],
      'Recebimento de NF aberto — ' || v_periodo,
      public.auria_email_shell('Notas fiscais', 'Recebimento de NF aberto', v_corpo, 'Abrir Painel do Projetista', 'https://auria.solutions/projetista.html'),
      null, v_fin);
  end loop;

  -- e-mails extras (escritórios sem cadastro) → link público
  if coalesce(array_length(p_emails_extra,1),0) > 0 then
    v_corpo := 'O financeiro de <b>' || public.auria_esc(coalesce(v_nome,'')) || '</b> abriu o recebimento de notas fiscais' ||
               coalesce(' da competência <b>'||public.auria_esc(p_competencia)||'</b>','') || ': <b>' || v_periodo || '</b>.' ||
               coalesce('<br><br>'||public.auria_esc(p_mensagem),'') ||
               '<br><br>Envie a sua NF em PDF pelo link abaixo. Fora do período o link não aceita envios.';
    perform public.auria_send_email(array(select distinct lower(trim(x)) from unnest(p_emails_extra) x where trim(x) <> ''),
      'Recebimento de NF aberto — ' || v_periodo,
      public.auria_email_shell('Notas fiscais', 'Recebimento de NF aberto', v_corpo, 'Enviar nota fiscal', v_link),
      null, v_fin);
  end if;
  return v_id;
end $$;
grant execute on function public.nf_janela_abrir(timestamptz, timestamptz, text, text, text[], boolean) to authenticated;

-- Fechar agora / reabrir editando datas: o financeiro edita a linha (policy nfj_fin_w).

-- ── 8) forn_meu devolve o CNPJ (pré-preenche o formulário de NF do projetista) ─
drop function if exists public.forn_meu();
create function public.forn_meu()
returns table (id uuid, nome text, logo_url text, cnpj text)
language sql security definer stable set search_path to 'public' as $$
  select f.id, f.nome, f.logo_url, f.cnpj
    from public.fornecedores_auria f
   where f.id = public.forn_do_projetista();
$$;
grant execute on function public.forn_meu() to authenticated;
revoke execute on function public.forn_meu() from anon;

select 'ok' as resultado;
