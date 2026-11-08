// ============================================================================
//  auria_fvs_dock.js — ficha de FVS dividida com o modelo (App Obra)
//  ----------------------------------------------------------------------------
//  A ficha deixa de ser pop-up: abre ao lado do modelo, com abas embaixo (como a
//  barra do CDE) e pergunta antes de sair sem salvar. Salvar, enviar, aprovar e
//  reprovar continuam nas funções do app_obra.html; este arquivo só muda ONDE a
//  ficha aparece e acrescenta Peças, IT e Concreto.
//
//  Como funciona: fvsFicha() monta a janela com segOv() e as camadas seguintes
//  procuram "#segOv .ft". Para reaproveitar tudo sem reescrever, o painel recebe
//  o id segOv só enquanto a ficha é desenhada (emDock) e os estilos #segOv são
//  copiados para #fvsDockHost.
// ============================================================================
(function(){
  if (typeof fvsFicha !== 'function') return;
  const D = { abas:[], at:null, sel:false, todos:{}, cat:null, catChave:'', pav:null, soPav:true, nomes:{} };
  const GRUPOS = [['Pilares',/^IFCCOLUMN/],['Vigas',/^IFCBEAM/],['Lajes',/^IFCSLAB$/],['Paredes',/^IFCWALL/],['Escadas',/^IFCSTAIR/],
                  ['Fundações',/^IFCFOOTING|^IFCPILE/],['Portas e janelas',/^IFCDOOR|^IFCWINDOW/],['Revestimentos',/^IFCCOVERING/]];
  const ROTULO = { ver:'Verificação', pec:'Peças', it:'IT', conc:'Concreto', his:'Histórico' };
  const ehCelular = () => window.matchMedia('(max-width:760px)').matches;
  const ehConcreto = t => t && t.tipo !== 'seguranca' && /concret/i.test(t.servico || '') && !/argamassa/i.test(t.servico || '');
  const atual = () => D.abas.find(t => t.k === D.at) || null;
  const nPecas = t => (t.elementos || []).reduce((s, g) => s + g.ids.length, 0);
  const jRasc = r => JSON.stringify((r || []).map(x => [x.resultado, (x.obs || '').trim(), (x.fotos || []).length, x.gravidade || null]));
  const jVinc = t => JSON.stringify([(t.elementos || []).filter(g => g.ids.length).map(g => [g.cde_arquivo_id, g.ids.slice().sort((a, b) => a - b),
      Object.keys(g.trechos || {}).sort().map(k => [k, g.trechos[k].frac, (g.trechos[k].desc || '').trim()])]), t.conc || null]);
  // ── trecho da peça: a obra executa a peça em trechos; o modelo tem a peça inteira ──
  // elementos[g].trechos[id] = { frac, desc }; peça sem trecho = executada inteira.
  const trechoDe = (t, arq, id) => { const g = (t.elementos || []).find(x => x.cde_arquivo_id === arq); return g && g.trechos ? g.trechos[id] || null : null; };
  // trechos da mesma peça em OUTRAS fichas do mesmo serviço (reprovada não conta)
  function trechosAntes(t, arq, id){
    return FVS_INSP.filter(x => x.id !== t.id && x.modelo_id === t.modId && x.situacao !== 'reprovada').map(x => {
      const g = (x.elementos || []).find(e => e.cde_arquivo_id === arq && (e.ids || []).includes(id)); if (!g) return null;
      const tr = g.trechos && g.trechos[id];
      return { cod:x.codigo, data:(x.aberta_em || '').slice(0, 10), frac:tr ? +tr.frac || 0 : 1, desc:tr ? tr.desc || '' : 'peça inteira' };
    }).filter(Boolean).sort((a, b) => a.data < b.data ? -1 : 1);
  }
  function somaTrechos(t, arq, id){ const tr = trechoDe(t, arq, id); return trechosAntes(t, arq, id).reduce((s, a) => s + a.frac, 0) + (tr ? +tr.frac || 0 : 1); }
  const fracTxt = f => ({ 0.25:'¼', 0.5:'½', 0.75:'¾' })[Math.round(f * 100) / 100] || (Math.round(f * 100) + '%');

  // ── estrutura da página ───────────────────────────────────────────────────
  function montar(){
    if ($('fvsDock')) return;
    const main = document.querySelector('.main'), dir = $('sideRight'); if (!main) return;
    const dv = document.createElement('div'); dv.id = 'fvsDockDiv'; dv.title = 'Arraste para ajustar';
    const dk = document.createElement('section'); dk.id = 'fvsDock'; dk.innerHTML = '<div id="fvsDockHost"></div>';
    main.insertBefore(dv, dir); main.insertBefore(dk, dir);
    const ab = document.createElement('div'); ab.id = 'fvsAbas'; main.parentNode.insertBefore(ab, main.nextSibling);
    estilos();
    const host = $('fvsDockHost');
    ['input','change','click'].forEach(ev => host.addEventListener(ev, () => setTimeout(marcar, 0)));
    let on = false;
    dv.addEventListener('pointerdown', e => { on = true; dv.setPointerCapture(e.pointerId); });
    dv.addEventListener('pointermove', e => { if (!on) return; const r = main.getBoundingClientRect(); dk.style.flexBasis = Math.max(360, Math.min(r.width - 320, r.right - e.clientX)) + 'px'; });
    dv.addEventListener('pointerup', () => { if (on){ on = false; window.dispatchEvent(new Event('resize')); } });
  }
  function estilos(){
    const linhas = [];
    const copia = (regras, acc) => { for (const r of regras){
      if (r.cssRules && r.media){ const d = []; copia(r.cssRules, d); if (d.length) acc.push('@media ' + r.media.mediaText + '{' + d.join('') + '}'); continue; }
      if (!r.selectorText || !r.selectorText.includes('#segOv')) continue;
      const sel = r.selectorText.split(',').map(s => s.trim()).filter(s => s.includes('#segOv') && !/^#segOv(\.on)?$/.test(s)).map(s => s.replace(/#segOv/g, '#fvsDockHost'));
      if (sel.length) acc.push(sel.join(',') + '{' + r.style.cssText + '}'); } };
    for (const f of document.styleSheets){ try { copia(f.cssRules, linhas); } catch (_){} }
    const st = document.createElement('style'); st.id = 'fvsDockCss';
    st.textContent = linhas.join('\n') + `
#fvsDock{display:none;flex:0 0 44%;min-width:360px;max-width:calc(100% - 320px);min-height:0;background:#fff;color:#0F172A}
#fvsDockDiv{display:none;width:6px;flex:none;background:#E2E8F0;cursor:col-resize;touch-action:none}
#fvsDockDiv:hover{background:#E8960A}
body.fvs-dock #fvsDock{display:flex;flex-direction:column}
body.fvs-dock #fvsDockDiv{display:block}
body.fvs-dock .main>.side,body.fvs-dock .main>.side-resize,body.fvs-dock #sideRight{display:none!important}
#fvsDockHost{flex:1;min-height:0;display:flex;flex-direction:column}
#fvsDockHost .box{width:100%!important;max-width:none;height:100%;max-height:none;flex:1;min-height:0;border-radius:0!important;box-shadow:none!important;display:flex;flex-direction:column}
#fvsDockHost .ls,#fvsDockHost .fdPane{flex:1;min-height:0;overflow:auto}
#fvsDockHost .fdPane{padding:10px 14px;display:none}
#fvsDockHost .fdPane.on{display:block}
#fvsDockHost .ls.fdOff{display:none}
.fdAbas{display:flex;border-bottom:1px solid #E2E8F0;padding:0 8px;overflow-x:auto;flex:none;background:#fff}
#fvsDockHost .fdAbas button{border:0;border-bottom:2px solid transparent;border-radius:0;background:none;padding:8px 11px;font-size:12px;font-weight:600;color:#64748B;white-space:nowrap;cursor:pointer}
#fvsDockHost .fdAbas button.on{color:#1E3A5F;border-bottom-color:#E8960A}
.fdAbas i{font-style:normal;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;margin-left:3px}
.fdStatus{margin-right:auto;font-size:11.5px;color:#64748B;align-self:center}
.fdStatus.suja{color:#9A6200;font-weight:700}
#fvsDockHost .fdLnk{border:0;background:none;color:#9A6200;font-size:11px;font-weight:700;cursor:pointer;padding:0;margin-top:3px;display:block}
#fvsDockHost .fdLnk:hover{text-decoration:underline}
.fdRec{position:absolute;right:10px;top:9px}
#fvsDockHost .hd{position:relative;padding-right:92px}
.fdGrp{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#1E3A5F;margin:10px 0 3px}
.fdLin{display:flex;justify-content:space-between;gap:8px;padding:6px 2px;border-bottom:1px solid #E2E8F0;font-size:12.5px}
.fdLin b{font-family:ui-monospace,Consolas,monospace;color:#1E3A5F}
.fdKpi{display:flex;gap:18px;flex-wrap:wrap;padding:8px 10px;background:#F1F5F9;border-radius:7px;margin:8px 0;font-size:11.5px;color:#64748B}
.fdKpi b{display:block;font-family:ui-monospace,Consolas,monospace;font-size:14px;color:#1E3A5F}
.fdIt{position:relative;margin:0 auto 10px;background:#fff;box-shadow:0 1px 6px rgba(15,23,42,.18)}
.fdIt canvas{display:block;width:100%;height:auto}
.fdIt .hl{position:absolute;background:rgba(232,150,10,.32);border-bottom:2px solid #E8960A;pointer-events:none}
.fdItBar{display:flex;gap:8px;align-items:center;font-size:11.5px;color:#64748B;margin-bottom:8px;flex-wrap:wrap}
.fdItBar b{font-family:ui-monospace,Consolas,monospace;color:#1E3A5F}
#fvsAbas{display:none;flex:none;gap:6px;padding:6px 10px;background:#fff;border-top:1px solid #E2E8F0;overflow-x:auto}
body.fvs-abas #fvsAbas{display:flex}
.fdTk{background:#F1F5F9;border:1px solid #E2E8F0;color:#0F172A;border-radius:8px;padding:5px 8px 5px 12px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;max-width:260px;flex:none;font-family:inherit}
.fdTk:hover{border-color:#E8960A}
.fdTk.act{background:#1E3A5F;color:#fff;border-color:#1E3A5F}
.fdTk .l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fdTk .l em{font-style:normal;font-family:ui-monospace,Consolas,monospace;font-weight:700}
.fdTk .p{width:8px;height:8px;border-radius:50%;background:#E8960A;flex:none}
.fdTk .x{opacity:.6;padding:2px 4px;border-radius:5px}
.fdTk .x:hover{opacity:1;background:rgba(148,163,184,.3)}
.fdTk.novo{background:#fff;color:#1E3A5F;border-style:dashed;padding-right:12px}
#fvsSel{position:absolute;left:8px;right:8px;top:8px;z-index:30;display:none;gap:6px;flex-wrap:wrap;align-items:center;background:rgba(255,255,255,.96);border:1px solid #E2E8F0;border-radius:8px;padding:6px 8px;box-shadow:0 3px 12px rgba(15,23,42,.14);font-size:12px;color:#334155}
#fvsSel.on{display:flex}
#fvsSel .rot{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748B}
#fvsSel button{border:1px solid #E2E8F0;background:#fff;color:#334155;border-radius:7px;padding:4px 9px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
#fvsSel button i{font-style:normal;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#64748B;margin-left:3px}
#fvsSel button:hover{border-color:#E8960A}
#fvsSel button.on{background:#FDF3E1;border-color:#E8960A;color:#7A4E00}
#fvsSel .res{margin-left:auto;font-family:ui-monospace,Consolas,monospace;color:#1E3A5F;font-weight:700}
#fvsSair{position:fixed;inset:0;background:rgba(11,18,32,.5);display:none;align-items:center;justify-content:center;z-index:9600;padding:16px}
#fvsSair.on{display:flex}
#fvsSair .bx{background:#fff;color:#0F172A;border-radius:10px;width:430px;max-width:100%;box-shadow:0 0 0 1px #E8960A,0 18px 48px rgba(8,14,26,.32)}
#fvsSair .t{padding:11px 16px;background:#F1F5F9;border-bottom:1px solid #E2E8F0;font-weight:700;color:#1E3A5F;border-radius:10px 10px 0 0;font-size:13.5px}
#fvsSair p{margin:0;padding:13px 16px;font-size:13px;color:#334155;line-height:1.5}
#fvsSair .a{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:0 16px 14px}
#fvsSair button{border:1px solid #E2E8F0;background:#fff;color:#1E3A5F;border-radius:7px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
#fvsSair button.p{background:#E8960A;border-color:#E8960A;color:#231703}
#fvsSair button.r{color:#A32D2D}
.fdNova{display:flex;align-items:center;gap:10px;width:100%;border:1.5px dashed #E8960A;background:#FDF3E1;color:#7A4E00;border-radius:10px;padding:12px 14px;font-weight:700;font-size:13.5px;cursor:pointer;text-align:left;font-family:inherit;margin-bottom:4px}
.fdNova:hover{background:#FBE7C2}
.fdNova .mais{font-size:22px;line-height:1}
.fdNova small{display:block;font-weight:500;color:#9A6200;font-size:11.5px;margin-top:2px}
.fdFx{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid #E2E8F0;cursor:pointer;font-size:12.5px}
.fdFx:hover{background:#F1F5F9}
.fdFx small{display:block;color:#64748B;font-size:11px;margin-top:1px}
.fdC{font-family:ui-monospace,Consolas,monospace;font-weight:700;color:#1E3A5F}
.fdPasso{display:flex;gap:10px;margin:4px 0 14px}
.fdPasso .n{flex:none;width:22px;height:22px;border-radius:50%;background:#1E3A5F;color:#fff;font-weight:800;font-size:11.5px;display:flex;align-items:center;justify-content:center;margin-top:1px}
.fdPasso.ok .n{background:#1E8449}
.fdPasso .cx{flex:1;min-width:0}
.fdPasso label{display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748B;margin-bottom:4px}
.fdPasso input,.fdPasso select{box-sizing:border-box;width:100%;border:1px solid #E2E8F0;border-radius:7px;padding:7px 9px;background:#fff;font:inherit;font-size:13px;color:#0F172A}
.fdPasso input:focus,.fdPasso select:focus{outline:none;border-color:#E8960A}
.fdBusca{position:relative}
.fdLista{position:absolute;left:0;right:0;top:100%;margin-top:3px;background:#fff;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.14);max-height:300px;overflow:auto;z-index:5;display:none}
.fdLista.on{display:block}
.fdLista .g{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748B;padding:7px 10px 3px;background:#F1F5F9}
.fdLista .o{padding:6px 10px;cursor:pointer;display:flex;gap:8px;font-size:12.5px}
.fdLista .o:hover{background:#FDF3E1}
.fdLista .o b{font-family:ui-monospace,Consolas,monospace;color:#1E3A5F;flex:none;min-width:52px}
.fdEsc{display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid #E8960A;background:#FDF3E1;border-radius:7px;padding:7px 9px;font-size:12.5px}
.fdEsc b{font-family:ui-monospace,Consolas,monospace;color:#1E3A5F}
#fvsDockHost .fdEsc button{border:0;background:none;color:#9A6200;font-weight:700;cursor:pointer;font-size:11.5px;padding:0}
.fdSeg{display:flex;border:1px solid #E2E8F0;border-radius:7px;overflow:hidden}
#fvsDockHost .fdSeg button{flex:1;border:0;border-radius:0;background:#fff;padding:7px;font-weight:600;color:#334155;cursor:pointer;font-size:12px}
#fvsDockHost .fdSeg button.on{background:#1E3A5F;color:#fff}
.fdPeca{cursor:pointer}
.fdPart{color:#64748B;font-weight:400}
.fdPeca{display:block!important}
.fdPeca.aberta{background:#FDF3E1}
.fdPl{display:flex;justify-content:space-between;align-items:center;gap:8px}
.fdTg{display:inline-block;font-size:10px;font-weight:800;border-radius:4px;padding:1px 6px;margin-left:6px;vertical-align:1px}
.fdTg.tre{background:#FDF3E1;color:#7A4E00;border:1px dashed #E8960A}
.fdTg.ok{background:#DCFCE7;color:#166534}
.fdTr{font-size:11.5px;color:#9A6200;margin-top:2px}
.fdTr.fecha{color:#1E8449}
.fdEd{margin:8px 0 4px;padding:10px 12px;border:1px solid #E8960A;border-radius:8px;background:#fff;cursor:default}
.fdEd label{display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748B;margin:8px 0 4px}
.fdEd label:first-child{margin-top:0}
.fdEd input{box-sizing:border-box;width:100%;border:1px solid #E2E8F0;border-radius:7px;padding:6px 9px;font:inherit;font-size:12.5px}
.fdEd input:focus{outline:none;border-color:#E8960A}
.fdFr{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:#64748B}
#fvsDockHost .fdFr button{border:1px solid #E2E8F0;background:#fff;border-radius:7px;padding:4px 10px;font-weight:700;cursor:pointer;color:#334155;font-size:12px}
#fvsDockHost .fdFr button.on{background:#FDF3E1;border-color:#E8960A;color:#7A4E00}
.fdFr input{width:80px!important}
.fdHist{font-size:11.5px;color:#334155;background:#F1F5F9;border-radius:6px;padding:7px 9px;margin-top:8px;line-height:1.55}
.fdHist b{font-family:ui-monospace,Consolas,monospace;color:#1E3A5F}
.fdHist b.ok{font-family:inherit;color:#166534}
.fdPeca:hover{background:#FDF3E1}
#fvsDockHost .fdTira{border:0;background:none;color:#94A3B8;cursor:pointer;padding:0 4px;font-size:12px}
#fvsDockHost .fdTira:hover{color:#A32D2D}
#fvsDockHost .b1:disabled{opacity:.45;cursor:default}
@media (max-width:760px){
  body.fvs-dock #fvsDock{position:fixed;left:0;right:0;top:0;bottom:44px;z-index:8900;max-width:none;min-width:0}
  body.fvs-dock{--aj-bottom:calc(112px + env(safe-area-inset-bottom))}
  body.fvs-dock #fvsDockDiv{display:none}
  body.fvs-ver-modelo #fvsDock{display:none!important}
  #fvsAbas{position:fixed;left:0;right:0;bottom:0;z-index:8901}
  #fvsSel{left:4px;right:4px;top:4px}
}`;
    document.head.appendChild(st);
  }

  // desenha no painel: o painel é o #segOv enquanto fn roda
  function emDock(fn){
    const host = $('fvsDockHost'), real = $('segOv');
    if (real) real.id = 'segOvReal';
    host.id = 'segOv';
    try { return fn(); } finally { host.id = 'fvsDockHost'; if (real) real.id = 'segOv'; }
  }
  function mostrar(on){
    const ja = document.body.classList.contains('fvs-dock');
    document.body.classList.toggle('fvs-dock', !!on);
    document.body.classList.toggle('fvs-abas', D.abas.length > 0);
    if (!on) document.body.classList.remove('fvs-ver-modelo');
    if (ja !== !!on) setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
  }
  function guardar(){
    const t = atual(); if (!t) return;
    if (t.novo) return;   // a nova ficha grava cada campo na aba ao digitar (FvsDock.campo)
    if (FVS_ABERTA === t.id && FVS_RASC) t.rasc = FVS_RASC;
    const c = document.querySelector('#fvsDockHost .ls'); if (c) t.scroll = c.scrollTop;
  }
  function sujo(t){
    if (t.novo) return !!t.mexeu || nPecas(t) > 0;
    const r = t.k === D.at && FVS_ABERTA === t.id ? FVS_RASC : t.rasc;
    return !!t.editavel && (jRasc(r) !== t.base || jVinc(t) !== t.baseV);
  }
  function marcar(){
    barra();
    const t = atual(), s = document.querySelector('#fvsDockHost .fdStatus'); if (!t || !s) return;
    if (t.novo){ rodapeNova(t); return; }   // na nova ficha o rodapé diz o que falta
    const d = sujo(t); s.classList.toggle('suja', d);
    s.textContent = d ? '● Alterações não salvas' : (t.editavel ? 'Tudo salvo' : '');
  }
  function barra(){
    const b = $('fvsAbas'); if (!b) return;
    b.innerHTML = D.abas.map(t => '<div class="fdTk' + (t.k === D.at && document.body.classList.contains('fvs-dock') ? ' act' : '') + '" title="' + esc(t.servico || '') + '" onclick="FvsDock.ir(\'' + t.k + '\')">'
        + (sujo(t) ? '<span class="p" title="Não salvo"></span>' : '') + '<span class="l"><em>' + esc(t.rot) + '</em> ' + esc(t.sub || '') + '</span>'
        + '<span class="x" title="Fechar" onclick="event.stopPropagation();FvsDock.fechar(\'' + t.k + '\')">✕</span></div>').join('')
      + '<div class="fdTk novo" onclick="FvsDock.nova()">＋ Nova ficha</div><div class="fdTk novo" onclick="FvsDock.menu()">Menu FVS</div>'
      + (ehCelular() && document.body.classList.contains('fvs-dock') ? '<div class="fdTk novo" onclick="FvsDock.modelo()">Modelo</div>' : '');
    document.body.classList.toggle('fvs-abas', D.abas.length > 0);
  }

  // ── abrir, trocar e fechar ────────────────────────────────────────────────
  const _ficha = fvsFicha;
  fvsFicha = function(id){
    const x = FVS_INSP.find(i => i.id === id); if (!x) return;
    montar(); segFechar();
    if (D.at !== id) guardar();
    let t = D.abas.find(a => a.k === id);
    if (!t){ t = { k:id, id, aba:'ver' }; D.abas.push(t); }
    t.volta = false; desenhar(t);
  };
  function desenhar(t){
    const x = FVS_INSP.find(i => i.id === t.id); if (!x) return;
    const volta = t.volta && t.rasc; D.at = t.k;
    t.tipo = x.tipo; t.servico = x.servico; t.rot = x.codigo; t.pavId = x.pavimento_id; t.modId = x.modelo_id;
    t.sub = (x.modelo_codigo || '').replace('FVS ', '') + ' · ' + (segPavNome(x.pavimento_id) || '');
    t.editavel = fvsPodeEditar(x) && ['aberta','em_verificacao'].includes(x.situacao);
    if (!volta){ t.elementos = JSON.parse(JSON.stringify(x.elementos || [])); t.conc = x.concretagem_id || null; t.baseV = jVinc(t); }
    window.FVS_DOCK_VOLTA = volta ? t.rasc : null;
    emDock(() => _ficha(t.id));
    window.FVS_DOCK_VOLTA = null;
    if (!volta) t.base = jRasc(FVS_RASC);
    if (volta) FVS_RASC.forEach((r, i) => { if (r.fotos.length) try { segFotosHtml(r.fotos, 'fvsF' + i); } catch (_){} });
    t.volta = false;
    mostrar(true); enfeitar(t); barra(); marcar(); aba(t.aba || 'ver');
    if (t.scroll){ const c = document.querySelector('#fvsDockHost .ls'); if (c) c.scrollTop = t.scroll; }
    modelo(t);
  }
  function enfeitar(t){
    const h = $('fvsDockHost'), box = h.querySelector('.box'), hd = box.querySelector('.hd'), ls = box.querySelector('.ls'), ft = box.querySelector('.ft');
    hd.insertAdjacentHTML('beforeend', '<button class="b2 mini fdRec" onclick="FvsDock.recolher()">Recolher</button>');
    // a IT agora é uma aba: some o botão que trocava a prancha
    [...h.querySelectorAll('button')].filter(b => /itsAbrirIt/.test(b.getAttribute('onclick') || '')).forEach(b => { const r = b.closest('.seg-kv'); if (r) r.remove(); });
    { const x = FVS_INSP.find(i => i.id === t.id) || {}, kv = h.querySelector('.seg-kv');
      const extra = (x.parceiro ? '<div class="seg-kv"><span>Parceiro</span><b>' + esc(x.parceiro) + '</b></div>' : '')
        + (x.agendada_para ? '<div class="seg-kv"><span>Agendada para</span><b>' + x.agendada_para.split('-').reverse().join('/') + '</b></div>' : '');
      if (extra && kv) kv.insertAdjacentHTML('afterend', extra); }
    const lista = ['ver'].concat(t.tipo !== 'seguranca' ? ['pec'] : []).concat(modeloDe(t).it_id ? ['it'] : []).concat(ehConcreto(t) ? ['conc'] : []).concat(['his']);
    hd.insertAdjacentHTML('afterend', '<div class="fdAbas">' + lista.map(a => '<button data-a="' + a + '" onclick="FvsDock.aba(\'' + a + '\')">' + ROTULO[a] + '<i data-n="' + a + '"></i></button>').join('') + '</div>');
    ls.insertAdjacentHTML('afterend', lista.filter(a => a !== 'ver').map(a => '<div class="fdPane" data-p="' + a + '"></div>').join(''));
    const his = box.querySelector('.fdPane[data-p=his]'), hist = $('fvsHist');
    if (hist && his){ const r = hist.previousElementSibling; if (r && r.classList.contains('seg-kv')) r.remove(); his.appendChild(hist); }
    const msg = $('segMsg'); if (msg && ft) ft.parentNode.insertBefore(msg, ft);
    if (ft) ft.insertAdjacentHTML('afterbegin', '<span class="fdStatus"></span>');
    if (modeloDe(t).it_id) box.querySelectorAll('.fvs-item').forEach((e, i) => { const d = e.querySelector('.q>div'); if (d) d.insertAdjacentHTML('beforeend', '<button class="fdLnk" onclick="FvsDock.verIt(' + i + ')">Ver na IT</button>'); });
    contar(t);
  }
  function contar(t){
    const n = a => document.querySelector('#fvsDockHost i[data-n=' + a + ']');
    if (n('pec')) n('pec').textContent = nPecas(t) || '';
  }
  const modeloDe = t => FVS_MODELOS.find(m => m.id === t.modId) || {};
  function aba(a, item){
    const t = atual(); if (!t || t.novo) return;
    if (!document.querySelector('#fvsDockHost .fdAbas button[data-a=' + a + ']')) a = 'ver';
    t.aba = a;
    document.querySelectorAll('#fvsDockHost .fdAbas button').forEach(b => b.classList.toggle('on', b.dataset.a === a));
    document.querySelectorAll('#fvsDockHost .fdPane').forEach(p => p.classList.toggle('on', p.dataset.p === a));
    const ls = document.querySelector('#fvsDockHost .ls'); if (ls) ls.classList.toggle('fdOff', a !== 'ver');
    if (a === 'pec') pecasLista(t);
    if (a === 'it') itAbrir(t, item);
    if (a === 'conc') concretoAbrir(t);
  }
  function ir(k){
    const t = D.abas.find(a => a.k === k); if (!t) return;
    document.body.classList.remove('fvs-ver-modelo');
    if (k === D.at && document.body.classList.contains('fvs-dock')){ recolher(); return; }
    guardar();
    if (t.novo) desenharNova(t); else { t.volta = true; desenhar(t); }
  }
  function recolher(){ guardar(); selParar(); mostrar(false); barra(); }
  function tirar(k){
    const i = D.abas.findIndex(a => a.k === k); if (i < 0) return;
    D.abas.splice(i, 1);
    if (D.at !== k){ barra(); return; }
    D.at = null; const p = D.abas[Math.min(i, D.abas.length - 1)];
    if (p){ if (p.novo) desenharNova(p); else { p.volta = true; desenhar(p); } }
    else { selParar(); $('fvsDockHost').innerHTML = ''; mostrar(false); barra(); }
  }
  function perguntar(t, depois){
    let d = $('fvsSair'); if (!d){ d = document.createElement('div'); d.id = 'fvsSair'; document.body.appendChild(d); }
    d.innerHTML = '<div class="bx"><div class="t">Sair sem salvar?</div><p><b>' + esc(t.rot) + '</b> tem alterações que ainda não foram salvas.</p><div class="a">'
      + '<button data-r="c">Continuar editando</button><button class="r" data-r="s">Sair sem salvar</button>' + (t.novo ? '' : '<button class="p" data-r="g">Salvar e fechar</button>') + '</div></div>';
    d.classList.add('on');
    d.querySelectorAll('button').forEach(b => b.onclick = async () => {
      const r = b.dataset.r; if (r === 'c'){ d.classList.remove('on'); return; }
      if (r === 'g'){ b.disabled = true; b.textContent = 'Salvando…';
        try { await fvsGravar(t.id); await fvsCarregar(); }
        catch (e){ b.disabled = false; b.textContent = 'Salvar e fechar'; d.querySelector('p').textContent = 'Não foi possível salvar: ' + (e.message || e); return; } }
      d.classList.remove('on'); depois();
    });
  }
  function fechar(k){
    const t = D.abas.find(a => a.k === k); if (!t) return;
    if (!sujo(t)){ tirar(k); return; }
    if (D.at !== k) ir(k);
    perguntar(t, () => tirar(k));
  }

  // ── menu de FVS e nova ficha, ao lado do modelo ───────────────────────────
  const hoje = () => new Date().toISOString().slice(0, 10);
  const dataBr = d => d ? d.split('-').reverse().join('/') : '';
  function linhaFicha(x){
    const s = FVS_SIT[x.situacao] || { rot:x.situacao, cor:'#64748B' };
    return '<div class="fdFx" onclick="fvsFicha(\'' + x.id + '\')"><div><span class="fdC">' + esc(x.codigo) + '</span> ' + esc(x.servico || '')
      + '<small>' + esc([segPavNome(x.pavimento_id), x.local_txt].filter(Boolean).join(' › ') || '—') + (x.agendada_para ? ' · agendada ' + dataBr(x.agendada_para) : '') + (x.parceiro ? ' · ' + esc(x.parceiro) : '') + '</small></div>'
      + '<span class="seg-chip" style="--c:' + chipCor(s.cor) + '">' + s.rot + '</span></div>';
  }
  function menu(){
    montar(); segFechar(); guardar(); selParar();
    const F = fvsSoFvs(FVS_INSP), eu = (typeof USER !== 'undefined' && USER) ? USER.id : null;
    const emAberto = x => ['aberta','em_verificacao'].includes(x.situacao);
    const ag = F.filter(x => x.agendada_para && emAberto(x)).sort((a, b) => a.agendada_para < b.agendada_para ? -1 : 1);
    const abertas = F.filter(x => emAberto(x) && !x.agendada_para);
    const grupo = (tit, l, vazio) => '<div class="fdGrp">' + tit + (l.length ? ' · ' + l.length : '') + '</div>' + (l.length ? l.slice(0, 12).map(linhaFicha).join('') + (l.length > 12 ? '<div class="hint">e mais ' + (l.length - 12) + ' — veja na matriz</div>' : '') : '<div class="hint">' + vazio + '</div>');
    D.at = 'menu';
    emDock(() => segOv('<div class="hd"><b>Fichas de Verificação de Serviço</b><p>' + esc(EMP ? EMP.nome : '') + '</p></div><div class="ls">'
      + (fvsPodeAbrir() ? '<button class="fdNova" onclick="FvsDock.nova()"><span class="mais">＋</span><span>Nova ficha<small>Escolha pavimento e serviço e já comece a preencher</small></span></button>' : '')
      + grupo('Agendadas', ag, 'Nenhuma ficha agendada.')
      + grupo('Em preenchimento', abertas.filter(x => x.aberta_por === eu).concat(abertas.filter(x => x.aberta_por !== eu)), 'Nenhuma ficha em preenchimento.')
      + grupo('Aguardando aprovação', F.filter(x => x.situacao === 'aguardando'), 'Nada aguardando aprovação.')
      + grupo('Reprovadas', F.filter(x => x.situacao === 'reprovada'), 'Nenhuma ficha reprovada.')
      + '<div class="fdGrp">Consultar</div><div class="fdFx" onclick="FvsDock.recolher();fvsPainel()"><div><b>Matriz pavimento × serviço</b><small>Todas as fichas da obra por andar</small></div><span>›</span></div>'
      + '<div class="fdFx" onclick="AuriaNC.janela({emp:EMP.id})"><div><b>Não conformidades</b><small>Itens reprovados e planos de ação</small></div><span>›</span></div>'
      + '</div><div class="ft"><button class="b2" onclick="FvsDock.recolher()">Fechar</button></div>'));
    mostrar(true); barra();
  }
  fvsNova = function(modId, pavId){
    if (!fvsPodeAbrir()) return;
    montar(); segFechar(); guardar();
    let t = D.abas.find(a => a.novo);
    if (!t){ t = { k:'novo', novo:true, rot:'Nova ficha', sub:'', elementos:[], editavel:true, loc:'', conc:null, quando:'agora', data:'', parceiro:'', busca:'' }; D.abas.push(t); }
    if (modId) t.modId = modId;
    if (pavId && pavId !== t.pavId){ t.pavId = pavId; t.elementos = []; }
    desenharNova(t);
  };
  function campo(nome, valor){
    const t = atual(); if (!t || !t.novo) return;
    t.mexeu = true;
    if (nome === 'pavId'){ t.pavId = valor || null; t.elementos = []; t.conc = null; desenharNova(t); return; }
    if (nome === 'modId'){ t.modId = valor; t.busca = ''; desenharNova(t); return; }
    t[nome] = valor;
    if (nome === 'quando' || nome === 'data') desenharNova(t); else { rodapeNova(t); marcar(); }
  }
  function busca(v){ const t = atual(); if (!t || !t.novo) return; t.busca = v; servicoLista(); }
  function servicoLista(){
    const t = atual(), l = $('fdServL'); if (!t || !l) return;
    const q = _fvsNorm(t.busca || ''), mods = fvsSoFvs(FVS_MODELOS).filter(m => m.ativo !== false);
    const gr = {}; mods.filter(m => !q || _fvsNorm(m.codigo + ' ' + m.servico).includes(q)).forEach(m => (gr[m.etapa || 'outro'] = gr[m.etapa || 'outro'] || []).push(m));
    l.innerHTML = Object.keys(gr).map(e => '<div class="g">' + esc((typeof FVS_ETAPAS !== 'undefined' && FVS_ETAPAS[e]) || e) + '</div>'
      + gr[e].map(m => '<div class="o" onmousedown="FvsDock.campo(\'modId\',\'' + m.id + '\')"><b>' + esc(m.codigo.replace('FVS ', '')) + '</b><span>' + esc(m.servico) + '</span></div>').join('')).join('')
      || '<div class="o">Nenhum serviço encontrado</div>';
    l.classList.add('on');
  }
  function falta(t){
    const m = modeloDe(t);
    return [!t.pavId && 'pavimento', !t.modId && 'serviço', t.modId && m.nivel_local && m.nivel_local !== 'pavimento' && (t.loc || '').trim().length < 2 && 'local',
            t.quando === 'agendar' && !t.data && 'data'].filter(Boolean);
  }
  function rodapeNova(t){
    const f = falta(t), s = document.querySelector('#fvsDockHost .fdStatus'), b = $('segOk');
    if (s){ s.textContent = f.length ? 'Faltam ' + f.join(', ') : 'Pronto para abrir'; s.classList.remove('suja'); }
    if (b){ b.disabled = !!f.length; b.textContent = t.quando === 'agendar' ? 'Agendar ficha' : 'Abrir e preencher'; }
  }
  async function desenharNova(t){
    D.at = t.k;
    const m = modeloDe(t), pavs = fvsPavs(), precisa = m.nivel_local && m.nivel_local !== 'pavimento', concreto = ehConcreto({ servico:m.servico, tipo:'fvs' });
    if (concreto && !CONCS.length) try { await concCarregar(); } catch (_){}
    if (D.at !== t.k) return;
    t.servico = m.servico || ''; t.tipo = 'fvs';
    t.sub = [(m.codigo || '').replace('FVS ', ''), t.pavId ? segPavNome(t.pavId) : ''].filter(Boolean).join(' · ');
    const parceiros = [...new Set(FVS_INSP.map(x => x.parceiro).filter(Boolean))].slice(0, 30);
    let n = 0; const passo = (feito, rot, html) => '<div class="fdPasso' + (feito ? ' ok' : '') + '"><span class="n">' + (++n) + '</span><div class="cx"><label>' + rot + '</label>' + html + '</div></div>';
    const servHtml = t.modId
      ? '<div class="fdEsc"><span><b>' + esc(m.codigo) + '</b> ' + esc(m.servico) + '</span><button onclick="FvsDock.campo(\'modId\',null)">trocar</button></div>'
      : '<div class="fdBusca"><input id="fdServ" placeholder="Digite o código ou o nome — ex.: 009, concretagem" value="' + esc(t.busca || '') + '" oninput="FvsDock.busca(this.value)" onfocus="FvsDock.busca(this.value)" autocomplete="off"><div class="fdLista" id="fdServL"></div></div>';
    emDock(() => segOv('<div class="hd"><b>Nova ficha</b><p>Inspetor: ' + esc((typeof USER !== 'undefined' && USER && (USER.nome || USER.email)) || '') + ' · ' + new Date().toLocaleDateString('pt-BR') + '</p></div><div class="ls">'
      + passo(t.pavId, 'Pavimento', '<select onchange="FvsDock.campo(\'pavId\',this.value)"><option value="">Escolha…</option>' + pavs.map(p => '<option value="' + p.id + '"' + (p.id === t.pavId ? ' selected' : '') + '>' + esc(cdePavLabel(p)) + '</option>').join('') + '</select>'
          + '<input style="margin-top:6px" maxlength="80" id="fvsLoc" value="' + esc(t.loc || '') + '" oninput="FvsDock.campo(\'loc\',this.value)" placeholder="' + (precisa ? (FVS_NIVEL_ROT[m.nivel_local] || 'Local') + ' — obrigatório' : 'Trecho (opcional) — ex.: Torre 1, ala norte') + '">')
      + passo(t.modId, 'Serviço', servHtml)
      + passo(nPecas(t), 'Peças', '<div class="hint" id="fdNovaPec">' + (t.pavId ? pecasTxt(t) : 'Escolha o pavimento primeiro.') + '</div>')
      + (concreto ? passo(t.conc, 'Concretagem', '<select id="fdConc" onchange="FvsDock.campo(\'conc\',this.value||null)"><option value="">Definir depois</option>' + CONCS.filter(c => c.pavimento_id === t.pavId && c.situacao !== 'cancelada').map(c => '<option value="' + c.id + '"' + (c.id === t.conc ? ' selected' : '') + '>' + esc(c.codigo + ' · ' + (c.descricao || concLocal(c) || '')) + '</option>').join('') + '</select><div class="hint">Traz caminhões, corpos de prova e o mapa de concretagem para a ficha.</div>') : '')
      + passo(t.quando !== 'agendar' || t.data, 'Quando', '<div class="fdSeg"><button class="' + (t.quando !== 'agendar' ? 'on' : '') + '" onclick="FvsDock.campo(\'quando\',\'agora\')">Preencher agora</button><button class="' + (t.quando === 'agendar' ? 'on' : '') + '" onclick="FvsDock.campo(\'quando\',\'agendar\')">Agendar</button></div>'
          + (t.quando === 'agendar' ? '<input type="date" style="margin-top:6px" min="' + hoje() + '" value="' + esc(t.data || '') + '" onchange="FvsDock.campo(\'data\',this.value)"><div class="hint">A ficha fica em "Agendadas" no menu de FVS até ser preenchida.</div>' : ''))
      + passo((t.parceiro || '').trim(), 'Parceiro (quem executou)', '<input list="fdParcL" maxlength="80" value="' + esc(t.parceiro || '') + '" oninput="FvsDock.campo(\'parceiro\',this.value)" placeholder="Ex.: Diagonal, empresa de instalações"><datalist id="fdParcL">' + parceiros.map(p => '<option value="' + esc(p) + '">').join('') + '</datalist>')
      + (t.modId ? '<div class="fdGrp">O que será verificado (' + (m.itens || []).length + ')</div><ol class="fvs-itens">' + (m.itens || []).map(i => '<li>' + esc(i.item) + (i.tolerancia ? ' <small>(' + esc(i.tolerancia) + ')</small>' : '') + (i.exige_foto ? ' <span class="fmini">foto</span>' : '') + '</li>').join('') + '</ol>' : '')
      + '</div><div id="segMsg" class="seg-msg"></div><div class="ft"><span class="fdStatus"></span><button class="b2" onclick="FvsDock.fechar(\'' + t.k + '\')">Cancelar</button><button class="b1" id="segOk" onclick="fvsAbrir()">Abrir e preencher</button></div>'));
    $('fvsDockHost').querySelector('.hd').insertAdjacentHTML('beforeend', '<button class="b2 mini fdRec" onclick="FvsDock.recolher()">Recolher</button>');
    mostrar(true); barra(); rodapeNova(t);
    if (t.pavId) modelo(t); else selParar();
  }
  const pecasTxt = t => nPecas(t) ? nPecas(t) + ' peça(s) marcada(s) no modelo ao lado.' : 'Marque no modelo ao lado, por classe ou clicando. Sem peça marcada, a ficha vale para o pavimento inteiro.';
  // a nova ficha lê tudo da aba (a assinatura antiga modId, pavId, precisaLocal é ignorada)
  fvsAbrir = async function(){
    const t = atual(), msg = s => { $('segMsg').textContent = s; };
    if (!t || !t.novo) return;
    const f = falta(t); if (f.length) return msg('Faltam ' + f.join(', ') + '.');
    const loc = (t.loc || '').trim(), n = nPecas(t), modId = t.modId, pavId = t.pavId;
    // com peças marcadas, o mesmo pavimento pode ter várias fichas do serviço
    if (!n && FVS_INSP.some(x => x.modelo_id === modId && x.pavimento_id === pavId && (x.local_txt || '').toLowerCase() === loc.toLowerCase() && x.situacao !== 'reprovada' && !(x.elementos || []).length))
      return msg('Já existe uma ficha deste serviço neste local. Marque as peças ou informe o trecho.');
    const b = $('segOk'); b.disabled = true;
    try {
      const r = await sb.rpc('fvs_proximo_codigo', { p_emp:EMP.id }); if (r.error) throw r.error;
      const id = crypto.randomUUID(), row = { id, empreendimento_id:EMP.id, codigo:r.data, modelo_id:modId, pavimento_id:pavId, local_txt:loc || null, aberta_por:USER.id };
      if (n) row.elementos = t.elementos.filter(g => g.ids.length);
      if (t.conc) row.concretagem_id = t.conc;
      if (t.quando === 'agendar' && t.data) row.agendada_para = t.data;
      if ((t.parceiro || '').trim()) row.parceiro = t.parceiro.trim();
      const { error } = await sb.from('fvs_inspecao_auria').insert(row); if (error) throw error;
      D.abas = D.abas.filter(a => a.k !== t.k); D.at = null;
      await fvsCarregar(); try { renderSideRight(); } catch (_){}
      fvsFicha(id);
    } catch (e){ msg('Não foi possível abrir: ' + (e.message || e)); b.disabled = false; }
  };
  // peças e concretagem entram no mesmo Salvar da ficha
  const _gravar = fvsGravar;
  fvsGravar = async function(id){
    await _gravar(id);
    const t = D.abas.find(a => a.k === id);
    if (t && !t.novo && t.tipo !== 'seguranca' && jVinc(t) !== t.baseV){
      const { error } = await sb.rpc('fvs_salvar_vinculo', { p_id:id, p_elementos:(t.elementos || []).filter(g => g.ids.length), p_concretagem:t.conc || null });
      if (error) throw error;
      t.baseV = jVinc(t);
    }
  };

  // ── modelo: seleção por clique e por classe ───────────────────────────────
  async function modelo(t){
    const barraSel = () => { let s = $('fvsSel'); if (!s){ const b = $('bimBody'); if (!b) return null; s = document.createElement('div'); s.id = 'fvsSel'; b.appendChild(s); } return s; };
    const s = barraSel(); if (s) s.classList.remove('on');
    D.sel = false;
    if (!t.pavId) return;
    if (t.tipo === 'seguranca' || ehCelular() && !document.body.classList.contains('fvs-ver-modelo')) return;
    const k = t.k, m = modeloDe(t);
    let ok = false; try { ok = await fvs3dGarantir(m); } catch (e){ console.warn('modelo da ficha:', e); }
    if (D.at !== k || !ok || !F3D || !F3D.vivo) return;
    try { segSairModo(); } catch (_){}
    const mp = await fvs3dMapa(); if (D.at !== k) return;
    const chave = F3D.modelos.map(x => x.arquivoId).join('|') + '#' + t.pavId;
    if (D.catChave !== chave){
      const cat = GRUPOS.map(g => ({ rot:g[0], porMod:{}, n:0 }));
      for (let mi = 0; mi < F3D.modelos.length; mi++){ const md = F3D.modelos[mi].model; if (!md) continue;
        let c = {}; try { c = await md.getItemsOfCategories(GRUPOS.map(g => g[1])) || {}; } catch (_){}
        for (const [nome, ids] of Object.entries(c)){ const nm = String(nome).toUpperCase(), gi = GRUPOS.findIndex(g => g[1].test(nm)); if (gi < 0) continue;
          const meus = ids.filter(id => mp.dono[mi].get(id) === t.pavId); if (!meus.length) continue;
          cat[gi].porMod[mi] = (cat[gi].porMod[mi] || []).concat(meus); cat[gi].n += meus.length; } }
      D.cat = cat.filter(g => g.n); D.catChave = chave;
      D.pav = {}; mp.dono.forEach((mapa, mi) => { const ids = []; if (mapa) mapa.forEach((pv, id) => { if (pv === t.pavId) ids.push(id); }); if (ids.length) D.pav[mi] = ids; });
    }
    if (D.at !== k) return;
    D.sel = !!t.editavel; await pintar(t, true); selBarra(t);
  }
  function selParar(){ D.sel = false; const s = $('fvsSel'); if (s) s.classList.remove('on'); try { B3.limparFiltro(F3D).then(fvs3dRefrescar); } catch (_){} }
  function porMod(t){ const pm = {}; (t.elementos || []).forEach(g => { const mi = F3D.modelos.findIndex(m => m.arquivoId === g.cde_arquivo_id); if (mi >= 0 && g.ids.length) pm[mi] = g.ids.slice(); }); return pm; }
  async function pintar(t, enquadrar){
    const pm = porMod(t), sel = new Set(), neutro = {};
    Object.entries(pm).forEach(([mi, ids]) => ids.forEach(id => sel.add(mi + ':' + id)));
    for (let mi = 0; mi < F3D.modelos.length; mi++){ const m = F3D.modelos[mi], md = m.model; if (!md) continue;
      if (!D.todos[m.arquivoId]){ try { D.todos[m.arquivoId] = Object.values(await md.getItemsOfCategories([FVS3D_NEUTRO_RE]) || {}).flat(); } catch (_){ D.todos[m.arquivoId] = []; } }
      neutro[mi] = D.todos[m.arquivoId].filter(id => !sel.has(mi + ':' + id)); }
    try { await B3.limparFiltro(F3D); } catch (_){}
    // só o pavimento da ficha fica visível (o resto do prédio esconde a peça que a pessoa quer marcar)
    const soPav = D.soPav && D.pav && Object.keys(D.pav).length;
    if (soPav) for (let mi = 0; mi < F3D.modelos.length; mi++){ const no = new Set(D.pav[mi] || []); neutro[mi] = (neutro[mi] || []).filter(id => no.has(id)); }
    try { await B3.colorirGrupo(F3D, neutro, 0xE2E8F0); } catch (_){}
    if (Object.keys(pm).length){
      const tre = {}, fec = {}, inteira = {};
      Object.entries(pm).forEach(([mi, ids]) => { const arq = F3D.modelos[mi].arquivoId;
        ids.forEach(id => { const o = !trechoDe(t, arq, id) ? inteira : somaTrechos(t, arq, id) >= 0.999 ? fec : tre; (o[mi] = o[mi] || []).push(id); }); });
      if (Object.keys(inteira).length) try { await B3.colorirGrupo(F3D, inteira, 0xE8960A); } catch (_){}
      if (Object.keys(tre).length) try { await B3.colorirGrupo(F3D, tre, 0xF7C873); } catch (_){}
      if (Object.keys(fec).length) try { await B3.colorirGrupo(F3D, fec, 0x6EE7A0); } catch (_){}
    }
    // a visibilidade vem DEPOIS das cores: colorirGrupo (bim3d.js) volta a mostrar o modelo inteiro
    if (soPav) for (let mi = 0; mi < F3D.modelos.length; mi++){ const md = F3D.modelos[mi].model; if (!md) continue;
      try { await md.setVisible(undefined, false); } catch (_){} if (D.pav[mi]) try { await md.setVisible(D.pav[mi], true); } catch (_){} }
    const alvo = soPav ? D.pav : Object.keys(pm).length ? pm : (D.cat || []).reduce((a, g) => { Object.entries(g.porMod).forEach(([mi, ids]) => a[mi] = (a[mi] || []).concat(ids)); return a; }, {});
    if (enquadrar && Object.keys(alvo).length) try { await B3.enquadrarIds(F3D, alvo); } catch (_){}
    await fvs3dRefrescar();
  }
  function selBarra(t){
    const s = $('fvsSel'); if (!s || !D.cat) return;
    if (!D.cat.length){ s.innerHTML = '<span>Nenhuma peça deste pavimento no modelo aberto.</span>'; s.classList.add('on'); return; }
    const pm = porMod(t), tem = (mi, id) => (pm[mi] || []).includes(id);
    s.innerHTML = (t.editavel ? '<span class="rot">Selecionar</span>' : '<span class="rot">Peças da ficha</span>')
      + (t.editavel ? D.cat.map((g, i) => { let q = 0; Object.entries(g.porMod).forEach(([mi, ids]) => ids.forEach(id => { if (tem(+mi, id)) q++; }));
          return '<button class="' + (q === g.n ? 'on' : '') + '" onclick="FvsDock.classe(' + i + ')">' + esc(g.rot) + '<i>' + q + '/' + g.n + '</i></button>'; }).join('')
        + '<button onclick="FvsDock.todas(true)">Pavimento inteiro</button><button onclick="FvsDock.todas(false)">Limpar</button>' : '')
      + '<button class="' + (D.soPav ? '' : 'on') + '" onclick="FvsDock.predio()" title="Mostrar ou esconder o resto do prédio">' + (D.soPav ? 'Ver prédio' : 'Só o pavimento') + '</button>'
      + '<span class="res" id="fdRes">' + nPecas(t) + ' peça(s)</span>';
    s.classList.add('on'); volume(t);
  }
  async function volume(t){
    const k = t.k; let v = 0;
    for (const [mi, ids] of Object.entries(porMod(t))){ const md = F3D.modelos[mi].model, arq = F3D.modelos[mi].arquivoId, porFrac = {};
      ids.forEach(id => { const tr = trechoDe(t, arq, id), f = tr ? +tr.frac || 0 : 1; (porFrac[f] = porFrac[f] || []).push(id); });
      for (const [f, l] of Object.entries(porFrac)){ try { v += (+(await md.getItemsVolume(l)) || 0) * (+f); } catch (_){} } }
    t.vol = Math.round(v * 100) / 100;
    const r = $('fdRes'); if (r && D.at === k) r.textContent = nPecas(t) + ' peça(s) · ' + concM3(t.vol);
    const kv = document.querySelector('#fvsDockHost .fdPane[data-p=pec] .fdVol'); if (kv && D.at === k) kv.textContent = concM3(t.vol);
  }
  function porGrupo(t, cb){ const m = {}; (t.elementos || []).forEach(g => m[g.cde_arquivo_id] = g); return cb(m); }
  async function mudou(t){
    t.elementos = (t.elementos || []).filter(g => g.ids.length);
    t.elementos.forEach(g => { if (g.trechos){ const s = new Set(g.ids.map(String)); Object.keys(g.trechos).forEach(k => { if (!s.has(String(k))) delete g.trechos[k]; }); if (!Object.keys(g.trechos).length) delete g.trechos; } });
    await pintar(t, false); selBarra(t); contar(t); marcar();
    const p = $('fdNovaPec'); if (p) p.textContent = pecasTxt(t);
    if (t.aba === 'pec') pecasLista(t);
  }
  function classe(i){
    const t = atual(), g = D.cat && D.cat[i]; if (!t || !g) return;
    porGrupo(t, m => {
      const tudo = Object.entries(g.porMod).every(([mi, ids]) => { const e = m[F3D.modelos[mi].arquivoId]; return e && ids.every(id => e.ids.includes(id)); });
      Object.entries(g.porMod).forEach(([mi, ids]) => { const a = F3D.modelos[mi]; let e = m[a.arquivoId];
        if (!e){ e = { cde_arquivo_id:a.arquivoId, modelo:a.nome || '', ids:[] }; t.elementos.push(e); m[a.arquivoId] = e; }
        const s = new Set(ids); e.ids = tudo ? e.ids.filter(id => !s.has(id)) : [...new Set(e.ids.concat(ids))]; });
    });
    mudou(t);
  }
  function todas(sim){
    const t = atual(); if (!t) return;
    t.elementos = [];
    if (sim) (D.cat || []).forEach((g, i) => { const u = {}; t.elementos.forEach(e => u[e.cde_arquivo_id] = e);
      Object.entries(g.porMod).forEach(([mi, ids]) => { const a = F3D.modelos[mi]; let e = u[a.arquivoId]; if (!e){ e = { cde_arquivo_id:a.arquivoId, modelo:a.nome || '', ids:[] }; t.elementos.push(e); u[a.arquivoId] = e; } e.ids = [...new Set(e.ids.concat(ids))]; }); });
    mudou(t);
  }
  const _clique = f3dClique;
  f3dClique = async function(ev){
    const t = atual();
    if (!D.sel || !t || !document.body.classList.contains('fvs-dock') || !t.editavel) return _clique(ev);
    const hit = await B3.raycast(F3D, ev); if (!hit) return;
    const m = hit.__modelo; let g = t.elementos.find(x => x.cde_arquivo_id === m.arquivoId);
    if (!g){ g = { cde_arquivo_id:m.arquivoId, modelo:m.nome || '', ids:[] }; t.elementos.push(g); }
    const i = g.ids.indexOf(hit.localId); if (i >= 0) g.ids.splice(i, 1); else g.ids.push(hit.localId);
    mudou(t);
  };
  const SING = { 'Pilares':'Pilar', 'Vigas':'Viga', 'Lajes':'Laje', 'Paredes':'Parede', 'Escadas':'Escada', 'Fundações':'Fundação', 'Portas e janelas':'Esquadria', 'Revestimentos':'Revestimento' };
  const _natural = (a, b) => a.localeCompare(b, 'pt-BR', { numeric:true, sensitivity:'base' });
  async function pecasLista(t){
    const p = document.querySelector('#fvsDockHost .fdPane[data-p=pec]'); if (!p) return;
    if (!nPecas(t)){ p.innerHTML = '<div class="hint">Nenhuma peça marcada: a ficha vale para o pavimento inteiro.' + (t.editavel ? ' Marque no modelo ao lado, por classe ou clicando em cada peça.' : '') + '</div>'; return; }
    const kpi = '<div class="fdKpi"><span><b>' + nPecas(t) + '</b>peça(s)</span>' + '<span><b class="fdVol">' + (t.vol != null ? concM3(t.vol) : '…') + '</b>volume desta ficha</span>' + '</div>';
    if (!F3D || !F3D.vivo || !F3D.modelos.length){ p.innerHTML = kpi + '<div class="hint">Abra o modelo para ver o nome de cada peça.</div>'; return; }
    const k = t.k, linhas = [];
    if (!p.innerHTML) p.innerHTML = kpi + '<div class="hint">Lendo os nomes das peças…</div>';
    for (const g of (t.elementos || [])){
      const mi = F3D.modelos.findIndex(m => m.arquivoId === g.cde_arquivo_id), md = mi >= 0 && F3D.modelos[mi].model; if (!md) continue;
      const falta = g.ids.filter(id => D.nomes[g.cde_arquivo_id + ':' + id] == null);
      for (let a = 0; a < falta.length; a += 400){
        let dd = []; try { dd = await md.getItemsData(falta.slice(a, a + 400), { attributesDefault:true, relationsDefault:{ attributes:false, relations:false } }); } catch (_){}
        (dd || []).forEach(d => { const lid = d && d._localId && d._localId.value; if (lid != null) D.nomes[g.cde_arquivo_id + ':' + lid] = String((d.Name && d.Name.value) || (d.Tag && d.Tag.value) || ''); });
      }
      g.ids.forEach(id => {
        const cl = (D.cat || []).find(c => (c.porMod[mi] || []).includes(id)), rot = cl ? (SING[cl.rot] || cl.rot) : 'Peça';
        const nome = D.nomes[g.cde_arquivo_id + ':' + id] || ('#' + id);
        const txt = new RegExp('^' + rot, 'i').test(nome) ? nome : rot + ' ' + nome, grupo = cl ? cl.rot : 'Outras';
        let l = linhas.find(x => x.grupo === grupo && x.txt === txt);
        if (!l){ l = { grupo, txt, partes:[] }; linhas.push(l); }
        l.partes.push([mi, id]);
      });
    }
    if (D.at !== k || t.aba !== 'pec') return;
    D.linhas = linhas;
    const gr = {}; linhas.forEach((l, i) => { l.i = i; (gr[l.grupo] = gr[l.grupo] || []).push(l); });
    const ntr = linhas.filter(l => trechoL(t, l)).length;
    const kpi2 = kpi.replace('</div>', '') + (ntr ? '<span><b>' + ntr + '</b>em trecho</span>' : '') + '</div>';
    p.innerHTML = kpi2 + Object.keys(gr).map(nome => '<div class="fdGrp">' + esc(nome) + ' · ' + gr[nome].length + '</div>'
      + gr[nome].sort((a, b) => _natural(a.txt, b.txt)).map(l => linhaPeca(t, l)).join('')).join('');
  }
  const chaveL = l => F3D.modelos[l.partes[0][0]].arquivoId + ':' + l.partes[0][1];
  const trechoL = (t, l) => trechoDe(t, F3D.modelos[l.partes[0][0]].arquivoId, l.partes[0][1]);
  function linhaPeca(t, l){
    const arq = F3D.modelos[l.partes[0][0]].arquivoId, id = l.partes[0][1], tr = trechoL(t, l), ant = trechosAntes(t, arq, id), n = ant.length + 1;
    const soma = somaTrechos(t, arq, id), fecha = tr && soma >= 0.999, aberta = D.trAberta === chaveL(l);
    const tag = tr ? (fecha ? '<span class="fdTg ok">trecho ' + n + ' de ' + n + ' · fecha a peça</span>' : '<span class="fdTg tre">trecho ' + n + ' · ' + fracTxt(+tr.frac) + '</span>')
                   : (ant.length ? '<span class="fdTg tre">sem trecho, mas já tem ' + ant.length + ' antes</span>' : '');
    return '<div class="fdLin fdPeca' + (aberta ? ' aberta' : '') + '" onclick="FvsDock.peca(' + l.i + ')" title="Mostrar no modelo' + (t.editavel ? ' e marcar trecho' : '') + '"><div class="fdPl"><span>' + esc(l.txt)
      + (l.partes.length > 1 ? ' <small class="fdPart">· dividida em ' + l.partes.length + ' no modelo</small>' : '') + tag + '</span>'
      + (t.editavel ? '<button class="fdTira" title="Tirar da ficha" onclick="event.stopPropagation();FvsDock.tirarPeca(' + l.i + ')">✕</button>' : '') + '</div>'
      + (tr ? '<div class="fdTr' + (fecha ? ' fecha' : '') + '">' + esc(tr.desc || 'Trecho sem descrição') + (fecha ? ' · com este trecho a peça fica completa' : ' · falta ' + fracTxt(Math.max(0, 1 - soma)) + ' da peça') + '</div>' : '')
      + (aberta && t.editavel ? editorTrecho(t, l, tr, ant, soma) : '') + '</div>';
  }
  function editorTrecho(t, l, tr, ant, soma){
    const i = l.i, f = tr ? +tr.frac || 0.5 : 0;
    return '<div class="fdEd" onclick="event.stopPropagation()"><label>Nesta ficha, a peça foi</label><div class="fdSeg"><button class="' + (tr ? '' : 'on') + '" onclick="FvsDock.trecho(' + i + ',\'inteira\')">Executada inteira</button><button class="' + (tr ? 'on' : '') + '" onclick="FvsDock.trecho(' + i + ',\'trecho\')">Só um trecho</button></div>'
      + (tr ? '<label>Qual trecho</label><input maxlength="120" value="' + esc(tr.desc || '') + '" oninput="FvsDock.trechoDesc(' + i + ',this.value)" placeholder="Ex.: até a junta do eixo 5; primeiro lance até 1,50 m">'
          + '<label>Quanto da peça</label><div class="fdFr">' + [0.25, 0.5, 0.75].map(x => '<button class="' + (Math.abs(f - x) < 0.001 ? 'on' : '') + '" onclick="FvsDock.trechoFrac(' + i + ',' + x + ')">' + fracTxt(x) + '</button>').join('')
          + '<span>ou</span><input type="number" min="1" max="100" value="' + Math.round(f * 100) + '" onchange="FvsDock.trechoFrac(' + i + ',this.value/100)"><span>%</span></div>'
          + '<div class="fdHist">' + ant.map((a, k) => 'Trecho ' + (k + 1) + ': <b>' + esc(a.cod) + '</b>' + (a.data ? ' (' + a.data.split('-').reverse().slice(0, 2).join('/') + ')' : '') + ' · ' + fracTxt(a.frac) + ' · ' + esc(a.desc)).join('<br>') + (ant.length ? '<br>' : '')
          + 'Trecho ' + (ant.length + 1) + ': <b>esta ficha</b> · ' + fracTxt(f) + '<br>'
          + (soma >= 0.999 ? '<b class="ok">Soma ' + Math.round(soma * 100) + '%: a peça fica concluída quando esta ficha for aprovada.</b>' : 'Soma ' + Math.round(soma * 100) + '%: a peça continua aberta até o próximo trecho.') + '</div>'
        : '<div class="hint" style="margin-top:6px">A peça entra inteira: volume total.' + (ant.length ? ' Atenção: ela já aparece em ' + ant.map(a => esc(a.cod)).join(', ') + '.' : '') + '</div>')
      + '</div>';
  }
  function trechoGrupo(t, l, fn){
    l.partes.forEach(([mi, id]) => { const arq = F3D.modelos[mi].arquivoId, g = t.elementos.find(x => x.cde_arquivo_id === arq); if (!g) return; g.trechos = g.trechos || {}; fn(g.trechos, id); });
  }
  function trecho(i, modo){
    const t = atual(), l = (D.linhas || [])[i]; if (!t || !l) return;
    trechoGrupo(t, l, (tr, id) => { if (modo === 'trecho') tr[id] = tr[id] || { frac:0.5, desc:'' }; else delete tr[id]; });
    mudou(t);
  }
  function trechoFrac(i, f){
    const t = atual(), l = (D.linhas || [])[i]; if (!t || !l) return;
    f = Math.max(0.01, Math.min(1, +f || 0.5));
    trechoGrupo(t, l, (tr, id) => { if (tr[id]) tr[id].frac = Math.round(f * 100) / 100; });
    mudou(t);
  }
  function trechoDesc(i, v){
    const t = atual(), l = (D.linhas || [])[i]; if (!t || !l) return;
    trechoGrupo(t, l, (tr, id) => { if (tr[id]) tr[id].desc = String(v || '').slice(0, 120); });
    const el = document.querySelector('#fvsDockHost .fdPeca.aberta .fdTr');   // a linha acompanha o que é digitado
    if (el){ const resto = el.textContent.split(' · ').slice(1).join(' · '); el.textContent = (String(v || '').trim() || 'Trecho sem descrição') + (resto ? ' · ' + resto : ''); }
    marcar();
  }
  const _pm = l => { const pm = {}; (l ? l.partes : []).forEach(([mi, id]) => (pm[mi] = pm[mi] || []).push(id)); return pm; };
  async function peca(i){
    const t = atual(), l = (D.linhas || [])[i]; if (!l) return;
    const k = chaveL(l); D.trAberta = D.trAberta === k ? null : k;
    if (t) pecasLista(t);
    try { await B3.enquadrarIds(F3D, _pm(l)); await fvs3dRefrescar(); } catch (_){}
  }
  function tirarPeca(i){
    const t = atual(), l = (D.linhas || [])[i]; if (!t || !l) return;
    Object.entries(_pm(l)).forEach(([mi, ids]) => { const a = F3D.modelos[mi], g = a && t.elementos.find(x => x.cde_arquivo_id === a.arquivoId); if (g){ const s = new Set(ids); g.ids = g.ids.filter(x => !s.has(x)); } });
    mudou(t);
  }

  // ── IT dentro da ficha ────────────────────────────────────────────────────
  const IT = { docs:{}, txt:{} };
  const nrm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9,.±]+/g, ' ').trim();
  const VAZIAS = new Set(['para','com','sem','dos','das','que','nao','uma','por','conforme','projeto','executivo','100','visual']);
  const tok = s => [...new Set(nrm(s).split(' ').filter(w => w.length > 2 && !VAZIAS.has(w)))];
  async function itAbrir(t, item){
    const p = document.querySelector('#fvsDockHost .fdPane[data-p=it]'); if (!p) return;
    const m = modeloDe(t); if (!m.it_id) return;
    if (p._abrindo) await p._abrindo;
    if (p.dataset.doc !== m.it_id){ p._abrindo = itCarregar(t, p, m, item); await p._abrindo; p._abrindo = null; if (p.dataset.doc !== m.it_id) return; }
    if (item != null) itAcender(t, p, item);
  }
  async function itCarregar(t, p, m, item){
      p.innerHTML = '<div class="hint">Abrindo a IT…</div>';
      try {
        if (!ITS_OBRA) await itsCarregar();
        const i = (ITS_OBRA || []).find(x => x.id === m.it_id);
        if (!i || !i.vig){ p.innerHTML = '<div class="hint">' + (ITS_SEM_ACESSO ? 'Você não tem acesso à biblioteca normativa deste grupo.' : 'IT sem revisão vigente.') + '</div>'; return; }
        const ext = AuriaIT.extDe(i.vig.arquivo_path);
        if (ext !== 'pdf'){ p.innerHTML = '<div class="hint">Esta IT não é PDF.</div><button class="b2" onclick="AuriaIT.ver(sb,\'' + i.vig.id + '\',{ext:\'' + ext + '\',codigo:\'' + esc(i.codigo) + '\',titulo:\'\'})">Abrir a IT</button>'; return; }
        let d = IT.docs[i.vig.id];
        if (!d){ d = await pdfjsLib.getDocument({ data: await AuriaIT.bytes(sb, i.vig.id) }).promise; IT.docs[i.vig.id] = d; }
        p.dataset.doc = m.it_id; p._doc = d; p._rev = i.vig.id;
        p.innerHTML = '<div class="fdItBar"><b>' + esc(i.codigo) + ' · rev. ' + esc(i.vig.revisao) + '</b><span id="fdItPg">' + d.numPages + ' página(s)</span><span style="margin-left:auto"></span><button class="b2 mini" onclick="itsCopia(\'' + i.id + '\')">Cópia controlada</button></div>'
          + Array.from({ length:d.numPages }, (_, k) => '<div class="fdIt" data-n="' + (k + 1) + '" style="min-height:' + Math.round((p.clientWidth - 28) * 1.41) + 'px"></div>').join('');
        const ob = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting){ ob.unobserve(e.target); itPagina(p, e.target); } }), { root:p, rootMargin:'400px' });
        p.querySelectorAll('.fdIt').forEach(e => ob.observe(e));
        if (item == null){ const pg = (m.it_paginas || [])[0]; if (pg > 1){ const e = p.querySelector('.fdIt[data-n="' + pg + '"]'); if (e) p.scrollTop = e.offsetTop - p.offsetTop; } }
      } catch (e){ console.warn('IT na ficha:', e); p.dataset.doc = ''; p.innerHTML = '<div class="hint">Não foi possível abrir a IT — ' + esc(e.message || e) + '</div>'; }
  }
  async function itPagina(p, div){
    if (div.dataset.ok) return; div.dataset.ok = '1';
    const pg = await p._doc.getPage(+div.dataset.n), w = div.clientWidth || p.clientWidth - 28, v1 = pg.getViewport({ scale:1 });
    const esc2 = w / v1.width, dpr = Math.min(window.devicePixelRatio || 1, 2), vp = pg.getViewport({ scale:esc2 * dpr });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await pg.render({ canvasContext:c.getContext('2d'), viewport:vp }).promise;
    div.dataset.esc = esc2; div.style.minHeight = ''; div.insertBefore(c, div.firstChild);
  }
  async function itTexto(p, n){
    const k = p._rev + ':' + n; if (IT.txt[k]) return IT.txt[k];
    const pg = await p._doc.getPage(n), tc = await pg.getTextContent();
    return (IT.txt[k] = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ w:new Set(nrm(i.str).split(' ')), x:i.transform[4], y:i.transform[5], wd:i.width, h:i.height || Math.abs(i.transform[3]) })));
  }
  // mesmo critério do painel da Qualidade: janela curta de linhas com mais palavras do item
  async function itAcender(t, p, i){
    const it = (FVS_INSP.find(x => x.id === t.id) || {}).itens || [], a = it[i]; if (!a || !p._doc) return;
    const peso = new Map(); tok([a.criterio, a.metodo, a.tolerancia].join(' ')).forEach(w => peso.set(w, 1)); tok(a.item).forEach(w => peso.set(w, 3));
    const total = [...peso.values()].reduce((x, y) => x + y, 0); if (!total) return;
    const ref = modeloDe(t).it_paginas || [], ordem = ref.concat(Array.from({ length:p._doc.numPages }, (_, k) => k + 1).filter(n => !ref.includes(n)));
    const lb = $('fdItPg'); if (lb) lb.textContent = 'Procurando o trecho…';
    let best = null;
    for (const n of ordem){
      const its = await itTexto(p, n);
      for (let x = 0; x < its.length; x++){ const v = new Set(); let sc = 0;
        for (let y = x; y < Math.min(its.length, x + 8); y++){ its[y].w.forEach(w => { if (peso.has(w) && !v.has(w)){ v.add(w); sc += peso.get(w); } });
          const nota = sc / total - (y - x) * 0.015; if (!best || nota > best.nota) best = { nota, n, x, y }; } }
      if (best && best.nota >= 0.6 && ref.includes(n)) break;
    }
    p.querySelectorAll('.hl').forEach(e => e.remove());
    if (!best || best.nota < 0.3){ if (lb) lb.textContent = 'Trecho do item ' + (i + 1) + ' não encontrado'; const e = ref[0] && p.querySelector('.fdIt[data-n="' + ref[0] + '"]'); if (e) p.scrollTop = e.offsetTop - p.offsetTop; return; }
    const div = p.querySelector('.fdIt[data-n="' + best.n + '"]'); await itPagina(p, div);
    const pg = await p._doc.getPage(best.n), vp = pg.getViewport({ scale:+div.dataset.esc || 1 }), its = await itTexto(p, best.n); let topo = Infinity;
    its.slice(best.x, best.y + 1).filter(r => [...r.w].some(w => peso.has(w)) || best.y - best.x < 3).forEach(r => {
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle([r.x, r.y - r.h * 0.25, r.x + r.wd, r.y + r.h]);
      const e = document.createElement('div'); e.className = 'hl'; const tp = Math.min(y1, y2);
      e.style.cssText = 'left:' + Math.min(x1, x2) + 'px;top:' + tp + 'px;width:' + Math.abs(x2 - x1) + 'px;height:' + Math.abs(y2 - y1) + 'px';
      div.appendChild(e); topo = Math.min(topo, tp); });
    if (lb) lb.textContent = 'Item ' + (i + 1) + ' · página ' + best.n + ' de ' + p._doc.numPages;
    // salto direto: rolagem suave é interrompida enquanto as páginas acima terminam de desenhar
    const ir = () => { if (topo < Infinity) p.scrollTop += div.getBoundingClientRect().top - p.getBoundingClientRect().top + topo - p.clientHeight / 3; };
    ir(); setTimeout(ir, 350);
  }
  function verIt(i){ aba('it', i); }

  // ── concreto da ficha 009 ─────────────────────────────────────────────────
  async function concretoAbrir(t){
    const p = document.querySelector('#fvsDockHost .fdPane[data-p=conc]'); if (!p) return;
    p.innerHTML = '<div class="hint">Carregando…</div>';
    try { await concCarregar(); } catch (_){}
    const k = t.k, lista = CONCS.filter(c => c.pavimento_id === t.pavId), c = CONCS.find(x => x.id === t.conc);
    const pick = t.editavel ? '<div class="seg-form" style="padding:0"><label>Concretagem desta ficha</label><select onchange="FvsDock.ligar(this.value)"><option value="">Nenhuma</option>'
        + lista.map(x => '<option value="' + x.id + '"' + (x.id === t.conc ? ' selected' : '') + '>' + esc(x.codigo + ' · ' + (x.descricao || concLocal(x) || '')) + '</option>').join('') + '</select></div>' : '';
    if (!c){ p.innerHTML = pick + '<div class="hint" style="margin-top:8px">' + (lista.length ? 'Escolha a concretagem para trazer caminhões, corpos de prova e o mapa.' : 'Este pavimento ainda não tem concretagem planejada.') + '</div>'; return; }
    await camCarregar(c.id); if (D.at !== k) return;
    const ok = CAMS.filter(x => x.aceito), rec = camVolume(), prev = +c.volume_previsto || 0, cps = CAMS.reduce((s, x) => s + (+x.cps_moldados || 0), 0);
    p.innerHTML = pick + '<div class="fdKpi"><span><b>' + concM3(prev) + '</b>previsto</span><span><b>' + concM3(rec) + '</b>recebido</span>' + (c.fck_mpa ? '<span><b>C' + esc(c.fck_mpa) + '</b>fck</span>' : '') + '<span><b>' + cps + '</b>CPs</span></div>'
      + (ok.length ? '<button class="b2" onclick="FvsDock.mapa(\'' + c.id + '\')">Ver mapa de concretagem no modelo</button> ' : '') + '<button class="b2" onclick="concDetalhe(\'' + c.id + '\')">Abrir concretagem</button>'
      + '<div class="cam-lista" style="margin-top:8px">' + (CAMS.length ? CAMS.map(x => '<div class="cam-it' + (x.aceito ? '' : ' rec') + '" onclick="camDetalhe(\'' + x.id + '\')"><i style="background:' + (x.aceito ? camCorCss(x.seq) : '#94A3B8') + '">' + x.seq + '</i><div><b>' + (x.nf ? 'NF ' + esc(x.nf) : 'sem NF') + (x.placa ? ' · ' + esc(x.placa) : '') + '</b><span>' + (x.aceito ? 'saída ' + camHora(x.saida_usina) + ' → fim ' + camHora(x.fim_descarga) + (x.slump_mm != null ? ' · slump ' + x.slump_mm : '') + ' · ' + (x.cps_moldados || 0) + ' CP(s)' : 'recusado') + '</span></div></div>').join('') : '<div class="hint">Nenhum caminhão registrado.</div>') + '</div>';
  }
  function ligar(id){ const t = atual(); if (!t) return; t.conc = id || null; marcar(); concretoAbrir(t); }
  async function mapa(id){ D.sel = false; const s = $('fvsSel'); if (s) s.classList.remove('on'); await camMapa3D(id); try { segSairModo(); } catch (_){} }

  // ── saídas da página ──────────────────────────────────────────────────────
  window.addEventListener('beforeunload', e => { if (D.abas.some(sujo)){ e.preventDefault(); e.returnValue = ''; } });
  const _emp = trocarEmp;
  trocarEmp = function(){
    const novo = $('selEmp').value;
    if (D.abas.length && EMP && novo !== EMP.id){
      if (D.abas.some(sujo) && !confirm('Há fichas com alterações não salvas. Trocar de empreendimento e perder as alterações?')){ $('selEmp').value = EMP.id; return; }
      D.abas = []; D.at = null; D.catChave = ''; D.todos = {}; selParar(); const h = $('fvsDockHost'); if (h) h.innerHTML = ''; mostrar(false); barra();
    }
    return _emp.apply(this, arguments);
  };

  async function predio(){ const t = atual(); if (!t) return; D.soPav = !D.soPav; await pintar(t, true); selBarra(t); }
  const _mod = obraModulo;
  obraModulo = function(k){ if (k === 'qualidade'){ menu(); return; } return _mod.apply(this, arguments); };
  document.addEventListener('mousedown', e => { const l = $('fdServL'); if (l && !e.target.closest('.fdBusca')) l.classList.remove('on'); });
  window.FvsDock = { ir, fechar, aba, recolher, classe, todas, verIt, ligar, mapa, predio, campo, busca, menu, peca, tirarPeca, trecho, trechoFrac, trechoDesc,
    nova(){ fvsNova(); },
    modelo(){ const t = atual(); document.body.classList.add('fvs-ver-modelo'); try { mobTab('prancha'); } catch (_){} if (t) modelo(t); barra(); },
    _estado:D };
})();
