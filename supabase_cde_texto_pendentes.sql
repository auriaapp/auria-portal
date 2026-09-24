-- ============================================================================
--  Item 99 (2ª volta) — por que a busca só achava ~14 pranchas (2026-09-24)
--  Rodar no SQL Editor do Supabase.
--
--  O backfill procurava documentos com texto_busca IS NULL. Os que falharam no
--  episódio das 100 leituras em paralelo ficaram com texto_busca = ' ' (a
--  extração terminou vazia e gravou o espaço) — deixaram de ser "null" e nunca
--  mais voltaram para a fila. Resultado: só os poucos que deram certo tinham
--  texto de verdade.
--
--  Agora existe texto_em: quando o documento foi indexado. Quem nunca passou
--  pela fila NOVA (texto_em null) entra de novo, uma vez, mesmo já tendo
--  texto_busca. E PDF sem camada de texto (escaneado) é marcado como indexado,
--  então não fica voltando para sempre.
-- ============================================================================

alter table public.cde_documento_auria
  add column if not exists texto_em timestamptz;

comment on column public.cde_documento_auria.texto_em is
  'Quando o texto do PDF foi extraído (null = ainda não passou pela indexação; item 99)';

-- Grava o texto E carimba a data. Texto vazio conta como indexado (PDF escaneado
-- ou vetorizado não tem o que extrair — insistir nele a cada abertura é desperdício).
create or replace function public.cde_texto_set(p_doc uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.cde_documento_auria d
              where d.id = p_doc and public.cde_pav_pode_ver(d.empreendimento_id)) then
    update public.cde_documento_auria
       set texto_busca = p_texto, texto_em = now()
     where id = p_doc;
  end if;
end $$;
grant execute on function public.cde_texto_set(uuid, text) to authenticated;

-- Documentos que ainda precisam de indexação, com o motivo (para a tela contar direito).
create or replace function public.cde_texto_pendentes(p_emp uuid)
returns table(id uuid, codigo text, motivo text)
language sql security definer stable set search_path = public as $$
  select d.id, d.codigo,
         case when d.texto_em is null and d.texto_busca is null then 'nunca indexado'
              when d.texto_em is null then 'indexado antes da correção'
              else 'texto vazio' end
    from public.cde_documento_auria d
   where d.empreendimento_id = p_emp
     and coalesce(d.arquivado,false) = false
     and public.cde_pav_pode_ver(p_emp)
     and (d.texto_em is null or coalesce(trim(d.texto_busca),'') = '')
   order by d.codigo;
$$;
grant execute on function public.cde_texto_pendentes(uuid) to authenticated;

-- Quantos estão pendentes hoje, por empreendimento (diagnóstico rápido):
--   select e.nome, count(*) from public.cde_documento_auria d
--     join public.empreendimentos_auria e on e.id = d.empreendimento_id
--    where d.texto_em is null group by e.nome order by 2 desc;

select 'cde_documento_auria.texto_em' as item,
       exists(select 1 from information_schema.columns where table_name='cde_documento_auria' and column_name='texto_em') as ok
union all select 'cde_texto_pendentes', exists(select 1 from pg_proc where proname='cde_texto_pendentes')
union all select 'cde_texto_set (carimba data)', exists(select 1 from pg_proc where proname='cde_texto_set');
