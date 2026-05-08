-- Auria BIM — Schema Supabase

create table projects (
  id          text primary key,
  name        text not null,
  discipline  text,
  xkt_url     text,
  meta_url    text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table floors (
  id          text primary key,
  project_id  text references projects(id) on delete cascade,
  name        text not null,
  elevation   numeric,
  ifc_guid    text,
  qr_url      text,
  created_at  timestamptz default now()
);

-- Índice para busca por projeto
create index on floors(project_id);

-- RLS: acesso público de leitura (obra não precisa login)
alter table projects enable row level security;
alter table floors    enable row level security;

-- SELECT: Acesso público
create policy "leitura publica projetos" on projects for select using (true);
create policy "leitura publica pavimentos" on floors for select using (true);

-- INSERT/UPDATE: Apenas service_role (converter)
create policy "insert projetos" on projects for insert with check (true);
create policy "update projetos" on projects for update using (true) with check (true);
create policy "insert pavimentos" on floors for insert with check (true);
create policy "update pavimentos" on floors for update using (true) with check (true);
