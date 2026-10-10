-- ============================================================================
--  Biblioteca normativa do grupo (substitui o controle de documentos externo)
--  - tipo/família/validade nos documentos; texto indexado p/ busca nos PDFs
--  - histórico de revisões só para quem mantém a biblioteca (grupo_pode_editar 'its')
--  - cópia controlada por obra + responsável, carimbada pela Edge Function it-copia
--  - arquivo cru no R2 só para quem mantém; revisão nova → cópias obsoletas + e-mail
-- ============================================================================
alter table public.grupo_it_auria add column if not exists tipo text not null default 'IT';
alter table public.grupo_it_auria add column if not exists familia text not null default 'grupo';
alter table public.grupo_it_auria add column if not exists validade date;
alter table public.grupo_it_revisao_auria add column if not exists texto_busca text;
create index if not exists grupo_itrev_txt_idx on public.grupo_it_revisao_auria using gin (to_tsvector('portuguese', coalesce(texto_busca,''))) where vigente;

drop policy if exists grupo_itrev_sel on public.grupo_it_revisao_auria;
create policy grupo_itrev_sel on public.grupo_it_revisao_auria for select using (
  exists (select 1 from public.grupo_it_auria i where i.id = grupo_it_revisao_auria.it_id
          and public.grupo_pode_ler(i.grupo_id)
          and (grupo_it_revisao_auria.vigente or public.grupo_pode_editar(i.grupo_id,'its'))));

create table if not exists public.grupo_it_copia_auria (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  grupo_id uuid not null,
  it_id uuid not null references public.grupo_it_auria(id) on delete cascade,
  revisao_id uuid not null references public.grupo_it_revisao_auria(id) on delete cascade,
  empreendimento_id uuid not null references public.empreendimentos_auria(id),
  responsavel_id uuid not null references public.usuarios_auria(id),
  quantidade int not null default 1 check (quantidade between 1 and 50),
  emitido_por uuid not null default auth.uid(),
  emitido_em timestamptz not null default now(),
  obsoleta_em timestamptz,
  avisado_em timestamptz
);
create index if not exists grupo_it_copia_it_idx on public.grupo_it_copia_auria(it_id) where obsoleta_em is null;
alter table public.grupo_it_copia_auria enable row level security;
drop policy if exists grupo_itcop_sel on public.grupo_it_copia_auria;
create policy grupo_itcop_sel on public.grupo_it_copia_auria for select using (
  public.grupo_pode_editar(grupo_id,'its') or emitido_por = auth.uid() or responsavel_id = auth.uid());

create table if not exists public.grupo_it_visualizacao_auria (
  id bigint generated always as identity primary key,
  revisao_id uuid not null references public.grupo_it_revisao_auria(id) on delete cascade,
  usuario_id uuid not null default auth.uid(),
  em timestamptz not null default now()
);
alter table public.grupo_it_visualizacao_auria enable row level security;
drop policy if exists grupo_itvis_sel on public.grupo_it_visualizacao_auria;
create policy grupo_itvis_sel on public.grupo_it_visualizacao_auria for select using (
  usuario_id = auth.uid() or exists (select 1 from public.grupo_it_revisao_auria r join public.grupo_it_auria i on i.id=r.it_id
     where r.id = revisao_id and public.grupo_pode_editar(i.grupo_id,'its')));

create or replace function public.it_obra_pessoas(p_emp uuid)
returns table(id uuid, nome text, email text)
language sql stable security definer set search_path to 'public' as $$
  select distinct u.id, coalesce(u.nome,u.email), u.email
  from public.usuarios_auria u
  join public.empreendimentos_auria e on e.id = p_emp
  where public.grupo_pode_ler(e.empresa_id) and coalesce(u.ativo,true)
    and ( exists (select 1 from public.obra_empreendimento_auria o where o.empreendimento_id=p_emp and o.usuario_id=u.id and coalesce(o.ativo,true))
       or exists (select 1 from public.setor_empreendimento_auria s where s.empreendimento_id=p_emp and s.usuario_id=u.id and coalesce(s.ativo,true))
       or exists (select 1 from public.analista_empreendimento_auria a where a.empreendimento_id=p_emp and a.analista_id=u.id) )
  order by 2;
$$;

