-- ============================================================================
--  Qualidade F3 — Auditoria interna (ISO 9001 9.2 / PBQP-H SiAC)  2026-11-01
--  Programa (auditorias planejadas no ano) → execução com checklist
--  (C / NC / OM / NA + constatação + evidência) → conclusão: cada NC vira
--  não conformidade da F2 (origem 'auditoria'); OM fica registrada.
--  Checklists por grupo, semeados de modelos ISO 9001 e SiAC (texto próprio,
--  resumido — a Qualidade adapta). Só a Qualidade (grupo_pode_editar 'qualidade').
--  Independência (ISO 19011): auditor não audita processo próprio — o banco
--  recusa auditor = responsável pelo processo auditado.
-- ============================================================================

create table if not exists public.aud_checklist_auria (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null,
  nome text not null,
  referencial text not null default 'interno' check (referencial in ('iso9001','siac','interno')),
  itens jsonb not null default '[]',      -- [{codigo, requisito, pergunta, evidencia, auto?}]
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(), atualizado_nome text
);
alter table public.aud_checklist_auria enable row level security;
drop policy if exists aud_ck_sel on public.aud_checklist_auria;
create policy aud_ck_sel on public.aud_checklist_auria for select using (public.grupo_pode_editar(grupo_id,'qualidade'));

