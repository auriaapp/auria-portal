// ============================================================================
//  auria_itcopia.js — Biblioteca normativa do grupo (ITs, PCs, POPs, REGs…)
//  ----------------------------------------------------------------------------
//  Usado em padroes_grupo.html (Gestão/Qualidade/analista) e no App Obra.
//  Quem não mantém a biblioteca NÃO lê o PDF cru: tudo passa pela Edge Function
//  it-copia, que devolve o arquivo carimbado:
//    AuriaIT.ver(sb, revId, {codigo,titulo,sub})  → abre no visualizador (CÓPIA NÃO CONTROLADA)
//    AuriaIT.copia(sb, {revId, codigo, titulo, grupoId, empId}) → modal obra/responsável/qtd → baixa o PDF
//    AuriaIT.textoArquivo(file)                     → texto do PDF/planilha p/ indexar (busca no conteúdo)
//  Não-PDF: planilha abre no leitor SheetJS (só leitura); outros formatos não visualizam,
//  só baixam pela cópia controlada (registrada, sem carimbo).
//    AuriaIT.lerNome(nomeArquivo)                   → {tipo, codigo, familia, revisao, titulo}
//  Depende de: supabase-js (sb), auria_pdfview.js (AuriaPDF).
// ============================================================================
(function(){
  const FN = 'https://sabzccokueowpromwxdg.supabase.co/functions/v1/it-copia';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhYnpjY29rdWVvd3Byb213eGRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjIxMTcsImV4cCI6MjA5MDQ5ODExN30.2sjY0auOwEEjkaXF7jaE_fRB8FG5H2r18BQqp-5HOcE';
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // supabase-js trata application/pdf como texto — por isso fetch direto.
  async function pedir(sb, corpo){
    const { data:{ session } } = await sb.auth.getSession();
    if (!session) throw new Error('sessão expirada — entre de novo');
    const r = await fetch(FN, { method:'POST', headers:{ 'Content-Type':'application/json', apikey:ANON, Authorization:'Bearer ' + session.access_token }, body:JSON.stringify(corpo) });
    if (!r.ok){ let m = 'erro ' + r.status; try { const j = await r.json(); if (j.error) m = j.error; } catch (_){} throw new Error(m); }
    return { blob: await r.blob(), numero: r.headers.get('x-copia-numero'), ext: (r.headers.get('x-arquivo-ext') || 'pdf').toLowerCase() };
  }
  async function bytes(sb, revId){ return new Uint8Array(await (await pedir(sb, { modo:'ver', revisao_id:revId })).blob.arrayBuffer()); }
  const EXT_PLANILHA = ['xlsx','xlsm','xls','csv','ods'];
  const extDe = n => (String(n || '').split('.').pop() || '').toLowerCase();
  function podeVer(ext){ return ext === 'pdf' || EXT_PLANILHA.includes(ext); }
  // SheetJS (Apache-2.0) só é carregado quando alguém abre uma planilha.
  function carregarXlsx(){
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((ok, erro) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      sc.onload = () => ok(window.XLSX); sc.onerror = () => erro(new Error('não foi possível carregar o leitor de planilhas')); document.head.appendChild(sc); });
  }
  // Planilha: só leitura, uma aba por vez, com faixa "cópia não controlada".
  async function verPlanilha(sb, revId, info){
    css();
    const ov = document.createElement('div'); ov.className = 'ait-ov';
    ov.innerHTML = '<div class="ait-bx" style="max-width:min(1200px,96vw);height:88vh;display:flex;flex-direction:column"><div class="ait-hd" style="display:flex;gap:10px;align-items:center"><b style="flex:1"><span class="c">' + esc(info.codigo || '') + '</span> — ' + esc(info.titulo || '') + '</b><button id="aitPx" style="border:1px solid #CBD5E1;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer">Fechar</button></div>'
      + '<div style="padding:0 18px;font-size:11.5px;color:#B91C1C;font-weight:700">CÓPIA NÃO CONTROLADA — somente consulta. Para uso na obra, emita a cópia controlada.</div>'
      + '<div id="aitAbas" style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 18px"></div><div id="aitPl" style="flex:1;overflow:auto;margin:0 18px 16px;border:1px solid #E2E8F0;border-radius:8px;font-size:12px">Carregando…</div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#aitPx').onclick = () => ov.remove();
    try {
      const [XL, r] = await Promise.all([carregarXlsx(), pedir(sb, { modo:'ver', revisao_id:revId })]);
      const wb = XL.read(new Uint8Array(await r.blob.arrayBuffer()), { type:'array' });
      const mostra = nome => {
        ov.querySelectorAll('#aitAbas button').forEach(b => { const on = b.dataset.n === nome; b.style.background = on ? '#E8762B' : '#fff'; b.style.color = on ? '#fff' : '#1E293B'; });
        ov.querySelector('#aitPl').innerHTML = XL.utils.sheet_to_html(wb.Sheets[nome], { editable:false }).replace(/<table/, '<table style="border-collapse:collapse" class="ait-t"');
        ov.querySelectorAll('.ait-t td').forEach(td => { td.style.border = '1px solid #E2E8F0'; td.style.padding = '3px 6px'; td.style.whiteSpace = 'nowrap'; });
      };
      ov.querySelector('#aitAbas').innerHTML = wb.SheetNames.map(n => '<button data-n="' + esc(n) + '" style="border:1px solid #CBD5E1;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer">' + esc(n) + '</button>').join('');
      ov.querySelectorAll('#aitAbas button').forEach(b => b.onclick = () => mostra(b.dataset.n));
      mostra(wb.SheetNames[0]);
    } catch (e){ ov.querySelector('#aitPl').textContent = 'Não foi possível abrir: ' + (e.message || e); }
  }
  function ver(sb, revId, info){
    info = info || {};
    const ext = info.ext || 'pdf';
    if (EXT_PLANILHA.includes(ext)) return verPlanilha(sb, revId, info);
    if (ext !== 'pdf'){ alert('Este formato (.' + ext + ') não tem visualização no Auria. Use "Cópia controlada" para baixar.'); return; }
    let u = null;
    AuriaPDF.abrir({ url: async () => { u = URL.createObjectURL((await pedir(sb, { modo:'ver', revisao_id:revId })).blob); return u; },
                     codigo: info.codigo || '', titulo: info.titulo || 'Documento', sub: info.sub || '' });
  }

  function css(){
    if (document.getElementById('aitCss')) return;
    const st = document.createElement('style'); st.id = 'aitCss';
    st.textContent = '.ait-ov{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:9000;padding:16px}'
      + '.ait-bx{background:#fff;border-radius:12px;max-width:440px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.25);font-family:inherit;color:#1E293B}'
      + '.ait-hd{padding:16px 18px 6px}.ait-hd b{font-size:15px}.ait-hd .c{font-family:ui-monospace,Menlo,monospace;color:#1E3A5F}.ait-hd p{margin:6px 0 0;font-size:12.5px;color:#64748B;line-height:1.45}'
      + '.ait-bd{padding:8px 18px}.ait-bd label{display:block;font-size:11.5px;font-weight:600;color:#475569;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.03em}'
      + '.ait-bd select,.ait-bd input{width:100%;padding:9px 10px;border:1px solid #CBD5E1;border-radius:8px;font:inherit;font-size:13.5px;box-sizing:border-box;background:#fff}'
      + '.ait-msg{font-size:12.5px;margin-top:10px;min-height:16px}.ait-msg.err{color:#B91C1C}.ait-msg.ok{color:#047857}'
      + '.ait-ft{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px}.ait-ft button{padding:9px 14px;border-radius:8px;border:1px solid #CBD5E1;background:#fff;font:inherit;font-size:13px;cursor:pointer}'
      + '.ait-ft .p{background:#E8762B;border-color:#E8762B;color:#fff;font-weight:600}.ait-ft button:disabled{opacity:.55;cursor:default}';
    document.head.appendChild(st);
  }

  // Modal da cópia controlada: obra (do grupo) → responsável (pessoas daquela obra) → quantidade.
  async function copia(sb, op){
    css();
    const ov = document.createElement('div'); ov.className = 'ait-ov';
    ov.innerHTML = '<div class="ait-bx"><div class="ait-hd"><b>Cópia controlada — <span class="c">' + esc(op.codigo) + '</span></b>'
      + '<p>' + esc(op.titulo || '') + '<br>A cópia sai carimbada com número, obra e responsável. Se sair uma revisão nova, o responsável recebe um e-mail para recolher esta.</p></div>'
      + '<div class="ait-bd"><label>Obra (ponto de distribuição)</label><select id="aitEmp"><option value="">Carregando…</option></select>'
      + '<label>Responsável</label><select id="aitResp" disabled><option value="">Escolha a obra</option></select>'
      + '<label>Quantidade de cópias impressas</label><input id="aitQtd" type="number" min="1" max="50" value="1">'
      + '<div class="ait-msg" id="aitMsg"></div></div>'
      + '<div class="ait-ft"><button id="aitX">Cancelar</button><button class="p" id="aitOk" disabled>Emitir e baixar</button></div></div>';
    document.body.appendChild(ov);
    const $ = id => ov.querySelector('#' + id), fechar = () => ov.remove();
    $('aitX').onclick = fechar; ov.onclick = e => { if (e.target === ov) fechar(); };
    const msg = (t, ok) => { $('aitMsg').className = 'ait-msg ' + (ok ? 'ok' : 'err'); $('aitMsg').textContent = t || ''; };

    const { data:emps, error } = await sb.from('empreendimentos_auria').select('id,nome').eq('empresa_id', op.grupoId).is('deleted_at', null).order('nome');
    if (error){ msg(error.message); return; }
    $('aitEmp').innerHTML = '<option value="">— escolha —</option>' + (emps || []).map(e => '<option value="' + e.id + '"' + (e.id === op.empId ? ' selected' : '') + '>' + esc(e.nome) + '</option>').join('');
    async function pessoas(){
      const emp = $('aitEmp').value; $('aitOk').disabled = true;
      if (!emp){ $('aitResp').innerHTML = '<option value="">Escolha a obra</option>'; $('aitResp').disabled = true; return; }
      $('aitResp').innerHTML = '<option>Carregando…</option>';
      const { data, error } = await sb.rpc('it_obra_pessoas', { p_emp: emp });
      if (error){ msg(error.message); return; }
      $('aitResp').innerHTML = (data || []).length ? '<option value="">— escolha —</option>' + data.map(p => '<option value="' + p.id + '">' + esc(p.nome) + '</option>').join('')
        : '<option value="">Ninguém vinculado a esta obra</option>';
      $('aitResp').disabled = !(data || []).length;
    }
    $('aitEmp').onchange = pessoas; $('aitResp').onchange = () => { $('aitOk').disabled = !$('aitResp').value; };
    if (op.empId) pessoas();
    $('aitOk').onclick = async () => {
      $('aitOk').disabled = true; msg('Gerando a cópia…', true);
      try {
        const r = await pedir(sb, { modo:'copia', revisao_id:op.revId, empreendimento_id:$('aitEmp').value, responsavel_id:$('aitResp').value, quantidade:+$('aitQtd').value || 1 });
        const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob);
        a.download = (op.codigo + ' - copia controlada ' + (r.numero || '')).replace(/[\\/:*?"<>|]+/g, '_').trim() + '.' + (r.ext || 'pdf');
        document.body.appendChild(a); a.click(); a.remove();
        msg('Cópia nº ' + (r.numero || '') + ' emitida e registrada.', true);
        $('aitX').textContent = 'Fechar';
        if (op.aoEmitir) try { op.aoEmitir(); } catch (_){}
      } catch (e){ $('aitOk').disabled = false; msg(e.message || String(e)); }
    };
  }

  // Texto do arquivo p/ a busca no conteúdo: PDF (pdf.js) ou planilha (SheetJS); outros, vazio.
  async function textoArquivo(file){
    const ext = extDe(file.name);
    if (EXT_PLANILHA.includes(ext)){
      const XL = await carregarXlsx(), wb = XL.read(new Uint8Array(await file.arrayBuffer()), { type:'array' });
      return wb.SheetNames.map(n => n + ' ' + XL.utils.sheet_to_csv(wb.Sheets[n], { FS:' ' })).join(' ').replace(/\s+/g, ' ').trim();
    }
    return ext === 'pdf' ? textoPdf(file) : '';
  }
  async function textoPdf(file){
    const lib = await AuriaPDF.carregarPdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const parts = [];
    for (let i = 1; i <= Math.min(doc.numPages, 200); i++){
      try { const tc = await (await doc.getPage(i)).getTextContent(); parts.push(tc.items.map(t => t.str).join(' ')); } catch (_){}
    }
    try { doc.destroy(); } catch (_){}
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // "Cópia controlada - IT 003 (V)R01 Escavação mecânica e_ou manual (1).pdf"
  //  → { tipo:'IT', codigo:'IT 003 (V)', familia:'victa', revisao:'01', titulo:'Escavação mecânica e/ou manual', duplicata:true }
  function lerNome(nome){
    const ext = extDe(nome);
    let s = nome.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/^c[óo]pia controlada\s*-\s*/i, '').trim();
    const dup = /\s\(\d+\)\s*$/.test(s); s = s.replace(/\s\(\d+\)\s*$/, '');
    const m = s.match(/^(.+?)\s*R(\d{1,3})\b\s*(.*)$/);
    if (!m) return null;
    let codigo = m[1].replace(/\s+/g, ' ').trim();
    const familia = /\(V\)/i.test(codigo) ? 'victa' : 'grupo';
    codigo = codigo.replace(/\s*\(V\)/i, ' (V)').replace(/:$/, '').trim();
    const tipo = (codigo.match(/^[A-Za-z]+/) || ['DOC'])[0].toUpperCase();
    const titulo = m[3].replace(/_/g, '/').replace(/\s*\/\s*/g, '/').replace(/\.+$/, '').replace(/\s+/g, ' ').trim()
      .replace(/e\/ou/g, 'e/ou').replace(/(\w)\/ (\w)/g, '$1/$2');
    return { tipo, codigo, familia, revisao: m[2].padStart(2, '0'), titulo, duplicata: dup, ext };
  }

  window.AuriaIT = { ver, bytes, copia, textoPdf, textoArquivo, lerNome, podeVer, extDe };
})();
