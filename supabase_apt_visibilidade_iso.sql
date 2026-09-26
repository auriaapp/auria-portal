-- ============================================================================
--  Item 146 — visibilidade dos apontamentos pela ISO 19650 (2026-09-25)
--  Rodar no SQL Editor do Supabase. Reaplicável.
--
--  REGRA, agora valendo no BANCO e não só na tela:
--    Coordenação (WIP)          → só a equipe, sempre.
--    Projeto     (Compartilhado)→ equipe + quem tiver o flag "ler_apont".
--    Público     (Publicado)    → todos com acesso ao empreendimento, MAS
--                                 escopado pelas disciplinas que cada um
--                                 enxerga na matriz.
--
--  O QUE ESTAVA ERRADO:
--   1. apt_tem_acesso_emp() só olhava a.usuario_id — a linha de FORNECEDOR era
--      ignorada. Projetista não lia NEM o que era público.
--   2. O flag ler_apont nunca foi consultado: setor e obra liam a faixa
--      "Projeto" como se fosse "Público".
--   3. Não havia recorte por disciplina: o texto do apontamento revelava
--      conteúdo de disciplina que a matriz bloqueia no CDE.
--   4. apt_pode_abrir usava (abrir_apont OR bim_abrir_apont) — quem recebia só
--      "BIM abrir" também abria apontamento 2D.
--
--  LEVANTAMENTO DE IMPACTO (rodado antes, supabase_levantamento_visibilidade):
--   10 apontamentos, todos no "Empreendimento Teste — Demo". Perde acesso
--   apenas 'Funcionário teste [setor]' (1 de Projeto + 4 por disciplina).
--   Nenhum usuário de obra é afetado. Zero apontamentos sem disciplina.
-- ============================================================================


-- ── 1) Acesso ao empreendimento passa a enxergar o FORNECEDOR ─────────────
create or replace function public.apt_tem_acesso_emp(p_emp uuid)
returns boolean language sql security definer stable
set search_path to 'public' as $$
  select public.estacao_pode(p_emp)
      or exists (
           select 1 from public.cde_acesso_auria a
            where a.empreendimento_id = p_emp
              and ( a.usuario_id = auth.uid()
                    -- a permissão do fornecedor vale para todos os projetistas dele
                    or (a.fornecedor_id is not null
                        and a.fornecedor_id = public.forn_do_projetista()) ));
$$;
grant execute on function public.apt_tem_acesso_emp(uuid) to authenticated;


-- ── 2) A regra das três faixas ────────────────────────────────────────────
create or replace function public.apt_pode_ler(p_emp uuid, p_disc text, p_visib text)
returns boolean
language plpgsql security definer stable set search_path to 'public'
as $$
begin
  if p_emp is null then return false; end if;

  -- A equipe (analistas designados e gestão) enxerga tudo, inclusive o WIP.
  if public.estacao_pode(p_emp) then return true; end if;

  -- Coordenação é WIP: nunca sai da equipe.
  if p_visib = 'Coordenação' then return false; end if;

  -- Faixa Compartilhado: precisa do flag na matriz (linha própria ou a do
  -- fornecedor). É aqui que "Ler ap." passa a significar alguma coisa.
  if p_visib = 'Projeto' and not exists (
       select 1 from public.cde_acesso_auria a
        where a.empreendimento_id = p_emp
          and ( a.usuario_id = auth.uid()
                or (a.fornecedor_id is not null
                    and a.fornecedor_id = public.forn_do_projetista()) )
          and coalesce(a.ler_apont, false)
     ) then
    return false;
  end if;

  -- Recorte por DISCIPLINA. Reaproveita a função que já decide o CDE para não
  -- criar uma segunda regra de comparação: existem 5 grafias de disciplina nos
  -- apontamentos, e cde_acc_ve_disc já casa CÓDIGO e RÓTULO.
  -- O status 'A1' vai de propósito: apontamento não tem revisão, e o que
  -- queremos daqui é só o recorte por disciplina — a faixa já foi decidida
  -- acima. Passar um status publicado neutraliza o termo de publicação.
  if coalesce(p_disc,'') = '' then
    return public.apt_tem_acesso_emp(p_emp);   -- sem disciplina não há o que recortar
  end if;
  return public.cde_acc_ve_disc(p_emp, p_disc, 'A1');
end $$;
grant execute on function public.apt_pode_ler(uuid, text, text) to authenticated;

drop policy if exists "apt_acesso_publico_sel" on public.apontamentos;
create policy "apt_acesso_publico_sel" on public.apontamentos for select
  using ( public.apt_pode_ler(empreendimento_id, disciplina, visibilidade) );


-- ── 3) Abrir apontamento: 2D e BIM deixam de ser o mesmo direito ──────────
create or replace function public.apt_pode_abrir(p_emp uuid, p_dim text)
returns boolean language sql security definer stable
set search_path to 'public' as $$
  select exists (
           select 1 from public.cde_acesso_auria a
            where a.empreendimento_id = p_emp
              and ( a.usuario_id = auth.uid()
                    or (a.fornecedor_id is not null
                        and a.fornecedor_id = public.forn_do_projetista()) )
              and (case when lower(coalesce(p_dim,'2d')) = 'bim'
                        then coalesce(a.bim_abrir_apont,false)
                        else coalesce(a.abrir_apont,false) end));
$$;
grant execute on function public.apt_pode_abrir(uuid, text) to authenticated;

-- A versão de 1 argumento fica (cde_garantir_prancha a usa só para saber se
-- vale criar o registro da prancha) e mantém o OU — ali a distinção não importa.
create or replace function public.apt_pode_abrir(p_emp uuid)
returns boolean language sql security definer stable
set search_path to 'public' as $$
  select public.apt_pode_abrir(p_emp,'2d') or public.apt_pode_abrir(p_emp,'bim');
$$;
grant execute on function public.apt_pode_abrir(uuid) to authenticated;

drop policy if exists "apt_externo_ins" on public.apontamentos;
create policy "apt_externo_ins" on public.apontamentos for insert
  with check (
    criado_por_id = auth.uid()
    and public.apt_pode_abrir(empreendimento_id, dimensao)
  );


-- ── Conferência: o antes e o depois, em número ────────────────────────────
select 'apt_pode_ler criada' as item,
       (to_regprocedure('public.apt_pode_ler(uuid,text,text)') is not null)::text as valor
union all select 'apt_pode_abrir(emp,dim) criada',
       (to_regprocedure('public.apt_pode_abrir(uuid,text)') is not null)::text
union all select 'policy de leitura usa apt_pode_ler',
       (exists (select 1 from pg_policy pol join pg_class c on c.oid=pol.polrelid
                 where c.relname='apontamentos' and pol.polname='apt_acesso_publico_sel'
                   and pg_get_expr(pol.polqual,pol.polrelid) like '%apt_pode_ler%'))::text
union all select 'policy de insercao separa 2D de BIM',
       (exists (select 1 from pg_policy pol join pg_class c on c.oid=pol.polrelid
                 where c.relname='apontamentos' and pol.polname='apt_externo_ins'
                   and pg_get_expr(pol.polwithcheck,pol.polrelid) like '%dimensao%'))::text
union all select 'apt_tem_acesso_emp enxerga fornecedor',
       (exists (select 1 from pg_proc where proname='apt_tem_acesso_emp'
                 and prosrc like '%forn_do_projetista%'))::text;
