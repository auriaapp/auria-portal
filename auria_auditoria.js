// ============================================================================
//  auria_auditoria.js — Auditoria interna (Qualidade F3, 2026-11-01)
//  ----------------------------------------------------------------------------
//  Tela do Painel da Qualidade (qualidade.html#auditorias). Regras no banco
//  (supabase_qualidade_f3_auditoria.sql). Usa globais da página:
//    sb, $, esc, dt, GRUPO, EMPS, ME, ov(html), ovFechar(), contadores()
//  Abas: Programa (ano) · Checklists. Execução: C / NC / OM / NA por item,
//  com constatação e evidência; "evidência no Auria" mostra o dado vivo do
//  requisito (FVS, NCs, cópias, ciência) para o auditor conferir.
// ============================================================================
(function(){
  const A = { aba:'programa', ano:new Date().getFullYear(), sel:null }, REF = { iso9001:'ISO 9001', siac:'PBQP-H SiAC', interno:'Interno' };
  const SIT = { planejada:['Planejada','c-nav'], em_andamento:['Em andamento','c-rev'], concluida:['Concluída','c-pub'], cancelada:['Cancelada','c-mut'] };
  const RES = { c:['C','Conforme','#1E8449'], nc:['NC','Não conforme','#A32D2D'], om:['OM','Oportunidade de melhoria','#B7791F'], na:['NA','Não se aplica','#64748B'] };
  let AUDS = [], CKS = [], PESS = [];
  const n3 = n => String(n).padStart(3, '0');
  const empN = id => (EMPS.find(e => e.id === id) || {}).nome || 'Sede / processo';

  async function carregar(){
    const [a, c, p] = await Promise.all([
      sb.from('aud_auditoria_auria').select('*').eq('grupo_id', GRUPO).order('data_prevista'),
      sb.from('aud_checklist_auria').select('*').eq('grupo_id', GRUPO).eq('ativo', true).order('nome'),
      PESS.length ? Promise.resolve({ data:PESS }) : sb.rpc('aud_pessoas', { p_grupo:GRUPO })]);
    if (a.error) throw a.error;
    AUDS = a.data || []; CKS = c.data || []; PESS = p.data || [];
  }
  async function tela(){
    $('corpo').innerHTML = '<section class="tela"><div class="load">Carregando auditorias…</div></section>';
    try { await carregar(); } catch (e){ $('corpo').innerHTML = '<section class="tela"><div class="alerta rev">Não foi possível carregar: ' + esc(e.message || e) + '</div></section>'; return; }
    if (A.sel && AUDS.some(x => x.id === A.sel)) return execucao(A.sel);
    A.sel = null;
    $('corpo').innerHTML = '<section class="tela"><div class="thd"><div><h2>Auditorias internas</h2><p class="sub">Programa anual → execução com checklist → constatações. Cada NC vira uma não conformidade com plano de ação; OM fica registrada.</p></div>'
      + '<div class="tgl"><button class="' + (A.aba === 'programa' ? 'on' : '') + '" onclick="AuriaAud._aba(\'programa\')">Programa</button><button class="' + (A.aba === 'checklists' ? 'on' : '') + '" onclick="AuriaAud._aba(\'checklists\')">Checklists · ' + CKS.length + '</button></div>'
      + (A.aba === 'programa' ? '<button class="btn" onclick="AuriaAud._planejar()">＋ Auditoria</button>' : '<button class="btn sec" onclick="AuriaAud._semear(\'iso9001\')">＋ Modelo ISO 9001</button><button class="btn sec" onclick="AuriaAud._semear(\'siac\')">＋ Modelo PBQP-H SiAC</button><button class="btn" onclick="AuriaAud._ck()">＋ Checklist</button>') + '</div>'
      + '<div id="audCorpo"></div></section>';
    A.aba === 'programa' ? programa() : checklists();
  }

  // ── Programa: grade do ano (mês × auditoria) + lista ─────────────────────
  function programa(){
    const l = AUDS.filter(x => (x.data_prevista || '').startsWith(String(A.ano)));
    const hoje = new Date().toISOString().slice(0, 10);
    const atrasada = x => x.situacao === 'planejada' && x.data_prevista < hoje;
    const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const feitas = l.filter(x => x.situacao === 'concluida').length, prev = l.filter(x => x.situacao !== 'cancelada').length;
    let h = '<div class="card" style="margin-bottom:16px"><div class="hd"><button class="btn sec sm" onclick="AuriaAud._ano(-1)">◀</button><b>Programa ' + A.ano + '</b><button class="btn sec sm" onclick="AuriaAud._ano(1)">▶</button><span style="flex:1"></span><span class="cod">' + feitas + ' / ' + prev + '</span><span class="hint">realizadas</span></div>'
      + '<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:4px;padding:12px 16px">' + meses.map((m, i) => {
          const dm = l.filter(x => +x.data_prevista.slice(5, 7) === i + 1);
          return '<div style="border:1px solid var(--line2);border-radius:8px;min-height:64px;padding:4px"><div class="hint" style="font-family:var(--mono);font-size:10px">' + m.toUpperCase() + '</div>'
            + dm.map(x => '<div title="' + esc(x.titulo) + '" onclick="AuriaAud._abrir(\'' + x.id + '\')" style="cursor:pointer;margin-top:3px;border-radius:5px;padding:2px 4px;font:700 10.5px var(--mono);color:#fff;background:' + (x.situacao === 'concluida' ? '#1E8449' : x.situacao === 'cancelada' ? '#94A3B8' : atrasada(x) ? '#A32D2D' : x.situacao === 'em_andamento' ? '#E8960A' : '#1E3A5F') + '">AUD ' + n3(x.numero) + '</div>').join('') + '</div>';
        }).join('') + '</div></div>';
    h += '<div class="card">' + (l.length ? '<table><tr><th>Nº</th><th>Auditoria</th><th>Onde</th><th>Prevista</th><th>Auditor</th><th>Situação</th></tr>' + l.map(x => {
        const nc = (x.itens || []).filter(i => i.resultado === 'nc').length, om = (x.itens || []).filter(i => i.resultado === 'om').length;
        return '<tr style="cursor:pointer" onclick="AuriaAud._abrir(\'' + x.id + '\')"><td class="cod">AUD ' + n3(x.numero) + '</td><td><b>' + esc(x.titulo) + '</b><div class="hint">' + esc([x.processo, REF[x.referencial]].filter(Boolean).join(' · ')) + '</div></td>'
          + '<td>' + esc(empN(x.empreendimento_id)) + '</td><td>' + dt(x.data_prevista + 'T12:00') + (atrasada(x) ? ' <span class="chip c-rev">atrasada</span>' : '') + '</td><td>' + esc(x.auditor_nome || '—') + '</td>'
          + '<td><span class="chip ' + SIT[x.situacao][1] + '">' + SIT[x.situacao][0] + '</span>' + (x.situacao === 'concluida' ? '<div class="hint">' + nc + ' NC · ' + om + ' OM</div>' : '') + '</td></tr>'; }).join('') + '</table>'
      : '<div class="vazio">' + (CKS.length ? 'Nenhuma auditoria programada em ' + A.ano + '. Use “＋ Auditoria”.' : 'Comece pelos checklists: aba Checklists → “＋ Modelo ISO 9001” ou “＋ Modelo PBQP-H SiAC”, ajuste e depois programe as auditorias.') + '</div>') + '</div>';
    $('audCorpo').innerHTML = h;
  }

  // ── Checklists ───────────────────────────────────────────────────────────
  function checklists(){
    $('audCorpo').innerHTML = '<div class="card">' + (CKS.length ? '<table><tr><th>Checklist</th><th>Referencial</th><th>Itens</th><th>Atualizado</th><th></th></tr>' + CKS.map(c => '<tr><td><b>' + esc(c.nome) + '</b></td><td>' + REF[c.referencial] + '</td><td class="cod">' + (c.itens || []).length + '</td><td>' + dt(c.atualizado_em) + '<div class="hint">' + esc(c.atualizado_nome || '') + '</div></td><td style="text-align:right"><button class="btn sec sm" onclick="AuriaAud._ck(\'' + c.id + '\')">Editar</button></td></tr>').join('') + '</table>'
      : '<div class="vazio">Nenhum checklist. Os modelos ISO 9001 e PBQP-H SiAC são um ponto de partida resumido, em texto próprio — ajuste aos processos da construtora.</div>') + '</div>';
  }
  async function semear(ref){
    const { error } = await sb.rpc('aud_checklist_semear', { p_grupo:GRUPO, p_ref:ref });
    if (error) return alert(error.message);
    A.aba = 'checklists'; tela();
  }
  function ckForm(id){
    const c = id ? CKS.find(x => x.id === id) : { nome:'', referencial:'interno', itens:[{ codigo:'', requisito:'', pergunta:'', evidencia:'' }] };
    const linha = (t, i) => '<div class="itc" data-ck style="border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:6px"><div style="display:grid;grid-template-columns:90px 1fr 28px;gap:6px">'
      + '<input data-f="codigo" value="' + esc(t.codigo || '') + '" placeholder="Código"><input data-f="requisito" value="' + esc(t.requisito || '') + '" placeholder="Requisito"><button class="btn sec sm" onclick="this.closest(\'[data-ck]\').remove()">×</button></div>'
      + '<textarea data-f="pergunta" rows="2" placeholder="O que o auditor verifica" style="width:100%;margin-top:6px">' + esc(t.pergunta || '') + '</textarea>'
      + '<input data-f="evidencia" value="' + esc(t.evidencia || '') + '" placeholder="Evidência esperada" style="width:100%;margin-top:6px"><input type="hidden" data-f="auto" value="' + esc(t.auto || '') + '"></div>';
    ov('<div class="hd"><b>' + (id ? 'Editar checklist' : 'Novo checklist') + '</b></div><div class="bd" style="max-height:70vh;overflow:auto">'
      + '<div class="g2"><div><label class="l">Nome</label><input type="text" id="ckNome" value="' + esc(c.nome) + '"></div><div><label class="l">Referencial</label><select id="ckRef">' + Object.keys(REF).map(k => '<option value="' + k + '"' + (c.referencial === k ? ' selected' : '') + '>' + REF[k] + '</option>').join('') + '</select></div></div>'
      + '<label class="l">Itens</label><div id="ckItens">' + (c.itens || []).map(linha).join('') + '</div>'
      + '<button class="btn sec sm" onclick="document.getElementById(\'ckItens\').insertAdjacentHTML(\'beforeend\', AuriaAud._ckLinha())">＋ item</button><div class="msg" id="ckMsg"></div></div>'
      + '<div class="ft"><button class="btn sec" onclick="ovFechar()">Cancelar</button><button class="btn" id="ckOk" onclick="AuriaAud._ckSalvar(' + (id ? '\'' + id + '\'' : 'null') + ')">Salvar</button></div>');
    $('ovBox').style.width = 'min(760px,96vw)';
    A._linha = () => linha({}, 0);
  }
  async function ckSalvar(id){
    const itens = [...document.querySelectorAll('[data-ck]')].map(r => { const o = {}; r.querySelectorAll('[data-f]').forEach(x => { if (x.value.trim()) o[x.dataset.f] = x.value.trim(); }); return o; }).filter(o => o.pergunta || o.requisito);
    $('ckOk').disabled = true;
    const { error } = await sb.rpc('aud_checklist_salvar', { p_id:id, p_grupo:GRUPO, p_nome:$('ckNome').value, p_referencial:$('ckRef').value, p_itens:itens });
    if (error){ $('ckOk').disabled = false; $('ckMsg').className = 'msg err'; $('ckMsg').textContent = error.message; return; }
    ovFechar(); tela();
  }

  // ── Planejar ─────────────────────────────────────────────────────────────
  function planejar(id){
    const x = id ? AUDS.find(a => a.id === id) : { titulo:'', processo:'', empreendimento_id:'', checklist_id:(CKS[0] || {}).id, data_prevista:'', auditor_id:'', responsavel_id:'', auditados:'' };
    if (!CKS.length){ alert('Crie um checklist antes (aba Checklists).'); return; }
    const pes = sel => '<option value="">—</option>' + PESS.map(p => '<option value="' + p.id + '"' + (sel === p.id ? ' selected' : '') + '>' + esc(p.nome) + '</option>').join('');
    ov('<div class="hd"><b>' + (id ? 'Editar AUD ' + n3(x.numero) : 'Programar auditoria') + '</b></div><div class="bd">'
      + '<label class="l">Título</label><input type="text" id="apTit" value="' + esc(x.titulo) + '" placeholder="Ex.: Controle de documentos e FVS — obra Diagonal">'
      + '<div class="g2"><div><label class="l">Processo auditado</label><input type="text" id="apProc" value="' + esc(x.processo || '') + '" placeholder="Ex.: Execução de obra"></div>'
      + '<div><label class="l">Onde</label><select id="apEmp"><option value="">Sede / processo (sem obra)</option>' + EMPS.map(e => '<option value="' + e.id + '"' + (x.empreendimento_id === e.id ? ' selected' : '') + '>' + esc(e.nome) + '</option>').join('') + '</select></div></div>'
      + '<div class="g2"><div><label class="l">Checklist</label><select id="apCk">' + CKS.map(c => '<option value="' + c.id + '"' + (x.checklist_id === c.id ? ' selected' : '') + '>' + esc(c.nome) + '</option>').join('') + '</select></div>'
      + '<div><label class="l">Data prevista</label><input type="date" id="apData" value="' + esc(x.data_prevista || '') + '"></div></div>'
      + '<div class="g2"><div><label class="l">Auditor</label><select id="apAud">' + pes(x.auditor_id) + '</select></div><div><label class="l">Responsável pelo processo</label><select id="apResp">' + pes(x.responsavel_id) + '</select></div></div>'
      + '<label class="l">Auditados (nomes / funções)</label><input type="text" id="apAuds" value="' + esc(x.auditados || '') + '">'
      + '<div class="hint" style="margin-top:6px">Independência (ISO 19011): o auditor não pode ser o responsável pelo processo auditado.</div><div class="msg" id="apMsg"></div></div>'
      + '<div class="ft">' + (id && x.situacao !== 'concluida' ? '<button class="btn sec" style="margin-right:auto" onclick="AuriaAud._cancelar(\'' + id + '\')">Cancelar auditoria</button>' : '') + '<button class="btn sec" onclick="ovFechar()">Voltar</button><button class="btn" id="apOk" onclick="AuriaAud._planSalvar(' + (id ? '\'' + id + '\'' : 'null') + ')">Salvar</button></div>');
  }
  async function planSalvar(id){
    $('apOk').disabled = true;
    const { data, error } = await sb.rpc('aud_planejar', { p_id:id, p_grupo:GRUPO, p_titulo:$('apTit').value, p_processo:$('apProc').value, p_emp:$('apEmp').value || null, p_checklist:$('apCk').value,
      p_data:$('apData').value || null, p_auditor:$('apAud').value || null, p_responsavel:$('apResp').value || null, p_auditados:$('apAuds').value });
    if (error){ $('apOk').disabled = false; $('apMsg').className = 'msg err'; $('apMsg').textContent = error.message; return; }
    ovFechar(); if (!id) A.ano = +$('apData').value.slice(0, 4) || A.ano; A.aba = 'programa'; tela();
  }

  // ── Execução ─────────────────────────────────────────────────────────────
  async function execucao(id){
    A.sel = id;
    const x = AUDS.find(a => a.id === id); if (!x) return tela();
    const ed = ['planejada','em_andamento'].includes(x.situacao) && (PODE.qualidade || x.auditor_id === ME.id);
    const ev = await evidencias(x);
    const cont = k => (x.itens || []).filter(i => i.resultado === k).length, feitos = (x.itens || []).filter(i => i.resultado).length;
    $('corpo').innerHTML = '<section class="tela"><div class="thd"><div><a style="cursor:pointer;color:var(--mut);font-size:12px" onclick="AuriaAud._voltar()">← Programa</a><h2><span class="cod">AUD ' + n3(x.numero) + '</span> ' + esc(x.titulo) + '</h2>'
      + '<p class="sub">' + esc([x.processo, empN(x.empreendimento_id), REF[x.referencial]].filter(Boolean).join(' · ')) + ' · prevista ' + dt(x.data_prevista + 'T12:00') + ' · auditor ' + esc(x.auditor_nome || '—') + ' · responsável ' + esc(x.responsavel_nome || '—') + '</p></div>'
      + '<span class="chip ' + SIT[x.situacao][1] + '">' + SIT[x.situacao][0] + '</span>' + (PODE.qualidade && x.situacao !== 'concluida' ? '<button class="btn sec" onclick="AuriaAud._planejar(\'' + id + '\')">Editar</button>' : '') + '</div>'
      + '<div class="card" style="margin-bottom:12px"><div class="hd"><b>Resultado</b><span style="flex:1"></span>' + Object.keys(RES).map(k => '<span class="chip" style="background:' + RES[k][2] + '22;color:' + RES[k][2] + '">' + RES[k][0] + ' ' + cont(k) + '</span>').join(' ') + '<span class="hint">' + feitos + ' / ' + (x.itens || []).length + ' avaliados</span></div>'
      + (ed ? '<div style="padding:10px 16px"><label class="l">Auditados</label><input type="text" id="auAuds" value="' + esc(x.auditados || '') + '" style="width:100%"></div>' : (x.auditados ? '<div class="hint" style="padding:10px 16px">Auditados: ' + esc(x.auditados) + '</div>' : '')) + '</div>'
      + '<div id="auItens">' + (x.itens || []).map((t, i) => itemHtml(t, i, ed, ev[t.auto], x)).join('') + '</div>'
      + (x.situacao === 'concluida' ? '<div class="card" style="margin-top:12px;padding:12px 16px"><b>Conclusão</b> — ' + esc(x.concluida_nome || '') + ' em ' + dt(x.concluida_em) + '<div style="margin-top:6px;white-space:pre-wrap">' + esc(x.conclusao || '') + '</div></div>'
        : ed ? '<div class="card" style="margin-top:12px;padding:12px 16px"><label class="l">Conclusão da auditoria (pontos fortes, fracos, eficácia do processo)</label><textarea id="auConc" rows="3" style="width:100%"></textarea>'
          + '<div style="display:flex;gap:8px;margin-top:8px;align-items:center"><button class="btn sec" onclick="AuriaAud._salvar(\'' + id + '\')">Salvar andamento</button><button class="btn ac" onclick="AuriaAud._concluir(\'' + id + '\')">Concluir e gerar NCs</button><span class="msg" id="auMsg" style="margin:0"></span></div></div>' : '')
      + '</section>';
  }
  function itemHtml(t, i, ed, ev, x){
    const r = t.resultado || '';
    return '<div class="card" data-it="' + i + '" style="margin-bottom:8px;padding:10px 14px' + (r === 'nc' ? ';border-left:4px solid #A32D2D' : r === 'om' ? ';border-left:4px solid #B7791F' : '') + '">'
      + '<div style="display:flex;gap:10px;align-items:flex-start"><span class="cod" style="min-width:64px">' + esc(t.codigo || '') + '</span><div style="flex:1"><b>' + esc(t.requisito || '') + '</b><div>' + esc(t.pergunta || '') + '</div>'
      + (t.evidencia ? '<div class="hint">Evidência esperada: ' + esc(t.evidencia) + '</div>' : '') + (ev ? '<div style="margin-top:4px;font-size:12px;background:var(--accentBg);border-radius:6px;padding:4px 8px"><b>No Auria:</b> ' + ev + '</div>' : '') + '</div>'
      + '<div class="tgl" style="flex:none">' + Object.keys(RES).map(k => '<button title="' + RES[k][1] + '"' + (ed ? ' onclick="AuriaAud._res(' + i + ',\'' + k + '\')"' : ' disabled') + ' style="' + (r === k ? 'background:' + RES[k][2] + ';color:#fff' : '') + '">' + RES[k][0] + '</button>').join('') + '</div></div>'
      + (ed && ['nc','om'].includes(r) ? '<label class="l">Constatação — o que foi encontrado, onde, contra qual requisito</label><textarea rows="2" data-c="constatacao" style="width:100%">' + esc(t.constatacao || '') + '</textarea>'
          + '<label class="l">Evidência objetiva (documento, foto, registro)</label><input data-c="evidencia_obs" value="' + esc(t.evidencia_obs || '') + '" style="width:100%">'
          + (r === 'nc' && !x.empreendimento_id ? '<label class="l">Obra onde a NC será tratada</label><select data-c="nc_emp"><option value="">—</option>' + EMPS.map(e => '<option value="' + e.id + '"' + (t.nc_emp === e.id ? ' selected' : '') + '>' + esc(e.nome) + '</option>').join('') + '</select>' : '')
        : (t.constatacao ? '<div style="margin-top:6px"><b>Constatação:</b> ' + esc(t.constatacao) + (t.evidencia_obs ? '<div class="hint">Evidência: ' + esc(t.evidencia_obs) + '</div>' : '') + '</div>' : ''))
      + '</div>';
  }
  // lê o que está na tela para o objeto da auditoria (sem salvar)
  function lerTela(x){
    document.querySelectorAll('#auItens [data-it]').forEach(el => { const t = x.itens[+el.dataset.it]; el.querySelectorAll('[data-c]').forEach(c => { t[c.dataset.c] = c.value.trim(); }); });
  }
  function res(i, k){ const x = AUDS.find(a => a.id === A.sel); lerTela(x); x.itens[i].resultado = x.itens[i].resultado === k ? '' : k; execucao(A.sel); }
  async function salvar(id, quieto){
    const x = AUDS.find(a => a.id === id); lerTela(x);
    const { error } = await sb.rpc('aud_registrar', { p_id:id, p_itens:x.itens, p_auditados:$('auAuds') ? $('auAuds').value : null });
    if (error){ $('auMsg').className = 'msg err'; $('auMsg').textContent = error.message; return false; }
    x.situacao = 'em_andamento'; if (!quieto){ $('auMsg').className = 'msg ok'; $('auMsg').textContent = 'Andamento salvo.'; }
    return true;
  }
  async function concluir(id){
    const conc = $('auConc').value;
    if (!(await salvar(id, true))) return;
    const { data, error } = await sb.rpc('aud_concluir', { p_id:id, p_conclusao:conc });
    if (error){ $('auMsg').className = 'msg err'; $('auMsg').textContent = error.message; return; }
    await carregar(); execucao(id); try { contadores(); } catch (_){}
    if (data) alert(data + ' não conformidade(s) aberta(s) a partir das constatações — acompanhe em “Não conformidades”.');
  }
  async function cancelar(id){ if (!confirm('Cancelar esta auditoria?')) return; const { error } = await sb.rpc('aud_cancelar', { p_id:id }); if (error) return alert(error.message); ovFechar(); A.sel = null; tela(); }

  // Evidência viva do Auria para itens marcados com "auto".
  async function evidencias(x){
    const out = {}, emps = x.empreendimento_id ? [x.empreendimento_id] : EMPS.map(e => e.id);
    if (!emps.length) return out;
    const desde = new Date(Date.now() - 180 * 864e5).toISOString();
    try {
      const [fvs, nc, cop, cie, mins] = await Promise.all([
        sb.from('fvs_inspecao_auria').select('situacao,rodada').in('empreendimento_id', emps).eq('tipo', 'fvs').gte('aberta_em', desde),
        sb.from('nc_auria').select('situacao,eficacia_prevista').eq('grupo_id', GRUPO).in('empreendimento_id', emps),
        sb.from('grupo_it_copia_auria').select('obsoleta_em,recolhida_em').eq('grupo_id', GRUPO).in('empreendimento_id', emps),
        typeof cienciaCarregar === 'function' ? cienciaCarregar() : Promise.resolve([]),
        sb.from('grupo_it_minuta_auria').select('situacao').eq('grupo_id', GRUPO)]);
      const f = fvs.data || [], ap = f.filter(i => i.situacao === 'aprovada').length, rep = f.filter(i => i.situacao === 'reprovada').length, rein = f.filter(i => (i.rodada || 1) > 1).length;
      out.fvs = f.length ? f.length + ' fichas em 180 dias · ' + ap + ' aprovadas · ' + rep + ' reprovadas · ' + rein + ' com reinspeção' : 'nenhuma ficha de FVS nos últimos 180 dias';
      const n = nc.data || [], hj = new Date().toISOString().slice(0, 10);
      out.nc = n.length + ' NC · ' + n.filter(i => !['encerrada','cancelada'].includes(i.situacao)).length + ' em aberto · ' + n.filter(i => i.situacao === 'eficacia' && i.eficacia_prevista <= hj).length + ' com eficácia vencida';
      const c = cop.data || [];
      out.copias = c.filter(i => !i.obsoleta_em).length + ' cópias vigentes · ' + c.filter(i => i.obsoleta_em && !i.recolhida_em).length + ' obsoletas não recolhidas';
      const ci = (cie || []).filter(i => !x.empreendimento_id || i.empreendimento_id === x.empreendimento_id);
      out.ciencia = ci.length ? Math.round(100 * ci.filter(i => i.ciente_em).length / ci.length) + '% de ciência nas leituras obrigatórias (' + ci.filter(i => !i.ciente_em).length + ' pendentes)' : 'nenhum documento com distribuição definida';
      out.revisoes = (mins.data || []).filter(i => ['verificacao','aprovacao'].includes(i.situacao)).length + ' revisão(ões) em verificação/aprovação; publicações passam pelo ciclo elaboração → verificação → aprovação';
    } catch (_){}
    return out;
  }

  window.AuriaAud = {
    tela, _aba(k){ A.aba = k; tela(); }, _ano(d){ A.ano += d; programa(); }, _abrir:id => execucao(id), _voltar(){ A.sel = null; tela(); },
    _planejar:planejar, _planSalvar:planSalvar, _cancelar:cancelar, _semear:semear, _ck:ckForm, _ckSalvar:ckSalvar, _ckLinha:() => A._linha(),
    _res:res, _salvar:id => salvar(id), _concluir:concluir,
    async contadores(){
      try { const hj = new Date().toISOString().slice(0, 10); const { data } = await sb.from('aud_auditoria_auria').select('situacao,data_prevista').eq('grupo_id', GRUPO).in('situacao', ['planejada','em_andamento']);
        const l = data || []; return { audAtr:l.filter(x => x.data_prevista < hj).length, audProx:l.filter(x => x.data_prevista >= hj && x.data_prevista <= new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10)).length }; }
      catch (_){ return { audAtr:0, audProx:0 }; }
    }
  };
})();
