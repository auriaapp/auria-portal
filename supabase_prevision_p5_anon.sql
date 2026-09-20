-- 77f: corrige a anon key no Vault (precisa ser a anon JWT "eyJ…", não a publishable key). Reaplicável.
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'supabase_anon_key';
  if v_id is null then perform vault.create_secret('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhYnpjY29rdWVvd3Byb213eGRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjIxMTcsImV4cCI6MjA5MDQ5ODExN30.2sjY0auOwEEjkaXF7jaE_fRB8FG5H2r18BQqp-5HOcE', 'supabase_anon_key', 'anon key do projeto (chamadas pg_net → Edge Functions)');
  else perform vault.update_secret(v_id, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhYnpjY29rdWVvd3Byb213eGRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjIxMTcsImV4cCI6MjA5MDQ5ODExN30.2sjY0auOwEEjkaXF7jaE_fRB8FG5H2r18BQqp-5HOcE'); end if;
end $$;
select public.prevision_sync_auto() as requisicao;
