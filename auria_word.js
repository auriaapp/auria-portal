// ============================================================================
//  auria_word.js — leitor de Word (.docx) só-leitura
//  ----------------------------------------------------------------------------
//  docx-preview (Apache-2.0) converte o .docx em HTML no próprio navegador:
//  nada sai da máquina e macros não rodam (.docx não tem macro; .docm é recusado).
//  .doc antigo (binário) não é suportado — só baixar.
//  Uso:  AuriaWord.abrir({ url | bytes, codigo, titulo, faixa })
//        AuriaWord.ehWord('docx') → true
// ============================================================================
(function(){
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const js = src => new Promise((ok, erro) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => erro(new Error('não foi possível carregar o leitor de Word')); document.head.appendChild(sc); });
  async function carregar(){
    if (!window.JSZip) await js('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
    if (!window.docx) await js('https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js');
    return window.docx;
  }
  async function abrir(op){
    op = op || {};
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;z-index:9500;padding:16px';
    ov.innerHTML = '<div style="background:#fff;border-radius:12px;width:min(1000px,96vw);height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:inherit;color:#1E293B">'
      + '<div style="display:flex;gap:10px;align-items:center;padding:14px 18px 6px"><b style="flex:1;font-size:15px">' + (op.codigo ? '<span style="font-family:ui-monospace,Menlo,monospace;color:#1E3A5F">' + esc(op.codigo) + '</span> — ' : '') + esc(op.titulo || 'Documento') + '</b>'
      + '<button data-x style="border:1px solid #CBD5E1;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit">Fechar</button></div>'
      + (op.faixa ? '<div style="padding:0 18px 6px;font-size:11.5px;color:#B91C1C;font-weight:700">' + esc(op.faixa) + '</div>' : '')
      + '<div data-doc style="flex:1;overflow:auto;margin:0 18px 16px;border:1px solid #E2E8F0;border-radius:8px;background:#E2E8F0">Carregando…</div></div>';
    document.body.appendChild(ov);
    const q = s => ov.querySelector(s), fechar = () => { ov.remove(); document.removeEventListener('keydown', tecla); };
    const tecla = e => { if (e.key === 'Escape') fechar(); };
    q('[data-x]').onclick = fechar; ov.onclick = e => { if (e.target === ov) fechar(); }; document.addEventListener('keydown', tecla);
    try {
      const D = await carregar();
      let data = op.bytes;
      if (!data){ const u = typeof op.url === 'function' ? await op.url() : op.url; const r = await fetch(u); if (!r.ok) throw new Error('falha ao baixar (' + r.status + ')'); data = await r.arrayBuffer(); }
      const alvo = q('[data-doc]'); alvo.textContent = '';
      await D.renderAsync(data, alvo, null, { inWrapper:true, ignoreLastRenderedPageBreak:false, experimental:false, useBase64URL:true });
    } catch (e){ q('[data-doc]').textContent = 'Não foi possível abrir o documento: ' + (e.message || e); }
  }
  window.AuriaWord = { abrir, carregar, ehWord: ext => String(ext || '').toLowerCase() === 'docx' };
})();
