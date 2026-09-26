-- ============================================================================
--  DIAGNÓSTICO item 138 — fornecedor que precisa LER ARQ e EST (2026-09-25)
--  Rodar no SQL Editor. É tudo SELECT — não altera nada.
--
--  A capacidade EXISTE (matriz cde_acesso_auria + cde_acc_ve_disc), mas ela tem
--  uma condição que a tela não conta: a disciplina EXTRA só aparece nas
--  revisões PUBLICADAS (A1 / B1 / AS_BUILT), a menos que o fornecedor tenha o
--  flag "Ñ-PUB" (ver_nao_publicado) marcado.
--
--  Estas três consultas dizem se é isso mesmo que está acontecendo.
-- ============================================================================


-- ── 1) O que a matriz guarda hoje para este fornecedor ────────────────────
--  Confere se ARQ/EST realmente ficaram gravadas e como estão os flags.
select e.nome                as empreendimento,
       f.nome                as fornecedor,
       a.todas_disciplinas,
       a.disciplinas         as pode_ver,
       a.disciplinas_upload  as pode_enviar,
       a.ver_nao_publicado   as ve_nao_publicado,
       a.download, a.upload
  from public.cde_acesso_auria a
  join public.empreendimentos_auria e on e.id = a.empreendimento_id
  left join public.fornecedores_auria f on f.id = a.fornecedor_id
 where a.fornecedor_id is not null
 order by e.nome, f.nome;


-- ── 2) Em que status estão os documentos de ARQ e EST ─────────────────────
--  Se a coluna "publicadas" vier 0, o fornecedor não veria nada mesmo com
--  a disciplina marcada — e a causa é o status, não a permissão.
select d.disciplina,
       count(*)                                                as documentos,
       count(*) filter (where r.status in ('A1','B1','AS_BUILT')) as publicadas,
       count(*) filter (where r.status not in ('A1','B1','AS_BUILT')) as nao_publicadas,
       string_agg(distinct r.status, ', ' order by r.status)   as status_encontrados
  from public.cde_documento_auria d
  join lateral (
    select r.status
      from public.cde_revisao_auria r
     where r.documento_id = d.id
     order by r.recebido_em desc nulls last
     limit 1) r on true
 where d.empreendimento_id = (
         select a.empreendimento_id from public.cde_acesso_auria a
          where a.fornecedor_id is not null
          order by a.atualizado_em desc nulls last limit 1)
   and coalesce(d.arquivado,false) = false
 group by d.disciplina
 order by d.disciplina;


-- ── 3) As policies de leitura que estão realmente no banco ────────────────
--  Devem aparecer as do projetista (disciplina contratada) E as da matriz
--  (cde_*_acc_sel). Se as da matriz não existirem, a v2 nunca foi aplicada e
--  aí sim o problema é outro.
select c.relname as tabela, pol.polname as policy
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
 where c.relname in ('cde_documento_auria','cde_revisao_auria','cde_arquivo_auria')
   and pol.polname like '%_sel'
 order by c.relname, pol.polname;
