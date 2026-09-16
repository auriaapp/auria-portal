// ============================================================================
//  Auria — Assistente de ajuda (suporte por IA) · item 52
//  Botão flutuante "?" em todos os painéis. Responde dúvidas de uso com base
//  ÚNICA no manual (RPC ajuda_manual, recortado por papel no servidor) + contexto da tela (papel, página,
//  empreendimento). Não navega na internet: só vê o manual e a pergunta.
//  Quando não sabe, oferece "Enviar para o Auria" → RPC ajuda_escalar (grava e
//  manda e-mail ao suporte). Toda pergunta fica registrada (ajuda_pergunta_auria)
//  para alimentar o manual.
//
//  Uso na página (depois do login):
//    <script src="auria_ajuda.js"></script>
//    AuriaAjuda.init({ sb, papel:'analista', pagina:'Painel do Analista',
//                      contexto:()=>({ empreendimento:'PINI · Diagonal…' }), lado:'right' });
// ============================================================================
(function(){
  const IA_FN='dynamic-task';                 // slug real do proxy de IA (groq-proxy)
  const MAX_TURNOS=8;
  let CFG=null, MANUAL='', CONV=[], ABERTO=false, ULT={pergunta:'',resposta:''};

  const CSS=`
  .aj-btn{position:fixed;bottom:var(--aj-bottom,14px);RIGHTSIDE:14px;z-index:9000;width:32px;height:32px;border-radius:50%;border:2px solid #E8960A;background:#1E3A5F;color:#fff;
    font:800 15px/1 'Segoe UI',system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center}
  .aj-btn:hover{background:#163050}
  .aj-btn .aj-dot{position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:#E8960A;border:2px solid #fff;display:none}
  .aj-pan{position:fixed;bottom:calc(var(--aj-bottom,14px) + 42px);RIGHTSIDE:14px;z-index:9001;width:380px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 100px);
    background:#fff;border:1px solid #E2E8F0;border-radius:14px;box-shadow:0 18px 50px rgba(15,23,42,.28);display:none;flex-direction:column;overflow:hidden;
    font-family:'Segoe UI',system-ui,sans-serif;color:#0F172A}
  .aj-pan.on{display:flex}
  .aj-hd{background:linear-gradient(90deg,#0B1220,#152036);color:#fff;padding:10px 14px;display:flex;align-items:center;gap:10px}
  .aj-hd img{height:26px}
  .aj-hd b{font-size:13.5px;display:block;line-height:1.15}
  .aj-hd span{font-size:11px;color:#8FA6C0}
  .aj-hd button{margin-left:auto;background:#1B2942;border:1px solid #2A3850;color:#C9D6E4;border-radius:7px;padding:4px 9px;font-size:12px;cursor:pointer;font-family:inherit}
  .aj-line{height:2px;background:#E8960A}
  .aj-msgs{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px;background:#EEF2F7}
  .aj-m{max-width:92%;padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
  .aj-m.u{align-self:flex-end;background:#1E3A5F;color:#fff;border-bottom-right-radius:4px}
  .aj-m.a{align-self:flex-start;background:#fff;border:1px solid #E2E8F0;border-bottom-left-radius:4px}
  .aj-m.a b{color:#1E3A5F}
  .aj-m.a code{font-family:ui-monospace,Consolas,monospace;background:#F6F9FC;border:1px solid #E2E8F0;border-radius:4px;padding:0 4px;font-size:12px}
  .aj-m.a ul{margin:4px 0 4px 18px;padding:0}
  .aj-m.a li{margin:2px 0}
  .aj-sug{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px;background:#EEF2F7}
  .aj-sug button{background:#fff;border:1px solid #E2E8F0;border-radius:999px;padding:4px 10px;font-size:11.5px;cursor:pointer;color:#334155;font-family:inherit}
  .aj-sug button:hover{border-color:#E8960A}
  .aj-esc{margin:0 12px 8px;background:rgba(232,150,10,.10);border:1px solid #F0B25B;border-radius:10px;padding:8px 10px;font-size:12px;color:#7C3E06;display:none;align-items:center;gap:8px}
  .aj-esc button{background:#E8960A;border:none;color:#231703;border-radius:7px;padding:5px 10px;font-weight:700;cursor:pointer;font-family:inherit;font-size:12px;margin-left:auto;white-space:nowrap}
  .aj-in{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #E2E8F0;background:#fff}
  .aj-in textarea{flex:1;resize:none;height:44px;padding:8px 10px;border:1px solid #E2E8F0;border-radius:9px;font-family:inherit;font-size:13px;background:#F6F9FC;color:#0F172A}
  .aj-in textarea:focus{outline:none;border-color:#E8960A;background:#fff}
  .aj-in button{background:#1E3A5F;color:#fff;border:none;border-radius:9px;padding:0 14px;font-weight:700;cursor:pointer;font-family:inherit}
  .aj-in button:disabled{opacity:.5;cursor:default}
  .aj-ft{font-size:10.5px;color:#64748B;padding:0 12px 8px;background:#fff}
  @media (max-width:600px){ .aj-pan{width:calc(100vw - 24px);height:calc(100vh - 100px)} }`;

  const SUGESTOES={
    gestor:['Como aprovo um cadastro de fornecedor?','O que é "Em implantação"?','Como dou acesso a alguém da obra?','Como troco a logo do empreendimento?'],
    analista:['Como atribuo um fornecedor a uma disciplina?','Por que o projetista não consegue enviar arquivo?','Como libero uma prancha para a obra?','Como crio um acesso temporário?'],
    projetista:['Como envio uma nota fiscal?','Como solicito o faturamento de uma parcela?','Por que meu arquivo foi devolvido?','Como respondo a um apontamento?'],
    financeiro:['Como abro a janela de recebimento de NFs?','O que significa NF "sem contrato"?','Como baixo as notas de um mês em zip?'],
    obra:['Por que não vejo uma prancha?','Como abro um apontamento?','O que é o Diário de Obra?'],
    setor:['O que consigo ver no CDE?','Por que uma prancha aparece bloqueada?'],
    padrao:['Como funciona o CDE?','O que são os estados S0, S1 e A1?','Onde vejo meus empreendimentos?']
  };
  const PAPEL_NOME={gerente:'gestor',super_admin:'gestor',analista:'analista',projetista:'projetista',financeiro:'adm-fin',obra:'obra',setor:'setor interno'};
  // Capítulos do manual que cada papel recebe (nível de acesso da ajuda). Gestor recebe tudo.
  // Números = "## N." do manual. 1 visão geral · 2 login · 3 gestão · 4 analista · 5 App ·
  // 6 CDE · 7 projetista · 8 adm-fin · 9 custos · 10 acesso temporário · 11 obra/setor ·
  // 12 e-mails · 13 erros · 14 FAQ · 15 glossário.
  const CAPS_POR_PAPEL={
    gerente:null, super_admin:null,
    analista:[1,2,4,5,6,9,10,12,13,14,15],
    projetista:[1,2,6,7,13,15],
    financeiro:[1,2,8,9,12,13,15],
    obra:[1,2,6,11,13,15],
    setor:[1,2,6,11,13,15]
  };
  function manualParaPapel(txt, papel){
    const caps=CAPS_POR_PAPEL[papel];
    if(caps===null) return txt;
    const blocos=txt.split(/\n(?=## \d+\.)/);
    const lista=caps||[1,2,13,15];   // papel desconhecido: só o geral
    return blocos.filter(b=>{ const m=/^## (\d+)\./.exec(b); return !m || lista.includes(parseInt(m[1],10)); }).join("\n");
  }

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  // markdown mínimo → HTML (negrito, código, listas, quebras)
  function md(s){
    let h=esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
    const lines=h.split('\n'); let out='', inList=false;
    for(const l of lines){
      const m=/^\s*[-•]\s+(.*)$/.exec(l);
      if(m){ if(!inList){ out+='<ul>'; inList=true; } out+='<li>'+m[1]+'</li>'; }
      else { if(inList){ out+='</ul>'; inList=false; } out+=(out&&!out.endsWith('</ul>')?'\n':'')+l; }
    }
    if(inList) out+='</ul>';
    return out.replace(/\n{3,}/g,'\n\n');
  }

  // O manual vem do banco pela RPC autenticada ajuda_manual(), que já devolve SÓ os
  // capítulos do papel de quem chama (o recorte é do servidor). Nada público no site.
  async function carregarManual(){
    if(MANUAL) return MANUAL;
    try{ const r=await CFG.sb.rpc('ajuda_manual'); if(!r.error && r.data) MANUAL=String(r.data); }catch(_){}
    return MANUAL;
  }

  function systemPrompt(){
    const ctx=(CFG.contexto&&CFG.contexto())||{};
    const papel=PAPEL_NOME[CFG.papel]||CFG.papel||'usuário';
    return [
      'Você é o assistente de suporte do Auria, plataforma de coordenação de projetos com BIM para construtoras. Responda em português do Brasil, de forma curta, prática e amigável.',
      'REGRAS OBRIGATÓRIAS:',
      '1. Responda SOMENTE com base no MANUAL abaixo. Não invente funções, telas, botões ou regras que não estejam no manual.',
      '2. Se a resposta não estiver no manual, diga exatamente: "Não encontrei isso no manual." e sugira enviar a pergunta para o Auria. Não tente adivinhar.',
      '3. Dê o caminho concreto quando existir: painel › menu/aba › botão (ex.: "Painel do Analista › card do empreendimento › Acessos › Fornecedores › Atribuir").',
      '4. Considere o papel de quem pergunta: um '+papel+' só faz o que o manual permite ao seu papel. Se a pergunta for sobre uma ação de OUTRO papel (ex.: aprovar cadastro, liberar prancha, abrir janela de NF), responda apenas quem é o responsável ("isso é feito pela gestão/coordenação/adm-fin") — sem descrever telas, menus ou botões que não são do papel de quem pergunta.',
      '5. Não fale de sistemas externos, nem de coisas fora do Auria. Não use conhecimento de fora do manual.',
      '6. Use no máximo 6 linhas ou uma lista curta. Negrito para nomes de botões/menus.',
      '',
      'CONTEXTO DE QUEM PERGUNTA: papel = '+papel+'; página atual = '+(CFG.pagina||'—')+(ctx.empreendimento?'; empreendimento aberto = '+ctx.empreendimento:'')+(ctx.extra?'; '+ctx.extra:'')+'.',
      '',
      '===== MANUAL DO AURIA =====',
      (MANUAL&&manualParaPapel(MANUAL, CFG.papel))||'(manual indisponível — responda que o manual não pôde ser carregado e sugira enviar a pergunta para o Auria)',
      '===== FIM DO MANUAL ====='
    ].join('\n');
  }

  function ui(){
    const lado=CFG.lado||'right';
    const st=document.createElement('style'); st.textContent=CSS.replace(/RIGHTSIDE/g, lado==='left'?'left':'right'); document.head.appendChild(st);
    // CFG.acima = seletor de uma barra no rodapé (ex.: #cdeTaskbar): o botão sobe quando ela aparece
    if(CFG.acima){ const el=document.querySelector(CFG.acima); if(el){ const up=()=>{ const h=el.offsetHeight||0; document.documentElement.style.setProperty('--aj-bottom',(h?h+10:14)+'px'); };
      up(); if(window.ResizeObserver) new ResizeObserver(up).observe(el); if(window.MutationObserver) new MutationObserver(up).observe(el,{attributes:true,childList:true}); } }
    const btn=document.createElement('button'); btn.className='aj-btn'; btn.title='Ajuda do Auria — pergunte como usar'; btn.innerHTML='?<span class="aj-dot"></span>';
    btn.onclick=toggle; document.body.appendChild(btn);
    const pan=document.createElement('div'); pan.className='aj-pan'; pan.id='ajPan';
    pan.innerHTML='<div class="aj-hd"><img src="logo_symbol.png" alt=""><div><b>Ajuda do Auria</b><span>Suporte por IA · responde pelo manual</span></div><button onclick="AuriaAjuda.limpar()" title="Limpar conversa">Limpar</button><button onclick="AuriaAjuda.fechar()">✕</button></div><div class="aj-line"></div>'
      +'<div class="aj-msgs" id="ajMsgs"></div><div class="aj-sug" id="ajSug"></div>'
      +'<div class="aj-esc" id="ajEsc"><span>Não resolveu? Mando a pergunta para o Auria com o contexto da sua tela.</span><button onclick="AuriaAjuda.escalar()">Enviar para o Auria</button></div>'
      +'<div class="aj-in"><textarea id="ajIn" placeholder="Pergunte como fazer algo no Auria…"></textarea><button id="ajGo" onclick="AuriaAjuda.enviar()">➤</button></div>'
      +'<div class="aj-ft">Responde só pelo manual do Auria; não consulta a internet. Perguntas ficam registradas para melhorar a ajuda.</div>';
    document.body.appendChild(pan);
    document.getElementById('ajIn').addEventListener('keydown',ev=>{ if(ev.key==='Enter'&&!ev.shiftKey){ ev.preventDefault(); AuriaAjuda.enviar(); } });
    render();
  }
  function render(){
    const box=document.getElementById('ajMsgs'); if(!box) return;
    if(!CONV.length){
      const papel=PAPEL_NOME[CFG.papel]||'';
      box.innerHTML='<div class="aj-m a">Olá! Sou a ajuda do Auria. Pergunte <b>como fazer</b> alguma coisa, <b>onde fica</b> uma função ou o que significa uma mensagem. '+(papel?'Vejo que você está como <b>'+esc(papel)+'</b>'+(CFG.pagina?' no '+esc(CFG.pagina):'')+'.':'')+'</div>';
    } else box.innerHTML=CONV.map(m=>'<div class="aj-m '+(m.role==='user'?'u':'a')+'">'+(m.role==='user'?esc(m.content):md(m.content))+'</div>').join('')+(CONV.length&&CONV[CONV.length-1].pensando?'<div class="aj-m a" style="color:#64748B">pensando…</div>':'');
    box.scrollTop=box.scrollHeight;
    const sug=document.getElementById('ajSug');
    const lista=SUGESTOES[PAPEL_NOME[CFG.papel]==='adm-fin'?'financeiro':(PAPEL_NOME[CFG.papel]||'').replace(' interno','')]||SUGESTOES.padrao;
    sug.innerHTML=CONV.length?'':lista.map(q=>'<button onclick="AuriaAjuda.perguntar('+JSON.stringify(q).replace(/"/g,'&quot;')+')">'+esc(q)+'</button>').join('');
  }
  function toggle(){ ABERTO=!ABERTO; document.getElementById('ajPan').classList.toggle('on',ABERTO); if(ABERTO){ carregarManual(); setTimeout(()=>{ const i=document.getElementById('ajIn'); if(i) i.focus(); },0); } }

  async function enviar(texto){
    const inp=document.getElementById('ajIn'); const q=(texto||inp.value||'').trim(); if(!q) return;
    inp.value=''; CONV.push({role:'user',content:q}); CONV.push({role:'assistant',content:'',pensando:true}); render();
    const go=document.getElementById('ajGo'); go.disabled=true;
    document.getElementById('ajEsc').style.display='none';
    try{
      await carregarManual();
      const hist=CONV.filter(m=>!m.pensando).slice(-MAX_TURNOS*2);
      const messages=[{role:'system',content:systemPrompt()}].concat(hist.map(m=>({role:m.role,content:m.content})));
      const r=await CFG.sb.functions.invoke(IA_FN,{ body:{ messages, temperature:0.2, max_tokens:700 } });
      let resp='';
      if(r.error){ let msg=(r.error&&r.error.message)||String(r.error); try{ const j=await r.error.context.json(); if(j&&j.error) msg=j.error; }catch(_){} throw new Error(msg); }
      resp=(r.data&&(r.data.content||r.data.resposta))||'';
      if(!resp) throw new Error('resposta vazia');
      CONV.pop(); CONV.push({role:'assistant',content:resp}); ULT={pergunta:q,resposta:resp};
      const naoSabe=/não encontrei isso no manual|não está no manual|não encontrei no manual/i.test(resp);
      registrar(q,resp,naoSabe,false);
      render(); document.getElementById('ajEsc').style.display='flex';
    }catch(e){
      CONV.pop(); CONV.push({role:'assistant',content:'Não consegui responder agora ('+((e&&e.message)||e)+'). Você pode enviar a pergunta para o Auria.'}); ULT={pergunta:q,resposta:''};
      render(); document.getElementById('ajEsc').style.display='flex';
    }
    go.disabled=false;
  }
  async function registrar(pergunta, resposta, semResposta, escalado){
    try{ const ctx=(CFG.contexto&&CFG.contexto())||{};
      await CFG.sb.rpc('ajuda_registrar',{ p_pergunta:pergunta, p_resposta:resposta||null, p_pagina:CFG.pagina||null, p_papel:CFG.papel||null,
        p_contexto:JSON.stringify(ctx), p_sem_resposta:!!semResposta, p_escalar:!!escalado }); }catch(_){}
  }
  async function escalar(){
    if(!ULT.pergunta) return;
    const b=document.querySelector('#ajEsc button'); b.disabled=true; b.textContent='Enviando…';
    try{ const ctx=(CFG.contexto&&CFG.contexto())||{};
      const r=await CFG.sb.rpc('ajuda_registrar',{ p_pergunta:ULT.pergunta, p_resposta:ULT.resposta||null, p_pagina:CFG.pagina||null, p_papel:CFG.papel||null,
        p_contexto:JSON.stringify(ctx), p_sem_resposta:true, p_escalar:true });
      if(r.error) throw r.error;
      CONV.push({role:'assistant',content:'Pronto — mandei a sua pergunta para o Auria com o contexto da tela. Você recebe a resposta por e-mail.'}); render();
      document.getElementById('ajEsc').style.display='none';
    }catch(e){ alert('Não foi possível enviar: '+((e&&e.message)||e)); }
    b.disabled=false; b.textContent='Enviar para o Auria';
  }

  window.AuriaAjuda={
    init(cfg){ CFG=cfg||{}; if(!CFG.sb){ console.warn('AuriaAjuda: sem cliente supabase'); return; } if(document.getElementById('ajPan')) return; ui(); carregarManual(); },
    enviar(){ enviar(); }, perguntar(q){ enviar(q); }, escalar, fechar(){ ABERTO=false; document.getElementById('ajPan').classList.remove('on'); },
    limpar(){ CONV=[]; ULT={pergunta:'',resposta:''}; render(); document.getElementById('ajEsc').style.display='none'; },
    contexto(fn){ if(CFG) CFG.contexto=fn; }
  };
  // A página pode ter chamado init antes deste script carregar: pega a config deixada.
  if(window.__ajudaCfg) window.AuriaAjuda.init(window.__ajudaCfg);
})();
