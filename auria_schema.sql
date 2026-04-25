-- ============================================================
-- AURIA — Schema Multi-tenant
-- Cole e execute no SQL Editor do Supabase (em ordem)
-- ============================================================

-- 1. EXTENSÕES
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 2. EMPRESAS (clientes do Auria)
create table if not exists public.empresas (
  id                      uuid primary key default uuid_generate_v4(),
  nome                    text not null,
  cnpj                    text,
  plano                   text default 'basic' check (plano in ('basic','professional','enterprise')),
  ativo                   boolean default true,
  criado_em               timestamptz default now(),
  limite_analistas        int default 10,
  limite_empreendimentos  int default 5
);

-- 3. USUARIOS
create table if not exists public.usuarios (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  nome          text,
  role          text default 'analista' check (role in ('super_admin','gerente','analista')),
  empresa_id    uuid references public.empresas(id),
  ativo         boolean default true,
  ultimo_acesso timestamptz,
  criado_em     timestamptz default now()
);

-- 4. EMPREENDIMENTOS
create table if not exists public.empreendimentos (
  id            uuid primary key default uuid_generate_v4(),
  empresa_id    uuid references public.empresas(id) not null,
  nome          text not null,
  cidade        text,
  estado        text,
  logo_url      text,
  pavimentos    jsonb default '[]',
  configuracoes jsonb default '{}',
  ativo         boolean default true,
  criado_em     timestamptz default now(),
  criado_por    uuid references public.usuarios(id)
);

-- 5. ACESSO ANALISTA → EMPREENDIMENTO
create table if not exists public.analista_empreendimento (
  id                uuid primary key default uuid_generate_v4(),
  analista_id       uuid references public.usuarios(id) not null,
  empreendimento_id uuid references public.empreendimentos(id) not null,
  concedido_por     uuid references public.usuarios(id),
  ativo             boolean default true,
  concedido_em      timestamptz default now(),
  unique(analista_id, empreendimento_id)
);

-- 6. CONVITES
create table if not exists public.convites (
  id            uuid primary key default uuid_generate_v4(),
  email         text not null,
  role          text not null check (role in ('gerente','analista')),
  empresa_id    uuid references public.empresas(id),
  convidado_por uuid references public.usuarios(id),
  token         text unique not null default encode(gen_random_bytes(32), 'hex'),
  expira_em     timestamptz not null default now() + interval '48 hours',
  aceito        boolean default false,
  aceito_em     timestamptz,
  criado_em     timestamptz default now()
);

-- 7. MÉTRICAS DIÁRIAS (snapshot enviado pelo app Python)
create table if not exists public.metricas_diarias (
  id                uuid primary key default uuid_generate_v4(),
  empreendimento_id uuid references public.empreendimentos(id) not null,
  empresa_id        uuid references public.empresas(id),
  data              date not null default current_date,
  total_abertos     int default 0,
  total_em_dia      int default 0,
  total_em_atraso   int default 0,
  total_resolvidos  int default 0,
  indice_resposta   float default 0,
  enviado_em        timestamptz default now(),
  unique(empreendimento_id, data)
);

-- 8. LOGS DE ACESSO
create table if not exists public.logs_acesso (
  id                uuid primary key default uuid_generate_v4(),
  usuario_id        uuid references public.usuarios(id),
  empresa_id        uuid references public.empresas(id),
  empreendimento_id uuid references public.empreendimentos(id),
  acao              text,
  detalhes          jsonb,
  criado_em         timestamptz default now()
);

-- 9. CHAMADOS DE SUPORTE
create table if not exists public.chamados (
  id            uuid primary key default uuid_generate_v4(),
  usuario_id    uuid references public.usuarios(id),
  empresa_id    uuid references public.empresas(id),
  titulo        text not null,
  descricao     text,
  status        text default 'aberto' check (status in ('aberto','em_atendimento','fechado')),
  prioridade    text default 'normal' check (prioridade in ('baixa','normal','alta','critica')),
  criado_em     timestamptz default now(),
  atualizado_em timestamptz default now()
);

-- ============================================================
-- FUNÇÕES AUXILIARES
-- ============================================================

create or replace function public.minha_role()
returns text language sql security definer stable as $$
  select role from public.usuarios where id = auth.uid()
$$;

