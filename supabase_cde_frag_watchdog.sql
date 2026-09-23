-- ============================================================================
--  Item 83 — ANTI-FALHA da conversão IFC → .frag (2026-09-23)
--  Rodar no SQL Editor do Supabase.
--
--  Problema: quando o conversor (Cloud Run) morre no meio — estouro de memória,
--  timeout, reinício da instância — o bloco catch nunca roda e o arquivo fica
--  em "processando…" para sempre (3 modelos ficaram dias assim).
--
--  Solução em três camadas:
--   1) heartbeat — o conversor carimba frag_heartbeat a cada progresso;
--   2) watchdog (pg_cron a cada 10 min) — quem está 'pendente'/'processando' sem
--      sinal de vida há mais de 25 min é RE-ENFILEIRADO automaticamente (até 3
--      tentativas) e, esgotadas as tentativas, vira 'erro' com motivo legível;
--   3) aviso — na falha definitiva, e-mail aos super_admins.
--
--  cde_frag_destravar(arquivo) deixa o financeiro/coordenador forçar na mão.
-- ============================================================================

alter table public.cde_arquivo_auria
  add column if not exists frag_tentativas int not null default 0,
  add column if not exists frag_heartbeat  timestamptz,
  add column if not exists frag_inicio     timestamptz;

create index if not exists idx_cde_arq_frag_vivos on public.cde_arquivo_auria(frag_heartbeat)
  where frag_status in ('pendente','processando');

-- ── Disparo (reaproveita os segredos do Vault já usados pelo trigger) ───────
create or replace function public.cde_frag_disparar(p_arquivo uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_url text; v_seg text; r record;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='bim_convert_url'    limit 1;
  select decrypted_secret into v_seg from vault.decrypted_secrets where name='bim_convert_secret' limit 1;
  if v_url is null or v_seg is null or v_seg = 'COLE_AQUI_O_TRIGGER_SECRET' then return false; end if;
  select id, storage_path into r from public.cde_arquivo_auria where id = p_arquivo;
  if r.id is null then return false; end if;
  update public.cde_arquivo_auria
     set frag_status='pendente', frag_progress=null, frag_inicio=now(), frag_heartbeat=null
   where id = p_arquivo;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type','application/json','X-Auria-Secret', v_seg),
    body    := jsonb_build_object('arquivoId', r.id, 'path', r.storage_path));
  return true;
end $$;
revoke all on function public.cde_frag_disparar(uuid) from public, anon, authenticated;

