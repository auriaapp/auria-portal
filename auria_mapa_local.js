/* ── AuriaMapaLocal: marcar a localização do empreendimento no mapa ──────────
   OpenStreetMap (Leaflet, sem chave) + busca de endereço (Nominatim) + satélite
   (Esri World Imagery). Clique solta o pino; arrastar ajusta; "Usar minha
   localização" pega o GPS (útil no canteiro). Quem chama decide o que fazer com
   a coordenada (onSalvar) — a gravação vai pela função emp_set_local no banco.
   Uso:
     AuriaMapaLocal.abrir({ lat, lon, endereco, cidade, uf, titulo, podeEditar,
                            onSalvar: async (lat, lon, endereco) => {...} })
     AuriaMapaLocal.miniatura(el, lat, lon)   // mapa pequeno só de leitura
     AuriaMapaLocal.comoChegar(lat, lon)      // URL do Google Maps (rota)
   Sem emojis (padrão do Auria). */
(function(){
  const LEAF_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  const LEAF_JS  = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  let carregando = null;
  function carregarLeaflet(){
    if (window.L) return Promise.resolve();
    if (carregando) return carregando;
    carregando = new Promise((ok, erro) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LEAF_CSS; document.head.appendChild(l);
      const s = document.createElement('script'); s.src = LEAF_JS; s.onload = ok; s.onerror = () => erro(new Error('não foi possível carregar o mapa')); document.head.appendChild(s);
    });
    return carregando;
  }
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const CSS = `
  #amlOv{position:fixed;inset:0;background:rgba(11,18,32,.55);z-index:20000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:'Segoe UI',system-ui,sans-serif}
  #amlOv .box{background:#fff;color:#0F172A;border-radius:10px;width:860px;max-width:100%;height:min(640px,92vh);display:flex;flex-direction:column;box-shadow:0 0 0 1px #E8960A,0 18px 48px rgba(8,14,26,.32);overflow:hidden}
  #amlOv .hd{background:#F6F9FC;border-bottom:1px solid #E2E8F0;padding:10px 14px;display:flex;align-items:center;gap:10px}
  #amlOv .hd b{font-size:13.5px;color:#1E3A5F;flex:1}
  #amlOv .bus{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #E2E8F0;flex-wrap:wrap}
  #amlOv .bus input{flex:1;min-width:180px;border:1px solid #E2E8F0;border-radius:8px;padding:8px 10px;font:inherit;font-size:14px}
  #amlOv button{font-family:inherit;font-size:12.5px;font-weight:600;border-radius:8px;padding:7px 12px;cursor:pointer;border:1px solid #E2E8F0;background:#fff;color:#0F172A;min-height:36px}
  #amlOv button:hover{border-color:#E8960A}
  #amlOv button.pri{background:#E8960A;border-color:#E8960A;color:#231703;font-weight:700}
  #amlOv button.on{background:#1E3A5F;border-color:#1E3A5F;color:#fff}
  #amlOv .res{position:absolute;z-index:1000;top:8px;left:8px;right:8px;background:#fff;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(8,14,26,.18);max-height:220px;overflow:auto;display:none}
  #amlOv .res div{padding:8px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid #F1F5F9}
  #amlOv .res div:hover{background:#FEF3E2}
  #amlOv .mapa{flex:1;position:relative;min-height:200px}
  #amlOv .mapa > .m{position:absolute;inset:0}
  #amlOv .ft{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid #E2E8F0;flex-wrap:wrap}
  #amlOv .coord{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#1E3A5F;flex:1;min-width:160px}
  #amlOv .msg{font-size:12px;color:#A32D2D;width:100%}
  @media (max-width:640px){ #amlOv{padding:0} #amlOv .box{height:100%;border-radius:0} }`;
  function camadas(){
    return {
      mapa: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OpenStreetMap' }),
      satelite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:19, attribution:'Esri, Maxar' })
    };
  }
  async function buscar(q){
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=br&limit=6&addressdetails=0&q=' + encodeURIComponent(q), { headers:{ 'Accept-Language':'pt-BR' } });
    if (!r.ok) throw new Error('busca indisponível (' + r.status + ')');
    return r.json();
  }
  async function reverso(lat, lon){
    try { const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=' + lat + '&lon=' + lon, { headers:{ 'Accept-Language':'pt-BR' } });
      const j = await r.json(); return j && j.display_name || ''; } catch (_){ return ''; }
  }
  async function abrir(op){
    op = op || {};
    if (!document.getElementById('amlCss')){ const st = document.createElement('style'); st.id = 'amlCss'; st.textContent = CSS; document.head.appendChild(st); }
    let ov = document.getElementById('amlOv'); if (ov) ov.remove();
    ov = document.createElement('div'); ov.id = 'amlOv';
    const ed = op.podeEditar !== false;
    ov.innerHTML = '<div class="box"><div class="hd"><b>' + esc(op.titulo || 'Localização do empreendimento') + '</b>'
      + '<button data-c="mapa" class="on">Mapa</button><button data-c="satelite">Satélite</button></div>'
      + (ed ? '<div class="bus"><input id="amlQ" placeholder="Buscar endereço: rua, número, bairro, cidade"><button id="amlB">Buscar</button><button id="amlGps">Usar minha localização</button></div>' : '')
      + '<div class="mapa"><div class="m" id="amlMapa"></div><div class="res" id="amlRes"></div></div>'
      + '<div class="ft"><span class="coord" id="amlCoord">' + (ed ? 'Clique no mapa para marcar o ponto; arraste o pino para ajustar.' : '') + '</span>'
      + '<button id="amlSair">' + (ed ? 'Cancelar' : 'Fechar') + '</button>' + (ed ? '<button id="amlLimpar">Remover ponto</button><button class="pri" id="amlOk">Salvar localização</button>' : '')
      + '<div class="msg" id="amlMsg"></div></div></div>';
    document.body.appendChild(ov);
    const $ = id => document.getElementById(id), msg = t => { $('amlMsg').textContent = t || ''; };
    try { await carregarLeaflet(); } catch (e){ msg(e.message); return; }
    const C = camadas(), mapa = L.map('amlMapa', { layers:[C.mapa], zoomControl:true });
    ov.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
      ov.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b));
      Object.values(C).forEach(l => mapa.removeLayer(l)); C[b.dataset.c].addTo(mapa);
    });
    let pino = null, endereco = op.endereco || '';
    const marca = (lat, lon, zoom) => {
      if (!pino){ pino = L.marker([lat, lon], { draggable:ed }).addTo(mapa); pino.on('dragend', async () => { const p = pino.getLatLng(); mostra(p.lat, p.lng); endereco = await reverso(p.lat, p.lng); mostra(p.lat, p.lng); }); }
      else pino.setLatLng([lat, lon]);
      mostra(lat, lon); if (zoom) mapa.setView([lat, lon], zoom);
    };
    const mostra = (lat, lon) => { $('amlCoord').textContent = (+lat).toFixed(6) + ', ' + (+lon).toFixed(6) + (endereco ? ' · ' + endereco.split(',').slice(0, 3).join(',') : ''); };
    if (op.lat != null && op.lon != null) marca(+op.lat, +op.lon, 17);
    else {
      mapa.setView([-14.2, -51.9], 4);   // Brasil, enquanto procura a cidade
      const q = [op.cidade, op.uf].filter(Boolean).join(', ');
      if (q) try { const r = await buscar(q); if (r[0]) mapa.setView([+r[0].lat, +r[0].lon], 13); } catch (_){}
    }
    setTimeout(() => mapa.invalidateSize(), 60);
    $('amlSair').onclick = () => { mapa.remove(); ov.remove(); };
    if (!ed) return;
    mapa.on('click', async e => { marca(e.latlng.lat, e.latlng.lng); endereco = await reverso(e.latlng.lat, e.latlng.lng); mostra(e.latlng.lat, e.latlng.lng); });
    const res = $('amlRes');
    const fazBusca = async () => {
      const q = $('amlQ').value.trim(); if (q.length < 3) return;
      msg(''); res.style.display = 'block'; res.innerHTML = '<div>Buscando…</div>';
      try {
        const r = await buscar(q);
        res.innerHTML = r.length ? r.map((x, i) => '<div data-i="' + i + '">' + esc(x.display_name) + '</div>').join('') : '<div>Nada encontrado. Tente com menos detalhes ou marque direto no mapa.</div>';
        res.querySelectorAll('[data-i]').forEach(d => d.onclick = () => { const x = r[+d.dataset.i]; endereco = x.display_name; marca(+x.lat, +x.lon, 18); res.style.display = 'none'; });
      } catch (e){ res.style.display = 'none'; msg(e.message); }
    };
    $('amlB').onclick = fazBusca;
    $('amlQ').onkeydown = e => { if (e.key === 'Enter') fazBusca(); };
    $('amlGps').onclick = () => {
      if (!navigator.geolocation){ msg('Este aparelho não informa a localização.'); return; }
      msg('Obtendo a localização…');
      navigator.geolocation.getCurrentPosition(async p => { msg(''); marca(p.coords.latitude, p.coords.longitude, 18); endereco = await reverso(p.coords.latitude, p.coords.longitude); mostra(p.coords.latitude, p.coords.longitude); },
        e => msg('Não foi possível obter a localização: ' + (e.message || e.code)), { enableHighAccuracy:true, timeout:15000 });
    };
    $('amlLimpar').onclick = async () => {
      if (!confirm('Remover a localização marcada?')) return;
      try { await op.onSalvar(null, null, ''); mapa.remove(); ov.remove(); } catch (e){ msg(e.message || e); }
    };
    $('amlOk').onclick = async () => {
      if (!pino){ msg('Marque o ponto no mapa (clique, busca ou "Usar minha localização").'); return; }
      const p = pino.getLatLng(); $('amlOk').disabled = true;
      try { await op.onSalvar(+p.lat.toFixed(6), +p.lng.toFixed(6), endereco); mapa.remove(); ov.remove(); }
      catch (e){ $('amlOk').disabled = false; msg(e.message || e); }
    };
  }
  async function miniatura(el, lat, lon){
    if (!el || lat == null || lon == null) return;
    await carregarLeaflet();
    el.innerHTML = ''; const m = L.map(el, { zoomControl:false, attributionControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false, touchZoom:false });
    camadas().mapa.addTo(m); L.marker([lat, lon]).addTo(m); m.setView([lat, lon], 15); setTimeout(() => m.invalidateSize(), 60);
  }
  function comoChegar(lat, lon){ return 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon; }
  window.AuriaMapaLocal = { abrir, miniatura, comoChegar };
})();
