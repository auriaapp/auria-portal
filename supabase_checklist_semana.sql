-- ============================================================================
--  Checklist do que foi feito nesta semana (2026-09-26). Cole e rode. Só lê.
--
--  Ao longo da semana eu fui anotando "SQL PENDENTE" no momento de publicar, e
--  você foi rodando conforme avançávamos. Em vez de eu reconciliar de memória —
--  que já me traiu mais de uma vez — esta consulta pergunta ao BANCO o que
--  realmente chegou lá.
--
--  Qualquer linha com "FALTA" é coisa que publiquei e nunca foi aplicada.
-- ============================================================================

with c(item, ok) as (values

  ('126 · ultimo acesso (auria_ping_acesso)',
   to_regprocedure('public.auria_ping_acesso()') is not null),

  ('134 · proximo id do apontamento (apt_proximo_id)',
   to_regprocedure('public.apt_proximo_id(uuid,text)') is not null),

  ('134 · unicidade legada por NOME removida',
   not exists (select 1 from pg_constraint con join pg_class k on k.oid=con.conrelid
                where k.relname='apontamentos' and con.conname='apontamentos_emp_id_uni')),

  ('117 · envio por disciplina (cde_upload_pode)',
   to_regprocedure('public.cde_upload_pode(uuid,text)') is not null),

  ('138 · tela do projetista le a matriz viva',
   not exists (select 1 from pg_proc where proname='cde_minhas_entregas'
                and prosrc like '%cde_projetista_acesso_auria%')),

  ('139 · super_admin fora dos destinatarios',
   not exists (select 1 from pg_proc where proname='auria_emails_equipe'
                and prosrc like '%super_admin%')),

  ('141 · convite com token proprio (tabela)',
   exists (select 1 from information_schema.tables where table_name='convite_token_auria')),

  ('141 · token guardado so como HASH',
   exists (select 1 from information_schema.columns
            where table_name='convite_token_auria' and column_name='token_sha')
   and not exists (select 1 from information_schema.columns
            where table_name='convite_token_auria' and column_name='token')),

  ('145 · policy restritiva do BIM',
   exists (select 1 from pg_policy p join pg_class k on k.oid=p.polrelid
            where k.relname='cde_arquivo_auria' and p.polname='cde_arq_bim_restr')),

  ('145 · autor externo edita o proprio apontamento',
   exists (select 1 from pg_policy p join pg_class k on k.oid=p.polrelid
            where k.relname='apontamentos' and p.polname='apt_autor_upd')),

  ('145 · projetista exclui o proprio S0',
   exists (select 1 from pg_policy p join pg_class k on k.oid=p.polrelid
            where k.relname='cde_revisao_auria' and p.polname='cde_rev_proj_del')),

  ('146 · visibilidade por faixa ISO (apt_pode_ler)',
   to_regprocedure('public.apt_pode_ler(uuid,text,text,text)') is not null),

  ('147 · liberar para obra (RPCs)',
   to_regprocedure('public.cde_obra_liberar(uuid)') is not null
   and to_regprocedure('public.cde_obra_confirmar(uuid,boolean,text)') is not null),

  ('147 · modo de liberacao na matriz',
   exists (select 1 from information_schema.columns
            where table_name='cde_acesso_auria' and column_name='liberar_obra')),

  ('148 · disciplinas com documento (cde_disc_com_doc)',
   to_regprocedure('public.cde_disc_com_doc(uuid)') is not null),

  ('149 · destinatarios por ID',
   to_regprocedure('public.auria_emails_equipe(uuid)') is not null),

  ('125 · indexacao de PDF no servidor (cde_texto_pendentes)',
   to_regprocedure('public.cde_texto_pendentes(integer)') is not null
   or to_regprocedure('public.cde_texto_pendentes()') is not null),

  ('100 · federacao salva no CDE',
   exists (select 1 from information_schema.tables where table_name='cde_federacao_auria'))
)
select item,
       case when ok then 'ok' else '⚠ FALTA' end as situacao
  from c
 order by (case when ok then 1 else 0 end), item;
