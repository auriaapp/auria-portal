-- ═══════════════════════════════════════════════════════════════════════════
-- Item 110 fase 1 (2026-11-15): marcações da ANÁLISE na prancha.
-- Decidido (mockups/app_marcacao_prancha.html):
--   • a marcação pertence à análise onde foi feita (não à prancha nem ao apontamento);
--   • fica presa à prancha em foco (prancha_id) + página, coordenadas normalizadas;
--   • guarda a revisão do CDE onde nasceu (para o aviso de revisão nova, fase futura);
--   • quem vê a análise vê as marcações; só o DONO da análise cria/altera/apaga.
-- Tipos da fase 1: nuvem, chamada, balao, marcador, texto. 'dados' guarda a geometria
-- ({a,b,pts,txt,cor,tam}) e 'numero' o nº do balão dentro da análise.
-- REVERSÃO no fim (comentada).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.analise_marcacao_auria (
  id                uuid primary key default gen_random_uuid(),
  analise_id        uuid not null references public.analises_auria(id) on delete cascade,
  empreendimento_id uuid not null,
  prancha_id        uuid,
  cde_documento_id  uuid,
  cde_revisao_id    uuid,
  pg                int not null default 1,
  tipo              text not null check (tipo in ('nuvem','chamada','balao','marcador','texto','carimbo','seta','linha','retangulo','elipse','poligono','livre','cota','area')),
  dados             jsonb not null default '{}'::jsonb,
  numero            int,
  autor             uuid default auth.uid(),
  autor_nome        text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index if not exists analise_marc_an_idx on public.analise_marcacao_auria(analise_id);

alter table public.analise_marcacao_auria enable row level security;
-- Lê quem lê a análise (a RLS de analises_auria vale dentro do exists).
create policy analise_marc_sel on public.analise_marcacao_auria for select to authenticated
  using (exists (select 1 from public.analises_auria a where a.id = analise_marcacao_auria.analise_id));
-- Grava só o dono da análise, e no mesmo empreendimento dela.
create policy analise_marc_ins on public.analise_marcacao_auria for insert to authenticated
  with check (exists (select 1 from public.analises_auria a where a.id = analise_marcacao_auria.analise_id
                       and a.criado_por = auth.uid() and a.empreendimento_id = analise_marcacao_auria.empreendimento_id));
create policy analise_marc_upd on public.analise_marcacao_auria for update to authenticated
  using (exists (select 1 from public.analises_auria a where a.id = analise_marcacao_auria.analise_id and a.criado_por = auth.uid()))
  with check (exists (select 1 from public.analises_auria a where a.id = analise_marcacao_auria.analise_id
                       and a.criado_por = auth.uid() and a.empreendimento_id = analise_marcacao_auria.empreendimento_id));
create policy analise_marc_del on public.analise_marcacao_auria for delete to authenticated
  using (exists (select 1 from public.analises_auria a where a.id = analise_marcacao_auria.analise_id and a.criado_por = auth.uid()));
revoke all on table public.analise_marcacao_auria from anon;

-- REVERSÃO:
-- drop table if exists public.analise_marcacao_auria;
