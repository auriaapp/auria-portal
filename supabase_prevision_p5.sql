-- ============================================================================
--  ITEM 77f — SINCRONIZAÇÃO AUTOMÁTICA DO PREVISION (todo dia às 05:00 em
--  Fortaleza = 08:00 UTC, fora do horário comercial que o Prevision pede).
--  pg_cron → pg_net → Edge Function `prevision` com o header x-auria-cron.
--
--  ANTES DE RODAR, defina o segredo do cron (qualquer texto longo aleatório):
--   1) Edge Functions › Secrets: PREVISION_CRON_SECRET = <segredo>
--   2) Substitua abaixo os dois valores: <SEGREDO> e <ANON_KEY> (a "anon public"
--      key do projeto: Settings › API). A anon key é pública por natureza; o que
--      protege é o segredo. Reaplicável (recria o job).
-- ============================================================================
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- segredo do cron no Vault (troque o valor; se já existir, atualiza)
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'prevision_cron_secret';
  if v_id is null then perform vault.create_secret('<SEGREDO>', 'prevision_cron_secret', 'Segredo do cron do Prevision (item 77f)');
  else perform vault.update_secret(v_id, '<SEGREDO>'); end if;
  select id into v_id from vault.secrets where name = 'supabase_anon_key';
  if v_id is null then perform vault.create_secret('<ANON_KEY>', 'supabase_anon_key', 'anon key do projeto (chamadas pg_net → Edge Functions)');
  else perform vault.update_secret(v_id, '<ANON_KEY>'); end if;
end $$;

-- dispara a sincronização (assíncrona via pg_net; a resposta fica em net._http_response)
create or replace function public.prevision_sync_auto()
returns bigint language plpgsql security definer set search_path = public as $$
declare v_secret text; v_anon text; v_req bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'prevision_cron_secret' limit 1;
  select decrypted_secret into v_anon   from vault.decrypted_secrets where name = 'supabase_anon_key'   limit 1;
  if v_secret is null or v_anon is null then raise exception 'Vault sem prevision_cron_secret / supabase_anon_key'; end if;
  select net.http_post(
    url     := 'https://sabzccokueowpromwxdg.supabase.co/functions/v1/prevision',
    headers := jsonb_build_object('Content-Type','application/json', 'apikey', v_anon, 'Authorization', 'Bearer '||v_anon, 'x-auria-cron', v_secret),
    body    := jsonb_build_object('acao','sync'),
    timeout_milliseconds := 120000
  ) into v_req;
  return v_req;
end $$;
revoke all on function public.prevision_sync_auto() from public, anon, authenticated;

-- agendamento: 05:00 Fortaleza (UTC-3) = 08:00 UTC, todo dia
do $$ begin perform cron.unschedule('prevision-sync'); exception when others then null; end $$;
select cron.schedule('prevision-sync', '0 8 * * *', $job$ select public.prevision_sync_auto(); $job$);

-- conferência
select jobid, jobname, schedule, active from cron.job where jobname = 'prevision-sync';

-- TESTE MANUAL (opcional): dispara agora e, ~20 s depois, veja a resposta:
--   select public.prevision_sync_auto();
--   select id, status_code, left(content::text, 300) from net._http_response order by id desc limit 1;
--   select fase, projeto_nome, sincronizado_em, sync_erro from prevision_vinculo_auria where ativo;
