-- ============================================================================
--  Item 117 — upload por DISCIPLINA para o fornecedor (2026-09-24)
--  Rodar no SQL Editor do Supabase.
--
--  Como era: o fornecedor só ENVIA na(s) disciplina(s) que atende
--  (disciplina_fornecedor_auria) e BAIXA nas que a matriz liberar. Faltava o
--  meio-termo pedido: liberar ENVIO numa disciplina a mais sem transferir para
--  ele a responsabilidade por ela (a atribuição é única por disciplina).
--
--  Agora a matriz guarda, além das disciplinas que o fornecedor VÊ, as que ele
--  pode ENVIAR (disciplinas_upload). Quem atende a disciplina continua podendo
--  enviar nela sem precisar de marcação nenhuma.
-- ============================================================================

alter table public.cde_acesso_auria
  add column if not exists disciplinas_upload text[] not null default '{}';

comment on column public.cde_acesso_auria.disciplinas_upload is
  'Disciplinas em que ESTE fornecedor pode enviar arquivos, além da(s) que ele atende (item 117)';

-- Pode ENVIAR nesta disciplina? (atende a disciplina OU tem envio liberado na matriz)
create or replace function public.cde_upload_pode(p_emp uuid, p_disc text)
returns boolean
language plpgsql security definer stable set search_path to 'public'
as $$
declare
  em  text := lower(coalesce(auth.jwt()->>'email',''));
  rot text;
begin
  if em = '' or p_emp is null or coalesce(p_disc,'') = '' then return false; end if;
  -- 1) disciplina que o fornecedor atende (regra de sempre)
  if public.cde_projetista_pode(p_emp, p_disc) then return true; end if;
  -- 2) envio liberado na matriz para esta disciplina
  rot := lower(coalesce(public.cde_disc_rotulo(p_emp, p_disc), ''));
  return exists (
    select 1
      from public.cde_acesso_auria a
      join public.projetistas_auria pr on pr.fornecedor_id = a.fornecedor_id
     where a.empreendimento_id = p_emp
       and lower(pr.email) = em and coalesce(pr.ativo, true)
       and a.upload
       and ( upper(p_disc) = any(select upper(x) from unnest(a.disciplinas_upload) x)
             or (rot <> '' and rot = any(select lower(x) from unnest(a.disciplinas_upload) x)) )
  );
end $$;
grant execute on function public.cde_upload_pode(uuid, text) to authenticated;

-- ── Gravação no Storage/R2: passa a olhar a DISCIPLINA, não só o empreendimento ──
--  O caminho é <empreendimento>/<código>/<rev>/<arquivo> e o código carrega a
--  sigla da disciplina na posição definida pela convenção; quando não dá para
--  deduzir, mantém a regra antiga (empreendimento) para não travar envio legítimo.
create or replace function public.cde_path_projetista_grava(p_name text)
returns boolean
language plpgsql security definer stable
set search_path to 'public','storage'
as $$
declare
  seg text; emp uuid; cod text; disc text;
begin
  seg := (storage.foldername(p_name))[1];
  if seg is null then return false; end if;
  begin emp := seg::uuid; exception when others then return false; end;
  if not public.cde_projetista_pode_emp(emp) then return false; end if;

  -- documento já registrado com este caminho: usa a disciplina dele
  select d.disciplina into disc
    from public.cde_arquivo_auria a
    join public.cde_revisao_auria r on r.id = a.revisao_id
    join public.cde_documento_auria d on d.id = r.documento_id
   where a.storage_path = p_name
   limit 1;

  -- senão, tenta pelo CÓDIGO no caminho (2º segmento) contra as disciplinas do empreendimento
  if disc is null then
    cod := upper(coalesce((storage.foldername(p_name))[2], ''));
    select x.disciplina into disc
      from (select distinct d.disciplina from public.cde_documento_auria d
             where d.empreendimento_id = emp and coalesce(d.disciplina,'') <> '') x
     where cod like '%' || upper(x.disciplina) || '%'
     limit 1;
  end if;

  if disc is null then return true; end if;       -- não deu para saber: regra antiga
  return public.cde_upload_pode(emp, disc);
end $$;
grant execute on function public.cde_path_projetista_grava(text) to authenticated;

