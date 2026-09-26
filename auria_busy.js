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
