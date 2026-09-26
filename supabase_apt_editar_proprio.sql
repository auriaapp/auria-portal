-- ============================================================================
--  Item 145 (parte) — "Edit." passa a valer: o autor externo corrige o próprio
--  apontamento.  (2026-09-25)  Rodar no SQL Editor. Reaplicável.
--
--  SITUAÇÃO HOJE: apt_equipe_upd só libera UPDATE para quem é user_id (o
--  analista responsável) ou para a equipe. O apontamento aberto por projetista
--  ou obra nasce com user_id NULO — então o autor não consegue corrigir nem um
--  erro de digitação no que ele mesmo escreveu. O flag "Edit." da matriz nunca
--  fez nada. Ligar isto ADICIONA capacidade: ninguém perde acesso.
--
--  O CUIDADO: RLS decide quais LINHAS, não quais COLUNAS. Sem uma trava, o
--  autor poderia mudar status, prazo, visibilidade ou responsável do próprio
--  apontamento — que é justamente o que a coordenação controla. Por isso vai
--  junto um gatilho que limita o que ele pode alterar.
--
--  Depois disto, ainda faltam do item 145: bim_ver, bim_ler_apont (ligar é
--  RESTRITIVO — pede levantamento antes, como fizemos no 146) e excluir_s0.
-- ============================================================================

-- ── 1) Pode editar o que abriu, neste empreendimento? ─────────────────────
create or replace function public.apt_pode_editar_proprio(p_emp uuid)
returns boolean language sql security definer stable
set search_path to 'public' as $$
  select exists (
           select 1 from public.cde_acesso_auria a
            where a.empreendimento_id = p_emp
              and ( a.usuario_id = auth.uid()
                    or (a.fornecedor_id is not null
                        and a.fornecedor_id = public.forn_do_projetista()) )
              and coalesce(a.editar_apont_proprio, false));
$$;
grant execute on function public.apt_pode_editar_proprio(uuid) to authenticated;

drop policy if exists "apt_autor_upd" on public.apontamentos;
create policy "apt_autor_upd" on public.apontamentos for update
  using      ( criado_por_id = auth.uid()
               and public.apt_pode_editar_proprio(empreendimento_id) )
  with check ( criado_por_id = auth.uid()
               and public.apt_pode_editar_proprio(empreendimento_id) );


-- ── 2) A trava de COLUNAS ─────────────────────────────────────────────────
--  O autor externo corrige o que é dele (texto, marcações, imagens). Status,
--  prazo, visibilidade, responsável e identidade continuam sendo da equipe.
create or replace function public.apt_guard_autor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Serviço/desktop (sem JWT) e a equipe passam direto: esta trava é só para
  -- o autor EXTERNO editando o próprio apontamento.
  if auth.uid() is null then return new; end if;
  if public.estacao_pode(new.empreendimento_id) then return new; end if;
  if old.criado_por_id is distinct from auth.uid() then return new; end if;

  if new.empreendimento_id is distinct from old.empreendimento_id
     or new.id            is distinct from old.id
     or new.user_id       is distinct from old.user_id
     or new.visibilidade  is distinct from old.visibilidade
     or new.status        is distinct from old.status
     or new.prazo_min     is distinct from old.prazo_min
     or new.criado_por_id is distinct from old.criado_por_id then
    raise exception 'Você pode corrigir o texto e as marcações do seu apontamento — status, prazo, visibilidade e responsável são da coordenação.';
  end if;
  return new;
end $$;

drop trigger if exists trg_apt_guard_autor on public.apontamentos;
create trigger trg_apt_guard_autor
  before update on public.apontamentos
  for each row execute function public.apt_guard_autor();


-- ── Conferência + levantamento do que vem depois ──────────────────────────
select 'policy apt_autor_upd criada' as item,
       (exists (select 1 from pg_policy pol join pg_class c on c.oid=pol.polrelid
                 where c.relname='apontamentos' and pol.polname='apt_autor_upd'))::text as valor
union all
select 'trava de colunas ativa',
       (exists (select 1 from pg_trigger where tgname='trg_apt_guard_autor'
                  and not tgisinternal))::text
union all
select 'quem ganha o direito de editar (linhas com o flag)',
       (select count(*)::text from public.cde_acesso_auria where coalesce(editar_apont_proprio,false))
union all
-- Prévia do PRÓXIMO passo: ligar bim_ver é restritivo. Quantos perderiam?
select 'ALERTA bim_ver: linhas da matriz SEM o flag (perderiam o 3D)',
       (select count(*)::text from public.cde_acesso_auria where not coalesce(bim_ver,false))
union all
select 'ALERTA bim_ler_apont: linhas SEM o flag',
       (select count(*)::text from public.cde_acesso_auria where not coalesce(bim_ler_apont,false));
