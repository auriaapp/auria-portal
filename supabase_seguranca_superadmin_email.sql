-- ============================================================================
--  INCIDENTE DE SEGURANÇA — 2026-09-25
--  O super_admin recebia e-mails de negócio dos CLIENTES.
--  Rodar no SQL Editor do Supabase.
--
--  O QUE ACONTECEU: o projetista da Mexxa pediu o faturamento de duas parcelas
--  e o aviso chegou numa conta que nunca teve esse acesso. Causa: o papel
--  super_admin — que é a conta de OPERAÇÃO da plataforma Auria, não um membro
--  da empresa do cliente — estava incluído nas listas de DESTINATÁRIOS.
--
--  Não era um caso isolado. Havia três lugares com o mesmo defeito:
--    1. Edge Function notify-fatura-solicitada  (foi o que vazou)  → corrigida
--    2. Edge Function notify-cde-upload         (toda entrega)     → corrigida
--    3. auria_emails_equipe()  ← ESTE ARQUIVO   (os 5 avisos de apontamento)
--
--  A distinção que faltava: permissão e destinatário são coisas diferentes.
--  O super_admin PRECISA enxergar tudo para operar; não deve RECEBER a
--  correspondência comercial de ninguém. Os alertas de plataforma (conversão
--  de IFC travada, em cde_frag_watchdog) continuam indo para ele — aquilo é
--  operação, não dado de cliente.
-- ============================================================================

-- ── A correção ─────────────────────────────────────────────────────────────
create or replace function public.auria_emails_equipe(nome_emp text)
returns text[] language sql security definer stable as $$
  select array_agg(distinct u.email)
  from public.usuarios_auria u
  where u.email is not null and (
    -- analistas designados para o empreendimento
    u.id in (select ae.analista_id from public.analista_empreendimento_auria ae
             join public.empreendimentos_auria e on e.id=ae.empreendimento_id
             where e.nome=nome_emp and ae.ativo=true)
    -- gestores DA EMPRESA do empreendimento (super_admin removido em 2026-09-25)
    or (u.role = 'gerente'
        and u.empresa_id in (select e.empresa_id from public.empreendimentos_auria e where e.nome=nome_emp)));
$$;


-- ── Alcance do vazamento: quem estava recebendo indevidamente ─────────────
--  Lista as contas super_admin e a qual grupo elas estão amarradas. Toda
--  notificação de empreendimento desse grupo ia para elas.
select u.email,
       u.role,
       coalesce(emp.nome,'(sem grupo)')                       as grupo_vinculado,
       (select count(*) from public.empreendimentos_auria e
         where e.empresa_id = u.empresa_id and e.deleted_at is null) as empreendimentos_alcancados
  from public.usuarios_auria u
  left join public.empresas_auria emp on emp.id = u.empresa_id
 where u.role = 'super_admin'
 order by u.email;
