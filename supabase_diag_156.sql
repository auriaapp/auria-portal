-- ============================================================================
--  Item 156 — quem realmente tem senha? (2026-09-26). SÓ LÊ, não muda nada.
--
--  O aviso "já tem conta ativa" hoje é decidido por last_sign_in_at. Mas o
--  resgate do convite (convite-resgatar → verifyOtp) CRIA SESSÃO antes de a
--  pessoa definir a senha. Ou seja: last_sign_in_at é carimbado no instante em
--  que ela CLICA no link, não quando termina o cadastro.
--
--  Quem abre o link e fecha a aba antes de salvar a senha fica assim:
--     · last_sign_in_at  → preenchido  (logo, "conta ativa" → reenvio negado)
--     · senha            → NÃO EXISTE  ("Esqueci minha senha" é o único caminho)
--     · token do convite → já queimado (uso único)
--
--  Esta consulta mostra o estado de verdade. Nada de senha é lido — só se o
--  campo está vazio ou não.
-- ============================================================================

-- 1) Todo mundo que foi convidado como projetista, com o estado real da conta
select p.email,
       coalesce(nullif(p.nome,''), '—')                        as nome,
       f.nome                                                  as fornecedor,
       (u.id is not null)                                      as tem_conta_no_auth,
       (coalesce(u.encrypted_password,'') <> '')               as tem_senha,
       u.last_sign_in_at,
       u.email_confirmed_at,
       case
         when u.id is null                            then 'nunca convidado'
         when coalesce(u.encrypted_password,'') <> '' then 'ATIVO (tem senha)'
         when u.last_sign_in_at is not null           then '>>> ABRIU O LINK E NAO DEFINIU SENHA <<<'
         else 'convidado, nunca abriu'
       end                                                     as situacao
  from public.projetistas_auria p
  left join public.fornecedores_auria f on f.id = p.fornecedor_id
  left join auth.users u on lower(u.email) = lower(p.email)
 where coalesce(p.ativo,true)
 order by 8, 1;


-- 2) O histórico de convites de cada e-mail (o token de 3 dias, item 141)
select c.email,
       c.papel,
       c.criado_em,
       c.expira_em,
       c.usado_em,
       c.tentativas,
       case when c.usado_em is not null          then 'resgatado'
            when c.expira_em < now()             then 'VENCIDO'
            else 'válido até ' || to_char(c.expira_em, 'DD/MM HH24:MI') end as estado
  from public.convite_token_auria c
 order by c.criado_em desc
 limit 30;


-- 3) Resumo: quantos estão presos no meio do caminho
select count(*) filter (where coalesce(u.encrypted_password,'') <> '')                                as com_senha,
       count(*) filter (where coalesce(u.encrypted_password,'') =  '' and u.last_sign_in_at is not null) as presos_sem_senha,
       count(*) filter (where coalesce(u.encrypted_password,'') =  '' and u.last_sign_in_at is null)     as convite_pendente,
       count(*)                                                                                       as total_contas
  from auth.users u;
