-- ============================================================================
--  Varredura do acesso do FORNECEDOR — fecha os itens 117 e 138 (2026-09-25)
--  Rodar no SQL Editor do Supabase. Reaplicável.
--
--  CONTEXTO: o coordenador marca ARQ/EST na matriz do fornecedor e conclui que
--  "não funciona". A permissão FUNCIONA — as policies cde_*_acc_sel (v2) já
--  concedem, e o diagnóstico mostrou ARQ com 37 de 38 revisões liberadas. O que
--  está quebrado são outras duas coisas, ambas por trabalho deixado pela metade:
--
--   (1) A TELA DO PROJETISTA NÃO CONTA. cde_minhas_entregas() lê a tabela
--       LEGADA cde_projetista_acesso_auria, que a v2 aposentou e que nenhuma
--       tela grava mais. Os chips "somente leitura" saem sempre vazios, então
--       nem o coordenador nem o projetista veem sinal do que foi concedido.
--
--   (2) O ITEM 117 NUNCA FOI APLICADO no banco, e do jeito que estava ficaria
--       pela metade: só o gate do Storage tinha sido trocado; as policies de
--       INSERT das tabelas continuavam em cde_projetista_pode. O arquivo subiria
--       e o registro falharia.
--
--  Nada aqui alarga leitura: quem lê o quê continua decidido por
--  cde_acc_ve_disc (matriz + regra de publicado/Ñ-pub) e por
--  cde_projetista_pode (disciplina contratada).
-- ============================================================================


-- ── 1) Coluna e gate de ENVIO (item 117, idempotente) ─────────────────────
alter table public.cde_acesso_auria
  add column if not exists disciplinas_upload text[] not null default '{}';

comment on column public.cde_acesso_auria.disciplinas_upload is
  'Disciplinas em que ESTE fornecedor pode enviar, além da(s) que ele atende (item 117)';

create or replace function public.cde_upload_pode(p_emp uuid, p_disc text)
returns boolean
language plpgsql security definer stable set search_path to 'public'
as $$
declare
  em  text := lower(coalesce(auth.jwt()->>'email',''));
  rot text;
begin
  if em = '' or p_emp is null or coalesce(p_disc,'') = '' then return false; end if;
  if public.cde_projetista_pode(p_emp, p_disc) then return true; end if;   -- contratada
  rot := lower(coalesce(public.cde_disc_rotulo(p_emp, p_disc), ''));
  return exists (
    select 1
      from public.cde_acesso_auria a
      join public.projetistas_auria pr on pr.fornecedor_id = a.fornecedor_id
     where a.empreendimento_id = p_emp
       and lower(pr.email) = em and coalesce(pr.ativo, true)
       and a.upload
       and ( upper(p_disc) = any(select upper(x) from unnest(a.disciplinas_upload) x)
             or (rot <> '' and rot = any(select lower(x) from unnest(a.disciplinas_upload) x)) )
  );
end $$;
grant execute on function public.cde_upload_pode(uuid, text) to authenticated;


-- ── 2) Policies de ESCRITA do projetista passam a usar o gate de ENVIO ────
--  (era o que faltava do 117). Regras de sempre mantidas: revisão nasce
--  RECEBIDO/S0 e o projetista nunca altera nem apaga.
drop policy if exists cde_doc_proj_ins on public.cde_documento_auria;
create policy cde_doc_proj_ins on public.cde_documento_auria for insert
  with check (public.cde_upload_pode(empreendimento_id, disciplina));

drop policy if exists cde_rev_proj_ins on public.cde_revisao_auria;
create policy cde_rev_proj_ins on public.cde_revisao_auria for insert
  with check (
    estado = 'RECEBIDO' and status = 'S0'
    and exists (select 1 from public.cde_documento_auria d
                where d.id = documento_id
                  and public.cde_upload_pode(d.empreendimento_id, d.disciplina))
  );

drop policy if exists cde_arq_proj_ins on public.cde_arquivo_auria;
create policy cde_arq_proj_ins on public.cde_arquivo_auria for insert
  with check (exists (select 1 from public.cde_revisao_auria r
                 join public.cde_documento_auria d on d.id = r.documento_id
                 where r.id = revisao_id
                   and r.estado = 'RECEBIDO' and r.status = 'S0'
                   and public.cde_upload_pode(d.empreendimento_id, d.disciplina)));