-- O que o projetista logado pode ENVIAR (a tela dele lista isto).
-- Acrescenta as disciplinas liberadas só para envio, marcando a origem.
create or replace function public.cde_minhas_disciplinas_upload(p_emp uuid)
returns table(disciplina text, origem text)
language sql security definer stable set search_path to 'public'
as $$
  select df.disciplina, 'atende'::text
    from public.projetistas_auria pr
    join public.disciplina_fornecedor_auria df on df.fornecedor_id = pr.fornecedor_id
   where lower(pr.email) = lower(coalesce(auth.jwt()->>'email',''))
     and coalesce(pr.ativo,true) and df.empreendimento_id = p_emp
  union
  select x, 'liberada'::text
    from public.cde_acesso_auria a
    join public.projetistas_auria pr on pr.fornecedor_id = a.fornecedor_id,
         unnest(a.disciplinas_upload) x
   where a.empreendimento_id = p_emp and a.upload
     and lower(pr.email) = lower(coalesce(auth.jwt()->>'email',''))
     and coalesce(pr.ativo,true);
$$;
grant execute on function public.cde_minhas_disciplinas_upload(uuid) to authenticated;

-- ── A matriz da tela precisa devolver a lista de envio ─────────────────────
--  (mesma função de antes, com disciplinas_upload no fim — a tela usa para
--   pintar o ⬆ em cada chip.)
drop function if exists public.cde_acessos_do_emp(uuid);
create or replace function public.cde_acessos_do_emp(p_emp uuid)
returns table(
  acesso_id            uuid,
  tipo                 text,
  sujeito_id           uuid,
  nome                 text,
  email                text,
  bloqueado            boolean,
  disc_contratadas     text[],
  disciplinas          text[],
  todas_disciplinas    boolean,
  ver_nao_publicado    boolean,
  download             boolean,
  upload               boolean,
  excluir_s0           boolean,
  ler_apont            boolean,
  abrir_apont          boolean,
  editar_apont_proprio boolean,
  bim_ver              boolean,
  bim_ler_apont        boolean,
  bim_abrir_apont      boolean,
  disciplinas_upload   text[]
)
language sql security definer stable
set search_path to 'public'
as $$
  select null::uuid, 'coordenacao', u.id, u.nome, u.email,
         true,
         null::text[], '{}'::text[], true,
         true, true, true, true, true, true, true, true, true, true, '{}'::text[]
    from public.analista_empreendimento_auria ae
    join public.usuarios_auria u on u.id = ae.analista_id
   where ae.empreendimento_id = p_emp and coalesce(ae.ativo, true)
     and public.estacao_pode(p_emp)
  union all
  select a.id, 'interno', u.id, u.nome, u.email,
         false,
         null::text[],
         a.disciplinas, a.todas_disciplinas, a.ver_nao_publicado, a.download, a.upload,
         a.excluir_s0, a.ler_apont, a.abrir_apont, a.editar_apont_proprio,
         a.bim_ver, a.bim_ler_apont, a.bim_abrir_apont, coalesce(a.disciplinas_upload,'{}'::text[])
    from public.cde_acesso_auria a
    join public.usuarios_auria u on u.id = a.usuario_id
   where a.empreendimento_id = p_emp and public.estacao_pode(p_emp)
  union all
  select a.id, 'fornecedor', f.id, f.nome, f.email_contato,
         false,
         coalesce((select array_agg(distinct df2.disciplina)
                     from public.disciplina_fornecedor_auria df2
                    where df2.empreendimento_id = p_emp and df2.fornecedor_id = f.id), '{}'::text[]),
         coalesce(a.disciplinas, '{}'::text[]), coalesce(a.todas_disciplinas, false),
         coalesce(a.ver_nao_publicado, false), coalesce(a.download, true), coalesce(a.upload, false),
         coalesce(a.excluir_s0, false), coalesce(a.ler_apont, false), coalesce(a.abrir_apont, false),
         coalesce(a.editar_apont_proprio, false),
         coalesce(a.bim_ver, false), coalesce(a.bim_ler_apont, false), coalesce(a.bim_abrir_apont, false),
         coalesce(a.disciplinas_upload, '{}'::text[])
    from (select distinct empreendimento_id, fornecedor_id
            from public.disciplina_fornecedor_auria where empreendimento_id = p_emp) df
    join public.fornecedores_auria f on f.id = df.fornecedor_id
    left join public.cde_acesso_auria a
           on a.empreendimento_id = p_emp and a.fornecedor_id = f.id
   where public.estacao_pode(p_emp)
  order by 6 desc, 2, 4;
$$;
grant execute on function public.cde_acessos_do_emp(uuid) to authenticated;

select 'disciplinas_upload' as item,
       exists(select 1 from information_schema.columns where table_name='cde_acesso_auria' and column_name='disciplinas_upload') as ok
union all select 'cde_upload_pode', exists(select 1 from pg_proc where proname='cde_upload_pode')
union all select 'cde_path_projetista_grava (disciplina)', exists(select 1 from pg_proc where proname='cde_path_projetista_grava')
union all select 'cde_minhas_disciplinas_upload', exists(select 1 from pg_proc where proname='cde_minhas_disciplinas_upload');
