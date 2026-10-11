// ============================================================================
//  auria_cde_normas.js — Normas do grupo (Biblioteca normativa) dentro do CDE
//  ----------------------------------------------------------------------------
//  Botão "Normas" na barra superior → painel lateral com busca (nome e Aa no
//  conteúdo), filtros Grupo/Victa e tipo. Ao escolher, o documento abre numa
//  janela do CDE (canvas, zoom, páginas, lado a lado), só leitura:
//    • PDF vem carimbado "CÓPIA NÃO CONTROLADA" pela Edge Function it-copia
//      (provider 'norma' em cdePdfBytes — nunca entra no cache de pranchas);
//    • sem apontar, sem pins, sem "Analisar no App", sem Detalhes/status;
//    • barra da janela ganha "Cópia controlada" com a obra do CDE já escolhida.
//  Planilha/Word abrem nos leitores (auria_planilha.js / auria_word.js).
//  Depende de: cde.html (CdeWin, cdePdfBytes, atualizarToolbar…), auria_itcopia.js.
// ============================================================================
(function(){
  let NORMAS = null, GRUPO_ID = null, PAINEL = null;
  const F = { q:'', cont:false, fam:'', tipo:'' };

  // ── Bytes da norma: sempre pela it-copia (carimbada), nunca do cache ──────
  const _bytes = cdePdfBytes;
  cdePdfBytes = async function(path, provider){
    if (provider === 'norma') return { bytes: await AuriaIT.bytes(sb, path.slice(6)), bbox:{}, doCache:false };
    return _bytes(path, provider);
  };

  // ── Janela do CDE com uma norma ──────────────────────────────────────────
  CdeWin.prototype.setNorma = async function(it){
    const v = it.vig;
    this.DOC_SEL = { id:'norma:' + v.id, codigo: it.codigo + ' · rev. ' + v.revisao, titulo: it.titulo, _norma:true, _it:it, atual:null, revs:[] };
    this.titleEl.textContent = this.DOC_SEL.codigo;
    this.subEl.textContent = it.titulo || '';
    this.statusEl.textContent = 'NORMA'; this.statusEl.style.background = '#1E3A5F';
    if (this.analiseEl) this.analiseEl.classList.remove('on');
    if (this.marcaEl) this.marcaEl.classList.remove('on');
    if (this.ressalvaEl) this.ressalvaEl.classList.remove('on');
    atualizarTaskbar();
    this.VIEW_FILES = { pdf: { path:'norma:' + v.id, nome: it.codigo, provider:'norma', arqId:null, rotacao:0 } };
    this.VIEW_FRAG = null; this.CDE_APTS = []; this.CDE_PRANCHA_ID = null; this.BUSCA_HL = null;
    this.renderPinsCDE();
    await this.abrirFormato('pdf');
  };

  // Destaque das ocorrências: o PDF da norma tem camada de texto, então as caixas
  // saem do próprio pdf.js (sem OCR). Coordenadas 0..1 da página = referencial
  // dos pins/BUSCA_HL do CDE; reaproveita renderPinsCDE + barra "n ocorrências ◀ ▶".
  CdeWin.prototype.destacarTermo = async function(termo){
    const norm = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const termos = norm(termo).split(/\s+/).map(t => t.replace(/[^a-z0-9]/g, '')).filter(t => t.length >= 2);
    if (!termos.length || !this.V.doc) return;
    const hl = [];
    for (let p = 1; p <= Math.min(this.V.doc.numPages, 60); p++){
      const pg = await this.V.doc.getPage(p), vp = pg.getViewport({ scale:1 }), tc = await pg.getTextContent();
      tc.items.forEach(it => {
        const s = norm(it.str || ''); if (!s.trim()) return;
        const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
        const fh = Math.hypot(tx[2], tx[3]) || 8, w = (it.width || 0) * vp.scale;
        termos.forEach(t => {
          let k = s.indexOf(t);
          while (k >= 0){
            const x0 = tx[4] + w * (k / s.length), x1 = tx[4] + w * Math.min(1, (k + t.length) / s.length);
            hl.push({ p, x0: x0 / vp.width, y0: (tx[5] - fh) / vp.height, x1: x1 / vp.width, y1: (tx[5] + fh * 0.2) / vp.height });
            k = s.indexOf(t, k + t.length);
          }
        });
      });
    }
    hl.sort((a, b) => a.p - b.p || a.y0 - b.y0 || a.x0 - b.x0);
    this.BUSCA_HL = hl; this.BUSCA_HL_I = -1;
    this.renderPinsCDE(); this._hlBarra();
    const b = this.stage && this.stage.querySelector('.cdeHlBar span');
    if (b) b.textContent = hl.length ? hl.length + ' ocorrência' + (hl.length > 1 ? 's' : '') + ' de “' + termo + '”' : 'Nenhuma ocorrência de “' + termo + '” no texto';
    if (hl.length) this.irDestaque(1);
  };
  async function abrirNoCanvas(it, termo){
    const ext = AuriaIT.extDe(it.vig.arquivo_path);
    if (ext !== 'pdf'){
      if (AuriaIT.podeVer(ext)) AuriaIT.ver(sb, it.vig.id, { ext, codigo: it.codigo + ' · rev. ' + it.vig.revisao, titulo: it.titulo });
      else copiaControlada(it);
      return;
    }
    const existe = WIN_STATE.list.find(w => w.DOC_SEL && w.DOC_SEL.id === 'norma:' + it.vig.id);
    if (existe){ if (existe.state === 'min') existe.restaurar(); focar(existe); if (termo) existe.destacarTermo(termo); return; }
    try { mobileMostrarPrancha(); } catch (_){}
    const w = new CdeWin();
    focar(w); atualizarVempty(); atualizarTaskbar();
    await w.setNorma(it);
    if (termo) await w.destacarTermo(termo);
  }
  function copiaControlada(it){
    AuriaIT.copia(sb, { revId: it.vig.id, codigo: it.codigo + ' rev. ' + it.vig.revisao, titulo: it.titulo, grupoId: GRUPO_ID, empId: EMP_ID });
  }
  function solicitar(it, pagina){
    AuriaIT.solicitar(sb, { itId: it.id, codigo: it.codigo + ' rev. ' + it.vig.revisao, titulo: it.titulo, pagina, empId: EMP_ID,
      aoEnviar: async () => { try { SOLS = await AuriaIT.solicitacoesAbertas(sb, NORMAS.map(i => i.id)); } catch (_){} } });
  }
  window.cdeNormaSolicitar = function(){
    const w = cdeAtiva(); if (w && w.DOC_SEL && w.DOC_SEL._norma) solicitar(w.DOC_SEL._it, w.V && w.V.pageNum ? 'pág. ' + w.V.pageNum : '');
  };
  window.cdeNormaCopia = function(){
    const w = cdeAtiva(); if (w && w.DOC_SEL && w.DOC_SEL._norma) copiaControlada(w.DOC_SEL._it);
  };

  // ── Barra da janela: norma é só leitura ──────────────────────────────────
  const _tb = atualizarToolbar;
  atualizarToolbar = function(){
    _tb();
    const w = cdeAtiva(), norma = !!(w && w.DOC_SEL && w.DOC_SEL._norma);
    ['btnAnalisar','btnApontarCde','btnHistCde'].forEach(id => { const e = document.getElementById(id); if (e && norma) e.style.display = 'none'; });
    const det = document.querySelector('#vtool button[onclick="abrirDetalhes()"]'); if (det) det.style.display = norma ? 'none' : '';
    let bc = document.getElementById('btnNormaCopia');
    if (!bc && det){
      bc = document.createElement('button'); bc.id = 'btnNormaCopia'; bc.className = 'tb'; bc.onclick = window.cdeNormaCopia;
      bc.title = 'Emitir cópia controlada desta norma para a obra'; bc.textContent = '🖨 Cópia controlada';
      det.parentNode.insertBefore(bc, det);
    }
    if (bc) bc.style.display = norma ? '' : 'none';
    let bs = document.getElementById('btnNormaSol');
    if (!bs && bc){
      bs = document.createElement('button'); bs.id = 'btnNormaSol'; bs.className = 'tb'; bs.onclick = window.cdeNormaSolicitar;
      bs.title = 'Pedir à Qualidade que revise esta norma (vai com a página aberta)'; bs.textContent = 'Solicitar revisão';
      bc.parentNode.insertBefore(bs, bc.nextSibling);
    }
    if (bs) bs.style.display = norma ? '' : 'none';
    if (norma){ const st = document.getElementById('vSt'); if (st){ st.textContent = 'NORMA'; st.style.background = '#1E3A5F'; } }
  };
  const _ap = toggleApontarCde;
  toggleApontarCde = function(){ const w = cdeAtiva(); if (w && w.DOC_SEL && w.DOC_SEL._norma) return; return _ap(); };

  // ── Central de busca de normas ───────────────────────────────────────────
  //  Uma busca só (código + título + conteúdo, sem acento, por prefixo, por
  //  relevância — RPC it_buscar2), filtros em chips com contagem, lista à
  //  esquerda com trecho, pré-visualização à direita. ↑↓ navega, Enter abre.
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const marca = t => esc(t).replace(/«/g, '<mark>').replace(/»/g, '</mark>');
  let RES = [], SEL = 0, TERMO = '';
  function css(){
    if (document.getElementById('nrmCss')) return;
    const st = document.createElement('style'); st.id = 'nrmCss';
    st.textContent = '#nrmOv{position:fixed;inset:0;background:rgba(11,18,32,.55);z-index:9300;display:none;align-items:flex-start;justify-content:center;padding:6vh 16px 16px}'
      + '#nrmOv.on{display:flex}#nrmBox{background:#fff;border-radius:14px;width:min(1100px,100%);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 0 0 2px #E8762B,0 24px 60px rgba(0,0,0,.35);font-family:inherit;color:#1E293B}'
      + '#nrmBox .sb{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #E2E8F0}'
      + '#nrmBox .sb input{flex:1;border:none;outline:none;font:inherit;font-size:17px;padding:6px 0}#nrmBox .sb .k{font-size:11.5px;color:#94A3B8;white-space:nowrap}'
      + '#nrmBox .sb button{border:1px solid #CBD5E1;background:#fff;border-radius:8px;padding:5px 10px;cursor:pointer;font:inherit}'
      + '#nrmBox .ch{display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px;border-bottom:1px solid #F1F5F9}'
      + '#nrmBox .chip{font-size:12px;padding:4px 11px;border-radius:99px;border:1px solid #CBD5E1;background:#fff;color:#475569;cursor:pointer;font-family:inherit}'
      + '#nrmBox .chip.on{background:#1E3A5F;border-color:#1E3A5F;color:#fff}#nrmBox .chip[disabled]{opacity:.45;cursor:default}#nrmBox .sep{width:12px}'
      + '#nrmBox .bd{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);min-height:0;flex:1}'
      + '#nrmBox .ls{overflow:auto;border-right:1px solid #E2E8F0}#nrmBox .pv{overflow:auto;padding:14px 18px}'
      + '#nrmBox .gr{font-size:11.5px;color:#94A3B8;padding:10px 14px 4px;text-transform:uppercase;letter-spacing:.04em}'
      + '#nrmBox .r{padding:9px 14px;border-bottom:1px solid #F1F5F9;cursor:pointer;border-left:3px solid transparent}'
      + '#nrmBox .r:hover{background:#F8FAFC}#nrmBox .r.sel{background:#FFF8F2;border-left-color:#E8762B}'
      + '#nrmBox .cod{font-family:ui-monospace,Menlo,monospace;font-weight:700;color:#1E3A5F;font-size:12.5px}'
      + '#nrmBox .fam{font-size:10.5px;font-weight:800;border-radius:99px;padding:1px 7px;margin-left:6px}'
      + '#nrmBox .fam.g{background:#E8F0F8;color:#1E3A5F}#nrmBox .fam.v{background:#FEF0D9;color:#8A5A04}'
      + '#nrmBox .tt{font-size:13.5px;margin-top:1px}#nrmBox .tr{font-size:12px;color:#64748B;margin-top:3px;line-height:1.45}'
      + '#nrmBox mark{background:#FDE7D3;color:#9A3412;border-radius:3px;padding:0 2px}'
      + '#nrmBox .pv h3{margin:2px 0 12px;font-size:16px}#nrmBox .tc{font-size:12.8px;line-height:1.6;border-left:2px solid #E8762B;padding-left:10px;margin:0 0 10px}'
      + '#nrmBox .ac{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}#nrmBox .ac button{border:1px solid #CBD5E1;background:#fff;border-radius:9px;padding:8px 14px;cursor:pointer;font:inherit;font-size:13px;font-weight:600}'
      + '#nrmBox .ac .p{background:#1E3A5F;border-color:#1E3A5F;color:#fff}#nrmBox .vz{color:#64748B;font-size:13px;padding:18px 14px;line-height:1.5}'
      + '@media (max-width:760px){#nrmBox .bd{grid-template-columns:1fr}#nrmBox .pv{display:none}#nrmBox .sb .k{display:none}}';
    document.head.appendChild(st);
  }
  async function carregar(){
    if (!GRUPO_ID){
      const { data } = await sb.from('empreendimentos_auria').select('empresa_id').eq('id', EMP_ID).maybeSingle();
      GRUPO_ID = data && data.empresa_id;
    }
    const { data, error } = await sb.from('grupo_it_auria').select('id,codigo,titulo,tipo,familia,palavras,ativo,grupo_it_revisao_auria(id,revisao,arquivo_path,vigente)')
      .eq('grupo_id', GRUPO_ID).eq('ativo', true);
    if (error) throw error;
    NORMAS = (data || []).map(i => Object.assign(i, { vig: (i.grupo_it_revisao_auria || []).find(r => r.vigente) || null }))
      .filter(i => i.vig && i.vig.arquivo_path)
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric:true }));
    SEM_ACESSO = false;
    if (!NORMAS.length){ try { const a = await sb.rpc('it_meu_acesso', { p_grupo: GRUPO_ID }); SEM_ACESSO = a.data === false; } catch (_){} }
    try { SOLS = await AuriaIT.solicitacoesAbertas(sb, NORMAS.map(i => i.id)); } catch (_){ SOLS = {}; }
  }
  let SOLS = {}, SEM_ACESSO = false;
  const $o = s => PAINEL.querySelector(s);
  async function buscar(){
    const q = F.q.trim(); TERMO = q;
    let base;
    if (q.length >= 2){
      const r = await sb.rpc('it_buscar2', { p_grupo: GRUPO_ID, p_q: q });
      if (TERMO !== q) return;                                  // digitação mais nova já em curso
      const por = new Map(NORMAS.map(i => [i.id, i]));
      base = (r.data || []).filter(x => por.has(x.it_id)).map(x => Object.assign({}, por.get(x.it_id), { _tit: x.no_titulo, _tr: (x.trechos || '').split(' ¦ ').filter(Boolean) }));
    } else base = NORMAS.map(i => Object.assign({}, i, { _tit: true, _tr: [] }));
    // contagens dos chips sobre o resultado da busca (antes dos filtros)
    const cTipo = {}, cFam = { grupo:0, victa:0 };
    base.forEach(i => { cTipo[i.tipo || 'IT'] = (cTipo[i.tipo || 'IT'] || 0) + 1; cFam[i.familia || 'grupo']++; });
    const tipos = [...new Set(NORMAS.map(i => i.tipo || 'IT'))].sort();
    $o('.ch').innerHTML = '<button class="chip' + (!F.tipo ? ' on' : '') + '" data-t="">Todos ' + base.length + '</button>'
      + tipos.map(t => '<button class="chip' + (F.tipo === t ? ' on' : '') + '" data-t="' + esc(t) + '"' + (cTipo[t] ? '' : ' disabled') + '>' + esc(t) + ' ' + (cTipo[t] || 0) + '</button>').join('')
      + '<span class="sep"></span><button class="chip' + (!F.fam ? ' on' : '') + '" data-f="">Grupo e Victa</button>'
      + '<button class="chip' + (F.fam === 'grupo' ? ' on' : '') + '" data-f="grupo">Grupo ' + cFam.grupo + '</button>'
      + '<button class="chip' + (F.fam === 'victa' ? ' on' : '') + '" data-f="victa">Victa ' + cFam.victa + '</button>';
    $o('.ch').querySelectorAll('[data-t]').forEach(b => b.onclick = () => { F.tipo = b.dataset.t; buscar(); });
    $o('.ch').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { F.fam = b.dataset.f; buscar(); });
    RES = base.filter(i => (!F.tipo || (i.tipo || 'IT') === F.tipo) && (!F.fam || (i.familia || 'grupo') === F.fam));
    SEL = 0; lista();
  }
  function linha(i, k){
    return '<div class="r' + (k === SEL ? ' sel' : '') + '" data-k="' + k + '"><span class="cod">' + esc(i.codigo) + ' · rev. ' + esc(i.vig.revisao) + '</span>'
      + '<span class="fam ' + ((i.familia || 'grupo') === 'victa' ? 'v">Victa' : 'g">Grupo') + '</span>'
      + '<div class="tt">' + esc(i.titulo) + AuriaIT.chipNorma(SOLS[i.id]) + '</div>' + (i._tr[0] ? '<div class="tr">…' + marca(i._tr[0]) + '…</div>' : '') + '</div>';
  }
  function lista(){
    const q = F.q.trim();
    if (!RES.length){ $o('.ls').innerHTML = '<div class="vz">' + (q.length >= 2 ? 'Nenhuma norma com “' + esc(q) + '”. Tente outra palavra ou só o começo dela (ex.: “compact”).' : (SEM_ACESSO ? 'Você não tem acesso à biblioteca normativa deste grupo. Fale com o gestor do empreendimento.' : NORMAS.length ? 'Nenhum documento neste filtro.' : 'O grupo ainda não cadastrou normas.')) + '</div>'; $o('.pv').innerHTML = ''; return; }
    let h = '', k = 0;
    if (q.length >= 2){
      const tit = RES.filter(i => i._tit), cont = RES.filter(i => !i._tit);
      RES = tit.concat(cont);
      if (tit.length) h += '<div class="gr">No código ou título · ' + tit.length + '</div>' + tit.map(i => linha(i, k++)).join('');
      if (cont.length) h += '<div class="gr">No texto dos documentos · ' + cont.length + '</div>' + cont.map(i => linha(i, k++)).join('');
    } else h = '<div class="gr">' + RES.length + ' documentos vigentes</div>' + RES.map(i => linha(i, k++)).join('');
    $o('.ls').innerHTML = h;
    $o('.ls').querySelectorAll('.r').forEach(el => { el.onclick = () => selecionar(+el.dataset.k); el.ondblclick = () => abrirSel(); });
    previa();
  }
  function selecionar(k){
    SEL = Math.max(0, Math.min(RES.length - 1, k));
    $o('.ls').querySelectorAll('.r').forEach(el => el.classList.toggle('sel', +el.dataset.k === SEL));
    const el = $o('.ls .r.sel'); if (el) el.scrollIntoView({ block:'nearest' });
    previa();
  }
  function previa(){
    const i = RES[SEL]; if (!i){ $o('.pv').innerHTML = ''; return; }
    const ext = AuriaIT.extDe(i.vig.arquivo_path);
    $o('.pv').innerHTML = '<div class="cod" style="font-size:13.5px">' + esc(i.codigo) + ' · rev. ' + esc(i.vig.revisao)
      + ' <span class="fam ' + ((i.familia || 'grupo') === 'victa' ? 'v">Victa' : 'g">Grupo') + '</span> <span class="fam g">vigente</span></div>'
      + '<h3>' + esc(i.titulo) + AuriaIT.chipNorma(SOLS[i.id]) + '</h3>'
      + (i._tr.length ? '<div style="font-size:12px;color:#94A3B8;margin-bottom:8px">' + i._tr.length + ' trecho' + (i._tr.length > 1 ? 's' : '') + ' encontrado' + (i._tr.length > 1 ? 's' : '') + '</div>' + i._tr.map(t => '<p class="tc">…' + marca(t) + '…</p>').join('')
         : '<div style="font-size:13px;color:#64748B">' + (F.q.trim().length >= 2 ? 'Encontrado no código ou título.' : 'Escolha um documento ou digite para buscar dentro dos textos.') + '</div>')
      + '<div class="ac">' + (ext === 'pdf' || AuriaIT.podeVer(ext) ? '<button class="p" data-a="abrir">' + (ext === 'pdf' ? 'Abrir no canvas' : 'Abrir') + '</button>' : '<span style="font-size:12.5px;color:#64748B;align-self:center">.' + esc(ext) + ' sem visualização — baixe pela cópia controlada</span>')
      + '<button data-a="copia">🖨 Cópia controlada</button><button data-a="sol">Solicitar revisão</button></div>'
      + (ext === 'pdf' && F.q.trim().length >= 2 ? '<div style="font-size:11.5px;color:#94A3B8;margin-top:8px">Abre com as ocorrências destacadas na página (◀ ▶ entre elas).</div>' : '');
    const a = $o('.pv [data-a="abrir"]'); if (a) a.onclick = abrirSel;
    $o('.pv [data-a="copia"]').onclick = () => copiaControlada(i);
    $o('.pv [data-a="sol"]').onclick = () => solicitar(i, '');
  }
  function abrirSel(){ const i = RES[SEL]; if (!i) return; fechar(); abrirNoCanvas(i, F.q.trim()); }
  function fechar(){ if (PAINEL) PAINEL.classList.remove('on'); }
  window.abrirNormas = async function(){
    css();
    if (!PAINEL){
      PAINEL = document.createElement('div'); PAINEL.id = 'nrmOv';
      PAINEL.innerHTML = '<div id="nrmBox"><div class="sb"><span style="font-size:18px;color:#94A3B8">⌕</span>'
        + '<input type="search" placeholder="Buscar normas — código, título ou qualquer palavra do texto (ex.: slump, prumo, impermeabilização)" autocomplete="off">'
        + '<span class="k">↑↓ navega · Enter abre · Esc fecha</span><button data-x>Fechar</button></div>'
        + '<div class="ch"></div><div class="bd"><div class="ls"><div class="vz">Carregando…</div></div><div class="pv"></div></div></div>';
      document.body.appendChild(PAINEL);
      PAINEL.onclick = e => { if (e.target === PAINEL) fechar(); };
      $o('[data-x]').onclick = fechar;
      const inp = $o('input');
      inp.oninput = () => { F.q = inp.value; clearTimeout(window._nrmT); window._nrmT = setTimeout(buscar, 200); };
      inp.onkeydown = e => {
        if (e.key === 'ArrowDown'){ e.preventDefault(); selecionar(SEL + 1); }
        else if (e.key === 'ArrowUp'){ e.preventDefault(); selecionar(SEL - 1); }
        else if (e.key === 'Enter'){ e.preventDefault(); abrirSel(); }
        else if (e.key === 'Escape'){ fechar(); }
      };
    }
    PAINEL.classList.add('on');
    setTimeout(() => { const inp = $o('input'); inp.focus(); inp.select(); }, 30);
    try { if (!NORMAS) await carregar(); await buscar(); }
    catch (e){ $o('.ls').innerHTML = '<div class="vz">Não foi possível carregar: ' + esc(e.message || e) + '</div>'; }
  };
})();
