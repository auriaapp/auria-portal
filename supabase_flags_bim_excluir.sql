-- ============================================================================
--  Item 145 (fim) — os últimos flags decorativos passam a valer (2026-09-26)
--  Rodar no SQL Editor. Reaplicável.
--
--  Restavam três caixas na matriz que gravavam, exibiam, e o banco ignorava:
--  BIM (ver), BIM ler (apontamento no 3D) e Excl. (remover o próprio envio).
--
--  PRINCÍPIO QUE GUIOU O DESENHO — ninguém acorda sem acesso:
--   · o PASSO 1 pré-marca bim_ver/bim_ler_apont em quem hoje usa e não tem o
--     flag (o levantamento apontou 2 linhas). Só depois a regra passa a exigir.
--   · as regras novas só opinam sobre quem TEM linha na matriz. Quem lê por
--     outro caminho (a disciplina contratada do projetista, por exemplo) segue
--     decidido pela policy que já o deixava ler. Enforcement que derruba acesso
--     legítimo não é segurança, é chamado de suporte.
--   · o Excl. ADICIONA capacidade: hoje o projetista não apaga nem o próprio
--     envio recém-subido, e precisa pedir para a coordenação.
-- ============================================================================


-- ── PASSO 1 — pré-marcar quem já usa, antes de exigir ─────────────────────
update public.cde_acesso_auria
   set bim_ver       = true,
       bim_ler_apont = true,
       atualizado_em = now()
 where not coalesce(bim_ver, false)
    or not coalesce(bim_ler_apont, false);


-- ── PASSO 2 — "BIM": ver o modelo ─────────────────────────────────────────
--  Vale só para arquivo de modelo (ifc/frag). Prancha em PDF não é afetada.
create or replace function public.cde_bim_ve(p_arq uuid)
returns boolean
language plpgsql security definer stable set search_path = public
as $$
declare v_emp uuid; v_ext text; v_tem_linha boolean;
begin
  select lower(coalesce(a.extensao,'')), d.empreendimento_id
    into v_ext, v_emp
    from public.cde_arquivo_auria  a
    join public.cde_revisao_auria  r on r.id = a.revisao_id
    join public.cde_documento_auria d on d.id = r.documento_id
   where a.id = p_arq;

  if v_emp is null then return true; end if;                    -- não é assunto desta regra
  if v_ext not in ('ifc','frag') then return true; end if;      -- só vigia modelo BIM
  if public.estacao_pode(v_emp) then return true; end if;       -- equipe sempre vê

  select exists (
    select 1 from public.cde_acesso_auria a
     where a.empreendimento_id = v_emp
       and ( a.usuario_id = auth.uid()
             or (a.fornecedor_id is not null and a.fornecedor_id = public.forn_do_projetista()) )
  ) into v_tem_linha;
  -- Sem linha na matriz, quem decide é a policy que já o deixava ler.
  if not v_tem_linha then return true; end if;

  return exists (
    select 1 from public.cde_acesso_auria a
     where a.empreendimento_id = v_emp
       and ( a.usuario_id = auth.uid()
             or (a.fornecedor_id is not null and a.fornecedor_id = public.forn_do_projetista()) )
       and coalesce(a.bim_ver, false));
end $$;
grant execute on function public.cde_bim_ve(uuid) to authenticated;

-- RESTRICTIVE: soma-se com E às permissivas, em vez de abrir mais um caminho.
drop policy if exists cde_arq_bim_restr on public.cde_arquivo_auria;
create policy cde_arq_bim_restr on public.cde_arquivo_auria
  as restrictive for select
  using ( public.cde_bim_ve(id) );


-- ── PASSO 3 — "BIM ler": apontamento no 3D ────────────────────────────────
--  apt_pode_ler ganha a dimensão. Apontamento 2D não muda nada.
create or replace function public.apt_pode_ler(p_emp uuid, p_disc text, p_visib text, p_dim text)
returns boolean
language plpgsql security definer stable set search_path to 'public'
as $$
declare v_tem_linha boolean;
begin
  if p_emp is null then return false; end if;
  if public.estacao_pode(p_emp) then return true; end if;

  -- Apontamento do modelo: exige o flag de quem tem linha na matriz.
  if lower(coalesce(p_dim,'2d')) = 'bim' then
    select exists (select 1 from public.cde_acesso_auria a
                    where a.empreendimento_id = p_emp
                      and ( a.usuario_id = auth.uid()
                            or (a.fornecedor_id is not null and a.fornecedor_id = public.forn_do_projetista()) ))
      into v_tem_linha;
    if v_tem_linha and not exists (
         select 1 from public.cde_acesso_auria a
          where a.empreendimento_id = p_emp
            and ( a.usuario_id = auth.uid()
                  or (a.fornecedor_id is not null and a.fornecedor_id = public.forn_do_projetista()) )
            and coalesce(a.bim_ler_apont, false)) then
      return false;
    end if;
  end if;

  -- Daqui para baixo, a regra das três faixas do item 146, inalterada.
  if p_visib = 'Coordenação' then return false; end if;
  if p_visib = 'Projeto' and not exists (
       select 1 from public.cde_acesso_auria a
        where a.empreendimento_id = p_emp
          and ( a.usuario_id = auth.uid()
                or (a.fornecedor_id is not null and a.fornecedor_id = public.forn_do_projetista()) )
          and coalesce(a.ler_apont, false)) then
    return false;
  end if;
  if coalesce(p_disc,'') = '' then return public.apt_tem_acesso_emp(p_emp); end if;
  return public.cde_acc_ve_disc(p_emp, p_disc, 'A1');
