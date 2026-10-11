-- IT ganhou revisão nova → os modelos de FVS ligados a ela ficam marcados
-- "revisar" (com a revisão da IT) e a Qualidade recebe e-mail com a lista.
-- A marca some quando a Qualidade salva o modelo conferido (padroes_grupo.html).
alter table public.fvs_modelo_auria add column if not exists revisar_it_rev text;
alter table public.fvs_modelo_auria add column if not exists revisar_desde timestamptz;

create or replace function public.notif_it_fvs_revisar()
returns trigger language plpgsql security definer set search_path to 'public','extensions' as $$
declare i record; lista text; n int; dest text[];
begin
  if not NEW.vigente then return NEW; end if;
  -- só quando já existia revisão anterior (a 1ª publicação não pede revisão de FVS)
  if not exists (select 1 from public.grupo_it_revisao_auria r where r.it_id = NEW.it_id and r.id <> NEW.id) then return NEW; end if;
  select * into i from public.grupo_it_auria where id = NEW.it_id;
  update public.fvs_modelo_auria set revisar_it_rev = NEW.revisao, revisar_desde = now()
   where it_id = NEW.it_id and grupo_id = i.grupo_id;
  get diagnostics n = row_count;
  if n = 0 then return NEW; end if;
  select string_agg(public.auria_email_row(m.codigo, public.auria_esc(m.servico) || case when m.rascunho then ' (rascunho)' else '' end), '' order by m.codigo)
    into lista from public.fvs_modelo_auria m where m.it_id = NEW.it_id and m.grupo_id = i.grupo_id;
  select array_agg(u.email) into dest from public.usuarios_auria u
   where u.empresa_id = i.grupo_id and u.role = 'setor' and u.setor_area = 'qualidade' and coalesce(u.ativo,true);
  if dest is null then return NEW; end if;
  perform public.auria_send_email(dest, 'Auria — revisar FVS: '||i.codigo||' passou para a rev. '||NEW.revisao,
    public.auria_email_shell('FVS a revisar', i.codigo||' — '||i.titulo,
      '<p style="margin:0 0 12px;color:#334155;font-size:14px">A IT foi revisada (rev. <b>'||public.auria_esc(NEW.revisao)||'</b>'
      ||coalesce(' — '||public.auria_esc(NEW.observacao),'')||'). Confira se os critérios destes '||n||' modelo(s) de FVS continuam valendo:</p>'
      ||'<table style="width:100%;border-collapse:collapse;margin:2px 0 16px">'||coalesce(lista,'')||'</table>',
      'Abrir os modelos de FVS', 'https://auria.solutions/padroes_grupo.html?aba=qualidade'));
  return NEW;
exception when others then return NEW;
end $$;
drop trigger if exists trg_it_fvs_revisar on public.grupo_it_revisao_auria;
create trigger trg_it_fvs_revisar after insert on public.grupo_it_revisao_auria
  for each row execute function public.notif_it_fvs_revisar();
