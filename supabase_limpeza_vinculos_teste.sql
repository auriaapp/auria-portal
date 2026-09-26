-- ============================================================================
--  Item 139 — fechamento: contas de teste vinculadas a empreendimento real
--  (2026-09-26). Rodar no SQL Editor. O PASSO 1 só LÊ.
--
--  CONCLUSÃO DA INVESTIGAÇÃO: não houve vazamento por falha de código. O aviso
--  de faturamento foi para quem estava vinculado ao empreendimento — e entre os
--  vinculados está tvmedeiros+ger@gmail.com, uma conta de TESTE cujo alias '+'
--  o Gmail entrega em tvmedeiros@gmail.com.
--
--  Como ela entra: o empresa_id dela é o Grupo Teste, não o Grupo Diagonal,
--  então não entra pelo ramo dos gestores de auria_emails_equipe. Entra pelo
--  ramo dos ANALISTAS VINCULADOS, que não confere nem papel nem grupo.
--
--  Dois problemas de verdade saem daqui:
--    · contas de teste recebendo correspondência comercial de cliente;
--    · analista_empreendimento_auria aceita vínculo ENTRE GRUPOS diferentes.
-- ============================================================================


-- ── PASSO 1 — olhar antes de mexer (só SELECT) ────────────────────────────
--  Todo vínculo de analista onde o usuário é de um grupo DIFERENTE do
--  empreendimento. É aqui que a conta de teste aparece.
select u.email                                   as usuario,
       coalesce(u.role,'?')                      as papel,
       e.nome                                    as empreendimento,
       coalesce(ge.nome,'(sem grupo)')           as grupo_do_empreendimento,
       coalesce(gu.nome,'(sem grupo)')           as grupo_do_usuario,
       case when u.empresa_id is distinct from e.empresa_id
            then '⚠ GRUPOS DIFERENTES' else 'ok' end as situacao,
       ae.papel                                  as papel_no_empreendimento,
       ae.ativo
  from public.analista_empreendimento_auria ae
  join public.usuarios_auria u          on u.id = ae.analista_id
  join public.empreendimentos_auria e   on e.id = ae.empreendimento_id
  left join public.empresas_auria ge    on ge.id = e.empresa_id
  left join public.empresas_auria gu    on gu.id = u.empresa_id
 where coalesce(ae.ativo,true)
 order by situacao desc, e.nome, u.email;


-- ── PASSO 2 — só depois de olhar a lista acima ────────────────────────────
--  Desativa (NÃO apaga) os vínculos entre grupos diferentes. O histórico fica.
--  Descomente e rode quando tiver conferido que nenhum deles é legítimo.
--
--  update public.analista_empreendimento_auria ae
--     set ativo = false
--    from public.usuarios_auria u, public.empreendimentos_auria e
--   where u.id = ae.analista_id
--     and e.id = ae.empreendimento_id
--     and coalesce(ae.ativo,true)
--     and u.empresa_id is distinct from e.empresa_id;


-- ── PASSO 3 — impedir que volte a acontecer ───────────────────────────────
--  Um vínculo de analista só faz sentido dentro do mesmo grupo. Sem esta trava,
--  qualquer erro de clique na Distribuição refaz o problema — e desta vez com
--  correspondência comercial indo para fora do grupo.
--  Rode DEPOIS do passo 2 (senão ele reprova as linhas que já existem).
--
--  create or replace function public.ae_guard_mesmo_grupo()
--  returns trigger language plpgsql security definer set search_path = public as $$
--  declare v_gu uuid; v_ge uuid;
--  begin
--    if not coalesce(new.ativo, true) then return new; end if;
--    select empresa_id into v_gu from public.usuarios_auria       where id = new.analista_id;
--    select empresa_id into v_ge from public.empreendimentos_auria where id = new.empreendimento_id;
--    if v_gu is not null and v_ge is not null and v_gu is distinct from v_ge then
--      raise exception 'Este usuário é de outro grupo — não pode ser vinculado a este empreendimento.';
--    end if;
--    return new;
--  end $$;
--  drop trigger if exists trg_ae_guard_mesmo_grupo on public.analista_empreendimento_auria;
--  create trigger trg_ae_guard_mesmo_grupo
--    before insert or update on public.analista_empreendimento_auria
--    for each row execute function public.ae_guard_mesmo_grupo();
