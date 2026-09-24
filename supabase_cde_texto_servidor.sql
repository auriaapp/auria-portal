-- ============================================================================
--  Item 125 — indexação do texto dos PDFs NO SERVIDOR (2026-09-24)
--  Rodar no SQL Editor do Supabase (depois de supabase_cde_texto_pendentes.sql
--  e do redeploy do Cloud Run com os endpoints /index-pdf e /index-pdf-lote).
--
--  Antes, a extração rodava no navegador (pdf.js na fila do CDE): dependia da
--  aba aberta. Agora é o mesmo desenho do IFC→.frag — o banco chama o serviço
--  do Cloud Run, que baixa o PDF, extrai e grava texto_busca/texto_em.
--
--   • gatilho no upload: PDF novo → indexa aquele documento
--   • cron de 5 em 5 min: processa o acúmulo em lotes de 25 e para sozinho
--     quando não houver mais nada (sai barato: uma chamada que não faz nada).
-- ============================================================================

-- A URL guardada no Vault aponta para /convert; os outros endpoints ficam ao lado.
create or replace function public.cde_convert_base()
returns text language sql stable security definer set search_path = public as $$
  select regexp_replace(
           (select decrypted_secret from vault.decrypted_secrets where name='bim_convert_url' limit 1),
           '/convert/?$', '');
$$;

-- ── 1) Upload de PDF → indexa aquele documento ──────────────────────────────
create or replace function public.cde_texto_indexar_auto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_base text; v_seg text; v_doc uuid;
begin
  if lower(coalesce(new.extensao,'')) <> 'pdf' then return new; end if;
  select decrypted_secret into v_seg from vault.decrypted_secrets where name='bim_convert_secret' limit 1;
  v_base := public.cde_convert_base();
  if v_base is null or v_seg is null or v_seg = 'COLE_AQUI_O_TRIGGER_SECRET' then return new; end if;

  select d.id into v_doc
    from public.cde_revisao_auria r
    join public.cde_documento_auria d on d.id = r.documento_id
   where r.id = new.revisao_id;
  if v_doc is null then return new; end if;

  -- o documento volta a "pendente" para o lote pegá-lo caso a chamada falhe
  update public.cde_documento_auria set texto_em = null where id = v_doc;
  perform net.http_post(
    url     := v_base || '/index-pdf',
    headers := jsonb_build_object('Content-Type','application/json','X-Auria-Secret', v_seg),
    body    := jsonb_build_object('documentoId', v_doc));
  return new;
end $$;

drop trigger if exists trg_cde_texto_indexar on public.cde_arquivo_auria;
create trigger trg_cde_texto_indexar
  after insert on public.cde_arquivo_auria
  for each row execute function public.cde_texto_indexar_auto();

-- ── 2) Lote do acúmulo (cron) ───────────────────────────────────────────────
create or replace function public.cde_texto_lote(p_limite int default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_base text; v_seg text; v_pend int;
begin
  select count(*) into v_pend from public.cde_documento_auria where texto_em is null;
  if v_pend = 0 then return jsonb_build_object('pendentes', 0, 'chamou', false); end if;
  select decrypted_secret into v_seg from vault.decrypted_secrets where name='bim_convert_secret' limit 1;
  v_base := public.cde_convert_base();
  if v_base is null or v_seg is null then return jsonb_build_object('erro','conversor não configurado no Vault'); end if;
  perform net.http_post(
    url     := v_base || '/index-pdf-lote',
    headers := jsonb_build_object('Content-Type','application/json','X-Auria-Secret', v_seg),
    body    := jsonb_build_object('limite', p_limite));
  return jsonb_build_object('pendentes', v_pend, 'chamou', true, 'limite', p_limite);
end $$;
revoke all on function public.cde_texto_lote(int) from public, anon, authenticated;

create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('cde-texto-lote'); exception when others then null; end $$;
select cron.schedule('cde-texto-lote', '*/5 * * * *', $job$ select public.cde_texto_lote(25); $job$);

-- Empurra o primeiro lote agora (o resto vai de 5 em 5 minutos):
select public.cde_texto_lote(25) as primeiro_lote;

select 'cde_texto_indexar_auto' as item, exists(select 1 from pg_proc where proname='cde_texto_indexar_auto') as ok
union all select 'trg_cde_texto_indexar', exists(select 1 from pg_trigger where tgname='trg_cde_texto_indexar')
union all select 'cde_texto_lote', exists(select 1 from pg_proc where proname='cde_texto_lote')
union all select 'cron cde-texto-lote', exists(select 1 from cron.job where jobname='cde-texto-lote');

-- Acompanhar (rode de novo depois de alguns minutos):
--   select count(*) filter (where texto_em is null) as faltam,
--          count(*) filter (where texto_em is not null) as prontos
--     from public.cde_documento_auria;
