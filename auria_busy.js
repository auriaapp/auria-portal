/* ============================================================================
 *  auria_busy.js — "o sistema está processando" (item 157, 2026-09-26)
 *
 *  O RELATO: "coloquei ok e não apareceu mais nenhuma mensagem… Nosso sistema
 *  em geral possui essa falha, de não sabermos quando está processando."
 *  Era verdade em toda a plataforma: entre o clique e o alerta de sucesso não
 *  havia sinal nenhum — dava para achar que travou e clicar de novo.
 *
 *  COMO FUNCIONA: este arquivo embrulha window.fetch e conta as chamadas em
 *  voo. Não foi preciso tocar em nenhum dos ~400 pontos de chamada das telas:
 *  supabase-js (rpc, select, insert, functions.invoke) e todo fetch direto
 *  passam por aqui. Por isso ele tem de carregar ANTES do supabase-js.
 *
 *  POR QUE NÃO É BLOQUEANTE: um véu por cima da tela a cada select deixaria o
 *  sistema pior. É uma pastilha no alto, acima dos modais, que só aparece
 *  quando a espera é perceptível (350 ms) e fica no mínimo 400 ms para não
 *  piscar. Chamada rápida continua invisível — que é o certo.
 *
 *  A MARCA: o Λ do Auria desenhado em SVG (não o logo_symbol.png, que tem
 *  1,2 MB e não caberia num indicador), com um clarão percorrendo a fita da
 *  perna esquerda ao topo e descendo pela direita.
 *
 *  Para trabalho que não é rede (render de PDF, cálculo pesado):
 *      AuriaBusy.start('Gerando o PDF…');  …  AuriaBusy.stop();
 * ========================================================================== */
(function(){
  if (window.AuriaBusy) return;

  var LIMIAR = 350;    // só mostra se passar disto — evita piscar no que é rápido
  var MIN_VIS = 400;   // uma vez visível, fica ao menos isto
  var emVoo = 0, manuais = 0, timer = null, desde = 0, saida = null, el = null, txtEl = null;

  function montar(){
    if (el) return el;
    var st = document.createElement('style');
    st.textContent =
      '@keyframes auria-busy-fita{from{stroke-dashoffset:100}to{stroke-dashoffset:-40}}' +
      '@keyframes auria-busy-entra{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}' +
      '#auria-busy{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99999;' +
        'display:none;align-items:center;gap:9px;padding:7px 14px 7px 10px;' +
        'background:#fff;color:#1E3A5F;border:1px solid #E2E8F0;border-top:2px solid #E8960A;' +
        'border-radius:999px;box-shadow:0 10px 30px rgba(8,14,26,.18);' +
        'font:600 12.5px/1 "Segoe UI",Arial,sans-serif;pointer-events:none;' +
        'animation:auria-busy-entra .18s ease-out}' +
      '#auria-busy .bfita{stroke-dasharray:40 100;animation:auria-busy-fita 1.15s linear infinite}' +
      '@media (prefers-reduced-motion:reduce){#auria-busy .bfita{animation-duration:2.4s}}';
    document.head.appendChild(st);

    el = document.createElement('div');
    el.id = 'auria-busy';
    el.setAttribute('role','status');
    el.setAttribute('aria-live','polite');
    el.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">' +
        '<path d="M9 40 L24 11 L39 40" fill="none" stroke="#E8960A" stroke-opacity=".22"' +
              ' stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path class="bfita" d="M9 40 L24 11 L39 40" pathLength="100" fill="none" stroke="#E8960A"' +
              ' stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg><span id="auria-busy-txt">processando…</span>';
    (document.body || document.documentElement).appendChild(el);
    txtEl = el.querySelector('#auria-busy-txt');
    return el;
  }

  function mostrar(rotulo){
    montar();
    if (rotulo && txtEl) txtEl.textContent = rotulo;
    el.style.display = 'flex';
    desde = Date.now();
  }
  function esconder(){
    if (!el) return;
    var falta = MIN_VIS - (Date.now() - desde);
    clearTimeout(saida);
    saida = setTimeout(function(){
      if (emVoo + manuais === 0 && el){ el.style.display = 'none'; if (txtEl) txtEl.textContent = 'processando…'; }
    }, falta > 0 ? falta : 0);
  }
  function avaliar(rotulo){
    if (emVoo + manuais > 0){
      if (el && el.style.display === 'flex'){ if (rotulo && txtEl) txtEl.textContent = rotulo; return; }
      if (timer) return;
      timer = setTimeout(function(){ timer = null; if (emVoo + manuais > 0) mostrar(rotulo); }, LIMIAR);
    } else {
      clearTimeout(timer); timer = null;
      esconder();
    }
  }

  // Trabalho que não passa por fetch (render, cálculo, leitura de arquivo).
  window.AuriaBusy = {
    start: function(rotulo){ manuais++; avaliar(rotulo); },
    stop:  function(){ manuais = Math.max(0, manuais - 1); avaliar(); },
    // Para depurar: quantas chamadas estão em voo agora.
    emVoo: function(){ return { rede: emVoo, manuais: manuais }; }
  };

  // Embrulha o fetch. Se algo der errado aqui, o fetch original segue valendo:
  // um indicador não pode derrubar a aplicação.
  var original = window.fetch;
  if (typeof original !== 'function') return;
  window.fetch = function(){
    var args = arguments;
    try { emVoo++; avaliar(); } catch(e){}
    var p;
    try { p = original.apply(this, args); }
    catch(e){ try{ emVoo = Math.max(0, emVoo-1); avaliar(); }catch(_){}  throw e; }
    return p.then(function(r){
      try { emVoo = Math.max(0, emVoo-1); avaliar(); } catch(e){}
      return r;
    }, function(err){
      try { emVoo = Math.max(0, emVoo-1); avaliar(); } catch(e){}
      throw err;
    });
  };
})();

