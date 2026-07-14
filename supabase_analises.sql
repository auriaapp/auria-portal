-- ============================================================================
--  ANÁLISES SALVAS (estação de pranchas) — W3.x
--  Guarda o CONJUNTO de pranchas/camadas de uma análise (ordem + identidade por
--  hash). O estado (offset/escala/opacidade/cor/cotas) continua em
--  camadas_estado_auria; os apontamentos em `apontamentos`. Ao reabrir, o usuário
--  seleciona os PDFs (multi) e o app remonta tudo casando por arquivo_hash.
--  Rodar no SQL editor do Supabase (idempotente).
-- ============================================================================

create table if not exists public.analises_auria (
  id                uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos_auria(id) on delete cascade,
  nome              text not null,
  -- [{prancha_id, arquivo_nome, arquivo_hash, ordem}]  (ordem 0 = prancha base)
  pranchas          jsonb not null default '[]'::jsonb,
  criado_por        uuid,
  criado_em         timestamptz default now(),
  atualizado_em     timestamptz default now()
);

create index if not exists idx_analises_emp on public.analises_auria(empreendimento_id);

alter table public.analises_auria enable row level security;

-- Equipe do empreendimento (mesmo escopo dos apontamentos): empresa do grupo OU
-- analista designado ao empreendimento.
drop policy if exists "analises_rw" on public.analises_auria;
create policy "analises_rw" on public.analises_auria for all
  using (
    exists (
      select 1 from public.empreendimentos_auria e
      where e.id = empreendimento_id and (
        e.empresa_id = public.minha_empresa()
        or exists (select 1 from public.analista_empreendimento_auria ae
                   where ae.analista_id = auth.uid()
                     and ae.empreendimento_id = e.id and ae.ativo = true)
      )
    )
  )
  with check (
    exists (
      select 1 from public.empreendimentos_auria e
      where e.id = empreendimento_id and (
        e.empresa_id = public.minha_empresa()
        or exists (select 1 from public.analista_empreendimento_auria ae
                   where ae.analista_id = auth.uid()
                     and ae.empreendimento_id = e.id and ae.ativo = true)
      )
    )
  );
