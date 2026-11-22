-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-22 — backlog do App itens 126/127 (mockups/app_barra_desenho_v2.html, aprovado):
--   símbolos técnicos (nível, corte, vista, eixo, chamada de detalhe, norte, revisão) e
--   medidas novas (cotas encadeadas, ângulo, contagem). A cota horizontal/vertical continua
--   tipo 'cota' (dados.hv). Aplicado como migração marcacao_simbolos_medidas.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.analise_marcacao_auria drop constraint if exists analise_marcacao_auria_tipo_check;
alter table public.analise_marcacao_auria add constraint analise_marcacao_auria_tipo_check
  check (tipo in ('nuvem','chamada','balao','marcador','texto','carimbo','seta','linha','polilinha','retangulo','elipse','poligono','livre','gabarito','cota','area','rastro',
                  'nivel','corte','vista','eixo','detalhe','norte','revisao','cadeia','angulo','contagem'));

-- REVERSÃO (só se não houver marcações dos tipos novos):
-- alter table public.analise_marcacao_auria drop constraint if exists analise_marcacao_auria_tipo_check;
-- alter table public.analise_marcacao_auria add constraint analise_marcacao_auria_tipo_check
--   check (tipo in ('nuvem','chamada','balao','marcador','texto','carimbo','seta','linha','polilinha','retangulo','elipse','poligono','livre','gabarito','cota','area','rastro'));
