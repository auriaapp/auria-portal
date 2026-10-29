-- ============================================================================
--  Qualidade F2 — Não conformidade + plano de ação (ISO 9001 10.2 / SiAC)  2026-10-28
--  Fluxo: aberta (contenção + causa) → plano (ações, aguarda a Qualidade)
--         → execucao (ações em andamento) → eficacia (todas concluídas; a
--         Qualidade verifica após o prazo) → encerrada.  Eficácia reprovada
--         reabre (rodada+1).  Reincidência: mesmo serviço no grupo em 180 dias.
--  Quem: obra (eng_chefe/coord_campo/equipe_campo) abre e executa; Qualidade
--  (grupo_pode_editar(grupo,'qualidade')) aprova o plano e verifica eficácia;
--  quem concluiu ação da NC não verifica a eficácia dela.
--  Origem automática: FVS contestada pela Qualidade ou reinspeção reprovada
--  (rodada ≥ 2). 1ª reprovação = só botão "Abrir NC" (retrabalho normal).
-- ============================================================================

create table if not exists public.nc_empreiteiro_auria (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null,
  nome text not null, cnpj text, servicos text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists nc_empreiteiro_nome_uq on public.nc_empreiteiro_auria(grupo_id, lower(nome));
alter table public.nc_empreiteiro_auria enable row level security;
drop policy if exists nc_emp_sel on public.nc_empreiteiro_auria;
create policy nc_emp_sel on public.nc_empreiteiro_auria for select using (public.grupo_pode_ler(grupo_id));

create table if not exists public.nc_auria (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null,
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  numero int not null,
  titulo text not null,
  descricao text,
  origem text not null default 'manual' check (origem in ('manual','fvs','contestacao','reinspecao','auditoria','diario','apontamento','cliente')),
  origem_id uuid, origem_rodada int, origem_ref text,
  servico text, pavimento_id uuid, local_txt text,
  tipo text not null default 'execucao' check (tipo in ('execucao','material','projeto','seguranca','documental','outro')),
  gravidade text not null default 'moderada' check (gravidade in ('leve','moderada','grave')),
  empreiteiro_id uuid references public.nc_empreiteiro_auria(id) on delete set null,
  fotos jsonb not null default '[]',
  contencao text, contencao_nome text, contencao_em timestamptz,
  causa_metodo text check (causa_metodo in ('5porques','ishikawa')),
  causa jsonb not null default '{}',
  causa_raiz text,
  situacao text not null default 'aberta' check (situacao in ('aberta','plano','execucao','eficacia','encerrada','cancelada')),
  rodada int not null default 1,
  plano_enviado_por uuid, plano_enviado_nome text, plano_enviado_em timestamptz,
  plano_aprovado_nome text, plano_aprovado_em timestamptz,
  eficacia_prevista date, eficacia_nome text, eficacia_em timestamptz, eficacia_obs text,
  reincidente_de uuid references public.nc_auria(id) on delete set null,
  aberta_por uuid default auth.uid(), aberta_nome text, aberta_em timestamptz not null default now(),
  encerrada_em timestamptz, cancelada_motivo text,
  atualizado_em timestamptz not null default now()
);
create unique index if not exists nc_numero_uq on public.nc_auria(grupo_id, numero);
create unique index if not exists nc_origem_uq on public.nc_auria(origem_id, origem_rodada) where origem_id is not null;
create index if not exists nc_emp_idx on public.nc_auria(empreendimento_id, situacao);

create table if not exists public.nc_acao_auria (
  id uuid primary key default gen_random_uuid(),
  nc_id uuid not null references public.nc_auria(id) on delete cascade,
  rodada int not null default 1,
  ordem int not null default 0,
  tipo text not null default 'corretiva' check (tipo in ('corretiva','preventiva')),
  descricao text not null,
  responsavel_id uuid, responsavel_nome text,
  prazo date not null,
  situacao text not null default 'pendente' check (situacao in ('pendente','concluida')),
  evidencia text, evidencia_fotos jsonb not null default '[]',
  concluida_por uuid, concluida_nome text, concluida_em timestamptz
);
create index if not exists nc_acao_nc_idx on public.nc_acao_auria(nc_id);
create index if not exists nc_acao_resp_idx on public.nc_acao_auria(responsavel_id) where situacao = 'pendente';

create table if not exists public.nc_evento_auria (
  id bigserial primary key,
  nc_id uuid not null references public.nc_auria(id) on delete cascade,
  tipo text not null, observacao text,
  por uuid default auth.uid(), por_nome text, em timestamptz not null default now()
);
create index if not exists nc_evento_nc_idx on public.nc_evento_auria(nc_id);

-- ── Permissões ──────────────────────────────────────────────────────────────
create or replace function public.nc_eh_qualidade(p_emp uuid) returns boolean language sql stable security definer set search_path to 'public' as
$$ select public.grupo_pode_editar((select empresa_id from public.empreendimentos_auria where id = p_emp), 'qualidade') $$;
create or replace function public.nc_pode_ler(p_emp uuid) returns boolean language sql stable security definer set search_path to 'public' as
$$ select public.nc_eh_qualidade(p_emp) or public.obra_meu_nivel(p_emp) is not null or public.estacao_pode(p_emp) $$;
create or replace function public.nc_pode_tratar(p_emp uuid) returns boolean language sql stable security definer set search_path to 'public' as
$$ select public.nc_eh_qualidade(p_emp) or coalesce(public.obra_meu_nivel(p_emp),'') in ('eng_chefe','coord_campo') $$;

alter table public.nc_auria enable row level security;
alter table public.nc_acao_auria enable row level security;
alter table public.nc_evento_auria enable row level security;
drop policy if exists nc_sel on public.nc_auria;
create policy nc_sel on public.nc_auria for select using (public.nc_pode_ler(empreendimento_id));
drop policy if exists nc_acao_sel on public.nc_acao_auria;
create policy nc_acao_sel on public.nc_acao_auria for select using (exists (select 1 from public.nc_auria n where n.id = nc_id and public.nc_pode_ler(n.empreendimento_id)));
drop policy if exists nc_ev_sel on public.nc_evento_auria;
create policy nc_ev_sel on public.nc_evento_auria for select using (exists (select 1 from public.nc_auria n where n.id = nc_id and public.nc_pode_ler(n.empreendimento_id)));

-- ── Utilitários ─────────────────────────────────────────────────────────────
create or replace function public._nc_ev(p_nc uuid, p_tipo text, p_obs text) returns void language sql security definer set search_path to 'public' as
$$ insert into public.nc_evento_auria (nc_id, tipo, observacao, por_nome) values (p_nc, p_tipo, nullif(trim(coalesce(p_obs,'')),''), coalesce(public._it_nome(),'Auria')) $$;

create or replace function public._nc_mail(p_to text[], p_nc uuid, p_tit text, p_txt text) returns void language plpgsql security definer set search_path to 'public','extensions' as $$
declare n record;
begin
  if p_to is null or coalesce(array_length(p_to,1),0) = 0 then return; end if;
  select x.*, e.nome obra into n from public.nc_auria x join public.empreendimentos_auria e on e.id = x.empreendimento_id where x.id = p_nc;
  perform public.auria_send_email(p_to, 'Auria — ' || p_tit || ': NC ' || lpad(n.numero::text,3,'0') || ' · ' || n.obra,
    public.auria_email_shell(p_tit, 'NC ' || lpad(n.numero::text,3,'0') || ' — ' || n.titulo,
      '<p style="margin:0 0 12px;color:#334155;font-size:14px">' || p_txt || '</p><table style="width:100%;border-collapse:collapse;margin:2px 0 16px">'
      || public.auria_email_row('Obra', public.auria_esc(n.obra))
      || coalesce(public.auria_email_row('Serviço', public.auria_esc(n.servico)),'')
      || public.auria_email_row('Gravidade', public.auria_esc(n.gravidade)) || '</table>',
      'Abrir a não conformidade', 'https://auria.solutions/'));
exception when others then null;
end $$;

create or replace function public._nc_qualidade_emails(p_grupo uuid) returns text[] language sql stable security definer set search_path to 'public' as
$$ select array_agg(email) from public.usuarios_auria where empresa_id = p_grupo and role = 'setor' and setor_area = 'qualidade' and coalesce(ativo,true) and email is not null $$;

-- reincidência: NC do mesmo serviço no grupo nos últimos 180 dias
create or replace function public._nc_reincidencia(p_grupo uuid, p_servico text, p_excluir uuid) returns uuid language sql stable security definer set search_path to 'public' as $$
  select id from public.nc_auria where grupo_id = p_grupo and id <> coalesce(p_excluir,'00000000-0000-0000-0000-000000000000'::uuid)
     and situacao <> 'cancelada' and coalesce(trim(p_servico),'') <> '' and lower(trim(servico)) = lower(trim(p_servico))
     and aberta_em > now() - interval '180 days' order by aberta_em desc limit 1
$$;

-- ── Abrir ───────────────────────────────────────────────────────────────────
create or replace function public.nc_abrir(p_emp uuid, p_titulo text, p_descricao text, p_servico text, p_pavimento uuid, p_local text,
                                           p_tipo text, p_gravidade text, p_empreiteiro uuid, p_fotos jsonb, p_origem text, p_origem_id uuid, p_origem_ref text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_grupo uuid; v_id uuid; v_num int;
begin
  if not (public.nc_eh_qualidade(p_emp) or public.obra_meu_nivel(p_emp) is not null) then raise exception 'Sem permissão para abrir NC nesta obra.'; end if;
  if length(trim(coalesce(p_titulo,''))) < 4 then raise exception 'Escreva o título da não conformidade.'; end if;
  select empresa_id into v_grupo from public.empreendimentos_auria where id = p_emp;
  perform pg_advisory_xact_lock(hashtext('nc' || v_grupo));
  select coalesce(max(numero),0) + 1 into v_num from public.nc_auria where grupo_id = v_grupo;
  insert into public.nc_auria (grupo_id, empreendimento_id, numero, titulo, descricao, servico, pavimento_id, local_txt, tipo, gravidade, empreiteiro_id, fotos,
                               origem, origem_id, origem_ref, aberta_nome, reincidente_de)
  values (v_grupo, p_emp, v_num, trim(p_titulo), nullif(trim(coalesce(p_descricao,'')),''), nullif(trim(coalesce(p_servico,'')),''), p_pavimento, nullif(trim(coalesce(p_local,'')),''),
          coalesce(p_tipo,'execucao'), coalesce(p_gravidade,'moderada'), p_empreiteiro, coalesce(p_fotos,'[]'),
          coalesce(nullif(p_origem,''),'manual'), p_origem_id, p_origem_ref, public._it_nome(), public._nc_reincidencia(v_grupo, p_servico, null))
  returning id into v_id;
  perform public._nc_ev(v_id, 'aberta', p_descricao);
  perform public._nc_mail(public._nc_qualidade_emails(v_grupo), v_id, 'Não conformidade aberta', 'Uma não conformidade foi registrada. A obra registra a contenção e a causa e propõe o plano de ação; a Qualidade aprova.');
  return v_id;
end $$;

-- ── Análise: contenção + causa (aberta/plano) ───────────────────────────────
create or replace function public.nc_analise_salvar(p_id uuid, p_contencao text, p_metodo text, p_causa jsonb, p_causa_raiz text,
                                                    p_tipo text, p_gravidade text, p_empreiteiro uuid, p_servico text)
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
    tipo = coalesce(p_tipo, tipo), gravidade = coalesce(p_gravidade, gravidade), empreiteiro_id = p_empreiteiro,
    servico = coalesce(nullif(trim(coalesce(p_servico,'')),''), servico),
    reincidente_de = coalesce(reincidente_de, public._nc_reincidencia(n.grupo_id, coalesce(nullif(trim(coalesce(p_servico,'')),''), n.servico), n.id)),
    atualizado_em = now()
  where id = p_id;
end $$;

-- ── Plano: grava as ações da rodada e envia para a Qualidade ─────────────────
-- p_acoes: [{tipo, descricao, responsavel_id, prazo}]
create or replace function public.nc_plano_enviar(p_id uuid, p_acoes jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare n record; a jsonb; i int := 0; v_nome text;
begin
  select * into n from public.nc_auria where id = p_id for update;
  if n.id is null or not public.nc_pode_tratar(n.empreendimento_id) then raise exception 'Sem permissão.'; end if;
  if n.situacao not in ('aberta','plano') then raise exception 'O plano já foi aprovado.'; end if;
  if n.contencao is null then raise exception 'Registre a contenção (o que foi feito na hora) antes do plano.'; end if;
  if n.causa_raiz is null then raise exception 'Registre a causa raiz antes do plano.'; end if;
  if coalesce(jsonb_array_length(p_acoes),0) = 0 then raise exception 'O plano precisa de ao menos uma ação.'; end if;
  delete from public.nc_acao_auria where nc_id = p_id and rodada = n.rodada and situacao = 'pendente';
  for a in select * from jsonb_array_elements(p_acoes) loop
    if length(trim(coalesce(a->>'descricao',''))) < 4 then raise exception 'Ação % sem descrição.', i + 1; end if;
    if nullif(a->>'prazo','') is null then raise exception 'Ação % sem prazo.', i + 1; end if;
    select coalesce(nome,email) into v_nome from public.usuarios_auria where id = nullif(a->>'responsavel_id','')::uuid;
    if v_nome is null then raise exception 'Ação % sem responsável.', i + 1; end if;
    insert into public.nc_acao_auria (nc_id, rodada, ordem, tipo, descricao, responsavel_id, responsavel_nome, prazo)
    values (p_id, n.rodada, i, coalesce(nullif(a->>'tipo',''),'corretiva'), trim(a->>'descricao'), (a->>'responsavel_id')::uuid, v_nome, (a->>'prazo')::date);
    i := i + 1;
  end loop;
  update public.nc_auria set situacao = 'plano', plano_enviado_por = auth.uid(), plano_enviado_nome = public._it_nome(), plano_enviado_em = now(), atualizado_em = now() where id = p_id;
  perform public._nc_ev(p_id, 'plano_enviado', i || ' ação(ões)');
  perform public._nc_mail(public._nc_qualidade_emails(n.grupo_id), p_id, 'Plano de ação para aprovar', public.auria_esc(public._it_nome()) || ' propôs o plano de ação. Confira a causa raiz e as ações antes de aprovar.');
end $$;

create or replace function public.nc_plano_aprovar(p_id uuid, p_ok boolean, p_obs text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare n record; v_to text[];
begin
  select * into n from public.nc_auria where id = p_id for update;
  if n.id is null or not public.nc_eh_qualidade(n.empreendimento_id) then raise exception 'Só a Qualidade aprova o plano.'; end if;
  if n.situacao <> 'plano' then raise exception 'Não há plano aguardando aprovação.'; end if;
  if p_ok then
    update public.nc_auria set situacao = 'execucao', plano_aprovado_nome = public._it_nome(), plano_aprovado_em = now(), atualizado_em = now() where id = p_id;
    perform public._nc_ev(p_id, 'plano_aprovado', p_obs);
    select array_agg(distinct u.email) into v_to from public.nc_acao_auria a join public.usuarios_auria u on u.id = a.responsavel_id
     where a.nc_id = p_id and a.rodada = n.rodada and a.situacao = 'pendente' and u.email is not null;
    perform public._nc_mail(v_to, p_id, 'Ação de não conformidade para você', 'O plano de ação foi aprovado pela Qualidade e há ação sob sua responsabilidade. Ao concluir, registre a evidência (texto e foto).');
  else
    if length(trim(coalesce(p_obs,''))) < 5 then raise exception 'Diga o que ajustar no plano (mínimo 5 caracteres).'; end if;
    update public.nc_auria set situacao = 'aberta', atualizado_em = now() where id = p_id;
    perform public._nc_ev(p_id, 'plano_devolvido', p_obs);
    select array[email] into v_to from public.usuarios_auria where id = n.plano_enviado_por and email is not null;
    perform public._nc_mail(v_to, p_id, 'Plano de ação devolvido', 'A Qualidade pediu ajustes no plano: <b>' || public.auria_esc(p_obs) || '</b>');
  end if;
end $$;

-- ── Execução: concluir ação com evidência ───────────────────────────────────
create or replace function public.nc_acao_concluir(p_acao uuid, p_evidencia text, p_fotos jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare a record; n record; v_pend int;
begin
  select * into a from public.nc_acao_auria where id = p_acao for update;
  select * into n from public.nc_auria where id = a.nc_id for update;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;
  if not (a.responsavel_id = auth.uid() or public.nc_pode_tratar(n.empreendimento_id)) then raise exception 'Só o responsável (ou eng. chefe / coord. de campo) conclui a ação.'; end if;
  if n.situacao <> 'execucao' then raise exception 'O plano ainda não foi aprovado.'; end if;
  if a.situacao = 'concluida' then raise exception 'Ação já concluída.'; end if;
  if length(trim(coalesce(p_evidencia,''))) < 5 and coalesce(jsonb_array_length(p_fotos),0) = 0 then raise exception 'Registre a evidência (texto ou foto).'; end if;
  update public.nc_acao_auria set situacao = 'concluida', evidencia = nullif(trim(coalesce(p_evidencia,'')),''), evidencia_fotos = coalesce(p_fotos,'[]'),
         concluida_por = auth.uid(), concluida_nome = public._it_nome(), concluida_em = now() where id = p_acao;
  perform public._nc_ev(n.id, 'acao_concluida', a.descricao);
  select count(*) into v_pend from public.nc_acao_auria where nc_id = n.id and rodada = n.rodada and situacao = 'pendente';
  if v_pend = 0 then
    update public.nc_auria set situacao = 'eficacia', eficacia_prevista = current_date + case n.gravidade when 'grave' then 15 else 30 end, atualizado_em = now() where id = n.id;
    perform public._nc_ev(n.id, 'aguardando_eficacia', null);
  end if;
end $$;

-- ── Eficácia: só a Qualidade; quem concluiu ação desta NC não verifica ───────
create or replace function public.nc_eficacia(p_id uuid, p_ok boolean, p_obs text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare n record; v_to text[];
begin
  select * into n from public.nc_auria where id = p_id for update;
  if n.id is null or not public.nc_eh_qualidade(n.empreendimento_id) then raise exception 'Só a Qualidade verifica a eficácia.'; end if;
  if n.situacao <> 'eficacia' then raise exception 'A NC não está aguardando verificação de eficácia.'; end if;
  if exists (select 1 from public.nc_acao_auria where nc_id = p_id and concluida_por = auth.uid()) then raise exception 'Quem executou ação desta NC não verifica a eficácia dela.'; end if;
  if length(trim(coalesce(p_obs,''))) < 5 then raise exception 'Descreva o que foi verificado (mínimo 5 caracteres).'; end if;
  if p_ok then
    update public.nc_auria set situacao = 'encerrada', eficacia_nome = public._it_nome(), eficacia_em = now(), eficacia_obs = trim(p_obs), encerrada_em = now(), atualizado_em = now() where id = p_id;
    perform public._nc_ev(p_id, 'encerrada', p_obs);
  else
    update public.nc_auria set situacao = 'aberta', rodada = rodada + 1, eficacia_prevista = null, plano_aprovado_nome = null, plano_aprovado_em = null, atualizado_em = now() where id = p_id;
    perform public._nc_ev(p_id, 'ineficaz_reaberta', p_obs);
    select array_agg(u.email) into v_to from public.obra_empreendimento_auria o join public.usuarios_auria u on u.id = o.usuario_id
     where o.empreendimento_id = n.empreendimento_id and coalesce(o.ativo,true) and o.nivel in ('eng_chefe','coord_campo') and u.email is not null;
    perform public._nc_mail(v_to, p_id, 'Ação ineficaz — NC reaberta', 'A Qualidade verificou que o problema persiste: <b>' || public.auria_esc(p_obs) || '</b>. Revise a causa raiz e proponha novo plano.');
  end if;
end $$;

create or replace function public.nc_cancelar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare n record;
begin
  select * into n from public.nc_auria where id = p_id for update;
  if n.id is null or not public.nc_eh_qualidade(n.empreendimento_id) then raise exception 'Só a Qualidade cancela uma NC.'; end if;
  if n.situacao in ('encerrada','cancelada') then raise exception 'NC já encerrada.'; end if;
  if length(trim(coalesce(p_motivo,''))) < 5 then raise exception 'Informe o motivo.'; end if;
  update public.nc_auria set situacao = 'cancelada', cancelada_motivo = trim(p_motivo), atualizado_em = now() where id = p_id;
  perform public._nc_ev(p_id, 'cancelada', p_motivo);
end $$;

create or replace function public.nc_empreiteiro_add(p_grupo uuid, p_nome text, p_cnpj text, p_servicos text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not (public.grupo_pode_editar(p_grupo,'qualidade') or exists (select 1 from public.obra_empreendimento_auria o join public.empreendimentos_auria e on e.id = o.empreendimento_id
           where e.empresa_id = p_grupo and o.usuario_id = auth.uid() and coalesce(o.ativo,true) and o.nivel in ('eng_chefe','coord_campo'))) then raise exception 'Sem permissão.'; end if;
  if length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe o nome do empreiteiro.'; end if;
  insert into public.nc_empreiteiro_auria (grupo_id, nome, cnpj, servicos) values (p_grupo, trim(p_nome), nullif(trim(coalesce(p_cnpj,'')),''), nullif(trim(coalesce(p_servicos,'')),''))
  on conflict (grupo_id, lower(nome)) do update set ativo = true
  returning id into v_id;
  return v_id;
end $$;

-- pessoas que podem receber ação na obra
create or replace function public.nc_pessoas(p_emp uuid)
returns table(id uuid, nome text, papel text) language sql stable security definer set search_path to 'public' as $$
  select u.id, coalesce(u.nome,u.email), o.nivel from public.obra_empreendimento_auria o join public.usuarios_auria u on u.id = o.usuario_id
   where public.nc_pode_ler(p_emp) and o.empreendimento_id = p_emp and coalesce(o.ativo,true) and coalesce(u.ativo,true)
  union
  select u.id, coalesce(u.nome,u.email), 'setor:qualidade' from public.usuarios_auria u join public.empreendimentos_auria e on e.id = p_emp
   where public.nc_pode_ler(p_emp) and u.empresa_id = e.empresa_id and u.role = 'setor' and u.setor_area = 'qualidade' and coalesce(u.ativo,true)
  order by 2
$$;

-- ── Origem automática: FVS contestada ou reinspeção reprovada ───────────────
create or replace function public.nc_de_fvs()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_grupo uuid; v_num int; v_id uuid; v_origem text; v_itens text;
begin
  if coalesce(new.tipo,'fvs') <> 'fvs' or new.situacao <> 'reprovada' then return new; end if;
  if tg_op = 'UPDATE' and old.situacao = 'reprovada' and old.rodada = new.rodada then return new; end if;
  v_origem := case when new.reprovado_origem = 'qualidade' then 'contestacao' when coalesce(new.rodada,1) >= 2 then 'reinspecao' else null end;
  if v_origem is null then return new; end if;
  select empresa_id into v_grupo from public.empreendimentos_auria where id = new.empreendimento_id;
  select string_agg('• ' || (e->>'item') || coalesce(' — ' || nullif(e->>'obs',''), ''), E'\n') into v_itens
    from jsonb_array_elements(coalesce(new.itens,'[]')) e where e->>'resultado' = 'nc';
  perform pg_advisory_xact_lock(hashtext('nc' || v_grupo));
  select coalesce(max(numero),0) + 1 into v_num from public.nc_auria where grupo_id = v_grupo;
  insert into public.nc_auria (grupo_id, empreendimento_id, numero, titulo, descricao, servico, pavimento_id, local_txt, origem, origem_id, origem_rodada, origem_ref, aberta_nome, reincidente_de,
                               gravidade, aberta_por)
  values (v_grupo, new.empreendimento_id, v_num,
          case v_origem when 'contestacao' then 'Ficha contestada pela Qualidade — ' else 'Reinspeção reprovada — ' end || coalesce(new.servico,''),
          concat_ws(E'\n\n', nullif(new.reprovado_motivo,''), v_itens), new.servico, new.pavimento_id, new.local_txt, v_origem, new.id, new.rodada,
          coalesce(new.codigo,'FVS') || ' · rodada ' || coalesce(new.rodada,1), coalesce(new.reprovado_nome,'Auria'),
          public._nc_reincidencia(v_grupo, new.servico, null), case v_origem when 'contestacao' then 'grave' else 'moderada' end, null)
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.nc_evento_auria (nc_id, tipo, observacao, por_nome) values (v_id, 'aberta', 'Gerada automaticamente: ' || coalesce(new.codigo,'FVS') || ' rodada ' || coalesce(new.rodada,1), coalesce(new.reprovado_nome,'Auria'));
    perform public._nc_mail(public._nc_qualidade_emails(v_grupo), v_id, 'Não conformidade aberta', 'Gerada automaticamente a partir de uma FVS (' || case v_origem when 'contestacao' then 'contestada pela Qualidade' else 'reinspeção reprovada' end || ').');
  end if;
  return new;
exception when others then return new;   -- nunca travar a FVS por causa da NC
end $$;
drop trigger if exists trg_nc_de_fvs on public.fvs_inspecao_auria;
create trigger trg_nc_de_fvs after insert or update of situacao, rodada on public.fvs_inspecao_auria
  for each row execute function public.nc_de_fvs();

-- ── Cobrança de ações atrasadas (dias úteis) ────────────────────────────────
create or replace function public.nc_cobrar_acoes()
returns int language plpgsql security definer set search_path to 'public','extensions' as $$
declare p record; n int := 0;
begin
  for p in
    select u.id, u.email, coalesce(u.nome,u.email) nome,
           string_agg(public.auria_email_row('NC ' || lpad(x.numero::text,3,'0') || ' · ' || e.nome, public.auria_esc(a.descricao) || ' — prazo ' || to_char(a.prazo,'DD/MM')), '') linhas, count(*) q
      from public.nc_acao_auria a join public.nc_auria x on x.id = a.nc_id and x.situacao = 'execucao' and a.rodada = x.rodada
      join public.empreendimentos_auria e on e.id = x.empreendimento_id
      join public.usuarios_auria u on u.id = a.responsavel_id and u.email is not null and coalesce(u.ativo,true)
     where a.situacao = 'pendente' and a.prazo < current_date
     group by u.id, u.email, u.nome
  loop
    begin
      if public.auria_notif_once('ncac|' || p.id || '|' || current_date) then
        perform public.auria_send_email(array[p.email], 'Auria — ' || p.q || ' ação(ões) de não conformidade atrasada(s)',
          public.auria_email_shell('Ações atrasadas', 'Não conformidades',
            '<p style="margin:0 0 12px;color:#334155;font-size:14px">Olá, ' || public.auria_esc(p.nome) || '. Estas ações passaram do prazo. Conclua e registre a evidência no Auria:</p><table style="width:100%;border-collapse:collapse;margin:2px 0 16px">' || p.linhas || '</table>',
            'Abrir o Auria', 'https://auria.solutions/'));
        n := n + 1;
      end if;
    exception when others then null;
    end;
  end loop;
  return n;
end $$;

revoke all on function public.nc_abrir(uuid,text,text,text,uuid,text,text,text,uuid,jsonb,text,uuid,text), public.nc_analise_salvar(uuid,text,text,jsonb,text,text,text,uuid,text),
  public.nc_plano_enviar(uuid,jsonb), public.nc_plano_aprovar(uuid,boolean,text), public.nc_acao_concluir(uuid,text,jsonb), public.nc_eficacia(uuid,boolean,text),
  public.nc_cancelar(uuid,text), public.nc_empreiteiro_add(uuid,text,text,text), public.nc_pessoas(uuid), public.nc_cobrar_acoes(),
  public._nc_ev(uuid,text,text), public._nc_mail(text[],uuid,text,text), public._nc_qualidade_emails(uuid), public._nc_reincidencia(uuid,text,uuid),
  public.nc_eh_qualidade(uuid), public.nc_pode_ler(uuid), public.nc_pode_tratar(uuid) from anon, public;
revoke all on function public._nc_ev(uuid,text,text), public._nc_mail(text[],uuid,text,text), public._nc_qualidade_emails(uuid), public._nc_reincidencia(uuid,text,uuid), public.nc_cobrar_acoes() from authenticated;
grant execute on function public.nc_abrir(uuid,text,text,text,uuid,text,text,text,uuid,jsonb,text,uuid,text), public.nc_analise_salvar(uuid,text,text,jsonb,text,text,text,uuid,text),
  public.nc_plano_enviar(uuid,jsonb), public.nc_plano_aprovar(uuid,boolean,text), public.nc_acao_concluir(uuid,text,jsonb), public.nc_eficacia(uuid,boolean,text),
  public.nc_cancelar(uuid,text), public.nc_empreiteiro_add(uuid,text,text,text), public.nc_pessoas(uuid),
  public.nc_eh_qualidade(uuid), public.nc_pode_ler(uuid), public.nc_pode_tratar(uuid) to authenticated;

select cron.unschedule('nc-acoes-cobranca') where exists (select 1 from cron.job where jobname = 'nc-acoes-cobranca');
select cron.schedule('nc-acoes-cobranca', '45 11 * * 1-5', $$select public.nc_cobrar_acoes()$$);

-- ── Fotos da NC no R2: <emp>/_qualidade/nc/<uuid>/<arquivo> (obra e Qualidade gravam) ──
-- Edita só o trecho de gravação de _qualidade dentro de cde_r2_pode (resto intacto).
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cde_r2_pode(text,boolean)'::regprocedure);
  if position('(fvs|conc|nc)' in d) > 0 then return; end if;
  n := replace(d, '/_qualidade/(fvs|conc)/[0-9a-f-]{36}/[^/]+$'' and p_path !~ ''\.\.''',
                  '/_qualidade/(fvs|conc|nc)/[0-9a-f-]{36}/[^/]+$'' and p_path !~ ''\.\.''');
  n := replace(n, 'and public.obra_meu_nivel(v_emp) in (''eng_chefe'',''coord_campo'',''equipe_campo'',''seguranca'');',
                  'and (public.obra_meu_nivel(v_emp) in (''eng_chefe'',''coord_campo'',''equipe_campo'',''seguranca'')'
               || ' or (p_path ~ ''/_qualidade/nc/'' and public.grupo_pode_editar((select empresa_id from public.empreendimentos_auria where id = v_emp), ''qualidade'')));');
  if n = d or position('(fvs|conc|nc)' in n) = 0 or position('/_qualidade/nc/'' and public.grupo_pode_editar' in n) = 0 then
    raise exception 'cde_r2_pode: trecho esperado não encontrado — não alterado.'; end if;
  execute n;
end $$;
