// ============================================================================
//  auria_pdfview.js — visualizador de PDF dentro do Auria (ITs e documentos)
//  ----------------------------------------------------------------------------
//  Abre o PDF numa janela do próprio sistema, no estilo do CDE (cabeçalho navy,
//  código em mono, barra de zoom/página), em vez de mandar a pessoa para outra
//  aba. Páginas em rolagem contínua, desenhadas por pdf.js só quando aparecem
//  na tela (documento grande não trava o celular).
//
//  Uso:  AuriaPDF.abrir({ url, codigo, titulo, sub })
//        url pode ser string ou função async que devolve a URL (link temporário
//        do R2 é pedido só na hora de abrir).
//  Sem "Baixar": a IT é para consulta na obra; a revisão vigente está sempre aqui.
// ============================================================================
(function(){
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  let estado = null;

  function carregarPdfjs(){
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((ok, erro) => {
      const s = document.createElement('script'); s.src = PDFJS;
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; ok(window.pdfjsLib); };
      s.onerror = () => erro(new Error('não foi possível carregar o leitor de PDF'));
      document.head.appendChild(s);
    });
  }
  function css(){
    if (document.getElementById('apvCss')) return;
    const st = document.createElement('style'); st.id = 'apvCss';
    st.textContent = `
#apv{position:fixed;inset:0;z-index:9500;background:#1B2536;display:flex;flex-direction:column;font-family:"Segoe UI",system-ui,Arial}
#apv .apv-h{background:linear-gradient(90deg,#0B1220,#152036);color:#fff;display:flex;align-items:center;gap:12px;padding:9px 14px;border-bottom:2px solid #E8960A;flex-wrap:wrap}
#apv .apv-cod{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-weight:700;font-size:13px;color:#fff;background:rgba(255,255,255,.08);border-radius:6px;padding:3px 8px;white-space:nowrap}
#apv .apv-t{flex:1;min-width:120px}
#apv .apv-t b{display:block;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#apv .apv-t span{font-size:11.5px;color:#9DB3CA}
#apv .apv-bar{display:flex;align-items:center;gap:6px}
#apv button{background:#1B2942;border:1px solid #2A3850;color:#C9D6E4;border-radius:8px;padding:5px 10px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;min-width:32px}
#apv button:hover{border-color:#E8960A}
#apv .apv-z,#apv .apv-p{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:12px;color:#C9D6E4;min-width:46px;text-align:center}
#apv .apv-x{font-size:16px;line-height:1}
#apv .apv-c{flex:1;overflow:auto;padding:18px 10px 40px;display:flex;flex-direction:column;align-items:center;gap:14px}
#apv .apv-pg{background:#fff;box-shadow:0 6px 30px rgba(0,0,0,.45);position:relative}
#apv .apv-pg canvas{display:block;width:100%;height:100%}
#apv .apv-msg{color:#C9D6E4;font-size:13px;margin-top:40px}
@media (max-width:640px){ #apv .apv-t span{display:none} #apv .apv-c{padding:10px 4px 30px} }`;
    document.head.appendChild(st);
  }

  async function abrir(op){
    css(); fechar();
    const el = document.createElement('div'); el.id = 'apv';
    el.innerHTML = '<div class="apv-h">' + (op.codigo ? '<span class="apv-cod"></span>' : '') + '<div class="apv-t"><b></b><span></span></div>'
      + '<div class="apv-bar"><button data-a="menos" title="Diminuir">−</button><span class="apv-z">—</span><button data-a="mais" title="Aumentar">+</button>'
      + '<button data-a="ajustar" title="Ajustar à largura">⤢</button><span class="apv-p">—</span>'
      + '<button class="apv-x" data-a="fechar" title="Fechar (Esc)">×</button></div></div>'
      + '<div class="apv-c"><div class="apv-msg">Abrindo o documento…</div></div>';
    if (op.codigo) el.querySelector('.apv-cod').textContent = op.codigo;
    el.querySelector('.apv-t b').textContent = op.titulo || 'Documento';
    el.querySelector('.apv-t span').textContent = op.sub || '';
    document.body.appendChild(el);
    el.querySelector('.apv-bar').addEventListener('click', ev => {
      const a = ev.target.closest('button'); if (!a) return;
      ({ menos:() => zoom(estado.escala / 1.25), mais:() => zoom(estado.escala * 1.25), ajustar:() => zoom(null), fechar }[a.dataset.a] || (() => {}))();
    });
    const corpo = el.querySelector('.apv-c');
    estado = { el, corpo, doc:null, escala:null, base:1, obs:null, job:0 };
    try {
      const lib = await carregarPdfjs();
      const url = typeof op.url === 'function' ? await op.url() : op.url;
      estado.doc = await lib.getDocument({ url }).promise;
      corpo.innerHTML = '';
      const p1 = await estado.doc.getPage(1), vp = p1.getViewport({ scale:1 });
      estado.base = vp.width;
      corpo.addEventListener('scroll', paginaAtual, { passive:true });
      zoom(null);
    } catch (e){
      corpo.innerHTML = '<div class="apv-msg">Não foi possível abrir: ' + String(e && e.message || e).replace(/</g,'&lt;') + '</div>';
    }
  }
  // escala null = ajustar à largura disponível
  async function zoom(esc){
    if (!estado || !estado.doc) return;
    const largura = Math.max(200, estado.corpo.clientWidth - 44);   // margem do quadro + barra de rolagem
    const ajuste = Math.min(largura / estado.base, 2.2);
    estado.escala = Math.max(0.3, Math.min(5, esc == null ? ajuste : esc));
    estado.el.querySelector('.apv-z').textContent = Math.round(estado.escala * 100) + '%';
    const job = ++estado.job, frac = estado.corpo.scrollHeight ? estado.corpo.scrollTop / estado.corpo.scrollHeight : 0;
    if (estado.obs) estado.obs.disconnect();
    estado.corpo.innerHTML = '';
    estado.obs = new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting) desenhar(en.target, job); }), { root:estado.corpo, rootMargin:'600px 0px' });
    for (let n = 1; n <= estado.doc.numPages; n++){
      const pg = await estado.doc.getPage(n); if (job !== estado.job) return;
      const vp = pg.getViewport({ scale:estado.escala });
      const d = document.createElement('div'); d.className = 'apv-pg'; d.dataset.n = n;
      d.style.width = Math.floor(vp.width) + 'px'; d.style.height = Math.floor(vp.height) + 'px';
      estado.corpo.appendChild(d); estado.obs.observe(d);
    }
    estado.corpo.scrollTop = frac * estado.corpo.scrollHeight;
    paginaAtual();
  }
  async function desenhar(div, job){
    if (div.dataset.ok === String(job)) return; div.dataset.ok = String(job);
    const pg = await estado.doc.getPage(+div.dataset.n); if (job !== estado.job) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), vp = pg.getViewport({ scale:estado.escala * dpr });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await pg.render({ canvasContext:c.getContext('2d'), viewport:vp }).promise;
    if (job !== estado.job) return;
    div.innerHTML = ''; div.appendChild(c);
  }
  function paginaAtual(){
    if (!estado || !estado.doc) return;
    const pgs = estado.corpo.querySelectorAll('.apv-pg'), meio = estado.corpo.scrollTop + estado.corpo.clientHeight / 3;
    let n = 1; pgs.forEach(p => { if (p.offsetTop <= meio) n = +p.dataset.n; });
    estado.el.querySelector('.apv-p').textContent = n + ' / ' + estado.doc.numPages;
  }
  function fechar(){
    if (!estado) { const v = document.getElementById('apv'); if (v) v.remove(); return; }
    if (estado.obs) estado.obs.disconnect();
    try { estado.doc && estado.doc.destroy(); } catch (_){}
    estado.el.remove(); estado = null;
  }
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && document.getElementById('apv')) fechar(); });
  window.addEventListener('resize', () => { if (estado && estado.doc) { clearTimeout(window._apvR); window._apvR = setTimeout(() => zoom(null), 200); } });
  window.AuriaPDF = { abrir, fechar, carregarPdfjs };
})();