-- ── Watchdog ────────────────────────────────────────────────────────────────
create or replace function public.cde_frag_watchdog(p_minutos int default 25, p_max_tentativas int default 3)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_re int := 0; v_err int := 0; v_dest text[]; v_lista text := ''; v_ok boolean;
begin
  for r in
    select a.id, a.nome, coalesce(a.frag_tentativas,0) as tent,
           coalesce(a.frag_heartbeat, a.frag_inicio, a.enviado_em) as visto
      from public.cde_arquivo_auria a
     where a.frag_status in ('pendente','processando')
       and coalesce(a.frag_heartbeat, a.frag_inicio, a.enviado_em) < now() - make_interval(mins => p_minutos)
     order by a.enviado_em
     limit 50
  loop
    if r.tent < p_max_tentativas - 1 then
      update public.cde_arquivo_auria
         set frag_tentativas = r.tent + 1,
             frag_error = 'sem resposta do conversor — nova tentativa ' || (r.tent + 2) || '/' || p_max_tentativas
       where id = r.id;
      v_ok := public.cde_frag_disparar(r.id);
      if v_ok then v_re := v_re + 1;
      else
        update public.cde_arquivo_auria set frag_status='erro',
               frag_error='conversor não configurado (segredos bim_convert_url/bim_convert_secret no Vault)', frag_progress=null
         where id = r.id;
        v_err := v_err + 1;
      end if;
    else
      update public.cde_arquivo_auria
         set frag_status='erro', frag_progress=null,
             frag_error='A conversão não respondeu depois de ' || p_max_tentativas ||
                        ' tentativas. Em geral o modelo excede a memória do conversor — divida por disciplina/pavimento ou aumente a memória do serviço.'
       where id = r.id;
      v_err := v_err + 1;
      v_lista := v_lista || '<li>' || public.auria_esc(coalesce(r.nome,'(sem nome)')) ||
                 ' — parado desde ' || to_char(r.visto at time zone 'America/Fortaleza','DD/MM HH24:MI') || '</li>';
    end if;
  end loop;

  if v_lista <> '' then
    select array_agg(distinct lower(u.email)) into v_dest
      from public.usuarios_auria u where u.role = 'super_admin' and coalesce(u.email,'') <> '';
    if coalesce(array_length(v_dest,1),0) > 0 then
      perform public.auria_send_email(v_dest,
        'Auria — conversão de modelo BIM falhou',
        public.auria_email_shell('Modelos BIM', 'Conversão sem resposta',
          '<p style="margin:0 0 12px;color:#334155;font-size:14px">O serviço de conversão não respondeu para os arquivos abaixo. Eles foram marcados como <b>erro</b> e podem ser reenviados pelo botão “Falhou — tentar de novo” no CDE.</p><ul style="color:#334155;font-size:13px">'
          || v_lista || '</ul>', 'Abrir o CDE', 'https://auria.solutions/cde.html'));
    end if;
  end if;
  return jsonb_build_object('reenfileirados', v_re, 'com_erro', v_err);
end $$;
revoke all on function public.cde_frag_watchdog(int,int) from public, anon, authenticated;

-- ── Destravar na mão (coordenador/gestão/super_admin) ───────────────────────
create or replace function public.cde_frag_destravar(p_arquivo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select d.empreendimento_id into v_emp
    from public.cde_arquivo_auria a
    join public.cde_revisao_auria r on r.id = a.revisao_id
    join public.cde_documento_auria d on d.id = r.documento_id
   where a.id = p_arquivo;
  if v_emp is null then raise exception 'Arquivo não encontrado.'; end if;
  if not (public.minha_role_auria() in ('super_admin','gerente') or public.estacao_edita(v_emp)) then
    raise exception 'Sem permissão para reenviar a conversão deste arquivo.';
  end if;
  update public.cde_arquivo_auria set frag_tentativas = 0, frag_error = null where id = p_arquivo;
  if not public.cde_frag_disparar(p_arquivo) then
    raise exception 'Conversor não configurado (segredos no Vault).';
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.cde_frag_destravar(uuid) to authenticated;

-- ── Agenda: a cada 10 minutos ───────────────────────────────────────────────
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('cde-frag-watchdog'); exception when others then null; end $$;
select cron.schedule('cde-frag-watchdog', '*/10 * * * *', $job$ select public.cde_frag_watchdog(); $job$);

-- ── Destrava AGORA o que já está parado (roda o watchdog uma vez) ───────────
select public.cde_frag_watchdog(25) as resultado_agora;

select 'frag_tentativas' as item, exists(select 1 from information_schema.columns where table_name='cde_arquivo_auria' and column_name='frag_tentativas') as ok
union all select 'frag_heartbeat', exists(select 1 from information_schema.columns where table_name='cde_arquivo_auria' and column_name='frag_heartbeat')
union all select 'cde_frag_watchdog', exists(select 1 from pg_proc where proname='cde_frag_watchdog')
union all select 'cde_frag_destravar', exists(select 1 from pg_proc where proname='cde_frag_destravar')
union all select 'cron cde-frag-watchdog', exists(select 1 from cron.job where jobname='cde-frag-watchdog');

-- Diagnóstico (rode depois para ver como estão os modelos):
--   select nome, frag_status, frag_progress, frag_tentativas, frag_error,
--          frag_heartbeat, enviado_em
--     from public.cde_arquivo_auria where extensao ilike 'ifc' order by enviado_em desc limit 20;
