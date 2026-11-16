-- ═══════════════════════════════════════════════════════════════════════════
-- Item 110 fase 2 (2026-11-15): "Virar apontamento" (mockups/app_marcacao_prancha.html, seção 3).
--   • a marcação convertida SAI da análise e vira desenho do apontamento;
--     na análise fica um RASTRO (tipo 'rastro', dados {apt, titulo, marcs}) que mostra
--     o status do apontamento ao vivo e guarda as marcações originais para desfazer;
--   • o apontamento guarda a análise onde nasceu (link "abrir a análise onde nasceu",
--     visível só para quem enxerga a análise — a RLS de analises_auria decide).
-- Aplicado como migração marcacao_virar_apontamento_110f2.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.analise_marcacao_auria drop constraint if exists analise_marcacao_auria_tipo_check;
alter table public.analise_marcacao_auria add constraint analise_marcacao_auria_tipo_check
  check (tipo in ('nuvem','chamada','balao','marcador','texto','carimbo','seta','linha','retangulo','elipse','poligono','livre','cota','area','rastro'));
alter table public.apontamentos add column if not exists analise_origem_id uuid references public.analises_auria(id) on delete set null;

-- REVERSÃO:
-- alter table public.apontamentos drop column if exists analise_origem_id;
-- delete from public.analise_marcacao_auria where tipo = 'rastro';  -- (antes de voltar o check)
