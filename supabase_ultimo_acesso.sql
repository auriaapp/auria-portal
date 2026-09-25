-- ============================================================================
--  Item 126 — "nunca acessou" aparecia para todo mundo (2026-09-24)
--  Rodar no SQL Editor do Supabase.
--
--  Causa: usuarios_auria.ultimo_acesso nunca era preenchido. Existia um gatilho
--  antigo (handle_last_sign_in) apontando para a tabela `usuarios`, do schema
--  anterior — não para usuarios_auria. Ninguém escrevia na coluna, então a tela
--  dizia "nunca acessou" de todos, inclusive de quem entra todo dia.
--
--  Aqui a marcação passa a ser explícita: cada painel chama auria_ping_acesso()
--  ao abrir (no máximo uma vez a cada 6h, controlado no navegador). Não depende
--  de gatilho em auth.* (schema gerenciado pelo Supabase).
--
--  O backfill inicial usa auth.users.last_sign_in_at, que o Supabase mantém —
--  assim quem já entrou antes desta correção não fica com o campo vazio.
-- ============================================================================

create or replace function public.auria_ping_acesso()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.usuarios_auria
     set ultimo_acesso = now()
   where id = auth.uid()
     and (ultimo_acesso is null or ultimo_acesso < now() - interval '1 hour');
end $$;
grant execute on function public.auria_ping_acesso() to authenticated;

-- Backfill: o que o Auth já sabe sobre o último login de cada um.
update public.usuarios_auria u
   set ultimo_acesso = a.last_sign_in_at
  from auth.users a
 where a.id = u.id and u.ultimo_acesso is null and a.last_sign_in_at is not null;

select 'auria_ping_acesso' as item, exists(select 1 from pg_proc where proname='auria_ping_acesso') as ok
union all select 'usuários com último acesso',
       (select count(*) > 0 from public.usuarios_auria where ultimo_acesso is not null);

-- Conferência:
--   select nome, email, role, ultimo_acesso from public.usuarios_auria order by ultimo_acesso desc nulls last;
