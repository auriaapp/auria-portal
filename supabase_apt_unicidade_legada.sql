-- ============================================================================
--  Item 134 (raiz) — remover a unicidade por NOME do empreendimento
--  Rodar no SQL Editor do Supabase. Reversível (ver o fim do arquivo).
--
--  O DIAGNÓSTICO QUE FECHOU O CASO:
--    · 9 dos 10 apontamentos têm apontamentos.empreendimento (texto) DIFERENTE
--      do nome real do empreendimento_id. O nome ficou para trás — renomeação,
--      rótulo antigo do desktop, o que seja.
--    · A constraint apontamentos_emp_id_uni é UNIQUE (empreendimento, id), ou
--      seja, está fundada exatamente nesse texto não confiável. Dois
--      empreendimentos podem colidir entre si quando um deles carrega, no
--      histórico, o nome que hoje é do outro.
--    · A regra de negócio de verdade — "um id por empreendimento" — já é
--      garantida por apontamentos_empreendimento_id_id_key (empreendimento_id,
--      id), e empreendimento_id não é nulo em nenhuma linha.
--
--  POR QUE NÃO QUEBRA O DESKTOP: o Auria.py envia com
--  'Prefer: resolution=merge-duplicates' e SEM on_conflict, então o PostgREST
--  resolve pela CHAVE PRIMÁRIA (id, user_id) — nunca por esta constraint. O
--  DELETE dele filtra por user_id + empreendimento + ids, que é filtro e não
--  restrição. Nada ali depende do que estamos removendo.
--
--  Efeito prático: o erro "duplicate key ... apontamentos_emp_id_uni" deixa de
--  existir. A rede de segurança do app (apt_proximo_id + nova tentativa)
--  continua valendo para colisão real de id dentro do mesmo empreendimento.
-- ============================================================================

do $$
declare v_dup int;
begin
  -- Guarda: só remove se a unicidade BOA estiver de pé e sem duplicata.
  if not exists (
       select 1 from pg_constraint con join pg_class c on c.oid = con.conrelid
        where c.relname = 'apontamentos'
          and con.conname = 'apontamentos_empreendimento_id_id_key') then
    raise exception 'A unicidade por (empreendimento_id, id) não existe — abortando para não deixar a tabela sem proteção nenhuma.';
  end if;

  select count(*) into v_dup from (
    select empreendimento_id, id from public.apontamentos
     group by empreendimento_id, id having count(*) > 1) x;
  if v_dup > 0 then
    raise exception 'Há % par(es) (empreendimento_id, id) duplicados — resolver antes.', v_dup;
  end if;

  alter table public.apontamentos drop constraint if exists apontamentos_emp_id_uni;
  raise notice 'apontamentos_emp_id_uni removida.';
end $$;

comment on column public.apontamentos.empreendimento is
  'NOME do empreendimento, mantido para o desktop (que trabalha por nome). É DESCRITIVO: pode estar desatualizado e NÃO participa de unicidade desde 2026-09-25 — a identidade é (empreendimento_id, id).';


-- ── Conferência ────────────────────────────────────────────────────────────
select con.conname as constraint_nome,
       pg_get_constraintdef(con.oid) as definicao
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
 where c.relname = 'apontamentos' and con.contype in ('u','p')
 order by con.conname;

-- ── Para desfazer, se algum dia fizer falta ───────────────────────────────
--   alter table public.apontamentos
--     add constraint apontamentos_emp_id_uni unique (empreendimento, id);
--   (antes, alinhar o nome: update public.apontamentos a set empreendimento = e.nome
--    from public.empreendimentos_auria e where e.id = a.empreendimento_id;)