create table if not exists public.aud_auditoria_auria (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null,
  numero int not null,
  titulo text not null,
  processo text,                                   -- ex.: Controle de documentos, Execução de obra
  empreendimento_id uuid references public.empreendimentos_auria(id) on delete set null,   -- null = sede/processo
  referencial text not null default 'iso9001',
  checklist_id uuid references public.aud_checklist_auria(id) on delete set null,
  itens jsonb not null default '[]',               -- snapshot do checklist + {resultado:'c'|'nc'|'om'|'na', constatacao, evidencia, nc_emp}
  data_prevista date not null,
  data_realizada date,
  auditor_id uuid, auditor_nome text,
  responsavel_id uuid, responsavel_nome text,      -- responsável pelo processo auditado
  auditados text,
  situacao text not null default 'planejada' check (situacao in ('planejada','em_andamento','concluida','cancelada')),
  conclusao text,
  concluida_nome text, concluida_em timestamptz,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create unique index if not exists aud_numero_uq on public.aud_auditoria_auria(grupo_id, numero);
alter table public.aud_auditoria_auria enable row level security;
drop policy if exists aud_sel on public.aud_auditoria_auria;
create policy aud_sel on public.aud_auditoria_auria for select using (public.grupo_pode_editar(grupo_id,'qualidade') or auditor_id = auth.uid() or responsavel_id = auth.uid());

-- ── Checklists ──────────────────────────────────────────────────────────────
create or replace function public.aud_checklist_salvar(p_id uuid, p_grupo uuid, p_nome text, p_referencial text, p_itens jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not public.grupo_pode_editar(p_grupo,'qualidade') then raise exception 'Só a Qualidade mantém checklists de auditoria.'; end if;
  if length(trim(coalesce(p_nome,''))) < 3 then raise exception 'Dê um nome ao checklist.'; end if;
  if coalesce(jsonb_array_length(p_itens),0) = 0 then raise exception 'O checklist precisa de itens.'; end if;
  if p_id is null then
    insert into public.aud_checklist_auria (grupo_id, nome, referencial, itens, atualizado_nome) values (p_grupo, trim(p_nome), coalesce(p_referencial,'interno'), p_itens, public._it_nome()) returning id into v_id;
  else
    update public.aud_checklist_auria set nome = trim(p_nome), referencial = coalesce(p_referencial, referencial), itens = p_itens, atualizado_em = now(), atualizado_nome = public._it_nome()
     where id = p_id and grupo_id = p_grupo returning id into v_id;
    if v_id is null then raise exception 'Checklist não encontrado.'; end if;
  end if;
  return v_id;
end $$;

-- Modelos de partida (texto próprio e resumido; não é o texto da norma).
create or replace function public.aud_checklist_semear(p_grupo uuid, p_ref text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_itens jsonb; v_nome text;
begin
  if not public.grupo_pode_editar(p_grupo,'qualidade') then raise exception 'Sem permissão.'; end if;
  if p_ref = 'iso9001' then
    v_nome := 'ISO 9001 — sistema de gestão da qualidade (modelo)';
    v_itens := '[
      {"codigo":"4.1","requisito":"Contexto","pergunta":"As questões internas e externas que afetam a qualidade estão identificadas e revisadas?","evidencia":"Análise de contexto, ata de análise crítica"},
      {"codigo":"4.4","requisito":"Processos do SGQ","pergunta":"Os processos, suas entradas, saídas, responsáveis e indicadores estão definidos?","evidencia":"Mapa de processos, fichas de processo"},
      {"codigo":"5.2","requisito":"Política da qualidade","pergunta":"A política está divulgada e é conhecida pelas equipes de obra?","evidencia":"Entrevista com a equipe, quadro de avisos"},
      {"codigo":"6.1","requisito":"Riscos e oportunidades","pergunta":"Riscos e oportunidades foram levantados e há ações em andamento?","evidencia":"Matriz de riscos"},
      {"codigo":"6.2","requisito":"Objetivos da qualidade","pergunta":"Os objetivos são mensuráveis, acompanhados e comunicados?","evidencia":"Painel de indicadores"},
      {"codigo":"7.1.5","requisito":"Recursos de medição","pergunta":"Trenas, níveis e prumos estão identificados e com aferição em dia?","evidencia":"Lista de equipamentos, certificados de aferição"},
      {"codigo":"7.2","requisito":"Competência","pergunta":"Quem executa serviços controlados foi treinado nas ITs correspondentes?","evidencia":"Registros de treinamento","auto":"ciencia"},
      {"codigo":"7.5.2","requisito":"Criação e atualização de documentos","pergunta":"As revisões são elaboradas, verificadas e aprovadas antes de publicar?","evidencia":"Histórico de revisões no Auria","auto":"revisoes"},
      {"codigo":"7.5.3","requisito":"Controle de documentos","pergunta":"Na obra só há a revisão vigente; cópias obsoletas foram recolhidas?","evidencia":"Cópias controladas no Auria, conferência no canteiro","auto":"copias"},
      {"codigo":"8.1","requisito":"Planejamento da obra","pergunta":"Há plano da qualidade da obra / cronograma com os serviços controlados?","evidencia":"Plano da qualidade, cronograma"},
      {"codigo":"8.3","requisito":"Projeto","pergunta":"Os projetos usados na obra são a revisão liberada e passaram por análise crítica?","evidencia":"CDE — revisão vigente publicada"},
      {"codigo":"8.4","requisito":"Fornecedores e materiais","pergunta":"Fornecedores críticos são qualificados e avaliados? Materiais controlados são inspecionados no recebimento?","evidencia":"Avaliação de fornecedores, fichas de recebimento"},
      {"codigo":"8.5.1","requisito":"Controle da execução","pergunta":"Os serviços controlados têm FVS preenchidas no momento certo, com evidências?","evidencia":"Fichas das obras no Auria","auto":"fvs"},
      {"codigo":"8.5.2","requisito":"Identificação e rastreabilidade","pergunta":"É possível saber onde foi aplicado cada lote de concreto/aço?","evidencia":"Mapa de concretagem, rastreabilidade de lotes"},
      {"codigo":"8.5.4","requisito":"Preservação","pergunta":"Materiais estão armazenados e protegidos conforme especificação?","evidencia":"Inspeção do almoxarifado e canteiro"},
      {"codigo":"8.6","requisito":"Liberação","pergunta":"Serviços só são liberados para a etapa seguinte após a FVS aprovada?","evidencia":"FVS aprovadas × avanço do cronograma"},
      {"codigo":"8.7","requisito":"Saída não conforme","pergunta":"Serviços reprovados são identificados e tratados antes de seguir?","evidencia":"Fichas reprovadas e reinspeções","auto":"fvs"},
      {"codigo":"9.1.2","requisito":"Satisfação do cliente","pergunta":"A satisfação do cliente é medida e analisada?","evidencia":"Pesquisa de satisfação, assistência técnica"},
      {"codigo":"9.2","requisito":"Auditoria interna","pergunta":"O programa de auditorias está sendo cumprido e as constatações tratadas?","evidencia":"Programa de auditorias no Auria"},
      {"codigo":"9.3","requisito":"Análise crítica pela direção","pergunta":"A direção analisou os resultados do SGQ no período, com decisões registradas?","evidencia":"Ata de análise crítica"},
      {"codigo":"10.2","requisito":"Não conformidade e ação corretiva","pergunta":"As NCs têm causa raiz, ações no prazo e eficácia verificada?","evidencia":"Não conformidades no Auria","auto":"nc"},
      {"codigo":"10.3","requisito":"Melhoria contínua","pergunta":"Há melhorias implantadas a partir de indicadores, NCs e auditorias?","evidencia":"Registro de melhorias"}
    ]'::jsonb;
  elsif p_ref = 'siac' then
    v_nome := 'PBQP-H SiAC — execução de obras (modelo)';
    v_itens := '[
      {"codigo":"SiAC-1","requisito":"Lista de serviços controlados","pergunta":"A obra tem a lista de serviços controlados e cada um tem procedimento (IT) e FVS?","evidencia":"Lista de serviços × ITs × modelos de FVS"},
      {"codigo":"SiAC-2","requisito":"Lista de materiais controlados","pergunta":"Os materiais controlados têm especificação e inspeção de recebimento?","evidencia":"Fichas de recebimento de materiais"},
      {"codigo":"SiAC-3","requisito":"Documentos na obra","pergunta":"Os procedimentos na obra estão na revisão vigente e acessíveis a quem executa?","evidencia":"Biblioteca no Auria, cópias controladas","auto":"copias"},
      {"codigo":"SiAC-4","requisito":"Treinamento nos procedimentos","pergunta":"Encarregados e equipes foram treinados nas ITs dos serviços em execução?","evidencia":"Registros de ciência/treinamento","auto":"ciencia"},
      {"codigo":"SiAC-5","requisito":"Inspeção de serviços","pergunta":"As FVS são preenchidas na execução, com tolerâncias e responsável pela liberação?","evidencia":"Fichas das obras","auto":"fvs"},
      {"codigo":"SiAC-6","requisito":"Controle tecnológico","pergunta":"Há ensaios de concreto (slump, corpos de prova) com resultados analisados?","evidencia":"Mapa de concretagem, laudos"},
      {"codigo":"SiAC-7","requisito":"Qualificação de fornecedores","pergunta":"Empreiteiros e fornecedores de materiais controlados são qualificados e avaliados?","evidencia":"Cadastro e avaliação de empreiteiros"},
      {"codigo":"SiAC-8","requisito":"Equipamentos de medição","pergunta":"Os equipamentos de inspeção estão aferidos e identificados?","evidencia":"Certificados de aferição"},
      {"codigo":"SiAC-9","requisito":"Projetos","pergunta":"A obra usa os projetos liberados e registra as alterações (as built)?","evidencia":"CDE — revisões publicadas"},
      {"codigo":"SiAC-10","requisito":"Armazenamento","pergunta":"O armazenamento de materiais segue o especificado (cimento, aço, blocos)?","evidencia":"Inspeção do canteiro"},
      {"codigo":"SiAC-11","requisito":"Não conformidades","pergunta":"Serviços reprovados são refeitos e as NCs recorrentes viram ação corretiva?","evidencia":"Não conformidades no Auria","auto":"nc"},
      {"codigo":"SiAC-12","requisito":"Entrega e assistência técnica","pergunta":"Há manual do proprietário e controle das solicitações de assistência técnica?","evidencia":"Manual, registro de chamados"}
    ]'::jsonb;
  else raise exception 'Referencial desconhecido.'; end if;
  return public.aud_checklist_salvar(null, p_grupo, v_nome, p_ref, v_itens);
end $$;

-- ── Programa e execução ─────────────────────────────────────────────────────
create or replace function public.aud_planejar(p_id uuid, p_grupo uuid, p_titulo text, p_processo text, p_emp uuid, p_checklist uuid,
                                               p_data date, p_auditor uuid, p_responsavel uuid, p_auditados text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_num int; v_ck record; v_aud text; v_resp text;
begin
  if not public.grupo_pode_editar(p_grupo,'qualidade') then raise exception 'Só a Qualidade planeja auditorias.'; end if;
  if length(trim(coalesce(p_titulo,''))) < 3 then raise exception 'Dê um título à auditoria.'; end if;
  if p_data is null then raise exception 'Informe a data prevista.'; end if;
  if p_auditor is not null and p_auditor = p_responsavel then raise exception 'Independência: o auditor não pode ser o responsável pelo processo auditado.'; end if;
  select * into v_ck from public.aud_checklist_auria where id = p_checklist and grupo_id = p_grupo;
  if v_ck.id is null then raise exception 'Escolha o checklist.'; end if;
  select coalesce(nome,email) into v_aud from public.usuarios_auria where id = p_auditor;
  select coalesce(nome,email) into v_resp from public.usuarios_auria where id = p_responsavel;
  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('aud' || p_grupo));
    select coalesce(max(numero),0) + 1 into v_num from public.aud_auditoria_auria where grupo_id = p_grupo;
    insert into public.aud_auditoria_auria (grupo_id, numero, titulo, processo, empreendimento_id, referencial, checklist_id, itens, data_prevista, auditor_id, auditor_nome, responsavel_id, responsavel_nome, auditados)
    values (p_grupo, v_num, trim(p_titulo), nullif(trim(coalesce(p_processo,'')),''), p_emp, v_ck.referencial, v_ck.id, v_ck.itens, p_data, p_auditor, v_aud, p_responsavel, v_resp, nullif(trim(coalesce(p_auditados,'')),''))
    returning id into v_id;
  else
    update public.aud_auditoria_auria set titulo = trim(p_titulo), processo = nullif(trim(coalesce(p_processo,'')),''), empreendimento_id = p_emp, data_prevista = p_data,
           auditor_id = p_auditor, auditor_nome = v_aud, responsavel_id = p_responsavel, responsavel_nome = v_resp, auditados = nullif(trim(coalesce(p_auditados,'')),''),
           checklist_id = v_ck.id, referencial = v_ck.referencial,
           itens = case when situacao = 'planejada' and checklist_id is distinct from v_ck.id then v_ck.itens else itens end, atualizado_em = now()
     where id = p_id and grupo_id = p_grupo and situacao in ('planejada','em_andamento') returning id into v_id;
    if v_id is null then raise exception 'Auditoria não encontrada ou já concluída.'; end if;
  end if;
  return v_id;
end $$;

-- grava o andamento (resultados dos itens); auditor ou Qualidade
create or replace function public.aud_registrar(p_id uuid, p_itens jsonb, p_auditados text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare a record;
begin
  select * into a from public.aud_auditoria_auria where id = p_id for update;
  if a.id is null or not (public.grupo_pode_editar(a.grupo_id,'qualidade') or a.auditor_id = auth.uid()) then raise exception 'Sem permissão.'; end if;
  if a.situacao not in ('planejada','em_andamento') then raise exception 'Auditoria encerrada.'; end if;
  if jsonb_array_length(coalesce(p_itens,'[]')) <> jsonb_array_length(a.itens) then raise exception 'Lista de itens divergente — recarregue a tela.'; end if;
  update public.aud_auditoria_auria set itens = p_itens, auditados = coalesce(nullif(trim(coalesce(p_auditados,'')),''), auditados),
         situacao = 'em_andamento', data_realizada = coalesce(data_realizada, current_date), atualizado_em = now() where id = p_id;
end $$;

-- conclui: exige todo item avaliado; cada NC vira não conformidade (F2)
create or replace function public.aud_concluir(p_id uuid, p_conclusao text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare a record; it jsonb; i int := 0; n int := 0; v_emp uuid; v_nc uuid;
begin
  select * into a from public.aud_auditoria_auria where id = p_id for update;
  if a.id is null or not (public.grupo_pode_editar(a.grupo_id,'qualidade') or a.auditor_id = auth.uid()) then raise exception 'Sem permissão.'; end if;
  if a.situacao not in ('planejada','em_andamento') then raise exception 'Auditoria já encerrada.'; end if;
  if exists (select 1 from jsonb_array_elements(a.itens) e where coalesce(e->>'resultado','') = '') then raise exception 'Avalie todos os itens (C, NC, OM ou NA) antes de concluir.'; end if;
  if exists (select 1 from jsonb_array_elements(a.itens) e where e->>'resultado' in ('nc','om') and length(trim(coalesce(e->>'constatacao',''))) < 5) then raise exception 'Toda NC e OM precisa de constatação descrita.'; end if;
  if length(trim(coalesce(p_conclusao,''))) < 5 then raise exception 'Escreva a conclusão da auditoria.'; end if;
  for it in select * from jsonb_array_elements(a.itens) loop
    if it->>'resultado' = 'nc' then
      v_emp := coalesce(nullif(it->>'nc_emp','')::uuid, a.empreendimento_id);
      if v_emp is null then raise exception 'Item %: diga em qual obra a NC deve ser tratada.', it->>'codigo'; end if;
      perform pg_advisory_xact_lock(hashtext('nc' || a.grupo_id));
      insert into public.nc_auria (grupo_id, empreendimento_id, numero, titulo, descricao, servico, origem, origem_id, origem_rodada, origem_ref, aberta_nome, aberta_por, gravidade, tipo)
      values (a.grupo_id, v_emp, (select coalesce(max(numero),0) + 1 from public.nc_auria where grupo_id = a.grupo_id),
              'Auditoria ' || lpad(a.numero::text,3,'0') || ' — ' || (it->>'requisito'),
              concat_ws(E'\n\n', it->>'constatacao', nullif('Evidência: ' || coalesce(it->>'evidencia_obs',''), 'Evidência: ')),
              a.processo, 'auditoria', a.id, i, 'AUD ' || lpad(a.numero::text,3,'0') || ' · ' || (it->>'codigo'), public._it_nome(), auth.uid(), 'moderada', 'documental')
      on conflict do nothing returning id into v_nc;
      if v_nc is not null then
        insert into public.nc_evento_auria (nc_id, tipo, observacao, por_nome) values (v_nc, 'aberta', 'Constatação da auditoria ' || lpad(a.numero::text,3,'0'), public._it_nome());
        n := n + 1;
      end if;
    end if;
    i := i + 1;
  end loop;
  update public.aud_auditoria_auria set situacao = 'concluida', conclusao = trim(p_conclusao), concluida_nome = public._it_nome(), concluida_em = now(),
         data_realizada = coalesce(data_realizada, current_date), atualizado_em = now() where id = p_id;
  return n;
end $$;

create or replace function public.aud_cancelar(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare a record;
begin
  select * into a from public.aud_auditoria_auria where id = p_id;
  if a.id is null or not public.grupo_pode_editar(a.grupo_id,'qualidade') then raise exception 'Sem permissão.'; end if;
  if a.situacao = 'concluida' then raise exception 'Auditoria concluída não é cancelada.'; end if;
  update public.aud_auditoria_auria set situacao = 'cancelada', atualizado_em = now() where id = p_id;
end $$;

-- auditores possíveis: Qualidade + gerência do grupo + eng. chefe das obras
create or replace function public.aud_pessoas(p_grupo uuid)
returns table(id uuid, nome text, papel text) language sql stable security definer set search_path to 'public' as $$
  select u.id, coalesce(u.nome,u.email), case when u.role = 'setor' then 'setor:' || coalesce(u.setor_area,'') else u.role end
    from public.usuarios_auria u
   where public.grupo_pode_editar(p_grupo,'qualidade') and u.empresa_id = p_grupo and coalesce(u.ativo,true) and u.role in ('setor','gerente','obra')
   order by 2
$$;

revoke all on function public.aud_checklist_salvar(uuid,uuid,text,text,jsonb), public.aud_checklist_semear(uuid,text), public.aud_planejar(uuid,uuid,text,text,uuid,uuid,date,uuid,uuid,text),
  public.aud_registrar(uuid,jsonb,text), public.aud_concluir(uuid,text), public.aud_cancelar(uuid), public.aud_pessoas(uuid) from anon, public;
grant execute on function public.aud_checklist_salvar(uuid,uuid,text,text,jsonb), public.aud_checklist_semear(uuid,text), public.aud_planejar(uuid,uuid,text,text,uuid,uuid,date,uuid,uuid,text),
  public.aud_registrar(uuid,jsonb,text), public.aud_concluir(uuid,text), public.aud_cancelar(uuid), public.aud_pessoas(uuid) to authenticated;
