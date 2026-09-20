// ============================================================================
//  auria_cronocustos.js — CRONOGRAMA DE CUSTOS (item 73/73b), componente único
//  usado pelo adm-fin (auria_custos.html) e pela gestão (auria_gerencia.html).
//  Grade mês × empreendimento › disciplina › contrato: parcelas dos contratos
//  pelo vencimento + NFs sem contrato pela emissão; barras previsto × realizado;
//  vencidas; popover por célula; Excel com logo.
//  Uso: AuriaCronoCustos.montar(containerEl, {
//         contratos: async()=>[...],   // formato de fin_contratos (parcelas: array)
//         nfs:       async()=>[...],   // formato de nf_listar
//         abrirContrato: (contratoId)=>{},   // opcional (atalho 📋)
//         grupo: ()=>'Nome do grupo'          // opcional (cabeçalho do Excel)
//       });
//  Depende de: ExcelJS (carregado sob demanda), logo_symbol.png no mesmo diretório.
// ============================================================================
(function(){
const CSS = `

/* tokens + classes de apoio (o componente é autônomo: funciona no adm-fin e na gestão) */
.cc-wrap,.cr-pop{--panel:#FFFFFF;--panel2:#F6F9FC;--line:#E2E8F0;--txt:#0F172A;--txt2:#334155;--mut:#64748B;--navy:#1E3A5F;--accent:#E8960A;--ok:#1E8449;--err:#A32D2D;--mono:ui-monospace,"Cascadia Mono",Consolas,"SF Mono",Menlo,monospace;color:var(--txt)}
.cc-wrap .mono,.cr-pop .mono{font-family:var(--mono)}
.cc-wrap .cd-hint{font-size:12px;color:var(--mut)}
.cc-wrap .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.cc-wrap .kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px}
.cc-wrap .kpi .l{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:var(--mut)}
.cc-wrap .kpi .v{font-family:var(--mono);font-size:20px;font-weight:800;color:var(--navy);line-height:1.2;margin-top:2px}
.cc-wrap .kpi.acc{border-color:#F0B25B;background:rgba(232,150,10,.08)} .cc-wrap .kpi.acc .l{color:#7C3E06} .cc-wrap .kpi.acc .v{color:#7C3E06}
.cc-wrap .kpi.ok .v{color:var(--ok)}
.cc-wrap .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.cc-wrap .st,.cr-pop .st{display:inline-block;font-size:10px;font-weight:800;padding:2px 8px;border-radius:9px;white-space:nowrap}
.cc-wrap .mini,.cr-pop .mini{background:var(--panel2);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:4px 9px;font-size:11.5px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block;font-family:inherit;line-height:1.3}
.cc-wrap .mini:hover,.cr-pop .mini:hover{border-color:var(--accent)}
.cc-wrap .mini.go{background:var(--navy);color:#fff;border-color:var(--navy)} .cc-wrap .mini.go:hover{background:#16304f}
.cc-wrap .empty{padding:26px;text-align:center;color:var(--mut);font-size:13px}
.cc-wrap table{width:100%;border-collapse:collapse;font-size:12.5px}
.cc-wrap thead th{background:var(--panel2);color:var(--mut);padding:9px 12px;font-weight:800;white-space:nowrap;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.cc-wrap td{padding:8px 12px;border-top:1px solid #F1F5F9;color:var(--txt2);vertical-align:middle}
/* Item 73: cronograma de custos (grade mês × empreendimento) */
.cr-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cr-top select{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;font-family:inherit;color:var(--txt)}
.cr-chart{display:flex;align-items:flex-end;gap:6px;height:120px;padding:6px 4px 0;border-bottom:1px solid var(--line)}
.cr-chart .cb{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;min-width:0;cursor:pointer}
.cr-chart .cb i{display:block;width:100%}
.cr-chart .cb:hover i{filter:brightness(.92)}
.cr-lbl{display:flex;gap:6px;padding:4px 4px 0;font-size:10.5px;color:var(--mut);font-family:var(--mono)}
.cr-lbl span{flex:1;text-align:center;white-space:nowrap;overflow:hidden}
.cr-leg{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--txt2);margin-top:8px}
.cr-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:4px}
.cr-grid{overflow:auto;max-height:70vh}
.cr-grid table{font-size:12px;min-width:100%}
.cr-grid thead th{position:sticky;top:0;z-index:2;text-align:right}
.cr-grid thead th:first-child,.cr-grid td:first-child{position:sticky;left:0;z-index:3;background:var(--panel);text-align:left;min-width:220px;box-shadow:inset -1px 0 0 var(--line)}
.cr-grid thead th:first-child{z-index:4;background:var(--panel2)}
.cr-grid th.hoje{color:var(--navy);box-shadow:inset 0 -2px 0 var(--accent)}
.cr-grid td{text-align:right;font-family:var(--mono);white-space:nowrap;padding:6px 10px;color:var(--txt2)}
.cr-grid td.v{cursor:pointer}.cr-grid td.v:hover{background:rgba(232,150,10,.10)}
.cr-grid td.z{color:#CBD5E1}
.cr-grid td.late{color:var(--err);font-weight:800}
.cr-grid .sb{display:flex;height:3px;margin-top:3px;border-radius:2px;overflow:hidden;background:transparent}
.cr-grid .sb i{display:block;height:100%}
.cr-grid tr.emp td{font-weight:800;color:var(--navy);background:var(--panel2)}
.cr-grid tr.emp td:first-child{font-family:var(--mono);cursor:pointer}
.cr-grid tr.disc td:first-child{padding-left:26px;font-weight:700;cursor:pointer;font-family:inherit}
.cr-grid tr.ctr td:first-child{padding-left:44px;font-family:inherit;color:var(--mut)}
.cr-grid tr.tot td{font-weight:800;color:var(--navy);border-top:2px solid var(--navy);background:var(--panel)}
.cr-grid tr.acu td{font-weight:700;color:var(--mut);background:var(--panel)}
.cr-grid .tg{display:inline-block;width:14px;color:var(--mut);font-size:10px}
.cr-grid tr.emp td.late,.cr-grid tr.tot td.late{color:var(--err)}
.cr-pop{position:fixed;z-index:60;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.18);width:520px;max-width:96vw;max-height:70vh;display:flex;flex-direction:column;overflow:hidden}
.cr-pop h4{margin:0;padding:10px 14px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
.cr-pop h4 b{color:var(--navy);font-family:var(--mono);text-transform:none;letter-spacing:0;font-size:13px}
.cr-pop .x{margin-left:auto;background:none;border:0;font-size:18px;cursor:pointer;color:var(--mut)}
.cr-pop .ls{overflow:auto;padding:4px 0}
.cr-pop .it{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:7px 14px;border-bottom:1px solid #F1F5F9;font-size:12px;align-items:center}
.cr-pop .it .n{color:var(--txt);font-weight:600}.cr-pop .it .s{font-size:11px;color:var(--mut)}
.cr-pop .it .vv{font-family:var(--mono);font-weight:800;color:var(--navy);text-align:right}
.cr-pop .it.late .vv{color:var(--err)}
`;
const HTML = `

        <div class="kpis" style="margin-bottom:12px">
          <div class="kpi"><div class="l">Previsto no período</div><div class="v" id="crKPrev">—</div></div>
          <div class="kpi ok"><div class="l">Realizado no período</div><div class="v" id="crKReal">—</div></div>
          <div class="kpi acc" id="crKLateBox" style="display:none"><div class="l">Vencidas e não faturadas</div><div class="v" id="crKLate">—</div></div>
          <div class="kpi"><div class="l">Sem data de vencimento</div><div class="v" id="crKSem">—</div></div>
        </div>
        <div class="card" style="margin-bottom:12px">
          <div class="cr-top">
            <button class="mini" onclick="crMover(-3)" title="3 meses para trás">&#9664;</button>
            <b class="mono" id="crPeriodo" style="font-size:13px;color:var(--navy);min-width:150px;text-align:center">—</b>
            <button class="mini" onclick="crMover(3)" title="3 meses para a frente">&#9654;</button>
            <button class="mini" onclick="crHoje()">Hoje</button>
            <select id="crN" onchange="crRender()"><option value="6">6 meses</option><option value="12" selected>12 meses</option><option value="24">24 meses</option></select>
            <span style="width:1px;height:20px;background:var(--line)"></span>
            <select id="crEmp" onchange="crRender()"><option value="">Todos os empreendimentos</option></select>
            <select id="crDisc" onchange="crRender()"><option value="">Todas as disciplinas</option></select>
            <select id="crModo" onchange="crRender()"><option value="">Previsto + realizado</option><option value="prev">Só previsto (a faturar / solicitada / autorizada)</option><option value="real">Só realizado (faturada / paga)</option></select>
            <span style="margin-left:auto"></span>
            <button class="mini" onclick="crExpandir(true)" title="Abrir todos os empreendimentos">&#9662; abrir tudo</button>
            <button class="mini" onclick="crExpandir(false)">&#9656; fechar</button>
            <button class="mini go" id="crXlsBtn" onclick="crExportarXlsx()" title="Baixar a grade e a lista de parcelas em Excel">&#128202; Excel</button>
          </div>
          <div id="crChart" style="margin-top:12px"></div>
        </div>
        <div class="card" style="padding:0;overflow:hidden">
          <div class="cr-grid" id="crGrid"><div class="empty">Carregando&hellip;</div></div>
        </div>
        <div class="cd-hint" style="margin-top:8px">Parcelas dos contratos pelo <b>vencimento</b> · NFs enviadas pelo link p&uacute;blico (sem contrato) pela data de emiss&atilde;o, marcadas &ldquo;sem contrato&rdquo; · vermelho = venceu e ainda n&atilde;o foi faturada. Clique numa c&eacute;lula para ver as parcelas do m&ecirc;s.</div>
      
`;
const CC={ opts:{}, contratos:[], nfs:[], abrirContrato:(id)=>{ if(CC.opts.abrirContrato) CC.opts.abrirContrato(id); } };
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function brl(v){ return 'R$ '+(Number(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function dbr(s){ if(!s)return '—'; var p=String(s).slice(0,10).split('-'); return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:s; }
// Fonte: parcelas dos contratos (fin_contratos → vencimento/valor/status) + NFs sem contrato
// (nf_listar, origem 'externa' ou sem contrato_id → emitida_em, contam como realizado).
// Tudo no cliente: nenhuma consulta nova.
const CR={ ini:null, open:new Set(), itens:null };
const CR_ST={ a_faturar:{r:'A faturar',c:'#94A3B8',g:'prev'}, solicitada:{r:'Solicitada',c:'#E8960A',g:'prev'}, autorizada:{r:'Autorizada',c:'#3B82F6',g:'prev'},
              faturada:{r:'Faturada',c:'#8B5CF6',g:'real'}, paga:{r:'Paga',c:'#10B981',g:'real'} };
const CR_MES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function crYM(d){ return d?String(d).slice(0,7):null; }
function crAddM(ym, k){ const [y,m]=ym.split('-').map(Number); const t=y*12+(m-1)+k; return String(Math.floor(t/12))+'-'+String(t%12+1).padStart(2,'0'); }
function crLbl(ym){ const [y,m]=ym.split('-'); return CR_MES[Number(m)-1]+'/'+y.slice(2); }
function crHojeYM(){ return new Date().toISOString().slice(0,7); }
function crHojeD(){ return new Date().toISOString().slice(0,10); }
// Monta a lista única de itens (parcelas + NFs sem contrato)
function crItens(){
  if(CR.itens) return CR.itens;
  const out=[];
  (CC.contratos||[]).forEach(c=>{ (c.parcelas||[]).forEach(p=>{
    if(!CR_ST[p.status]) return;                              // recusada / cancelada não entram
    out.push({ tipo:'parcela', id:p.id, emp_id:c.empreendimento_id, emp:c.empreendimento, construtora:c.construtora||'', disc:c.disciplina||'Sem disciplina',
               ctr_id:c.contrato_id, ctr:(c.numero?c.numero+' · ':'')+(c.projetista||c.objeto||'contrato'), num:p.numero, desc:p.descricao||'', valor:Number(p.valor||0), data:p.vencimento?String(p.vencimento).slice(0,10):null, status:p.status }); }); });
  (CC.nfs||[]).forEach(n=>{
    if(n.contrato_id || n.status==='cancelada') return;
    const eid=n.empreendimento_id||('nf-'+(n.construtora||'x'));
    out.push({ tipo:'nf', id:n.id, emp_id:eid, emp:n.empreendimento||'— sem empreendimento —', construtora:n.construtora||'', disc:n.disciplina||'Sem disciplina',
               ctr_id:'nf-'+eid+'-'+(n.disciplina||''), ctr:'NFs sem contrato', num:null, desc:(n.nf_numero?'NF '+n.nf_numero+' · ':'')+(n.projetista||''), valor:Number(n.valor||0),
               data:(n.emitida_em||n.criado_em||'').slice(0,10)||null, status:n.status==='paga'?'paga':'faturada' }); });
  CR.itens=out; return out;
}
function crJs(k){ return String(k).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/</g,'&lt;'); }   // chave dentro de onclick="...('…')\"
function crLate(it){ return CR_ST[it.status].g==='prev' && it.data && it.data<crHojeD(); }
function crMeses(){ const n=Number($('crN').value)||12; const a=[]; for(let i=0;i<n;i++) a.push(crAddM(CR.ini,i)); return a; }
function crMover(k){ CR.ini=crAddM(CR.ini,k); crRender(); }
function crHoje(){ CR.ini=crAddM(crHojeYM(),-1); crRender(); }
function crExpandir(on){ CR.open.clear(); if(on){ crItens().forEach(it=>{ CR.open.add(it.emp_id); CR.open.add(it.emp_id+'|'+it.disc); }); } crRender(); }
function crToggle(k){ if(CR.open.has(k)) CR.open.delete(k); else CR.open.add(k); crRender(); }
function crFiltrados(){
  const emp=$('crEmp').value, disc=$('crDisc').value, modo=$('crModo').value;
  return crItens().filter(it=>(!emp||it.emp_id===emp)&&(!disc||it.disc===disc)&&(!modo||CR_ST[it.status].g===modo));
}
async function crAbrir(){
  const el=$('crGrid');
  try{ CC.contratos=await CC.opts.contratos(); CC.nfs=await CC.opts.nfs(); }catch(e){ el.innerHTML='<div class="empty">Erro ao carregar: '+esc(e.message||e)+'</div>'; return; }
  CR.itens=null;
  if(!CR.ini) CR.ini=crAddM(crHojeYM(),-1);                 // começa um mês antes de hoje (contexto)
  const its=crItens();
  // filtros (mantém a escolha atual)
  const emps={}; its.forEach(it=>{ emps[it.emp_id]=it.emp; }); const discs=[...new Set(its.map(it=>it.disc))].sort();
  const vE=$('crEmp').value, vD=$('crDisc').value;
  $('crEmp').innerHTML='<option value="">Todos os empreendimentos</option>'+Object.keys(emps).sort((a,b)=>emps[a].localeCompare(emps[b])).map(k=>`<option value="${esc(k)}">${esc(emps[k])}</option>`).join('');
  $('crDisc').innerHTML='<option value="">Todas as disciplinas</option>'+discs.map(d=>`<option>${esc(d)}</option>`).join('');
  $('crEmp').value=vE; $('crDisc').value=vD;
  if(!CR.open.size && Object.keys(emps).length===1) CR.open.add(Object.keys(emps)[0]);
  crRender();
}
function crRender(){
  const meses=crMeses(), its=crFiltrados(), hoje=crHojeYM(), hojeD=crHojeD();
  const first=meses[0], last=meses[meses.length-1];
  $('crPeriodo').textContent=crLbl(first)+' — '+crLbl(last);
  // coluna de cada item: 'antes' | ym | 'depois' | 'sem'
  const col=it=>{ if(!it.data) return 'sem'; const ym=crYM(it.data); if(ym<first) return 'antes'; if(ym>last) return 'depois'; return ym; };
  const cols=['antes',...meses,'depois','sem'];
  const colLbl=c=>c==='antes'?'antes':c==='depois'?'depois':c==='sem'?'sem data':crLbl(c);
  // agregação: chave → {col → {tot, late, st:{status→valor}}}
  const agg={}; const add=(k,c,it)=>{ const a=agg[k]||(agg[k]={}); const o=a[c]||(a[c]={tot:0,late:0,st:{},n:0}); o.tot+=it.valor; o.n++; if(crLate(it)) o.late+=it.valor; o.st[it.status]=(o.st[it.status]||0)+it.valor; };
  const tree={};   // emp_id → {nome, construtora, discs:{disc → {ctrs:{ctr_id → nome}}}}
  its.forEach(it=>{ const c=col(it); add('T',c,it); add(it.emp_id,c,it); add(it.emp_id+'|'+it.disc,c,it); add(it.ctr_id,c,it);
    const e=tree[it.emp_id]||(tree[it.emp_id]={nome:it.emp,construtora:it.construtora,discs:{}}); const d=e.discs[it.disc]||(e.discs[it.disc]={ctrs:{}}); d.ctrs[it.ctr_id]=it.ctr; });
  // KPIs (no período visível)
  let prev=0, real=0, late=0, sem=0;
  its.forEach(it=>{ const c=col(it); if(c==='sem') sem+=it.valor; if(crLate(it)) late+=it.valor; if(c!=='antes'&&c!=='depois'&&c!=='sem'){ if(CR_ST[it.status].g==='prev') prev+=it.valor; else real+=it.valor; } });
  $('crKPrev').textContent=brl(prev); $('crKReal').textContent=brl(real); $('crKSem').textContent=brl(sem);
  $('crKLateBox').style.display=late>0?'':'none'; $('crKLate').textContent=brl(late);
  // gráfico (só os meses)
  const T=agg['T']||{}; const max=Math.max(1,...meses.map(m=>(T[m]||{tot:0}).tot));
  const ordSt=Object.keys(CR_ST);
  $('crChart').innerHTML=its.length?`<div class="cr-chart">${meses.map(m=>{ const o=T[m]; const h=o?Math.round(o.tot/max*100):0;
      return `<div class="cb" title="${crLbl(m)} · ${brl(o?o.tot:0)}" onclick="crCelula('T','${m}',event)">${o?ordSt.filter(s=>o.st[s]).map(s=>`<i style="height:${(o.st[s]/o.tot*h).toFixed(2)}%;background:${CR_ST[s].c}"></i>`).reverse().join(''):'<i style="height:1px;background:var(--line)"></i>'}</div>`; }).join('')}</div>
    <div class="cr-lbl">${meses.map(m=>`<span style="${m===hoje?'color:var(--navy);font-weight:800':''}">${crLbl(m)}</span>`).join('')}</div>
    <div class="cr-leg">${ordSt.map(s=>`<span><i style="background:${CR_ST[s].c}"></i>${CR_ST[s].r}</span>`).join('')}<span><i style="background:transparent;border:2px solid var(--err);width:8px;height:8px"></i>vencida</span></div>`:'';
  // grade
  if(!its.length){ $('crGrid').innerHTML='<div class="empty">Nenhuma parcela ou NF no filtro.</div>'; return; }
  const cel=(k,c,cls='')=>{ const o=(agg[k]||{})[c]; if(!o||!o.tot) return `<td class="z ${cls}">—</td>`;
    const bar=`<div class="sb">${ordSt.filter(s=>o.st[s]).map(s=>`<i style="width:${(o.st[s]/o.tot*100).toFixed(1)}%;background:${CR_ST[s].c}"></i>`).join('')}</div>`;
    return `<td class="v ${o.late?'late':''} ${cls}" onclick="crCelula('${crJs(k)}','${c}',event)" title="${o.n} item(ns)${o.late?' · vencido: '+brl(o.late):''}">${brl(o.tot).replace('R$ ','')}${bar}</td>`; };
  let html=`<table><thead><tr><th>Empreendimento › disciplina › contrato</th>${cols.map(c=>`<th class="${c===hoje?'hoje':''}" style="${c==='antes'||c==='depois'||c==='sem'?'color:#94A3B8':''}">${colLbl(c)}</th>`).join('')}<th>Total</th></tr></thead><tbody>`;
  const rowTot=k=>{ const a=agg[k]||{}; return Object.values(a).reduce((s,o)=>s+o.tot,0); };
  Object.keys(tree).sort((a,b)=>tree[a].nome.localeCompare(tree[b].nome)).forEach(eid=>{
    const e=tree[eid], op=CR.open.has(eid);
    html+=`<tr class="emp"><td onclick="crToggle('${eid}')" title="${esc(e.construtora)}"><span class="tg">${op?'▾':'▸'}</span>${esc(e.nome)}</td>${cols.map(c=>cel(eid,c)).join('')}<td>${brl(rowTot(eid)).replace('R$ ','')}</td></tr>`;
    if(!op) return;
    Object.keys(e.discs).sort().forEach(d=>{
      const dk=eid+'|'+d, opd=CR.open.has(dk);
      html+=`<tr class="disc"><td onclick="crToggle('${crJs(dk)}')"><span class="tg">${opd?'▾':'▸'}</span>${esc(d)}</td>${cols.map(c=>cel(dk,c)).join('')}<td>${brl(rowTot(dk)).replace('R$ ','')}</td></tr>`;
      if(!opd) return;
      Object.keys(e.discs[d].ctrs).forEach(ck=>{ const nome=e.discs[d].ctrs[ck]; const real=String(ck).startsWith('nf-')?'':` <a class="mini" style="padding:0 5px;font-size:10px" onclick="event.stopPropagation();CC.abrirContrato('${ck}')" title="Resumo do contrato">📋</a>`;
        html+=`<tr class="ctr"><td>${esc(nome)}${real}</td>${cols.map(c=>cel(ck,c)).join('')}<td>${brl(rowTot(ck)).replace('R$ ','')}</td></tr>`; });
    });
  });
  // totais + acumulado (acumula só o que tem data, na ordem antes → meses → depois)
  let acu=0; const acus={};
  cols.forEach(c=>{ if(c==='sem'){ acus[c]=null; return; } acu+=(T[c]||{tot:0}).tot; acus[c]=acu; });
  html+=`<tr class="tot"><td>Total do mês</td>${cols.map(c=>cel('T',c)).join('')}<td>${brl(rowTot('T')).replace('R$ ','')}</td></tr>`;
  html+=`<tr class="acu"><td>Acumulado</td>${cols.map(c=>`<td>${acus[c]==null?'—':brl(acus[c]).replace('R$ ','')}</td>`).join('')}<td></td></tr>`;
  html+='</tbody></table>';
  $('crGrid').innerHTML=html;
}
// Popover com as parcelas/NFs de uma célula
function crCelula(k, c, ev){
  const old=document.getElementById('crPop'); if(old) old.remove();
  const meses=crMeses(), first=meses[0], last=meses[meses.length-1];
  const col=it=>{ if(!it.data) return 'sem'; const ym=crYM(it.data); if(ym<first) return 'antes'; if(ym>last) return 'depois'; return ym; };
  const its=crFiltrados().filter(it=>col(it)===c && (k==='T' || it.emp_id===k || (it.emp_id+'|'+it.disc)===k || it.ctr_id===k))
    .sort((a,b)=>String(a.data||'9').localeCompare(String(b.data||'9'))||a.emp.localeCompare(b.emp));
  if(!its.length) return;
  const tot=its.reduce((s,it)=>s+it.valor,0);
  const lbl=c==='antes'?'antes do período':c==='depois'?'depois do período':c==='sem'?'sem data':crLbl(c);
  const pop=document.createElement('div'); pop.className='cr-pop'; pop.id='crPop';
  pop.innerHTML=`<h4>${esc(lbl)} <b>${brl(tot)}</b> <span style="font-weight:400;text-transform:none;letter-spacing:0">· ${its.length} item(ns)</span><button class="x" onclick="this.closest('.cr-pop').remove()">&times;</button></h4>
    <div class="ls">${its.map(it=>{ const st=CR_ST[it.status], late=crLate(it);
      return `<div class="it ${late?'late':''}"><div class="n">${esc(it.emp)} · ${esc(it.disc)}${it.tipo==='nf'?' <span class="st" style="background:rgba(232,150,10,.16);color:#7C3E06">sem contrato</span>':''}</div><div class="vv">${brl(it.valor)}</div>
        <div class="s">${it.tipo==='parcela'?'Parcela '+(it.num||'?')+(it.desc?' — '+esc(it.desc):'')+' · '+esc(it.ctr):esc(it.desc)} · ${dbr(it.data)} · <span style="color:${st.c};font-weight:700">${st.r}</span>${late?' · <span style="color:var(--err);font-weight:700">vencida</span>':''}</div>
        <div style="text-align:right">${it.tipo==='parcela'?`<a class="mini" style="padding:1px 6px;font-size:10px" onclick="CC.abrirContrato('${it.ctr_id}')">📋 contrato</a>`:''}</div></div>`; }).join('')}</div>`;
  document.body.appendChild(pop);
  const x=Math.min(window.innerWidth-pop.offsetWidth-12, Math.max(12,(ev&&ev.clientX||200)-260)), y=Math.min(window.innerHeight-pop.offsetHeight-12, Math.max(12,(ev&&ev.clientY||200)+14));
  pop.style.left=x+'px'; pop.style.top=y+'px';
  setTimeout(()=>{ const f=e=>{ if(!pop.contains(e.target)){ pop.remove(); document.removeEventListener('mousedown',f); } }; document.addEventListener('mousedown',f); },0);
}
// Excel: aba "Cronograma" (grade como está na tela, expandida) + aba "Parcelas" (lista)
function crScript(src){ return new Promise((res,rej)=>{ if([...document.scripts].some(s=>s.src===src)) return res(); const s=document.createElement('script'); s.src=src; s.onload=()=>res(); s.onerror=()=>rej(new Error('falha ao carregar '+src)); document.head.appendChild(s); }); }
// Logo reduzida (o PNG original tem 1,2 MB; para o Excel bastam ~120 px de altura)
async function crLogoB64(){ try{ const im=new Image(); await new Promise((res,rej)=>{ im.onload=res; im.onerror=rej; im.src='logo_symbol.png'; });
  const H=120, c=document.createElement('canvas'); c.width=Math.max(1,Math.round(H*im.naturalWidth/im.naturalHeight)); c.height=H; c.getContext('2d').drawImage(im,0,0,c.width,c.height); return c.toDataURL('image/png').split(',')[1]; }catch(_){ return null; } }
async function crExportarXlsx(){
  const its=crFiltrados(); if(!its.length){ alert('Nada para exportar no filtro.'); return; }
  const btn=$('crXlsBtn'); const old=btn.innerHTML; btn.textContent='…'; btn.disabled=true;
  try{
    await crScript('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js');
    const ExcelJS=window.ExcelJS; if(!ExcelJS) throw new Error('ExcelJS não carregou');
    const wb=new ExcelJS.Workbook(); wb.creator='Auria'; wb.created=new Date();
    const NAVY='FF1E3A5F', LARANJA='FFE8960A', ZEBRA='FFF6F9FC', LINHA='FFE2E8F0', CINZA='FF64748B', BRANCO='FFFFFFFF', VERM='FFA93226';
    const hoje=new Date().toLocaleDateString('pt-BR'), grupo=(CC.opts.grupo&&CC.opts.grupo())||'';
    let logoId=null, logoExt={width:40,height:40};
    try{ const b64=await crLogoB64(); if(b64){ const dim=await new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res({w:im.naturalWidth||1,h:im.naturalHeight||1}); im.onerror=rej; im.src='data:image/png;base64,'+b64; });
      logoExt={ width:Math.round(40*(dim.w/dim.h)), height:40 }; logoId=wb.addImage({base64:'data:image/png;base64,'+b64,extension:'png'}); } }catch(_){}
    const filtro=[$('crEmp').selectedOptions[0]&&$('crEmp').value?$('crEmp').selectedOptions[0].textContent:null, $('crDisc').value||null, $('crModo').value?$('crModo').selectedOptions[0].textContent:null].filter(Boolean).join(' · ')||'todos';
    const cab=(ws, titulo, cols, sub)=>{
      if(logoId!=null) ws.addImage(logoId,{ tl:{col:0.15,row:0.15}, ext:logoExt });
      ws.mergeCells(1,2,1,Math.max(2,cols)); const t=ws.getCell(1,2); t.value=titulo; t.font={bold:true,size:15,color:{argb:NAVY}}; t.alignment={vertical:'middle'};
      ws.mergeCells(2,2,2,Math.max(2,cols)); const s=ws.getCell(2,2); s.value=(grupo?grupo+'   ·   ':'')+hoje+'   ·   '+sub; s.font={size:10,color:{argb:CINZA}};
      ws.mergeCells(3,1,3,cols); const f=ws.getCell(3,1); f.value='Filtro: '+filtro; f.font={size:9,italic:true,color:{argb:CINZA}};
      ws.getRow(1).height=30; ws.getRow(4).height=4;
      for(let c=1;c<=cols;c++) ws.getCell(4,c).fill={type:'pattern',pattern:'solid',fgColor:{argb:LARANJA}};
    };
    const header=(ws, cols, row)=>{ const hr=ws.getRow(row); cols.forEach((c,i)=>{ const cell=hr.getCell(i+1); cell.value=c.h; cell.font={bold:true,color:{argb:BRANCO},size:11}; cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:NAVY}}; cell.alignment={vertical:'middle',horizontal:i?'right':'left',wrapText:true}; }); hr.height=22; };
    const money='"R$ "#,##0.00';
    // ── Cronograma ──
    const meses=crMeses(), first=meses[0], last=meses[meses.length-1];
    const col=it=>{ if(!it.data) return 'sem'; const ym=crYM(it.data); if(ym<first) return 'antes'; if(ym>last) return 'depois'; return ym; };
    const cols=['antes',...meses,'depois','sem']; const colLbl=c=>c==='antes'?'Antes':c==='depois'?'Depois':c==='sem'?'Sem data':crLbl(c);
    const gCols=[{key:'n',h:'Empreendimento › disciplina › contrato',w:44},...cols.map(c=>({key:c,h:colLbl(c),w:13})),{key:'tot',h:'Total',w:15}];
    const ws=wb.addWorksheet('Cronograma',{ views:[{state:'frozen',xSplit:1,ySplit:5}] }); ws.columns=gCols.map(c=>({key:c.key,width:c.w}));
    cab(ws,'Cronograma de custos',gCols.length,crLbl(first)+' — '+crLbl(last)); header(ws,gCols,5);
    const agg={}, late={}; const add=(k,c,it)=>{ const a=agg[k]||(agg[k]={}); a[c]=(a[c]||0)+it.valor; if(crLate(it)){ const l=late[k]||(late[k]={}); l[c]=true; } };
    const tree={}; its.forEach(it=>{ const c=col(it); add('T',c,it); add(it.emp_id,c,it); add(it.emp_id+'|'+it.disc,c,it); add(it.ctr_id,c,it);
      const e=tree[it.emp_id]||(tree[it.emp_id]={nome:it.emp,discs:{}}); const d=e.discs[it.disc]||(e.discs[it.disc]={ctrs:{}}); d.ctrs[it.ctr_id]=it.ctr; });
    let ri=6;
    const linha=(k, nome, nivel)=>{ const r=ws.getRow(ri++); const a=agg[k]||{}; let tot=0;
      gCols.forEach((c,ci)=>{ const cell=r.getCell(ci+1);
        if(c.key==='n'){ cell.value=(nivel?'   '.repeat(nivel):'')+nome; cell.font={bold:nivel<2,color:{argb:nivel?'FF334155':NAVY}}; }
        else if(c.key==='tot'){ cell.value=tot; cell.numFmt=money; cell.font={bold:true,color:{argb:NAVY}}; }
        else{ const v=a[c.key]||0; tot+=v; cell.value=v||null; cell.numFmt=money; if(late[k]&&late[k][c.key]) cell.font={bold:true,color:{argb:VERM}}; }
        cell.border={bottom:{style:'thin',color:{argb:LINHA}}}; if(nivel===0) cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:ZEBRA}}; }); };
    Object.keys(tree).sort((a,b)=>tree[a].nome.localeCompare(tree[b].nome)).forEach(eid=>{ const e=tree[eid]; linha(eid,e.nome,0);
      Object.keys(e.discs).sort().forEach(d=>{ linha(eid+'|'+d,d,1); Object.keys(e.discs[d].ctrs).forEach(ck=>linha(ck,e.discs[d].ctrs[ck],2)); }); });
    { const r=ws.getRow(ri++); let acu=0; const a=agg['T']||{}; let tot=0;
      gCols.forEach((c,ci)=>{ const cell=r.getCell(ci+1); if(c.key==='n') cell.value='TOTAL DO MÊS'; else if(c.key==='tot'){ cell.value=tot; cell.numFmt=money; } else { const v=a[c.key]||0; tot+=v; cell.value=v||null; cell.numFmt=money; }
        cell.font={bold:true,color:{argb:NAVY}}; cell.border={top:{style:'medium',color:{argb:NAVY}}}; });
      const r2=ws.getRow(ri++); gCols.forEach((c,ci)=>{ const cell=r2.getCell(ci+1); if(c.key==='n') cell.value='ACUMULADO'; else if(c.key!=='tot'&&c.key!=='sem'){ acu+=(a[c.key]||0); cell.value=acu; cell.numFmt=money; } cell.font={bold:true,color:{argb:CINZA}}; }); }
    // ── Parcelas ──
    const pCols=[{key:'emp',h:'Empreendimento',w:30},{key:'disc',h:'Disciplina',w:18},{key:'ctr',h:'Contrato / origem',w:34},{key:'num',h:'Parcela',w:9},{key:'desc',h:'Descrição',w:34},{key:'data',h:'Vencimento',w:12},{key:'status',h:'Status',w:13},{key:'valor',h:'Valor',w:15},{key:'venc',h:'Vencida?',w:10}];
    const wp=wb.addWorksheet('Parcelas',{ views:[{state:'frozen',ySplit:5}] }); wp.columns=pCols.map(c=>({key:c.key,width:c.w}));
    cab(wp,'Parcelas e NFs',pCols.length,its.length+' item(ns)'); header(wp,pCols,5); wp.autoFilter={ from:{row:5,column:1}, to:{row:5,column:pCols.length} };
    its.slice().sort((a,b)=>String(a.data||'9').localeCompare(String(b.data||'9'))||a.emp.localeCompare(b.emp)).forEach((it,i)=>{ const r=wp.getRow(6+i); const l=crLate(it);
      const v={ emp:it.emp, disc:it.disc, ctr:it.tipo==='nf'?'NF sem contrato':it.ctr, num:it.num||'', desc:it.desc, data:it.data?new Date(it.data+'T12:00:00'):'', status:CR_ST[it.status].r, valor:it.valor, venc:l?'SIM':'' };
      pCols.forEach((c,ci)=>{ const cell=r.getCell(ci+1); cell.value=v[c.key]; cell.border={bottom:{style:'thin',color:{argb:LINHA}}}; if(i%2) cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:ZEBRA}};
        if(c.key==='valor') cell.numFmt=money; if(c.key==='data'&&v.data) cell.numFmt='dd/mm/yyyy'; if(c.key==='venc'&&l) cell.font={bold:true,color:{argb:VERM}};
        if(c.key==='status') cell.font={bold:true,color:{argb:'FF'+CR_ST[it.status].c.slice(1)}}; }); });
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='cronograma_custos_'+new Date().toISOString().slice(0,10)+'.xlsx';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),30000);
  }catch(e){ alert('Não foi possível exportar: '+((e&&e.message)||e)); }
  btn.innerHTML=old; btn.disabled=false;
}

window.AuriaCronoCustos={
  montar(el, opts){
    CC.opts=opts||{};
    if(!document.getElementById('ccCss')){ const st=document.createElement('style'); st.id='ccCss'; st.textContent=CSS; document.head.appendChild(st); }
    el.classList.add('cc-wrap'); el.innerHTML=HTML;
    return crAbrir();
  },
  recarregar(){ return crAbrir(); }
};
})();
