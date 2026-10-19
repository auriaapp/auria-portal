/* obra_4d.js — BIM 4D do App Obra (2026-10-19)
   Liga o Cronograma da Obra (obra_crono_*) às peças do modelo federado:
   cada tarefa tem uma REGRA (disciplinas + pavimentos + classes IFC) e ajustes
   manuais (+/− peças, por GlobalId). A linha do tempo pinta as peças por estado:
   a iniciar (fantasma ou oculta), em execução (amarelo), atrasada (vermelho),
   concluída (verde, ou cor real no modo apresentação).
   Usa os globais do App Obra: sb, EMP, F3D (visualizador), B3 (bim3d.js), USER,
   segMeuNivel(). Banco: supabase_obra_4d.sql. */
(function(){
const C4={exe:0xE8C21A, atr:0xC62828, ok:0x2E9E4F};
const CSS4={exe:'#E8C21A', atr:'#C62828', ok:'#2E9E4F', fut:'#94A3B8'};
const NOME4={fut:'a iniciar', exe:'em execução', atr:'atrasada', ok:'concluída'};
// serviços padrão (usados enquanto a construtora não salvar os dela)
const SERV_PADRAO=[
  {codigo:'FUN',nome:'Fundação',disciplinas:['EST','FUN'],classes:['IFCFOOTING','IFCPILE']},
  {codigo:'EST',nome:'Estrutura',disciplinas:['EST'],classes:['IFCSLAB','IFCCOLUMN','IFCBEAM','IFCSTAIR','IFCSTAIRFLIGHT','IFCWALL','IFCWALLSTANDARDCASE','IFCRAMP','IFCMEMBER'],
   // Etapas: tarefas "Cimbramento 5º pav.", "Concretagem 5º pav.", "Protensão 5º pav." usam as MESMAS peças.
   // A peça mostra a cor da etapa em execução; entre a concretagem e a protensão fica "Escorado".
   etapas:[{codigo:'CIM',nome:'Cimbramento',cor:'#3B82F6'},{codigo:'CON',nome:'Concretagem',cor:'#E8C21A',depois:{nome:'Escorado',cor:'#8B5CF6'}},{codigo:'PRO',nome:'Protensão',cor:'#06B6D4'}]},
  {codigo:'ALV',nome:'Alvenaria',disciplinas:['ALV','ARQ'],classes:['IFCWALL','IFCWALLSTANDARDCASE']},
  {codigo:'ESQ',nome:'Esquadrias',disciplinas:['ARQ'],classes:['IFCDOOR','IFCWINDOW']},
  {codigo:'FAC',nome:'Fachada',disciplinas:['ARQ'],classes:['IFCCURTAINWALL','IFCPLATE','IFCMEMBER']},
  {codigo:'REV',nome:'Revestimentos',disciplinas:['ARQ'],classes:['IFCCOVERING']},
  {codigo:'COB',nome:'Cobertura',disciplinas:['ARQ'],classes:['IFCROOF']},
  {codigo:'HID',nome:'Instalações hidráulicas',disciplinas:['HID'],classes:['IFCPIPESEGMENT','IFCPIPEFITTING','IFCFLOWSEGMENT','IFCFLOWFITTING','IFCFLOWTERMINAL','IFCVALVE','IFCFLOWCONTROLLER']},
  {codigo:'ELE',nome:'Instalações elétricas',disciplinas:['ELE'],classes:['IFCCABLECARRIERSEGMENT','IFCCABLECARRIERFITTING','IFCCABLESEGMENT','IFCFLOWSEGMENT','IFCFLOWFITTING','IFCFLOWTERMINAL','IFCELECTRICDISTRIBUTIONBOARD']},
  {codigo:'CLI',nome:'Climatização',disciplinas:['CLI'],classes:['IFCDUCTSEGMENT','IFCDUCTFITTING','IFCFLOWSEGMENT','IFCFLOWFITTING','IFCFLOWTERMINAL','IFCAIRTERMINAL']}];
const ROT_CLASSE={IFCSLAB:'Laje',IFCCOLUMN:'Pilar',IFCBEAM:'Viga',IFCSTAIR:'Escada',IFCSTAIRFLIGHT:'Lance de escada',IFCWALL:'Parede',IFCWALLSTANDARDCASE:'Parede (padrão)',IFCRAMP:'Rampa',IFCMEMBER:'Perfil',
  IFCFOOTING:'Sapata/bloco',IFCPILE:'Estaca',IFCDOOR:'Porta',IFCWINDOW:'Janela',IFCCURTAINWALL:'Pele de vidro',IFCPLATE:'Placa',IFCCOVERING:'Revestimento',IFCROOF:'Cobertura',IFCRAILING:'Guarda-corpo',
  IFCPIPESEGMENT:'Tubo',IFCPIPEFITTING:'Conexão',IFCFLOWSEGMENT:'Trecho (tubo/duto/eletroduto)',IFCFLOWFITTING:'Conexão (fluxo)',IFCFLOWTERMINAL:'Terminal (louça/ponto)',IFCVALVE:'Registro',IFCFLOWCONTROLLER:'Controlador',
  IFCCABLECARRIERSEGMENT:'Eletrocalha/leito',IFCCABLECARRIERFITTING:'Conexão de eletrocalha',IFCCABLESEGMENT:'Cabo',IFCELECTRICDISTRIBUTIONBOARD:'Quadro',IFCDUCTSEGMENT:'Duto',IFCDUCTFITTING:'Conexão de duto',IFCAIRTERMINAL:'Difusor',
  IFCFURNISHINGELEMENT:'Mobiliário',IFCBUILDINGELEMENTPROXY:'Elemento genérico',IFCSPACE:'Ambiente',IFCOPENINGELEMENT:'Abertura'};
const rotC=c=>ROT_CLASSE[c]||c.replace(/^IFC/,'').toLowerCase();
const _n=s=>String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const Dn=s=>{ const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m?Date.UTC(+m[1],+m[2]-1,+m[3])/864e5:null; };
const BR=n=>{ if(n==null) return '—'; const d=new Date(n*864e5).toISOString(); return d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(2,4); };
const HOJE=(()=>{ const t=new Date(); return Date.UTC(t.getFullYear(),t.getMonth(),t.getDate())/864e5; })();

const O={on:false,n:HOJE,modo:'real',fut:'fant',conc:'verde',aba:'t',sel:null,conf:false,timer:null,
  T:[],meds:[],base:null,vinc:{},serv:SERV_PADRAO,servDaConstrutora:false,idx:null,porT:{},pode:false,construtora:null};
window.O4=O;

function toast(m,err){ let t=document.getElementById('o4dToast'); if(!t){ t=document.createElement('div'); t.id='o4dToast'; t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;padding:9px 16px;border-radius:8px;font-size:12.5px;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.3);display:none;max-width:90vw'; document.body.appendChild(t); }
  t.textContent=m; t.style.background=err?'#7F1D1D':'#0F172A'; t.style.display='block'; clearTimeout(t._h); t._h=setTimeout(()=>t.style.display='none',err?6000:3000); }

// ── estilos ──
const st=document.createElement('style'); st.textContent=`
#o4dPainel{position:absolute;top:8px;right:8px;bottom:118px;width:340px;z-index:30;background:var(--panel,#fff);color:var(--txt,#0F172A);border:1px solid var(--line,#E2E8F0);border-radius:12px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.25);font-size:12.5px}
#o4dPainel.on,#o4dTl.on{display:flex}
#o4dPainel .tbs{display:flex;gap:14px;padding:0 14px;border-bottom:1px solid var(--line,#E2E8F0);flex-shrink:0}
#o4dPainel .tb{padding:9px 0 7px;font-weight:600;color:var(--mut,#64748B);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
#o4dPainel .tb.on{color:var(--txt,#0F172A);border-bottom-color:#E8960A}
#o4dPainel .bd{overflow:auto;flex:1}
#o4dPainel .sec{padding:10px 14px;border-bottom:1px solid var(--line,#E2E8F0)}
#o4dPainel .lb{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--mut,#64748B);font-weight:700;margin-bottom:6px;display:flex;justify-content:space-between;gap:6px}
#o4dPainel .tk{display:grid;grid-template-columns:40px 1fr auto;gap:6px;align-items:center;padding:6px 14px;border-bottom:1px solid var(--line,#E2E8F0);cursor:pointer}
#o4dPainel .tk:hover{background:var(--panel2,#F6F9FC)}
#o4dPainel .tk.sel{box-shadow:inset 3px 0 0 #38BDF8;background:rgba(56,189,248,.1)}
#o4dPainel .tk.fase{font-weight:700;background:var(--panel2,#F6F9FC);cursor:default}
#o4dPainel .tk .e{font:700 11px ui-monospace,Consolas,monospace;color:var(--navy,#1E3A5F)}
#o4dPainel .tk .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#o4dPainel .tk .nm small{display:block;font-size:10.5px;color:var(--mut,#64748B);font-weight:400}
#o4dPainel .tk .q{font:700 10.5px ui-monospace,Consolas,monospace;color:var(--mut,#64748B);text-align:right}
#o4dPainel .tk .q.z{color:#C62828}
#o4dPainel .tk .q.auto{font-weight:400;font-style:italic}
#o4dPainel .dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;vertical-align:-1px}
#o4dPainel .chips{display:flex;flex-wrap:wrap;gap:4px}
#o4dPainel .chip{border:1px solid var(--line,#E2E8F0);background:var(--panel,#fff);color:var(--txt2,#334155);border-radius:7px;padding:3px 8px;font-size:11.5px;cursor:pointer;user-select:none}
#o4dPainel .chip.on{border-color:#E8960A;color:#B45309;font-weight:700;background:rgba(232,150,10,.08)}
#o4dPainel .chip small{opacity:.65;font-family:ui-monospace,Consolas,monospace;margin-left:3px}
#o4dPainel .chip.ro{cursor:default}
#o4dPainel .res{display:grid;grid-template-columns:1fr auto;gap:3px 10px}
#o4dPainel .res b{font-family:ui-monospace,Consolas,monospace}
#o4dPainel .bt{border:1px solid var(--line,#E2E8F0);background:var(--panel2,#F6F9FC);color:var(--txt2,#334155);border-radius:7px;padding:5px 9px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
#o4dPainel .bt:hover{border-color:#E8960A;color:#B45309}
#o4dPainel .bt.pri{background:#E8960A;border-color:#E8960A;color:#231703}
#o4dPainel .btns{display:flex;gap:5px;flex-wrap:wrap}
#o4dPainel .hint{font-size:10.5px;color:var(--mut,#64748B);margin-top:5px}
#o4dPainel .conf a{display:flex;justify-content:space-between;border:1px solid var(--line,#E2E8F0);border-radius:7px;padding:7px 10px;margin-bottom:6px;color:var(--txt2,#334155);text-decoration:none;cursor:pointer}
#o4dPainel .conf a.al b{color:#C62828}
#o4dPainel select,#o4dPainel input[type=text]{font:inherit;font-size:12px;border:1px solid var(--line,#E2E8F0);background:var(--panel2,#F6F9FC);color:var(--txt,#0F172A);border-radius:6px;padding:4px 6px;width:100%}
#o4dPainel table{width:100%;border-collapse:collapse}#o4dPainel td,#o4dPainel th{padding:4px 5px;border-bottom:1px solid var(--line,#E2E8F0);font-size:11.5px;text-align:left;vertical-align:top}
#o4dTl{position:absolute;left:8px;right:8px;bottom:8px;z-index:30;background:rgba(21,32,54,.96);border:1px solid #26324A;border-radius:12px;color:#C9D6E4;padding:8px 12px 10px;display:none;flex-direction:column;gap:6px;font-size:12px}
#o4dTl .r{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#o4dTl .dt{font:800 15px ui-monospace,Consolas,monospace;color:#fff;min-width:96px}
#o4dTl .pl{width:30px;height:30px;border-radius:50%;border:none;background:#E8960A;color:#231703;cursor:pointer;font-size:12px}
#o4dTl input[type=range]{width:100%;accent-color:#E8960A}
#o4dTl .sg{display:inline-flex;border:1px solid #26324A;border-radius:7px;overflow:hidden}
#o4dTl .sg span{padding:4px 9px;cursor:pointer;border-right:1px solid #26324A;user-select:none}
#o4dTl .sg span:last-child{border-right:none}
#o4dTl .sg span.on{background:#E8960A;color:#231703;font-weight:700}
#o4dTl .lg{display:flex;gap:10px;font-size:11px}
#o4dTl .lg i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:4px;vertical-align:-1px}
#o4dTl .mk{display:flex;justify-content:space-between;font:10px ui-monospace,Consolas,monospace;color:#8FA6C0}
#o4dTl .lb{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#8FA6C0;font-weight:700}
#f3dBtn4d.on{background:#E8960A!important;color:#231703!important}
body.o4d-on #f3dLogo{bottom:128px!important;opacity:.9}
body.o4d-on #f3dDica{bottom:132px!important}
`; document.head.appendChild(st);

function montarUi(){
  const body=document.getElementById('bimBody'); if(!body||document.getElementById('o4dPainel')) return;
  const p=document.createElement('div'); p.id='o4dPainel'; body.appendChild(p);
  const t=document.createElement('div'); t.id='o4dTl'; body.appendChild(t);
  t.innerHTML=`<div class="r"><button class="pl" id="o4dPlay" onclick="o4dPlay()">▶</button><span class="dt" id="o4dData"></span>
    <span class="lb">Comparar</span><span class="sg" id="o4dSgModo"><span data-v="prev">Previsto</span><span data-v="real">Realizado</span></span>
    <span class="lb">Futuras</span><span class="sg" id="o4dSgFut"><span data-v="fant">Fantasma</span><span data-v="ocul">Ocultas</span></span>
    <span class="lb">Concluídas</span><span class="sg" id="o4dSgConc"><span data-v="verde">Verde</span><span data-v="real">Cor real</span></span>
    <span style="flex:1"></span><button class="pl" style="background:#1B2740;color:#C9D6E4;width:auto;border-radius:7px;padding:0 10px;font-size:12px" onclick="o4dIr(${'HOJE'})">Hoje</button></div>
    <input type="range" id="o4dSl" oninput="o4dData(+this.value)"><div class="mk" id="o4dMk"></div>
    <div class="r"><span class="lg"><span><i style="background:#94A3B8;opacity:.4"></i>A iniciar</span><span><i style="background:${CSS4.exe}"></i>Em execução</span><span><i style="background:${CSS4.atr}"></i>Atrasada</span><span><i style="background:${CSS4.ok}"></i>Concluída</span><span><i style="background:#FF00FF"></i>Sem tarefa (conferência)</span></span><span class="lg" id="o4dLgEt"></span><span style="flex:1"></span><span id="o4dResumo"></span></div>`;
  const liga=(id,k)=>document.querySelectorAll('#'+id+' span').forEach(s=>s.onclick=()=>{ O[k]=s.dataset.v; marcaSg(); pintar(); });
  liga('o4dSgModo','modo'); liga('o4dSgFut','fut'); liga('o4dSgConc','conc');
}
function marcaSg(){ [['o4dSgModo','modo'],['o4dSgFut','fut'],['o4dSgConc','conc']].forEach(([id,k])=>document.querySelectorAll('#'+id+' span').forEach(s=>s.classList.toggle('on',s.dataset.v===O[k]))); }

// ── carga ──
async function carregar(){
  const E=EMP.id;
  const [rT,rM,rB,rV,rE]=await Promise.all([
    sb.from('obra_crono_tarefa_auria').select('*').eq('empreendimento_id',E).order('ordem'),
    sb.from('obra_crono_medicao_auria').select('tarefa_uid,data,percentual').eq('empreendimento_id',E),
    sb.from('obra_crono_base_auria').select('nome,tarefas').eq('empreendimento_id',E).eq('ativa',true).maybeSingle(),
    sb.from('obra_4d_vinculo_auria').select('*').eq('empreendimento_id',E),
    sb.from('empreendimentos_auria').select('construtora_id').eq('id',E).maybeSingle()]);
  O.T=(rT.data||[]).map(r=>({uid:r.uid,wbs:r.wbs,nome:r.nome,nivel:r.nivel,fase:r.tipo==='fase',marco:r.tipo==='marco',pav:r.pavimento||'',ini:Dn(r.inicio),fim:Dn(r.fim),prog:+r.progresso||0}));
  O.meds=rM.data||[]; O.base=rB.data?{nome:rB.data.nome,map:Object.fromEntries((rB.data.tarefas||[]).map(x=>[x.uid,x]))}:null;
  O.vinc={}; O.semTabela=!!rV.error; (rV.data||[]).forEach(v=>O.vinc[v.tarefa_uid]=v);
  O.construtora=rE.data&&rE.data.construtora_id;
  O.serv=SERV_PADRAO; O.servDaConstrutora=false;
  if(O.construtora&&!O.semTabela){ const rs=await sb.from('obra_4d_servico_auria').select('*').eq('construtora_id',O.construtora).order('ordem'); if(rs.data&&rs.data.length){ O.serv=rs.data; O.servDaConstrutora=true; } }
  O.pode=['eng_chefe','coord_campo'].includes(typeof segMeuNivel==='function'?segMeuNivel():'');
}
// regra efetiva da tarefa: a salva, ou uma sugerida pelo serviço + pavimento
function servicoDe(t){ const n=_n(t.nome);
  for(const s of O.serv) for(const e of (s.etapas||[])) if(n.startsWith(_n(e.nome))) return {...s,_etapa:e.codigo};
  return O.serv.find(s=>n.startsWith(_n(s.nome))||n.startsWith(_n(s.codigo)+' ')||n.includes(_n(s.nome))); }
function etapaDe(cod,etp){ const s=O.serv.find(x=>x.codigo===cod); return s&&etp?(s.etapas||[]).find(e=>e.codigo===etp)||null:null; }
function pavsDe(t){ if(!O.idx) return []; const todos=[...new Set(O.idx.flatMap(m=>Object.keys(m.pavs)))];
  const alvo=_n(t.pav||''); const ex=todos.filter(p=>alvo&&_n(p).replace(/[^a-z0-9]/g,'')===alvo.replace(/[^a-z0-9]/g,'')); if(ex.length) return ex;
  const fonte=alvo||_n(t.nome);
  const num=(fonte.match(/(\d+)\s*(º|o|°)?\s*(pav|andar)/)||fonte.match(/(?:pav\w*|andar|t)\s*0?(\d+)/)||[])[1];
  const pal=/terreo/.test(fonte)?'terreo':/cobert/.test(fonte)?'cobert':/subsolo|ss\d/.test(fonte)?'subsolo':'';
  return todos.filter(p=>{ const pn=_n(p), pd=(pn.match(/\d+/)||[])[0];
    if(pal==='terreo') return /terreo/.test(pn); if(pal==='cobert') return /cobert/.test(pn);
    if(pal==='subsolo'){ const ns=(fonte.match(/(?:subsolo|ss)\s*0?(\d+)/)||[])[1]; return /subsolo|ss/.test(pn)&&(!ns||pd===ns); }
    return num&&pd&&parseInt(pd,10)===parseInt(num,10)&&!/subsolo|ss/.test(pn); }); }
function regraDe(t){ const v=O.vinc[t.uid]; if(v) return {salva:true,servico:v.servico,etapa:v.etapa||'',disciplinas:v.disciplinas||[],pavimentos:v.pavimentos||[],classes:v.classes||[],adicionados:v.adicionados||[],removidos:v.removidos||[]};
  const s=servicoDe(t); if(!s) return null; return {salva:false,servico:s.codigo,etapa:s._etapa||'',disciplinas:s.disciplinas||[],pavimentos:pavsDe(t),classes:s.classes||[],adicionados:[],removidos:[]}; }
async function resolverTudo(){
  O.porT={};
  for(const t of O.T){ if(t.fase) continue; const r=regraDe(t); if(!r){ O.porT[t.uid]={}; continue; }
    const pm=B3.resolverRegra4D(O.idx,r);
    const doMi=doc=>O.idx.find(m=>m.doc===doc);
    for(const a of (r.adicionados||[])){ const m=doMi(a.doc); if(!m) continue; const ids=await B3.idsDeGuids4D(F3D,m.mi,[a.guid]); if(ids.length){ pm[m.mi]=[...new Set((pm[m.mi]||[]).concat(ids))]; } }
    for(const a of (r.removidos||[])){ const m=doMi(a.doc); if(!m||!pm[m.mi]) continue; const ids=new Set(await B3.idsDeGuids4D(F3D,m.mi,[a.guid])); pm[m.mi]=pm[m.mi].filter(i=>!ids.has(i)); }
    O.porT[t.uid]=pm; }
}
const nPecas=pm=>Object.values(pm||{}).reduce((a,l)=>a+l.length,0);

// ── estado no dia ──
function baseDe(t){ const b=O.base&&O.base.map[t.uid]; return b?{ini:Dn(b.inicio),fim:Dn(b.fim)}:null; }
function prevEm(t,n){ const b=baseDe(t), a=b?b.ini:t.ini, z=b?b.fim:t.fim; if(a==null||z==null) return 0; if(n<a) return 0; if(n>=z) return 100; return (n-a+1)/(z-a+1)*100; }
function realEm(uid,n){ let v=0,d0=null; O.meds.forEach(m=>{ if(m.tarefa_uid!==uid) return; const d=Dn(m.data); if(d>n) return; if(d0==null||d>=d0){ d0=d; v=+m.percentual; } }); return v; }
function estado(t,n){
  if(O.modo==='prev'){ const b=baseDe(t), a=b?b.ini:t.ini, z=b?b.fim:t.fim; if(a==null||n<a) return 'fut'; if(n>z) return 'ok'; return 'exe'; }
  const p=(n>=HOJE)?Math.max(realEm(t.uid,n),n>=HOJE?t.prog:0):realEm(t.uid,n), pv=prevEm(t,n);
  if(p>=100) return 'ok';
  if(p<=0&&pv<=0) return 'fut';
  if((t.fim!=null&&n>t.fim)||pv-p>10) return 'atr';
  return p>0||pv>0?'exe':'fut';
}

// ── pintura ──
let _pintando=false, _pend=false;
async function pintar(){
  if(!O.on||!F3D) return; if(_pintando){ _pend=true; return; } _pintando=true;
  try{
    const cnt={fut:0,exe:0,atr:0,ok:0}; const P=new Map();   // "mi:id" → [{s, t, etapa}]
    O.T.forEach(t=>{ if(t.fase) return; const pm=O.porT[t.uid]; if(!pm||!nPecas(pm)) return; const s=estado(t,O.n); cnt[s]++;
      const r=regraDe(t)||{}, et=etapaDe(r.servico,r.etapa);
      Object.entries(pm).forEach(([mi,ids])=>ids.forEach(id=>{ const k=mi+':'+id; let l=P.get(k); if(!l) P.set(k,l=[]); l.push({s,t,et}); })); });
    const porCor=new Map(); const add=(cor,k)=>{ let m=porCor.get(cor); if(!m) porCor.set(cor,m={}); const [mi,id]=k.split(':'); (m[mi]=m[mi]||[]).push(+id); };
    const fut={};
    P.forEach((l,k)=>{
      if(l.some(x=>x.s==='atr')) return add(C4.atr,k);
      const ex=l.find(x=>x.s==='exe'); if(ex) return add(ex.et?parseInt(ex.et.cor.slice(1),16):C4.exe,k);
      if(l.every(x=>x.s==='ok')){ if(O.conc==='verde') add(C4.ok,k); return; }
      if(l.every(x=>x.s==='fut')){ const [mi,id]=k.split(':'); (fut[mi]=fut[mi]||[]).push(+id); return; }
      // parte concluída, parte por vir: entre etapas (ex.: concretada, aguardando protensão = escorado)
      const ult=l.filter(x=>x.s==='ok').sort((a,b)=>(b.t.fim||0)-(a.t.fim||0))[0];
      add(ult&&ult.et?parseInt((ult.et.depois?ult.et.depois.cor:ult.et.cor).slice(1),16):C4.exe,k); });   // sem 'depois': mantém a cor da etapa (ex.: cimbrado aguardando concretagem)
    const grupos=[...porCor].map(([cor,porMod])=>({porMod,cor})); const g={fut};
    if(O.conf){ grupos.push({porMod:semTarefa(),cor:0xFF00FF}); }
    await B3.pintar4D(F3D,grupos,O.conf?null:{porMod:g.fut,oculto:O.fut==='ocul'});
    legendaEtapas();
    if(O.sel&&O.porT[O.sel]&&nPecas(O.porT[O.sel])){ try{ for(const [mi,ids] of Object.entries(O.porT[O.sel])){ await F3D.modelos[mi].model.highlight(ids,{color:new F3D.THREE.Color(0x38BDF8),renderedFaces:1,opacity:1,transparent:false}); } await F3D.fragments.update(true); }catch(_){} }
    const r=document.getElementById('o4dResumo'); if(r) r.innerHTML=(O.modo==='prev'?'Previsto'+(O.base?' ('+esc(O.base.nome)+')':' (datas atuais)'):'Realizado (medições)')+' · <b style="color:'+CSS4.exe+'">'+cnt.exe+'</b> em execução · <b style="color:#F87171">'+cnt.atr+'</b> atrasadas · <b style="color:#4ADE80">'+cnt.ok+'</b> concluídas · '+cnt.fut+' a iniciar';
  } finally { _pintando=false; if(_pend){ _pend=false; pintar(); } }
}
function semTarefa(){ const usados={}; Object.values(O.porT).forEach(pm=>Object.entries(pm).forEach(([mi,ids])=>{ const s=usados[mi]=usados[mi]||new Set(); ids.forEach(i=>s.add(i)); }));
  const out={}; const VIS=/^IFC(WALL|SLAB|COLUMN|BEAM|DOOR|WINDOW|STAIR|ROOF|CURTAINWALL|PLATE|MEMBER|COVERING|RAILING|FOOTING|PILE|RAMP|PIPE|FLOW|DUCT|CABLE|VALVE|AIRTERMINAL|ELECTRICDISTRIBUTIONBOARD)/;
  (O.idx||[]).forEach(m=>{ const u=usados[m.mi]||new Set(); const ids=[]; Object.entries(m.porCat).forEach(([c,l])=>{ if(VIS.test(c)) l.forEach(i=>{ if(!u.has(i)) ids.push(i); }); }); if(ids.length) out[m.mi]=ids; });
  return out; }

function legendaEtapas(){ const el=document.getElementById('o4dLgEt'); if(!el) return; const usados=new Set(O.T.map(t=>{ const r=regraDe(t); return r&&r.etapa?r.servico+':'+r.etapa:null; }).filter(Boolean));
  const it=[]; O.serv.forEach(s=>(s.etapas||[]).forEach(e=>{ if(!usados.has(s.codigo+':'+e.codigo)) return; it.push('<span><i style="background:'+e.cor+'"></i>'+esc(e.nome)+'</span>'); if(e.depois) it.push('<span><i style="background:'+e.depois.cor+'"></i>'+esc(e.depois.nome)+'</span>'); }));
  el.innerHTML=it.length?'<span style="color:#8FA6C0">Etapas:</span>'+it.join(''):''; }
// ── linha do tempo ──
function faixa(){ const ds=O.T.flatMap(t=>[t.ini,t.fim]).filter(n=>n!=null); if(!ds.length) return [HOJE-30,HOJE+30]; return [Math.min(...ds,HOJE)-3, Math.max(...ds,HOJE)+3]; }
window.o4dData=n=>{ O.n=n; document.getElementById('o4dData').textContent=BR(n); pintar(); if(O.aba==='t') lista(); if(O.aba==='v') vinculo(); };
window.o4dIr=n=>{ const sl=document.getElementById('o4dSl'); sl.value=n; o4dData(n); };
window.o4dPlay=()=>{ const b=document.getElementById('o4dPlay'), sl=document.getElementById('o4dSl');
  if(O.timer){ clearInterval(O.timer); O.timer=null; b.textContent='▶'; return; }
  if(+sl.value>=+sl.max) sl.value=sl.min; b.textContent='❚❚';
  O.timer=setInterval(()=>{ if(_pintando) return; sl.value=+sl.value+7; o4dData(+sl.value); if(+sl.value>=+sl.max){ clearInterval(O.timer); O.timer=null; b.textContent='▶'; } },350); };

// ── painel ──
function painel(){ const p=document.getElementById('o4dPainel');
  p.innerHTML='<div class="tbs">'+[['t','Tarefas'],['v','Vínculo'],['c','Conferência'],['s','Serviços']].map(([k,r])=>'<div class="tb'+(O.aba===k?' on':'')+'" onclick="o4dAba(\''+k+'\')">'+r+'</div>').join('')+'<span style="flex:1"></span><div class="tb" title="Fechar o 4D" onclick="o4dToggle()">✕</div></div><div class="bd" id="o4dBd"></div>';
  ({t:lista,v:vinculo,c:conferencia,s:servicos})[O.aba](); }
window.o4dAba=k=>{ O.aba=k; O.conf=(k==='c'); painel(); pintar(); };
function lista(){ const bd=document.getElementById('o4dBd'); if(!bd) return;
  if(!O.T.length){ bd.innerHTML='<div class="sec"><div class="hint">O Cronograma da Obra ainda não tem tarefas. Monte o cronograma primeiro (botão Cronograma da Obra).</div></div>'; return; }
  bd.innerHTML=(O.semTabela?'<div class="sec" style="color:#B45309">O banco do 4D ainda não foi criado (supabase_obra_4d.sql). A simulação funciona com regras automáticas, mas não dá para salvar vínculos.</div>':'')+
    O.T.map(t=>{ if(t.fase) return '<div class="tk fase" style="padding-left:'+(14+t.nivel*10)+'px"><span class="e">'+esc(t.wbs)+'</span><span class="nm">'+esc(t.nome)+'</span><span></span></div>';
      const s=estado(t,O.n), np=nPecas(O.porT[t.uid]), r=regraDe(t);
      return '<div class="tk'+(O.sel===t.uid?' sel':'')+'" onclick="o4dSel(\''+t.uid+'\')"><span class="e">'+esc(t.wbs)+'</span><span class="nm"><span class="dot" style="background:'+(CSS4[s])+';'+(s==='fut'?'opacity:.45':'')+'"></span>'+esc(t.nome)+'<small>'+BR(t.ini)+' → '+BR(t.fim)+' · '+NOME4[s]+'</small></span><span class="q'+(np?'':' z')+(r&&!r.salva?' auto':'')+'" title="'+(r?(r.salva?'vínculo salvo':'vínculo automático pelo serviço '+esc(r.servico)+' — confira e salve'):'sem regra')+'">'+(np?np:'sem peças')+'</span></div>'; }).join(''); }
window.o4dSel=uid=>{ O.sel=O.sel===uid?null:uid; if(O.sel&&O.aba==='t'){ O.aba='v'; painel(); } else painel(); pintar(); };

let EDT=null;   // regra em edição
function vinculo(){ const bd=document.getElementById('o4dBd'); if(!bd) return; const t=O.T.find(x=>x.uid===O.sel);
  if(!t){ bd.innerHTML='<div class="sec"><div class="hint">Escolha uma tarefa na aba Tarefas.</div></div>'; return; }
  const r=regraDe(t)||{salva:false,servico:'',disciplinas:[],pavimentos:[],classes:[],adicionados:[],removidos:[]};
  if(!EDT||EDT.uid!==t.uid) EDT={uid:t.uid,...JSON.parse(JSON.stringify(r))};
  const ro=!O.pode, disc=[...new Set(O.idx.map(m=>m.disciplina).filter(Boolean))].sort();
  const pavs=[...new Set(O.idx.flatMap(m=>Object.keys(m.pavs)))];
  const dsSel=new Set(EDT.disciplinas), cls={}; O.idx.forEach(m=>{ if(dsSel.size&&!dsSel.has(m.disciplina)) return; Object.entries(m.porCat).forEach(([c,l])=>cls[c]=(cls[c]||0)+l.length); });
  EDT.classes.forEach(c=>{ if(cls[c]==null) cls[c]=0; });
  const pm=B3.resolverRegra4D(O.idx,EDT), n=nPecas(pm), s=estado(t,O.n), revs=O.idx.filter(m=>!dsSel.size||dsSel.has(m.disciplina)).map(m=>m.disciplina+' '+(m.revisao||'')).join(' · ');
  const chip=(on,txt,fn,sub)=>'<span class="chip'+(on?' on':'')+(ro?' ro':'')+'"'+(ro?'':' onclick="'+fn+'"')+'>'+esc(txt)+(sub!=null?'<small>'+sub+'</small>':'')+'</span>';
  bd.innerHTML=
   '<div class="sec"><div class="lb"><span>Tarefa '+esc(t.wbs)+'</span><span>'+(r.salva?'vínculo salvo':'automático — confira')+'</span></div><b style="font-size:13.5px">'+esc(t.nome)+'</b><div class="hint" style="margin-top:3px">'+BR(t.ini)+' → '+BR(t.fim)+' · <b style="color:'+CSS4[s]+'">'+NOME4[s]+'</b> em '+BR(O.n)+'</div>'+
     (ro?'':'<div style="margin-top:8px"><select onchange="o4dServ(this.value)"><option value="">Aplicar serviço padrão…</option>'+O.serv.map(x=>'<option value="'+esc(x.codigo)+'"'+(x.codigo===EDT.servico?' selected':'')+'>'+esc(x.codigo+' — '+x.nome)+'</option>').join('')+'</select></div>')+
     (()=>{ const sv=O.serv.find(x=>x.codigo===EDT.servico); if(!sv||!(sv.etapas||[]).length) return ''; return '<div style="margin-top:8px"><div class="lb"><span>Etapa</span><span>cor no 4D</span></div><div class="chips">'+
        [{codigo:'',nome:'Sem etapa',cor:CSS4.exe}].concat(sv.etapas).map(e=>'<span class="chip'+((EDT.etapa||'')===e.codigo?' on':'')+(ro?' ro':'')+'"'+(ro?'':' onclick="o4dEtapa(\''+e.codigo+'\')"')+'><span class="dot" style="background:'+e.cor+'"></span>'+esc(e.nome)+'</span>').join('')+'</div></div>'; })()+'</div>'+
   '<div class="sec"><div class="lb"><span>1 · Modelo / disciplina</span><span>vazio = todos</span></div><div class="chips">'+disc.map(d=>chip(dsSel.has(d),d,"o4dTg('disciplinas','"+d+"')")).join('')+'</div></div>'+
   '<div class="sec"><div class="lb"><span>2 · Pavimentos</span><span>vazio = todos</span></div><div class="chips">'+pavs.map(p=>chip(EDT.pavimentos.includes(p),p,"o4dTg('pavimentos','"+esc(p).replace(/'/g,"\\'")+"')")).join('')+'</div></div>'+
   '<div class="sec"><div class="lb"><span>3 · Tipos de peça</span><span>classe IFC</span></div><div class="chips">'+Object.keys(cls).sort((a,b)=>(EDT.classes.includes(b)-EDT.classes.includes(a))||cls[b]-cls[a]).map(c=>chip(EDT.classes.includes(c),rotC(c),"o4dTg('classes','"+c+"')",cls[c])).join('')+'</div></div>'+
   '<div class="sec"><div class="lb"><span>Resultado</span><span>'+esc(revs)+'</span></div><div class="res"><span>Pela regra</span><b>'+n+'</b><span>+ adicionadas à mão</span><b>'+EDT.adicionados.length+'</b><span>− removidas à mão</span><b>'+EDT.removidos.length+'</b></div>'+
     '<div class="btns" style="margin-top:8px"><button class="bt" onclick="o4dVer()">Ver no 3D</button>'+(ro?'':'<button class="bt" onclick="o4dManual(1)" title="Adiciona a peça selecionada no 3D">+ Seleção</button><button class="bt" onclick="o4dManual(-1)" title="Remove a peça selecionada no 3D">− Seleção</button>')+'</div>'+
     (ro?'<div class="hint">Só o engenheiro chefe e o coordenador de campo alteram vínculos.</div>':'<div class="hint">Para exceções: clique numa peça no 3D e use + ou −.</div><div class="btns" style="margin-top:8px"><button class="bt pri" onclick="o4dSalvar()">Salvar vínculo</button>'+(r.salva?'<button class="bt" onclick="o4dVoltarAuto()">Voltar ao automático</button>':'')+'</div>')+'</div>'; }
window.o4dEtapa=c=>{ if(!O.pode) return; EDT.etapa=c; vinculo(); };
window.o4dTg=(campo,v)=>{ if(!O.pode) return; const l=EDT[campo]; const i=l.indexOf(v); if(i>=0) l.splice(i,1); else l.push(v); vinculo(); };
window.o4dServ=cod=>{ const s=O.serv.find(x=>x.codigo===cod); if(!s) return; const t=O.T.find(x=>x.uid===O.sel); EDT.servico=s.codigo; EDT.etapa=''; EDT.disciplinas=[...s.disciplinas]; EDT.classes=[...s.classes]; if(!EDT.pavimentos.length) EDT.pavimentos=pavsDe(t); vinculo(); };
window.o4dVer=async()=>{ const pm=B3.resolverRegra4D(O.idx,EDT); if(!nPecas(pm)){ toast('A regra não pegou nenhuma peça.',true); return; } try{ await B3.enquadrarIds(F3D,pm); }catch(_){} };
window.o4dManual=async sinal=>{ const sel=F3D&&F3D._ultimaSelecao; const par=sel?Object.entries(sel).find(([,ids])=>ids&&ids.length):null;
  if(!par){ toast('Clique numa peça no 3D antes.',true); return; } const mi=+par[0], ids=par[1].slice(0,200), m=O.idx.find(x=>x.mi===mi); if(!m||!m.doc){ toast('Modelo sem documento do CDE.',true); return; }
  const gs=(await B3.guids4D(F3D,mi,ids)).filter(Boolean); if(!gs.length){ toast('Não foi possível identificar a peça (GlobalId).',true); return; }
  const add=sinal>0?EDT.adicionados:EDT.removidos, outro=sinal>0?EDT.removidos:EDT.adicionados;
  gs.forEach(g=>{ const k=x=>x.doc===m.doc&&x.guid===g; const j=outro.findIndex(k); if(j>=0) outro.splice(j,1); else if(!add.some(k)) add.push({doc:m.doc,guid:g}); });
  toast(gs.length+' peça(s) '+(sinal>0?'adicionada(s)':'removida(s)')+'. Salve o vínculo.'); vinculo(); };
window.o4dSalvar=async()=>{ if(!O.pode) return; if(O.semTabela){ toast('Rode o supabase_obra_4d.sql antes.',true); return; }
  const cont={}; O.idx.forEach(m=>{ const l=B3.resolverRegra4D([m],EDT)[m.mi]; if(l) cont[(m.doc||m.nome)+':'+(m.revisao||'')]=l.length; });
  const row={empreendimento_id:EMP.id,tarefa_uid:EDT.uid,servico:EDT.servico||null,etapa:EDT.etapa||null,disciplinas:EDT.disciplinas,pavimentos:EDT.pavimentos,classes:EDT.classes,adicionados:EDT.adicionados,removidos:EDT.removidos,contagem:cont,atualizado_em:new Date().toISOString(),atualizado_nome:(USER&&USER.nome)||null};
  const r=await sb.from('obra_4d_vinculo_auria').upsert(row,{onConflict:'empreendimento_id,tarefa_uid'}); if(r.error){ toast('Não salvo: '+r.error.message,true); return; }
  O.vinc[EDT.uid]=row; EDT=null; await resolverTudo(); painel(); pintar(); toast('Vínculo salvo.'); };
window.o4dVoltarAuto=async()=>{ const r=await sb.from('obra_4d_vinculo_auria').delete().eq('empreendimento_id',EMP.id).eq('tarefa_uid',O.sel); if(r.error){ toast(r.error.message,true); return; } delete O.vinc[O.sel]; EDT=null; await resolverTudo(); painel(); pintar(); };

function conferencia(){ const bd=document.getElementById('o4dBd'); if(!bd) return;
  const sem=semTarefa(), nSem=nPecas(sem), tSem=O.T.filter(t=>!t.fase&&!nPecas(O.porT[t.uid]));
  const cont={}; O.T.forEach(t=>{ const pm=O.porT[t.uid]; if(!pm) return; const r=regraDe(t); if(r&&r.etapa) return; Object.entries(pm).forEach(([mi,ids])=>ids.forEach(i=>{ const k=mi+':'+i; cont[k]=(cont[k]||0)+1; })); }); const dup=Object.values(cont).filter(v=>v>1).length;
  const porDisc=(O.idx||[]).map(m=>{ let tot=0; const VIS=/^IFC(WALL|SLAB|COLUMN|BEAM|DOOR|WINDOW|STAIR|ROOF|CURTAINWALL|PLATE|MEMBER|COVERING|RAILING|FOOTING|PILE|RAMP|PIPE|FLOW|DUCT|CABLE|VALVE|AIRTERMINAL|ELECTRICDISTRIBUTIONBOARD)/; Object.entries(m.porCat).forEach(([c,l])=>{ if(VIS.test(c)) tot+=l.length; }); const s=(sem[m.mi]||[]).length; return [m.disciplina||m.nome, tot, tot?Math.round((tot-s)/tot*100):100, Object.keys(m.pavs).length]; });
  const mud=O.T.map(t=>{ const v=O.vinc[t.uid]; if(!v||!v.contagem) return null; const ag={}; O.idx.forEach(m=>{ const l=B3.resolverRegra4D([m],v)[m.mi]; if(l) ag[(m.doc||m.nome)+':'+(m.revisao||'')]=l.length; });
    const antes=Object.values(v.contagem).reduce((a,b)=>a+b,0), agora=Object.values(ag).reduce((a,b)=>a+b,0); const chaves=Object.keys(ag).join()!==Object.keys(v.contagem).join(); return (chaves&&antes!==agora)?[t,antes,agora]:null; }).filter(Boolean);
  bd.innerHTML=(mud.length?'<div class="sec" style="background:rgba(232,150,10,.1)"><b>Revisão nova de modelo</b><div class="hint" style="margin-top:2px">A regra foi reaplicada em '+mud.length+' tarefa(s) com vínculo salvo e o número de peças mudou: '+mud.slice(0,4).map(([t,a,b])=>esc(t.wbs)+' ('+a+'→'+b+')').join(', ')+(mud.length>4?'…':'')+'. Confira e salve de novo.</div></div>':'')+
   '<div class="sec"><div class="lb"><span>Cobertura do modelo</span><span>peças em magenta no 3D</span></div><div class="conf">'+
   '<a class="'+(nSem?'al':'')+'" onclick="o4dVerSem()"><span>Peças sem tarefa (aparecem "do nada")</span><b>'+nSem+'</b></a>'+
   '<a class="'+(tSem.length?'al':'')+'" onclick="o4dAba(\'t\')"><span>Tarefas sem peças</span><b>'+tSem.length+'</b></a>'+
   '<a title="Etapas do mesmo serviço (cimbramento, concretagem, protensão) podem dividir peças e não contam aqui."><span>Peças em mais de uma tarefa</span><b>'+dup+'</b></a></div></div>'+
   '<div class="sec"><div class="lb"><span>Por modelo</span><span>ligadas · pavimentos</span></div><table><tr><th>Disciplina</th><th>Peças</th><th>Ligadas</th><th>Pav.</th></tr>'+porDisc.map(r=>'<tr><td><b>'+esc(r[0])+'</b></td><td>'+r[1]+'</td><td style="color:'+(r[2]<60?'#C62828':'inherit')+'">'+r[2]+'%</td><td style="color:'+(r[3]?'inherit':'#C62828')+'">'+(r[3]||'sem')+'</td></tr>').join('')+'</table><div class="hint">Modelo sem pavimentos no IFC: as tarefas dele só ligam por seleção manual.</div></div>'; }
window.o4dVerSem=async()=>{ const s=semTarefa(); if(nPecas(s)) try{ await B3.enquadrarIds(F3D,s); }catch(_){} };

function servicos(){ const bd=document.getElementById('o4dBd'); if(!bd) return; const ro=!O.pode;
  bd.innerHTML='<div class="sec"><div class="hint" style="margin-top:0">Cada serviço diz de quais modelos e quais tipos de peça vêm. Uma tarefa cujo nome começa com o nome do serviço já nasce ligada, pelo pavimento.'+(O.servDaConstrutora?'':' <b>Usando a lista padrão do Auria</b>'+(ro?'':' — salve para virar a da construtora.'))+'</div></div>'+
   '<div class="sec"><table><tr><th>Cód.</th><th>Serviço</th><th>Modelos</th><th>Peças</th></tr>'+O.serv.map((s,si)=>'<tr><td><b>'+esc(s.codigo)+'</b></td><td>'+esc(s.nome)+
     ((s.etapas||[]).length?'<div style="margin-top:4px;display:flex;flex-direction:column;gap:3px">'+s.etapas.map((e,ei)=>'<label style="display:flex;gap:5px;align-items:center;font-size:11px"><input type="color" value="'+e.cor+'" '+(ro?'disabled':'onchange="o4dCorEt('+si+','+ei+',\'cor\',this.value)"')+' style="width:20px;height:16px;border:none;padding:0;background:none">'+esc(e.nome)+'</label>'+(e.depois?'<label style="display:flex;gap:5px;align-items:center;font-size:11px;padding-left:12px"><input type="color" value="'+e.depois.cor+'" '+(ro?'disabled':'onchange="o4dCorEt('+si+','+ei+',\'depois\',this.value)"')+' style="width:20px;height:16px;border:none;padding:0;background:none">depois: '+esc(e.depois.nome)+'</label>':'')).join('')+'</div>':'')+
     '</td><td>'+esc((s.disciplinas||[]).join(', '))+'</td><td>'+esc((s.classes||[]).map(rotC).join(', '))+'</td></tr>').join('')+'</table>'+
   (ro?'':'<div class="btns" style="margin-top:8px"><button class="bt" onclick="o4dNovaEtapa()">+ Etapa em um serviço</button></div>')+
   (ro?'':'<div class="btns" style="margin-top:8px"><button class="bt pri" onclick="o4dSalvarServ()">'+(O.servDaConstrutora?'Salvar a lista':'Adotar como padrão da construtora')+'</button></div><div class="hint">As cores das etapas valem para todas as obras da construtora depois de salvar.</div>')+'</div>'; }
window.o4dCorEt=(si,ei,campo,v)=>{ const e=O.serv[si].etapas[ei]; if(campo==='cor') e.cor=v; else e.depois.cor=v; pintar(); };
window.o4dNovaEtapa=()=>{ const cod=prompt('Código do serviço (ex.: EST, ALV):','EST'); if(!cod) return; const s=O.serv.find(x=>x.codigo===cod.trim().toUpperCase()); if(!s){ toast('Serviço não encontrado.',true); return; }
  const nome=prompt('Nome da etapa (a tarefa do cronograma que começar com esse nome usa esta cor):'); if(!nome) return;
  s.etapas=s.etapas||[]; s.etapas.push({codigo:_n(nome).replace(/[^a-z0-9]/g,'').slice(0,4).toUpperCase()||'ETP',nome:nome.trim(),cor:'#F472B6'}); servicos(); toast('Etapa criada. Salve a lista para valer na construtora.'); };
window.o4dSalvarServ=async()=>{ if(!O.construtora){ toast('Empreendimento sem construtora cadastrada.',true); return; } if(O.semTabela){ toast('Rode o supabase_obra_4d.sql antes.',true); return; }
  const rows=O.serv.map((s,i)=>({construtora_id:O.construtora,codigo:s.codigo,nome:s.nome,disciplinas:s.disciplinas,classes:s.classes,etapas:s.etapas||[],ordem:i}));
  const r=await sb.from('obra_4d_servico_auria').upsert(rows,{onConflict:'construtora_id,codigo'}); if(r.error){ toast('Não salvo: '+r.error.message,true); return; } O.servDaConstrutora=true; servicos(); toast('Serviços salvos para a construtora.'); };

// ── liga / desliga ──
window.o4dToggle=async()=>{
  const btn=document.getElementById('f3dBtn4d');
  if(O.on){ O.on=false; if(O.timer){ clearInterval(O.timer); O.timer=null; } document.getElementById('o4dPainel').classList.remove('on'); document.getElementById('o4dTl').classList.remove('on'); document.body.classList.remove('o4d-on'); if(btn) btn.classList.remove('on'); try{ await B3.limpar4D(F3D); }catch(_){} return; }
  // O 4D roda no visualizador completo (o mesmo de "abrir modelos marcados"). Se há modelos
  // marcados na coluna e ele ainda não abriu, abre agora; senão orienta.
  if((!F3D||!F3D.modelos||!F3D.modelos.length) && typeof F3D_SEL!=='undefined' && F3D_SEL.size && typeof f3dAbrirSelecionados==='function'){
    toast('Abrindo os modelos marcados…'); try{ await f3dAbrirSelecionados(); }catch(e){ console.warn('4D abrir:',e); } }
  if(!F3D||!F3D.modelos||!F3D.modelos.length){ toast('Marque os modelos (Estrutura, Arquitetura…) na coluna Modelos BIM à esquerda e abra o 3D; depois ligue o 4D.',true); return; }
  if(!EMP){ toast('Escolha o empreendimento.',true); return; }
  montarUi(); O.on=true; document.body.classList.add('o4d-on'); if(btn) btn.classList.add('on');
  const p=document.getElementById('o4dPainel'); p.classList.add('on'); p.innerHTML='<div class="sec"><div class="hint">Lendo cronograma e modelos…</div></div>';
  try{ await carregar(); B3.limpaIndice4D(F3D); O.idx=await B3.indice4D(F3D);
    const NAO_PECA=/^IFC(PROPERTY|COMPLEXPROPERTY|SIUNIT|DERIVEDUNIT|CONVERSIONBASEDUNIT|MONETARYUNIT|UNITASSIGNMENT|MATERIAL|REL|OWNERHISTORY|ELEMENTQUANTITY|QUANTITY|CLASSIFICATION|PRESENTATION|STYLEDITEM|SURFACESTYLE|APPLICATION|PERSON|ORGANIZATION|GROUP|ZONE|SYSTEM|ANNOTATION|GRID|OPENINGELEMENT|VIRTUALELEMENT|SPACE|DOCUMENT|APPROVAL|CONSTRAINT|TASK|RESOURCE|ACTOR)/;
    O.idx.forEach(m=>Object.keys(m.porCat).forEach(c=>{ if(NAO_PECA.test(c)) delete m.porCat[c]; }));
    await resolverTudo(); }catch(e){ console.warn('4D:',e); p.innerHTML='<div class="sec" style="color:#C62828">Não foi possível montar o 4D: '+esc(e.message||e)+'</div>'; return; }
  const [a,z]=faixa(), sl=document.getElementById('o4dSl'); sl.min=a; sl.max=z; sl.value=Math.min(Math.max(HOJE,a),z);
  document.getElementById('o4dMk').innerHTML=[0,.25,.5,.75,1].map(f=>'<span>'+BR(Math.round(a+(z-a)*f))+'</span>').join('');
  document.getElementById('o4dTl').classList.add('on'); marcaSg(); O.aba='t'; painel(); o4dData(+sl.value);
};
// botão na barra do 3D
function botao(){ const ref=document.getElementById('f3dBtnLocal'); if(!ref||document.getElementById('f3dBtn4d')) return;
  const b=document.createElement('button'); b.id='f3dBtn4d'; b.className='bim-tb ico f3donly'; b.title='BIM 4D: cronograma × modelo'; b.textContent='4D'; b.style.fontWeight='800'; b.onclick=()=>o4dToggle(); ref.parentElement.insertBefore(b, ref); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',botao); else botao();
})();