end $$;
grant execute on function public.apt_pode_ler(uuid, text, text, text) to authenticated;

drop policy if exists "apt_acesso_publico_sel" on public.apontamentos;
create policy "apt_acesso_publico_sel" on public.apontamentos for select
  using ( public.apt_pode_ler(empreendimento_id, disciplina, visibilidade, dimensao) );


-- ── PASSO 4 — "Excl.": remover o próprio envio antes de virar revisão ─────
--  ISO 19650: enquanto está em RECEBIDO/S0 o contêiner ainda é do task team.
--  Depois que a coordenação move, não é mais dele — e a regra reflete isso.
create or replace function public.cde_pode_excluir_s0(p_rev uuid)
returns boolean
language plpgsql security definer stable set search_path = public
as $$
declare v_emp uuid; v_estado text; v_status text; v_de uuid; v_eu uuid;
begin
  select d.empreendimento_id, r.estado, r.status, r.recebido_de
    into v_emp, v_estado, v_status, v_de
    from public.cde_revisao_auria  r
    join public.cde_documento_auria d on d.id = r.documento_id
   where r.id = p_rev;
  if v_emp is null then return false; end if;
  if v_estado <> 'RECEBIDO' or v_status <> 'S0' then return false; end if;

  select p.id into v_eu from public.projetistas_auria p
   where lower(p.email) = lower(coalesce(auth.jwt()->>'email',''))
     and coalesce(p.ativo, true) limit 1;
  if v_eu is null or v_de is null or v_de <> v_eu then return false; end if;   -- só o PRÓPRIO envio

  return exists (
    select 1 from public.cde_acesso_auria a
      join public.projetistas_auria pr on pr.fornecedor_id = a.fornecedor_id
     where a.empreendimento_id = v_emp
       and pr.id = v_eu
       and coalesce(a.excluir_s0, false));
end $$;
grant execute on function public.cde_pode_excluir_s0(uuid) to authenticated;

-- Apaga a REVISÃO; os arquivos vão junto por cascade. O objeto no Storage fica
-- órfão de propósito: apagar bytes é irreversível, e ninguém enxerga o órfão.
drop policy if exists cde_rev_proj_del on public.cde_revisao_auria;
create policy cde_rev_proj_del on public.cde_revisao_auria for delete
  using ( public.cde_pode_excluir_s0(id) );


-- ── Conferência ────────────────────────────────────────────────────────────
select 'linhas da matriz SEM bim_ver (esperado 0)' as item,
       (select count(*)::text from public.cde_acesso_auria where not coalesce(bim_ver,false)) as valor
union all select 'linhas SEM bim_ler_apont (esperado 0)',
       (select count(*)::text from public.cde_acesso_auria where not coalesce(bim_ler_apont,false))
union all select 'policy restritiva do BIM ativa',
       (exists (select 1 from pg_policy pol join pg_class c on c.oid=pol.polrelid
                 where c.relname='cde_arquivo_auria' and pol.polname='cde_arq_bim_restr'))::text
union all select 'leitura de apontamento olha a dimensao',
       (exists (select 1 from pg_policy pol join pg_class c on c.oid=pol.polrelid
                 where c.relname='apontamentos' and pol.polname='apt_acesso_publico_sel'
                   and pg_get_expr(pol.polqual,pol.polrelid) like '%dimensao%'))::text
union all select 'projetista pode excluir o proprio S0',
       (exists (select 1 from pg_policy pol join pg_class c on c.oid=pol.polrelid
                 where c.relname='cde_revisao_auria' and pol.polname='cde_rev_proj_del'))::text
union all select 'quem tem excluir_s0 marcado',
       (select count(*)::text from public.cde_acesso_auria where coalesce(excluir_s0,false));
