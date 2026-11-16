-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-16 — revisão do desenho/marcação (mockups/app_marcacao_propriedades.html):
--   nova ferramenta POLILINHA na régua. Os estilos novos (espessura, linha pontilhada/traço-ponto,
--   pontas, preenchimento, opacidade) vão dentro de `dados` (jsonb) e não pedem coluna.
-- Aplicado como migração marcacao_polilinha.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.analise_marcacao_auria drop constraint if exists analise_marcacao_auria_tipo_check;
alter table public.analise_marcacao_auria add constraint analise_marcacao_auria_tipo_check
  check (tipo in ('nuvem','chamada','balao','marcador','texto','carimbo','seta','linha','polilinha','retangulo','elipse','poligono','livre','cota','area','rastro'));

-- REVERSÃO (antes, apagar as polilinhas):
-- delete from public.analise_marcacao_auria where tipo = 'polilinha';
-- alter table public.analise_marcacao_auria drop constraint if exists analise_marcacao_auria_tipo_check;
-- alter table public.analise_marcacao_auria add constraint analise_marcacao_auria_tipo_check
--   check (tipo in ('nuvem','chamada','balao','marcador','texto','carimbo','seta','linha','retangulo','elipse','poligono','livre','cota','area','rastro'));
