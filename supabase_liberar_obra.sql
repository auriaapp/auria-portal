-- ============================================================================
--  Item 147 — o PROJETISTA libera arquivo para a obra (2026-09-26)
--  Rodar no SQL Editor do Supabase. Reaplicável.
--
--  CASO DE USO: o ATP de estrutura precisa mandar as pranchas de armação para
--  a obra sem esperar a coordenação revisar folha de ferro por folha de ferro.
--
--  ISO 19650: levar um contêiner ao estado Autorizado é ato da gestão da
--  informação do contratante. A norma não proíbe DELEGAR — exige que a
--  delegação tenha escopo explícito e que o ato fique registrado. É o que
--  este arquivo faz. E a revisão vai para o MESMO status A1 de sempre: nada de
--  criar um segundo conceito de "liberado", que é como nascem duas verdades
--  sobre o mesmo fato.
--
--  DOIS MODOS, escolhidos pela coordenação POR FORNECEDOR:
--    'nao'       (padrão) — nada muda; o projetista não libera.
--    'confirmar' — o projetista SINALIZA que está pronto para a obra; a revisão
--                  fica pendente e a coordenação confirma com um clique.
--                  Ganho sobre hoje: a coordenação não precisa mais ADIVINHAR
--                  que chegou algo pronto — ela recebe o pedido.
--    'direto'    — liberação imediata (delegação de fato). A coordenação é
--                  avisada e o card mostra que quem liberou foi o fornecedor.
--
--  Em qualquer modo, só vale para disciplina que o fornecedor ENTREGA
--  (cde_upload_pode) — ninguém libera o que não produz.
-- ============================================================================

-- ── 1) O modo, por fornecedor ─────────────────────────────────────────────
alter table public.cde_acesso_auria
  add column if not exists liberar_obra text not null default 'nao';

do $$ begin
  alter table public.cde_acesso_auria
    add constraint cde_acesso_liberar_obra_chk check (liberar_obra in ('nao','confirmar','direto'));
exception when duplicate_object then null; end $$;

comment on column public.cde_acesso_auria.liberar_obra is
  'Delegação de liberação para obra (item 147): nao | confirmar | direto';

-- ── 2) O pedido pendente, na revisão ──────────────────────────────────────
alter table public.cde_revisao_auria
  add column if not exists lib_pedida_em   timestamptz,
  add column if not exists lib_pedida_por  uuid,
  add column if not exists lib_pedida_nome text;

create index if not exists idx_cde_rev_lib_pendente
  on public.cde_revisao_auria(lib_pedida_em) where lib_pedida_em is not null;


-- ── 3) O projetista pede (ou libera, no modo direto) ──────────────────────
create or replace function public.cde_obra_liberar(p_rev uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_emp uuid; v_disc text; v_status text; v_cod text;
  v_modo text; v_estado text; v_nome text;
begin
  select d.empreendimento_id, d.disciplina, r.status, d.codigo
    into v_emp, v_disc, v_status, v_cod
    from public.cde_revisao_auria r
    join public.cde_documento_auria d on d.id = r.documento_id
   where r.id = p_rev;
  if v_emp is null then raise exception 'Revisão não encontrada.'; end if;

  -- Só libera o que ele mesmo entrega.
  if not public.cde_upload_pode(v_emp, v_disc) then
    raise exception 'Você não entrega a disciplina desta prancha.';
  end if;

  select max(a.liberar_obra) into v_modo
    from public.cde_acesso_auria a
    join public.projetistas_auria pr on pr.fornecedor_id = a.fornecedor_id
   where a.empreendimento_id = v_emp
     and lower(pr.email) = lower(coalesce(auth.jwt()->>'email',''))
     and coalesce(pr.ativo,true);
  v_modo := coalesce(v_modo,'nao');
  if v_modo = 'nao' then
    raise exception 'A coordenação não liberou este fornecedor para enviar pranchas direto à obra.';
  end if;

  if v_status in ('A1','B1','AS_BUILT') then
    return jsonb_build_object('ok', false, 'motivo', 'Esta revisão já está liberada.');
  end if;

  v_nome := coalesce(
    (select p.nome from public.projetistas_auria p
      where lower(p.email) = lower(coalesce(auth.jwt()->>'email','')) limit 1),
    auth.jwt()->>'email');

  if v_modo = 'direto' then
    select estado into v_estado from public.cde_status_auria where codigo = 'A1';
    update public.cde_revisao_auria
       set status = 'A1', estado = coalesce(v_estado, estado),
           aprovado_por = auth.uid(), aprovado_em = now(),
           lib_pedida_em = null, lib_pedida_por = null, lib_pedida_nome = null
     where id = p_rev;
    insert into public.cde_evento_auria(revisao_id, acao, de_status, para_status,
                                        usuario_id, usuario_nome, nota)
      values (p_rev, 'status', v_status, 'A1', auth.uid(), v_nome,
              'Liberado para obra pelo projetista, por delegação da coordenação.');
    return jsonb_build_object('ok', true, 'modo', 'direto', 'codigo', v_cod);
  end if;

  -- modo 'confirmar': sinaliza e espera
  update public.cde_revisao_auria
     set lib_pedida_em = now(), lib_pedida_por = auth.uid(), lib_pedida_nome = v_nome
   where id = p_rev;
  insert into public.cde_evento_auria(revisao_id, acao, usuario_id, usuario_nome, nota)
    values (p_rev, 'pedido_obra', auth.uid(), v_nome,
            'Projetista sinalizou que a prancha está pronta para a obra.');
  return jsonb_build_object('ok', true, 'modo', 'confirmar', 'codigo', v_cod);
end $$;
grant execute on function public.cde_obra_liberar(uuid) to authenticated;


-- ── 4) A coordenação confirma (ou recusa) ─────────────────────────────────
create or replace function public.cde_obra_confirmar(p_rev uuid, p_ok boolean, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_emp uuid; v_status text; v_estado text; v_nome text;
begin
  select d.empreendimento_id, r.status into v_emp, v_status
    from public.cde_revisao_auria r
    join public.cde_documento_auria d on d.id = r.documento_id
   where r.id = p_rev;
  if v_emp is null then raise exception 'Revisão não encontrada.'; end if;
  if not public.estacao_edita(v_emp) then
    raise exception 'Só a coordenação confirma a liberação para a obra.';
  end if;

  v_nome := coalesce((select u.nome from public.usuarios_auria u where u.id = auth.uid()),
                     auth.jwt()->>'email');

  if not p_ok then
    update public.cde_revisao_auria
       set lib_pedida_em = null, lib_pedida_por = null, lib_pedida_nome = null
     where id = p_rev;
    insert into public.cde_evento_auria(revisao_id, acao, usuario_id, usuario_nome, nota)
      values (p_rev, 'pedido_obra', auth.uid(), v_nome,
              coalesce('Pedido de liberação para obra recusado: '||p_nota,
                       'Pedido de liberação para obra recusado.'));
    return jsonb_build_object('ok', true, 'liberado', false);
  end if;

  select estado into v_estado from public.cde_status_auria where codigo = 'A1';
  update public.cde_revisao_auria
     set status = 'A1', estado = coalesce(v_estado, estado),
         aprovado_por = auth.uid(), aprovado_em = now(),
         lib_pedida_em = null, lib_pedida_por = null, lib_pedida_nome = null
   where id = p_rev;
  insert into public.cde_evento_auria(revisao_id, acao, de_status, para_status,
                                      usuario_id, usuario_nome, nota)
    values (p_rev, 'status', v_status, 'A1', auth.uid(), v_nome,
            coalesce(p_nota, 'Liberado para obra a pedido do projetista.'));
  return jsonb_build_object('ok', true, 'liberado', true);
end $$;
grant execute on function public.cde_obra_confirmar(uuid, boolean, text) to authenticated;


-- ── 5) A fila de pedidos, para a coordenação ──────────────────────────────
create or replace function public.cde_obra_pendentes(p_emp uuid)
returns table(revisao_id uuid, documento_id uuid, codigo text, titulo text,
              disciplina text, revisao text, status text,
              pedida_em timestamptz, pedida_por text)
