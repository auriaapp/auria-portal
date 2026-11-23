-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-22 — backlog do App item 137 (mockups/app_reuniao_quadro.html, aprovado):
--   QUADRO da reunião: tópicos (reuniao_auria.quadro = { topicos:[{id,titulo,cor,ordem}],
--   ligacoes:[[cartaoA,cartaoB]], fora:[pendências tiradas da pauta] }) e cartões
--   (reuniao_cartao_auria): vista 2D/3D "viva" (estado = pranchas, camadas, zoom, página,
--   marcações; modelos, câmera e corte), nota e pergunta. Item da ata guarda o cartão onde
--   nasceu (reuniao_item_auria.cartao_id). Gravar = dono da análise (como a ata).
-- Aplicado como migração reuniao_quadro.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.reuniao_auria add column if not exists quadro jsonb not null default '{}'::jsonb;
alter table public.reuniao_item_auria add column if not exists cartao_id uuid;

create table if not exists public.reuniao_cartao_auria (
  id            uuid primary key default gen_random_uuid(),
  reuniao_id    uuid not null references public.reuniao_auria(id) on delete cascade,
  topico        text not null,
  ordem         integer not null default 0,
  tipo          text not null check (tipo in ('v2d','v3d','nota','pergunta')),
  titulo        text not null default '' check (length(titulo) <= 200),
  texto         text not null default '' check (length(texto) <= 2000),
  estado        jsonb not null default '{}'::jsonb,
  mini          text check (mini is null or length(mini) < 200000),
  visto         boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists reuniao_cartao_auria_reuniao on public.reuniao_cartao_auria(reuniao_id);

alter table public.reuniao_cartao_auria enable row level security;
revoke all on public.reuniao_cartao_auria from anon;
grant select, insert, update, delete on public.reuniao_cartao_auria to authenticated;

drop policy if exists reuniao_cartao_sel on public.reuniao_cartao_auria;
create policy reuniao_cartao_sel on public.reuniao_cartao_auria for select to authenticated
  using (exists (select 1 from public.reuniao_auria r where r.id = reuniao_id));
drop policy if exists reuniao_cartao_dono on public.reuniao_cartao_auria;
create policy reuniao_cartao_dono on public.reuniao_cartao_auria for all to authenticated
  using (exists (select 1 from public.reuniao_auria r join public.analises_auria a on a.id = r.analise_id
                 where r.id = reuniao_id and a.criado_por = auth.uid()))
  with check (exists (select 1 from public.reuniao_auria r join public.analises_auria a on a.id = r.analise_id
                      where r.id = reuniao_id and a.criado_por = auth.uid()));

-- REVERSÃO:
-- drop table if exists public.reuniao_cartao_auria;
-- alter table public.reuniao_item_auria drop column if exists cartao_id;
-- alter table public.reuniao_auria drop column if exists quadro;
