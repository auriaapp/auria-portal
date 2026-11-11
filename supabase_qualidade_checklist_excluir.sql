-- Excluir checklist de auditoria (pedido da Qualidade, 2026-11-10).
-- Exclusão lógica: ativo = false. A tela já lista só ativos; auditorias guardam
-- cópia própria dos itens (snapshot), então nada do que já foi planejado muda.
-- Grupo vem da própria linha (não do cliente) e só a Qualidade do grupo exclui.
create or replace function public.aud_checklist_excluir(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_grupo uuid;
begin
  select grupo_id into v_grupo from public.aud_checklist_auria where id = p_id and ativo;
  if v_grupo is null then raise exception 'Checklist não encontrado.'; end if;
  if not public.grupo_pode_editar(v_grupo, 'qualidade') then
    raise exception 'Só a Qualidade exclui checklists de auditoria.';
  end if;
  update public.aud_checklist_auria
     set ativo = false, atualizado_em = now(), atualizado_nome = public._it_nome()
   where id = p_id;
end $$;

revoke all on function public.aud_checklist_excluir(uuid) from public, anon;
grant execute on function public.aud_checklist_excluir(uuid) to authenticated;