create or replace function public.it_copia_registrar(p_revisao uuid, p_emp uuid, p_resp uuid, p_qtd int)
returns table(copia_id uuid, numero bigint, arquivo_path text, codigo text, titulo text, revisao text, obra text, responsavel text, emitente text)
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_obra text; v_resp text; v_id uuid; v_num bigint; v_emit text;
begin
  select rv.id, rv.it_id, rv.vigente, rv.arquivo_path, rv.revisao, i.grupo_id, i.codigo, i.titulo, i.ativo
    into r from public.grupo_it_revisao_auria rv join public.grupo_it_auria i on i.id = rv.it_id where rv.id = p_revisao;
  if r.id is null or not public.grupo_pode_ler(r.grupo_id) then raise exception 'Documento não encontrado.'; end if;
  if not r.vigente or not r.ativo then raise exception 'Só a revisão vigente pode ser copiada.'; end if;
  select e.nome into v_obra from public.empreendimentos_auria e where e.id = p_emp and e.empresa_id = r.grupo_id and e.deleted_at is null;
  if v_obra is null then raise exception 'Obra inválida.'; end if;
  select p.nome into v_resp from public.it_obra_pessoas(p_emp) p where p.id = p_resp;
  if v_resp is null then raise exception 'O responsável precisa ser da obra escolhida.'; end if;
  if coalesce(p_qtd,0) < 1 or p_qtd > 50 then raise exception 'Quantidade entre 1 e 50.'; end if;
  insert into public.grupo_it_copia_auria as c (grupo_id,it_id,revisao_id,empreendimento_id,responsavel_id,quantidade)
    values (r.grupo_id, r.it_id, r.id, p_emp, p_resp, p_qtd) returning c.id, c.numero into v_id, v_num;
  select coalesce(u.nome,u.email) into v_emit from public.usuarios_auria u where u.id = auth.uid();
  return query select v_id, v_num, r.arquivo_path, r.codigo, r.titulo, r.revisao, v_obra, v_resp, v_emit;
end $$;

create or replace function public.it_ver_path(p_revisao uuid)
returns table(arquivo_path text, codigo text, revisao text, vigente boolean, editor boolean, usuario text)
language plpgsql security definer set search_path to 'public' as $$
begin
  return query select rv.arquivo_path, i.codigo, rv.revisao, rv.vigente, public.grupo_pode_editar(i.grupo_id,'its'),
         (select coalesce(u.nome,u.email) from public.usuarios_auria u where u.id = auth.uid())
  from public.grupo_it_revisao_auria rv join public.grupo_it_auria i on i.id = rv.it_id
  where rv.id = p_revisao and public.grupo_pode_ler(i.grupo_id)
    and (rv.vigente or public.grupo_pode_editar(i.grupo_id,'its'));
  if found then insert into public.grupo_it_visualizacao_auria(revisao_id) values (p_revisao); end if;
end $$;

create or replace function public.it_indexar(p_revisao uuid, p_texto text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.grupo_it_revisao_auria r join public.grupo_it_auria i on i.id=r.it_id
                 where r.id=p_revisao and public.grupo_pode_editar(i.grupo_id,'its')) then raise exception 'Sem permissão.'; end if;
  update public.grupo_it_revisao_auria set texto_busca = left(p_texto, 400000) where id = p_revisao;
end $$;

create or replace function public.it_buscar(p_grupo uuid, p_q text)
returns table(it_id uuid, trecho text)
language sql stable security definer set search_path to 'public' as $$
  select i.id, ts_headline('portuguese', r.texto_busca, websearch_to_tsquery('portuguese', p_q),
         'StartSel=«,StopSel=»,MaxWords=22,MinWords=10,MaxFragments=1')
  from public.grupo_it_auria i join public.grupo_it_revisao_auria r on r.it_id=i.id and r.vigente
  where i.grupo_id = p_grupo and public.grupo_pode_ler(p_grupo)
    and to_tsvector('portuguese', coalesce(r.texto_busca,'')) @@ websearch_to_tsquery('portuguese', p_q)
  limit 200;
$$;

revoke all on function public.it_copia_registrar(uuid,uuid,uuid,int), public.it_ver_path(uuid), public.it_obra_pessoas(uuid), public.it_indexar(uuid,text), public.it_buscar(uuid,text) from anon, public;
grant execute on function public.it_copia_registrar(uuid,uuid,uuid,int), public.it_ver_path(uuid), public.it_obra_pessoas(uuid), public.it_indexar(uuid,text), public.it_buscar(uuid,text) to authenticated;

-- cde_r2_pode: só muda o bloco _its (leitura crua apenas para quem mantém)
create or replace function public.cde_r2_pode(p_path text, p_write boolean)
 returns boolean language plpgsql stable security definer set search_path to 'public','storage' as $function$
