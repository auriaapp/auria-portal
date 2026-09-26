-- ============================================================================
--  Item 144 — desambiguar grupos e empreendimentos duplicados (2026-09-26)
--  Rodar no SQL Editor. Reaplicável (idempotente). NADA É APAGADO.
--
--  O QUE ISTO FAZ: só renomeia, e só linhas de TESTE, todas identificadas por
--  ID explícito — não por nome, para não haver chance de acertar a linha errada.
--  O "Grupo Diagonal" de verdade (23f3387f) e o empreendimento ATIVO
--  (c10f4604) não são tocados.
--
--  POR QUE RENOMEAR RESOLVE: foi a colisão de NOME entre quatro
--  "Diagonal by Pininfarina" que causou o incidente 139 (e-mail para a equipe
--  errada). A resolução por ID já estancou o vazamento; isto tira o lixo que
--  volta a confundir qualquer busca, relatório ou conferência futura.
--
--  O sufixo carrega os 4 primeiros caracteres do id: fica único entre si e dá
--  para rastrear de volta. O nome original continua legível dentro do novo.
--
--  O QUE ISTO **NÃO** FAZ: não mexe em nenhuma conta. Ver a nota no fim sobre
--  as contas super_admin — a auditoria mostrou que repontar não é a correção
--  certa, e o motivo está lá.
-- ============================================================================

-- ── 1. Empreendimentos ARQUIVADOS com nome repetido ────────────────────────
--  Os três "Diagonal by Pininfarina" de teste (o ATIVO c10f4604 fica intacto)
update public.empreendimentos_auria
   set nome = nome || ' [teste ' || left(id::text,4) || ']'
 where id in ('3645dbbb-015b-4e5f-b56b-41a7b355093e',
              '0546f54a-32e9-4fec-b86b-18abc181e86f',
              'c6a9a582-99d0-4728-85d7-33c25061e41b')
   and deleted_at is not null          -- trava: só arquivado
   and nome not like '%[teste %';      -- idempotente

--  Os dois "Empreendimento teste"/"Teste", que diferem só na maiúscula —
--  qualquer busca que normalize caixa trata como o mesmo registro.
update public.empreendimentos_auria
   set nome = nome || ' [teste ' || left(id::text,4) || ']'
 where id in ('d351887b-379d-4742-a643-5c45fc277fa9',
              '2f32d9c4-275d-4e60-8f9b-f5c198a51fe1')
   and deleted_at is not null
   and nome not like '%[teste %';


-- ── 2. Grupos com nome repetido ─────────────────────────────────────────────
--  O "Grupo Diagonal" VAZIO (0 construtoras, 0 empreendimentos), que só abriga
--  as duas contas super_admin. Passa a dizer o que é, em vez de se fazer passar
--  pelo grupo do cliente.
update public.empresas_auria
   set nome = 'Auria — plataforma (super_admin)'
 where id = '2668ff51-0cea-404d-847e-b45f4a1aa492'
   and nome = 'Grupo Diagonal';

--  "Grupo teste" (minúsculo) colide com "Grupo Teste" só na caixa.
update public.empresas_auria
   set nome = nome || ' [' || left(id::text,4) || ']'
 where id = '5948e22a-422d-4a83-97f9-5ada1997eb7f'
   and nome not like '%[%';

--  As duas "Construtora Teste".
update public.empresas_auria
   set nome = nome || ' [' || left(id::text,4) || ']'
 where id in ('bb5d967f-2990-4d9f-bdb5-6c2313faa68b',
              'c18ebe93-53fd-4056-83be-b1de643bba1e')
   and nome not like '%[%';


-- ── DESFAZER (se algo ficar estranho, rodar este bloco) ────────────────────
--  Tira o sufixo e devolve o nome do grupo da plataforma. Também idempotente.
--
--  update public.empreendimentos_auria
--     set nome = regexp_replace(nome, ' \[teste [0-9a-f]{4}\]$', '')
--   where nome ~ ' \[teste [0-9a-f]{4}\]$';
--  update public.empresas_auria
--     set nome = regexp_replace(nome, ' \[[0-9a-f]{4}\]$', '')
--   where nome ~ ' \[[0-9a-f]{4}\]$';
--  update public.empresas_auria set nome = 'Grupo Diagonal'
--   where id = '2668ff51-0cea-404d-847e-b45f4a1aa492';


-- ── CONFERÊNCIA (último comando de propósito: é o que o editor mostra) ─────
select 'A. grupos que ainda repetem nome' as secao,
       lower(trim(nome))                  as item,
       count(*)::text                     as valor,
       string_agg(left(id::text,8), ' | ') as detalhe
  from public.empresas_auria
 group by 1,2 having count(*) > 1

union all
select 'B. empreendimentos que ainda repetem nome',
       lower(trim(nome)), count(*)::text, string_agg(left(id::text,8), ' | ')
  from public.empreendimentos_auria
 group by 1,2 having count(*) > 1

union all
select 'C. o que NAO podia ser tocado (tem de estar intacto)',
       nome, left(id::text,8),
       case when deleted_at is null then 'ATIVO - correto' else 'ARQUIVADO - ERRADO!' end
  from public.empreendimentos_auria
 where id = 'c10f4604-508a-410d-af6e-3053c5485b2d'

union all
select 'C. o que NAO podia ser tocado (tem de estar intacto)',
       nome, left(id::text,8),
       (select count(*)::text || ' usuarios' from public.usuarios_auria u where u.empresa_id = g.id)
  from public.empresas_auria g
 where g.id = '23f3387f-ddfe-4a8f-b4c0-3383330b3ffe'

union all
--  De quebra: o 139 foi corrigido convertendo auria_emails_equipe de NOME para
--  ID. Três arquivos antigos do repo ainda têm a versão por nome, então quero
--  ver qual está viva — se aparecer 'CASA POR NOME', o 139 voltou.
select 'D. auria_emails_equipe casa por nome ou por id?',
       p.proname,
       case when p.prosrc like '%e.nome%' then 'CASA POR NOME - REGRESSAO!'
            else 'por id - correto' end,
       coalesce(array_to_string(p.proconfig,', '),'(SEM search_path)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'auria_emails_equipe%'

order by 1,2;

-- Esperado: A e B VAZIAS (nenhum nome repetido sobrou), C mostrando o ativo e
-- o Grupo Diagonal real com 7 usuarios, D dizendo 'por id - correto'.
