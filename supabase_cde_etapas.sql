-- ============================================================================
--  Item 84 — Etapas (códigos) no menu "Configurações e Nomenclaturas" (2026-09-23)
--  Rodar no SQL Editor do Supabase.
--
--  As etapas do projeto (EP, AP, PL, PE, EX, AB…) já existem na convenção de
--  nomenclatura, no campo mapeado como 'fase' — mas só dava para editá-las na
--  tela do padrão de codificação. Aqui entra uma RPC genérica que grava o
--  domínio de QUALQUER campo mapeado da convenção (disciplina, fase, …), usada
--  pela gestão no mesmo menu das disciplinas.
--
--  cde_disc_salvar continua existindo (chama esta por baixo).
-- ============================================================================

create or replace function public.cde_campo_salvar(p_construtora uuid, p_grupo uuid, p_mapeia text, p_dominio jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_emp uuid; v_grp uuid; v_conv record;
        v_campos jsonb; v_i int; v_found int := -1; v_mapeia text := lower(coalesce(p_mapeia,''));
begin
  if v_mapeia not in ('disciplina','fase') then return 'campo_invalido'; end if;
  select role, empresa_id into v_role, v_emp from public.usuarios_auria where id = v_uid;
  if p_construtora is not null then select grupo_id into v_grp from public.construtoras_auria where id = p_construtora;
  else v_grp := p_grupo; end if;
  if v_grp is null then return 'erro_escopo'; end if;
  if not (v_role = 'super_admin' or (v_emp = v_grp and v_role = 'gerente')) then return 'sem_permissao'; end if;

  if p_construtora is not null then select * into v_conv from public.cde_convencao_auria where construtora_id = p_construtora limit 1;
  else select * into v_conv from public.cde_convencao_auria where grupo_id = v_grp limit 1; end if;
  if v_conv is null then return 'sem_convencao'; end if;

  v_campos := coalesce(v_conv.campos, '[]'::jsonb);
  for v_i in 0 .. jsonb_array_length(v_campos)-1 loop
    if (v_campos->v_i->>'mapeia') = v_mapeia then v_found := v_i; exit; end if;
  end loop;
  -- a convenção pode ter a etapa como campo de chave 'fase' sem o 'mapeia' preenchido
  if v_found < 0 and v_mapeia = 'fase' then
    for v_i in 0 .. jsonb_array_length(v_campos)-1 loop
      if lower(coalesce(v_campos->v_i->>'chave','')) in ('fase','etapa') then v_found := v_i; exit; end if;
    end loop;
  end if;
  if v_found < 0 then return case when v_mapeia='fase' then 'sem_campo_fase' else 'sem_campo_disciplina' end; end if;

  v_campos := jsonb_set(v_campos, array[v_found::text,'dominio'], coalesce(p_dominio,'[]'::jsonb));
  update public.cde_convencao_auria set campos = v_campos where id = v_conv.id;
  return 'ok';
end $$;
grant execute on function public.cde_campo_salvar(uuid,uuid,text,jsonb) to authenticated;

-- compatibilidade: a tela antiga continua chamando cde_disc_salvar
drop function if exists public.cde_disc_salvar(uuid, uuid, jsonb);
create function public.cde_disc_salvar(p_construtora uuid, p_grupo uuid, p_dominio jsonb)
returns text language sql set search_path = public as $$
  select public.cde_campo_salvar(p_construtora, p_grupo, 'disciplina', p_dominio);
$$;
grant execute on function public.cde_disc_salvar(uuid,uuid,jsonb) to authenticated;

select 'cde_campo_salvar' as item, exists(select 1 from pg_proc where proname='cde_campo_salvar') as ok
union all select 'cde_disc_salvar', exists(select 1 from pg_proc where proname='cde_disc_salvar');

-- ============================================================================
--  Item 93 — coordenador não pode desligar os avisos do que ele coordena
--  (só onde é VISUALIZADOR). 'nenhum' passa a ser recusado para coordenador,
--  e quem já estava com 'nenhum' coordenando volta para o resumo diário.
-- ============================================================================
create or replace function public.analista_aviso_cde(p_emp uuid, p_modo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_papel text;
begin
  if p_modo not in ('upload','diario','nenhum') then raise exception 'Modo inválido.'; end if;
  select papel into v_papel from public.analista_empreendimento_auria
   where analista_id = auth.uid() and empreendimento_id = p_emp and ativo = true;
  if v_papel is null then raise exception 'Você não está atribuído a este empreendimento.'; end if;
  if p_modo = 'nenhum' and coalesce(v_papel,'coordenador') <> 'visualizador' then
    raise exception 'Quem coordena o empreendimento não pode desligar os avisos — escolha "a cada upload" ou "resumo diário".';
  end if;
  update public.analista_empreendimento_auria
     set aviso_cde = p_modo
   where analista_id = auth.uid() and empreendimento_id = p_emp and ativo = true;
end $$;
grant execute on function public.analista_aviso_cde(uuid, text) to authenticated;
revoke execute on function public.analista_aviso_cde(uuid, text) from anon;

update public.analista_empreendimento_auria
   set aviso_cde = 'diario'
 where ativo = true and aviso_cde = 'nenhum' and coalesce(papel,'coordenador') <> 'visualizador';

-- coordenador silenciado (coluna silenciar) também volta a receber
update public.analista_empreendimento_auria
   set silenciar = false
 where ativo = true and silenciar = true and coalesce(papel,'coordenador') <> 'visualizador';

select 'analista_aviso_cde (papel)' as item, exists(select 1 from pg_proc where proname='analista_aviso_cde') as ok;
