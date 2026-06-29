-- ============================================================
-- AURIA — Contratos & Faturas
-- Cole e execute no SQL Editor do Supabase.
-- Cobertura: contrato (PDF assinado) + aditivos, parcelas com status
-- e vencimento, NF (PDF) por parcela, vinculo opcional com marco do
-- cronograma, e log de eventos (auditoria).
-- ============================================================

-- ── Contratos ────────────────────────────────────────────────
create table if not exists public.contratos_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  projetista_email  text not null,
  projetista_nome   text,
  disciplina        text,
  numero            text,                   -- nº do contrato (livre)
  objeto            text,                   -- breve descrição
  valor_total       numeric(14,2) default 0,
  data_assinatura   date,
  data_inicio       date,
  data_fim          date,
  pdf_data          text,                   -- data URL base64 do PDF assinado
  pdf_nome          text,
  status            text default 'ativo' check (status in ('ativo','encerrado','cancelado')),
  criado_por        uuid,
  criado_em         timestamptz default now(),
  atualizado_em     timestamptz default now()
);
create index if not exists idx_contr_emp  on public.contratos_auria(empreendimento_id);
create index if not exists idx_contr_proj on public.contratos_auria(lower(projetista_email));

-- ── Aditivos do contrato ─────────────────────────────────────
create table if not exists public.contrato_aditivos_auria (
  id            uuid primary key default gen_random_uuid(),
  contrato_id   uuid not null references public.contratos_auria(id) on delete cascade,
  descricao     text,
  valor_adic    numeric(14,2) default 0,
  data          date,
  pdf_data      text,
  pdf_nome      text,
  criado_por    uuid,
  criado_em     timestamptz default now()
);
create index if not exists idx_aditivo_contr on public.contrato_aditivos_auria(contrato_id);

-- ── Parcelas ─────────────────────────────────────────────────
create table if not exists public.parcelas_auria (
  id              uuid primary key default gen_random_uuid(),
  contrato_id     uuid not null references public.contratos_auria(id) on delete cascade,
  numero          int not null,                       -- 1, 2, 3...
  descricao       text,
  valor           numeric(14,2) default 0,
  vencimento      date,
  marco_cron_id   uuid references public.cronograma_auria(id) on delete set null,
  status          text default 'a_faturar' check (status in
                  ('a_faturar','solicitada','autorizada','recusada','faturada','paga','cancelada')),
  nf_numero       text,
  nf_pdf_data     text,
  nf_pdf_nome     text,
  data_solicitacao timestamptz,
  data_autorizacao timestamptz,
  data_faturamento timestamptz,
  data_pagamento   timestamptz,
  observacao      text,
  criado_em       timestamptz default now(),
  atualizado_em   timestamptz default now(),
  unique(contrato_id, numero)
);
create index if not exists idx_parc_contr on public.parcelas_auria(contrato_id);
create index if not exists idx_parc_status on public.parcelas_auria(status);

