-- ============================================================================
--  Item 137 — por que o seletor "Responsável…" fica vazio (2026-09-26). Só lê.
--
--  SINTOMA: em Acessos, o nome do fornecedor aparece, mas o seletor de
--  responsável não lista ninguém — mesmo com RT marcado no cadastro.
--
--  HIPÓTESE: a tela lê FORNECEDORES[].projetistas_auria, e a policy dessa
--  tabela exige que o FORNECEDOR seja do seu grupo:
--      exists (select 1 from fornecedores_auria f
--               where f.id = projetistas_auria.fornecedor_id
--                 and f.empresa_id = minha_empresa())
--  Se o fornecedor foi cadastrado no grupo ERRADO — e sabemos que existem dois
--  "Grupo Diagonal" — o nome dele continua visível (vem por outra policy, pelo
--  empreendimento), mas as PESSOAS somem. É o mesmo estrago das empresas
--  duplicadas do item 144, por outra porta.
-- ============================================================================

select 'FORNECEDOR' as o_que,
       f.nome       as nome,
       coalesce(g.nome,'(sem grupo)') || '  [' || coalesce(f.empresa_id::text,'nulo') || ']' as grupo,
       (select count(*) from public.projetistas_auria p
         where p.fornecedor_id = f.id and coalesce(p.ativo,true))::text || ' pessoa(s) cadastrada(s)' as detalhe
  from public.fornecedores_auria f
  left join public.empresas_auria g on g.id = f.empresa_id

union all

select 'EMPREENDIMENTO',
       e.nome,
       coalesce(g.nome,'(sem grupo)') || '  [' || coalesce(e.empresa_id::text,'nulo') || ']',
       'ativo'
  from public.empreendimentos_auria e
  left join public.empresas_auria g on g.id = e.empresa_id
 where e.deleted_at is null

union all

select 'QUEM SOU EU',
       coalesce(u.nome, u.email),
       coalesce(g.nome,'(sem grupo)') || '  [' || coalesce(u.empresa_id::text,'nulo') || ']',
       'papel ' || coalesce(u.role,'?')
  from public.usuarios_auria u
  left join public.empresas_auria g on g.id = u.empresa_id
 where u.role in ('analista','gerente','super_admin')

order by 1, 2;
