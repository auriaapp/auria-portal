-- QR do MODELO FEDERADO (2026-10-09, backlog 203).
-- Mesmo princípio do QR da prancha: a página pública só chama a Edge Function qr-view,
-- que usa esta RPC (service role). Devolve SÓ a última revisão LIBERADA (A1/B1) de cada
-- modelo da federação; modelo sem liberada ou sem 3D pronto vai em "faltam" (só código).
alter table public.cde_federacao_auria
  add column if not exists qr_token text unique default encode(extensions.gen_random_bytes(16),'hex');
update public.cde_federacao_auria set qr_token = encode(extensions.gen_random_bytes(16),'hex') where qr_token is null;

create or replace function public.cde_qr_fed_dados(p_token text)
 returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with f as (
    select id, nome, empreendimento_id, documentos from public.cde_federacao_auria where qr_token = p_token limit 1
  ), comp as (
    select d.id, d.codigo, d.disciplina, x.ord,
           (select r.id from public.cde_revisao_auria r
             where r.documento_id = d.id and r.status in ('A1','B1')
             order by coalesce(r.aprovado_em, r.recebido_em) desc nulls last limit 1) as lib_id
      from f, unnest(f.documentos) with ordinality x(doc, ord)
      join public.cde_documento_auria d on d.id = x.doc and not coalesce(d.arquivado,false)
  ), m as (
    select c.*, r.revisao, r.recebido_em as lib_em,
           fa.frag_path, fa.aid,
           exists(select 1 from public.cde_revisao_auria r2
                   where r2.documento_id = c.id and r2.status not in ('A1','B1','DEVOLVIDO','SUBSTITUIDO')
                     and coalesce(r2.recebido_em, timestamptz '1900-01-01') > coalesce(r.recebido_em, timestamptz '9999-01-01')) as novo_nao_lib
      from comp c left join public.cde_revisao_auria r on r.id = c.lib_id
      left join lateral (select a.id as aid, a.frag_path from public.cde_arquivo_auria a
                          where a.revisao_id = c.lib_id and a.frag_status = 'pronto' and a.frag_path is not null limit 1) fa on true
  ), apt as (
    -- só apontamentos PÚBLICOS, e só os pinos 3D ancorados no arquivo LIBERADO que está na cena
    select coalesce(jsonb_agg(jsonb_build_object(
             'id_num', a.id_num, 'titulo', a.titulo, 'descricao', a.descricao, 'tipo', a.tipo,
             'status', a.status, 'prioridade', a.prioridade,
             'pontos_json', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(coalesce(a.pontos_json,'[]'::jsonb)) x
                              where (x->>'k3d') is not null and (x->>'cde_arquivo_id') in (select aid::text from m where aid is not null))
           )), '[]'::jsonb) as arr
      from public.apontamentos a, f
     where a.empreendimento_id = f.empreendimento_id and a.visibilidade = 'Público'
       and exists (select 1 from jsonb_array_elements(coalesce(a.pontos_json,'[]'::jsonb)) x
                    where (x->>'k3d') is not null and (x->>'cde_arquivo_id') in (select aid::text from m where aid is not null))
  )
  select case when not exists(select 1 from f) then null else jsonb_build_object(
    'fed', jsonb_build_object('nome', (select nome from f),
            'empreendimento', (select e.nome from public.empreendimentos_auria e join f on e.id = f.empreendimento_id)),
    'modelos', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'disciplina', disciplina, 'revisao', revisao, 'frag_path', frag_path, 'aid', aid) order by ord)
                           from m where frag_path is not null), '[]'::jsonb),
    'faltam', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo,
                           'motivo', case when lib_id is null then 'sem revisão liberada' else 'sem 3D pronto' end) order by ord)
                           from m where frag_path is null), '[]'::jsonb),
    'apontamentos', (select arr from apt),
    'hasNewerUnreleased', exists(select 1 from m where novo_nao_lib)
  ) end
$function$;
revoke all on function public.cde_qr_fed_dados(text) from public, anon, authenticated;
