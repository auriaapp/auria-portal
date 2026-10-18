// ============================================================================
//  auria_biblioteca.js — manutenção da Biblioteca normativa (ITs/PC/POP/REG)
//  ----------------------------------------------------------------------------
//  Código comum de padroes_grupo.html e qualidade.html (saiu do padroes_grupo
//  sem mudança de lógica). Documento → revisões; só a vigente vale para a obra.
//  A página que usa precisa ter, como globais:
//    sb, $, esc, GRUPO, ME, PODE (PODE.its), let ITS = [], TEMA_ROT,
//    ov(html), ovFechar()       — janela modal da página
//    telaITs(), itDetalhe(id)   — ganchos chamados depois de salvar/publicar
//  Depende de: auria_itcopia.js (AuriaIT).
// ============================================================================
// ── Biblioteca normativa (ITs, PCs, POPs, REGs…) ─────────────────────────────
//  Mesmo modelo do CDE: documento → revisões; só a vigente vale para a obra.
//  Quem mantém (PODE.its) vê histórico e cópias distribuídas; os demais só a
//  vigente. Abrir/baixar passa pela it-copia (carimbo) — ver auria_itcopia.js.
const FAM_ROT = { grupo:'Grupo', victa:'Victa' };
async function carregarITs(){
  const { data, error } = await sb.from('grupo_it_auria').select('*, grupo_it_revisao_auria(id,it_id,revisao,arquivo_path,arquivo_nome,bytes,observacao,vigente,publicado_nome,publicado_em)').eq('grupo_id', GRUPO).order('codigo');
  if (error){ ITS = []; return error; }
  ITS = (data || []).map(i => Object.assign(i, { revs: (i.grupo_it_revisao_auria || []).sort((a,b) => new Date(b.publicado_em) - new Date(a.publicado_em)) }));
  try { SOL_AB = await AuriaIT.solicitacoesAbertas(sb, ITS.map(i => i.id)); } catch (_){ SOL_AB = {}; }
}
let SOL_AB = {};
function _itOrdem(a, b){ return a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric:true }); }

function itAbrir(revId){
  let it = null, rv = null;
  ITS.forEach(i => (i.revs || []).forEach(r => { if (r.id === revId){ it = i; rv = r; } }));
  ovFechar();
  AuriaIT.ver(sb, revId, { ext: rv ? AuriaIT.extDe(rv.arquivo_path) : 'pdf', codigo: it ? it.codigo + ' · rev. ' + rv.revisao : '', titulo: it ? it.titulo : 'Documento', sub: rv && !rv.vigente ? 'revisão anterior (histórico)' : 'revisão vigente' });
}
function itCopia(id){
  const i = ITS.find(x => x.id === id), v = i && i.revs.find(r => r.vigente); if (!v) return;
  AuriaIT.copia(sb, { revId: v.id, codigo: i.codigo + ' rev. ' + v.revisao, titulo: i.titulo, grupoId: GRUPO });
}

