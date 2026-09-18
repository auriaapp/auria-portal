// ============================================================================
//  Auria — Assistente de ajuda (suporte por IA) · item 52
//  Botão flutuante "?" em todos os painéis. Responde dúvidas de uso por BUSCA no
//  manual (RPC ajuda_manual, recortado por papel no servidor) + FAQ, aqui no navegador —
//  sem IA externa (item 72). Gemini fica só para análise/normas no App.
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
  let CFG=null, MANUAL='', CONV=[], ABERTO=false, ULT={pergunta:'',resposta:''};

  const CSS=`
  .aj-btn{position:fixed;bottom:var(--aj-bottom,14px);RIGHTSIDE:var(--aj-side,14px);z-index:8900;width:32px;height:32px;border-radius:50%;border:2px solid #E8960A;background:#1E3A5F;color:#fff;
    font:800 15px/1 'Segoe UI',system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center}
  .aj-btn:hover{background:#163050}
  .aj-btn .aj-dot{position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:#E8960A;border:2px solid #fff;display:none}
  .aj-pan{position:fixed;bottom:calc(var(--aj-bottom,14px) + 42px);RIGHTSIDE:var(--aj-side,14px);z-index:8901;width:380px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 100px);
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
  .aj-go{display:inline-flex;align-items:center;gap:6px;margin-top:8px;background:#E8960A;color:#231703;border:none;border-radius:8px;padding:6px 11px;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit}
  .aj-go:hover{background:#D3860A}
  .aj-veja{margin-top:6px;font-size:11.5px;color:#64748B} .aj-veja a{color:#1E3A5F;font-weight:700;text-decoration:none} .aj-veja a:hover{text-decoration:underline}
  .aj-m.a i.man{color:#64748B;font-style:italic}
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
    obra:['Por que não vejo uma prancha?','Como abro um apontamento?','Como imprimo os QR das pranchas?'],
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
    const blocos=txt.split(/\n(?=## )/);   // blocos sem número (FAQ promovida, item 52a) ficam sempre
    const lista=caps||[1,2,13,15];   // papel desconhecido: só o geral
    return blocos.filter(b=>{ const m=/^## (\d+)\./.exec(b); return !m || lista.includes(parseInt(m[1],10)); }).join("\n");
  }

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  // markdown mínimo → HTML (negrito, código, listas, quebras)
  function md(s){
    let h=esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/_\(([^)]+)\)_/g,'<i class="man">($1)</i>');
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

  // Palavras vazias da busca local (item 72)
  const STOP=new Set(['a','o','os','as','de','do','da','dos','das','um','uma','e','em','no','na','nos','nas','para','pra','por','que','como','onde','qual','quais','é','eu','meu','minha','se','ao','à','com','não','ser','ter','faço','fazer','posso','consigo','uso','usar','isso','esse','essa','este','esta','aqui','ali','tem','há','the','of']);
  // ── "Me leva lá" (fase 2): a página registra ações (CFG.acoes = {chave:{rotulo, run, quando?}}).
  //    O prompt lista as chaves disponíveis; a IA termina a resposta com [[acao:chave]] quando
  //    a resposta é exatamente essa ação; o painel vira isso num botão que executa na hora.
  function acoesDisponiveis(){
    const out={}; const A=(CFG&&CFG.acoes)||{};
    Object.keys(A).forEach(k=>{ const a=A[k]; if(!a||typeof a.run!=='function') return; try{ if(a.quando && !a.quando()) return; }catch(_){ return; } out[k]=a; });
    return out;
  }
  function executarAcao(chave){
    const a=acoesDisponiveis()[chave]; if(!a) return;
    try{ ABERTO=false; document.getElementById('ajPan').classList.remove('on'); a.run(); }
    catch(e){ alert('Não consegui abrir: '+((e&&e.message)||e)); }
  }

  function ui(){
    const lado=CFG.lado||'right';
    const st=document.createElement('style'); st.textContent=CSS.replace(/RIGHTSIDE/g, lado==='left'?'left':'right'); document.head.appendChild(st);
    // CFG.acima = seletor de uma barra no rodapé (ex.: #cdeTaskbar): o botão sobe quando ela aparece
    if(CFG.acima){ const el=document.querySelector(CFG.acima); if(el){ const up=()=>{ const h=el.offsetHeight||0; document.documentElement.style.setProperty('--aj-bottom',(h?h+10:14)+'px'); };
      up(); if(window.ResizeObserver) new ResizeObserver(up).observe(el); if(window.MutationObserver) new MutationObserver(up).observe(el,{attributes:true,childList:true}); } }
    // CFG.centroEm = seletor de uma barra no rodapé (ex.: #cdeTaskbar): o botão fica centralizado na altura dela
    if(CFG.centroEm){ const el=document.querySelector(CFG.centroEm); if(el){ const c=()=>{ const h=el.offsetHeight||0; document.documentElement.style.setProperty('--aj-bottom',(h>=32?Math.round((h-32)/2):14)+'px'); };
      c(); if(window.ResizeObserver) new ResizeObserver(c).observe(el); if(window.MutationObserver) new MutationObserver(c).observe(el,{attributes:true,childList:true}); } }
    // CFG.encosta = seletor de uma coluna lateral (ex.: #navAside): o botão fica encostado nela, não por cima
    if(CFG.encosta){ const el=document.querySelector(CFG.encosta); if(el){ const side=()=>{ const r=el.getBoundingClientRect(); const w=lado==='left'?r.right:(window.innerWidth-r.left);
      document.documentElement.style.setProperty('--aj-side',(w>0&&w<window.innerWidth?w+10:14)+'px'); };
      side(); if(window.ResizeObserver) new ResizeObserver(side).observe(el); window.addEventListener('resize',side); el.addEventListener('transitionend',side); } }
    const btn=document.createElement('button'); btn.className='aj-btn'; btn.title='Ajuda do Auria — pergunte como usar'; btn.innerHTML='?<span class="aj-dot"></span>';
    btn.onclick=toggle; document.body.appendChild(btn);
    const pan=document.createElement('div'); pan.className='aj-pan'; pan.id='ajPan';
    pan.innerHTML='<div class="aj-hd"><img src="logo_symbol.png" alt=""><div><b>Ajuda do Auria</b><span>Responde pelo manual do Auria</span></div><button onclick="AuriaAjuda.limpar()" title="Limpar conversa">Limpar</button><button onclick="AuriaAjuda.fechar()">✕</button></div><div class="aj-line"></div>'
      +'<div class="aj-msgs" id="ajMsgs"></div><div class="aj-sug" id="ajSug"></div>'
      +'<div class="aj-esc" id="ajEsc"><span>Não resolveu? Mando a pergunta para o Auria com o contexto da sua tela.</span><button onclick="AuriaAjuda.escalar()">Enviar para o Auria</button></div>'
      +'<div class="aj-in"><textarea id="ajIn" placeholder="Pergunte como fazer algo no Auria…"></textarea><button id="ajGo" onclick="AuriaAjuda.enviar()">➤</button></div>'
      +'<div class="aj-ft">Busca no manual do Auria, aqui mesmo — sem IA externa e sem internet. Perguntas ficam registradas para melhorar o manual.</div>';
    document.body.appendChild(pan);
    document.getElementById('ajIn').addEventListener('keydown',ev=>{ if(ev.key==='Enter'&&!ev.shiftKey){ ev.preventDefault(); AuriaAjuda.enviar(); } });
    render();
  }
  function render(){
    const box=document.getElementById('ajMsgs'); if(!box) return;
    if(!CONV.length){
      const papel=PAPEL_NOME[CFG.papel]||'';
      box.innerHTML='<div class="aj-m a">Olá! Sou a ajuda do Auria. Pergunte <b>como fazer</b> alguma coisa, <b>onde fica</b> uma função ou o que significa uma mensagem. '+(papel?'Vejo que você está como <b>'+esc(papel)+'</b>'+(CFG.pagina?' no '+esc(CFG.pagina):'')+'.':'')+'</div>';
    } else box.innerHTML=CONV.map(m=>'<div class="aj-m '+(m.role==='user'?'u':'a')+'">'+(m.role==='user'?esc(m.content):md(m.content))
        +(m.acao&&acoesDisponiveis()[m.acao]?'<br><button class="aj-go" onclick="AuriaAjuda.acao(\''+m.acao+'\')">➜ Me leva lá: '+esc(acoesDisponiveis()[m.acao].rotulo)+'</button>':'')
        +(m.extras&&m.extras.length?'<div class="aj-veja">Veja também: '+m.extras.map(t=>'<a href="#" onclick="AuriaAjuda.perguntar('+JSON.stringify(t).replace(/"/g,'&quot;')+');return false">'+esc(t)+'</a>').join(' · ')+'</div>':'')+'</div>').join('')+(CONV.length&&CONV[CONV.length-1].pensando?'<div class="aj-m a" style="color:#64748B">pensando…</div>':'');
    box.scrollTop=box.scrollHeight;
    const sug=document.getElementById('ajSug');
    const lista=SUGESTOES[PAPEL_NOME[CFG.papel]==='adm-fin'?'financeiro':(PAPEL_NOME[CFG.papel]||'').replace(' interno','')]||SUGESTOES.padrao;
    sug.innerHTML=CONV.length?'':lista.map(q=>'<button onclick="AuriaAjuda.perguntar('+JSON.stringify(q).replace(/"/g,'&quot;')+')">'+esc(q)+'</button>').join('');
  }
  function toggle(){ ABERTO=!ABERTO; document.getElementById('ajPan').classList.toggle('on',ABERTO); if(ABERTO){ carregarManual(); setTimeout(()=>{ const i=document.getElementById('ajIn'); if(i) i.focus(); },0); } }

  // ── Item 72: "IA própria" — busca no manual + FAQ, sem modelo externo ─────
  //  Para "como faço X / onde fica Y" não precisa de gerador: precisa de busca boa.
  //  Índice = FAQ promovida (peso máximo) + cap. 14 + cada seção ##/### do manual
  //  (já recortado por papel). Casamento por termos normalizados (acento, plural,
  //  radical) + dicionário de sinônimos do vocabulário do Auria; título pesa mais.
  //  Sem casamento confiável → "Não encontrei isso no manual" + Enviar para o Auria
  //  (que vira FAQ). O Gemini NÃO é usado aqui (fica só para análise/normas no App).
  const SIN=[['baixar','download','descarregar','salvar'],['prancha','folha','desenho','arquivo','documento','pdf'],['pin','apontamento','ocorrencia','pendencia','marcacao'],
    ['liberar','publicar','aprovar','a1','b1','liberado'],['federar','federado','juntar','sobrepor'],['foto','print','imagem','captura','screenshot'],['enviar','subir','upload','mandar','anexar','postar'],
    ['apagar','excluir','remover','deletar'],['renomear','recodificar','codigo','nome'],['senha','login','entrar','acesso','logar','ativar'],['nota','nf','fatura','faturamento','notas'],
    ['girar','rotacionar','rotacao','virar'],['zip','lote','varios','juntos','compactar'],['diario','rdo'],['qr','qrcode','codigo qr','etiqueta'],['fornecedor','escritorio','projetista','contratado'],
    ['etapa','fase','ex','pe','ep'],['buscar','procurar','pesquisar','encontrar','achar','localizar','busca'],['filtro','filtrar','filtrando'],['modelo','ifc','bim','3d','rvt','maquete'],
    ['cotacao','proposta','mde','equalizacao','orcamento'],['contrato','parcela','aditivo'],['disciplina','sigla'],['revisao','versao','rev'],['status','estado','situacao'],
    ['obra','canteiro','campo','engenheiro'],['gestor','gerente','gestao','diretoria'],['analista','coordenador','coordenacao'],['grupo','pasta','colecao'],['pavimento','andar','nivel','piso'],
    ['agenda','calendario','compromisso'],['kanban','quadro'],['mensagem','conversa','chat','responder','resposta'],['cronograma','prazo','marco'],['logo','marca','imagem da empresa'],
    ['acesso temporario','link temporario','24h','convidado'],['medir','trena','medida','cota','distancia'],['corte','secao','cortar'],['caminhar','walk','andar dentro'],['propriedade','pset','atributo','informacao'],
    ['quantitativo','quantidade','area','volume','m2','m3'],['exportar','excel','bcf','relatorio','planilha'],['ficha','briefing','cadastro do empreendimento'],['empreendimento','projeto','obra nova','emp']];
  const SIN_MAP={}; SIN.forEach((g,i)=>g.forEach(w=>{ if(w.includes(' ')) return; SIN_MAP[_norm1(w)]='~'+i; SIN_MAP[_stem(_norm1(w))]='~'+i; }));
  function _norm1(w){ return String(w||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
  // radical leve para PT: tira plural e terminações verbais/nominais comuns (enviar/envio/enviando → envi; girar/gira → gir)
  function _stem(w){ w=w.replace(/(coes|oes)$/,'ao').replace(/(ais|eis|ois)$/,'al').replace(/s$/,'');
    for(const suf of ['ando','endo','indo','aram','eram','iram','ada','ado','ida','ido','mente','ar','er','ir','ou','ei','o','a','e']){ if(w.length-suf.length>=3 && w.endsWith(suf)){ w=w.slice(0,-suf.length); break; } }
    return w.length>6?w.slice(0,6):w; }
  function toks(t){
    const base=_norm1(t).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>1&&!STOP.has(w));
    const out=[]; base.forEach(w=>{ const st=_stem(w); out.push(st); const s=SIN_MAP[w]||SIN_MAP[st]; if(s) out.push(s); });
    // expressões compostas do dicionário ("acesso temporario") — casa no texto inteiro
    const full=' '+_norm1(t)+' '; SIN.forEach((g,i)=>{ if(g.some(x=>x.includes(' ')&&full.includes(' '+_norm1(x)+' '))) out.push('~'+i); });
    return out;
  }
  let INDICE=null, INDICE_SRC='';
  function indexar(manual){
    if(INDICE && INDICE_SRC===manual) return INDICE;
    const itens=[]; const blocos=String(manual||'').split(/\n(?=##+ )/);
    let cap='';
    blocos.forEach(b=>{
      const m=/^(##+)\s+(.+)/.exec(b); if(!m) return;
      const nivel=m[1].length, titulo=m[2].trim(); const corpo=b.slice(m[0].length).trim();
      if(nivel===2) cap=titulo;
      const ehFaq=/^14\.|perguntas frequentes/i.test(titulo);
      if(ehFaq){
        // linhas "- **Pergunta?** resposta" e blocos "**P: pergunta**\nresposta"
        const re1=/^- \*\*(.+?)\*\*\s*(.+)$/gm; let x; while((x=re1.exec(corpo))) itens.push({tipo:'faq',pergunta:x[1].trim(),resposta:x[2].trim(),cap});
        const re2=/\*\*P:\s*(.+?)\*\*\s*\n([\s\S]*?)(?=\n\*\*P:|\n*$)/g; while((x=re2.exec(corpo))) itens.push({tipo:'faq',pergunta:x[1].trim(),resposta:x[2].trim(),cap,promovida:true});
        return;
      }
      if(corpo.length>30) itens.push({tipo:'sec',titulo,corpo,cap,nivel});
    });
    itens.forEach(it=>{ it.tt=new Set(toks(it.tipo==='faq'?it.pergunta:it.titulo)); it.tb=new Set(toks(it.tipo==='faq'?it.resposta:it.corpo)); });
    // frequência de documento por token → peso IDF (palavra que está em tudo vale pouco)
    const df={}; itens.forEach(it=>{ new Set([...it.tt,...it.tb]).forEach(t=>{ df[t]=(df[t]||0)+1; }); });
    const N=itens.length||1; itens.idf=(t)=>{ const d=df[t]; if(!d) return 0.3; return Math.max(0.25, Math.log((N+1)/(d+0.5))/Math.log(N+1)); };
    INDICE=itens; INDICE_SRC=manual; return itens;
  }
  function buscar(pergunta, manual){
    const idx=indexar(manual); const q=[...new Set(toks(pergunta))]; if(!q.length) return [];
    const idf=idx.idf||(()=>1);
    const base=q.filter(t=>t[0]!=='~').reduce((s,t)=>s+idf(t)*3,0)||1;
    const res=idx.map(it=>{
      let sc=0, casou=0;
      q.forEach(t=>{ const eSin=t[0]==='~', w=eSin?0.7:idf(t); if(it.tt.has(t)){ sc+=w*3; casou++; } else if(it.tb.has(t)){ sc+=w*1.6; casou++; } });
      let conf=sc/base;   // sem teto aqui: os multiplicadores desempatam; teto só no fim
      if(it.tipo==='faq') conf*=1.25; if(it.promovida) conf*=1.15;
      // especificidade: seção curta e profunda vale mais que capítulo-panorama (o cap. 1 casa com tudo)
      if(it.tipo==='sec'){ if(it.nivel>=3) conf*=1.1; else conf*=0.85; if(/^1\./.test(it.titulo)) conf*=0.6; if(it.corpo.length>1800) conf*=0.85; }
      return {it, conf, casou};
    }).filter(r=>r.casou>0).sort((a,b)=>b.conf-a.conf||b.casou-a.casou);
    res.forEach(r=>{ r.conf=Math.min(1,r.conf); });
    return res.slice(0,4);
  }
  function acaoPara(texto){   // melhor ação da tela para o texto (pergunta + resposta)
    const A=acoesDisponiveis(); const t=new Set(toks(texto)); let best=null, bs=0;
    Object.keys(A).forEach(k=>{ const a=A[k]; const forte=new Set(toks(k.replace(/_/g,' ')+' '+(a.rotulo||''))), fraco=new Set(toks(a.descricao||''));
      const GEN=new Set(['abr','obr','pain','cde','arqu','list','tel','mostr','model']);   // palavras que estão em várias ações: valem pouco
      let s=0, sf=0; forte.forEach(x=>{ if(t.has(x)){ const g=GEN.has(x); s+=(x[0]==='~'?0.6:(g?0.3:1.5)); if(x[0]!=='~'&&!g) sf++; } }); fraco.forEach(x=>{ if(!forte.has(x)&&t.has(x)) s+=(x[0]==='~'?0.4:0.5); });
      if(sf>0 && s>bs){ bs=s; best=k; } });
    return bs>=2 ? best : null;
  }
  function secaoHtmlTexto(it){
    let corpo=it.corpo; if(corpo.length>1100){ const cut=corpo.slice(0,1100); corpo=cut.slice(0, Math.max(cut.lastIndexOf('\n'), 700))+'\n…'; }
    return '📖 **'+it.titulo+'**'+(it.cap&&it.cap!==it.titulo?'  _(manual › '+it.cap.replace(/^\d+\.\s*/,'')+')_':'')+'\n'+corpo;
  }
  async function enviar(texto){
    const inp=document.getElementById('ajIn'); const q=(texto||inp.value||'').trim(); if(!q) return;
    inp.value=''; CONV.push({role:'user',content:q}); CONV.push({role:'assistant',content:'',pensando:true}); render();
    const go=document.getElementById('ajGo'); go.disabled=true;
    document.getElementById('ajEsc').style.display='none';
    try{
      await carregarManual();
      const man=manualParaPapel(MANUAL||'', CFG.papel);
      let resp='', acao=null, naoSabe=false, extras=[];
      // "me leva lá" / "abre pra mim" como continuação da resposta anterior
      if(/(me lev|leva l[aá]|leve l[aá]|abr[ae] (pra|para) mim|me manda|vai l[aá]|abrir isso|pode abrir)/i.test(q) && ULT.acao && acoesDisponiveis()[ULT.acao]){
        resp='Pronto — é este botão:'; acao=ULT.acao;
      } else if(!man){
        resp='O manual não pôde ser carregado agora. Tente de novo em instantes ou envie a pergunta para o Auria.'; naoSabe=true;
      } else {
        const r=buscar(q, man); const top=r[0];
        if(top && top.conf>=0.42 && (top.casou>=2 || toks(q).filter(t=>t[0]!=='~').length<=1)){
          if(top.it.tipo==='faq') resp=top.it.resposta;
          else resp=secaoHtmlTexto(top.it);
          extras=r.slice(1).filter(x=>x.conf>=0.35 && x.it.tipo==='sec').map(x=>x.it.titulo).slice(0,2);
          acao=acaoPara(q+' '+(top.it.tipo==='faq'?top.it.pergunta+' '+top.it.resposta:top.it.titulo));
        } else {
          resp='Não encontrei isso no manual.'; naoSabe=true;
          const sug=r.filter(x=>x.conf>=0.2).map(x=>x.it.tipo==='faq'?x.it.pergunta:x.it.titulo).slice(0,3);
          if(sug.length) resp+='\nTalvez ajude: '+sug.map(s=>'“'+s+'”').join(', ')+'.';
          resp+='\nSe for uma dúvida de uso, envie para o Auria — a resposta entra no manual para todos.';
        }
      }
      CONV.pop(); CONV.push({role:'assistant',content:resp,acao,extras}); ULT={pergunta:q,resposta:resp,acao};
      registrar(q,resp,naoSabe,false);
      render(); document.getElementById('ajEsc').style.display='flex';
    }catch(e){
      console.warn('[ajuda] busca falhou:', (e&&e.message)||e);
      CONV.pop(); CONV.push({role:'assistant',content:'Não consegui responder agora. Você pode tentar de novo ou enviar a pergunta para o Auria.'}); ULT={pergunta:q,resposta:''};
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
    contexto(fn){ if(CFG) CFG.contexto=fn; },
    acoes(obj){ if(CFG) CFG.acoes=Object.assign(CFG.acoes||{}, obj||{}); }, acao(chave){ executarAcao(chave); }
  };
  // A página pode ter chamado init antes deste script carregar: pega a config deixada.
  if(window.__ajudaCfg) window.AuriaAjuda.init(window.__ajudaCfg);
})();
