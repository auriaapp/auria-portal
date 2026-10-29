// ============================================================================
//  auria_nc.js — Não conformidade + plano de ação (Qualidade F2, 2026-10-28)
//  ----------------------------------------------------------------------------
//  Módulo comum do Painel da Qualidade (tela própria) e do App Obra (janela).
//  Fluxo e regras moram no banco (supabase_qualidade_f2_nc.sql); aqui só tela.
//    AuriaNC.init({ sb, r2Url(action,path,ct), me:{id,nome}, grupo, emps:[{id,nome}],
//                   qualidade:bool, nivelDe(empId)→'eng_chefe'|'coord_campo'|…|null })
//    AuriaNC.tela(el, {emp})   → lista + detalhe dentro de el
//    AuriaNC.janela({emp})     → mesma tela numa janela (App Obra)
//    AuriaNC.nova({emp, titulo, descricao, servico, pavimento_id, local_txt, origem, origem_id, origem_ref})
//    AuriaNC.minhasAcoes()     → ações pendentes do usuário (selo)
// ============================================================================
(function(){
  let C = null, EL = null, F = { emp:'', sit:'abertas', q:'' }, SEL = null, NCS = [], EMPREIT = [];
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const dt = d => d ? new Date(String(d).length === 10 ? d + 'T12:00' : d).toLocaleDateString('pt-BR') : '—';
  const hoje = () => new Date().toISOString().slice(0, 10);
  const num = n => 'NC ' + String(n).padStart(3, '0');
  const SIT = { aberta:['Análise', '#B7791F'], plano:['Plano p/ aprovar', '#E8960A'], execucao:['Em execução', '#1E3A5F'], eficacia:['Eficácia', '#7C3AED'], encerrada:['Encerrada', '#1E8449'], cancelada:['Cancelada', '#94A3B8'] };
  const PASSOS = [['aberta','Contenção e causa'], ['plano','Plano de ação'], ['execucao','Execução'], ['eficacia','Eficácia'], ['encerrada','Encerrada']];
  const ORIG = { manual:'Registro manual', fvs:'FVS', contestacao:'Ficha contestada pela Qualidade', reinspecao:'Reinspeção reprovada', auditoria:'Auditoria', diario:'Diário de obra', apontamento:'Apontamento', cliente:'Reclamação de cliente' };
  const TIPO = { execucao:'Execução', material:'Material', projeto:'Projeto', seguranca:'Segurança', documental:'Documental', outro:'Outro' };
  const GRAV = { leve:'Leve', moderada:'Moderada', grave:'Grave' };
  const SEISM = [['mao','Mão de obra'], ['metodo','Método'], ['material','Material'], ['maquina','Máquina'], ['meio','Meio ambiente'], ['medicao','Medição']];

  function css(){
    if (document.getElementById('ancCss')) return;
    const s = document.createElement('style'); s.id = 'ancCss';
    s.textContent = `
.anc{--a-line:var(--line,#E2E8F0);--a-l2:var(--line2,#F1F5F9);--a-mut:var(--mut,#64748B);--a-txt:var(--txt,#0F172A);--a-pan:var(--panel,#fff);--a-nav:var(--navy,#1E3A5F);--a-acc:var(--accent,#E8960A);--a-accbg:var(--accentBg,#FEF6E7);
  display:grid;grid-template-columns:minmax(300px,420px) 1fr;gap:16px;min-height:0;color:var(--a-txt);font-size:13px}
.anc .cd{background:var(--a-pan);border:1px solid var(--a-line);border-radius:12px;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.anc .tb{display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--a-l2)}
.anc input,.anc select,.anc textarea{font:inherit;color:inherit;background:var(--a-pan);border:1px solid var(--a-line);border-radius:8px;padding:6px 9px}
.anc textarea{width:100%;box-sizing:border-box;resize:vertical}
.anc .kp{display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid var(--a-l2)}
.anc .kp button{border:0;border-top:3px solid transparent;background:none;padding:8px 4px;cursor:pointer;color:var(--a-mut);font:inherit;font-size:11px}
.anc .kp button b{display:block;font:700 17px ui-monospace,Consolas,monospace;color:var(--a-txt)}
.anc .kp button.on{background:var(--a-accbg)}
.anc .ls{overflow:auto;flex:1}
.anc .it{padding:10px 12px;border-bottom:1px solid var(--a-l2);cursor:pointer;border-left:3px solid transparent}
.anc .it:hover{background:var(--a-l2)}.anc .it.sel{border-left-color:var(--a-acc);background:var(--a-accbg)}
.anc .it .l1{display:flex;gap:8px;align-items:center}.anc .it .l2{color:var(--a-mut);font-size:11.5px;margin-top:3px}
.anc .cod{font:700 12px ui-monospace,Consolas,monospace;color:var(--a-nav)}
.anc .ch{display:inline-block;font-size:10.5px;font-weight:800;border-radius:99px;padding:1px 8px;color:#fff;white-space:nowrap}
.anc .chl{display:inline-block;font-size:10.5px;font-weight:700;border-radius:99px;padding:1px 8px;border:1px solid var(--a-line);color:var(--a-mut)}
.anc .chl.r{border-color:#F5C2C2;color:#A32D2D;background:#FDF0F0}
.anc .det{overflow:auto;padding:16px 18px}
.anc .det h3{margin:6px 0 2px;font-size:17px}
.anc .ps{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:12px 0}
.anc .ps div{border:1px solid var(--a-line);border-radius:8px;padding:6px 8px;font-size:11.5px;color:var(--a-mut)}
.anc .ps div.ok{border-color:#BFE3CB;color:#1E8449}.anc .ps div.on{border-color:var(--a-acc);color:var(--a-txt);background:var(--a-accbg);font-weight:700}
.anc .sec{margin-top:16px}.anc .sec>.h{font:800 10.5px ui-monospace,Consolas,monospace;letter-spacing:.06em;color:var(--a-mut);margin-bottom:6px;text-transform:uppercase}
.anc .kv{display:grid;grid-template-columns:140px 1fr;gap:4px 12px;font-size:12.5px}.anc .kv span{color:var(--a-mut)}
.anc .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.anc .g2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.anc label.l{display:block;font-size:11px;color:var(--a-mut);margin:8px 0 3px}
.anc .bt{border:1px solid var(--a-line);background:var(--a-pan);border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit;font-weight:600;color:var(--a-txt)}
.anc .bt.p{background:var(--a-acc);border-color:var(--a-acc);color:#231703}.anc .bt.sm{padding:3px 9px;font-size:12px}
.anc .bt:disabled{opacity:.5;cursor:default}
.anc .ac{border:1px solid var(--a-line);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.anc .ac.ok{border-color:#BFE3CB;background:#F3FBF6}.anc .ac.at{border-color:#F5C2C2}
.anc .ac .l1{display:flex;gap:8px;align-items:center}
.anc .por{display:grid;grid-template-columns:28px 1fr;gap:6px;align-items:start;margin-bottom:6px}
.anc .por b{font:700 11px ui-monospace,Consolas,monospace;color:var(--a-mut);padding-top:8px}
.anc .hist div{font-size:11.5px;color:var(--a-mut);padding:3px 0;border-bottom:1px dashed var(--a-l2)}
.anc .msg{font-size:12px;margin-top:6px}.anc .msg.err{color:#A32D2D}.anc .msg.ok{color:#1E8449}
.anc .fotos{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.anc .fotos img{width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--a-line)}
.anc .vz{color:var(--a-mut);padding:30px;text-align:center}
.anc .alr{border-radius:8px;padding:8px 10px;font-size:12px;background:#FDF0F0;color:#A32D2D;margin-top:8px}
.anc-ov{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:8800;display:flex;align-items:center;justify-content:center;padding:14px}
.anc-ov .bx{background:var(--bg,#EEF2F7);border-radius:14px;width:min(1200px,98vw);height:min(860px,94vh);display:flex;flex-direction:column;overflow:hidden}
.anc-ov .bh{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0F1B2D;color:#fff}.anc-ov .bh b{flex:1}
.anc-ov .bb{flex:1;min-height:0;padding:14px;display:flex}.anc-ov .bb>.anc{flex:1}
.anc-fm{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:8900;display:flex;align-items:center;justify-content:center;padding:14px}
.anc-fm .bx{background:var(--panel,#fff);color:var(--txt,#0F172A);border-radius:12px;width:min(620px,96vw);max-height:92vh;overflow:auto;padding:16px 18px;font-size:13px}
.anc-fm label.l{display:block;font-size:11px;color:#64748B;margin:9px 0 3px}
.anc-fm input,.anc-fm select,.anc-fm textarea{font:inherit;width:100%;box-sizing:border-box;border:1px solid #E2E8F0;border-radius:8px;padding:7px 9px;background:#fff;color:#0F172A}
.anc-fm .g2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.anc-fm .ft{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.anc-fm .bt{border:1px solid #E2E8F0;background:#fff;border-radius:8px;padding:7px 14px;cursor:pointer;font:inherit;font-weight:600}.anc-fm .bt.p{background:#E8960A;border-color:#E8960A;color:#231703}
@media (max-width:820px){.anc{grid-template-columns:1fr}.anc .ps,.anc .g3{grid-template-columns:1fr 1fr}.anc .kv{grid-template-columns:1fr}}`;
    document.head.appendChild(s);
  }

  // ── permissões (o banco confere de novo) ─────────────────────────────────
  const nivel = emp => (C.nivelDe ? C.nivelDe(emp) : null);
  const ehQ = () => !!C.qualidade;
  const podeTratar = emp => ehQ() || ['eng_chefe','coord_campo'].includes(nivel(emp));
  const podeAbrir = emp => ehQ() || !!nivel(emp);
  const empNome = id => ((C.emps || []).find(e => e.id === id) || {}).nome || '';

  async function carregar(){
    let q = C.sb.from('nc_auria').select('*').eq('grupo_id', C.grupo).order('numero', { ascending:false });
    if (F.emp) q = q.eq('empreendimento_id', F.emp);
    const [{ data, error }, emp] = await Promise.all([q, C.sb.from('nc_empreiteiro_auria').select('id,nome').eq('grupo_id', C.grupo).eq('ativo', true).order('nome')]);
    if (error) throw error;
    NCS = data || []; EMPREIT = emp.data || [];
  }
  const filtro = n => {
    if (F.sit === 'abertas' && ['encerrada','cancelada'].includes(n.situacao)) return false;
    if (F.sit && !['abertas','todas'].includes(F.sit) && n.situacao !== F.sit) return false;
    if (F.q){ const t = (num(n.numero) + ' ' + n.titulo + ' ' + (n.servico || '') + ' ' + empNome(n.empreendimento_id)).toLowerCase(); if (!t.includes(F.q.toLowerCase())) return false; }
    return true;
  };
  const atrasoEf = n => n.situacao === 'eficacia' && n.eficacia_prevista && n.eficacia_prevista <= hoje();

  async function tela(el, op){
    css(); EL = el; op = op || {};
    if (op.emp !== undefined) F.emp = op.emp || '';
    el.innerHTML = '<div class="vz">Carregando não conformidades…</div>';
    try { await carregar(); } catch (e){ el.innerHTML = '<div class="vz">Não foi possível carregar: ' + esc(e.message || e) + '</div>'; return; }
    desenhar();
  }
  function desenhar(){
    const cont = k => NCS.filter(n => n.situacao === k).length;
    const l = NCS.filter(filtro);
    const fixo = (C.emps || []).length <= 1 || F.travado;
    EL.innerHTML = '<div class="anc"><div class="cd">'
      + '<div class="tb"><input type="search" placeholder="Número, título, serviço" value="' + esc(F.q) + '" oninput="AuriaNC._f(\'q\',this.value)" style="flex:1;min-width:140px">'
      + (fixo ? '' : '<select onchange="AuriaNC._f(\'emp\',this.value,true)"><option value="">Todas as obras</option>' + C.emps.map(e => '<option value="' + e.id + '"' + (F.emp === e.id ? ' selected' : '') + '>' + esc(e.nome) + '</option>').join('') + '</select>')
      + (podeAbrir(F.emp || (C.emps[0] || {}).id) ? '<button class="bt p" onclick="AuriaNC.nova({emp:\'' + (F.emp || '') + '\'})">＋ NC</button>' : '') + '</div>'
      + '<div class="kp">' + ['aberta','plano','execucao','eficacia','encerrada'].map(k => '<button class="' + (F.sit === k ? 'on' : '') + '" style="border-top-color:' + SIT[k][1] + '" onclick="AuriaNC._f(\'sit\',\'' + k + '\')"><b>' + cont(k) + '</b>' + SIT[k][0] + '</button>').join('') + '</div>'
      + '<div class="tb" style="padding:6px 12px">' + [['abertas','Em aberto'], ['todas','Todas']].map(([k, t]) => '<button class="bt sm' + (F.sit === k ? ' p' : '') + '" onclick="AuriaNC._f(\'sit\',\'' + k + '\')">' + t + '</button>').join('') + '<span style="flex:1"></span><span style="color:var(--a-mut);font-size:11.5px;align-self:center">' + l.length + ' NC</span></div>'
      + '<div class="ls">' + (l.length ? l.map(n => '<div class="it' + (SEL === n.id ? ' sel' : '') + '" onclick="AuriaNC._sel(\'' + n.id + '\')"><div class="l1"><span class="cod">' + num(n.numero) + '</span><span class="ch" style="background:' + SIT[n.situacao][1] + '">' + SIT[n.situacao][0] + '</span>'
          + (n.gravidade === 'grave' ? '<span class="chl r">grave</span>' : '') + (n.reincidente_de ? '<span class="chl r">reincidente</span>' : '') + (atrasoEf(n) ? '<span class="chl r">eficácia vencida</span>' : '') + '</div>'
          + '<div style="margin-top:4px;font-weight:600">' + esc(n.titulo) + '</div><div class="l2">' + esc([empNome(n.empreendimento_id), n.servico, ORIG[n.origem]].filter(Boolean).join(' · ')) + ' · ' + dt(n.aberta_em) + '</div></div>').join('')
        : '<div class="vz">Nenhuma não conformidade' + (F.sit === 'abertas' ? ' em aberto' : '') + '.</div>') + '</div></div>'
      + '<div class="cd det" id="ancDet"></div></div>';
    detalhe();
  }

  async function detalhe(){
    const el = document.getElementById('ancDet'); if (!el) return;
    const n = NCS.find(x => x.id === SEL);
    if (!n){ el.innerHTML = '<div class="vz">Selecione uma não conformidade.<br><br><span style="font-size:12px">Ciclo: contenção e causa → plano de ação (aprovado pela Qualidade) → execução com evidência → verificação de eficácia.</span></div>'; return; }
    el.innerHTML = '<div class="vz">Carregando…</div>';
    const [{ data:acoes }, { data:evs }, { data:pess }, rein] = await Promise.all([
      C.sb.from('nc_acao_auria').select('*').eq('nc_id', n.id).order('rodada').order('ordem'),
      C.sb.from('nc_evento_auria').select('*').eq('nc_id', n.id).order('em', { ascending:false }),
      C.sb.rpc('nc_pessoas', { p_emp:n.empreendimento_id }),
      n.reincidente_de ? C.sb.from('nc_auria').select('numero,titulo,situacao,aberta_em').eq('id', n.reincidente_de).maybeSingle() : Promise.resolve({ data:null })]);
    if (SEL !== n.id) return;
    const trat = podeTratar(n.empreendimento_id), q = ehQ(), editAnalise = trat && ['aberta','plano'].includes(n.situacao);
    const idx = PASSOS.findIndex(p => p[0] === n.situacao);
    const daRodada = (acoes || []).filter(a => a.rodada === n.rodada), antigas = (acoes || []).filter(a => a.rodada < n.rodada);
    const cz = n.causa || {};
    let h = '<div><span class="cod">' + num(n.numero) + '</span> <span class="ch" style="background:' + SIT[n.situacao][1] + '">' + SIT[n.situacao][0] + '</span>'
      + (n.rodada > 1 ? ' <span class="chl r">reaberta · rodada ' + n.rodada + '</span>' : '') + (n.gravidade === 'grave' ? ' <span class="chl r">grave</span>' : '')
      + '<h3>' + esc(n.titulo) + '</h3><div style="color:var(--a-mut);font-size:12px">' + esc(empNome(n.empreendimento_id)) + ' · aberta por ' + esc(n.aberta_nome || '') + ' em ' + dt(n.aberta_em) + ' · ' + esc(ORIG[n.origem] || n.origem) + (n.origem_ref ? ' (' + esc(n.origem_ref) + ')' : '') + '</div></div>';
    if (n.situacao !== 'cancelada') h += '<div class="ps">' + PASSOS.map((p, i) => '<div class="' + (i < idx ? 'ok' : i === idx ? 'on' : '') + '">' + (i < idx ? '✓ ' : '') + p[1] + '</div>').join('') + '</div>';
    else h += '<div class="alr">Cancelada: ' + esc(n.cancelada_motivo || '') + '</div>';
    if (rein.data) h += '<div class="alr">Reincidência: o mesmo serviço teve a ' + num(rein.data.numero) + ' — “' + esc(rein.data.titulo) + '” em ' + dt(rein.data.aberta_em) + ' (' + SIT[rein.data.situacao][0].toLowerCase() + '). Avalie se a causa raiz anterior foi tratada de verdade.</div>';
    h += '<div class="sec"><div class="h">Descrição</div><div style="white-space:pre-wrap">' + esc(n.descricao || '—') + '</div><div class="fotos" id="ancFotos"></div></div>';

    // Análise
    h += '<div class="sec"><div class="h">Classificação, contenção e causa raiz</div>';
    if (editAnalise){
      h += '<div class="g3"><div><label class="l">Tipo</label><select id="anTipo">' + Object.keys(TIPO).map(k => '<option value="' + k + '"' + (n.tipo === k ? ' selected' : '') + '>' + TIPO[k] + '</option>').join('') + '</select></div>'
        + '<div><label class="l">Gravidade</label><select id="anGrav">' + Object.keys(GRAV).map(k => '<option value="' + k + '"' + (n.gravidade === k ? ' selected' : '') + '>' + GRAV[k] + '</option>').join('') + '</select></div>'
        + '<div><label class="l">Empreiteiro</label><select id="anEmp" onchange="if(this.value===\'+\')AuriaNC._novoEmpreit(this)"><option value="">— próprio / não se aplica —</option>' + EMPREIT.map(e => '<option value="' + e.id + '"' + (n.empreiteiro_id === e.id ? ' selected' : '') + '>' + esc(e.nome) + '</option>').join('') + '<option value="+">＋ cadastrar empreiteiro…</option></select></div></div>'
        + '<label class="l">Serviço</label><input id="anServ" value="' + esc(n.servico || '') + '" style="width:100%;box-sizing:border-box">'
        + '<label class="l">Contenção — o que foi feito na hora para conter o problema</label><textarea id="anCont" rows="2">' + esc(n.contencao || '') + '</textarea>'
        + '<label class="l">Método de análise da causa</label><select id="anMet" onchange="AuriaNC._metodo(this.value)"><option value="5porques"' + (n.causa_metodo !== 'ishikawa' ? ' selected' : '') + '>5 porquês</option><option value="ishikawa"' + (n.causa_metodo === 'ishikawa' ? ' selected' : '') + '>Ishikawa (6M)</option></select>'
        + '<div id="anCausa" style="margin-top:8px"></div>'
        + '<label class="l">Causa raiz (conclusão)</label><textarea id="anRaiz" rows="2">' + esc(n.causa_raiz || '') + '</textarea>'
        + '<div style="display:flex;gap:8px;margin-top:8px"><button class="bt" onclick="AuriaNC._salvarAnalise(\'' + n.id + '\')">Salvar análise</button><span class="msg" id="anMsg"></span></div>';
    } else {
      h += '<div class="kv"><span>Tipo</span><b>' + esc(TIPO[n.tipo] || n.tipo) + '</b><span>Gravidade</span><b>' + esc(GRAV[n.gravidade]) + '</b><span>Empreiteiro</span><b>' + esc((EMPREIT.find(e => e.id === n.empreiteiro_id) || {}).nome || '—') + '</b>'
        + '<span>Serviço</span><b>' + esc(n.servico || '—') + '</b><span>Contenção</span><b>' + esc(n.contencao || '—') + (n.contencao_nome ? ' <span style="color:var(--a-mut);font-weight:400">— ' + esc(n.contencao_nome) + '</span>' : '') + '</b>'
        + '<span>Análise</span><b>' + causaTexto(n) + '</b><span>Causa raiz</span><b>' + esc(n.causa_raiz || '—') + '</b></div>';
    }
    h += '</div>';

    // Plano / ações
    h += '<div class="sec"><div class="h">Plano de ação' + (n.plano_aprovado_nome ? ' — aprovado por ' + esc(n.plano_aprovado_nome) + ' em ' + dt(n.plano_aprovado_em) : '') + '</div>';
    if (editAnalise){
      const base = daRodada.length ? daRodada : [{ tipo:'corretiva', descricao:'', responsavel_id:'', prazo:'' }];
      h += '<div id="anAcoes">' + base.map(a => acaoLinhaEd(a, pess || [])).join('') + '</div>'
        + '<button class="bt sm" onclick="AuriaNC._addAcao(\'' + n.id + '\')">＋ ação</button>'
        + '<div style="display:flex;gap:8px;margin-top:10px;align-items:center"><button class="bt p" onclick="AuriaNC._enviarPlano(\'' + n.id + '\')">' + (n.situacao === 'plano' ? 'Reenviar plano' : 'Enviar plano para a Qualidade') + '</button><span class="msg" id="plMsg"></span></div>'
        + '<div style="color:var(--a-mut);font-size:11.5px;margin-top:4px">Corretiva elimina o problema encontrado; preventiva ataca a causa para não voltar. Contenção e causa raiz precisam estar salvas.</div>';
    } else h += daRodada.length ? daRodada.map(a => acaoCartao(a, n)).join('') : '<div style="color:var(--a-mut)">Sem ações nesta rodada.</div>';
    if (n.situacao === 'plano' && q) h += '<div style="display:flex;gap:8px;margin-top:10px"><button class="bt p" onclick="AuriaNC._decidir(\'' + n.id + '\',\'aprovar\')">Aprovar plano</button><button class="bt" onclick="AuriaNC._decidir(\'' + n.id + '\',\'devolver\')">Devolver para ajuste</button></div>';
    if (antigas.length) h += '<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--a-mut);font-size:12px">Ações de rodadas anteriores (' + antigas.length + ')</summary>' + antigas.map(a => acaoCartao(a, n, true)).join('') + '</details>';
    h += '</div>';

    // Eficácia
    if (['eficacia','encerrada'].includes(n.situacao)){
      h += '<div class="sec"><div class="h">Verificação de eficácia</div>';
      if (n.situacao === 'encerrada') h += '<div class="kv"><span>Verificada por</span><b>' + esc(n.eficacia_nome || '') + ' em ' + dt(n.eficacia_em) + '</b><span>Evidência</span><b>' + esc(n.eficacia_obs || '') + '</b></div>';
      else {
        h += '<div>Prevista para <b>' + dt(n.eficacia_prevista) + '</b>' + (atrasoEf(n) ? ' — <b style="color:#A32D2D">já pode ser verificada</b>' : ' — antes disso, o problema ainda pode não ter tido chance de voltar') + '.</div>';
        if (q) h += '<label class="l">O que foi verificado em campo (o problema voltou?)</label><textarea id="efObs" rows="2"></textarea><div style="display:flex;gap:8px;margin-top:8px"><button class="bt p" onclick="AuriaNC._eficacia(\'' + n.id + '\',true)">Eficaz — encerrar</button><button class="bt" onclick="AuriaNC._eficacia(\'' + n.id + '\',false)">Ineficaz — reabrir</button><span class="msg" id="efMsg"></span></div>';
      }
      h += '</div>';
    }
    if (q && !['encerrada','cancelada'].includes(n.situacao)) h += '<div class="sec"><button class="bt sm" onclick="AuriaNC._cancelar(\'' + n.id + '\')">Cancelar NC (registro indevido / duplicado)</button></div>';
    h += '<div class="sec"><div class="h">Histórico</div><div class="hist">' + (evs || []).map(e => '<div>' + new Date(e.em).toLocaleString('pt-BR') + ' · <b>' + esc(EVT[e.tipo] || e.tipo) + '</b> · ' + esc(e.por_nome || '') + (e.observacao ? ' — ' + esc(e.observacao) : '') + '</div>').join('') + '</div></div>';
    el.innerHTML = h;
    if (editAnalise) metodo(n.causa_metodo || '5porques', cz);
    fotosHtml(n.fotos, 'ancFotos');
    daRodada.forEach(a => fotosHtml(a.evidencia_fotos, 'ancEv_' + a.id));
  }
  const EVT = { aberta:'Aberta', plano_enviado:'Plano enviado', plano_aprovado:'Plano aprovado', plano_devolvido:'Plano devolvido', acao_concluida:'Ação concluída', aguardando_eficacia:'Aguardando eficácia', encerrada:'Encerrada (eficaz)', ineficaz_reaberta:'Ineficaz — reaberta', cancelada:'Cancelada' };
  function causaTexto(n){
    const c = n.causa || {};
    if (n.causa_metodo === 'ishikawa') return SEISM.filter(([k]) => c[k]).map(([k, t]) => '<div><span style="color:var(--a-mut)">' + t + ':</span> ' + esc(c[k]) + '</div>').join('') || '—';
    return (c.porques || []).filter(Boolean).map((p, i) => '<div><span style="color:var(--a-mut)">Por quê ' + (i + 1) + ':</span> ' + esc(p) + '</div>').join('') || '—';
  }
  function metodo(m, cz){
    const el = document.getElementById('anCausa'); if (!el) return;
    cz = cz || {};
    el.innerHTML = m === 'ishikawa'
      ? '<div class="g2">' + SEISM.map(([k, t]) => '<div><label class="l">' + t + '</label><textarea rows="2" data-ish="' + k + '">' + esc(cz[k] || '') + '</textarea></div>').join('') + '</div>'
      : [0,1,2,3,4].map(i => '<div class="por"><b>' + (i + 1) + '</b><textarea rows="1" data-pq="' + i + '" placeholder="' + (i ? 'Por que isso aconteceu?' : 'Por que o problema aconteceu?') + '">' + esc((cz.porques || [])[i] || '') + '</textarea></div>').join('');
  }
  function acaoLinhaEd(a, pess){
    return '<div class="ac" data-acao><div class="g3"><div><label class="l">Tipo</label><select data-k="tipo"><option value="corretiva"' + (a.tipo !== 'preventiva' ? ' selected' : '') + '>Corretiva</option><option value="preventiva"' + (a.tipo === 'preventiva' ? ' selected' : '') + '>Preventiva</option></select></div>'
      + '<div><label class="l">Responsável</label><select data-k="responsavel_id"><option value="">—</option>' + pess.map(p => '<option value="' + p.id + '"' + (a.responsavel_id === p.id ? ' selected' : '') + '>' + esc(p.nome) + '</option>').join('') + '</select></div>'
      + '<div><label class="l">Prazo</label><input type="date" data-k="prazo" value="' + esc(a.prazo || '') + '" min="' + hoje() + '"></div></div>'
      + '<label class="l">O quê</label><div style="display:flex;gap:6px"><textarea rows="1" data-k="descricao" style="flex:1">' + esc(a.descricao || '') + '</textarea><button class="bt sm" title="Tirar" onclick="this.closest(\'[data-acao]\').remove()">×</button></div></div>';
  }
  function acaoCartao(a, n, velha){
    const at = a.situacao === 'pendente' && a.prazo < hoje();
    const pode = !velha && n.situacao === 'execucao' && a.situacao === 'pendente' && (a.responsavel_id === (C.me || {}).id || podeTratar(n.empreendimento_id));
    return '<div class="ac' + (a.situacao === 'concluida' ? ' ok' : at ? ' at' : '') + '"><div class="l1"><span class="chl">' + (a.tipo === 'preventiva' ? 'preventiva' : 'corretiva') + '</span><b style="flex:1">' + esc(a.descricao) + '</b>'
      + (a.situacao === 'concluida' ? '<span class="ch" style="background:#1E8449">concluída</span>' : at ? '<span class="ch" style="background:#A32D2D">atrasada</span>' : '<span class="chl">pendente</span>') + '</div>'
      + '<div style="color:var(--a-mut);font-size:11.5px;margin-top:3px">' + esc(a.responsavel_nome || '') + ' · prazo ' + dt(a.prazo) + (a.concluida_em ? ' · concluída em ' + dt(a.concluida_em) + ' por ' + esc(a.concluida_nome || '') : '') + '</div>'
      + (a.evidencia ? '<div style="margin-top:4px"><span style="color:var(--a-mut)">Evidência:</span> ' + esc(a.evidencia) + '</div>' : '') + '<div class="fotos" id="ancEv_' + a.id + '"></div>'
      + (pode ? '<div style="margin-top:6px"><label class="l">Evidência (o que foi feito)</label><textarea rows="2" id="evTx_' + a.id + '"></textarea><div style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="file" accept="image/*" multiple id="evF_' + a.id + '"><button class="bt p sm" onclick="AuriaNC._concluir(\'' + a.id + '\',\'' + n.id + '\',\'' + n.empreendimento_id + '\')">Concluir ação</button><span class="msg" id="evMsg_' + a.id + '"></span></div></div>' : '')
      + '</div>';
  }
  async function fotosHtml(fotos, alvo){
    const el = document.getElementById(alvo); if (!el || !fotos || !fotos.length || !C.r2Url) return;
    el.innerHTML = fotos.map((_, i) => '<span id="' + alvo + '_' + i + '" style="width:72px;height:72px;border:1px solid #E2E8F0;border-radius:6px;display:inline-block"></span>').join('');
    fotos.forEach(async (f, i) => { try { const u = await C.r2Url('download', f.path); const s = document.getElementById(alvo + '_' + i); if (s) s.outerHTML = '<a href="' + esc(u) + '" target="_blank"><img src="' + esc(u) + '" alt=""></a>'; } catch (_){} });
  }
  // reduz a foto (lado maior 1600 px, jpeg) antes de subir
  function reduzir(f){
    return new Promise(ok => { const im = new Image(); im.onload = () => { const k = Math.min(1, 1600 / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k;
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); c.toBlob(b => ok(b || f), 'image/jpeg', .82); URL.revokeObjectURL(im.src); }; im.onerror = () => ok(f); im.src = URL.createObjectURL(f); });
  }
  async function subirFotos(files, emp, pasta){
    const out = [];
    for (const f of files){
      const blob = await reduzir(f), nome = (f.name || 'foto').replace(/[^\w.\-]+/g, '_').replace(/\.(heic|png|webp|jpeg)$/i, '.jpg');
      const path = emp + '/_qualidade/nc/' + pasta + '/' + Date.now() + '_' + nome;
      const url = await C.r2Url('upload', path, 'image/jpeg');
      const r = await fetch(url, { method:'PUT', headers:{ 'content-type':'image/jpeg' }, body:blob });
      if (!r.ok) throw new Error('Falha ao enviar a foto (' + r.status + ').');
      out.push({ path, nome:f.name || nome });
    }
    return out;
  }

  // ── ações ────────────────────────────────────────────────────────────────
  const msg = (id, t, ok) => { const e = document.getElementById(id); if (e){ e.className = 'msg ' + (ok ? 'ok' : 'err'); e.textContent = t; } };
  async function recarregar(){ await carregar(); desenhar(); if (C.aoMudar) try { C.aoMudar(); } catch (_){} }
  function lerCausa(){
    const m = (document.getElementById('anMet') || {}).value || '5porques';
    if (m === 'ishikawa'){ const o = {}; document.querySelectorAll('[data-ish]').forEach(t => { if (t.value.trim()) o[t.dataset.ish] = t.value.trim(); }); return { m, c:o }; }
    return { m, c:{ porques:[...document.querySelectorAll('[data-pq]')].map(t => t.value.trim()) } };
  }
  async function salvarAnalise(id, silencioso){
    const n = NCS.find(x => x.id === id), k = lerCausa();
    const emp = document.getElementById('anEmp').value;
    const { error } = await C.sb.rpc('nc_analise_salvar', { p_id:id, p_contencao:document.getElementById('anCont').value, p_metodo:k.m, p_causa:k.c, p_causa_raiz:document.getElementById('anRaiz').value,
      p_tipo:document.getElementById('anTipo').value, p_gravidade:document.getElementById('anGrav').value, p_empreiteiro:emp && emp !== '+' ? emp : null, p_servico:document.getElementById('anServ').value });
    if (error){ msg('anMsg', error.message); return false; }
    if (!silencioso){ msg('anMsg', 'Análise salva.', true); const { data } = await C.sb.from('nc_auria').select('*').eq('id', id).single(); Object.assign(n, data); }
    return true;
  }
  async function enviarPlano(id){
    if (!(await salvarAnalise(id, true))) return;
    const acoes = [...document.querySelectorAll('[data-acao]')].map(r => { const o = {}; r.querySelectorAll('[data-k]').forEach(x => o[x.dataset.k] = x.value.trim()); return o; }).filter(a => a.descricao || a.responsavel_id || a.prazo);
    const { error } = await C.sb.rpc('nc_plano_enviar', { p_id:id, p_acoes:acoes });
    if (error){ msg('plMsg', error.message); return; }
    await recarregar();
  }
  async function addAcao(id){
    const n = NCS.find(x => x.id === id); const { data } = await C.sb.rpc('nc_pessoas', { p_emp:n.empreendimento_id });
    document.getElementById('anAcoes').insertAdjacentHTML('beforeend', acaoLinhaEd({ tipo:'preventiva' }, data || []));
  }
  function decidir(id, acao){
    form('<b>' + (acao === 'aprovar' ? 'Aprovar o plano de ação' : 'Devolver o plano para ajuste') + '</b><label class="l">' + (acao === 'aprovar' ? 'Observação (opcional)' : 'O que precisa ser ajustado (vai por e-mail)') + '</label><textarea id="dcObs" rows="3"></textarea><div class="msg" id="dcMsg"></div>',
      acao === 'aprovar' ? 'Aprovar' : 'Devolver', async () => {
        const { error } = await C.sb.rpc('nc_plano_aprovar', { p_id:id, p_ok:acao === 'aprovar', p_obs:document.getElementById('dcObs').value });
        if (error){ msg('dcMsg', error.message); return false; } await recarregar(); return true; });
  }
  async function concluir(acaoId, ncId, emp){
    const tx = document.getElementById('evTx_' + acaoId).value, fs = [...(document.getElementById('evF_' + acaoId).files || [])];
    msg('evMsg_' + acaoId, fs.length ? 'Enviando fotos…' : '', true);
    let fotos = [];
    try { if (fs.length) fotos = await subirFotos(fs, emp, ncId); } catch (e){ msg('evMsg_' + acaoId, e.message || String(e)); return; }
    const { error } = await C.sb.rpc('nc_acao_concluir', { p_acao:acaoId, p_evidencia:tx, p_fotos:fotos });
    if (error){ msg('evMsg_' + acaoId, error.message); return; }
    await recarregar();
  }
  async function eficacia(id, ok){
    const { error } = await C.sb.rpc('nc_eficacia', { p_id:id, p_ok:ok, p_obs:document.getElementById('efObs').value });
    if (error){ msg('efMsg', error.message); return; } await recarregar();
  }
  function cancelar(id){
    form('<b>Cancelar a não conformidade</b><label class="l">Motivo (registro indevido, duplicado…)</label><textarea id="dcObs" rows="2"></textarea><div class="msg" id="dcMsg"></div>', 'Cancelar NC', async () => {
      const { error } = await C.sb.rpc('nc_cancelar', { p_id:id, p_motivo:document.getElementById('dcObs').value });
      if (error){ msg('dcMsg', error.message); return false; } await recarregar(); return true; });
  }
  async function novoEmpreit(sel){
    sel.value = '';
    const nome = prompt('Nome do empreiteiro (razão social ou nome usado na obra):'); if (!nome) return;
    const n = NCS.find(x => x.id === SEL);
    const { data, error } = await C.sb.rpc('nc_empreiteiro_add', { p_grupo:C.grupo, p_nome:nome, p_cnpj:null, p_servicos:n ? n.servico : null });
    if (error){ alert(error.message); return; }
    EMPREIT.push({ id:data, nome }); EMPREIT.sort((a, b) => a.nome.localeCompare(b.nome));
    sel.insertAdjacentHTML('afterbegin', '<option value="' + data + '">' + esc(nome) + '</option>'); sel.value = data;
  }
  function form(html, rotulo, fn){
    css();
    const ov = document.createElement('div'); ov.className = 'anc-fm';
    ov.innerHTML = '<div class="bx">' + html + '<div class="ft"><button class="bt" data-x>Voltar</button><button class="bt p" data-ok>' + rotulo + '</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('[data-x]').onclick = () => ov.remove();
    ov.querySelector('[data-ok]').onclick = async e => { e.target.disabled = true; const r = await fn(); if (r === false) e.target.disabled = false; else ov.remove(); };
    return ov;
  }

  // ── abrir NC (manual ou a partir de uma origem) ──────────────────────────
  function nova(op){
    op = op || {}; css();
    const emps = (C.emps || []).filter(e => podeAbrir(e.id));
    const emp = op.emp || F.emp || (emps.length === 1 ? emps[0].id : '');
    const ov = form('<b>Nova não conformidade</b>' + (op.origem_ref ? '<div style="color:#64748B;font-size:12px;margin-top:3px">Origem: ' + esc(ORIG[op.origem] || op.origem) + ' · ' + esc(op.origem_ref) + '</div>' : '')
      + (emps.length > 1 && !op.emp ? '<label class="l">Obra</label><select id="nvEmp">' + emps.map(e => '<option value="' + e.id + '"' + (e.id === emp ? ' selected' : '') + '>' + esc(e.nome) + '</option>').join('') + '</select>' : '')
      + '<label class="l">Título — o que está errado, em uma linha</label><input id="nvTit" value="' + esc(op.titulo || '') + '" placeholder="Ex.: Prumo da alvenaria fora da tolerância no 12º pavimento">'
      + '<label class="l">Descrição — onde, quanto, desde quando</label><textarea id="nvDes" rows="4">' + esc(op.descricao || '') + '</textarea>'
      + '<div class="g2"><div><label class="l">Serviço</label><input id="nvServ" value="' + esc(op.servico || '') + '" placeholder="Ex.: Alvenaria de vedação"></div><div><label class="l">Local</label><input id="nvLoc" value="' + esc(op.local_txt || '') + '" placeholder="Pavimento, apto, eixo"></div></div>'
      + '<div class="g2"><div><label class="l">Tipo</label><select id="nvTipo">' + Object.keys(TIPO).map(k => '<option value="' + k + '">' + TIPO[k] + '</option>').join('') + '</select></div>'
      + '<div><label class="l">Gravidade</label><select id="nvGrav">' + Object.keys(GRAV).map(k => '<option value="' + k + '"' + (k === 'moderada' ? ' selected' : '') + '>' + GRAV[k] + '</option>').join('') + '</select></div></div>'
      + '<label class="l">Fotos</label><input type="file" id="nvFot" accept="image/*" multiple><div class="msg" id="nvMsg"></div>', 'Abrir NC', async () => {
        const e = document.getElementById('nvEmp') ? document.getElementById('nvEmp').value : emp;
        if (!e){ msg('nvMsg', 'Escolha a obra.'); return false; }
        const fs = [...(document.getElementById('nvFot').files || [])];
        let fotos = [];
        try { if (fs.length){ msg('nvMsg', 'Enviando fotos…', true); fotos = await subirFotos(fs, e, crypto.randomUUID()); } } catch (er){ msg('nvMsg', er.message || String(er)); return false; }
        const { data, error } = await C.sb.rpc('nc_abrir', { p_emp:e, p_titulo:document.getElementById('nvTit').value, p_descricao:document.getElementById('nvDes').value, p_servico:document.getElementById('nvServ').value,
          p_pavimento:op.pavimento_id || null, p_local:document.getElementById('nvLoc').value, p_tipo:document.getElementById('nvTipo').value, p_gravidade:document.getElementById('nvGrav').value,
          p_empreiteiro:null, p_fotos:fotos, p_origem:op.origem || 'manual', p_origem_id:op.origem_id || null, p_origem_ref:op.origem_ref || null });
        if (error){ msg('nvMsg', error.message); return false; }
        SEL = data; F.sit = 'abertas';
        if (EL && document.body.contains(EL)) await recarregar(); else janela({ emp:e });
        return true;
      });
    setTimeout(() => { const t = ov.querySelector('#nvTit'); if (t) t.focus(); }, 50);
  }
  function janela(op){
    css(); op = op || {};
    const ov = document.createElement('div'); ov.className = 'anc-ov';
    ov.innerHTML = '<div class="bx"><div class="bh"><b>Não conformidades' + (op.emp ? ' — ' + esc(empNome(op.emp)) : '') + '</b><button class="bt sm" style="background:#fff">Fechar</button></div><div class="bb"><div id="ancJan" style="flex:1;display:flex;min-height:0"></div></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('.bh button').onclick = () => { ov.remove(); EL = null; if (C.aoMudar) try { C.aoMudar(); } catch (_){} };
    F.travado = !!op.emp;
    tela(ov.querySelector('#ancJan'), { emp:op.emp || '' });
  }
  async function minhasAcoes(){
    const { data } = await C.sb.from('nc_acao_auria').select('id,prazo,nc_auria!inner(situacao,rodada,empreendimento_id)').eq('responsavel_id', (C.me || {}).id).eq('situacao', 'pendente').eq('nc_auria.situacao', 'execucao');
    return data || [];
  }

  window.AuriaNC = {
    init(o){ C = o; }, tela, janela, nova, minhasAcoes, recarregar,
    _f(k, v, rec){ F[k] = v; if (rec) tela(EL); else desenhar(); }, _sel(id){ SEL = id; document.querySelectorAll('.anc .it').forEach(e => e.classList.toggle('sel', e.getAttribute('onclick').includes(id))); detalhe(); },
    _metodo(m){ metodo(m, (NCS.find(x => x.id === SEL) || {}).causa); }, _salvarAnalise:id => salvarAnalise(id), _enviarPlano:enviarPlano, _addAcao:addAcao, _decidir:decidir,
    _concluir:concluir, _eficacia:eficacia, _cancelar:cancelar, _novoEmpreit:novoEmpreit,
    get situacoes(){ return SIT; }
  };
})();
