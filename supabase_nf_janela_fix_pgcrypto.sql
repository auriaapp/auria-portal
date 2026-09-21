-- Hotfix 2026-09-21: nf_listar / nf_enviar / nf_enviar_externa foram criadas com
-- search_path = public e não enxergavam o pgcrypto (schema extensions) →
-- "function pgp_sym_decrypt(bytea, text) does not exist" no Painel Financeiro.
alter function public.nf_listar(uuid, text) set search_path = public, extensions;
alter function public.nf_enviar(uuid, numeric, text, text, text, date, text) set search_path = public, extensions;
alter function public.nf_enviar_externa(text, uuid, uuid, text, text, text, text, text, numeric, text, date, text, text) set search_path = public, extensions;
select proname, proconfig from pg_proc where proname in ('nf_listar','nf_enviar','nf_enviar_externa');
