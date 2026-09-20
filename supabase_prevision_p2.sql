-- ============================================================================
--  ITEM 77 (etapa 2, passo 2) — CRONOGRAMA EFETIVO: uma leitura só para todos
--  os painéis. Com vínculo Prevision ativo → tarefas espelho da fase pedida
--  (ou da fase padrão); sem vínculo → cronograma_auria (MS Project/edição).
--  Reaplicável. Requer supabase_prevision.sql.
-- ============================================================================
create or replace function public.cronograma_ler(p_emp uuid, p_fase text default null)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_vinc record; v_fases jsonb; v_tarefas jsonb; v_edita boolean;
begin
  if not public.cde_pav_pode_ver(p_emp) then raise exception 'Sem acesso a este empreendimento.'; end if;
  v_edita := public.estacao_edita(p_emp);
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'fase',v.fase,'projeto_nome',v.projeto_nome,'padrao',v.padrao,
           'sincronizado_em',v.sincronizado_em,'n_tarefas',v.n_tarefas,'sync_erro',v.sync_erro)
           order by array_position(array['INC','PROD','ORC','EXE'], v.fase) nulls last, v.fase), '[]'::jsonb)
    into v_fases from public.prevision_vinculo_auria v where v.empreendimento_id = p_emp and v.ativo;

  -- vínculo escolhido: a fase pedida, senão a padrão, senão a primeira
  select * into v_vinc from public.prevision_vinculo_auria v
   where v.empreendimento_id = p_emp and v.ativo and (p_fase is null or v.fase = upper(p_fase))
   order by (p_fase is not null and v.fase = upper(p_fase)) desc, v.padrao desc,
            array_position(array['EXE','PROD','ORC','INC'], v.fase) nulls last
   limit 1;

  if v_vinc.id is not null then
    -- ordem natural do WBS (1, 1.1, 1.1.2, 1.2 …); nivel 0 = raiz, como o cronograma_auria
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'tarefa_id', t.tarefa_id, 'nome', t.nome, 'wbs', t.wbs, 'nivel', greatest(coalesce(t.nivel,1)-1,0),
             'data_inicio', t.ini, 'data_fim', t.fim,
             'progresso', round(coalesce(t.real,0)*100), 'previsto', round(coalesce(t.prev,0)*100),
             'tipo', case when exists (select 1 from public.prevision_tarefa_auria c where c.projeto_id = t.projeto_id and c.removida_em is null and c.wbs like t.wbs || '.%') then 'fase'
                          when coalesce(t.duracao,1) = 0 then 'marco' else 'tarefa' end,
             'critica', t.critica, 'kanban', t.kanban, 'kanban_status', t.kanban_status,
             'responsaveis', t.responsaveis, 'etiquetas', t.etiquetas, 'colunas', t.colunas,
             'atraso_base', t.atraso_base, 'atraso_data', t.atraso_data, 'custo', t.custo,
             'base_ini', t.base_ini, 'base_fim', t.base_fim, 'marco_medicao', t.marco_medicao
           ) order by (select array_agg(lpad(regexp_replace(x,'[^0-9]','','g'),6,'0')) from unnest(string_to_array(coalesce(t.wbs,'0'),'.')) x)), '[]'::jsonb)
      into v_tarefas
      from public.prevision_tarefa_auria t
     where t.vinculo_id = v_vinc.id and t.removida_em is null;
    return jsonb_build_object('fonte','prevision','fase',v_vinc.fase,'vinculo',jsonb_build_object('id',v_vinc.id,'fase',v_vinc.fase,
             'projeto_nome',v_vinc.projeto_nome,'padrao',v_vinc.padrao,'sincronizado_em',v_vinc.sincronizado_em,'sync_erro',v_vinc.sync_erro),
             'fases',v_fases,'pode_editar',v_edita,'tarefas',v_tarefas);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'nome',c.nome,'wbs',c.wbs,'nivel',coalesce(c.nivel,0),
           'data_inicio',c.data_inicio,'data_fim',c.data_fim,'progresso',coalesce(c.progresso,0),'tipo',coalesce(c.tipo,'tarefa'),'ordem',c.ordem)
           order by c.ordem), '[]'::jsonb)
    into v_tarefas from public.cronograma_auria c where c.empreendimento_id = p_emp;
  return jsonb_build_object('fonte','auria','fase',null,'vinculo',null,'fases',v_fases,'pode_editar',v_edita,'tarefas',v_tarefas);
end $$;
grant execute on function public.cronograma_ler(uuid, text) to authenticated;

-- Próximos marcos/tarefas por empreendimento (widget da gestão / painel do analista):
-- folhas da fase padrão do Prevision, não concluídas, com fim até p_dias adiante (ou já vencidas).
create or replace function public.prevision_proximas(p_emps uuid[], p_dias int default 30)
returns table (empreendimento_id uuid, fase text, nome text, wbs text, data_fim date, progresso int, critica boolean, kanban text, responsaveis text[])
language sql security definer stable set search_path = public as $$
  select t.empreendimento_id, t.fase, t.nome, t.wbs, t.fim, round(coalesce(t.real,0)*100)::int, t.critica, t.kanban, t.responsaveis
    from public.prevision_tarefa_auria t
    join public.prevision_vinculo_auria v on v.id = t.vinculo_id and v.ativo and v.padrao
   where t.empreendimento_id = any(p_emps) and public.cde_pav_pode_ver(t.empreendimento_id)
     and t.removida_em is null and t.fim is not null and t.fim <= current_date + p_dias
     and coalesce(t.kanban_status,'') <> 'finished' and coalesce(t.real,0) < 1
     and not exists (select 1 from public.prevision_tarefa_auria c where c.projeto_id = t.projeto_id and c.removida_em is null and c.wbs like t.wbs || '.%')
   order by t.fim;
$$;
grant execute on function public.prevision_proximas(uuid[], int) to authenticated;

select 'cronograma_ler' as fn, exists(select 1 from pg_proc where proname='cronograma_ler') as ok
union all select 'prevision_proximas', exists(select 1 from pg_proc where proname='prevision_proximas');