/* ============================================================================
 *  Captura de erros (Fase 2, 2026-09-28) — alimenta a aba "Falhas" do CEO.
 *
 *  Mora aqui porque este arquivo já é carregado por quase todas as páginas e
 *  ANTES do supabase-js (que guarda a referência do fetch ao ser criado).
 *  Registra: erro de JavaScript, promessa rejeitada sem tratamento, resposta
 *  5xx de qualquer chamada, 4xx de Edge Function e falha de rede.
 *  Não registra: 4xx do banco (RLS/validação são respostas normais), "Script
 *  error." (sem conteúdo, vem de script de outro domínio) e AbortError.
 *
 *  Cada erro é enviado UMA vez por carga de página (máx. 15), direto para
 *  rpc/erro_registrar — que agrega por assinatura no banco. Nunca pode quebrar
 *  a página: tudo aqui fica dentro de try/catch.
 * ========================================================================== */
(function(){
  if (window.AuriaErros) return;
  var URL_SB = 'https://sabzccokueowpromwxdg.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhYnpjY29rdWVvd3Byb213eGRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjIxMTcsImV4cCI6MjA5MDQ5ODExN30.2sjY0auOwEEjkaXF7jaE_fRB8FG5H2r18BQqp-5HOcE';
  var RPC = URL_SB + '/rest/v1/rpc/erro_registrar';
  var enviados = {}, total = 0;
  var fetchOrig = window.fetch;   // já embrulhado pelo indicador acima — não volta a registrar

  function token(){
    try { var s = JSON.parse(localStorage.getItem('sb-sabzccokueowpromwxdg-auth-token') || 'null');
          return (s && (s.access_token || (s.currentSession && s.currentSession.access_token))) || ANON; }
    catch(_) { return ANON; }
  }
  function enviar(tipo, mensagem, origem, pilha){
    try {
      mensagem = String(mensagem || '').slice(0, 500);
      if (!mensagem || /^Script error\.?$/i.test(mensagem) || /ResizeObserver loop/i.test(mensagem)) return;
      var chave = tipo + '|' + mensagem + '|' + origem;
      if (enviados[chave] || total >= 15) return;
      enviados[chave] = 1; total++;
      fetchOrig.call(window, RPC, { method: 'POST', keepalive: true,
        headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: { tipo: tipo, mensagem: mensagem, origem: String(origem || '').slice(0, 300),
          pilha: String(pilha || '').slice(0, 2000), pagina: (location.pathname.split('/').pop() || 'index.html'),
          navegador: navigator.userAgent.slice(0, 200) } }) }).catch(function(){});
    } catch(_) {}
  }
  function curta(u){ try { var x = new URL(u, location.href); return x.host === location.host ? x.pathname : x.host + x.pathname; } catch(_) { return String(u).slice(0, 200); } }

  window.addEventListener('error', function(ev){
    if (ev.error || ev.message) enviar('js', ev.message || String(ev.error), curta(ev.filename || '') + ':' + (ev.lineno || 0), ev.error && ev.error.stack);
  });
  window.addEventListener('unhandledrejection', function(ev){
    var r = ev.reason; if (r && r.name === 'AbortError') return;
    enviar('promessa', (r && (r.message || r.error_description)) || String(r), '', r && r.stack);
  });
  // chamadas de rede: 5xx de qualquer lugar, 4xx só de Edge Function, e falha de conexão
  window.fetch = function(recurso, opts){
    var url = typeof recurso === 'string' ? recurso : (recurso && recurso.url) || '';
    var p = fetchOrig.apply(this, arguments);
    // ping de acesso é telemetria de melhor esforço: falha dele não é erro de tela
    if (url.indexOf('/rpc/erro_registrar') >= 0 || url.indexOf('/rpc/auria_ping_acesso') >= 0) return p;
    return p.then(function(r){
      try {
        var fn = url.indexOf('/functions/v1/') >= 0;
        if (r.status >= 500 || (fn && r.status >= 400 && r.status !== 401))
          enviar(fn ? 'funcao' : 'rede', 'HTTP ' + r.status + ' em ' + curta(url).split('?')[0], (opts && opts.method) || 'GET');
      } catch(_) {}
      return r;
    }, function(e){
      // sem rede, aba em segundo plano/hibernando ou página fechando: o navegador
      // corta o fetch — não é defeito do sistema, só ruído no resumo diário.
      var ruido = (typeof navigator !== 'undefined' && navigator.onLine === false)
        || document.visibilityState === 'hidden' || window.__auriaSaindo;
      if (!(e && e.name === 'AbortError') && !ruido) enviar('rede', 'Falha de conexão: ' + (e && e.message || e) + ' em ' + curta(url).split('?')[0], (opts && opts.method) || 'GET');
      throw e;
    });
  };
  window.addEventListener('pagehide', function(){ window.__auriaSaindo = true; });
  window.addEventListener('pageshow', function(){ window.__auriaSaindo = false; });
  window.AuriaErros = { registrar: function(msg, origem){ enviar('manual', msg, origem || '', new Error().stack); } };
})();

