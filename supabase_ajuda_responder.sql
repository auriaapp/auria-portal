-- ============================================================================
--  ITEM 71 — Responder pelo painel do CEO: a resposta (1) vai por e-mail para quem
--  perguntou, (2) opcionalmente vira FAQ promovida (a busca do assistente passa a
--  responder na hora) e (3) marca a pergunta como respondida. Reaplicável.
-- ============================================================================
alter table public.ajuda_pergunta_auria add column if not exists resposta_suporte text;
alter table public.ajuda_pergunta_auria add column if not exists respondida_em timestamptz;
alter table public.ajuda_pergunta_auria add column if not exists respondida_por uuid;

create or replace function public.ajuda_responder(p_pergunta uuid, p_resposta text, p_promover boolean default true, p_papeis text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q record; v_faq uuid; v_email text; v_nome text; v_corpo text; v_enviado boolean := false;
begin
  if public.minha_role_auria() <> 'super_admin' then raise exception 'Só o administrador do Auria responde pelo suporte.'; end if;
  if coalesce(trim(p_resposta),'') = '' then raise exception 'Escreva a resposta.'; end if;
  select * into q from public.ajuda_pergunta_auria where id = p_pergunta;
  if q is null then raise exception 'Pergunta não encontrada.'; end if;
  if p_papeis is not null and array_length(p_papeis,1) is null then p_papeis := null; end if;

  -- 1) FAQ promovida (a pergunta do usuário vira a pergunta da FAQ; papel de quem perguntou = sugestão já aplicada pelo painel)
  if coalesce(p_promover,true) then
    insert into public.ajuda_faq_auria (pergunta, resposta, papeis, origem_id, criado_por)
    values (left(trim(q.pergunta),500), left(trim(p_resposta),4000), p_papeis, q.id, auth.uid())
    returning id into v_faq;
  end if;

  -- 2) e-mail para quem perguntou (remetente = suporte do Auria; sem nome de pessoa)
  v_email := lower(coalesce(q.email, (select email from public.usuarios_auria where id = q.usuario_id)));
  if v_email is not null and v_email <> '' then
    select coalesce(nome,'') into v_nome from public.usuarios_auria where id = q.usuario_id;
    v_corpo := 'Olá'||case when v_nome <> '' then ', '||public.auria_esc(v_nome) else '' end||'. Você perguntou ao assistente do Auria:<br>'
            ||'<blockquote style="border-left:3px solid #E8960A;margin:8px 0;padding:6px 12px;color:#334155">'||public.auria_esc(q.pergunta)||'</blockquote>'
            ||'<b>Resposta do suporte:</b><br>'||replace(public.auria_esc(p_resposta), E'\n', '<br>')
            ||case when v_faq is not null then '<br><br><span style="color:#64748B;font-size:12px">Esta resposta também entrou na ajuda do sistema — o botão ? passa a responder isso na hora.</span>' else '' end;
    perform public.auria_send_email(array[v_email], 'Resposta do suporte do Auria — '||left(q.pergunta, 60),
      public.auria_email_shell('Suporte do Auria', 'Sua dúvida foi respondida', v_corpo, 'Abrir o Auria', 'https://auria.solutions/'),
      null, public.auria_suporte_email());
    v_enviado := true;
  end if;

  -- 3) marca como respondida
  update public.ajuda_pergunta_auria
     set resposta_suporte = left(trim(p_resposta),4000), respondida_em = now(), respondida_por = auth.uid()
   where id = p_pergunta;

  return jsonb_build_object('ok', true, 'faq_id', v_faq, 'email', v_email, 'enviado', v_enviado);
end $$;
grant execute on function public.ajuda_responder(uuid, text, boolean, text[]) to authenticated;
revoke execute on function public.ajuda_responder(uuid, text, boolean, text[]) from anon;

select 'ajuda_responder' as fn, exists(select 1 from pg_proc where proname='ajuda_responder') as ok;
