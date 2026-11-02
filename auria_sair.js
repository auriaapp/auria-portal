/* auria_sair.js — botão "Sair" comum a todos os painéis (2026-11-02).
   Antes, sb.auth.signOut() sem opção encerrava a conta em TODOS os aparelhos
   (escopo global do Supabase): quem saía no celular caía no computador sem aviso,
   e a página aberta lá passava a dar "permission denied". Agora a pessoa escolhe:
     • Sair deste aparelho      → signOut({ scope:'local' })
     • Sair de todos os aparelhos → signOut({ scope:'global' })  (perdeu o celular, PC de outra pessoa)
   Uso:  AuriaSair.perguntar(sb, () => location.replace('./'))
   O callback roda depois do signOut (limpeza da página + redirecionamento).
   Saídas automáticas (papel errado, cadastro) usam sb.auth.signOut({ scope:'local' }) direto. */
(function(){
  const CSS = `
  .asr-ov{position:fixed;inset:0;z-index:99990;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit}
  .asr-box{background:#fff;color:#1E293B;border-radius:14px;width:100%;max-width:380px;box-shadow:0 24px 60px rgba(15,23,42,.35);overflow:hidden}
  .asr-hd{display:flex;align-items:center;gap:10px;padding:16px 18px 6px}
  .asr-hd img{width:26px;height:26px;object-fit:contain}
  .asr-hd b{font-size:15px;color:#1E3A5F}
  .asr-op{display:block;width:calc(100% - 28px);margin:8px 14px 0;text-align:left;border:1px solid #E2E8F0;border-radius:10px;background:#fff;padding:11px 13px;cursor:pointer;font:inherit;color:inherit}
  .asr-op:hover,.asr-op:focus-visible{border-color:#E8762B;outline:none;background:#FFF8F2}
  .asr-op b{display:block;font-size:13.5px;color:#1E3A5F}
  .asr-op span{display:block;font-size:12px;color:#64748B;margin-top:2px;line-height:1.4}
  .asr-op.um{border-color:#1E3A5F}
  .asr-ft{display:flex;justify-content:flex-end;padding:12px 14px 14px}
  .asr-ft button{border:0;background:none;color:#64748B;font:inherit;font-size:13px;cursor:pointer;padding:6px 10px;border-radius:8px}
  .asr-ft button:hover{background:#F1F5F9}
  .asr-msg{font-size:12px;color:#A32D2D;padding:6px 18px 0;min-height:0}
  .asr-btn{border:1px solid rgba(148,163,184,.55);background:transparent;color:inherit;font:inherit;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer;margin-left:8px}
  .asr-btn:hover{border-color:#E8762B}`;

  function estilo(){
    if (document.getElementById('asrCss')) return;
    const s = document.createElement('style'); s.id = 'asrCss'; s.textContent = CSS; document.head.appendChild(s);
  }

  function perguntar(sb, depois){
    estilo();
    const antigo = document.getElementById('asrOv'); if (antigo) antigo.remove();
    const ov = document.createElement('div'); ov.className = 'asr-ov'; ov.id = 'asrOv';
    ov.innerHTML = '<div class="asr-box" role="dialog" aria-modal="true" aria-labelledby="asrTit">'
      + '<div class="asr-hd"><img src="logo_symbol.png" alt="" onerror="this.remove()"><b id="asrTit">Sair do Auria</b></div>'
      + '<button class="asr-op um" data-esc="local"><b>Sair deste aparelho</b><span>Os outros aparelhos em que você entrou continuam conectados.</span></button>'
      + '<button class="asr-op" data-esc="global"><b>Sair de todos os aparelhos</b><span>Para quando perdeu o celular ou entrou num computador de outra pessoa. Os outros aparelhos saem em até 1 hora.</span></button>'
      + '<div class="asr-msg" id="asrMsg"></div>'
      + '<div class="asr-ft"><button data-esc="">Cancelar</button></div></div>';
    document.body.appendChild(ov);
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', tecla); };
    const tecla = e => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('keydown', tecla);
    ov.addEventListener('mousedown', e => { if (e.target === ov) fechar(); });
    ov.querySelectorAll('[data-esc]').forEach(b => b.addEventListener('click', async () => {
      const scope = b.dataset.esc;
      if (!scope){ fechar(); return; }
      ov.querySelectorAll('button').forEach(x => x.disabled = true);
      b.querySelector('b') && (b.querySelector('b').textContent = 'Saindo…');
      try { await sb.auth.signOut({ scope }); }
      catch (e){
        // sem rede: ao menos sai deste aparelho
        try { await sb.auth.signOut({ scope:'local' }); } catch (_){}
      }
      fechar();
      try { if (typeof depois === 'function') depois(); else location.replace('./'); } catch (_){ location.replace('./'); }
    }));
    setTimeout(() => { const p = ov.querySelector('.asr-op.um'); if (p) p.focus(); }, 0);
  }

  // Botão "Sair" no cabeçalho das páginas que não tinham (CDE, BI, cronogramas, padrões…).
  // Não aparece quando a página está embutida (iframe do App/painel ou ?embed=1): lá o Sair é o da página de fora.
  //   AuriaSair.botao({ sb, dentro:'header', apos:'#lnkVolta', classe:'hbtn' })
  function embutida(){
    try { if (window.self !== window.top) return true; } catch (_){ return true; }
    try { if (new URLSearchParams(location.search).get('embed') === '1') return true; } catch (_){}
    return document.body.classList.contains('embed');
  }
  function botao(o){
    o = o || {};
    if (!o.sb || embutida() || document.getElementById('asrBtn')) return null;
    const ref = o.apos && document.querySelector(o.apos), box = !ref && o.dentro && document.querySelector(o.dentro);
    if (!ref && !box) return null;
    estilo();
    const b = document.createElement('button');
    b.id = 'asrBtn'; b.type = 'button'; b.className = o.classe || 'asr-btn'; b.textContent = 'Sair'; b.title = 'Sair do Auria';
    if (o.estilo) b.style.cssText = o.estilo;
    b.addEventListener('click', () => perguntar(o.sb, o.depois || (() => location.replace('./'))));
    if (ref) ref.insertAdjacentElement('afterend', b); else box.appendChild(b);
    return b;
  }

  window.AuriaSair = { perguntar, botao };
})();
