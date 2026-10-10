// ============================================================================
//  auria_planilha.js — leitor de planilha só-leitura (xlsx/xlsm/xls/csv/ods)
//  ----------------------------------------------------------------------------
//  SheetJS (Apache-2.0, gratuito) carregado só quando alguém abre uma planilha.
//  Uso:  AuriaPlanilha.abrir({ url | bytes, codigo, titulo, faixa })
//        url pode ser string ou função async que devolve a URL (link temporário).
//        AuriaPlanilha.ehPlanilha('xlsx') → true
// ============================================================================
(function(){
  const EXT = ['xlsx','xlsm','xls','csv','ods'];
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function carregar(){
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((ok, erro) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      sc.onload = () => ok(window.XLSX); sc.onerror = () => erro(new Error('não foi possível carregar o leitor de planilhas')); document.head.appendChild(sc); });
  }
  async function abrir(op){
    op = op || {};
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;z-index:9500;padding:16px';
    ov.innerHTML = '<div style="background:#fff;border-radius:12px;width:min(1280px,96vw);height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:inherit;color:#1E293B">'
      + '<div style="display:flex;gap:10px;align-items:center;padding:14px 18px 6px"><b style="flex:1;font-size:15px">' + (op.codigo ? '<span style="font-family:ui-monospace,Menlo,monospace;color:#1E3A5F">' + esc(op.codigo) + '</span> — ' : '') + esc(op.titulo || 'Planilha') + '</b>'
      + '<button data-x style="border:1px solid #CBD5E1;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit">Fechar</button></div>'
      + (op.faixa ? '<div style="padding:0 18px;font-size:11.5px;color:#B91C1C;font-weight:700">' + esc(op.faixa) + '</div>' : '')
      + '<div data-abas style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 18px"></div>'
      + '<div data-pl style="flex:1;overflow:auto;margin:0 18px 16px;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;padding:6px">Carregando…</div></div>';
    document.body.appendChild(ov);
    const q = s => ov.querySelector(s), fechar = () => { ov.remove(); document.removeEventListener('keydown', esc_); };
    const esc_ = e => { if (e.key === 'Escape') fechar(); };
    q('[data-x]').onclick = fechar; ov.onclick = e => { if (e.target === ov) fechar(); }; document.addEventListener('keydown', esc_);
    try {
      const XL = await carregar();
      let data = op.bytes;
      if (!data){ const u = typeof op.url === 'function' ? await op.url() : op.url; const r = await fetch(u); if (!r.ok) throw new Error('falha ao baixar (' + r.status + ')'); data = new Uint8Array(await r.arrayBuffer()); }
      const wb = XL.read(data, { type:'array' });
      const mostra = nome => {
        ov.querySelectorAll('[data-abas] button').forEach(b => { const on = b.dataset.n === nome; b.style.background = on ? '#E8762B' : '#fff'; b.style.color = on ? '#fff' : '#1E293B'; b.style.borderColor = on ? '#E8762B' : '#CBD5E1'; });
        q('[data-pl]').innerHTML = XL.utils.sheet_to_html(wb.Sheets[nome], { editable:false, header:'', footer:'' }).replace(/<table/, '<table style="border-collapse:collapse" data-t');
        q('[data-pl]').querySelectorAll('td').forEach(td => { td.style.border = '1px solid #E2E8F0'; td.style.padding = '3px 6px'; td.style.whiteSpace = 'nowrap'; });
      };
      q('[data-abas]').innerHTML = wb.SheetNames.map(n => '<button data-n="' + esc(n) + '" style="border:1px solid #CBD5E1;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer;font-family:inherit">' + esc(n) + '</button>').join('');
      ov.querySelectorAll('[data-abas] button').forEach(b => b.onclick = () => mostra(b.dataset.n));
      mostra(wb.SheetNames[0]);
    } catch (e){ q('[data-pl]').textContent = 'Não foi possível abrir a planilha: ' + (e.message || e); }
  }
  window.AuriaPlanilha = { abrir, carregar, ehPlanilha: ext => EXT.includes(String(ext || '').toLowerCase()) };
})();