language sql security definer stable set search_path = public
as $$
  select r.id, d.id, d.codigo, d.titulo, d.disciplina, r.revisao, r.status,
         r.lib_pedida_em, r.lib_pedida_nome
    from public.cde_revisao_auria r
    join public.cde_documento_auria d on d.id = r.documento_id
   where d.empreendimento_id = p_emp
     and r.lib_pedida_em is not null
     and public.estacao_pode(p_emp)
   order by r.lib_pedida_em;
$$;
grant execute on function public.cde_obra_pendentes(uuid) to authenticated;


-- ── 6) A tela do projetista precisa saber o modo dele ────────────────────
--  cde_minhas_flags já entrega as flags efetivas do chamador (linha própria ou
--  a do fornecedor dele). Ganha mais uma coluna, para o painel decidir se
--  mostra o botão — em vez de mostrar sempre e só descobrir no erro.
drop function if exists public.cde_minhas_flags(uuid);
create function public.cde_minhas_flags(p_emp uuid)
returns table (
  abrir_apont boolean, ver_nao_publicado boolean, ler_apont boolean,
  download boolean, upload boolean, editar_apont_proprio boolean,
  bim_ver boolean, bim_ler_apont boolean, bim_abrir_apont boolean,
  liberar_obra text
)
language sql security definer stable set search_path to 'public' as $$
  select coalesce(bool_or(a.abrir_apont), false),
         coalesce(bool_or(a.ver_nao_publicado), false),
         coalesce(bool_or(a.ler_apont), false),
         coalesce(bool_or(a.download), false),
         coalesce(bool_or(a.upload), false),
         coalesce(bool_or(a.editar_apont_proprio), false),
         coalesce(bool_or(a.bim_ver), false),
         coalesce(bool_or(a.bim_ler_apont), false),
         coalesce(bool_or(a.bim_abrir_apont), false),
         coalesce(max(a.liberar_obra), 'nao')
    from public.cde_acesso_auria a
   where a.empreendimento_id = p_emp
     and (   a.usuario_id = auth.uid()
          or (a.fornecedor_id is not null and a.fornecedor_id = public.forn_do_projetista()));
$$;
grant execute on function public.cde_minhas_flags(uuid) to authenticated;
revoke execute on function public.cde_minhas_flags(uuid) from anon;


-- ── Conferência ────────────────────────────────────────────────────────────
select 'coluna liberar_obra' as item,
       exists(select 1 from information_schema.columns
               where table_name='cde_acesso_auria' and column_name='liberar_obra')::text as valor
union all select 'colunas do pedido na revisao',
       exists(select 1 from information_schema.columns
               where table_name='cde_revisao_auria' and column_name='lib_pedida_em')::text
union all select 'cde_obra_liberar',   (to_regprocedure('public.cde_obra_liberar(uuid)') is not null)::text
union all select 'cde_obra_confirmar', (to_regprocedure('public.cde_obra_confirmar(uuid,boolean,text)') is not null)::text
union all select 'cde_obra_pendentes', (to_regprocedure('public.cde_obra_pendentes(uuid)') is not null)::text
union all select 'fornecedores com delegacao ligada',
       (select count(*)::text from public.cde_acesso_auria where liberar_obra <> 'nao');