-- ── Log de eventos (auditoria) ───────────────────────────────
create table if not exists public.parcela_eventos_auria (
  id           uuid primary key default gen_random_uuid(),
  parcela_id   uuid not null references public.parcelas_auria(id) on delete cascade,
  evento       text not null,            -- solicitou | autorizou | recusou | faturou | paga | cancelou | aditivo
  por_email    text,
  por_nome     text,
  por_role     text,                     -- analista | gerente | projetista | sistema
  observacao   text,
  quando       timestamptz default now()
);
create index if not exists idx_evt_parc on public.parcela_eventos_auria(parcela_id, quando desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.contratos_auria         enable row level security;
alter table public.contrato_aditivos_auria enable row level security;
alter table public.parcelas_auria          enable row level security;
alter table public.parcela_eventos_auria   enable row level security;

-- Equipe da empresa (gerente/super_admin/analista vinculado) e criador → acesso total.
drop policy if exists "contr_equipe" on public.contratos_auria;
create policy "contr_equipe" on public.contratos_auria for all using (
  criado_por = auth.uid()
  or exists (select 1 from public.empreendimentos_auria e
       where e.id = empreendimento_id and e.empresa_id = public.minha_empresa())
  or exists (select 1 from public.analista_empreendimento_auria ae
       where ae.analista_id = auth.uid() and ae.empreendimento_id = empreendimento_id and ae.ativo = true)
) with check (
  criado_por = auth.uid()
  or exists (select 1 from public.empreendimentos_auria e
       where e.id = empreendimento_id and e.empresa_id = public.minha_empresa())
);

-- Projetista (pelo e-mail do login) vê os contratos endereçados a ele.
drop policy if exists "contr_projetista" on public.contratos_auria;
create policy "contr_projetista" on public.contratos_auria for select using (
  lower(projetista_email) = lower(auth.jwt() ->> 'email')
);

-- Aditivos: quem tem acesso ao contrato tem acesso aos aditivos.
drop policy if exists "adt_acesso" on public.contrato_aditivos_auria;
create policy "adt_acesso" on public.contrato_aditivos_auria for all using (
  exists (select 1 from public.contratos_auria c where c.id = contrato_id and (
      c.criado_por = auth.uid()
      or exists (select 1 from public.empreendimentos_auria e
           where e.id = c.empreendimento_id and e.empresa_id = public.minha_empresa())
      or exists (select 1 from public.analista_empreendimento_auria ae
           where ae.analista_id = auth.uid() and ae.empreendimento_id = c.empreendimento_id and ae.ativo = true)
      or lower(c.projetista_email) = lower(auth.jwt() ->> 'email')
  ))
);

-- Parcelas: equipe/projetista do contrato.
drop policy if exists "parc_equipe" on public.parcelas_auria;
create policy "parc_equipe" on public.parcelas_auria for all using (
  exists (select 1 from public.contratos_auria c where c.id = contrato_id and (
      c.criado_por = auth.uid()
      or exists (select 1 from public.empreendimentos_auria e
           where e.id = c.empreendimento_id and e.empresa_id = public.minha_empresa())
      or exists (select 1 from public.analista_empreendimento_auria ae
           where ae.analista_id = auth.uid() and ae.empreendimento_id = c.empreendimento_id and ae.ativo = true)
  ))
) with check (
  exists (select 1 from public.contratos_auria c where c.id = contrato_id and (
      c.criado_por = auth.uid()
      or exists (select 1 from public.empreendimentos_auria e
           where e.id = c.empreendimento_id and e.empresa_id = public.minha_empresa())
      or exists (select 1 from public.analista_empreendimento_auria ae
           where ae.analista_id = auth.uid() and ae.empreendimento_id = c.empreendimento_id and ae.ativo = true)
  ))
);
-- Projetista do contrato pode VER as parcelas e atualizar para solicitar fatura.
drop policy if exists "parc_projetista_sel" on public.parcelas_auria;
create policy "parc_projetista_sel" on public.parcelas_auria for select using (
  exists (select 1 from public.contratos_auria c where c.id = contrato_id
          and lower(c.projetista_email) = lower(auth.jwt() ->> 'email'))
);
drop policy if exists "parc_projetista_upd" on public.parcelas_auria;
create policy "parc_projetista_upd" on public.parcelas_auria for update using (
  exists (select 1 from public.contratos_auria c where c.id = contrato_id
          and lower(c.projetista_email) = lower(auth.jwt() ->> 'email'))
);
-- (A regra "só pode mover de a_faturar→solicitada" será reforçada no app;
--  RLS basica acima protege contra acessos cruzados entre projetistas.)

-- Eventos (log): equipe e projetista do contrato podem INSERIR/LER.
drop policy if exists "evt_acesso" on public.parcela_eventos_auria;
create policy "evt_acesso" on public.parcela_eventos_auria for all using (
  exists (select 1 from public.parcelas_auria p join public.contratos_auria c on c.id = p.contrato_id
          where p.id = parcela_id and (
              c.criado_por = auth.uid()
              or exists (select 1 from public.empreendimentos_auria e
                   where e.id = c.empreendimento_id and e.empresa_id = public.minha_empresa())
              or exists (select 1 from public.analista_empreendimento_auria ae
                   where ae.analista_id = auth.uid() and ae.empreendimento_id = c.empreendimento_id and ae.ativo = true)
              or lower(c.projetista_email) = lower(auth.jwt() ->> 'email')
          ))
);

NOTIFY pgrst, 'reload schema';