function itForm(id){
  const i = id ? ITS.find(x => x.id === id) : { codigo:'', titulo:'', tema:'execucao', tipo:'IT', familia:'grupo', palavras:'', validade:'', ativo:true };
  ov('<div class="hd"><b>' + (id ? 'Editar ' + esc(i.codigo) : 'Novo documento') + '</b></div><div class="bd">'
    + '<div class="g2"><div><label class="l">Código</label><input type="text" id="itCod" value="' + esc(i.codigo) + '" placeholder="IT 038 ou IT 038 (V)"' + (id ? ' disabled' : '') + '></div>'
    + '<div><label class="l">Família</label><select id="itFam">' + Object.keys(FAM_ROT).map(k => '<option value="' + k + '"' + (k === (i.familia || 'grupo') ? ' selected' : '') + '>' + FAM_ROT[k] + '</option>').join('') + '</select></div></div>'
    + '<div class="g2"><div><label class="l">Tema</label><select id="itTema">' + Object.keys(TEMA_ROT).map(k => '<option value="' + k + '"' + (k === i.tema ? ' selected' : '') + '>' + TEMA_ROT[k] + '</option>').join('') + '</select></div>'
    + '<div><label class="l">Validade (opcional)</label><input type="date" id="itVal" value="' + esc(i.validade || '') + '"></div></div>'
    + '<label class="l">Título</label><input type="text" id="itTit" value="' + esc(i.titulo) + '" placeholder="Ex.: Execução de alvenaria de vedação">'
    + '<label class="l">Palavras de busca (opcional)</label><input type="text" id="itPal" value="' + esc(i.palavras || '') + '" placeholder="Ex.: bloco cerâmico, argamassa, prumo">'
    + (id ? '<label class="chk"><input type="checkbox" id="itAtivo"' + (i.ativo ? ' checked' : '') + '> Vigente (desmarque para tornar obsoleto)</label>' : '')
    + '<div class="msg" id="itMsg"></div></div>'
    + '<div class="ft"><button class="btn sec" onclick="ovFechar()">Cancelar</button><button class="btn" id="itOk" onclick="itSalvar(' + (id ? '\'' + id + '\'' : '') + ')">' + (id ? 'Salvar' : 'Criar e anexar o PDF') + '</button></div>');
}
async function itSalvar(id){
  const row = { titulo: ($('itTit').value || '').trim(), tema: $('itTema').value, familia: $('itFam').value, validade: $('itVal').value || null, palavras: ($('itPal').value || '').trim() || null };
  const msg = t => { $('itMsg').className = 'msg err'; $('itMsg').textContent = t; };
  if (row.titulo.length < 3) return msg('Escreva o título.');
  $('itOk').disabled = true;
  let r;
  if (id){ row.ativo = $('itAtivo').checked; r = await sb.from('grupo_it_auria').update(row).eq('id', id).select('id').single(); }
  else {
    const cod = ($('itCod').value || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (cod.length < 2){ $('itOk').disabled = false; return msg('Escreva o código.'); }
    r = await sb.from('grupo_it_auria').insert(Object.assign(row, { grupo_id: GRUPO, codigo: cod, tipo: (cod.match(/^[A-Z]+/) || ['DOC'])[0] })).select('id').single();
  }
  if (r.error){ $('itOk').disabled = false; return msg(/duplicate|unique/i.test(r.error.message) ? 'Já existe um documento com esse código.' : r.error.message); }
  await carregarITs();
  if (id){ ovFechar(); telaITs(); } else revForm(r.data.id);
}

function revForm(id){
  const i = ITS.find(x => x.id === id); const v = i && i.revs.find(r => r.vigente);
  const prox = v && /^\d+$/.test(v.revisao) ? String(+v.revisao + 1).padStart(v.revisao.length, '0') : (v ? '' : '00');
  ov('<div class="hd"><b>Publicar revisão — <span class="cod">' + esc(i.codigo) + '</span></b><div class="hint" style="margin-top:4px">A revisão atual' + (v ? ' (' + esc(v.revisao) + ')' : '') + ' vai para o histórico; todos passam a ver a nova, e quem tem cópia controlada da antiga recebe e-mail.</div></div><div class="bd">'
    + '<div class="g2"><div><label class="l">Revisão</label><input type="text" id="rvNum" value="' + esc(prox) + '" placeholder="Ex.: 03"></div><div><label class="l">Arquivo (PDF, planilha, Word…)</label><input type="file" id="rvArq"></div></div>'
    + '<label class="l">O que mudou nesta revisão</label><textarea id="rvObs" rows="3"></textarea><div id="rvSols"></div><div class="msg" id="rvMsg"></div></div>'
    + '<div class="ft"><button class="btn sec" onclick="ovFechar();telaITs()">Cancelar</button><button class="btn" id="rvOk" onclick="revPublicar(\'' + id + '\')">Publicar</button></div>');
  sb.from('grupo_it_solicitacao_auria').select('id,numero,descricao,solicitante_nome,situacao').eq('it_id', id).in('situacao', ['aberta','em_analise']).order('numero').then(({ data }) => {
    const el = $('rvSols'); if (!el || !(data || []).length) return;
    el.innerHTML = '<label class="l">Esta revisão atende os pedidos</label>' + data.map(x => '<label class="chk" style="align-items:flex-start"><input type="checkbox" data-sol="' + x.id + '" checked> <span><b>nº ' + x.numero + '</b> · ' + esc(x.solicitante_nome || '') + ' — ' + esc(x.descricao) + '</span></label>').join('')
      + '<div class="hint">Os marcados viram "Atendida" e quem pediu recebe e-mail com o número da revisão.</div>';
  });
}
async function r2Url(action, path, contentType){
  const r = await sb.functions.invoke('cde-r2', { body:{ action, path, contentType } });
  if (r.error){ let m = r.error.message; try { const b = await r.error.context.json(); if (b && b.error) m = b.error; } catch (_){} throw new Error(m); }
  return r.data.url;
}
// ── Solicitação de revisão (218a) ──────────────────────────────────────────
function itSolicitar(id){
  const i = ITS.find(x => x.id === id); if (!i) return;
  AuriaIT.solicitar(sb, { itId:i.id, codigo:i.codigo, titulo:i.titulo, aoEnviar: () => { carregarITs().then(() => { window._itRender = true; telaITs(); }); } });
}
// Qualidade: todas (abertas primeiro). Demais: as minhas.
async function itSolicitacoes(modo){
  window._solModo = modo || window._solModo || 'minhas';
  const todas = window._solModo === 'todas' && PODE.its, filtro = window._solFiltro || 'pendentes';
  ov('<div class="hd"><b>' + (todas ? 'Solicitações de revisão' : 'Minhas solicitações de revisão') + '</b></div><div class="bd" id="solCorpo"><div class="hint">Carregando…</div></div><div class="ft"><button class="btn sec" onclick="ovFechar();window._itRender=true;telaITs()">Fechar</button></div>');
  $('ovBox').style.width = '820px';
  let q = sb.from('grupo_it_solicitacao_auria').select('*').eq('grupo_id', GRUPO).order('criado_em', { ascending:false });
  if (!todas) q = q.eq('solicitante_id', ME.id);
  const { data, error } = await q;
  const el = $('solCorpo'); if (!el) return;
  if (error){ el.innerHTML = '<div class="msg err">' + esc(error.message) + '</div>'; return; }
  const pend = s => s.situacao === 'aberta' || s.situacao === 'em_analise';
  const lista = (data || []).filter(s => filtro === 'todas' || pend(s));
  const itDe = id => ITS.find(x => x.id === id) || { codigo:'?', titulo:'' };
  el.innerHTML = '<div class="row" style="gap:6px;margin:6px 0 10px">'
    + [['pendentes','Pendentes ' + (data || []).filter(pend).length], ['todas','Todas ' + (data || []).length]].map(([k, t]) => '<button class="btn ' + (filtro === k ? '' : 'sec') + '" onclick="window._solFiltro=\'' + k + '\';itSolicitacoes()">' + t + '</button>').join('') + '</div>'
    + (lista.length ? lista.map(s => { const i = itDe(s.it_id);
        return '<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0">'
          + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>nº ' + s.numero + '</b> ' + AuriaIT.chipSituacao(s.situacao) + ' <span class="cod">' + esc(i.codigo) + '</span> ' + esc(i.titulo)
          + '<span class="hint" style="margin-left:auto">' + new Date(s.criado_em).toLocaleDateString('pt-BR') + '</span></div>'
          + '<div class="hint" style="margin-top:4px">' + esc(AuriaIT.MOTIVOS[s.motivo] || s.motivo) + (s.pagina ? ' · ' + esc(s.pagina) : '') + (todas ? ' · por ' + esc(s.solicitante_nome || '') : '') + '</div>'
          + '<div style="margin-top:6px">' + esc(s.descricao) + '</div>'
          + (s.resposta ? '<div style="margin-top:6px;border-left:3px solid #E8762B;padding-left:8px"><span class="hint">Qualidade' + (s.respondido_nome ? ' (' + esc(s.respondido_nome) + ')' : '') + ':</span> ' + esc(s.resposta) + '</div>' : '')
          + (todas && pend(s) ? '<div class="row" style="gap:6px;margin-top:8px">'
              + (s.situacao === 'aberta' ? '<button class="btn sec" onclick="solResponder(\'' + s.id + '\',\'em_analise\')">Colocar em análise</button>' : '')
              + '<button class="btn sec" onclick="ovFechar();revForm(\'' + s.it_id + '\')">Publicar revisão que atende</button>'
              + '<button class="btn sec" onclick="solResponder(\'' + s.id + '\',\'atendida\')">Marcar atendida</button>'
              + '<button class="btn sec" onclick="solResponder(\'' + s.id + '\',\'recusada\')">Recusar</button></div>' : '')
          + '</div>'; }).join('')
      : '<div class="hint" style="padding:12px 0">' + (filtro === 'pendentes' ? 'Nenhuma solicitação pendente.' : 'Nenhuma solicitação.') + (todas ? '' : ' Para pedir, use "Solicitar revisão" na norma.') + '</div>');
}
async function solResponder(id, situacao){
  let resp = '';
  if (situacao === 'recusada'){ resp = prompt('Justificativa da recusa (vai por e-mail para quem pediu):', ''); if (resp === null) return; if (resp.trim().length < 5) return alert('Escreva a justificativa.'); }
  else if (situacao === 'atendida'){ resp = prompt('Comentário para quem pediu (opcional):', ''); if (resp === null) return; }
  else if (situacao === 'em_analise'){ resp = prompt('Comentário para quem pediu (opcional):', 'Estamos analisando o seu pedido.'); if (resp === null) return; }
  const { error } = await sb.rpc('it_solicitacao_responder', { p_id:id, p_situacao:situacao, p_resposta:resp || '', p_revisao:null });
  if (error) return alert(error.message);
  await carregarITs(); itSolicitacoes();
}
// Original sem carimbo — só quem mantém a biblioteca (o R2 recusa os demais).
async function itBaixarOriginal(path){
  try { const a = document.createElement('a'); a.href = await r2Url('download', path); a.download = path.split('/').pop(); document.body.appendChild(a); a.click(); a.remove(); }
  catch (e){ alert('Não foi possível baixar: ' + (e.message || e)); }
}
// Sobe o arquivo, publica a revisão e indexa o texto (busca no conteúdo) — uma vez só.
async function _itSubir(itId, f){
  // ".." no caminho é recusado pela regra do armazenamento (ex.: "Sapatas..pdf")
  const nome = f.name.replace(/[^\w.\-]+/g, '_').replace(/\.{2,}/g, '.');
  const path = GRUPO + '/_its/' + itId + '/' + Date.now() + '_' + nome;
  const ct = f.type || 'application/octet-stream';
  const url = await r2Url('upload', path, ct);
  const up = await fetch(url, { method:'PUT', headers:{ 'content-type':ct }, body:f });
  if (!up.ok) throw new Error('Falha no envio (' + up.status + ').');
  return path;
}
// Correção: troca o arquivo da revisão VIGENTE (sem nova revisão, sem e-mail).
async function _itTrocarArquivo(itId, revId, f, motivo){
  const path = await _itSubir(itId, f);
  const { error } = await sb.rpc('it_trocar_arquivo', { p_revisao:revId, p_path:path, p_nome:f.name, p_bytes:f.size, p_motivo:motivo || '' });
  if (error) throw error;
  try { const t = await AuriaIT.textoArquivo(f); await sb.rpc('it_indexar', { p_revisao: revId, p_texto: t || ' ' }); } catch (e){ console.warn('indexar:', e); }
}
async function _itPublicarArquivo(itId, rev, f, obs){
  // ".." no caminho é recusado pela regra do armazenamento (ex.: "Sapatas..pdf")
  const nome = f.name.replace(/[^\w.\-]+/g, '_').replace(/\.{2,}/g, '.');
  const path = GRUPO + '/_its/' + itId + '/' + Date.now() + '_' + nome;
  const ct = f.type || 'application/octet-stream';
  const url = await r2Url('upload', path, ct);
  const up = await fetch(url, { method:'PUT', headers:{ 'content-type':ct }, body:f });
  if (!up.ok) throw new Error('Falha no envio (' + up.status + ').');
  const { data:revId, error } = await sb.rpc('grupo_it_publicar', { p_it:itId, p_revisao:rev, p_path:path, p_nome:f.name, p_bytes:f.size, p_obs:obs || '' });
  if (error) throw error;
  try { const t = await AuriaIT.textoArquivo(f); await sb.rpc('it_indexar', { p_revisao: revId, p_texto: t || ' ' }); } catch (e){ console.warn('indexar:', e); }
  return revId;
}
async function revPublicar(id){
  const msg = (t, ok) => { $('rvMsg').className = 'msg ' + (ok ? 'ok' : 'err'); $('rvMsg').textContent = t; };
  const rev = ($('rvNum').value || '').trim(), f = $('rvArq').files[0];
  if (!rev) return msg('Informe a revisão.');
  if (!f) return msg('Escolha o arquivo.');
  $('rvOk').disabled = true; msg('Enviando o arquivo…', true);
  try {
    const revId = await _itPublicarArquivo(id, rev, f, ($('rvObs').value || '').trim());
    for (const cb of document.querySelectorAll('#rvSols [data-sol]:checked'))
      await sb.rpc('it_solicitacao_responder', { p_id: cb.dataset.sol, p_situacao: 'atendida', p_resposta: 'Atendida na revisão ' + rev + '.', p_revisao: revId });
    await carregarITs(); itDetalhe(id);
  }
  catch (e){ $('rvOk').disabled = false; msg('Não foi possível publicar: ' + (e.message || e)); }
}
// Importar pasta: código/revisão/família saem do nome ("Cópia controlada - IT 003 (V)R01 Título.pdf");
// pula duplicatas "(1)"; cria o documento se não existir; publica só se a revisão for nova.
let _IMP = [];
function itImportar(){
  ov('<div class="hd"><b>Importar pasta de documentos</b><div class="hint" style="margin-top:4px">Escolha os arquivos (pode selecionar todos de uma vez; PDF, planilha, Word…). Arquivo cujo nome não segue o padrão fica de fora — cadastre-o em "＋ Documento". Código, revisão e família — (V) = Victa — saem do nome do arquivo. Documento que já existe só ganha revisão se o número for diferente da vigente.</div></div><div class="bd">'
    + '<input type="file" id="impArq" multiple onchange="itImportarPrevia()">'
    + '<label class="chk" style="margin-top:10px"><input type="checkbox" id="impTroca" onchange="itImportarPrevia()"> <span><b>Corrigir arquivos da mesma revisão</b> — quando a revisão do arquivo é igual à vigente, troca o arquivo (ex.: versão sem carimbo de outro sistema). Não cria revisão, não torna cópias obsoletas e não envia e-mail.</span></label>'
    + '<div id="impPrev" style="margin-top:10px"></div><div class="msg" id="impMsg"></div></div>'
    + '<div class="ft"><button class="btn sec" onclick="ovFechar();telaITs()">Fechar</button><button class="btn" id="impOk" disabled onclick="itImportarRodar()">Importar</button></div>');
}
function itImportarPrevia(){
  const fs = [...$('impArq').files]; _IMP = [];
  const vistos = {};
  fs.forEach(f => {
    const r = AuriaIT.lerNome(f.name);
    if (!r){ _IMP.push({ f, erro:'nome fora do padrão' }); return; }
    if (vistos[r.codigo.toUpperCase()]){ _IMP.push({ f, r, pula:'duplicata' }); return; }
    vistos[r.codigo.toUpperCase()] = 1;
    const ex = ITS.find(i => i.codigo.toUpperCase() === r.codigo.toUpperCase()), v = ex && ex.revs.find(x => x.vigente);
    const troca = !!(v && v.revisao === r.revisao && $('impTroca') && $('impTroca').checked);
    _IMP.push({ f, r, ex, v, troca, pula: v && v.revisao === r.revisao && !troca ? 'já está nesta revisão' : '' });
  });
  const vai = _IMP.filter(x => x.r && !x.pula && !x.erro);
  $('impPrev').innerHTML = '<div class="hint" style="margin-bottom:6px"><b>' + vai.length + '</b> a importar · ' + (_IMP.length - vai.length) + ' ignorados</div><div style="max-height:300px;overflow:auto"><table><tr><th>Código</th><th>Rev.</th><th>Título</th><th></th></tr>'
    + _IMP.map(x => '<tr' + (x.pula || x.erro ? ' style="opacity:.5"' : '') + '><td class="cod">' + esc(x.r ? x.r.codigo : '?') + '</td><td class="cod">' + esc(x.r ? x.r.revisao : '') + '</td><td>' + esc(x.r ? x.r.titulo : x.f.name) + '</td><td class="hint">' + esc(x.erro || x.pula || (x.troca ? 'corrigir arquivo' : x.ex ? 'nova revisão' : 'novo')) + '</td></tr>').join('') + '</table></div>';
  $('impOk').disabled = !vai.length;
}
async function itImportarRodar(){
  const vai = _IMP.filter(x => x.r && !x.pula && !x.erro);
  const ign = _IMP.length - vai.length;
  $('impOk').disabled = true; $('impArq').disabled = true;
  // Progresso: barra + documento atual (a lista some enquanto envia).
  $('impPrev').innerHTML = '<div style="padding:14px 2px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><b id="impPasso">Preparando…</b><span id="impPct" class="cod">0%</span></div>'
    + '<div style="height:8px;background:#E2E8F0;border-radius:99px;overflow:hidden"><div id="impBar" style="height:100%;width:0;background:#E8762B;transition:width .25s"></div></div>'
    + '<div class="hint" style="margin-top:8px">Não feche esta janela até terminar.</div></div>';
  $('impMsg').textContent = '';
  let novos = 0, revs = 0, trocas = 0; const falhas = [];
  for (let k = 0; k < vai.length; k++){
    const x = vai[k];
    $('impPasso').textContent = 'Enviando ' + (k + 1) + ' de ' + vai.length + ' — ' + x.r.codigo;
    try {
      if (x.troca){ await _itTrocarArquivo(x.ex.id, x.v.id, x.f, 'arquivo substituído na importação'); trocas++; }
      else {
      let itId = x.ex && x.ex.id;
      if (!itId){
        const r = await sb.from('grupo_it_auria').insert({ grupo_id:GRUPO, codigo:x.r.codigo, titulo:x.r.titulo, tipo:x.r.tipo, familia:x.r.familia, tema: x.r.tipo === 'IT' ? 'execucao' : 'qualidade' }).select('id').single();
        if (r.error) throw r.error; itId = r.data.id;
      }
      await _itPublicarArquivo(itId, x.r.revisao, x.f, x.ex ? 'Importado da pasta' : 'Carga inicial');
      if (x.ex) revs++; else novos++;
      }
    } catch (e){ falhas.push({ cod:x.r.codigo, msg:(e.message || String(e)) }); }
    const pct = Math.round((k + 1) / vai.length * 100);
    $('impBar').style.width = pct + '%'; $('impPct').textContent = pct + '%';
  }
  await carregarITs();
  // Conclusão: quadro no lugar da lista + botão "Concluir" que fecha e atualiza.
  const okT = novos + revs + trocas;
  $('impPrev').innerHTML = '<div style="border:1px solid ' + (falhas.length ? '#F0B25B;background:#FEF6E7' : '#86C9A4;background:#E6F4EC') + ';border-radius:10px;padding:14px 16px;margin:6px 0">'
    + '<div style="font-size:15px;font-weight:700;color:' + (falhas.length ? '#7A4E05' : '#14532D') + '">' + (falhas.length ? '⚠ Importação concluída com ' + falhas.length + ' falha' + (falhas.length > 1 ? 's' : '') : '✓ Importação concluída') + '</div>'
    + '<div style="margin-top:8px;font-size:13px;line-height:1.7">'
    + '<b>' + okT + '</b> arquivo' + (okT === 1 ? '' : 's') + ' publicado' + (okT === 1 ? '' : 's') + ' · ' + novos + ' documento' + (novos === 1 ? '' : 's') + ' novo' + (novos === 1 ? '' : 's') + ' · ' + revs + ' revis' + (revs === 1 ? 'ão' : 'ões') + ' nova' + (revs === 1 ? '' : 's') + (trocas ? ' · ' + trocas + ' arquivo' + (trocas === 1 ? '' : 's') + ' corrigido' + (trocas === 1 ? '' : 's') + ' (mesma revisão)' : '') + '<br>'
    + ign + ' ignorado' + (ign === 1 ? '' : 's') + ' (já na mesma revisão, duplicata ou nome fora do padrão)<br>'
    + 'Biblioteca agora com <b>' + ITS.filter(i => i.ativo).length + '</b> documentos vigentes; o texto já entra na busca <b>Aa</b>.</div>'
    + (falhas.length ? '<div style="margin-top:10px;font-size:12.5px"><b>Não entraram:</b><ul style="margin:4px 0 0 18px;padding:0">' + falhas.map(f => '<li><span class="cod">' + esc(f.cod) + '</span> — ' + esc(f.msg) + '</li>').join('') + '</ul></div>' : '')
    + '</div>';
  const b = $('impOk'); b.disabled = false; b.textContent = 'Concluir'; b.onclick = () => { ovFechar(); telaITs(); };
}
