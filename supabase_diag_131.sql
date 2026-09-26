-- ============================================================================
--  Item 131 — lentidão do Painel de Custos. DIAGNÓSTICO, só lê. (2026-09-26)
--
--  A SUSPEITA: nf_listar chama nf_key() (que lê vault.decrypted_secrets) duas
--  vezes POR LINHA — uma para o número, outra para o valor. Função `stable` no
--  SELECT list é avaliada linha a linha, então são 2×N leituras do Vault por
--  listagem. minha_role_auria() aparece mais de uma vez no WHERE.
--
--  Antes de reescrever qualquer coisa eu preciso da versão que está NO BANCO:
--  o repositório tem quatro arquivos que definem nf_listar, aplicados em
--  sequência, e partir do arquivo errado reverteria correção já feita.
--
--  A medição abaixo é honesta no SQL Editor de propósito: ela NÃO chama
--  nf_listar() (que devolveria 0 linhas, porque minha_role_auria() é nulo fora
--  de sessão). Ela mede o custo do Vault por linha direto na tabela.
-- ============================================================================

-- ── 1. O código que está valendo AGORA (é isto que eu preciso ver) ──────────
select p.proname,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_functiondef(p.oid)                 as definicao_atual
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('nf_listar','fin_contratos','nf_bi')
 order by 1;


-- ── 2. Volume (para saber se o problema é N grande ou custo por linha) ──────
select 'notas_fiscais_auria' as tabela, count(*) as linhas from public.notas_fiscais_auria
union all select 'contratos_auria', count(*) from public.contratos_auria
union all select 'parcelas_auria',  count(*) from public.parcelas_auria;


-- ── 3. A medição: quanto custa ler o Vault UMA vez por linha ────────────────
--  Se a suspeita estiver certa, o tempo aqui cresce proporcional ao número de
--  linhas — e na nf_listar real é o DOBRO disto (número + valor).
explain (analyze, timing, summary)
  select public.nf_key() from public.notas_fiscais_auria;

--  Contraprova: a mesma tabela sem tocar no Vault. A diferença entre os dois
--  tempos é o preço que a correção devolve.
explain (analyze, timing, summary)
  select id from public.notas_fiscais_auria;


-- ── 4. Quantas vezes cada função repete as chamadas caras ───────────────────
select p.proname,
       (length(p.prosrc) - length(replace(p.prosrc,'nf_key()','')))            / length('nf_key()')            as chamadas_nf_key,
       (length(p.prosrc) - length(replace(p.prosrc,'minha_role_auria()','')))  / length('minha_role_auria()')  as chamadas_role,
       (length(p.prosrc) - length(replace(p.prosrc,'minha_empresa()','')))     / length('minha_empresa()')     as chamadas_empresa
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('nf_listar','fin_contratos','nf_bi','nf_enviar')
 order by 1;
