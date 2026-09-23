-- ============================================================================
--  Item 96 — projetista não conseguia SOLICITAR faturamento (2026-09-23)
--  Rodar no SQL Editor do Supabase.
--
--  Causa: o trigger parc_guard_projetista (supabase_hardening_seguranca.sql) só
--  aceitava mudança na coluna `status`. O painel do projetista envia também
--  data_solicitacao, observacao e atualizado_em → "Projetista só pode alterar o
--  status da parcela". Aqui o guard passa a aceitar ESSAS colunas na transição
--  a_faturar/recusada → solicitada, e continua bloqueando valor, vencimento,
--  número da NF, datas de faturamento/pagamento e qualquer outra coluna.
-- ============================================================================

create or replace function public.parc_guard_projetista()
returns trigger language plpgsql as $$
declare permitido text[] := array['status','data_solicitacao','observacao','atualizado_em'];
        diff jsonb;
begin
  -- Contexto privilegiado (postgres / service_role / SQL editor / cron): sem restrição.
  if auth.uid() is null then return NEW; end if;
  if public.parc_sou_equipe(NEW.contrato_id) then return NEW; end if;   -- equipe interna

  -- Projetista: só a transição de solicitar faturamento.
  if not (OLD.status in ('a_faturar','recusada') and NEW.status = 'solicitada') then
    raise exception 'Projetista só pode mover a parcela para "solicitada" (a partir de a_faturar/recusada).';
  end if;
  -- e só nas colunas dessa solicitação.
  select jsonb_object_agg(key, value) into diff
    from jsonb_each(to_jsonb(NEW))
   where to_jsonb(NEW) -> key is distinct from to_jsonb(OLD) -> key
     and not (key = any(permitido));
  if diff is not null then
    raise exception 'Projetista só pode solicitar o faturamento (não alterar %).', (select string_agg(k, ', ') from jsonb_object_keys(diff) k);
  end if;
  return NEW;
end $$;

drop trigger if exists trg_parc_guard on public.parcelas_auria;
create trigger trg_parc_guard before update on public.parcelas_auria
  for each row execute function public.parc_guard_projetista();

select 'parc_guard_projetista' as item, exists(select 1 from pg_proc where proname='parc_guard_projetista') as ok
union all select 'trg_parc_guard', exists(select 1 from pg_trigger where tgname='trg_parc_guard');
