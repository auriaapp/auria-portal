-- ============================================================================
--  Item 153 — contrato com VÁRIAS disciplinas e disciplina com VÁRIOS
--  fornecedores (2026-09-26). Rodar no SQL Editor. Reaplicável.
--
--  DUAS REALIDADES que o modelo não admitia:
--   1. Um contrato cobre mais de uma disciplina. Caso real: um contrato de
--      "Fachada" de R$142.000 que na prática também cobre "Moldura Fachada" —
--      e o sistema pedia para cadastrar o mesmo contrato duas vezes.
--   2. Uma disciplina pode ter mais de um fornecedor contratado. A tabela do
--      vínculo tinha unique (empreendimento_id, disciplina), que proibia isso.
--
--  DE QUEBRA, resolve o "sem responsável": ao salvar um contrato, os vínculos
--  disciplina→fornecedor→responsável passam a ser criados sozinhos. Contrato
--  assinado é a evidência mais forte de quem atende o quê, e hoje eram duas
--  telas separadas — foi por isso que FAC e MLD ficaram órfãos com o contrato
--  já cadastrado.
-- ============================================================================


-- ── 1) O contrato passa a ter LISTA de disciplinas ───────────────────────
alter table public.contratos_auria
  add column if not exists disciplinas text[];

update public.contratos_auria
   set disciplinas = array[disciplina]
 where disciplinas is null and coalesce(disciplina,'') <> '';

comment on column public.contratos_auria.disciplinas is
  'Disciplinas cobertas pelo contrato (item 153). FONTE ÚNICA; a coluna singular disciplina é espelho mantido por gatilho.';

-- A coluna singular FICA, porque muita coisa ainda lê dela: os e-mails de
-- faturamento e de marco, as RPCs do Painel de Custos, o vínculo em Acessos.
-- Mas vira ESPELHO mantido por gatilho — nunca escrita à mão pelo cliente.
--
-- (Sim, foi uma coluna espelho que causou o item 134. A diferença importa:
--  aquela era escrita pelo NAVEGADOR e derivou até ficar errada em 9 de 10
--  linhas. Esta é escrita por gatilho, e gatilho não esquece.)
create or replace function public.ctr_disc_norm()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.disciplina  is distinct from old.disciplina
     and new.disciplinas is not distinct from old.disciplinas then
    -- escritor ANTIGO mexeu só no singular: o array acompanha
    new.disciplinas := case when coalesce(new.disciplina,'') = '' then new.disciplinas
                            else array[new.disciplina] end;
  elsif new.disciplinas is not null and array_length(new.disciplinas,1) > 0 then
    new.disciplina := new.disciplinas[1];
  elsif coalesce(new.disciplina,'') <> '' then
    new.disciplinas := array[new.disciplina];
  end if;
  return new;
end $$;

drop trigger if exists trg_ctr_disc_norm on public.contratos_auria;
create trigger trg_ctr_disc_norm
  before insert or update on public.contratos_auria
  for each row execute function public.ctr_disc_norm();


-- ── 2) Uma disciplina pode ter VÁRIOS fornecedores ───────────────────────
--  A unicidade passa a ser por (empreendimento, disciplina, FORNECEDOR): o que
--  não se quer é a MESMA dupla repetida, não é mais de um fornecedor.
do $$
declare v_dup int;
begin
  select count(*) into v_dup from (
    select empreendimento_id, disciplina, fornecedor_id
      from public.disciplina_fornecedor_auria
     group by 1,2,3 having count(*) > 1) x;
  if v_dup > 0 then
    raise exception 'Há % trio(s) (empreendimento, disciplina, fornecedor) repetido(s) — resolver antes.', v_dup;
  end if;
end $$;

alter table public.disciplina_fornecedor_auria
  drop constraint if exists disciplina_fornecedor_auria_empreendimento_id_disciplina_key;

do $$ begin
  alter table public.disciplina_fornecedor_auria
    add constraint disc_forn_emp_disc_forn_uni unique (empreendimento_id, disciplina, fornecedor_id);
exception when duplicate_object then null; end $$;


-- ── 3) Salvar contrato cria os vínculos sozinho ──────────────────────────
--  Vale para os DOIS caminhos (painel do analista e Painel de Custos), porque
--  mora na tabela e não na tela. Nunca remove vínculo: contrato encerrado não
--  apaga histórico de quem atendeu.
create or replace function public.ctr_vincula_disc()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text;
begin
  if new.fornecedor_id is null or new.empreendimento_id is null then return new; end if;
  foreach d in array coalesce(new.disciplinas, '{}'::text[]) loop
    if coalesce(d,'') = '' then continue; end if;
    insert into public.disciplina_fornecedor_auria
      (empreendimento_id, disciplina, fornecedor_id, projetista_id, criado_por)
    values (new.empreendimento_id, d, new.fornecedor_id, new.projetista_id,
            coalesce(new.criado_por, auth.uid()))
    on conflict (empreendimento_id, disciplina, fornecedor_id) do update
      -- não apaga um responsável já definido à mão; só preenche o que está vazio
      set projetista_id = coalesce(public.disciplina_fornecedor_auria.projetista_id, excluded.projetista_id);
  end loop;
  return new;
end $$;

drop trigger if exists trg_ctr_vincula_disc on public.contratos_auria;
create trigger trg_ctr_vincula_disc
  after insert or update of disciplinas, fornecedor_id, projetista_id on public.contratos_auria
  for each row execute function public.ctr_vincula_disc();


-- ── Conferência ────────────────────────────────────────────────────────────
select 'coluna disciplinas[] no contrato' as item,
       exists(select 1 from information_schema.columns
               where table_name='contratos_auria' and column_name='disciplinas')::text as valor
union all select 'contratos com disciplinas preenchidas',
       (select count(*)::text from public.contratos_auria where disciplinas is not null)
union all select 'espelho da disciplina singular (gatilho)',
       exists(select 1 from pg_trigger where tgname='trg_ctr_disc_norm' and not tgisinternal)::text
union all select 'unicidade antiga (1 fornecedor por disciplina) REMOVIDA',
       (not exists (select 1 from pg_constraint
                     where conname='disciplina_fornecedor_auria_empreendimento_id_disciplina_key'))::text
union all select 'nova unicidade (emp, disciplina, fornecedor)',
       exists(select 1 from pg_constraint where conname='disc_forn_emp_disc_forn_uni')::text
union all select 'vinculo automatico ao salvar contrato',
       exists(select 1 from pg_trigger where tgname='trg_ctr_vincula_disc' and not tgisinternal)::text;
