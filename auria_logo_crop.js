/* ============================================================================
 *  Auria — recorte/reenquadramento de logo (item 85)
 *
 *  AuriaLogoCrop.abrir(file, opts) -> Promise<File|null>
 *    Abre um modal com a imagem dentro do retângulo em que ela realmente vai
 *    aparecer (cards, CDE, e-mails). O usuário arrasta para posicionar, usa a
 *    roda/slider para o zoom e confirma; devolve um PNG quadrado pronto para o
 *    upload (mesma interface de File, então os caminhos de gravação não mudam).
 *    Cancelar devolve null.
 *
 *  Sem dependências: canvas puro. PNG preserva transparência — logo com fundo
 *  transparente continua transparente depois do recorte.
 *
 *  opts: { lado:512 (px do arquivo final), titulo:'Logo do empreendimento' }
 * ========================================================================== */
(function(){
  const CSS = `
  .alc-bg{position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:99000;display:flex;
    align-items:center;justify-content:center;padding:20px}
  .alc-card{background:#fff;border-radius:14px;padding:18px;width:min(420px,96vw);
    box-shadow:0 20px 60px rgba(8,14,26,.35);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0F172A}
  .alc-card h3{margin:0 0 3px;font-size:15px;color:#1E3A5F}
  .alc-sub{font-size:12px;color:#64748B;margin-bottom:12px}
  .alc-palco{position:relative;width:100%;aspect-ratio:1;border-radius:12px;overflow:hidden;
    background:#F1F5F9;background-image:linear-gradient(45deg,#E2E8F0 25%,transparent 25%,transparent 75%,#E2E8F0 75%),
      linear-gradient(45deg,#E2E8F0 25%,transparent 25%,transparent 75%,#E2E8F0 75%);
    background-size:16px 16px;background-position:0 0,8px 8px;cursor:grab;touch-action:none}
  .alc-palco.arrastando{cursor:grabbing}
  .alc-palco canvas{display:block;width:100%;height:100%}
  .alc-moldura{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 0 2px rgba(232,150,10,.9);border-radius:12px}
  .alc-moldura::after{content:'';position:absolute;inset:12%;border:1px dashed rgba(232,150,10,.5);border-radius:8px}
  .alc-lin{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:12px;color:#334155}
  .alc-lin input[type=range]{flex:1;accent-color:#E8960A}
  .alc-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}
  .alc-b{border:1px solid #E2E8F0;background:#fff;color:#334155;border-radius:8px;padding:7px 13px;
    font-size:12.5px;cursor:pointer;font-family:inherit}
  .alc-b:hover{border-color:#E8960A}
  .alc-b.pri{background:#E8960A;border-color:#E8960A;color:#231703;font-weight:700}
  .alc-b.link{border:none;background:none;color:#64748B;padding:7px 4px}
  @media (prefers-color-scheme: dark){
    .alc-card{background:#141C2B;color:#E8EEF6}
    .alc-card h3{color:#7FB3D3}
    .alc-b{background:#1B2536;border-color:#26324A;color:#C2CFDF}
  }`;

  let estiloPosto = false;
  function porEstilo(){
    if(estiloPosto) return; estiloPosto = true;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  }

  function carregarImagem(file){
    return new Promise((ok, erro)=>{
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = ()=>{ URL.revokeObjectURL(url); ok(img); };
      img.onerror = ()=>{ URL.revokeObjectURL(url); erro(new Error('Não consegui ler a imagem.')); };
      img.src = url;
    });
  }

  function abrir(file, opts){
    opts = opts || {};
    const LADO = opts.lado || 512;
    porEstilo();
    return carregarImagem(file).then(img=>new Promise(resolve=>{
      const bg = document.createElement('div'); bg.className='alc-bg';
      bg.innerHTML =
        '<div class="alc-card">'
        + '<h3>'+(opts.titulo||'Enquadrar a logo')+'</h3>'
        + '<div class="alc-sub">Arraste para posicionar e use o zoom. O que estiver dentro do quadro é o que aparece nos cards, no CDE e nos e-mails.</div>'
        + '<div class="alc-palco" id="alcPalco"><canvas id="alcCv"></canvas><div class="alc-moldura"></div></div>'
        + '<div class="alc-lin"><span>Zoom</span><input type="range" id="alcZoom" min="10" max="400" value="100"><span id="alcZoomVal" style="width:44px;text-align:right">100%</span></div>'
        + '<div class="alc-acts">'
        +   '<button class="alc-b link" id="alcReset">Reenquadrar</button>'
        +   '<button class="alc-b" id="alcCancel">Cancelar</button>'
        +   '<button class="alc-b pri" id="alcOk">Usar esta imagem</button>'
        + '</div></div>';
      document.body.appendChild(bg);

      const palco = bg.querySelector('#alcPalco');
      const cv    = bg.querySelector('#alcCv');
      const zoom  = bg.querySelector('#alcZoom');
      const zval  = bg.querySelector('#alcZoomVal');
      const ctx   = cv.getContext('2d');

      // O canvas de tela trabalha em LADO (o mesmo do arquivo final): o que se vê
      // é exatamente o que se grava, sem conta de conversão entre dois espaços.
      cv.width = LADO; cv.height = LADO;

      // "contain" inicial: a logo inteira aparece, com folga de 6%
      const base = Math.min(LADO/img.width, LADO/img.height) * 0.94;
      let escala = base, dx = 0, dy = 0;   // dx/dy = deslocamento do CENTRO, em px do canvas

      function desenhar(){
        ctx.clearRect(0,0,LADO,LADO);
        const w = img.width*escala, h = img.height*escala;
        ctx.drawImage(img, (LADO-w)/2 + dx, (LADO-h)/2 + dy, w, h);
      }
      function setZoom(pct, ancora){
        const novo = base * (pct/100);
        if(ancora){ // mantém o ponto sob o cursor parado ao usar a roda
          const k = novo/escala; dx = ancora.x - (ancora.x - dx)*k; dy = ancora.y - (ancora.y - dy)*k;
        }
        escala = novo; zval.textContent = pct+'%'; desenhar();
      }

      desenhar();

      // arrastar
      let arrastando=false, px=0, py=0;
      const paraCanvas = (ev)=>{ const r=palco.getBoundingClientRect(); return { x:(ev.clientX-r.left)*(LADO/r.width) - LADO/2, y:(ev.clientY-r.top)*(LADO/r.height) - LADO/2 }; };
      palco.addEventListener('pointerdown', e=>{ arrastando=true; palco.classList.add('arrastando'); palco.setPointerCapture(e.pointerId); px=e.clientX; py=e.clientY; });
      palco.addEventListener('pointermove', e=>{
        if(!arrastando) return;
        const r=palco.getBoundingClientRect(), f=LADO/r.width;
        dx += (e.clientX-px)*f; dy += (e.clientY-py)*f; px=e.clientX; py=e.clientY; desenhar();
      });
      const solta = ()=>{ arrastando=false; palco.classList.remove('arrastando'); };
      palco.addEventListener('pointerup', solta); palco.addEventListener('pointercancel', solta);
      palco.addEventListener('wheel', e=>{
        e.preventDefault();
        const passo = e.deltaY<0 ? 8 : -8;
        const pct = Math.max(10, Math.min(400, Math.round(+zoom.value + passo)));
        zoom.value = pct; setZoom(pct, paraCanvas(e));
      }, {passive:false});
      zoom.addEventListener('input', ()=>setZoom(+zoom.value));

      const fechar = (res)=>{ bg.remove(); document.removeEventListener('keydown', tecla); resolve(res); };
      const tecla = (e)=>{ if(e.key==='Escape') fechar(null); };
      document.addEventListener('keydown', tecla);

      bg.querySelector('#alcReset').onclick = ()=>{ escala=base; dx=0; dy=0; zoom.value=100; zval.textContent='100%'; desenhar(); };
      bg.querySelector('#alcCancel').onclick = ()=>fechar(null);
      bg.addEventListener('mousedown', e=>{ if(e.target===bg) fechar(null); });
      bg.querySelector('#alcOk').onclick = ()=>{
        cv.toBlob(b=>{
          if(!b) return fechar(null);
          const nome = (file.name||'logo').replace(/\.[^.]+$/,'') + '.png';
          let f; try{ f = new File([b], nome, { type:'image/png' }); }
          catch(_){ f = b; f.name = nome; }     // navegador antigo: Blob com nome serve para o upload
          fechar(f);
        }, 'image/png');
      };
    }));
  }

  window.AuriaLogoCrop = { abrir };
})();
