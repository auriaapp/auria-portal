-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-16 — gabaritos em escala na régua de marcação (mockups/app_gabaritos_escala.html):
--   tipo novo 'gabarito' (porta de abrir esq./dir., lavatório, vaso). Medidas em METROS dentro de
--   `dados` ({g, w, dir, rot, cor, mpp}); o desenho usa a calibragem das cotas da prancha.
-- Aplicado como migração marcacao_gabarito.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.analise_marcacao_auria drop constraint if exists analise_marcacao_auria_tipo_check;
alter table public.analise_marcacao_auria add constraint analise_marcacao_auria_tipo_check
  check (tipo in ('nuvem','chamada','balao','marcador','texto','carimbo','seta','linha','polilinha','retangulo','elipse','poligono','livre','gabarito','cota','area','rastro'));

-- REVERSÃO (antes, apagar os gabaritos):
-- delete from public.analise_marcacao_auria where tipo = 'gabarito';
-- (recriar o check sem 'gabarito', como em supabase_marcacao_polilinha.sql)