-- ── 3) A tela do projetista passa a ler a MATRIZ VIVA ─────────────────────
--  Antes: disciplina contratada (disciplina_fornecedor_auria) + leitura vinda
--  da tabela LEGADA. Agora: contratada + envio liberado na matriz, e leitura
--  vinda de cde_acesso_auria — a mesma tabela que o painel do analista grava.
drop function if exists public.cde_minhas_entregas();
create function public.cde_minhas_entregas()
returns table (
  projetista_id       uuid,
  fornecedor_id       uuid,
  fornecedor_nome     text,
  empreendimento_id   uuid,
  empreendimento_nome text,
  disciplina          text,
  pode_entregar       boolean
)
language sql security definer stable set search_path to 'public'
as $$
  with me as (
    select id, fornecedor_id
      from public.projetistas_auria
     where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
       and coalesce(ativo, true)
  ),
  -- ENTREGA: a disciplina contratada, mais as que a matriz liberou para envio
  entrega as (
    select m.id, f.id as fid, f.nome as fnome, e.id as eid, e.nome as enome,
           df.disciplina as disc
      from me m
      join public.fornecedores_auria f           on f.id = m.fornecedor_id
      join public.disciplina_fornecedor_auria df on df.fornecedor_id = f.id
      join public.empreendimentos_auria e        on e.id = df.empreendimento_id
     where e.deleted_at is null
    union
    select m.id, f.id, f.nome, e.id, e.nome, x.disc
      from me m
      join public.fornecedores_auria f on f.id = m.fornecedor_id
      join public.cde_acesso_auria a   on a.fornecedor_id = f.id
      join public.empreendimentos_auria e on e.id = a.empreendimento_id
      cross join lateral unnest(coalesce(a.disciplinas_upload,'{}')) x(disc)
     where e.deleted_at is null and a.upload and coalesce(x.disc,'') <> ''
  ),
  -- LEITURA: o que a matriz marcou como visível e não é disciplina de entrega.
  -- todas_disciplinas vira a lista real de disciplinas do empreendimento.
  leitura as (
    select m.id, f.id as fid, f.nome as fnome, e.id as eid, e.nome as enome, x.disc
      from me m
      join public.fornecedores_auria f    on f.id = m.fornecedor_id
      join public.cde_acesso_auria a      on a.fornecedor_id = f.id
      join public.empreendimentos_auria e on e.id = a.empreendimento_id
      cross join lateral unnest(
        case when a.todas_disciplinas
             then coalesce((select array_agg(distinct d.disciplina)
                              from public.cde_documento_auria d
                             where d.empreendimento_id = a.empreendimento_id
                               and coalesce(d.disciplina,'') <> ''), '{}')
             else coalesce(a.disciplinas,'{}') end) x(disc)
     where e.deleted_at is null and coalesce(x.disc,'') <> ''
  )
  select en.id, en.fid, en.fnome, en.eid, en.enome, en.disc, true
    from entrega en
  union all
  select le.id, le.fid, le.fnome, le.eid, le.enome, le.disc, false
    from leitura le
   where not exists (select 1 from entrega en2
                      where en2.eid = le.eid and upper(en2.disc) = upper(le.disc))
   order by 5, 7 desc, 6;
$$;
grant execute on function public.cde_minhas_entregas() to authenticated;


-- ── Conferência ────────────────────────────────────────────────────────────
select 'disciplinas_upload existe' as item,
       exists(select 1 from information_schema.columns
               where table_name='cde_acesso_auria' and column_name='disciplinas_upload')::text as valor
union all select 'cde_upload_pode existe',
       exists(select 1 from pg_proc where proname='cde_upload_pode')::text
union all select 'escrita do projetista usa cde_upload_pode (esperado 3)',
       (select count(*)::text from pg_policy pol
         where pol.polname in ('cde_doc_proj_ins','cde_rev_proj_ins','cde_arq_proj_ins')
           and pg_get_expr(pol.polwithcheck, pol.polrelid) like '%cde_upload_pode%')
union all select 'cde_minhas_entregas nao usa mais a tabela legada',
       (not exists (select 1 from pg_proc
                     where proname='cde_minhas_entregas'
                       and prosrc like '%cde_projetista_acesso_auria%'))::text;