declare v_emp uuid;
begin
  if p_path is null or length(p_path)=0 then return false; end if;
  if p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/_diario/' then
    v_emp := split_part(p_path, '/', 1)::uuid;
    if p_write then
      return p_path ~ '^[0-9a-f-]{36}/_diario/[0-9a-f-]{36}/[A-Za-z0-9_.-]+\.pdf$' and p_path !~ '\.\.'
         and public.cde_rdo_pode_escrever(v_emp);
    else
      return public.obra_meu_nivel(v_emp) is not null or public.estacao_pode(v_emp);
    end if;
  end if;
  if p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/_seguranca/' then
    v_emp := split_part(p_path, '/', 1)::uuid;
    if p_write then
      if p_path ~ '^[0-9a-f-]{36}/_seguranca/ocorrencias/[0-9a-f-]{36}/[^/]+$' and p_path !~ '\.\.' then
        return public.obra_meu_nivel(v_emp) is not null;
      end if;
      return public.obra_meu_nivel(v_emp) = 'seguranca';
    else
      return public.obra_meu_nivel(v_emp) is not null or public.estacao_pode(v_emp);
    end if;
  end if;
  if p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/_qualidade/' then
    v_emp := split_part(p_path, '/', 1)::uuid;
    if p_write then
      return p_path ~ '^[0-9a-f-]{36}/_qualidade/(fvs|conc)/[0-9a-f-]{36}/[^/]+$' and p_path !~ '\.\.'
         and public.obra_meu_nivel(v_emp) in ('eng_chefe','coord_campo','equipe_campo','seguranca');
    else
      return public.obra_meu_nivel(v_emp) is not null or public.estacao_pode(v_emp)
          or public.grupo_pode_editar((select empresa_id from public.empreendimentos_auria where id = v_emp), 'qualidade');
    end if;
  end if;
  if p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/_its/' then
    v_emp := split_part(p_path, '/', 1)::uuid;
    return public.grupo_pode_editar(v_emp, 'its');
  end if;
  if p_write then
    return public.cde_pode_path(p_path) or public.cde_path_projetista_grava(p_path);
  else
    return public.cde_pode_path(p_path) or public.cde_path_projetista_le(p_path) or public.cde_path_acc_le(p_path);
  end if;
end;
$function$;

create or replace function public.notif_it_nova_revisao()
returns trigger language plpgsql security definer set search_path to 'public','extensions' as $$
declare i record; c record;
begin
  if not NEW.vigente then return NEW; end if;
  select * into i from public.grupo_it_auria where id = NEW.it_id;
  for c in
    select u.email, coalesce(u.nome,u.email) nome, e.nome obra, max(rv.revisao) rev_antiga, array_agg(cp.id) ids
      from public.grupo_it_copia_auria cp
      join public.usuarios_auria u on u.id = cp.responsavel_id
      join public.empreendimentos_auria e on e.id = cp.empreendimento_id
      join public.grupo_it_revisao_auria rv on rv.id = cp.revisao_id
     where cp.it_id = NEW.it_id and cp.revisao_id <> NEW.id and cp.obsoleta_em is null
     group by u.email, u.nome, e.nome
  loop
    update public.grupo_it_copia_auria set obsoleta_em = now() where id = any(c.ids);
    begin
      if public.auria_notif_once('itrev|'||NEW.id::text||'|'||c.email||'|'||c.obra) then
        perform public.auria_send_email(array[c.email],
          'Auria — nova revisão: '||i.codigo||' rev. '||NEW.revisao,
          public.auria_email_shell('Documento revisado', i.codigo||' — '||i.titulo,
            '<p style="margin:0 0 12px;color:#334155;font-size:14px">Olá, '||public.auria_esc(c.nome)||'. Você tem cópia controlada deste documento na obra <b>'||public.auria_esc(c.obra)
            ||'</b>. A revisão <b>'||public.auria_esc(c.rev_antiga)||'</b> ficou obsoleta: recolha e descarte as cópias impressas e emita a cópia da nova revisão.</p>'
            ||'<table style="width:100%;border-collapse:collapse;margin:2px 0 16px">'
            ||public.auria_email_row('Documento', public.auria_esc(i.codigo||' — '||i.titulo))
            ||public.auria_email_row('Nova revisão', public.auria_esc(NEW.revisao))
            ||coalesce(public.auria_email_row('O que mudou', public.auria_esc(NEW.observacao)),'')
            ||'</table>',
            'Abrir a biblioteca', 'https://auria.solutions/padroes_grupo.html?aba=its'));
        update public.grupo_it_copia_auria set avisado_em = now() where id = any(c.ids);
      end if;
    exception when others then null;
    end;
  end loop;
  return NEW;
end $$;
drop trigger if exists trg_it_nova_revisao on public.grupo_it_revisao_auria;
create trigger trg_it_nova_revisao after insert on public.grupo_it_revisao_auria
  for each row execute function public.notif_it_nova_revisao();
