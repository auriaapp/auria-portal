-- ============================================================================
--  Item 134 — fim do "duplicate key ... apontamentos_emp_id_uni" (2026-09-25)
--  Rodar no SQL Editor do Supabase. Reaplicável.
--
--  A CAUSA DE FUNDO: o id do apontamento (BIM-ARQ-1, EST-7…) é inventado pelo
--  NAVEGADOR, varrendo a lista APTS que ele carregou. Qualquer linha que a
--  lista não enxergue — filtro de tela, recorte de RLS, outro analista criando
--  ao mesmo tempo — produz um id que já existe, e o insert estoura.
--
--  E estoura de um jeito confuso porque a tabela tem DUAS unicidades:
--    · apontamentos_empreendimento_id_id_key  UNIQUE (empreendimento_id, id)
--    · apontamentos_emp_id_uni                UNIQUE (empreendimento,    id)   ← por NOME
--  O upsert do app mira a primeira. Quando ela não casa, vira INSERT, e aí a
--  segunda (por NOME) pode estourar sozinha.
--
--  Esta função devolve o próximo id livre olhando AS DUAS — é a única resposta
--  que o navegador não tem como calcular.
-- ============================================================================

create or replace function public.apt_proximo_id(p_emp uuid, p_pref text)
returns text
language plpgsql security definer stable set search_path = public
as $$
declare v_nome text; v_max int := 0; v_n int; r record;
begin
  if p_emp is null or coalesce(p_pref,'') = '' then return null; end if;
  select nome into v_nome from public.empreendimentos_auria where id = p_emp;

  for r in
    select a.id
      from public.apontamentos a
     where ( a.empreendimento_id = p_emp
             or (v_nome is not null and a.empreendimento = v_nome) )   -- a unicidade legada
       and a.id like p_pref || '-%'
  loop
    begin
      v_n := (substring(r.id from length(p_pref) + 2))::int;
      if v_n > v_max then v_max := v_n; end if;
    exception when others then
      null;   -- sufixo não numérico (id escrito à mão): ignora
    end;
  end loop;

  return p_pref || '-' || (v_max + 1);
end $$;
grant execute on function public.apt_proximo_id(uuid, text) to authenticated;


-- ── Diagnóstico corrigido do que causou o erro relatado ───────────────────
--  A consulta que rodamos antes agrupava por (nome, id) e contava
--  empreendimento_id distintos — como existe UNIQUE nesse par, cada grupo tem
--  uma linha só e o resultado era zero por construção, não por ausência de
--  problema. O teste certo é: um mesmo NOME aponta para mais de um id?
--  (acontece, por exemplo, com empreendimento arquivado que manteve o nome)
select 'nomes de empreendimento usados por MAIS DE UM id' as item,
       coalesce((select count(*)::text from (
         select a.empreendimento
           from public.apontamentos a
          where coalesce(a.empreendimento,'') <> ''
          group by a.empreendimento
         having count(distinct a.empreendimento_id) > 1) x), '0') as valor
union all
select 'apontamentos cujo nome NÃO bate com o do empreendimento_id',
       coalesce((select count(*)::text
                   from public.apontamentos a
                   join public.empreendimentos_auria e on e.id = a.empreendimento_id
                  where coalesce(a.empreendimento,'') <> '' and a.empreendimento <> e.nome), '0')
union all
select 'maior sufixo por prefixo (amostra)',
       coalesce((select string_agg(t.k || '=' || t.n::text, ' · ' order by t.k)
                   from (select split_part(a.id,'-',1) || case when a.id like 'BIM-%'
                                then '-' || split_part(a.id,'-',2) else '' end as k,
                                count(*) as n
                           from public.apontamentos a group by 1 order by 2 desc limit 8) t), '(nenhum)');