// Modais que fecham ao clicar no fundo (onclick="if(event.target===this)…"):
// só fecham se o clique COMEÇOU no fundo. Selecionar/colar texto arrastando o
// mouse para fora da caixa terminava o clique no fundo e fechava o formulário.
(function(){
  var ini=null;
  document.addEventListener('mousedown', function(e){ ini=e.target; }, true);
  document.addEventListener('click', function(e){
    var t=e.target;
    if(ini && t!==ini && t.getAttribute && /event\.target\s*===\s*this/.test(t.getAttribute('onclick')||'')){
      e.stopPropagation(); e.preventDefault();
    }
  }, true);
})();

/* ============================================================================
 *  Mídia PRIVADA (2026-10-09). O bucket `apontamentos` (prints de apontamento,
 *  anexos, fotos do Diário) deixou de ser público. Os registros antigos guardam o
 *  link /object/public/apontamentos/<caminho>, que agora não abre sem login. Em
 *  vez de reescrever banco e telas, este bloco troca o link na hora por um link
 *  ASSINADO (1 h) com a sessão do usuário — no <img>/<a> que entra na página, em
 *  new Image().src e em fetch(). Sem sessão (página pública), o link fica como
 *  está e simplesmente não abre — é o objetivo.
 *  AuriaMidia.assinarTexto(html) serve a quem monta HTML para outra janela/impressão.
 * ========================================================================== */
