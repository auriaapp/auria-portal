-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-22 — backlog do App item 125 (mockups/app_pastas_cores_fluxo.html, aprovado):
--   • cor da pasta (paleta do sistema, sem laranja); subpasta herda a da mãe (no App);
--   • miniatura da análise para a prévia ao parar o mouse na aba (gerada no Salvar, ~20 KB),
--     em tabela própria para não pesar a lista de análises.
-- Aplicado como migração pastas_cor_miniatura.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.analise_pasta_auria add column if not exists cor text;
alter table public.analise_pasta_auria drop constraint if exists analise_pasta_auria_cor_check;
alter table public.analise_pasta_auria add constraint analise_pasta_auria_cor_check
  check (cor is null or cor in ('azul','ciano','verde','ambar','lilas','cinza'));

create table if not exists public.analise_miniatura_auria (
  analise_id   uuid primary key references public.analises_auria(id) on delete cascade,
  img          text not null check (length(img) < 200000),
  atualizado_em timestamptz not null default now()
);
alter table public.analise_miniatura_auria enable row level security;
revoke all on public.analise_miniatura_auria from anon;
grant select, insert, update, delete on public.analise_miniatura_auria to authenticated;
-- Ver: quem enxerga a análise (a RLS de analises_auria decide dentro do exists).
drop policy if exists analise_miniatura_sel on public.analise_miniatura_auria;
create policy analise_miniatura_sel on public.analise_miniatura_auria for select to authenticated
  using (exists (select 1 from public.analises_auria a where a.id = analise_id));
-- Gravar: só o dono da análise.
drop policy if exists analise_miniatura_dono on public.analise_miniatura_auria;
create policy analise_miniatura_dono on public.analise_miniatura_auria for all to authenticated
  using (exists (select 1 from public.analises_auria a where a.id = analise_id and a.criado_por = auth.uid()))
  with check (exists (select 1 from public.analises_auria a where a.id = analise_id and a.criado_por = auth.uid()));

-- REVERSÃO:
-- drop table if exists public.analise_miniatura_auria;
-- alter table public.analise_pasta_auria drop constraint if exists analise_pasta_auria_cor_check;
-- alter table public.analise_pasta_auria drop column if exists cor;
