-- ============================================================================
--  Itens 113/116 — editar contrato salvo, com LOG das modificações (2026-09-23)
--  Rodar no SQL Editor do Supabase.
--
--  contrato_eventos_auria guarda o que mudou em cada edição (campo, de, para),
--  no mesmo espírito de parcela_eventos_auria. Quem pode ver/editar o contrato
--  pode ver/gravar o log — a política reusa a do próprio contrato.
-- ============================================================================

create table if not exists public.contrato_eventos_auria (
  id           uuid primary key default gen_random_uuid(),
  contrato_id  uuid not null references public.contratos_auria(id) on delete cascade,
  evento       text not null,            -- criou | editou | parcela | pdf | encerrou
  campo        text,                     -- valor_total, disciplina, parcela 2 · valor…
  de           text,
  para         text,
  por_email    text,
  por_nome     text,
  por_role     text,
  observacao   text,
  quando       timestamptz default now()
);
create index if not exists idx_evt_ctr on public.contrato_eventos_auria(contrato_id, quando desc);

alter table public.contrato_eventos_auria enable row level security;

-- Mesma regra do contrato: quem enxerga o contrato enxerga o histórico dele.
drop policy if exists ctrevt_acesso on public.contrato_eventos_auria;
create policy ctrevt_acesso on public.contrato_eventos_auria for all
  using (exists (
    select 1 from public.contratos_auria c
     where c.id = contrato_id and (
       c.criado_por = auth.uid()
       or lower(coalesce(c.projetista_email,'')) = lower(auth.jwt() ->> 'email')
       or exists (select 1 from public.empreendimentos_auria e
                   where e.id = c.empreendimento_id and e.empresa_id = public.minha_empresa())
       or exists (select 1 from public.analista_empreendimento_auria ae
                   where ae.analista_id = auth.uid() and ae.empreendimento_id = c.empreendimento_id and ae.ativo = true))))
  with check (exists (
    select 1 from public.contratos_auria c
     where c.id = contrato_id and (
       c.criado_por = auth.uid()
       or exists (select 1 from public.empreendimentos_auria e
                   where e.id = c.empreendimento_id and e.empresa_id = public.minha_empresa())
       or exists (select 1 from public.analista_empreendimento_auria ae
                   where ae.analista_id = auth.uid() and ae.empreendimento_id = c.empreendimento_id and ae.ativo = true))));
grant select, insert on public.contrato_eventos_auria to authenticated;
revoke all on public.contrato_eventos_auria from anon;

-- O PDF do contrato deixa de ser obrigatório na EDIÇÃO (o de origem continua valendo).
-- Nada a alterar no schema: pdf_data já aceita null.

select 'contrato_eventos_auria' as item,
       exists(select 1 from information_schema.tables where table_name='contrato_eventos_auria') as ok
union all select 'policy ctrevt_acesso',
       exists(select 1 from pg_policies where tablename='contrato_eventos_auria' and policyname='ctrevt_acesso');
