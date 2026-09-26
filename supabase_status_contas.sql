-- ============================================================================
--  Item 156 — situação da conta de cada pessoa convidada (2026-09-26)
--  Rodar no SQL Editor. Reaplicável; não altera dado nenhum.
--
--  O PROBLEMA: o ✉ da tela de fornecedor era mudo. Clicar era a única forma de
--  descobrir o estado da conta, e a resposta vinha como alerta — "já tem conta
--  ativa, use Esqueci minha senha" — sem caminho nenhum a partir dali. Quem
--  coordena não tinha como saber, olhando a lista, quem já definiu senha e quem
--  nunca abriu o convite.
--
--  O SINAL HONESTO é auth.users.encrypted_password: vazio = a pessoa NUNCA
--  definiu senha. last_sign_in_at não serve sozinho, porque o resgate do
--  convite (convite-resgatar → verifyOtp) cria sessão no instante do CLIQUE,
--  antes de ativar_conta.html gravar a senha. Hoje ninguém está nesse estado
--  (conferido em 26/09: 0 presos), mas a janela existe — e o portão do reenvio
--  passa a olhar a senha, não o último acesso.
--
--  NADA DE SENHA SAI DAQUI — só o booleano "o campo está vazio?".
--
--  ESCOPO: a função só responde sobre e-mails que já pertencem ao grupo de quem
--  pergunta (projetistas dos seus fornecedores + usuários da sua empresa).
--  Sem isso, qualquer analista poderia sondar "fulano@concorrente.com tem conta
--  no Auria?" — enumeração de e-mails que não interessa a ninguém aqui.
-- ============================================================================

-- ── 1. Para a tela: situação de uma lista de e-mails ────────────────────────
create or replace function public.auria_status_contas(p_emails text[])
returns table(email          text,
              tem_conta      boolean,
              tem_senha      boolean,
              ultimo_acesso  timestamptz,
              convite_expira timestamptz,
              convite_usado  timestamptz,
              situacao       text)
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_role text := coalesce(public.minha_role_auria(),'');
  v_emp  uuid := public.minha_empresa();
begin
  -- Levanta em vez de devolver vazio de propósito: vazio confundiria "esta
  -- pessoa não tem conta" com "você não pode ver isto", que pedem reações
  -- opostas. A tela trata a exceção escondendo os selos.
  if v_role not in ('analista','gerente','super_admin') then
    raise exception 'sem permissão para consultar situação de contas';
  end if;

  return query
  with pedidos as (
    select distinct lower(trim(em)) as em
      from unnest(p_emails) as t(em)
     where coalesce(trim(em),'') <> ''
  ),
  meus as (
    select lower(p.email) as em
      from public.projetistas_auria p
      join public.fornecedores_auria f on f.id = p.fornecedor_id
     where v_role = 'super_admin' or f.empresa_id = v_emp
    union
    select lower(u.email)
      from public.usuarios_auria u
     where v_role = 'super_admin' or u.empresa_id = v_emp
  )
  select q.em                                               as email,
         (u.id is not null)                                 as tem_conta,
         (coalesce(u.encrypted_password,'') <> '')          as tem_senha,
         u.last_sign_in_at                                  as ultimo_acesso,
         cv.expira_em                                       as convite_expira,
         cv.usado_em                                        as convite_usado,
         case
           when u.id is null and cv.id is null                  then 'nunca_convidado'
           when coalesce(u.encrypted_password,'') <> ''         then 'ativo'
           when u.last_sign_in_at is not null                   then 'sem_senha'
           when cv.id is not null and cv.usado_em is null
                                 and cv.expira_em >  now()      then 'convite_pendente'
           when cv.id is not null and cv.expira_em <= now()     then 'convite_vencido'
           else 'convidado'
         end                                                as situacao
    from pedidos q
    join meus m on m.em = q.em                       -- só quem é do grupo
    left join auth.users u on lower(u.email) = q.em
    left join lateral (
      select c.id, c.expira_em, c.usado_em
        from public.convite_token_auria c
       where lower(c.email) = q.em
       order by c.criado_em desc
       limit 1
    ) cv on true;
end $$;

revoke all on function public.auria_status_contas(text[]) from public, anon;
grant execute on function public.auria_status_contas(text[]) to authenticated;

comment on function public.auria_status_contas(text[]) is
  'Situação da conta por e-mail (item 156): tem senha? convite pendente/vencido? Só analista/gerente/super_admin, e só e-mails do próprio grupo.';


-- ── 2. Para a Edge Function: o portão do reenvio ────────────────────────────
--  Nem o admin API nem o PostgREST expõem encrypted_password, então o
--  invite-projetista pergunta por aqui (com a chave de serviço). NÃO é
--  concedida a authenticated: quem está logado usa a função 1, que é limitada
--  por papel e por grupo.
create or replace function public.auria_conta_tem_senha(p_email text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from auth.users u
                  where lower(u.email) = lower(p_email)
                    and coalesce(u.encrypted_password,'') <> '');
$$;

revoke all on function public.auria_conta_tem_senha(text) from public, anon, authenticated;

comment on function public.auria_conta_tem_senha(text) is
  'A conta deste e-mail já tem senha definida? (item 156) Só chave de serviço — usada por invite-projetista.';


-- ── conferência ─────────────────────────────────────────────────────────────
--  ATENÇÃO: o SQL Editor roda como SERVIÇO, então minha_role_auria() é nulo e
--  chamar a função 1 aqui levanta exceção DE PROPÓSITO — é o portão
--  funcionando, não um erro. Por isso a conferência abaixo olha só estrutura e
--  permissão, que são honestas fora de sessão.
select 'auria_status_contas existe'                          as item,
       (to_regprocedure('public.auria_status_contas(text[])') is not null)::text as valor
union all
select 'auria_conta_tem_senha existe',
       (to_regprocedure('public.auria_conta_tem_senha(text)') is not null)::text
union all
select 'authenticated pode ver situação (esperado: true)',
       has_function_privilege('authenticated','public.auria_status_contas(text[])','execute')::text
union all
select 'authenticated pode ver senha (esperado: FALSE)',
       has_function_privilege('authenticated','public.auria_conta_tem_senha(text)','execute')::text
union all
select 'anon pode ver situação (esperado: FALSE)',
       has_function_privilege('anon','public.auria_status_contas(text[])','execute')::text;
