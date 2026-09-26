-- ============================================================================
--  Checagem do item 125 — indexação de PDF no servidor (2026-09-26). Só lê.
--
--  O checklist da semana acusou "FALTA" para este item, mas a culpa foi da
--  MINHA verificação: procurei cde_texto_pendentes(integer) e (), quando a
--  assinatura real é (uuid). Aqui vai a checagem certa, peça por peça — a
--  cadeia tem cinco partes e uma pode estar de pé sem as outras.
-- ============================================================================

select 'cde_texto_pendentes(uuid)' as peca,
       (to_regprocedure('public.cde_texto_pendentes(uuid)') is not null)::text as ok,
       'lista os documentos sem texto extraído' as papel
union all
select 'cde_texto_set(uuid,text)',
       (to_regprocedure('public.cde_texto_set(uuid,text)') is not null)::text,
       'grava o texto e carimba texto_em'
union all
select 'coluna texto_em',
       exists(select 1 from information_schema.columns
               where table_name='cde_documento_auria' and column_name='texto_em')::text,
       'sem ela, o backfill repete quem já falhou'
union all
select 'cde_convert_base()',
       (to_regprocedure('public.cde_convert_base()') is not null)::text,
       'devolve a URL/segredo do Cloud Run pelo Vault'
union all
select 'cde_texto_indexar_auto()',
       (to_regprocedure('public.cde_texto_indexar_auto()') is not null)::text,
       'dispara a indexação quando o arquivo entra'
union all
select 'gatilho trg_cde_texto_indexar',
       exists(select 1 from pg_trigger where tgname='trg_cde_texto_indexar' and not tgisinternal)::text,
       'liga o gatilho acima à tabela de arquivos'
union all
select 'cde_texto_lote(int)',
       (to_regprocedure('public.cde_texto_lote(integer)') is not null)::text,
       'rede de segurança: pega o que escapou'
union all
select 'cron cde-texto-lote',
       coalesce((select count(*)::text from cron.job where jobname='cde-texto-lote'), 'sem acesso a cron.job'),
       'roda o lote a cada 5 min'
union all
select 'documentos SEM texto indexado',
       coalesce((select count(*)::text from public.cde_documento_auria
                  where coalesce(arquivado,false)=false and texto_em is null), '—'),
       'quanto ainda falta indexar'
union all
select 'documentos COM texto',
       coalesce((select count(*)::text from public.cde_documento_auria
                  where texto_em is not null), '—'),
       'quanto já está pesquisável';
