-- ============================================================================
--  Item 141 — convite com validade PRÓPRIA de 3 dias (2026-09-26)
--  Rodar no SQL Editor. Reaplicável.
--
--  O PROBLEMA MEDIDO: em uma semana de teste, DUAS vezes o projetista passou
--  das 24h e o convite venceu. O custo caía na coordenação, que tinha de entrar
--  e reenviar.
--
--  POR QUE NÃO BASTAVA SUBIR O PRAZO NO SUPABASE: aquele campo ("Email OTP
--  expiration") é GLOBAL — governa convite, magic link e RECUPERAÇÃO DE SENHA.
--  Subir para 3 dias faria um link de redefinir senha viver 3 dias numa caixa
--  de entrada. Trocar segurança de senha por conveniência de convite é mau
--  negócio.
--
--  COMO FUNCIONA: o token desta tabela é o que vale 3 dias. Quando a pessoa
--  abre o link, a Edge Function convite-resgatar valida o token e SÓ ENTÃO
--  pede ao Supabase um link de uso imediato — que a página consome na hora.
--  As 24h do Supabase nunca chegam a correr. O prazo global fica em 86400.
--
--  O QUE VAI PARA O BANCO: só o SHA-256 do token. O token cru existe no e-mail
--  e na memória da função, nunca numa linha. É o mesmo princípio do
--  "hashed_token" do Supabase — se a tabela vazar num backup ou por uma chave
--  de serviço exposta, o que sai de lá não abre conta nenhuma.
-- ============================================================================

create table if not exists public.convite_token_auria (
  id           uuid primary key default gen_random_uuid(),
  token_sha    text not null unique,          -- SHA-256 do token; o token CRU nunca é gravado
  email        text not null,
  nome         text,
  papel        text,                          -- projetista | setor | financeiro | obra | analista
  user_id      uuid,                          -- conta criada no auth no momento do convite
  empresa_nome text,
  criado_por   uuid,
  criado_em    timestamptz not null default now(),
  expira_em    timestamptz not null default (now() + interval '3 days'),
  usado_em     timestamptz,                   -- uso ÚNICO
  tentativas   int not null default 0
);
-- Migração de quem rodou a 1ª versão deste arquivo (coluna 'token' em claro).
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_name='convite_token_auria' and column_name='token') then
    alter table public.convite_token_auria add column if not exists token_sha text;
    -- Nenhum convite tinha sido enviado ainda com a versão em claro: os que
    -- existirem viram inválidos de propósito, em vez de migrar segredo.
    delete from public.convite_token_auria where token_sha is null;
    alter table public.convite_token_auria drop column token;
    alter table public.convite_token_auria alter column token_sha set not null;
    create unique index if not exists convite_token_auria_token_sha_key
      on public.convite_token_auria(token_sha);
  end if;
end $$;

create index if not exists idx_convtk_email on public.convite_token_auria(lower(email));
create index if not exists idx_convtk_exp   on public.convite_token_auria(expira_em) where usado_em is null;

comment on table public.convite_token_auria is
  'Convite com validade própria (item 141). O token daqui vale 3 dias; o link do Supabase só é gerado no resgate.';

-- Ninguém acessa esta tabela pelo cliente: só as Edge Functions, com service
-- role. Um token vazado é um convite vazado.
alter table public.convite_token_auria enable row level security;
revoke all on public.convite_token_auria from anon, authenticated;

-- A gestão precisa VER o estado do convite (pendente, usado, vencido) para a
-- tela de usuários — sem nunca ler o token.
create or replace function public.convite_estado(p_email text)
returns table(papel text, criado_em timestamptz, expira_em timestamptz,
              usado_em timestamptz, situacao text)
language sql security definer stable set search_path = public as $$
  select t.papel, t.criado_em, t.expira_em, t.usado_em,
         case when t.usado_em is not null then 'aceito'
              when t.expira_em < now()    then 'vencido'
              else 'pendente' end
    from public.convite_token_auria t
   where lower(t.email) = lower(p_email)
     and public.minha_role_auria() in ('gerente','super_admin','analista')
   order by t.criado_em desc
   limit 5;
$$;
grant execute on function public.convite_estado(text) to authenticated;

-- Faxina: convite vencido há mais de 30 dias não serve para nada e só guarda
-- e-mail de gente que nunca entrou.
create or replace function public.convite_token_faxina()
returns int language sql security definer set search_path = public as $$
  with x as (delete from public.convite_token_auria
              where usado_em is null and expira_em < now() - interval '30 days'
              returning 1)
  select count(*)::int from x;
$$;

select 'convite_token_auria' as item,
       exists(select 1 from information_schema.tables where table_name='convite_token_auria')::text as valor
union all select 'convite_estado', (to_regprocedure('public.convite_estado(text)') is not null)::text;
