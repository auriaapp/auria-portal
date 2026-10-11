-- 218a: solicitação de revisão de norma (Biblioteca normativa). Qualquer leitor pede; a Qualidade analisa.
-- situacao: aberta → em_analise → atendida | recusada. E-mail: nova → Qualidade; mudança → solicitante.
create table if not exists public.grupo_it_solicitacao_auria (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  grupo_id uuid not null,
  it_id uuid not null references public.grupo_it_auria(id) on delete cascade,
  revisao_id uuid references public.grupo_it_revisao_auria(id) on delete set null,
  motivo text not null check (motivo in ('erro','desatualizado','melhoria','duvida')),
  descricao text not null check (length(trim(descricao)) >= 5),
  pagina text,
  foto_path text,
  empreendimento_id uuid references public.empreendimentos_auria(id),
  solicitante_id uuid not null default auth.uid(),
  solicitante_nome text,
  situacao text not null default 'aberta' check (situacao in ('aberta','em_analise','atendida','recusada')),
  resposta text,
  respondido_por uuid, respondido_nome text, respondido_em timestamptz,
  atendida_revisao_id uuid references public.grupo_it_revisao_auria(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists grupo_it_sol_it_idx on public.grupo_it_solicitacao_auria(it_id) where situacao in ('aberta','em_analise');
alter table public.grupo_it_solicitacao_auria enable row level security;
drop policy if exists grupo_itsol_sel on public.grupo_it_solicitacao_auria;
create policy grupo_itsol_sel on public.grupo_it_solicitacao_auria for select using (
  solicitante_id = auth.uid() or public.grupo_pode_editar(grupo_id,'its')
  or (public.grupo_pode_ler(grupo_id) and situacao in ('aberta','em_analise')));

create or replace function public.it_solicitar_revisao(p_it uuid, p_motivo text, p_descricao text, p_pagina text, p_emp uuid)
returns bigint language plpgsql security definer set search_path to 'public' as $$
declare v record; v_num bigint; v_nome text;
begin
  select i.id, i.grupo_id, (select r.id from public.grupo_it_revisao_auria r where r.it_id=i.id and r.vigente) rev
    into v from public.grupo_it_auria i where i.id = p_it;
  if v.id is null or not public.grupo_pode_ler(v.grupo_id) then raise exception 'Documento não encontrado.'; end if;
  select coalesce(nullif(trim(nome),''),email) into v_nome from public.usuarios_auria where id = auth.uid();
  insert into public.grupo_it_solicitacao_auria as s (grupo_id,it_id,revisao_id,motivo,descricao,pagina,empreendimento_id,solicitante_nome)
  values (v.grupo_id, p_it, v.rev, p_motivo, trim(p_descricao), nullif(trim(coalesce(p_pagina,'')),''), p_emp, v_nome)
  returning s.numero into v_num;
  return v_num;
end $$;

create or replace function public.it_solicitacao_responder(p_id uuid, p_situacao text, p_resposta text, p_revisao uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare s record; v_nome text;
begin
  select * into s from public.grupo_it_solicitacao_auria where id = p_id;
  if s.id is null or not public.grupo_pode_editar(s.grupo_id,'its') then raise exception 'Só o setor de Qualidade responde solicitações.'; end if;
  if p_situacao not in ('em_analise','atendida','recusada','aberta') then raise exception 'Situação inválida.'; end if;
  if p_situacao = 'recusada' and length(trim(coalesce(p_resposta,''))) < 5 then raise exception 'Escreva a justificativa da recusa.'; end if;
  select coalesce(nullif(trim(nome),''),email) into v_nome from public.usuarios_auria where id = auth.uid();
  update public.grupo_it_solicitacao_auria
     set situacao = p_situacao, resposta = coalesce(nullif(trim(coalesce(p_resposta,'')),''), resposta),
         respondido_por = auth.uid(), respondido_nome = v_nome, respondido_em = now(),
         atendida_revisao_id = case when p_situacao = 'atendida' then coalesce(p_revisao, atendida_revisao_id) else atendida_revisao_id end
   where id = p_id;
end $$;
revoke all on function public.it_solicitar_revisao(uuid,text,text,text,uuid), public.it_solicitacao_responder(uuid,text,text,uuid) from anon, public;
grant execute on function public.it_solicitar_revisao(uuid,text,text,text,uuid), public.it_solicitacao_responder(uuid,text,text,uuid) to authenticated;

create or replace function public.notif_it_solicitacao()
returns trigger language plpgsql security definer set search_path to 'public','extensions' as $$
declare i record; dest text[]; v_mail text; rot text; mot text;
begin
  select * into i from public.grupo_it_auria where id = NEW.it_id;
  mot := case NEW.motivo when 'erro' then 'Erro no texto' when 'desatualizado' then 'Procedimento desatualizado' when 'melhoria' then 'Sugestão de melhoria' else 'Dúvida' end;
  if TG_OP = 'INSERT' then
    select array_agg(u.email) into dest from public.usuarios_auria u
     where u.empresa_id = NEW.grupo_id and u.role = 'setor' and u.setor_area = 'qualidade' and coalesce(u.ativo,true);
    if dest is null then return NEW; end if;
    perform public.auria_send_email(dest, 'Auria — solicitação de revisão nº '||NEW.numero||': '||i.codigo,
      public.auria_email_shell('Solicitação de revisão', i.codigo||' — '||i.titulo,
        '<table style="width:100%;border-collapse:collapse;margin:2px 0 16px">'
        ||public.auria_email_row('Solicitante', public.auria_esc(NEW.solicitante_nome))
        ||public.auria_email_row('Motivo', mot)
        ||coalesce(public.auria_email_row('Página / item', public.auria_esc(NEW.pagina)),'')
        ||public.auria_email_row('Descrição', public.auria_esc(NEW.descricao))||'</table>',
        'Abrir solicitações', 'https://auria.solutions/padroes_grupo.html?aba=its&sol=1'));
  elsif NEW.situacao is distinct from OLD.situacao and NEW.situacao <> 'aberta' then
    select email into v_mail from public.usuarios_auria where id = NEW.solicitante_id;
    if v_mail is null then return NEW; end if;
    rot := case NEW.situacao when 'em_analise' then 'Em análise' when 'atendida' then 'Atendida' else 'Recusada' end;
    perform public.auria_send_email(array[v_mail], 'Auria — sua solicitação nº '||NEW.numero||' ('||i.codigo||'): '||rot,
      public.auria_email_shell('Solicitação de revisão · '||rot, i.codigo||' — '||i.titulo,
        '<p style="margin:0 0 12px;color:#334155;font-size:14px">'||case NEW.situacao
          when 'em_analise' then 'A Qualidade começou a analisar o seu pedido.'
          when 'atendida' then 'O seu pedido foi atendido'||coalesce(' na revisão <b>'||(select public.auria_esc(r.revisao) from public.grupo_it_revisao_auria r where r.id = NEW.atendida_revisao_id)||'</b>','')||'.'
          else 'O seu pedido não foi aceito.' end||'</p>'
        ||'<table style="width:100%;border-collapse:collapse;margin:2px 0 16px">'
        ||public.auria_email_row('Seu pedido', public.auria_esc(NEW.descricao))
        ||coalesce(public.auria_email_row('Resposta da Qualidade', public.auria_esc(NEW.resposta)),'')||'</table>',
        'Ver a norma', 'https://auria.solutions/padroes_grupo.html?aba=its'));
  end if;
  return NEW;
exception when others then return NEW;
end $$;
drop trigger if exists trg_it_solicitacao on public.grupo_it_solicitacao_auria;
create trigger trg_it_solicitacao after insert or update of situacao on public.grupo_it_solicitacao_auria
  for each row execute function public.notif_it_solicitacao();
