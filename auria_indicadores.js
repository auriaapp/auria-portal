// ============================================================================
//  auria_indicadores.js — Indicadores da Qualidade (F4, 2026-11-01)
//  ----------------------------------------------------------------------------
//  O grupo incorpora e constrói: a avaliação é por OBRA e por EMPRESA do grupo
//  (construtoras_auria). Tudo calculado aqui a partir do que a Qualidade já lê.
//  Nota da obra (0–100), pesos decididos com o usuário:
//    FVS 30 · NCs 25 · Ações no prazo + eficácia 20 · Auditorias 15 · Leitura 10
//  Componente sem dado no período sai da conta e o peso é redistribuído.
//  Globais da página: sb, $, esc, GRUPO, EMPS, cienciaCarregar()
// ============================================================================
(function(){
  const PESO = { fvs:30, nc:25, acoes:20, aud:15, leit:10 };
  const ROT = { fvs:'FVS na 1ª inspeção', nc:'Não conformidades', acoes:'Ações no prazo e eficácia', aud:'Auditorias', leit:'Leitura obrigatória' };
  const I = { per:365, sel:null, vista:'obras' };
  let D = null;
  const hoje = () => new Date().toISOString().slice(0, 10);
  const pct = (a, b) => b ? Math.round(100 * a / b) : null;
  const cor = v => v == null ? 'var(--mut)' : v >= 85 ? '#1E8449' : v >= 70 ? '#B7791F' : '#A32D2D';

  async function carregar(){
    const emps = EMPS.map(e => e.id);
    const desde = new Date(Date.now() - I.per * 864e5).toISOString();
    const [ems, cons, fvs, ncs, acs, auds, pavs, cie] = await Promise.all([
      sb.from('empreendimentos_auria').select('id,nome,construtora_id').in('id', emps.length ? emps : ['00000000-0000-0000-0000-000000000000']),
      sb.from('construtoras_auria').select('id,nome,sigla').eq('grupo_id', GRUPO),
      sb.from('fvs_inspecao_auria').select('id,empreendimento_id,servico,pavimento_id,situacao,rodada,aberta_em,aprovado_em,reprovado_em').eq('tipo', 'fvs').in('empreendimento_id', emps).gte('aberta_em', desde),
      sb.from('nc_auria').select('id,empreendimento_id,servico,pavimento_id,situacao,gravidade,reincidente_de,rodada,aberta_em,encerrada_em,equipe').eq('grupo_id', GRUPO).gte('aberta_em', desde),
      sb.from('nc_acao_auria').select('nc_id,prazo,situacao,concluida_em,rodada,nc_auria!inner(grupo_id,empreendimento_id)').eq('nc_auria.grupo_id', GRUPO),
      sb.from('aud_auditoria_auria').select('id,numero,titulo,empreendimento_id,situacao,itens,data_prevista,data_realizada').eq('grupo_id', GRUPO),
      sb.from('cde_pavimento_auria').select('id,codigo,nome,ordem,empreendimento_id').in('empreendimento_id', emps),
      typeof cienciaCarregar === 'function' ? cienciaCarregar(true) : Promise.resolve([])]);
    D = { ems:ems.data || [], cons:cons.data || [], fvs:fvs.data || [], ncs:ncs.data || [], acs:acs.data || [], auds:(auds.data || []).filter(a => a.situacao === 'concluida' && (a.data_realizada || a.data_prevista) >= desde.slice(0, 10)), pavs:pavs.data || [], cie:cie || [] };
  }

  // ── nota de um conjunto de obras ────────────────────────────────────────
  function avaliar(ids){
    const em = x => ids.includes(x.empreendimento_id);
    const f = D.fvs.filter(em).filter(x => ['aprovada','reprovada'].includes(x.situacao) || (x.rodada || 1) > 1);
    const fvs1 = f.filter(x => x.situacao === 'aprovada' && (x.rodada || 1) === 1).length;
    const n = D.ncs.filter(em), abertas = n.filter(x => !['encerrada','cancelada'].includes(x.situacao));
    const a = D.acs.filter(x => ids.includes(x.nc_auria.empreendimento_id));
    const noPrazo = a.filter(x => x.situacao === 'concluida' ? x.concluida_em.slice(0, 10) <= x.prazo : x.prazo >= hoje()).length;
    const encerr = n.filter(x => x.situacao === 'encerrada'), efic1 = encerr.filter(x => (x.rodada || 1) === 1).length;
    const it = D.auds.filter(em).flatMap(x => x.itens || []), c = it.filter(x => x.resultado === 'c').length, ncA = it.filter(x => x.resultado === 'nc').length;
    const ci = D.cie.filter(x => ids.includes(x.empreendimento_id));
    const comp = {
      fvs:  f.length ? pct(fvs1, f.length) : null,
      // NCs: parte de 100 e desconta por NC aberta (5), grave aberta (+10) e reincidente (+5); por volume de fichas, até 0
      nc:   (n.length || f.length) ? Math.max(0, 100 - Math.round((abertas.length * 5 + abertas.filter(x => x.gravidade === 'grave').length * 10 + n.filter(x => x.reincidente_de).length * 5) * 20 / Math.max(20, f.length))) : null,
      acoes: (a.length || encerr.length) ? Math.round(((a.length ? noPrazo / a.length : 1) * 0.6 + (encerr.length ? efic1 / encerr.length : 1) * 0.4) * 100) : null,
      aud:  (c + ncA) ? pct(c, c + ncA) : null,
      leit: ci.length ? pct(ci.filter(x => x.ciente_em).length, ci.length) : null
    };
    let soma = 0, pesos = 0;
    Object.keys(PESO).forEach(k => { if (comp[k] != null){ soma += comp[k] * PESO[k]; pesos += PESO[k]; } });
    return { nota: pesos ? Math.round(soma / pesos) : null, comp, fichas:f.length, ncs:n.length, abertas:abertas.length, graves:abertas.filter(x => x.gravidade === 'grave').length, reinc:n.filter(x => x.reincidente_de).length };
  }

  async function tela(){
    $('corpo').innerHTML = '<section class="tela"><div class="load">Calculando indicadores…</div></section>';
    try { await carregar(); } catch (e){ $('corpo').innerHTML = '<section class="tela"><div class="alerta rev">Não foi possível calcular: ' + esc(e.message || e) + '</div></section>'; return; }
    desenhar();
  }
  function barra(v){ return v == null ? '<span class="hint">sem dados</span>' : '<div style="display:flex;align-items:center;gap:6px"><div class="bar" style="flex:1;height:7px"><i style="width:' + v + '%;background:' + cor(v) + '"></i></div><span class="cod" style="min-width:30px;text-align:right">' + v + '</span></div>'; }
  function notaHtml(v){ return '<span style="display:inline-block;min-width:44px;text-align:center;font:800 15px var(--mono);color:#fff;border-radius:8px;padding:3px 6px;background:' + cor(v) + '">' + (v == null ? '—' : v) + '</span>'; }
  function desenhar(){
    const obras = D.ems.map(e => Object.assign({ e }, avaliar([e.id]))).sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1));
    const geral = avaliar(D.ems.map(e => e.id));
    const emps = D.cons.map(c => { const ids = D.ems.filter(e => e.construtora_id === c.id).map(e => e.id); return ids.length ? Object.assign({ c, n:ids.length }, avaliar(ids)) : null; }).filter(Boolean).sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1));
    const semEmp = D.ems.filter(e => !e.construtora_id).length;
    let h = '<section class="tela"><div class="thd"><div><h2>Indicadores da qualidade</h2><p class="sub">Nota de 0 a 100 por obra e por empresa do grupo — FVS ' + PESO.fvs + '% · NCs ' + PESO.nc + '% · ações e eficácia ' + PESO.acoes + '% · auditorias ' + PESO.aud + '% · leitura obrigatória ' + PESO.leit + '%. Componente sem dado no período não entra.</p></div>'
      + '<div class="tgl">' + [[90,'90 dias'], [180,'6 meses'], [365,'12 meses']].map(([d, t]) => '<button class="' + (I.per === d ? 'on' : '') + '" onclick="AuriaInd._per(' + d + ')">' + t + '</button>').join('') + '</div>'
      + '<div class="tgl">' + [['obras','Obras'], ['empresas','Empresas']].map(([k, t]) => '<button class="' + (I.vista === k ? 'on' : '') + '" onclick="AuriaInd._vista(\'' + k + '\')">' + t + '</button>').join('') + '</div></div>';
    // cartões do grupo
    h += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px">'
      + cartao('Nota do grupo', notaHtml(geral.nota))
      + Object.keys(PESO).map(k => cartao(ROT[k], geral.comp[k] == null ? '<span class="hint">sem dados</span>' : '<b style="font:800 20px var(--mono);color:' + cor(geral.comp[k]) + '">' + geral.comp[k] + '</b>')).join('') + '</div>';
    if (I.vista === 'empresas'){
      h += '<div class="card"><table><tr><th>Empresa do grupo</th><th>Obras</th><th>Nota</th>' + Object.keys(PESO).map(k => '<th>' + ROT[k] + '</th>').join('') + '</tr>'
        + (emps.length ? emps.map(x => '<tr><td><b>' + esc(x.c.nome) + '</b></td><td class="cod">' + x.n + '</td><td>' + notaHtml(x.nota) + '</td>' + Object.keys(PESO).map(k => '<td style="min-width:110px">' + barra(x.comp[k]) + '</td>').join('') + '</tr>').join('')
          : '<tr><td colspan="8"><div class="vazio">Nenhuma obra está ligada a uma empresa do grupo. O vínculo é feito no cadastro do empreendimento (Gestão).</div></td></tr>') + '</table>'
        + (semEmp ? '<div class="hint" style="padding:8px 14px">' + semEmp + ' obra(s) sem empresa vinculada não entram neste comparativo.</div>' : '') + '</div>';
    } else {
      h += '<div class="card"><table><tr><th>#</th><th>Obra</th><th>Nota</th>' + Object.keys(PESO).map(k => '<th>' + ROT[k] + '</th>').join('') + '<th>Fichas</th><th>NCs abertas</th></tr>'
        + obras.map((x, i) => '<tr style="cursor:pointer" onclick="AuriaInd._obra(\'' + x.e.id + '\')"><td class="cod">' + (x.nota == null ? '—' : i + 1) + '</td><td><b>' + esc(x.e.nome) + '</b><div class="hint">' + esc((D.cons.find(c => c.id === x.e.construtora_id) || {}).nome || 'sem empresa') + '</div></td><td>' + notaHtml(x.nota) + '</td>'
          + Object.keys(PESO).map(k => '<td style="min-width:110px">' + barra(x.comp[k]) + '</td>').join('') + '<td class="cod">' + x.fichas + '</td><td class="cod">' + x.abertas + (x.graves ? ' <span class="chip c-rev">' + x.graves + ' grave' + (x.graves > 1 ? 's' : '') + '</span>' : '') + '</td></tr>').join('') + '</table></div>';
    }
    h += '<div id="indObra"></div></section>';
    $('corpo').innerHTML = h;
    if (I.sel) obra(I.sel);
  }
  function cartao(t, v){ return '<div class="card" style="padding:12px 14px"><div class="hint" style="font-size:11px;min-height:28px">' + t + '</div><div style="margin-top:4px">' + v + '</div></div>'; }

  // ── ficha da obra: evolução mensal, mapa pavimento × serviço, pontos fracos ──
  function obra(id){
    I.sel = id;
    const e = D.ems.find(x => x.id === id), el = $('indObra'); if (!e || !el) return;
    const f = D.fvs.filter(x => x.empreendimento_id === id), n = D.ncs.filter(x => x.empreendimento_id === id);
    // evolução: últimos 12 meses (ou período), FVS 1ª inspeção % e NCs abertas no mês
    const meses = []; for (let i = Math.min(11, Math.ceil(I.per / 30) - 1); i >= 0; i--){ const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); meses.push(d.toISOString().slice(0, 7)); }
    const evo = meses.map(m => { const fm = f.filter(x => (x.aprovado_em || x.reprovado_em || x.aberta_em || '').startsWith(m) && (['aprovada','reprovada'].includes(x.situacao) || (x.rodada || 1) > 1));
      return { m, fvs:fm.length ? pct(fm.filter(x => x.situacao === 'aprovada' && (x.rodada || 1) === 1).length, fm.length) : null, nc:n.filter(x => x.aberta_em.startsWith(m)).length }; });
    const maxNc = Math.max(1, ...evo.map(x => x.nc));
    // mapa: reprovações (rodada>1 ou reprovada) + NCs por pavimento × serviço
    const pv = D.pavs.filter(p => p.empreendimento_id === id).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    const cel = {}; const add = (p, s) => { if (!s) return; const k = (p || '—') + '|' + s; cel[k] = (cel[k] || 0) + 1; };
    f.filter(x => x.situacao === 'reprovada' || (x.rodada || 1) > 1).forEach(x => add(x.pavimento_id, x.servico)); n.forEach(x => add(x.pavimento_id, x.servico));
    const servs = [...new Set(Object.keys(cel).map(k => k.split('|')[1]))].sort();
    const pavsUsados = pv.filter(p => servs.some(s => cel[p.id + '|' + s])).concat(servs.some(s => cel['—|' + s]) ? [{ id:'—', codigo:'—', nome:'Sem pavimento' }] : []);
    const maxC = Math.max(1, ...Object.values(cel));
    // pontos fracos: serviços com mais problemas e reincidência
    const fr = servs.map(s => ({ s, t:Object.keys(cel).filter(k => k.endsWith('|' + s)).reduce((a, k) => a + cel[k], 0), r:n.filter(x => x.servico === s && x.reincidente_de).length })).sort((a, b) => b.t - a.t).slice(0, 6);
    const auds = D.auds.filter(x => x.empreendimento_id === id);
    el.innerHTML = '<div class="card" style="margin-top:16px"><div class="hd"><b>' + esc(e.nome) + '</b><span style="flex:1"></span><button class="btn sec sm" onclick="AuriaInd._fechar()">Fechar</button></div><div style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:18px">'
      + '<div><div class="mono-t">EVOLUÇÃO MENSAL</div><table><tr><th>Mês</th><th>FVS na 1ª</th><th>NCs abertas</th></tr>' + evo.map(x => '<tr><td class="cod">' + x.m.slice(5) + '/' + x.m.slice(2, 4) + '</td><td style="min-width:140px">' + barra(x.fvs) + '</td><td><div style="display:flex;align-items:center;gap:6px"><div style="height:7px;width:' + Math.round(80 * x.nc / maxNc) + 'px;background:#A32D2D;border-radius:4px"></div><span class="cod">' + x.nc + '</span></div></td></tr>').join('') + '</table></div>'
      + '<div><div class="mono-t">PONTOS FRACOS (SERVIÇOS)</div>' + (fr.length ? '<table><tr><th>Serviço</th><th>Reprovações + NCs</th><th>Reincidentes</th></tr>' + fr.map(x => '<tr><td>' + esc(x.s) + '</td><td class="cod">' + x.t + '</td><td>' + (x.r ? '<span class="chip c-rev">' + x.r + '</span>' : '—') + '</td></tr>').join('') + '</table>' : '<div class="hint">Sem reprovações nem NCs no período.</div>')
      + '<div class="mono-t" style="margin-top:14px">AUDITORIAS NO PERÍODO</div>' + (auds.length ? auds.map(a => { const it = a.itens || []; return '<div class="hint">AUD ' + String(a.numero).padStart(3, '0') + ' · ' + esc(a.titulo) + ' — ' + it.filter(x => x.resultado === 'c').length + ' C · ' + it.filter(x => x.resultado === 'nc').length + ' NC · ' + it.filter(x => x.resultado === 'om').length + ' OM</div>'; }).join('') : '<div class="hint">Nenhuma auditoria concluída nesta obra no período.</div>') + '</div></div>'
      + '<div style="padding:0 16px 16px"><div class="mono-t">MAPA PAVIMENTO × SERVIÇO (reprovações + NCs)</div>' + (servs.length ? '<div style="overflow:auto"><table><tr><th>Pavimento</th>' + servs.map(s => '<th style="font-size:10.5px;max-width:110px">' + esc(s) + '</th>').join('') + '</tr>'
          + pavsUsados.map(p => '<tr><td class="cod">' + esc(p.codigo || p.nome) + '</td>' + servs.map(s => { const v = cel[p.id + '|' + s] || 0; return '<td style="text-align:center;font:700 11px var(--mono);' + (v ? 'background:rgba(163,45,45,' + (0.15 + 0.7 * v / maxC).toFixed(2) + ');color:' + (v / maxC > .5 ? '#fff' : '#7A1F1F') : 'color:var(--line)') + '">' + (v || '·') + '</td>'; }).join('') + '</tr>').join('') + '</table></div>' : '<div class="hint">Nada a mapear no período.</div>') + '</div></div>';
    el.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  window.AuriaInd = { tela, _per(d){ I.per = d; tela(); }, _vista(k){ I.vista = k; desenhar(); }, _obra:obra, _fechar(){ I.sel = null; $('indObra').innerHTML = ''; } };
})();
