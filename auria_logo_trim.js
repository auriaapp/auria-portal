/* ============================================================================
 *  Auria — corte automático das margens das logos nos cabeçalhos horizontais
 *
 *  O recortador (auria_logo_crop.js) salva toda logo num quadrado; uma logo
 *  horizontal fica com muito branco em cima/embaixo e encolhe na moldura do
 *  cabeçalho. Aqui, só na EXIBIÇÃO, descartamos as margens brancas/transparentes
 *  e a moldura assume a proporção real da logo (mesma altura). O arquivo no
 *  Storage não muda — lugares com moldura quadrada continuam iguais.
 *
 *  Automático: observa as imagens dentro de SELETOR (inclusive as inseridas
 *  depois via innerHTML / troca de src). Falha silenciosa (CORS, imagem sem
 *  margem): a imagem original fica como está.
 * ========================================================================== */
(function(){
  const SELETOR = '.glogo img, .tb-logo img, .cdh-logo img, header .grupo img, .elogo img, .pjh-logo img';
  const FEITO = new WeakMap();   // img -> src já processado (o dataURL gerado)

  function bbox(ctx, w, h){
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = (y*w + x)*4, a = d[i+3];
      if (a < 20) continue;                                     // transparente
      if (d[i] > 237 && d[i+1] > 237 && d[i+2] > 237) continue;  // branco
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : {x0, y0, x1, y1};
  }

  function cortar(img){
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:') || FEITO.get(img) === src) return;
    FEITO.set(img, src);
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      try{
        const w = im.naturalWidth, h = im.naturalHeight; if (!w || !h) return;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d', {willReadFrequently:true}); ctx.drawImage(im, 0, 0);
        const b = bbox(ctx, w, h); if (!b) return;
        const pad = Math.round((b.y1 - b.y0 + 1) * 0.12);
        const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad);
        const x1 = Math.min(w, b.x1 + 1 + pad), y1 = Math.min(h, b.y1 + 1 + pad);
        if ((x1 - x0) * (y1 - y0) > w * h * 0.9) return;          // quase sem margem
        const o = document.createElement('canvas'); o.width = x1 - x0; o.height = y1 - y0;
        o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
        if (img.getAttribute('src') !== src) return;               // trocou no meio
        const url = o.toDataURL('image/png');
        FEITO.set(img, url);
        img.src = url;
      }catch(e){}                                                  // CORS: fica a original
    };
    im.src = src;
  }

  function varrer(raiz){
    (raiz.querySelectorAll ? raiz : document).querySelectorAll(SELETOR).forEach(cortar);
    if (raiz.matches && raiz.matches(SELETOR)) cortar(raiz);
  }

  function iniciar(){
    varrer(document);
    new MutationObserver(ms => ms.forEach(m => {
      if (m.type === 'attributes') { if (m.target.matches && m.target.matches(SELETOR)) cortar(m.target); }
      else m.addedNodes.forEach(n => { if (n.nodeType === 1) varrer(n); });
    })).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['src']});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