create or replace function public.minha_empresa()
returns uuid language sql security definer stable as $$
  select empresa_id from public.usuarios where id = auth.uid()
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.empresas              enable row level security;
alter table public.usuarios              enable row level security;
alter table public.empreendimentos       enable row level security;
alter table public.analista_empreendimento enable row level security;
alter table public.metricas_diarias      enable row level security;
alter table public.convites              enable row level security;
alter table public.logs_acesso           enable row level security;
alter table public.chamados              enable row level security;

-- EMPRESAS
create policy "sa_empresas_all"    on public.empresas for all    using (public.minha_role() = 'super_admin');
create policy "ger_empresa_select" on public.empresas for select using (id = public.minha_empresa());

-- USUARIOS
create policy "sa_usuarios_all"    on public.usuarios for all    using (public.minha_role() = 'super_admin');
create policy "ger_usuarios_sel"   on public.usuarios for select using (empresa_id = public.minha_empresa() and public.minha_role() = 'gerente');
create policy "self_usuario"       on public.usuarios for select using (id = auth.uid());
create policy "self_update"        on public.usuarios for update using (id = auth.uid());

-- EMPREENDIMENTOS
create policy "sa_emp_all"    on public.empreendimentos for all    using (public.minha_role() = 'super_admin');
create policy "ger_emp_all"   on public.empreendimentos for all    using (empresa_id = public.minha_empresa() and public.minha_role() = 'gerente');
create policy "ana_emp_sel"   on public.empreendimentos for select using (
  exists (select 1 from public.analista_empreendimento ae
    where ae.analista_id = auth.uid() and ae.empreendimento_id = id and ae.ativo = true));

-- ANALISTA_EMPREENDIMENTO
create policy "sa_ae_all"  on public.analista_empreendimento for all    using (public.minha_role() = 'super_admin');
create policy "ger_ae_all" on public.analista_empreendimento for all    using (
  exists (select 1 from public.empreendimentos e
    where e.id = empreendimento_id and e.empresa_id = public.minha_empresa())
  and public.minha_role() = 'gerente');
create policy "ana_ae_sel" on public.analista_empreendimento for select using (analista_id = auth.uid());

-- MÉTRICAS
create policy "sa_met_all"  on public.metricas_diarias for all    using (public.minha_role() = 'super_admin');
create policy "ger_met_sel" on public.metricas_diarias for select using (empresa_id = public.minha_empresa());
create policy "ana_met_ins" on public.metricas_diarias for insert with check (
  exists (select 1 from public.analista_empreendimento ae
    where ae.analista_id = auth.uid() and ae.empreendimento_id = empreendimento_id and ae.ativo = true));
create policy "ana_met_upd" on public.metricas_diarias for update using (
  exists (select 1 from public.analista_empreendimento ae
    where ae.analista_id = auth.uid() and ae.empreendimento_id = empreendimento_id and ae.ativo = true));

-- CONVITES
create policy "sa_conv_all"  on public.convites for all    using (public.minha_role() = 'super_admin');
create policy "ger_conv_all" on public.convites for all    using (empresa_id = public.minha_empresa() and public.minha_role() = 'gerente');
create policy "pub_conv_sel" on public.convites for select using (true);

-- CHAMADOS
create policy "sa_cham_all"  on public.chamados for all using (public.minha_role() = 'super_admin');
create policy "emp_cham_all" on public.chamados for all using (empresa_id = public.minha_empresa());

-- ============================================================
-- TRIGGER: atualiza ultimo_acesso ao logar
-- ============================================================
create or replace function public.handle_last_sign_in()
returns trigger language plpgsql security definer as $$
begin
  update public.usuarios set ultimo_acesso = now() where id = new.id;
  return new;
end;
$$;

-- ============================================================
-- TRIGGER: cria perfil ao criar usuário no Auth
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_convite record;
begin
  -- Busca convite pendente para este email
  select * into v_convite
    from public.convites
    where email = new.email and aceito = false and expira_em > now()
    order by criado_em desc limit 1;

  insert into public.usuarios (id, email, nome, role, empresa_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
    coalesce(v_convite.role, 'analista'),
    v_convite.empresa_id
  );

  -- Marca convite como aceito
  if v_convite.id is not null then
    update public.convites set aceito = true, aceito_em = now() where id = v_convite.id;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