(function(){
  if (window.AuriaMidia) return;
  var URL_SB = 'https://sabzccokueowpromwxdg.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhYnpjY29rdWVvd3Byb213eGRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjIxMTcsImV4cCI6MjA5MDQ5ODExN30.2sjY0auOwEEjkaXF7jaE_fRB8FG5H2r18BQqp-5HOcE';
  var RX = /https?:\/\/[^"'\s)]*\/storage\/v1\/object\/public\/apontamentos\/([^"'\s?#)]+)/;
  var RXG = new RegExp(RX.source, 'g');
  var fetchBase = window.fetch;
  var cache = {}, pend = {}, fila = [], timer = null;

  function sessao(){
    try { var s = JSON.parse(localStorage.getItem('sb-sabzccokueowpromwxdg-auth-token') || 'null');
          return (s && (s.access_token || (s.currentSession && s.currentSession.access_token))) || null; }
    catch(_) { return null; }
  }
  function caminho(u){ var m = RX.exec(String(u || '')); if (!m) return null; try { return decodeURIComponent(m[1]); } catch(_) { return m[1]; } }
  function despachar(){
    timer = null;
    var lote = fila.splice(0, 100); if (!lote.length) return;
    var tk = sessao();
    var resolver = function(mapa){ lote.forEach(function(p){ var d = pend[p]; delete pend[p];
      var u = mapa && mapa[p]; if (u) cache[p] = { url: u, exp: Date.now() + 50*60*1000 };
      if (d) d.res(u || null); }); };
    if (!tk) { resolver(null); return; }
    fetchBase.call(window, URL_SB + '/storage/v1/object/sign/apontamentos', { method: 'POST',
      headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + tk, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600, paths: lote }) })
      .then(function(r){ return r.ok ? r.json() : []; })
      .then(function(arr){ var m = {}; (arr || []).forEach(function(x){ if (x && x.signedURL && x.path) m[x.path] = URL_SB + '/storage/v1' + x.signedURL; }); resolver(m); })
      .catch(function(){ resolver(null); });
    if (fila.length) timer = setTimeout(despachar, 0);
  }
  // → Promise<string|null> (null = sem sessão/sem permissão)
  function assinar(p){
    var c = cache[p]; if (c && c.exp > Date.now()) return Promise.resolve(c.url);
    if (pend[p]) return pend[p].p;
    var d = {}; d.p = new Promise(function(res){ d.res = res; }); pend[p] = d; fila.push(p);
    if (!timer) timer = setTimeout(despachar, 30);
    return d.p;
  }
  function urlFinal(u){ var p = caminho(u); return p ? assinar(p).then(function(s){ return s || u; }) : Promise.resolve(u); }

  window.AuriaMidia = {
    url: urlFinal,
    assinarTexto: function(txt){
      txt = String(txt || ''); var achados = txt.match(RXG); if (!achados) return Promise.resolve(txt);
      var unicos = achados.filter(function(x, i){ return achados.indexOf(x) === i; });
      return Promise.all(unicos.map(urlFinal)).then(function(novos){
        unicos.forEach(function(v, i){ if (novos[i] !== v) txt = txt.split(v).join(novos[i].replace(/&/g, '&amp;')); });
        return txt; });
    }
  };

  // fetch(url pública) → fetch(url assinada)
  window.fetch = function(rec, opts){
    var u = typeof rec === 'string' ? rec : (rec && rec.url);
    if (!caminho(u)) return fetchBase.apply(this, arguments);
    var self = this;
    return urlFinal(u).then(function(s){ return fetchBase.call(self, s, opts); });
  };
  // new Image().src = url pública (canvas, PDF, export)
  try {
    var dsc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (dsc && dsc.set) Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, enumerable: dsc.enumerable,
      get: dsc.get, set: function(v){ var el = this; if (!caminho(v)) return dsc.set.call(el, v);
        urlFinal(v).then(function(s){ dsc.set.call(el, s); }); } });
  } catch(_) {}
  // <img>/<a> que entram por innerHTML
  function trocar(el){
    var at = el.tagName === 'A' ? 'href' : 'src', v = el.getAttribute(at);
    if (!caminho(v)) return;
    urlFinal(v).then(function(s){ if (s !== v && el.getAttribute(at) === v) el.setAttribute(at, s); });
  }
  var SEL = 'img[src*="/object/public/apontamentos/"],a[href*="/object/public/apontamentos/"]';
  function varrer(n){ if (!n || n.nodeType !== 1) return; if (n.matches && n.matches(SEL)) trocar(n); if (n.querySelectorAll) n.querySelectorAll(SEL).forEach(trocar); }
  try {
    new MutationObserver(function(ms){ ms.forEach(function(m){
      if (m.type === 'attributes') varrer(m.target); else m.addedNodes.forEach(varrer); }); })
      .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src','href'] });
  } catch(_) {}
})();
