-- ============================================================================
--  ITEM 74b — tamanho do .frag (modelo 3D convertido, guardado no R2) passa a
--  ser gravado e somado no painel do CEO › Uso & armazenamento.
--  1) coluna frag_bytes; 2) RPC ceo_uso soma frag_bytes no R2 (rode DEPOIS o
--  supabase_ceo_uso.sql inteiro, que já vem atualizado). Os .frag antigos são
--  medidos pelo botão "Medir .frag" no painel do CEO (HEAD no R2). Reaplicável.
-- ============================================================================
alter table public.cde_arquivo_auria add column if not exists frag_bytes bigint;
select 'cde_arquivo_auria.frag_bytes' as item, exists(select 1 from information_schema.columns where table_name='cde_arquivo_auria' and column_name='frag_bytes') as ok;
