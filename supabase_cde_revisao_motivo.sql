-- ============================================================================
--  Item 110 — justificativa da revisão (2026-09-23)
--  Rodar no SQL Editor do Supabase.
--
--  Ao registrar uma NOVA REVISÃO de prancha ou modelo, quem envia diz O QUE MUDOU.
--  O texto fica na própria revisão (cde_revisao_auria.motivo) e, junto com o
--  histórico de status, é o que a coordenação lê no controle de revisão.
--
--  cde_revisoes_doc(p_doc) devolve o histórico pronto para a tela: revisão, quando,
--  quem enviou, status e a justificativa — respeitando a mesma visibilidade do CDE.
-- ============================================================================

alter table public.cde_revisao_auria
  add column if not exists motivo text;

comment on column public.cde_revisao_auria.motivo is
  'O que mudou nesta revisão (preenchido por quem envia; item 110)';

create or replace function public.cde_revisoes_doc(p_doc uuid)
returns table(
  id uuid, revisao text, estado text, status text, motivo text,
  recebido_em timestamptz, aprovado_em timestamptz, ressalvas text,
  criado_por uuid, criado_por_nome text, n_arquivos int
)
language plpgsql security definer stable set search_path = public as $$
declare v_emp uuid;
begin
  select d.empreendimento_id into v_emp from public.cde_documento_auria d where d.id = p_doc;
  if v_emp is null then raise exception 'Documento não encontrado.'; end if;
  if not public.cde_pav_pode_ver(v_emp) then raise exception 'Sem acesso a este empreendimento.'; end if;
  return query
    select r.id, r.revisao, r.estado, r.status, r.motivo,
           r.recebido_em, r.aprovado_em, r.ressalvas,
           r.criado_por, coalesce(u.nome, u.email) as criado_por_nome,
           (select count(*)::int from public.cde_arquivo_auria a where a.revisao_id = r.id) as n_arquivos
      from public.cde_revisao_auria r
      left join public.usuarios_auria u on u.id = r.criado_por
     where r.documento_id = p_doc
     order by r.recebido_em desc nulls last;
end $$;
grant execute on function public.cde_revisoes_doc(uuid) to authenticated;

select 'cde_revisao_auria.motivo' as item,
       exists(select 1 from information_schema.columns where table_name='cde_revisao_auria' and column_name='motivo') as ok
union all select 'cde_revisoes_doc', exists(select 1 from pg_proc where proname='cde_revisoes_doc');
