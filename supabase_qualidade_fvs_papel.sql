-- Papel da Qualidade na FVS (2026-11-10, item 12 do backlog da Qualidade).
-- a) comentar a ficha (evento, não muda situação)
-- b) devolver para ajuste (aguardando → em_verificacao, sem NC)
-- c) modelo com aprovação "Obra + Qualidade": a obra aprova (1ª) e a ficha só
--    fica aprovada quando a Qualidade aprova (2ª)
-- d) (front) abrir NC direto da ficha no painel da Qualidade — usa auria_nc.js
-- A Qualidade nunca altera resultados: só ações registradas em fvs_evento_auria.

alter table public.fvs_modelo_auria add column if not exists aprova_qualidade boolean not null default false;
alter table public.fvs_inspecao_auria
  add column if not exists devolvido_nome text,
  add column if not exists devolvido_em timestamptz,
  add column if not exists devolvido_motivo text;

alter table public.fvs_evento_auria drop constraint if exists fvs_evento_auria_tipo_check;
alter table public.fvs_evento_auria add constraint fvs_evento_auria_tipo_check
  check (tipo = any (array['enviada','aprovada_1','aprovada','reprovada','contestada','reinspecao','comentario','devolvida']));

-- só a Qualidade do grupo dono da obra da ficha
create or replace function public._fvs_qualidade_pode(p_emp uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.grupo_pode_editar((select empresa_id from public.empreendimentos_auria where id = p_emp), 'qualidade');
$$;
revoke all on function public._fvs_qualidade_pode(uuid) from public, anon, authenticated;

-- (c) aprovação da obra: com "Obra + Qualidade" a obra dá a 1ª e para aí
create or replace function public.fvs_aprovar(p_id uuid, p_obs text)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare v public.fvs_inspecao_auria; v_niv text; v_nome text; duas boolean; aq boolean;
begin
  select * into v from public.fvs_inspecao_auria where id = p_id for update;
  if v.id is null then raise exception 'Ficha não encontrada.'; end if;
  v_niv := public.obra_meu_nivel(v.empreendimento_id);
  if v_niv is null or v_niv not in ('eng_chefe','coord_campo') then raise exception 'Só o coord. de campo ou o eng. chefe aprovam.'; end if;
  if v.situacao <> 'aguardando' then raise exception 'A ficha não está aguardando aprovação.'; end if;
  select duas_aprovacoes, aprova_qualidade into duas, aq from public.fvs_modelo_auria where id = v.modelo_id;
  v_nome := public.fvs_eu_nome();
  if coalesce(aq,false) then
    if v.aprov1_por is not null then raise exception 'A obra já aprovou — falta a aprovação da Qualidade.'; end if;
    update public.fvs_inspecao_auria set aprov1_por = auth.uid(), aprov1_nome = v_nome, aprov1_nivel = v_niv, aprov1_em = now(), atualizado_em = now() where id = p_id;
    insert into public.fvs_evento_auria (inspecao_id, rodada, tipo, observacao, por_nome, por_nivel)
      values (p_id, v.rodada, 'aprovada_1', nullif(trim(coalesce(p_obs,'')),''), v_nome, v_niv);
    return 'aguardando_qualidade';
  end if;
  if coalesce(duas,false) and v.aprov1_por is null then
    update public.fvs_inspecao_auria set aprov1_por = auth.uid(), aprov1_nome = v_nome, aprov1_nivel = v_niv, aprov1_em = now(), atualizado_em = now() where id = p_id;
    insert into public.fvs_evento_auria (inspecao_id, rodada, tipo, observacao, por_nome, por_nivel)
      values (p_id, v.rodada, 'aprovada_1', nullif(trim(coalesce(p_obs,'')),''), v_nome, v_niv);
    return 'aprovada_1';
  end if;
  if coalesce(duas,false) then
    if v.aprov1_por = auth.uid() then raise exception 'A 2ª aprovação precisa ser de outra pessoa.'; end if;
    if v.aprov1_nivel = v_niv then raise exception 'A 2ª aprovação precisa ser do outro nível (% já aprovou).', case v_niv when 'eng_chefe' then 'eng. chefe' else 'coord. de campo' end; end if;
  end if;
  update public.fvs_inspecao_auria set situacao = 'aprovada', aprovado_nome = v_nome, aprovado_em = now(), atualizado_em = now() where id = p_id;
  insert into public.fvs_evento_auria (inspecao_id, rodada, tipo, observacao, por_nome, por_nivel)
    values (p_id, v.rodada, 'aprovada', nullif(trim(coalesce(p_obs,'')),''), v_nome, v_niv);
  return 'aprovada';
end $function$;

-- (c) 2ª aprovação, pela Qualidade
create or replace function public.fvs_qualidade_aprovar(p_id uuid, p_obs text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v public.fvs_inspecao_auria; aq boolean; v_nome text;
begin
  select * into v from public.fvs_inspecao_auria where id = p_id for update;
  if v.id is null then raise exception 'Ficha não encontrada.'; end if;
  if not public._fvs_qualidade_pode(v.empreendimento_id) then raise exception 'Só a Qualidade do grupo aprova esta etapa.'; end if;
  select aprova_qualidade into aq from public.fvs_modelo_auria where id = v.modelo_id;
  if not coalesce(aq,false) then raise exception 'Este modelo não exige aprovação da Qualidade.'; end if;
  if v.situacao <> 'aguardando' or v.aprov1_por is null then raise exception 'A ficha ainda não foi aprovada pela obra.'; end if;
  v_nome := public.fvs_eu_nome();
  update public.fvs_inspecao_auria set situacao = 'aprovada', aprovado_nome = v_nome, aprovado_em = now(), atualizado_em = now() where id = p_id;
  insert into public.fvs_evento_auria (inspecao_id, rodada, tipo, observacao, por_nome, por_nivel)
    values (p_id, v.rodada, 'aprovada', nullif(trim(coalesce(p_obs,'')),''), v_nome, 'qualidade');
end $$;

-- (b) devolver para ajuste: volta ao preenchimento mantendo os resultados
create or replace function public.fvs_devolver(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v public.fvs_inspecao_auria; v_nome text;
begin
  select * into v from public.fvs_inspecao_auria where id = p_id for update;
  if v.id is null then raise exception 'Ficha não encontrada.'; end if;
  if not public._fvs_qualidade_pode(v.empreendimento_id) then raise exception 'Só a Qualidade do grupo devolve fichas.'; end if;
  if v.situacao <> 'aguardando' then raise exception 'Só se devolve ficha aguardando aprovação.'; end if;
  if length(trim(coalesce(p_motivo,''))) < 5 then raise exception 'Informe o que ajustar (mínimo 5 caracteres).'; end if;
  v_nome := public.fvs_eu_nome();
  update public.fvs_inspecao_auria set situacao = 'em_verificacao', aprov1_por = null, aprov1_nome = null, aprov1_nivel = null, aprov1_em = null,
         devolvido_nome = v_nome, devolvido_em = now(), devolvido_motivo = trim(p_motivo), atualizado_em = now() where id = p_id;
  insert into public.fvs_evento_auria (inspecao_id, rodada, tipo, observacao, por_nome, por_nivel)
    values (p_id, v.rodada, 'devolvida', trim(p_motivo), v_nome, 'qualidade');
end $$;

-- (a) comentário da Qualidade (qualquer situação)
create or replace function public.fvs_comentar(p_id uuid, p_texto text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v public.fvs_inspecao_auria;
begin
  select * into v from public.fvs_inspecao_auria where id = p_id;
  if v.id is null then raise exception 'Ficha não encontrada.'; end if;
  if not public._fvs_qualidade_pode(v.empreendimento_id) then raise exception 'Só a Qualidade do grupo comenta fichas.'; end if;
  if length(trim(coalesce(p_texto,''))) < 3 then raise exception 'Escreva o comentário.'; end if;
  if length(p_texto) > 1000 then raise exception 'Comentário com no máximo 1000 caracteres.'; end if;
  insert into public.fvs_evento_auria (inspecao_id, rodada, tipo, observacao, por_nome, por_nivel)
    values (p_id, v.rodada, 'comentario', trim(p_texto), public.fvs_eu_nome(), 'qualidade');
end $$;

revoke all on function public.fvs_qualidade_aprovar(uuid, text), public.fvs_devolver(uuid, text), public.fvs_comentar(uuid, text) from public, anon;
grant execute on function public.fvs_qualidade_aprovar(uuid, text), public.fvs_devolver(uuid, text), public.fvs_comentar(uuid, text) to authenticated;
