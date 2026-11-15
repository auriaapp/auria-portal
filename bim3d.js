// bim3d version: 2026-11-15c  (comentário serve p/ humanos; app.html usa o ?v= do import)
// ============================================================================
//  Visualizador BIM do Auria — BASE ÚNICA (CDE e App)
//  --------------------------------------------------------------------------
//  Existia uma cópia em cde.html e outra em app.html. A do App nasceu
//  depois e mais simples, e não recebeu as correções que vieram sendo feitas
//  na do CDE — pivô da navegação, dupla face, ordem de carga. Resultado: o
//  mesmo visualizador se comportando pior de um lado. Este módulo existe para
//  isso não voltar a acontecer: quem escreve função nova escreve UMA vez.
//
//  O que é específico de cada lado (apontamento e regras no App, janelas no
//  CDE) fica FORA daqui, ligado por callbacks. Este módulo só sabe mostrar
//  modelo, navegar, medir, cortar, caminhar e destacar.
//
//  Carregado por import() dinâmico: nada disto baixa até alguém abrir um 3D.
// ============================================================================

let _libs=null;
export function libs(){
  if(_libs) return _libs;
  _libs = Promise.all([
    import('three'),
    import('@thatopen/fragments'),
    import('three/examples/jsm/controls/OrbitControls.js')
  ]).then(([THREE, FRAGS, oc])=>({ THREE, FRAGS, OrbitControls: oc.OrbitControls }))
    .catch(e=>{ _libs=null; throw e; });
  return _libs;
}
// Postprocessing (EffectComposer + SAO): só baixa quando alguém liga a sombra
// de contato — o pacote é grande e a maioria dos usos do 3D não precisa.
let _libsPos=null;
function libsPos(){
  if(_libsPos) return _libsPos;
  _libsPos = Promise.all([
    import('three/examples/jsm/postprocessing/EffectComposer.js'),
    import('three/examples/jsm/postprocessing/RenderPass.js'),
    import('three/examples/jsm/postprocessing/SAOPass.js'),
    import('three/examples/jsm/postprocessing/OutputPass.js')
  ]).then(([ec,rp,sao,op])=>({
    EffectComposer: ec.EffectComposer, RenderPass: rp.RenderPass,
    SAOPass: sao.SAOPass, OutputPass: op.OutputPass
  })).catch(e=>{ _libsPos=null; throw e; });
  return _libsPos;
}

// Linha grossa precisa de Line2: o `linewidth` do LineBasicMaterial é ignorado
// pela maioria das placas. Só baixa quando alguém usa o corte.
let _libsLinha=null;
function libsLinha(){
  if(_libsLinha) return _libsLinha;
  _libsLinha = Promise.all([
    import('three/examples/jsm/lines/LineSegments2.js'),
    import('three/examples/jsm/lines/LineSegmentsGeometry.js'),
    import('three/examples/jsm/lines/LineMaterial.js')
  ]).then(([a,b,c])=>({ LineSegments2:a.LineSegments2, LineSegmentsGeometry:b.LineSegmentsGeometry, LineMaterial:c.LineMaterial }))
    .catch(e=>{ _libsLinha=null; throw e; });
  return _libsLinha;
}

const LARANJA = 0xE8960A;
const SELECAO = 0x22D3EE;   // ciano — peça clicada DENTRO de um isolamento
// Cor da HACHURA de corte. Deve ser DENSA e ESCURA — a hachura tem função de
// leitura de projeto: mostra o "cheio" da peça atravessada pelo plano, então
// a peça precisa parecer sólida, não translúcida. Azul-marinho profundo é a
// convenção do Qonic (e do que se desenha em prancha de corte).
const HACHURA = 0x0B1E3E;

// ---------------------------------------------------------------------------
//  criar(): monta a cena vazia. carregar() traz os modelos depois — separados
//  de propósito, para a tela já reagir enquanto o download acontece.
// ---------------------------------------------------------------------------
export async function criar(cont, opts={}){
  const { THREE, FRAGS, OrbitControls } = await libs();

  const canvas = opts.canvas || (()=>{ const c=document.createElement('canvas');
    c.style.cssText='position:absolute;inset:0;width:100%;height:100%;outline:none';
    cont.appendChild(c); return c; })();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  // Sem mapeamento de tons a luz forte satura e o modelo "lava" — tudo branco
  // chapado, formas sumindo.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.fundo!=null ? opts.fundo : 0x2b3646);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  // O OrbitControls escala pan, zoom E órbita pela distância câmera↔alvo. Perto
  // do alvo essa distância tende a zero e tudo congela. zoomToCursor faz o zoom
  // perseguir o ponteiro (como o xeokit) e reancora o alvo à frente da câmera;
  // o piso de distância (posto em enquadrar) impede o colapso.
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.mouseButtons = { LEFT:THREE.MOUSE.ROTATE, MIDDLE:THREE.MOUSE.PAN, RIGHT:null };

  // Legibilidade das formas, não realismo: a hemisférica separa horizontal de
  // vertical sozinha; a principal dá relevo; a de preenchimento evita que o
  // lado escuro vire um borrão sem informação.
  // Ficam expostas em V.luzes p/ o painel de configuração poder mexer nelas.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7a8f, 1.25); scene.add(hemi);
  const ambiente = new THREE.AmbientLight(0xffffff, 0.30); scene.add(ambiente);
  const sol = new THREE.DirectionalLight(0xffffff, 1.55); sol.position.set(1,2.2,1.4); scene.add(sol);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.55); fill.position.set(-1.4,0.7,-1.1); scene.add(fill);

  const fragments = new FRAGS.FragmentsModels(await FRAGS.FragmentsModels.getWorker());
  // autoCoordinate (ligado por padrão) é o que ALINHA os modelos federados: eles
  // não compartilham um 0,0,0 cru no .frag — carregam a georreferência, e o
  // Fragments os coloca no mesmo referencial (recentrando pelo 1º modelo). Desligar
  // separa as disciplinas. Fica LIGADO. A cota real se obtém compensando o
  // recentro (fragments.baseCoordinates), não mexendo aqui — ver cotaZ.

  const V = {
    THREE, FRAGS, cont, canvas, renderer, scene, camera, controls, fragments,
    luzes: { hemi, ambiente, sol, fill },   // expostas p/ o painel de configuração
    modelos:[], vivo:true, raf:null, ro:null,
    caixa:null, unidade:1, niveis:null, porNivel:null,
    facesDuplas:true, _ultFaces:0,
    corte:  { ativo:false, ancora:null, normal:null, inv:false, plano:null, ajuda:null, arestas:null, mostrarAjuda:true },
    medida: { ativo:false, modo:'eixo', snapOn:true, medidas:[], pend:null, _seq:0 },
    andar:  { ativo:false, armado:false, nivel:0, yaw:0, pitch:0, pos:null,
              teclas:new Set(), camPos:null, camRot:null, alvo:null, ultUpd:0 },
    on: opts.on || {},          // { selecionar, medir, dica, pinos, nivel, modo, podeTeclado }
    _job:0
  };

  ligarEntrada(V);
  // Streaming/culling do Fragments SEGUE a câmera. Sem isto, ao orbitar/zoom com
  // vários modelos federados o culling fica congelado na posição anterior e peças
  // SOMEM durante o movimento. change = enquanto move (throttle); end = ao soltar.
  let _fragT=0;
  controls.addEventListener('change', ()=>{
    const now=performance.now();
    if(now-_fragT>120){ _fragT=now; try{ V.fragments.update().catch(()=>{}); }catch(_){} }
  });
  controls.addEventListener('end', ()=>{ try{ V.fragments.update(true).catch(()=>{}); }catch(_){} });
  V.ro = new ResizeObserver(()=> redimensionar(V));
  V.ro.observe(cont);
  laco(V);
  return V;
}

export async function carregar(V, modelos, msg){
  const aviso = msg || (()=>{});
  const meu = ++V._job;
  aviso(modelos.length>1 ? `Baixando ${modelos.length} modelos…` : 'Baixando modelo…');
  const baixados = await Promise.all(modelos.map(async m=>{
    return { m, bytes:await _baixar(m) };
  }));
  if(V._job!==meu || !V.vivo) return;
  for(const {m, bytes} of baixados){
    aviso(baixados.length>1 ? `Carregando ${m.nome||''}…` : 'Carregando modelo…');
    const model = await V.fragments.load(bytes, { modelId:(opts_id(V))+':'+(m.id||m.nome), camera:V.camera });
    if(V._job!==meu || !V.vivo) return;
    const w={ ...m, model, visivel:true, _bytes:(bytes&&bytes.byteLength)||0 };
    _ligarCor(V, w);
    V.modelos.push(w);
    V.scene.add(model.object);
  }
  redimensionar(V);
  enquadrar(V);
  _reposicionarGrade(V);   // baseCoordinates já existe após a carga
  aplicarFaces(V, true);
  await V.fragments.update(true);
  // Modelo carregado: só a partir daqui a sombra (SAO) e os pins entram — durante
  // a carga o render é DIRETO (rápido, sem o flood de INVALID_OPERATION) e os pins
  // não aparecem antes da geometria.  update(true) DISPARA a construção da malha,
  // mas ela sobe em quadros seguintes; 2 RAFs garantem que o laço desenhou o
  // modelo ao menos uma vez ANTES de liberarmos os pins (senão o pino aparece
  // sobre a tela ainda vazia).
  await _doisQuadros();
  if(V._job!==meu || !V.vivo) return;
  V._pronto = true;
}
function _doisQuadros(){ return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); }
// auriaBaixar (auria_busy.js) tenta de novo; sem ele, uma tentativa só.
async function _baixar(m){
  if(window.auriaBaixar) return window.auriaBaixar(()=>m.url(), m.nome);
  const resp = await fetch(await m.url());
  if(!resp.ok) throw new Error(`não consegui baixar "${m.nome||''}" (HTTP ${resp.status})`);
  return new Uint8Array(await resp.arrayBuffer());
}
let _seq=0; function opts_id(V){ return V._id || (V._id='v'+(++_seq)); }

// ── Carga incremental (adicionar/remover UM modelo sem recarregar os outros) ─
//  Padrão Solibri: marcar/desmarcar disciplina não reprocessa o resto. E
//  crítico: NÃO chama enquadrar() — quem já está posicionado numa parte da
//  cena mantém a mesma vista quando outra disciplina entra. Só a primeira
//  chamada (V.modelos vazio) enquadra, para o modelo aparecer no centro.
//  Vários modelos podem entrar ao mesmo tempo. Por isso aqui NÃO se incrementa
//  V._job: isso cancelava em silêncio todo modelo ainda baixando, e só o último
//  aparecia. V._job muda apenas em carregar()/descartar(), que trocam a cena.
//  O download é paralelo; a montagem, um modelo por vez (como em carregar()).
export function adicionarModelo(V, m, msg){
  const id = m.id||m.nome;
  if(V._guardados && V._guardados.has(id)) return recuperarUm(V, id);   // guardado: volta sem baixar
  V._entrando = V._entrando || new Map();
  if(V._entrando.has(id)) return V._entrando.get(id);   // pedido repetido: mesma carga
  const p = _adicionar(V, m, msg).finally(()=>V._entrando.delete(id));
  V._entrando.set(id, p);
  return p;
}
async function _adicionar(V, m, msg){
  const aviso = msg || (()=>{});
  const meu = V._job;
  aviso('Baixando '+(m.nome||'modelo')+'…');
  const bytes = await _baixar(m);
  if(V._job!==meu || !V.vivo) return null;
  const antes = V._filaCarga || Promise.resolve();
  let liberar; V._filaCarga = new Promise(r=>{ liberar=r; });
  await antes;
  try{ return await _montar(V, m, bytes, meu, aviso); }
  finally{ liberar(); }
}
async function _montar(V, m, bytes, meu, aviso){
  if(V._job!==meu || !V.vivo) return null;
  aviso('Carregando '+(m.nome||'modelo')+'…');
  const model = await V.fragments.load(bytes, {
    modelId: opts_id(V)+':'+(m.id||m.nome),
    camera: V.camera
  });
  if(V._job!==meu || !V.vivo){ try{ model.dispose(); }catch(_){} return null; }
  const wrapper = { ...m, model, visivel:true, _bytes:(bytes&&bytes.byteLength)||0 };
  _ligarCor(V, wrapper);
  const eraVazio = V.modelos.length === 0;
  V.modelos.push(wrapper);
  V.scene.add(model.object);
  aplicarFaces(V, true);
  redimensionar(V);
  // Só enquadra no PRIMEIRO modelo — nos subsequentes, preserva a câmera
  // atual do usuário (não teleporta a vista quando marca outra disciplina).
  if(eraVazio) enquadrar(V);
  if(eraVazio) _reposicionarGrade(V);   // 1º modelo define o baseCoordinates
  // Cache do raio-X fica obsoleto (a lista de peças mudou); descarta,
  // será refeito na próxima ativação.
  V._xrayReady = false; V._xrayCache = null;
  V.niveis=null; V._faixas=null; V.porNivel=null; V._storeys=null; V._boxCache=null; V._triCache=null; V._clashPt=null;   //novo modelo → recalcula níveis/pavimentos/caixas do clash
  try{ await V.fragments.update(true); }catch(_){}
  V._pronto = true;   // defensivo: qualquer caminho de carga libera pins/sombra
  // mantém a escolha de ocultar ambientes quando entra um modelo novo na federação
  if(V._espacosOn===false){ try{ await setEspacosVisiveis(V,false); }catch(_){} }
  return wrapper;
}
// ── Cor do modelo inteiro (escolhida na lista "Modelos na análise") ──────────
//  Dezenas de rotinas chamam model.resetHighlight() para limpar um destaque. Em
//  vez de mexer em cada uma, o wrapper embrulha highlight/resetHighlight: guarda
//  em x._extras as peças pintadas por cima da cor do modelo, e "limpar" devolve a
//  cor só a elas. Sem x.cor, as duas funções se comportam como as originais.
const _VIDRO_OPAC_COR=0.35;   // vidro muda de tom, mas continua transparente
function _ligarCor(V, x){
  const m=x.model, hl=m.highlight.bind(m), rs=m.resetHighlight.bind(m);
  x._hl=hl; x._rs=rs; x._extras=new Set();
  m.highlight=(ids,mat)=>{
    if(x.cor){ if(ids) for(const i of ids) x._extras.add(i); else x._tudo=true; }
    return hl(ids,mat);
  };
  m.resetHighlight=async ids=>{
    if(!x.cor) return rs(ids);
    if(x._tudo){ x._tudo=false; x._extras.clear(); await rs(); return _pintarBase(V,x); }
    const alvo=ids?[...ids]:[...x._extras];
    if(ids) alvo.forEach(i=>x._extras.delete(i)); else x._extras.clear();
    if(alvo.length) await _pintarBase(V,x,alvo);
  };
}
// Ambientes e aberturas ficam de fora: pintados, viram blocos opacos sobre o modelo.
async function _idsCor(x){
  if(!x._corIdsP) x._corIdsP=(async()=>{
    const m=x.model, todos=await m.getItemsIdsWithGeometry();
    const fora=new Set(Object.values(await m.getItemsOfCategories([/^IFCSPACE$/,/^IFCOPENINGELEMENT$/])||{}).flat());
    const vidro=new Set(await _idsVidro(x));
    return { todos, fora, vidro };
  })();
  return x._corIdsP;
}
async function _pintarBase(V, x, ids){
  const { todos, fora, vidro }=await _idsCor(x), T=V.THREE, cor=new T.Color(x.cor);
  const lista=ids||todos, sol=[], gl=[], sem=[];
  for(const i of lista){ if(fora.has(i)) sem.push(i); else (vidro.has(i)?gl:sol).push(i); }
  const op=(V._vidroOpac!=null && V._vidroOpac<1)?V._vidroOpac:_VIDRO_OPAC_COR;
  if(sem.length && ids) await x._rs(sem);
  if(sol.length) await x._hl(sol,{ color:cor, renderedFaces:1, opacity:1, transparent:false });
  if(gl.length) await x._hl(gl,{ color:cor, renderedFaces:1, opacity:op, transparent:true });
}
async function _aplicarCor(V, x){
  x._extras.clear(); x._tudo=false;
  await x._rs();
  if(x.cor) await _pintarBase(V,x);
  const mi=V.modelos.indexOf(x);
  if(V._colorido) for(const g of (V._cores||[])){   // cor de filtro fica por cima da cor do modelo
    const lids=g.porMod&&g.porMod[mi]; if(lids&&lids.length) await x.model.highlight(lids,{ color:new V.THREE.Color(g.cor), renderedFaces:1, opacity:1, transparent:false });
  }
  await _reaplicarVidroRapido(V);
  await V.fragments.update(true);
}
// cor = '#RRGGBB', ou null para voltar ao material do IFC.
export function corModelo(V, idBusca, cor){
  const x=V.modelos.find(y=>(y.arquivoId||y.id||y.nome)===idBusca); if(!x) return Promise.resolve(false);
  x.cor=cor||null;
  x._corFila=(x._corFila||Promise.resolve()).then(()=>_aplicarCor(V,x)).catch(e=>console.warn('cor do modelo:',e));
  return x._corFila;
}
// Peça clicada em modelo de tom alaranjado: o laranja da seleção não apareceria.
function _corSelecao(V, x){
  if(x&&x.cor){ const h={}; new V.THREE.Color(x.cor).getHSL(h); const d=Math.abs(h.h*360-37); if(Math.min(d,360-d)<25 && h.s>.3) return SELECAO; }
  return LARANJA;
}
// Remove um modelo específico da cena e libera memória.
export async function descarregarUm(V, idBusca){
  const i = V.modelos.findIndex(x => (x.arquivoId||x.id||x.nome) === idBusca);
  if(i<0) return;
  const x = V.modelos[i];
  V.modelos.splice(i, 1);
  try{ V.scene.remove(x.model.object); }catch(_){}
  // Espera soltar de verdade: update() com o modelo ainda saindo dá "Model not found".
  try{ await x.model.dispose(); }catch(_){}
  // Se a peça anterior de raio-X estava neste modelo, some junto.
  if(V._xrayUlt && V._xrayUlt.modelo === x) V._xrayUlt = null;
  // Se estava escondendo peça deste modelo, esquece.
  if(V._escondidos && V._escondidos.has(x)) V._escondidos.delete(x);
  V._xrayReady = false; V._xrayCache = null;
  V.niveis=null; V._faixas=null; V.porNivel=null; V._storeys=null; V._boxCache=null; V._triCache=null; V._clashPt=null;   //conjunto de lajes mudou → recalcula pavimentos/caixas do clash
  // Sem nenhum modelo, fragments.update(true) nunca termina e prende a fila de carga.
  if(V.modelos.length){ try{ await V.fragments.update(true); }catch(_){} }
}

// ── Guardar modelo (troca de análise, item 109b) ─────────────────────────────
//  Tira da cena SEM soltar a memória: voltar a ele (adicionarModelo com o mesmo
//  id) é instantâneo, sem baixar nem montar de novo. O teto é pelo tamanho do
//  .frag baixado; passou, solta o guardado há mais tempo. Nunca solta um modelo
//  que está na cena (V.modelos).
export const GUARDA_TETO = { bytes: 300*1024*1024, qtd: 6 };
export async function guardarUm(V, idBusca){
  const i = V.modelos.findIndex(x => (x.arquivoId||x.id||x.nome) === idBusca);
  if(i<0) return;
  const x = V.modelos[i];
  V.modelos.splice(i, 1);
  try{ V.scene.remove(x.model.object); }catch(_){}
  if(V._xrayUlt && V._xrayUlt.modelo === x) V._xrayUlt = null;
  if(V._escondidos && V._escondidos.has(x)) V._escondidos.delete(x);
  V._xrayReady = false; V._xrayCache = null;
  V.niveis=null; V._faixas=null; V.porNivel=null; V._storeys=null; V._boxCache=null; V._triCache=null; V._clashPt=null;
  V._guardados = V._guardados || new Map();
  V._guardados.delete(idBusca); V._guardados.set(idBusca, x);   // Map guarda a ordem: o 1º é o mais antigo
  await _guardaTeto(V);
  if(V.modelos.length){ try{ await V.fragments.update(true); }catch(_){} }
}
async function _guardaTeto(V){
  const G=V._guardados; if(!G) return;
  const soma=()=>{ let s=0; for(const x of G.values()) s+=x._bytes||0; return s; };
  while(G.size && (G.size>GUARDA_TETO.qtd || soma()>GUARDA_TETO.bytes)){
    const [id, x] = G.entries().next().value;
    G.delete(id);
    try{ await x.model.dispose(); }catch(_){}
  }
}
export async function recuperarUm(V, idBusca){
  const x = V._guardados && V._guardados.get(idBusca); if(!x) return null;
  V._guardados.delete(idBusca);
  const eraVazio = V.modelos.length === 0;
  x.visivel = true; try{ x.model.object.visible = true; }catch(_){}
  V.modelos.push(x);
  V.scene.add(x.model.object);
  aplicarFaces(V, true);
  redimensionar(V);
  if(eraVazio) enquadrar(V);
  V._xrayReady = false; V._xrayCache = null;
  V.niveis=null; V._faixas=null; V.porNivel=null; V._storeys=null; V._boxCache=null; V._triCache=null; V._clashPt=null;
  try{ await V.fragments.update(true); }catch(_){}
  V._pronto = true;
  if(V._espacosOn===false){ try{ await setEspacosVisiveis(V,false); }catch(_){} }
  return x;
}
export function guardadosInfo(V){
  const G=(V&&V._guardados)||new Map(); let bytes=0; for(const x of G.values()) bytes+=x._bytes||0;
  return { qtd:G.size, bytes, ids:[...G.keys()] };
}

export function descartar(V){
  if(!V) return;
  V.vivo=false; V._job++;
  if(V._guardados) V._guardados.clear();   // fragments.dispose() abaixo solta todos
  if(V.raf) cancelAnimationFrame(V.raf);
  if(V.ro){ try{ V.ro.disconnect(); }catch(_){} }
  limparMedidas(V); sumirArestas(V); sumirAjudaCorte(V);
  try{ V.controls.dispose(); }catch(_){}
  try{ V.fragments.dispose(); }catch(_){}
  try{ V.renderer.dispose(); V.renderer.forceContextLoss(); }catch(_){}
}

export function redimensionar(V){
  const w=V.cont.clientWidth||1, h=V.cont.clientHeight||1;
  V.renderer.setSize(w,h,false);
  if(V.composer) V.composer.setSize(w,h);           // senão a sombra fica na resolução antiga
  V.camera.aspect=w/h; V.camera.updateProjectionMatrix();
  if(V.corte.arestas) V.corte.arestas.traverse(o=>{ if(o.material&&o.material.resolution) o.material.resolution.set(w,h); });
}

export function enquadrar(V){
  const T=V.THREE;
  const cx=new T.Box3();
  V.modelos.forEach(x=>{ const b=x.model.box; if(b && !b.isEmpty()) cx.union(b); });
  if(cx.isEmpty()) return;
  const centro=cx.getCenter(new T.Vector3());
  const tam=cx.getSize(new T.Vector3());
  const raio=Math.max(tam.x,tam.y,tam.z)*0.5||1;
  const dist=(raio/Math.sin((V.camera.fov*Math.PI/180)/2))*1.35;
  V.caixa=cx; V.unidade=raio/150;
  V.camera.position.set(centro.x+dist*0.7, centro.y+dist*0.55, centro.z+dist*0.7);
  // A precisão do buffer de profundidade depende da razão far/near. Uma faixa
  // larga faz faces vizinhas alternarem qual fica na frente — o "piscar".
  V.camera.near=Math.max(raio/1000, 0.05);
  V.camera.far =Math.max(raio*8, dist*2.5);
  V.camera.updateProjectionMatrix();
  V.controls.target.copy(centro);
  // minDistance BAIXO (2 cm) para o dolly conseguir cruzar paredes finas
  // quando o pivô está posto 0,5 m atrás da superfície (ver pivotarCentro).
  // Sem isso, controls trava a câmera antes de ela cruzar a parede.
  V.controls.minDistance=Math.max(raio/5000, 0.02);
  V.controls.maxDistance=raio*20;
  V.controls.update();
  V.fragments.update(true).catch(()=>{});
  // Refaz a grade com o tamanho novo da caixa se ela estiver ligada.
  if(V._gradeOn) visualGrade(V, true);
  // O saoScale depende do camera.far; sem reajustar, o efeito da sombra some
  // (ficou fraco demais) ou fica preto demais quando trocamos o zoom base.
  if(V.sao && V.sao.__razao) V.sao.params.saoScale = V.camera.far * V.sao.__razao;
}

// Enquadra a câmera numa CAIXA qualquer (zoom-extend de uma seleção). Mais leve
// que enquadrar(): não mexe em V.caixa/grade/sombra — só reposiciona a câmera.
function _fitBox(V, cx){
  const T=V.THREE;
  if(!cx || cx.isEmpty()) return;
  const centro=cx.getCenter(new T.Vector3());
  const tam=cx.getSize(new T.Vector3());
  const raio=Math.max(tam.x,tam.y,tam.z)*0.5||0.5;
  const dist=(raio/Math.sin((V.camera.fov*Math.PI/180)/2))*1.4;
  V.camera.position.set(centro.x+dist*0.7, centro.y+dist*0.55, centro.z+dist*0.7);
  const modeloDiag = V.caixa ? V.caixa.getSize(new T.Vector3()).length() : dist*4;
  // O far cobre o resto do modelo (não clipa ao isolar); o near é DERIVADO do far
  // com razão presa em 8000 (igual ao enquadrar()) — antes o near saía do raio da
  // seleção e a razão far/near estourava, causando z-fighting (piscar/fantasma).
  V.camera.far =Math.max(raio*50, dist*4, modeloDiag*1.2);
  V.camera.near=Math.max(V.camera.far/8000, 0.02);
  V.camera.updateProjectionMatrix();
  V.controls.target.copy(centro);
  V.controls.minDistance=Math.max(raio/5000, 0.02);
  V.controls.update();
  V.fragments.update(true).catch(()=>{});
}
// Zoom-extend nos ids dados (por modelo). Poucos → perto; muitos/espalhados →
// mostra todos. Chamado automaticamente ao isolar.
export async function enquadrarIds(V, porMod){
  const T=V.THREE; const cx=new T.Box3();
  for(const [mi,ids] of Object.entries(porMod||{})){
    const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue;
    let boxes=[]; try{ boxes=await x.model.getBoxes(ids); }catch(_){}
    (boxes||[]).forEach(b=>{ if(b&&isFinite(b.min.x)) cx.union(new T.Box3(new T.Vector3(b.min.x,b.min.y,b.min.z), new T.Vector3(b.max.x,b.max.y,b.max.z))); });
  }
  if(!cx.isEmpty()) _fitBox(V, cx);
}
// Enquadra um PONTO com folga r (m) — p/ o clash: a peça inteira (viga longa)
//  deixava o conflito num risquinho; aqui a câmera vai ao cruzamento.
export function enquadrarPonto(V, p, r){
  const T=V.THREE; if(!p) return; r=r||1.5;
  _fitBox(V, new T.Box3(new T.Vector3(p.x-r,p.y-r,p.z-r), new T.Vector3(p.x+r,p.y+r,p.z+r)));
}
export async function enquadrarSelecao(V){ if(V._ultimaSelecao) await enquadrarIds(V, V._ultimaSelecao); }
// FUNDO e GRADE são configurações INDEPENDENTES agora. Antes ligar a grade
// exigia trocar o fundo — os dois eram um par. Ficou artificial: quem quer
// ver o piso pode preferir o modo escuro; quem quer o modo claro pode
// preferir sem o piso, para o modelo respirar mais.
export function visualFundo(V, modo){
  const T=V.THREE;
  V._fundo = modo==='claro' ? 'claro' : 'escuro';
  V.scene.background = new T.Color(V._fundo==='claro' ? 0xF1F5F9 : 0x0F1117);
  // A grade vive presa ao fundo (as cores dependem dele), então se estiver
  // ligada, refaz.
  if(V._grade) visualGrade(V, true);
  V.fragments.update(true).catch(()=>{});
}
// Compatibilidade com quem ainda chama visualEstilo('claro'|'escuro') — troca
// o fundo E liga a grade se o modo for claro (era o comportamento antigo).
export function visualEstilo(V, modo){
  visualFundo(V, modo);
  visualGrade(V, modo==='claro');
}
export function visualGrade(V, lig){
  const T=V.THREE;
  V._gradeOn = !!lig;
  if(V._grade){ try{ V.scene.remove(V._grade);
    V._grade.traverse(o=>{ if(o.geometry)o.geometry.dispose(); if(o.material)o.material.dispose(); }); }catch(_){} V._grade=null; }
  if(V._gradeOn){
    const claro = V._fundo!=='escuro';   // 'claro' é o padrão para compat
    // "Plano infinito" na prática: grade GIGANTE em relação ao modelo, com
    // uma malha crua (célula de 5 m; a cada 5ª linha uma marcação grossa a
    // 25 m). O que torna a sensação de infinito é o FADE radial no shader —
    // as arestas somem antes de a borda física da grade aparecer. Sem o
    // fade, uma grade grande mostra a linha do horizonte e denuncia o
    // tamanho.
    const b = V.caixa;
    const raio = b ? Math.max(b.getSize(new T.Vector3()).x, b.getSize(new T.Vector3()).z) : 20;
    const lado = Math.max(2000, Math.ceil(raio*40));   // >= 2 km
    const passo = 5;                                    // 5 m por célula
    const divs  = Math.round(lado/passo);
    // Cores duas tonalidades acima do fundo — no claro (bg 0xF1F5F9) fica
    // levemente azul-cinza; no escuro (bg 0x0F1117) fica levemente cinza
    // azulado. Nos dois casos a grade "sussurra": só se percebe se você
    // olhar para procurar. Sem distinção forte entre linhas comuns e
    // mestras — numa referência de fundo, contraste extra vira ruído.
    // Espessura fica fixa em 1 px em qualquer GPU (linewidth do
    // LineBasicMaterial é ignorado), então o único jeito de "afinar" é
    // baixar o contraste.
    const cComum = claro ? 0xE0E6EE : 0x1D2331;
    const cMestre= claro ? 0xE6EBF1 : 0x252C3B;
    const grade = new T.GridHelper(lado, divs, cMestre, cComum);
    // Fade radial: a opacidade cai com a distância ao centro da grade, então
    // a beira nunca aparece. Feito por onBeforeCompile para reaproveitar o
    // material do GridHelper (LineBasicMaterial) sem reinventá-lo.
    const mat = grade.material;
    mat.transparent = true;
    mat.depthWrite = false;
    // Opacidade base baixa — a grade fica só um sussurro sobre o fundo.
    // O shader multiplica esta alpha pelo fade radial, então a beira some
    // ainda mais rápido. No fundo escuro, um pouco mais alta porque cores
    // escuras sobre fundo escuro somem mais rápido que claras sobre claro.
    mat.opacity = claro ? 0.55 : 0.75;
    // A grade é referência: não deve variar de tom quando o ACES tonemap
    // reage à luz da cena. Sem isto, com o modelo iluminado por sol forte,
    // as linhas cinzas ganham matiz alaranjado.
    mat.toneMapped = false;
    mat.onBeforeCompile = (shader)=>{
      shader.uniforms.uRaio = { value: lado*0.5 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>','#include <common>\nvarying vec2 vXZ;')
        .replace('#include <project_vertex>','#include <project_vertex>\nvXZ = position.xz;');
      // O hook correto neste three (0.185) é <opaque_fragment>. O nome antigo
      // (<output_fragment>) não existe mais e o .replace() sem match falha
      // em silêncio — a grade compilava, mas sem o fade, e a borda física da
      // malha aparecia.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>','#include <common>\nvarying vec2 vXZ;\nuniform float uRaio;')
        .replace('#include <opaque_fragment>',
          'float _fd = length(vXZ)/uRaio;\n'+
          'float _fa = 1.0 - smoothstep(0.55, 0.95, _fd);\n'+   // fade suave dos 55% até 95% do raio
          'diffuseColor.a *= _fa;\n'+
          '#include <opaque_fragment>');
    };
    // Sempre em Z=0 do MODELO (o "zero" do IFC/projeto, que aqui é Y do
    // three porque Fragments converte Z-up→Y-up). Antes eu colocava no piso
    // da caixa (min.y), o que fazia a grade "subir" no meio de subsolos e
    // ficar acima do térreo. O -0.005 evita z-fighting com uma laje que
    // esteja exatamente em cota zero. Com autoCoordinate LIGADO, a cota 0 do projeto
    // fica em baseCoordinates[1] no MUNDO (recentro do Fragments) — a malha vai lá.
    grade.position.y = _cotaOffsetBase(V) - 0.005;
    grade.renderOrder = -1;    // sempre atrás do modelo
    V._grade = grade; V.scene.add(grade);
  }
  V.fragments.update(true).catch(()=>{});
}

// ── Ajustes finos de renderização (para o painel de configuração) ──────────
//  Todos os setters escrevem no OBJETO vivo da cena (renderer/luzes) — o laço
//  de render pega a mudança no próximo quadro. Nenhum re-carrega modelo.
export function setExposicao(V, n){       V.renderer.toneMappingExposure = +n; }
export function setLuzAmbiente(V, n){     V.luzes.hemi.intensity          = +n; }
export function setLuzSol(V, n){          V.luzes.sol.intensity  = +n;
                                          V.luzes.fill.intensity = +n * 0.35; }   // fill sempre 35% do sol
export function setFacesDuplas(V, on){
  V.facesDuplas = !!on;
  aplicarFaces(V, true);   // re-percorre os materiais agora, não espera o gate de 600ms
}
export function setAltaQualidade(V, on){
  try{ V.fragments.settings.graphicsQuality = on ? 1 : 0; }catch(_){}
  V.fragments.update(true).catch(()=>{});
}
// Restaura os padrões (mesmos números do criar()).
export function restaurarPadroes(V){
  setExposicao(V, 1.15);
  setLuzAmbiente(V, 1.25);
  setLuzSol(V, 1.55);
  setFacesDuplas(V, true);
  setAltaQualidade(V, false);
  setSombra(V, false).catch(()=>{});
  setSombraIntensidade(V, 6);
  setSombraAlcance(V, 50);
  setSombraAmostras(V, 16);
}

// ── Sombra de contato (SAO) ───────────────────────────────────────────────
//  Não é sombra de sol nem GI: é ambient occlusion — escurece os cantos
//  onde a luz não chega. Serve para dar CONTRASTE num render que fica
//  achatado com iluminação uniforme. Custo real: mais uma passada de pós
//  por quadro; se ficar pesado, desliga aqui.
//
//  A cadeia (composer + passes) é montada só na PRIMEIRA vez que alguém
//  liga — antes disso o módulo nem baixa esses arquivos.
export async function setSombra(V, lig){
  if(!lig){ V.ao = false; return; }
  if(!V.composer){
    const { EffectComposer, RenderPass, SAOPass, OutputPass } = await libsPos();
    if(!V.vivo) return;
    const comp = new EffectComposer(V.renderer);
    comp.addPass(new RenderPass(V.scene, V.camera));
    const sao = new SAOPass(V.scene, V.camera);
    sao.params.saoBlur       = true;
    sao.params.saoBlurRadius = 6;
    // saoKernelRadius é em PIXELS de tela (kernelRadius/size no shader),
    // então vale igual em qualquer modelo.
    sao.params.saoKernelRadius = 50;
    sao.params.saoIntensity    = 0.06;
    // saoScale NÃO é absoluto: o shader usa scale/cameraFar, e o far sai
    // do tamanho do modelo. Um número fixo dá efeito nenhum num prédio e
    // quase preto numa peça. Acompanha o far — razão medida em teste.
    sao.__razao        = 0.024;
    sao.params.saoScale = V.camera.far * sao.__razao;
    // Anti-oclusão do plano de piso: o SAO calcula AO a partir da profundidade
    // de TUDO na cena, então uma parede em cima da malha projeta escuridão
    // sobre ela — usuário vê a grade "manchada". Como a "beauty" (RenderPass,
    // que vem ANTES) já rodou com a grade visível, basta escondê-la nos
    // passes internos do SAO (depth/normal): a AO ali resulta em zero para
    // os pixels da grade, e a beauty passa intacta. Modelo continua ganhando
    // AO normalmente porque a grade estava lá fora nesses passes.
    const origSaoRender = sao.render.bind(sao);
    sao.render = function(){
      const g = V._grade, wasVis = g && g.visible;
      if(g) g.visible = false;
      try{ return origSaoRender.apply(this, arguments); }
      finally{ if(g) g.visible = wasVis; }
    };
    comp.addPass(sao);
    comp.addPass(new OutputPass());
    comp.setSize(V.cont.clientWidth||1, V.cont.clientHeight||1);
    V.composer = comp; V.sao = sao;
  }
  V.ao = true;
}
export function setSombraIntensidade(V, n){   // slider 1..40, valor real = n/100
  if(V.sao) V.sao.params.saoIntensity = (+n)/100;
}
export function setSombraAlcance(V, n){       // pixels de tela, 10..140
  if(V.sao) V.sao.params.saoKernelRadius = +n;
}
export function setSombraAmostras(V, n){      // 4..32 (é #define no shader → recompila)
  if(!V.sao) return;
  try{
    V.sao.saoMaterial.defines.NUM_SAMPLES = +n;
    V.sao.saoMaterial.needsUpdate = true;
  }catch(_){}
}
// Opacidade do VIDRO (janelas/cortina/painéis). opac 0..1; 1 = normal (reset).
// Identificado por CLASSE (rápido, sem ler Pset) — mais confiável que "VID" no
// nome. Guarda em V._vidroOpac p/ reaplicar (ex.: após federar outro modelo).
const _VIDRO_CLS=[/^IFCWINDOW$/,/^IFCCURTAINWALL$/,/^IFCPLATE$/];
// Descobre (uma vez) os ids do vidro de UM modelo e cacheia em x._vidroIds. Usa
// uma PROMISE compartilhada (x._vidroIdsP) p/ que arrastar o slider — que dispara
// várias chamadas concorrentes — não recompute nem estoure em corrida: todas
// esperam o MESMO cálculo.
async function _idsVidro(x){
  if(x._vidroIds) return x._vidroIds;
  if(!x._vidroIdsP){
    x._vidroIdsP = x.model.getItemsOfCategories(_VIDRO_CLS)
      .then(o=>Object.values(o||{}).flat()).catch(()=>[]);
  }
  x._vidroIds = await x._vidroIdsP;
  return x._vidroIds;
}
export async function setVidroOpacidade(V, opac){
  V._vidroOpac = opac;
  for(const x of V.modelos){
    const ids = await _idsVidro(x); if(!ids || !ids.length) continue;
    try{ if(opac>=1) await x.model.resetOpacity(ids); else await x.model.setOpacity(ids, opac); }catch(_){}
  }
  try{ await V.fragments.update(true); }catch(_){}
}
// Reaplica a opacidade do vidro que estava setada (chamar após federar/carregar).
// Modelos novos ainda não têm _vidroIds → _idsVidro os computa; os já cacheados
// só reaplicam o setOpacity.
export async function reaplicarVidro(V){ if(V._vidroOpac!=null && V._vidroOpac<1) await setVidroOpacidade(V, V._vidroOpac); }
// Reaplicação RÁPIDA (sem varrer categorias): usa os ids já cacheados. Chamada
// ao fim de operações que resetam a opacidade global (destacar/isolar/reexibir).
// NÃO chama fragments.update — quem chamou já vai atualizar. No-op se o vidro
// está no padrão (>=1) ou se nunca foi setado.
export async function _reaplicarVidroRapido(V){
  if(V._vidroOpac==null || V._vidroOpac>=1) return;
  for(const x of V.modelos){
    const ids=x._vidroIds; if(!ids || !ids.length) continue;
    try{ await x.model.setOpacity(ids, V._vidroOpac); }catch(_){}
  }
}

// Tubo e duto de alguns exportadores são CASCA (superfície sem espessura). Com
// descarte de face traseira, de dentro a face some e a peça aparece pela
// metade. Barato: o Fragments compartilha materiais entre tiles.
export function aplicarFaces(V, forcar){
  const agora=performance.now();
  if(!forcar && agora-(V._ultFaces||0) < 600) return;
  V._ultFaces=agora;
  const lado = (V.facesDuplas!==false) ? V.THREE.DoubleSide : V.THREE.FrontSide;
  const vistos=new Set();
  let mudou=false;
  V.modelos.forEach(x=>{ try{
    x.model.object.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        if(!mm||vistos.has(mm.uuid)) return;
        vistos.add(mm.uuid);
        if(mm.side!==lado){ mm.side=lado; mm.needsUpdate=true; mudou=true; }
      });
    });
  }catch(_){} });
  // needsUpdate = o three vai RECOMPILAR o material neste quadro. É justamente
  // isso que corrompe o composer (SAO) → uniform vai pro programa errado. Marca
  // pro laço dar UM resetState neste quadro. Só nos quadros com tile novo (raro
  // depois que assenta), não a cada frame — mantém rápido e sem o INVALID_OPERATION.
  if(mudou) V._forcaReset=true;
}

function laco(V){
  let tAnt=performance.now();
  const passo=()=>{
    if(!V.vivo) return;
    V.raf=requestAnimationFrame(passo);
    if(V.pausado){ tAnt=performance.now(); return; }   // 3D guardado fora da tela (troca de análise): não desenha
    const agora=performance.now();
    const dt=Math.min((agora-tAnt)/1000, 0.1); tAnt=agora;   // aba em 2º plano daria dt enorme
    if(V.andar.ativo) andarQuadro(V, dt); else V.controls.update();
    escalarMarcas(V);
    aplicarFaces(V);
    // Se a sombra está ligada, o composer renderiza (RenderPass + SAO + Output);
    // senão o render direto do renderer é mais barato por quadro.
    //
    // resetState() SÓ NA TRANSIÇÃO: o problema é ALTERNAR render direto com o
    // composer no mesmo contexto — o direto deixa o estado do WebGL num programa
    // que o composer não espera e todo frame passa a dar "location is not from
    // the associated program" (contexto só sara com reload). Limpar o estado
    // religa programa/uniforms do zero. MAS chamar isso TODO quadro re-sobe os
    // programas de todos os modelos federados → frames de 300ms+, tela preta.
    // Então só reseta quando o modo muda (direto→composer) ou após um render
    // fora do laço (print marca V._forcaReset). Em regime estável (sempre
    // composer) não reseta = rápido.
    const usaComp = !!(V.ao && V.composer && V._pronto);   // SAO só depois do load
    if(usaComp){
      if(V._ultModoComp !== true || V._forcaReset){ V.renderer.resetState?.(); V._forcaReset=false; }
      V.composer.render();
    } else {
      V.renderer.render(V.scene, V.camera);
    }
    V._ultModoComp = usaComp;
    atualizarCotas(V);
    if(V.on.pinos) V.on.pinos(V);
  };
  passo();
}

// ── Reancoragem do alvo: o que destrava pan e zoom de perto ────────────────
//  Com zoomToCursor o three põe o alvo a centímetros da câmera, e como pan e
//  zoom escalam por essa distância, o passo vira quase zero. O raio sai do
//  CENTRO da tela porque update() termina com lookAt(alvo): alvo fora do eixo
//  giraria a câmera sozinha.
export async function pivotarCentro(V){
  const r=V.canvas.getBoundingClientRect();
  const hit=await raycast(V, { clientX:r.left+r.width/2, clientY:r.top+r.height/2 });
  if(!V.vivo) return;
  const dir=new V.THREE.Vector3(); V.camera.getWorldDirection(dir);
  if(!hit || !(hit.distance>0)){
    // Olhando o vazio: sem onde ancorar, mas o alvo não pode ficar colado na
    // câmera (zoom travado). Afasta até um piso na escala do modelo.
    const piso=V.controls.maxDistance/600;
    if(piso>0 && piso<Infinity && V.camera.position.distanceTo(V.controls.target) < piso)
      V.controls.target.copy(V.camera.position).addScaledVector(dir, piso);
    return;
  }
  // Empurra o alvo 0,5 m para ALÉM da superfície atingida. Sem isso, o
  // dolly da OrbitControls não consegue cruzar parede/vidro — o zoom
  // aproxima câmera do alvo mas nunca cruza, e o alvo estaria EM CIMA
  // da superfície. Com o alvo atrás, o dolly avança e a câmera passa.
  V.controls.target.copy(V.camera.position).addScaledVector(dir, hit.distance + 0.5);
}

export async function raycast(V, ev){
  const mouse=new V.THREE.Vector2(ev.clientX, ev.clientY);
  let melhor=null;
  for(const x of V.modelos){
    if(x.visivel===false) continue;
    try{
      const r=await x.model.raycast({ camera:V.camera, mouse, dom:V.canvas });
      if(r && (!melhor || r.distance<melhor.distance)){ r.__modelo=x; melhor=r; }
    }catch(_){}
  }
  return melhor;
}
// Como o raycast, mas devolve TODOS os hits ao longo do raio, ordenados por
// distância. Usado pelo raio-X quando o usuário pede profundidade (ver a
// segunda peça, terceira, etc.). Cada modelo entrega sua lista; agregamos e
// ordenamos aqui.
export async function raycastAll(V, ev){
  const mouse=new V.THREE.Vector2(ev.clientX, ev.clientY);
  const todos=[];
  for(const x of V.modelos){
    if(x.visivel===false) continue;
    try{
      const rs=await x.model.raycastAll({ camera:V.camera, mouse, dom:V.canvas });
      (rs||[]).forEach(r=>{ if(r){ r.__modelo=x; todos.push(r); } });
    }catch(_){}
  }
  todos.sort((a,b)=> (a.distance||0) - (b.distance||0));
  return todos;
}

// ── Entrada (mouse/teclado) ────────────────────────────────────────────────
function ligarEntrada(V){
  const el=V.canvas;
  let dn=null, olhar=null, pivoT=0, pivoOcup=false;
  const pedirPivo=(forcar)=>{
    const agora=Date.now();
    if(!forcar && (pivoOcup || agora-pivoT<200)) return;
    pivoT=agora; pivoOcup=true;
    pivotarCentro(V).catch(()=>{}).then(()=>{ pivoOcup=false; });
  };
  el.addEventListener('wheel', ()=> pedirPivo(false), { passive:true });
  // Toque (celular): a pinça é o "wheel" do dedo — sem reancorar durante ela o
  // zoom encolhe a distância até o piso e para de andar perto do modelo. E a
  // órbita (2π por altura da tela) fica rápida demais numa tela de ~600 px:
  // dedo gira com ~45% e a inércia acaba mais cedo; mouse volta ao padrão.
  const dedos=new Set();
  el.addEventListener('pointerdown', (e)=>{
    const toque=e.pointerType==='touch';
    V.controls.rotateSpeed   = toque ? 0.45 : 1;
    V.controls.dampingFactor = toque ? 0.12 : 0.05;
    if(!toque) return;
    dedos.add(e.pointerId);
    if(dedos.size===2) pedirPivo(true);
  });
  el.addEventListener('pointermove', (e)=>{ if(e.pointerType==='touch' && dedos.size>=2) pedirPivo(false); });
  el.addEventListener('pointerup',     (e)=> dedos.delete(e.pointerId));
  el.addEventListener('pointercancel', (e)=> dedos.delete(e.pointerId));

  el.addEventListener('pointerdown', (e)=>{
    if(e.button===1){
      if(V.andar.ativo){ olhar={x:e.clientX,y:e.clientY}; e.preventDefault();
        try{ el.setPointerCapture(e.pointerId); }catch(_){}
      } else pedirPivo(true);
      return;
    }
    if(e.button!==0){ dn=null; return; }
    dn={ x:e.clientX, y:e.clientY, ux:e.clientX, uy:e.clientY, t:Date.now(), arrastou:false };
  });
  el.addEventListener('pointerup', (e)=>{ if(e.button===1) olhar=null; });
  el.addEventListener('pointercancel', ()=>{ olhar=null; });

  el.addEventListener('pointermove', (e)=>{
    if(olhar && V.andar.ativo){
      const W=V.andar;
      W.yaw   -= (e.clientX-olhar.x)*0.005;
      W.pitch  = Math.max(-1.35, Math.min(1.35, W.pitch-(e.clientY-olhar.y)*0.005));
      olhar.x=e.clientX; olhar.y=e.clientY;
      andarAplicar(V);
      return;
    }
    if(!dn) return;
    if(V.andar.ativo) return;
    if(!(V.corte.ativo && V.corte.ancora)) return;
    const dx=e.clientX-dn.ux, dy=e.clientY-dn.uy;
    if(!dn.arrastou && Math.abs(e.clientX-dn.x)<3 && Math.abs(e.clientY-dn.y)<3) return;
    dn.arrastou=true; dn.ux=e.clientX; dn.uy=e.clientY;
    corteArrastar(V, dx, dy);
  });

  el.addEventListener('dblclick', (e)=>{
    raycast(V,e).then(hit=>{
      if(!V.vivo||!hit||!hit.point) return;
      V.controls.target.copy(hit.point); V.controls.update();
      V.fragments.update(true).catch(()=>{});
    }).catch(()=>{});
  });

  el.addEventListener('pointerup', (e)=>{
    if(!dn) return;
    const perto=Math.abs(e.clientX-dn.x)<4 && Math.abs(e.clientY-dn.y)<4;
    const rapido=(Date.now()-dn.t)<500;
    const arrastou=dn.arrastou; dn=null;
    if(arrastou && V.corte.ativo && V.corte.ancora) corteArestas(V).catch(()=>{});
    if(!V.vivo || arrastou || !perto || !rapido) return;
    if(V.andar.armado){
      raycast(V,e).then(h=>{ if(h&&h.point) entrarAndar(V,h.point); else dica(V,'Clique sobre o piso do modelo.'); }).catch(()=>{});
      return;
    }
    if(V.medida.ativo){ medirPonto(V,e).catch(()=>{}); return; }
    if(V.corte.ativo){
      if(V.corte.ancora) return;
      raycast(V,e).then(h=>{ if(h&&h.point) cortePor(V,h.point,h.normal); else dica(V,'Clique numa superfície do modelo.'); }).catch(()=>{});
      return;
    }
    if(V.on.selecionar) V.on.selecionar(V, e);
  });

  V._key=(e,apert)=>{
    if(!V.andar.ativo) return;
    if(V.on.podeTeclado && !V.on.podeTeclado()) return;
    const k=e.key.toLowerCase();
    const mapa={ w:'w',a:'a',s:'s',d:'d',arrowup:'w',arrowdown:'s',arrowleft:'a',arrowright:'d',shift:'shift' };
    const m=mapa[k];
    if(m){ apert ? V.andar.teclas.add(m) : V.andar.teclas.delete(m); e.preventDefault(); return; }
    if(!apert) return;
    if(k==='pageup')   { irNivel(V, V.andar.nivel+1); e.preventDefault(); }
    if(k==='pagedown') { irNivel(V, V.andar.nivel-1); e.preventDefault(); }
    if(k==='escape')   modoAndar(V, false);
  };
  V._kd=(e)=>V._key(e,true); V._ku=(e)=>V._key(e,false);
  document.addEventListener('keydown', V._kd);
  document.addEventListener('keyup',   V._ku);
}
function dica(V,t){ if(V.on.dica) V.on.dica(t); }

// ── Pavimentos (por filtro, sob demanda) ───────────────────────────────────
//  NÃO é chamado na abertura de propósito: percorre a caixa de todos os
//  elementos de todos os modelos e travava o carregamento do federado.
export async function niveis(V){
  if(V.niveis) return V.niveis;
  const tops=[];
  for(const x of V.modelos){
    try{
      const cats=await x.model.getItemsOfCategories([/^IFCSLAB$/]);
      const ids=Object.values(cats||{}).flat();
      if(!ids.length) continue;
      const cxs=await x.model.getBoxes(ids);
      (cxs||[]).forEach(c=>{ if(c && isFinite(c.max.y)) tops.push(c.max.y); });
    }catch(_){}
  }
  tops.sort((a,b)=>a-b);
  let g=[]; const tol=0.6;
  tops.forEach(y=>{ const u=g[g.length-1];
    if(u && Math.abs(y-u.soma/u.n)<=tol){ u.soma+=y; u.n++; } else g.push({soma:y,n:1}); });
  g=g.filter(x=>x.n>=2);
  if(!g.length) g=[{soma:(V.caixa?V.caixa.min.y:0), n:1}];
  // Pé-direito não é menor que ~2,2m: grupos mais próximos que isso são o MESMO
  // pavimento (laje + rebaixo). Fica o de mais caixas, que é a laje de piso.
  const fund=[];
  g.map(x=>({y:x.soma/x.n,n:x.n})).sort((a,b)=>a.y-b.y).forEach(nv=>{
    const u=fund[fund.length-1];
    if(u && (nv.y-u.y)<2.2){ if(nv.n>u.n){ u.y=nv.y; u.n=nv.n; } } else fund.push(nv);
  });
  V.niveis=fund.map(x=>x.y);
  return V.niveis;
}
export async function mapearPavimentos(V, msg){
  if(V.porNivel) return V.porNivel;
  const ns=await niveis(V);
  if(msg) msg('Separando por pavimento…');
  const doNivel=(y)=>{ let i=0; for(let k=0;k<ns.length;k++){ if(ns[k]<=y+0.01) i=k; } return i; };
  V.porNivel=[];
  for(const x of V.modelos){
    const mapa=new Map();
    try{
      const cats=await x.model.getItemsOfCategories([/./]);
      for(const [cat, ids] of Object.entries(cats||{})){
        if(!ids||!ids.length) continue;
        // Laje pelo TOPO: ela É o piso do nível. Pelo centro cairia no
        // pavimento de baixo e o andar apareceria sem piso.
        const ehLaje=/^IFC(SLAB|ROOF)$/.test(cat);
        const cxs=await x.model.getBoxes(ids);
        (cxs||[]).forEach((c,i)=>{
          if(!c||c.isEmpty()) return;
          const y=ehLaje ? c.max.y : (c.min.y+c.max.y)/2;
          const k=doNivel(y);
          (mapa.get(k) || mapa.set(k,[]).get(k)).push(ids[i]);
        });
      }
    }catch(_){}
    V.porNivel.push(mapa);
  }
  return V.porNivel;
}
export async function filtrarPavimentos(V, sel){
  if(!V.porNivel) return;
  const tudo=!sel||!sel.size;
  for(let i=0;i<V.modelos.length;i++){
    const x=V.modelos[i], mapa=V.porNivel[i];
    try{
      if(tudo){ await x.model.setVisible(undefined,true); continue; }
      await x.model.setVisible(undefined,false);
      for(const k of sel){ const ids=mapa.get(k); if(ids&&ids.length) await x.model.setVisible(ids,true); }
    }catch(_){}
  }
  try{ await V.fragments.update(true); }catch(_){}
  // Se há corte ativo, refaz a seção com o novo conjunto visível — sem isto,
  // trocar de pavimento com o corte ligado ainda mostra fills antigos.
  if(V.corte && V.corte.plano) corteArestas(V).catch(()=>{});
}

// ── Transparência (ver o que está atrás) ───────────────────────────────────
// ── Ambientes (IfcSpace) ───────────────────────────────────────────────────
//  IfcSpace é o volume do ambiente: vem como caixa fechada e tapa o modelo
//  inteiro quando o exportador o inclui. Aqui ele pode ser desligado — e o
//  estado fica no visualizador (V._espacosOn) para valer também nos modelos
//  carregados depois (federação).
export async function setEspacosVisiveis(V, lig){
  V._espacosOn = !!lig;
  for(const x of V.modelos){
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories([/^IFCSPACE$/i])||{}).flat(); }catch(_){}
    if(ids.length){ try{ await x.model.setVisible(ids, !!lig); }catch(_){} }
  }
  try{ await V.fragments.update(true); }catch(_){}
}
// Quantos ambientes existem na cena (0 = o modelo não tem IfcSpace, a opção some da UI).
export async function contarEspacos(V){
  let n=0;
  for(const x of (V&&V.modelos)||[]){
    try{ n += Object.values(await x.model.getItemsOfCategories([/^IFCSPACE$/i])||{}).flat().length; }catch(_){}
  }
  return n;
}
export async function transparente(V, modelo, ids, valor){
  try{ await modelo.model.setOpacity(ids, valor); await V.fragments.update(true); }catch(_){}
}
export async function limparTransparencia(V){
  for(const x of V.modelos){ try{ await x.model.resetOpacity(undefined); }catch(_){} }
  try{ await V.fragments.update(true); }catch(_){}
}

// ── Destaque ───────────────────────────────────────────────────────────────
// ── Marcadores "raio-X" do destaque ────────────────────────────────────────
//  Caixas laranja translúcidas na posição de cada elemento alvo, com material
//  NOSSO (depthTest:false → atravessam parede). Uma única InstancedMesh guarda
//  todas — leve mesmo com centenas. Não toca na config do Fragments, então não
//  estoura memória. É o que dá o "ver onde estão" através do prédio.
export function limparMarcas(V){
  if(V._marcasDestaque){ try{ V.scene.remove(V._marcasDestaque);
    V._marcasDestaque.geometry.dispose(); V._marcasDestaque.material.dispose(); }catch(_){}
    V._marcasDestaque=null; }
}
export async function marcarIds(V, porMod){
  limparMarcas(V);
  const T=V.THREE; const caixas=[];
  // getBoxes do Fragments VARIA com os tiles carregados: uma peça ainda não
  // streamada devolve caixa fora do prédio (marca laranja flutuando no vazio).
  // Guarda: só aceita caixas cujo CENTRO cai dentro do modelo (V.caixa + margem)
  // e cujo tamanho não estoura a diagonal do modelo. Sem V.caixa, não filtra.
  const uni=new T.Box3();
  V.modelos.forEach(x=>{ const b=x.model&&x.model.box; if(b && !b.isEmpty()) uni.union(b); });
  const lim = uni.isEmpty()? null : uni;
  let diag = Infinity;
  if(lim){ const s=lim.getSize(new T.Vector3()); diag=s.length();
    lim.expandByVector(s.multiplyScalar(0.05)); }
  const _c=new T.Vector3();
  for(let mi=0; mi<V.modelos.length; mi++){
    const x=V.modelos[mi]; const ids=(porMod&&porMod[mi])||[];
    if(!ids.length) continue;
    let bs=[]; try{ bs=await x.model.getBoxes(ids); }catch(_){}
    (bs||[]).forEach(b=>{
      if(!(b&&b.min&&b.max&&isFinite(b.max.x)&&isFinite(b.min.x))) return;
      _c.set((b.min.x+b.max.x)/2,(b.min.y+b.max.y)/2,(b.min.z+b.max.z)/2);
      if(lim && !lim.containsPoint(_c)) return;                                  // fora do prédio = caixa errada
      if(Math.max(b.max.x-b.min.x, b.max.y-b.min.y, b.max.z-b.min.z) > diag) return; // maior que o modelo = lixo
      caixas.push(b);
    });
  }
  if(!caixas.length) return 0;
  const geo=new T.BoxGeometry(1,1,1);
  const mat=new T.MeshBasicMaterial({ color:LARANJA, transparent:true, opacity:0.5, depthTest:false, depthWrite:false });
  const inst=new T.InstancedMesh(geo, mat, caixas.length);
  inst.renderOrder=998; inst.frustumCulled=false;
  const m4=new T.Matrix4(), pos=new T.Vector3(), q=new T.Quaternion(), sca=new T.Vector3();
  caixas.forEach((b,i)=>{
    pos.set((b.min.x+b.max.x)/2,(b.min.y+b.max.y)/2,(b.min.z+b.max.z)/2);
    sca.set(Math.max(b.max.x-b.min.x,0.05), Math.max(b.max.y-b.min.y,0.05), Math.max(b.max.z-b.min.z,0.05));
    m4.compose(pos,q,sca); inst.setMatrixAt(i,m4);
  });
  inst.instanceMatrix.needsUpdate=true;
  V.scene.add(inst); V._marcasDestaque=inst;
  return caixas.length;
}

// Destaque LEVE: só o conjunto alvo é realçado (laranja opaco). Nunca mexemos
//  em opacidade/visibilidade do resto do modelo — isso estourava o "Memory
//  overflow" do Fragments (config item-a-item em dezenas de milhares de peças).
export async function destacar(V, modelo, ids){
  const T=V.THREE;
  // Se o modelo está COLORIDO (por tipo/grupo), clicar mantém as cores e só
  //  acende a peça clicada em ciano — sem esconder nada nem perder a legenda.
  if(V._colorido){
    await _reaplicarCores(V);
    if(modelo && ids && ids.length){ try{ await modelo.model.highlight(ids, { color:new T.Color(SELECAO), renderedFaces:1, opacity:1, transparent:false }); }catch(_){} }
    try{ await V.fragments.update(true); }catch(_){}
    return;
  }
  // Se há um ISOLAMENTO ativo, clicar NÃO sai dele — só realça a peça clicada
  //  em ciano por cima do conjunto isolado (que segue laranja). Assim dá pra
  //  inspecionar as peças isoladas sem perder o contexto. Voltar = botão/limpar.
  if(V._isolado){
    for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} }
    // Clique no VAZIO (sem peça): só tira o realce e mantém as cores naturais do
    //  conjunto isolado — NÃO repinta de laranja (senão a laje isolada inteira
    //  fica laranja ao clicar fora dela).
    if(!(modelo && ids && ids.length)){ try{ await V.fragments.update(true); }catch(_){} return; }
    // Com peça clicada: repinta o conjunto isolado de laranja (contexto) — só se
    //  for pequeno; um andar inteiro ficaria todo laranja, então aí mantém cores
    //  naturais e só a clicada acende em ciano.
    const tot=Object.values(V._isoladoPorMod||{}).reduce((a,l)=>a+(l?l.length:0),0);
    if(tot>0 && tot<=250){
      for(const [mi, lids] of Object.entries(V._isoladoPorMod||{})){
        const x=V.modelos[mi]; if(!x||!lids||!lids.length) continue;
        try{ await x.model.highlight(lids, { color:new T.Color(LARANJA), renderedFaces:1, opacity:1, transparent:false }); }catch(_){}
      }
    }
    try{ await modelo.model.highlight(ids, { color:new T.Color(SELECAO), renderedFaces:1, opacity:1, transparent:false }); }catch(_){}
    try{ await V.fragments.update(true); }catch(_){}
    return;
  }
  // Sem isolamento: realça só a peça clicada (comportamento normal). NÃO
  // reexibimos tudo à toa: `setVisible(undefined,true)` a cada clique reseta a
  // opacidade do vidro (fica opaco de novo) E reapareceria o que o usuário
  // escondeu de propósito com o botão-direito. Só reexibe se havia algo oculto —
  // aí sim reaplica o vidro depois (o reshow tira a transparência).
  const haOcultos = !!(V._escondidos && V._escondidos.size);
  for(const x of V.modelos){
    try{ await x.model.resetHighlight(); }catch(_){}
    if(haOcultos){ try{ await x.model.setVisible(undefined, true); }catch(_){} }
  }
  if(modelo && ids && ids.length){
    try{ await modelo.model.highlight(ids, {
      color:new T.Color(_corSelecao(V,modelo)), renderedFaces:1, opacity:1, transparent:false }); }catch(_){}
  }
  // Reaplica o vidro se (a) reexibimos ocultos ou (b) o vidro está translúcido —
  // nesse caso clicar EM UM painel de vidro o deixa opaco (highlight opacity:1) e
  // sem restaurar. Gate em _vidroOpac<1: no padrão (100%) é no-op, não afeta o
  // caminho normal nem o desempenho.
  const vidroTranslucido = (V._vidroOpac!=null && V._vidroOpac<1);
  if(haOcultos || vidroTranslucido){ try{ await _reaplicarVidroRapido(V); }catch(_){} }
  try{ await V.fragments.update(true); }catch(_){}
}

// Classes que formam a SILHUETA do prédio — ficam translúcidas no "fantasma
//  leve"; o que não é silhueta (MEP, mobiliário, ferragem, pinos…) é escondido.
const SILHUETA=[/^IFCWALL/i,/^IFCSLAB/i,/^IFCROOF/i,/^IFCCOLUMN/i,/^IFCBEAM/i,
  /^IFCCURTAINWALL/i,/^IFCPLATE/i,/^IFCMEMBER/i,/^IFCSTAIR/i,/^IFCRAMP/i,
  /^IFCFOOTING/i,/^IFCPILE/i,/^IFCWINDOW/i,/^IFCDOOR/i];

// ── Destaque por CATEGORIA (Nível 2 da IA: "onde estão os pilares?") ───────
//  Acende TODOS os elementos de uma ou mais categorias IFC (ex.: IFCCOLUMN) em
//  todos os modelos federados e esmaece o resto, para a categoria "saltar".
//  `regexes` = lista de RegExp de categoria (ex.: [/^IFCCOLUMN$/i]).
// Junta os VALORES pesquisáveis do elemento (atributos + valores de propriedade
// dos Psets) numa string única, para filtro por texto. Inclui só VALORES (não
// nomes de propriedade), senão "FireRating" faria toda porta bater em "fire".
function _textoBusca(d){
  if(!d) return '';
  const escal=(o)=> (o && typeof o==='object' && 'value' in o && typeof o.value!=='object') ? o.value : undefined;
  const out=[];
  for(const [k,v] of Object.entries(d)){
    if(k[0]==='_' || /^(globalid|guid|ownerhistory)$/i.test(k)) continue;   // pula identificadores (_guid/_localId/GlobalId)
    if(Array.isArray(v)){
      v.forEach(ps=>{ if(!ps||typeof ps!=='object') return;
        // idem dentro do Pset: o _guid do conjunto de propriedades entrava no texto
        // ("…njC80IBU…" fazia um pilar C50 casar com "c80")
        Object.entries(ps).filter(([k2])=> k2[0]!=='_' && !/^(globalid|guid|ownerhistory)$/i.test(k2)).map(([,x])=>x).forEach(sub=>{
          if(Array.isArray(sub)){ sub.forEach(p=>{ if(!p||typeof p!=='object') return;
            const pv=escal(p.NominalValue)??escal(p.Value)??escal(p.LengthValue)??escal(p.AreaValue)??escal(p.VolumeValue)??escal(p.CountValue);
            if(pv!=null) out.push(String(pv)); }); }
          else { const vv=escal(sub); if(vv!=null) out.push(String(vv)); }
        });
      });
    } else { const vv=escal(v); if(vv!=null) out.push(String(vv)); }
  }
  return out.join(' ').toLowerCase();
}

// Minúsculas + sem acento (casa "térreo" com "TERREO").
function _norm(s){ return String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }
// Nome do elemento (atributo Name), normalizado.
function _nomeEl(d){ return _norm(d && d.Name && d.Name.value!=null ? d.Name.value : ''); }
// Casa termos de filtro contra 1 elemento. Termo iniciado por "=" exige
// correspondência EXATA no Name (V1 ≠ V10); senão substring no texto todo.
const FIRE_RX=/fire.?rating|corta.?fogo|resist.*fogo|prote.*fogo/i;   // corta-fogo vive em Pset_DoorCommon.FireRating
function _bateTermos(d, termosLc){
  if(!termosLc || !termosLc.length) return true;
  const nome=_nomeEl(d), txt=_norm(_textoBusca(d));
  return termosLc.some(t=>{ t=_norm(t);
    if(t==='@fire'){ const v=_achaValorQualquer(d, FIRE_RX); return v!=null && !/^(0|0h|nao|n[aã]o|nenhum|none|n\/a|na|false|sem|-)$/i.test(_norm(String(v))); }
    // classe do concreto ("c40"): está no MATERIAL (TQS: "Concreto C80"), não no nome da peça
    if(/^c\d{2}$/.test(t)){ if(txt.includes(t)) return true; const mv=_achaValorQualquer(d, /material/i); return mv!=null && _norm(String(mv)).replace(/\s+/g,'').includes(t); }
    return t[0]==='=' ? nome===t.slice(1) : txt.includes(t);
  });
}
// Pavimento do elemento (via Pset — precisa de getItemsData com IsDefinedBy).
function _pavimEl(d){ const v=_achaValorQualquer(d, /piso|planta|pavim|storey|level|andar|n[íi]vel|nivel|eleva|restri[çc][aã]o da base|base ?constraint/i); return v==null?'':_norm(v); }
// Casa o pavimento pedido com o do elemento. Direto por substring; se o pedido
// tem número ("pavimento 5"), casa também "TIPO 05"/"PAV 5" (0 à esquerda ok).
function _batePavim(pavEl, pavN){
  if(!pavEl||!pavN) return false;
  if(pavEl.includes(pavN)) return true;
  const num=(pavN.match(/\d+/)||[])[0];
  if(num){ try{ return new RegExp('(^|[^0-9])0*'+num+'([^0-9]|$)').test(pavEl); }catch(_){} }
  return false;
}

// Pede o cancelamento do processamento pesado em curso (botão Parar).
export function cancelar(V){ if(V) V._cancelar=true; }
// DIAGNÓSTICO: pega o 1º elemento da classe e devolve TODAS as propriedades que
// o filtro enxerga (nome do Pset → propriedade = valor), + o que _pavimEl extrai.
// Serve p/ descobrir onde o modelo guarda o pavimento sem ficar adivinhando.
export async function diagElemento(V, regexes){
  for(const x of V.modelos){
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(regexes)||{}).flat(); }catch(_){}
    if(!ids.length) continue;
    let da=[]; try{ da=await x.model.getItemsData([ids[0]], { attributesDefault:true,
      relations:{ IsDefinedBy:{attributes:true,relations:true}, IsTypedBy:{attributes:true,relations:false}, HasAssociations:{attributes:true,relations:false} },
      relationsDefault:{attributes:false,relations:false} }); }catch(e){ return 'erro lendo: '+(e.message||e); }
    const d=(da||[])[0]; if(!d) continue;
    const escal=(o)=> (o&&typeof o==='object'&&'value' in o&&typeof o.value!=='object')?o.value:undefined;
    const linhas=[];
    for(const [k,v] of Object.entries(d)){
      if(Array.isArray(v)){
        v.forEach(ps=>{ if(!ps||typeof ps!=='object') return; const nm=(ps.Name&&ps.Name.value)||k;
          for(const [k2,v2] of Object.entries(ps)){
            if(k2==='Name') continue;
            if(Array.isArray(v2)){ v2.forEach(p=>{ if(!p||typeof p!=='object')return; const pn=p.Name&&p.Name.value; const pv=escal(p.NominalValue)??escal(p.Value); if(pn!=null&&pv!=null) linhas.push(nm+' → '+pn+' = '+pv); }); }
            else { const vv=escal(v2); if(vv!=null&&vv!=='') linhas.push(nm+' → '+k2+' = '+vv); }
          }
        });
      } else if(k[0]!=='_'){ const vv=escal(v); if(vv!=null&&vv!=='') linhas.push('(direto) '+k+' = '+vv); }
    }
    console.log('[DIAG '+(regexes[0])+'] elemento', d, '\n'+linhas.join('\n'));
    return '_pavimEl → "'+_pavimEl(d)+'"\n\n'+linhas.join('\n');
  }
  return 'nenhum elemento dessa classe.';
}
// Lê Psets (IsDefinedBy) em LOTES: cede o thread entre lotes (a UI responde ao
// Parar), mostra progresso e aborta se _cancelar. Ler tudo de uma vez travava
// em modelos com milhares de elementos (ex.: paredes).
async function _lerPsetsEmLotes(V, model, ids, rotulo){
  return _lerLotesPar(V, model, ids, { attributesDefault:true,
    relations:{ IsDefinedBy:{attributes:true,relations:true} }, relationsDefault:{attributes:false,relations:false} }, rotulo);
}
// Leitor em lotes PARALELO: dispara PAR chamadas getItemsData ao mesmo tempo (a
// serialização/worker se sobrepõe → bem mais rápido que 1 de cada vez), em lotes
// maiores. Cancelável entre ondas (o Parar responde a cada onda) e com progresso.
async function _lerLotesPar(V, model, ids, opts, rotulo){
  const R=[]; const N=150, PAR=4;             // 4 lotes de 150 por onda
  for(let i=0;i<ids.length;i+=N*PAR){
    if(V._cancelar) throw new Error('CANCELADO');
    const ondas=[];
    for(let j=0;j<PAR;j++){ const s=i+j*N; if(s>=ids.length) break;
      ondas.push(model.getItemsData(ids.slice(s,s+N), opts).catch(()=>[])); }
    const res=await Promise.all(ondas);
    if(V._cancelar) throw new Error('CANCELADO');
    for(const da of res) for(const d of (da||[])) R.push(d);
    if(V.on && V.on.dica) V.on.dica((rotulo||'Processando')+'… '+Math.min(i+N*PAR,ids.length)+'/'+ids.length);
    await new Promise(r=>setTimeout(r,0));     // cede o thread p/ o Parar
  }
  return R;
}
// Mapa localId→pavimento de um modelo, com CACHE: a 1ª consulta de andar lê os
// Psets (em lotes, cancelável); as próximas reusam o cache (instantâneas).
async function _pavimMapModelo(V, x, ids, rotulo){
  x._pavCache = x._pavCache || new Map();
  const faltam = ids.filter(id=> !x._pavCache.has(id));
  if(faltam.length){
    const dd = await _lerPsetsEmLotes(V, x.model, faltam, rotulo);
    dd.forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid!=null) x._pavCache.set(lid, _pavimEl(d)); });
  }
  return x._pavCache;
}
// FAIXAS de pavimento (cache): nomeia cada nível lendo o Pset só das LAJES
// (poucas) e usa a altura da laje como piso do nível. Assim filtrar "do térreo"
// vira um teste geométrico rápido nas caixas (sem ler Pset de milhares de peças).
async function _faixasPavimento(V){
  if(V._faixas) return V._faixas;
  const ns=await niveis(V);                 // Ys já CONSOLIDADOS (funde lajes < ~2,2m)
  if(!ns || !ns.length) return (V._faixas=[]);
  // Vota, por nome de pavimento, a qual NÍVEL consolidado as lajes daquele nome
  //  mais se aproximam. Assim o teto da faixa é o próximo nível REAL, não um
  //  patamar/rebaixo colado (que estreitava a faixa e excluía paredes).
  const votos=new Map();                    // nome -> Map(idxNivel -> contagem)
  let _st=[]; try{ _st=await _storeysMapa(V); }catch(_){}
  const _stDe=(mi)=>{ const m=new Map(); _st.filter(s=>s.mi===mi).forEach(s=>s.ids.forEach(id=>m.set(id,s.nome))); return m; };
  for(const x of V.modelos){
    const _stMap=_stDe(V.modelos.indexOf(x));
    let sids=[]; try{ sids=Object.values(await x.model.getItemsOfCategories([/^IFCSLAB$/])||{}).flat(); }catch(_){}
    if(!sids.length) continue;
    const cache=await _pavimMapModelo(V, x, sids, 'Mapeando pavimentos');   // Pset só das lajes
    let boxes=[]; try{ boxes=await x.model.getBoxes(sids); }catch(_){}
    sids.forEach((id,i)=>{ const nm=cache.get(id)||_stMap.get(id); const b=(boxes||[])[i];
      if(!nm || !b || !isFinite(b.max.y)) return;
      let idx=0,best=Infinity; ns.forEach((y,j)=>{ const dd=Math.abs(y-b.max.y); if(dd<best){best=dd;idx=j;} });
      if(!votos.has(nm)) votos.set(nm, new Map()); const mm=votos.get(nm); mm.set(idx,(mm.get(idx)||0)+1);
    });
  }
  const faixas=[];
  for(const [nome, mm] of votos){ let idx=0,mx=-1; for(const [k,c] of mm){ if(c>mx){mx=c;idx=k;} }
    faixas.push({nome, idx, y:ns[idx], y0:ns[idx]-0.8, y1:(idx+1<ns.length)?ns[idx+1]-0.8:Infinity}); }
  faixas.sort((a,b)=>a.y-b.y);
  V._faixas=faixas;
  return faixas;
}
function _faixaDe(faixas, pavN){ const f=(faixas||[]).find(f=> _batePavim(f.nome, pavN)); return f?{y0:f.y0,y1:f.y1}:null; }
// Uma faixa por NÍVEL real. _faixasPavimento devolve uma por NOME, e vários
//  nomes caem no mesmo nível (ARQ "5º PAVIMENTO", EST "5º PAV. TIPO", subníveis
//  de piso acabado "_(P.A_0,09)", degraus "P.A. ..."): _faixaNoY pegava o 1º e o
//  pé-direito saía rotulado com subnível. Aqui fica o nome-base mais votado.
function _faixasUnicas(faixas){
  const porIdx=new Map();
  const nota=(n)=> (/_\(|^P\.?A\.? /i.test(n)?2:0) + (/PAV\. TIPO|^PAV\. /i.test(n)?1:0);
  for(const f of (faixas||[])){ const o=porIdx.get(f.idx);
    if(!o || nota(f.nome)<nota(o.nome)) porIdx.set(f.idx, f); }
  return [...porIdx.values()].sort((a,b)=>a.y-b.y);
}
export async function pavimentosPeDireito(V){ return _faixasUnicas(await _faixasPavimento(V)).map(f=>({ nome:f.nome, y:f.y })); }
function _faixaNoY(faixas, y){ for(const f of (faixas||[])){ if(y>=f.y0 && y<f.y1) return f; } return null; }
function _nomePav(nome){ return String(nome||'').replace(/_\(.*/,'').replace(/_/g,' ').trim().toUpperCase(); }
// DIAGNÓSTICO: lista as FAMÍLIAS/tipos de uma classe (nome antes do ":") com
// contagem — p/ achar o código do corta-fogo (PCF/CF…) sem adivinhar.
export async function diagTipos(V, regexes){
  const cont=new Map();
  for(const x of V.modelos){
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(regexes)||{}).flat(); }catch(_){}
    if(!ids.length) continue;
    let da=[]; try{ da=await x.model.getItemsData(ids,{attributesDefault:true,relationsDefault:{attributes:false,relations:false}}); }catch(_){}
    (da||[]).forEach(d=>{ let t=(d&&d.ObjectType&&d.ObjectType.value)||(d&&d.Name&&d.Name.value)||'?'; t=String(t).split(':')[0].trim(); cont.set(t,(cont.get(t)||0)+1); });
  }
  const arr=[...cont.entries()].sort((a,b)=>b[1]-a[1]);
  return arr.length? arr.map(([t,n])=>n+' × '+t).join('\n') : 'nenhum elemento.';
}
// DIAGNÓSTICO das faixas de pavimento (nome → nível/altura/faixa).
export async function diagFaixas(V){
  const f=await _faixasPavimento(V);
  if(!f.length) return 'nenhuma faixa (as lajes não trazem nome de pavimento).';
  return 'Níveis (m): '+((V.niveis||[]).map(y=>y.toFixed(2)).join(', '))+'\n\n'+
    f.map(x=>x.nome+' → nível '+x.idx+' (y='+x.y.toFixed(2)+') · faixa ['+x.y0.toFixed(2)+', '+(x.y1===Infinity?'∞':x.y1.toFixed(2))+']').join('\n');
}
// A peça pertence ao pavimento onde sua BASE (min.y) cai — igual à "Restrição
//  da base" do Revit. Peça que sobe vários andares fica só no de origem (base);
//  antes eu usava sobreposição e ela vazava p/ todos os andares que cruzava.
function _naFaixa(b, fx){ return b && b.min.y >= fx.y0 && b.min.y < fx.y1; }
// PAVIMENTO PELA ESTRUTURA ESPACIAL (IfcBuildingStorey) — autoritativo e funciona
// mesmo quando o Pset das lajes vem VAZIO (caso PINI-EST). Mapa por modelo:
// {mi, id, nome, nomeNorm, ids:[elementos descendentes]}. Cache em V._storeys.
async function _storeysMapa(V){
  if(V._storeys) return V._storeys;
  const out=[];
  for(let mi=0; mi<V.modelos.length; mi++){
    const x=V.modelos[mi]; if(!x||!x.model) continue;
    let raw=null; try{ raw=await x.model.getSpatialStructure(); }catch(_){}
    if(!raw) continue;
    // Anda direto na estrutura CRUA (sem montar a árvore inteira de elementos, que
    // é cara). Só acha os IfcBuildingStorey e junta os ids folha de cada um.
    const storeys=[];
    const coletaFolhas=(inst, acc)=>{ for(const cn of (inst.children||[])){ const c=String(cn.category||'').toUpperCase();
      for(const ch of (cn.children||[])){ if(_ESPACIAL.has(c)) coletaFolhas(ch, acc); else if(ch.localId!=null) acc.push(ch.localId); } } };
    const walk=(inst, tipoPai)=>{
      if(String(tipoPai).toUpperCase()==='IFCBUILDINGSTOREY' && inst.localId!=null){ const acc=[]; coletaFolhas(inst, acc); storeys.push({ id:inst.localId, ids:acc }); }
      for(const cn of (inst.children||[])){ for(const ch of (cn.children||[])) walk(ch, cn.category); }
    };
    for(const inst of (raw.children||[])) walk(inst, raw.category);
    if(!storeys.length) continue;
    // nomes SÓ dos storeys (não de todos os nós espaciais)
    const nm={}; const sids=storeys.map(s=>s.id);
    for(let p=0;p<sids.length;p+=400){ const lote=sids.slice(p,p+400); let da=[];
      try{ da=await x.model.getItemsData(lote,{attributesDefault:true,relationsDefault:{attributes:false,relations:false}}); }catch(_){}
      (da||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return; nm[lid]=String((d.Name&&d.Name.value)||(d.LongName&&d.LongName.value)||'').trim(); });
    }
    storeys.forEach(s=>{ const nome=nm[s.id]||('Pavimento '+s.id); out.push({ mi, id:s.id, nome, nomeNorm:_norm(nome), ids:s.ids }); });
  }
  V._storeys=out;
  return out;
}
// Casa o texto do usuário com o nome do pavimento: substring completo ("terreo"),
// ou só número ("pavimento 2" → casa o dígito), ou palavra+número ("subsolo 2").
// "sobressolo 2" (palavra errada) NÃO casa tudo com 2 — devolve os disponíveis.
function _casaPav(nomeNorm, alvo){
  if(!alvo) return false;
  if(nomeNorm.includes(alvo)) return true;
  const temLetra=/[a-z]/.test(alvo);
  const nAlvo=(alvo.match(/\d+/)||[])[0]||'';
  const sd=(nomeNorm.match(/\d+/)||[])[0]||'';
  if(!temLetra && nAlvo) return sd!=='' && parseInt(sd,10)===parseInt(nAlvo,10);
  if(temLetra && nAlvo){ const pal=alvo.replace(/\d+/g,'').trim(); return !!pal && nomeNorm.includes(pal) && sd!=='' && parseInt(sd,10)===parseInt(nAlvo,10); }
  return false;
}
// Categorias "visíveis" de construção (p/ isolar um andar inteiro sem puxar
// espaços/tipos/relações).
// Prefixo de classe SEM os TIPOS (IfcWallType, IfcDoorStyle…): o Revit exporta centenas de
// definições de tipo (808 IfcWallType no PINI) que não são peças — sem geometria, mas com
// nome e material — e entravam nas contagens/filtros por classe.
const _SEM_TIPO='(?!\\w*(TYPE|STYLE)$)';
const _rxClasse=pref=>new RegExp('^'+pref+_SEM_TIPO);
const CAT_VISIVEIS=['IFCWALL','IFCSLAB','IFCCOLUMN','IFCBEAM','IFCDOOR','IFCWINDOW','IFCSTAIR',
  'IFCRAILING','IFCROOF','IFCCURTAINWALL','IFCPLATE','IFCMEMBER','IFCCOVERING','IFCFOOTING',
  'IFCPILE','IFCRAMP','IFCBUILDINGELEMENTPROXY','IFCFURNI','IFCFLOWSEGMENT','IFCFLOWTERMINAL','IFCFLOWFITTING'].map(_rxClasse);
// Isola um PAVIMENTO INTEIRO (todas as categorias) pela faixa de altura — para
// "destacar o pavimento térreo" sem citar classe. Sem realce (cores naturais).
export async function isolarPavimento(V, pavim){
  V._cancelar=false;
  const pavSets=_pavSetsDe(V, pavim);
  if(pavSets){
    const porMod={}; let total=0;
    for(const [mi,set] of Object.entries(pavSets)){ if(set && set.size){ porMod[mi]=[...set]; total+=set.size; } }
    if(!total) return { n:0, naoAchou:true, disponiveis:[] };
    for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
    for(const [mi,keep] of Object.entries(porMod)){ try{ await V.modelos[mi].model.setVisible(keep,true); }catch(_){} }
    V._isolado=true; V._isoladoPorMod=porMod; V._ultimaSelecao=porMod; V._colorido=false; V._cores=null;
    try{ await V.fragments.update(true); }catch(_){}
    await enquadrarIds(V, porMod);
    return { n:total, nomes:[V._pavRot||''] };
  }
  const alvo=_norm(pavim||'');
  // 1) ESTRUTURA ESPACIAL primeiro (autoritativa; funciona com Pset das lajes vazio)
  const st=await _storeysMapa(V);
  if(st.length){
    const sel=st.filter(s=>_casaPav(s.nomeNorm, alvo));
    if(!sel.length) return { n:0, naoAchou:true, disponiveis:[...new Set(st.map(s=>s.nome))] };
    const porMod={}; let total=0;
    sel.forEach(s=>{ if(!s.ids.length) return; (porMod[s.mi]=porMod[s.mi]||[]).push(...s.ids); total+=s.ids.length; });
    for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
    for(const [mi,keep] of Object.entries(porMod)){ try{ await V.modelos[mi].model.setVisible(keep,true); }catch(_){} }
    if(total>0){ V._isolado=true; V._isoladoPorMod=porMod; V._ultimaSelecao=porMod; V._colorido=false; V._cores=null; }
    else { for(const x of V.modelos){ try{ await x.model.setVisible(undefined,true); }catch(_){} } }
    try{ await V.fragments.update(true); }catch(_){}
    if(total>0) await enquadrarIds(V, porMod);
    return { n:total, nomes:[...new Set(sel.map(s=>s.nome))] };
  }
  // 2) fallback GEOMÉTRICO (modelos sem estrutura espacial): faixa por altura de laje
  const fx=_faixaDe(await _faixasPavimento(V), alvo);
  if(!fx) return { n:0, semFaixa:true };
  const porMod={}; let total=0;
  for(let mi=0; mi<V.modelos.length; mi++){
    const x=V.modelos[mi];
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(CAT_VISIVEIS)||{}).flat(); }catch(_){}
    if(!ids.length) continue;
    let boxes=[]; try{ boxes=await x.model.getBoxes(ids); }catch(_){}
    const keep=[]; ids.forEach((id,i)=>{ if(_naFaixa((boxes||[])[i], fx)) keep.push(id); });
    if(keep.length){ porMod[mi]=keep; total+=keep.length; }
  }
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
  for(const [mi,keep] of Object.entries(porMod)){ try{ await V.modelos[mi].model.setVisible(keep,true); }catch(_){} }
  if(total>0){ V._isolado=true; V._isoladoPorMod=porMod; V._ultimaSelecao=porMod; }
  else { for(const x of V.modelos){ try{ await x.model.setVisible(undefined,true); }catch(_){} } }
  try{ await V.fragments.update(true); }catch(_){}
  if(total>0) await enquadrarIds(V, porMod);   // zoom-extend no andar
  return { n:total };
}
// Isola uma DISCIPLINA inteira (o modelo federado daquela disciplina) — para
// "isolar a estrutura/arquitetura/hidráulica…". Estrutura ≠ paredes ACM (ARQ):
// isolar por disciplina resolve sem depender de classe/LoadBearing.
export async function isolarDisciplina(V, codesCsv){
  V._cancelar=false;
  const alvo=new Set(String(codesCsv||'').split(',').map(c=>c.trim().toUpperCase()).filter(Boolean));
  const sel=[];
  for(let mi=0; mi<V.modelos.length; mi++){ const d=String(V.modelos[mi].disciplina||'').toUpperCase(); if(alvo.has(d)) sel.push(mi); }
  if(!sel.length) return { n:0, naoFederado:true, disponiveis:[...new Set(V.modelos.map(m=>m.disciplina).filter(Boolean))] };
  const porMod={}; let total=0;
  for(const mi of sel){ const x=V.modelos[mi]; let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(CAT_VISIVEIS)||{}).flat(); }catch(_){} if(ids.length){ porMod[mi]=ids; total+=ids.length; } }
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
  for(const [mi,ids] of Object.entries(porMod)){ try{ await V.modelos[mi].model.setVisible(ids,true); }catch(_){} }
  if(total>0){ V._isolado=true; V._isoladoPorMod=porMod; V._ultimaSelecao=porMod; V._colorido=false; V._cores=null; }
  try{ await V.fragments.update(true); }catch(_){}
  if(total>0) await enquadrarIds(V, porMod);
  return { n:total, modelos:[...new Set(sel.map(mi=>V.modelos[mi].disciplina||V.modelos[mi].nome))] };
}
// Fallback quando NÃO há modelo EST separado (estrutura dentro do ARQ): isola as
// CLASSES estruturais — RÁPIDO (só getItemsOfCategories, SEM ler Pset). Paredes
// não entram (evita varrer milhares de Psets p/ achar LoadBearing, que travava);
// se `comParedesEstr` vier true, aí sim lê o Pset das paredes (modo lento opt-in).
// Só classes ESTRUTURAIS "puras". IFCMEMBER/IFCPLATE ficam FORA: na arquitetura
// são os montantes e painéis do curtain-wall (fachada), e entravam como se fossem
// estrutura (o "azul" que aparecia ao isolar sem a EST federada).
const _EST_CLS=[/^IFCCOLUMN$/,/^IFCBEAM$/,/^IFCSLAB$/,/^IFCFOOTING$/,/^IFCPILE$/];
function _ehLoadBearing(d){
  const v=_achaValorQualquer(d, /loadbearing|load.?bearing|porta.?carga|portante|estrutural/i);
  if(v===true) return true;
  return v!=null && /^(1|true|sim|yes|verdadeiro|s)$/i.test(_norm(String(v)));
}
export async function isolarEstrutural(V, comParedesEstr){
  V._cancelar=false;
  // Se há modelo de ESTRUTURA federado à parte, isolar POR DISCIPLINA é o correto:
  // o modo por classe pega IFCPLATE/IFCMEMBER, que na ARQUITETURA são os painéis e
  // montantes do curtain-wall (o "azul" que não é estrutura). Só cai no modo por
  // classe quando a estrutura está embutida no ARQ (sem EST separado).
  const estDiscs=[...new Set(V.modelos.map(m=>String(m.disciplina||'').trim()).filter(d=>/^(est|estr|struc)/i.test(d)))];
  if(estDiscs.length){
    const r=await isolarDisciplina(V, estDiscs.join(','));
    if(r && r.n>0) return r;
  }
  const porMod={}; let total=0;
  for(let mi=0; mi<V.modelos.length; mi++){
    if(V._cancelar) throw new Error('CANCELADO');
    const x=V.modelos[mi];
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(_EST_CLS)||{}).flat(); }catch(_){}
    if(comParedesEstr){   // opt-in lento: inclui paredes estruturais (LoadBearing)
      let wids=[]; try{ wids=Object.values(await x.model.getItemsOfCategories([/^IFCWALL/])||{}).flat(); }catch(_){}
      if(wids.length){ const dd=await _lerPsetsEmLotes(V, x.model, wids, 'Separando paredes estruturais');
        (dd||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid!=null && _ehLoadBearing(d)) ids.push(lid); }); }
    }
    if(ids.length){ porMod[mi]=ids; total+=ids.length; }
  }
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
  for(const [mi,ids] of Object.entries(porMod)){ try{ await V.modelos[mi].model.setVisible(ids,true); }catch(_){} }
  if(total>0){ V._isolado=true; V._isoladoPorMod=porMod; V._ultimaSelecao=porMod; V._colorido=false; V._cores=null; }
  try{ await V.fragments.update(true); }catch(_){}
  if(total>0) await enquadrarIds(V, porMod);
  return { n:total };
}
// FINDER: acha os ids que casam (classe + texto/@fire + pavimento), SEM tocar no
// visual. Reusado por isolar (destacarCategoria) e por colorir.
// Pavimento do CADASTRO ("@pav:<id>"): o App resolve antes, em V._pavSets {mi: Set(ids)},
// pareando os andares de CADA modelo com o cadastro (cada disciplina nomeia diferente).
function _pavSetsDe(V, pavim){ return (typeof pavim==='string' && pavim.indexOf('@pav:')>=0 && V._pavSets) ? V._pavSets : null; }
export async function acharElementos(V, regexes, termos, pavim){
  V._cancelar=false;
  let termosLc=(termos||[]).map(t=>String(t).trim().toLowerCase()).filter(Boolean);
  // classe do concreto (c40/c80): pelo índice de material — sem ler Pset peça a peça
  const fckT=termosLc.filter(t=>/^c\d{2}$/.test(t));
  if(fckT.length){ for(const x of V.modelos){ try{ await _matIndice(x); }catch(_){} } termosLc=termosLc.filter(t=>!/^c\d{2}$/.test(t)); }
  const pavSets=_pavSetsDe(V, pavim);
  const pavN = (pavim && !pavSets) ? _norm(pavim) : '';
  const porMod={};
  for(let mi=0; mi<V.modelos.length; mi++){
    const x=V.modelos[mi];
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(regexes)||{}).flat(); }catch(_){}
    if(pavSets){ const st=pavSets[mi]; ids = st ? ids.filter(id=>st.has(id)) : []; }
    if(fckT.length && x._matDe){ const de=x._matDe; ids=ids.filter(id=>fckT.some(t=>_matCasa(de.get(id), 'c'+t.slice(1)) || _matCasa(de.get(id), 'c '+t.slice(1)))); }
    if(!ids.length) continue;
    if(termosLc.length || pavN){
      const okd=[];
      if(pavN && !termosLc.length){
        const st=await _storeysMapa(V);
        if(st.length){   // estrutura espacial (membership) — precisa e sem depender de Pset
          const set=new Set(); st.filter(s=>s.mi===mi && _casaPav(s.nomeNorm, pavN)).forEach(s=> s.ids.forEach(id=>set.add(id)));
          for(const id of ids){ if(set.has(id)) okd.push(id); }
        } else {
          const fx=_faixaDe(await _faixasPavimento(V), pavN);
          if(fx){ let boxes=[]; try{ boxes=await x.model.getBoxes(ids); }catch(_){} ids.forEach((id,i)=>{ if(_naFaixa((boxes||[])[i], fx)) okd.push(id); }); }
          else { const cache=await _pavimMapModelo(V, x, ids, 'Filtrando'); for(const id of ids){ if(_batePavim(cache.get(id)||'', pavN)) okd.push(id); } }
        }
      } else {
        let dados=[]; const precisaPset = pavN || termosLc.includes('@fire') || termosLc.some(t=>/^c\d{2}$/.test(t));
        if(precisaPset){ dados=await _lerPsetsEmLotes(V, x.model, ids, 'Filtrando'); }
        else { try{ dados=await x.model.getItemsData(ids, { attributesDefault:true, relationsDefault:{attributes:false,relations:false} }); }catch(_){} }
        (dados||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return;
          if(termosLc.length && !_bateTermos(d, termosLc)) return;
          if(pavN && !_batePavim(_pavimEl(d), pavN)) return;
          okd.push(lid);
        });
      }
      ids=okd;
    }
    if(ids.length) porMod[mi]=ids;
  }
  return porMod;
}
// Busca em TODAS as categorias visíveis (p/ "colorir o modelo" / "elementos de vidro").
export async function acharTudo(V, termos, pavim){ return acharElementos(V, CAT_VISIVEIS, termos, pavim); }
// Soma uma quantidade sobre um conjunto EXPLÍCITO de ids (a última seleção) —
// p/ "calcule a área desses elementos".
export async function somarIds(V, porMod, termoProp){
  V._cancelar=false;
  const rx=_termoRegex(termoProp);
  const chave=String(termoProp||'').toLowerCase();   // cache por propriedade
  let n=0, comValor=0, soma=0; const nomes=new Set();
  for(const [mi,ids] of Object.entries(porMod||{})){
    const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue; n+=ids.length;
    // CACHE: guarda o valor achado por (propriedade, id). Recontas de seleções que
    // se sobrepõem não releem o Pset — ficam instantâneas.
    x._qtyCache = x._qtyCache || {}; const cache = x._qtyCache[chave] = x._qtyCache[chave] || new Map();
    const faltam = ids.filter(id=> !cache.has(id));
    if(faltam.length){
      const dd=await _lerPsetsEmLotes(V, x.model, faltam, 'Somando');
      (dd||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return;
        const r=_achaValorProfundo(d, rx); cache.set(lid, (r&&typeof r.val==='number')?{val:r.val,nome:r.nome}:null); });
      // ids sem retorno de dado ficam como null p/ não reler toda hora
      faltam.forEach(id=>{ if(!cache.has(id)) cache.set(id,null); });
    }
    for(const id of ids){ const c=cache.get(id); if(c){ soma+=c.val; comValor++; nomes.add(c.nome); } }
  }
  return { n, comValor, soma, nomes:[...nomes] };
}
// ISOLA (esconde o resto) e realça de laranja o conjunto que casa.
export async function destacarCategoria(V, regexes, termos, pavim){
  const porMod = await acharElementos(V, regexes, termos, pavim);
  const T=V.THREE; let total=0;
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
  for(const [mi,ids] of Object.entries(porMod)){ const x=V.modelos[mi]; if(!ids||!ids.length) continue; total+=ids.length;
    try{ await x.model.setVisible(ids, true); }catch(_){}
    try{ await x.model.highlight(ids, { color:new T.Color(LARANJA), renderedFaces:1, opacity:1, transparent:false }); }catch(_){}
  }
  if(total>0){ V._isolado=true; V._isoladoPorMod=porMod; V._ultimaSelecao=porMod; V._colorido=false; V._cores=null; }
  else { for(const x of V.modelos){ try{ await x.model.setVisible(undefined, true); }catch(_){} } }
  try{ await V.fragments.update(true); }catch(_){}
  if(total>0) await enquadrarIds(V, porMod);   // zoom-extend na seleção
  return total;
}
// Destaca (isola + laranja) em TODAS as categorias visíveis o que casa os termos —
// p/ "destacar elementos em vidro" (MATERIAL, sem citar a classe). Mesmo casamento
// do colorir-por-material (acharTudo), só que isolando em vez de colorir.
export async function destacarTudo(V, termos, pavim){
  const porMod = await acharTudo(V, termos, pavim);
  const T=V.THREE; let total=0;
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
  for(const [mi,ids] of Object.entries(porMod)){ const x=V.modelos[mi]; if(!ids||!ids.length) continue; total+=ids.length;
    try{ await x.model.setVisible(ids, true); }catch(_){}
    try{ await x.model.highlight(ids, { color:new T.Color(LARANJA), renderedFaces:1, opacity:1, transparent:false }); }catch(_){}
  }
  if(total>0){ V._isolado=true; V._isoladoPorMod=porMod; V._ultimaSelecao=porMod; V._colorido=false; V._cores=null; }
  else { for(const x of V.modelos){ try{ await x.model.setVisible(undefined, true); }catch(_){} } }
  try{ await V.fragments.update(true); }catch(_){}
  if(total>0) await enquadrarIds(V, porMod);
  return total;
}

// ── FILTRO ESTRUTURADO (construtor de condições — Fatia 1) ──────────────────
//  filtro = { comb:'all'|'any', conds:[ {campo, op, valor, sub, valor2} ] }
//  campos: classe (IFC/bSDD) · disciplina (modelo) · pavimento · material · tipo ·
//  dimensao (sub=Altura/Largura/…). Devolve porMod (mesmo formato do acharElementos)
//  para o host aplicar a ação (isolar/ocultar/colorir).
function _classeIfc(valor){
  const m=/\(ifc(\w+)\)/i.exec(valor||''); if(m) return 'IFC'+m[1].toUpperCase();
  const NM={parede:'IFCWALL',laje:'IFCSLAB',pilar:'IFCCOLUMN',viga:'IFCBEAM',porta:'IFCDOOR',
    janela:'IFCWINDOW',escada:'IFCSTAIR',cobertura:'IFCROOF',tubulacao:'IFCPIPESEGMENT',duto:'IFCDUCTSEGMENT'};
  return NM[_norm(valor).split(' ')[0]]||null;
}
// IFC2X3 (Revit/hidráulica) exporta tubo/conexão como IfcFlowSegment/IfcFlowFitting, sem a
// classe específica do IFC4 — a classe do filtro aceita as duas formas.
const _CLASSE_EQ={ IFCPIPESEGMENT:'IFCPIPESEGMENT|IFCPIPEFITTING|IFCFLOWSEGMENT|IFCFLOWFITTING',
  IFCDUCTSEGMENT:'IFCDUCTSEGMENT|IFCDUCTFITTING', IFCCABLECARRIERSEGMENT:'IFCCABLECARRIERSEGMENT|IFCCABLECARRIERFITTING' };
function _classeRx(valor){ const ifc=_classeIfc(valor); if(!ifc) return null; return new RegExp('^('+(_CLASSE_EQ[ifc]||ifc)+')'+_SEM_TIPO); }   // prefixo: pega subtipos (IfcWallStandardCase), não os TIPOS
// Sinônimos de material (PT/EN) — o exportador pode nomear em inglês. Casa se
// QUALQUER termo bater (o _bateTermos já é OU).
function _matSyn(v){ const t=_norm(v); const map={
  madeira:['wood','timber'], vidro:['glass'], concreto:['concrete'], aco:['steel','aço'], 'aço':['steel','aco'],
  alvenaria:['masonry','brick','tijolo','block','bloco'], aluminio:['aluminum','aluminium'], 'alumínio':['aluminum','aluminium','aluminio'],
  gesso:['gypsum','plaster','drywall','gesso acartonado'], ceramica:['ceramic','tile'], 'cerâmica':['ceramic','tile'],
  ferro:['iron'], pvc:['plastic'], pedra:['stone'], granito:['granite'], marmore:['marble'], 'mármore':['marble'] };
  return [v].concat(map[t]||[]); }
// Extrai os NOMES de material do elemento a partir do HasAssociations (o material
// vive aninhado: RelatingMaterial.Name, ou camadas/constituintes/lista). O
// _textoBusca é raso demais p/ chegar lá, então caminhamos a relação de material.
function _materiaisDe(d){
  if(!d||typeof d!=='object') return [];
  const out=[];
  const nm=(o)=> (o&&o.Name&&o.Name.value!=null&&typeof o.Name.value!=='object')?String(o.Name.value):null;
  // Extrai SÓ os nomes de material — nunca varre a subárvore toda (senão pega Pset,
  // classificação, códigos → planilha gigante). Trata camadas/constituintes/lista.
  const addMat=(m,depth)=>{ if(!m||typeof m!=='object'||depth>4) return;
    const n=nm(m); if(n) out.push(n);
    const layers = m.MaterialLayers || (m.ForLayerSet && m.ForLayerSet.MaterialLayers);
    if(Array.isArray(layers)) layers.forEach(l=>{ if(l){ const mn=nm(l.Material)||nm(l); if(mn) out.push(mn); } });
    if(Array.isArray(m.Materials)) m.Materials.forEach(x=>{ const mn=nm(x); if(mn) out.push(mn); });
    if(Array.isArray(m.MaterialConstituents)) m.MaterialConstituents.forEach(c=>{ if(c){ const mn=nm(c.Material)||nm(c); if(mn) out.push(mn); } });
    if(m.ForLayerSet && m.ForLayerSet!==m) addMat(m.ForLayerSet, depth+1); };
  // Varre QUALQUER array (HasAssociations etc.); trata o item embrulhado
  // (RelatingMaterial) OU o material JÁ ACHATADO (_category IFCMATERIAL*).
  for(const v of Object.values(d)){
    if(!Array.isArray(v)) continue;
    for(const rel of v){ if(!rel||typeof rel!=='object') continue;
      const cat=String((rel._category&&rel._category.value)||'');
      if('RelatingMaterial' in rel) addMat(rel.RelatingMaterial,0);
      else if(/IFCMATERIAL/i.test(cat)) addMat(rel,0);
    }
  }
  return [...new Set(out)];   // sem repetição
}
function _numBR(s){ if(s==null) return NaN; return parseFloat(String(s).replace(/\./g,'').replace(',','.')); }
// Nome do TIPO do elemento (IsTypedBy → Name; senão ObjectType; senão Name).
function _tipoNome(d){
  if(!d) return '';
  for(const [k,v] of Object.entries(d)){ if(k[0]==='_'||!Array.isArray(v)) continue;
    for(const t of v){ if(t&&typeof t==='object'&&t.Name&&t.Name.value!=null){
      const cat=String((t._category&&t._category.value)||''); if(/type|style/i.test(cat)) return String(t.Name.value); } } }
  if(d.ObjectType&&d.ObjectType.value!=null) return String(d.ObjectType.value);
  if(d.Name&&d.Name.value!=null) return String(d.Name.value);
  return '';
}
// NOMENCLATURA (marca) da INSTÂNCIA — ex.: P1, V2, L3. Prefere uma propriedade de
// marca/posição; senão o Tag; senão o Name da instância (NÃO o nome do tipo).
function _nomencl(d, id){
  if(!d) return '#'+id;
  const mk=_achaValorQualquer(d, /\bmarca\b|\bmark\b|refer[êe]ncia|reference|r[óo]tulo|posi[çc][ãa]o|prumada|nome do pilar/i);
  if(mk!=null && String(mk).trim()) return String(mk);
  if(d.Tag && d.Tag.value!=null){ const t=String(d.Tag.value); if(/^[A-Za-z]{0,3}\s*\d/.test(t)) return t; }
  if(d.Name && d.Name.value!=null) return String(d.Name.value);
  return '#'+id;
}
// ÍNDICE DE MATERIAL por modelo (uma vez, ~2 s no maior): parte de cada IfcMaterial*
// (poucos) e da lista de peças associadas (AssociatedTo) — em vez de ler o material
// peça a peça (13–18 s por filtro). x._matDe: Map(id → [nomes]); camadas incluídas.
async function _matIndice(x){
  if(x._matDe) return x._matDe;
  if(x._matIdxP) return x._matIdxP;
  x._matIdxP = (async()=>{
    const md=x.model, de=new Map();
    let mats=[]; try{ mats=Object.values(await md.getItemsOfCategories([/^IFCMATERIAL/])||{}).flat(); }catch(_){}
    const nm=o=>o&&o.Name&&o.Name.value;
    for(let p=0;p<mats.length;p+=2000){
      let da=[]; try{ da=await md.getItemsData(mats.slice(p,p+2000),{attributesDefault:true,
        relations:{AssociatedTo:{attributes:true,relations:false}, ForLayerSet:{attributes:true,relations:true}, MaterialLayers:{attributes:true,relations:true}, Material:{attributes:true,relations:false}},
        relationsDefault:{attributes:false,relations:false}}); }catch(_){}
      (da||[]).forEach(d=>{ if(!d) return; const nomes=new Set(); if(nm(d)) nomes.add(String(nm(d)));
        const ls=(d.ForLayerSet&&d.ForLayerSet[0]&&d.ForLayerSet[0].MaterialLayers)||d.MaterialLayers||[];
        (Array.isArray(ls)?ls:[]).forEach(l=>{ const m=l&&l.Material&&l.Material[0]; if(nm(m)) nomes.add(String(nm(m))); });
        if(!nomes.size) return;
        (d.AssociatedTo||[]).forEach(el=>{ const id=el&&el._localId&&el._localId.value; if(id==null) return;
          const a=de.get(id); if(a){ nomes.forEach(n=>{ if(!a.includes(n)) a.push(n); }); } else de.set(id,[...nomes]); }); });
    }
    x._matDe=de; return de;
  })();
  return x._matIdxP;
}
// Pré-aquece o índice dos modelos abertos (chamar depois de carregar).
export async function prepararIndices(V){ for(const x of (V.modelos||[])){ try{ await _matIndice(x); }catch(_){} } }
function _matCasa(nomes, termo){ const t=_norm(termo).replace(/\s+/g,''); return (nomes||[]).some(n=>_norm(n).replace(/\s+/g,'').includes(t)); }
// ── PROPRIEDADE OBRIGATÓRIA ────────────────────────────────────────────────
//  Valores de uma propriedade pelo NOME (sem acento/caixa/espaço/sublinhado):
//  atributos diretos do elemento (Name, Tag, ObjectType, Description…) e toda
//  propriedade de Pset/quantidade (objeto com Name + NominalValue/xxxValue), em
//  qualquer nível — inclui o Pset do TIPO quando vier carregado. A leitura com
//  IsTypedBy/IsDefinedBy tem CICLOS (DefinesOccurrence/ObjectTypeOf), daí o
//  conjunto de visitados e o limite de profundidade.
const _nProp=(s)=>_norm(s).replace(/[\s_\-.]+/g,'');
function _valoresProp(d, alvo){
  const out=[]; if(!d) return out;
  const esc=(o)=> (o && typeof o==='object' && 'value' in o && typeof o.value!=='object') ? o.value : undefined;
  for(const [k,v] of Object.entries(d)){ if(k[0]==='_'||Array.isArray(v)) continue; if(_nProp(k)===alvo){ const vv=esc(v); out.push(vv===undefined?null:vv); } }
  const vis=new WeakSet();
  const anda=(o,n)=>{ if(!o||typeof o!=='object'||vis.has(o)||n>5) return; vis.add(o);
    if(Array.isArray(o)){ for(const e of o) anda(e,n+1); return; }
    const pn=o.Name&&o.Name.value;
    if(pn!=null && n>0 && _nProp(pn)===alvo){
      let pv=esc(o.NominalValue); if(pv===undefined) pv=esc(o.Value);
      if(pv===undefined) for(const [k,v] of Object.entries(o)){ if(/Value$/.test(k)){ const x=esc(v); if(x!==undefined){ pv=x; break; } } }
      if(pv!==undefined || /PROPERTY|QUANTITY/.test(String(o._category&&o._category.value||''))) out.push(pv===undefined?null:pv);
    }
    for(const v of Object.values(o)) if(v&&typeof v==='object'&&!('value' in v)) anda(v,n+1);
  };
  anda(d,0);
  return out;
}
const _vazio=(v)=> v==null || String(v).trim()==='';
function _avaliaProp(c, d){
  const alvo=_nProp(c.valor), vals=_valoresProp(d, alvo).filter(v=>!_vazio(v));
  const op=c.op;
  if(op==='está vazia') return !vals.length;
  if(op==='está preenchida') return vals.length>0;
  const b=_norm(String(c.valor2==null?'':c.valor2).trim()); if(!b) return vals.length>0;
  if(op==='é') return vals.some(v=>_norm(String(v).trim())===b);
  if(op==='não é') return !vals.some(v=>_norm(String(v).trim())===b);
  if(op==='contém') return vals.some(v=>_norm(String(v)).includes(b));
  return false;
}
function _avaliaCond(c, ctx){
  const op=c.op, val=c.valor;
  switch(c.campo){
    case 'prop': return _avaliaProp(c, ctx.d);
    case 'classe':{ const rx=_classeRx(val); const hit=rx?rx.test(ctx.cat||''):false; return op==='não é'?!hit:hit; }
    case 'disciplina':{ const hit=ctx.disc.includes(_norm(val)); return op==='não é'?!hit:hit; }
    case 'pavimento':{
      if(c._idPav){   // resolvido pelo App: andares de cada modelo pareados com o cadastro
        const pv=(c._idPav[ctx.mi]||new Map()).get(ctx.id);
        if(op==='abaixo de'||op==='acima de'){ const re=c._rank[pv], ra=c._rank[c._alvo]; if(re==null||ra==null) return false; return op==='abaixo de'?re<ra:re>ra; }
        const hit=pv===c._alvo; return op==='não é'?!hit:hit; }
      if(op==='abaixo de'||op==='acima de'){ const ye=ctx.pavY?ctx.pavY(ctx.pav):null, ya=ctx.pavY?ctx.pavY(val):null;
        if(ye==null||ya==null) return false; return op==='abaixo de'?ye<ya:ye>ya; }
      const hit=_batePavim(ctx.pav, _norm(val)); return op==='não é'?!hit:hit; }
    case 'material':{ const syns=_matSyn(val).map(_norm);
      if(ctx.matDe && ctx.matDe.size){ const nomes=ctx.matDe.get(ctx.id)||[]; const hit=syns.some(t=>_matCasa(nomes,t)); return op==='não contém'?!hit:hit; }
      const mats=(ctx.d?_materiaisDe(ctx.d):[]).map(_norm);
      const hit=mats.some(m=>syns.some(s=>m.includes(s))) || (ctx.d?_bateTermos(ctx.d,_matSyn(val)):false);
      return op==='não contém'?!hit:hit; }
    case 'tipo':{ const pt=ctx.d?_achaValorQualquer(ctx.d,/^tipo$/i):null; const nome=_norm(_tipoNome(ctx.d))+(pt!=null?' | '+_norm(String(pt)):''); const b=_norm(val);
      if(pt!=null && (op==='é'?_norm(String(pt))===b:op==='começa com'?_norm(String(pt)).startsWith(b):_norm(String(pt)).includes(b))) return true;
      if(op==='começa com') return nome.startsWith(b);
      if(op==='é') return nome===b || (ctx.d?_bateTermos(ctx.d,['='+val]):false);
      return nome.includes(b) || (ctx.d?_bateTermos(ctx.d,[val]):false); }   // contém
    case 'dimensao':{ const subTermo={Altura:'height',Largura:'width',Espessura:'thickness',Comprimento:'length','Área':'area',Volume:'volume'};
      let r=ctx.d?_achaValorProfundo(ctx.d,_termoRegex(subTermo[c.sub]||c.sub||'')):null;
      if((!r||typeof r.val!=='number') && c.sub==='Volume' && ctx.vol!=null) r={val:ctx.vol};
      // Sem a propriedade no IFC (TQS/Revit não grava Height/Width nas vigas e
      // pilares) → mede na CAIXA 3D da peça. Antes devolvia false e o filtro
      // "vigas com altura > 0,10 m" dava 0. Y é o eixo vertical do Fragments.
      const esp=/esp/i.test(c.sub||'');
      if((!r||typeof r.val!=='number') && ctx.box){
        const b=ctx.box, h=b.max.y-b.min.y, dx=b.max.x-b.min.x, dz=b.max.z-b.min.z;
        const deitada=/^IFC(SLAB|ROOF|COVERING|PLATE)/.test(ctx.cat||'');   // laje/forro: espessura é a vertical
        const v = c.sub==='Altura' ? h : c.sub==='Comprimento' ? Math.max(dx,dz)
                : c.sub==='Largura' ? Math.min(dx,dz) : esp ? (deitada ? h : Math.min(dx,dz)) : null;
        if(v!=null && isFinite(v)) r={val:v};
      }
      if(!r||typeof r.val!=='number') return false;
      let x=r.val; if(esp) x=x*100;   // espessura: compara em cm (input em cm)
      const a=_numBR(val); if(isNaN(a)) return false;
      if(op==='maior que') return x>a;
      if(op==='menor que') return x<a;
      if(op==='entre'){ const b=_numBR(c.valor2); if(isNaN(b)) return x>=a; const lo=Math.min(a,b),hi=Math.max(a,b); return x>=lo&&x<=hi; }
      return false; }
  }
  return true;
}
// Lê itens em LOTES (paralelo) com opções custom — reusa _lerLotesPar.
async function _lerDadosEmLotes(V, model, ids, opts, rotulo){
  return _lerLotesPar(V, model, ids, opts, rotulo||'Filtrando');
}
export async function filtrar(V, filtro){
  V._cancelar=false;
  // Condição SEM valor é ignorada (não filtra nem lê dados) — assim "Classe é
  // Escada" + Material vazio roda tão rápido quanto só a classe.
  const conds=((filtro&&filtro.conds)||[]).filter(c=> c&&c.campo&&c.op && String(c.valor==null?'':c.valor).trim()!=='');
  const comb=(filtro&&filtro.comb)||'all';
  if(!conds.length) return {};
  // categorias candidatas: em modo E, restringe pela(s) classe(s) positiva(s)
  const classePos=conds.filter(c=>c.campo==='classe'&&(c.op==='é'||c.op==='é um de'));
  const regexes=(comb==='all'&&classePos.length)?classePos.map(c=>_classeRx(c.valor)).filter(Boolean):CAT_VISIVEIS;
  // pavimento por MEMBERSHIP (getSpatialStructure) — barato, sem ler Pset por elemento.
  const temPav=conds.some(c=>c.campo==='pavimento' && !c._idPav);
  const st=temPav?await _storeysMapa(V):[];
  const pavCheap=st.length>0;
  let pavYFn=null;
  if(conds.some(c=>c.campo==='pavimento'&&!c._idPav&&(c.op==='abaixo de'||c.op==='acima de'))){
    const fx=await _faixasPavimento(V);
    pavYFn=(nome)=>{ const f=(fx||[]).find(f=>_batePavim(_norm(f.nome),_norm(nome))); return f?f.y:null; };
  }
  // Divide as condições por CUSTO. Baratas (classe/disciplina/pavimento-por-membership)
  // não leem NADA do elemento → pré-filtram. As caras leem só o necessário, e SÓ dos
  // sobreviventes. Material casa nos ATRIBUTOS (como a IA por comando) — nada de
  // HasAssociations (que lia o modelo inteiro e travava). Pset só p/ dimensão (e
  // pavimento quando não há membership).
  const temMat=conds.some(c=>c.campo==='material');
  if(temMat){ for(const x of V.modelos){ try{ await _matIndice(x); }catch(_){} } }
  const matOk=temMat && V.modelos.every(x=>x._matDe && x._matDe.size);
  const ehBarata=(c)=> c.campo==='classe'||c.campo==='disciplina'||(c.campo==='pavimento'&&(pavCheap||c._idPav))||(c.campo==='material'&&matOk);
  const baratas=conds.filter(ehBarata), caras=conds.filter(c=>!ehBarata(c));
  const need={pset:false,tipo:false,mat:false};
  caras.forEach(c=>{ if(c.campo==='dimensao'||c.campo==='pavimento'||c.campo==='tipo'||c.campo==='prop') need.pset=true; if(c.campo==='tipo'||c.campo==='prop') need.tipo=true; if(c.campo==='material') need.mat=true; });
  const querVolMalha = caras.some(c=>c.campo==='dimensao'&&c.sub==='Volume');
  const querCaixa    = caras.some(c=>c.campo==='dimensao'&&/^(Altura|Largura|Comprimento|Espessura)$/.test(c.sub||''));
  const relations={};
  if(need.pset) relations.IsDefinedBy={attributes:true,relations:true};
  if(need.tipo) relations.IsTypedBy={attributes:true,relations:false};
  if(need.mat)  relations.HasAssociations={attributes:true,relations:true};   // material vive aqui (RelatingMaterial.Name)
  const readOpts={attributesDefault:true,relationsDefault:{attributes:false,relations:false}};
  if(Object.keys(relations).length) readOpts.relations=relations;
  const heavy=need.pset||need.mat;   // pset/associações → ler em LOTES (cancelável), mas só dos sobreviventes
  const lerDados=async(model, lista)=>{ const dOf=new Map(); if(!caras.length||!lista.length) return dOf;
    let dados=[];
    try{ dados = heavy ? await _lerDadosEmLotes(V, model, lista, readOpts, 'Filtrando')
                       : await model.getItemsData(lista, readOpts); }catch(e){ if(String(e&&e.message)==='CANCELADO') throw e; }
    (dados||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid!=null) dOf.set(lid,d); }); return dOf; };
  const porMod={};
  for(let mi=0; mi<V.modelos.length; mi++){
    if(V._cancelar) break;
    const x=V.modelos[mi]; const disc=_norm(x.disciplina||x.nome||'');
    let grp={}; try{ grp=await x.model.getItemsOfCategories(regexes)||{}; }catch(_){}
    const catOf=new Map(); let ids=[];
    for(const [cat,arr] of Object.entries(grp)){ (arr||[]).forEach(id=>{ catOf.set(id,cat); ids.push(id); }); }
    if(!ids.length) continue;
    const pavOf=new Map();
    if(temPav&&st.length){ st.filter(s=>s.mi===mi).forEach(s=> s.ids.forEach(id=> pavOf.set(id,s.nomeNorm))); }
    const volOf=new Map(); let boxOf=null;
    const ctx=(id,d)=>({ id, mi, matDe:x._matDe, cat:catOf.get(id), d, disc, pav: pavOf.has(id)?pavOf.get(id):(d?_pavimEl(d):''), pavY:pavYFn, vol: volOf.has(id)?volOf.get(id):null, box: boxOf?boxOf.get(id):null });
    // caixa 3D estável (cache do clash) — só p/ dimensão sem propriedade no IFC
    const lerCaixa=async(lista)=>{ if(querCaixa) boxOf=await _boxesCacheadas(V, mi, x, lista); };
    // volume da malha 3D por peça (só p/ "Dimensão Volume" e só dos candidatos)
    const lerVol=async(lista)=>{ if(!querVolMalha) return; for(let p=0;p<lista.length;p+=40){ if(V._cancelar) throw new Error('CANCELADO');
      await Promise.all(lista.slice(p,p+40).map(async id=>{ try{ volOf.set(id, +(await x.model.getItemsVolume([id]))||0); }catch(_){} })); } };
    try{
      if(comb==='all'){
        let cand = baratas.length ? ids.filter(id=> baratas.every(c=>_avaliaCond(c, ctx(id,null)))) : ids;
        if(!cand.length) continue;
        if(!caras.length){ porMod[mi]=cand; continue; }
        const dOf=await lerDados(x.model, cand); await lerVol(cand); await lerCaixa(cand);
        const ok=cand.filter(id=> caras.every(c=>_avaliaCond(c, ctx(id, dOf.get(id)))));
        if(ok.length) porMod[mi]=ok;
      } else {   // OU: precisa avaliar TODAS por elemento → lê dados (só o necessário)
        const dOf=await lerDados(x.model, ids); await lerVol(ids); await lerCaixa(ids);
        const ok=ids.filter(id=> conds.some(c=>_avaliaCond(c, ctx(id, dOf.get(id)))));
        if(ok.length) porMod[mi]=ok;
      }
    }catch(e){ if(String(e&&e.message)==='CANCELADO') break; }
  }
  return porMod;
}
// Conta quantos casam (sem mexer na cena) — p/ o "resultado" do painel.
export async function contarFiltro(V, filtro){
  const porMod=await filtrar(V, filtro); let n=0;
  for(const ids of Object.values(porMod)) n+=(ids?ids.length:0);
  return { n, porMod };
}
// Linhas detalhadas dos elementos de um porMod (p/ exportar planilha): lê
// atributos + Pset + tipo + material de cada elemento e monta uma linha.
export async function linhasFiltro(V, porMod){
  V._cancelar=false;
  const rxA=_termoRegex('area'), rxV=_termoRegex('volume'), rxL=_termoRegex('length');
  const rxPav=/piso|planta|pavim|storey|level|andar|n[íi]vel|nivel|eleva/i;
  const st=await _storeysMapa(V);
  const opts={ attributesDefault:true, relationsDefault:{attributes:false,relations:false},
    relations:{ IsDefinedBy:{attributes:true,relations:true}, IsTypedBy:{attributes:true,relations:false}, HasAssociations:{attributes:true,relations:true} } };
  const rows=[];
  for(const [mi,ids] of Object.entries(porMod||{})){
    if(V._cancelar) break;
    const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue;
    let grp={}; try{ grp=await x.model.getItemsOfCategories(CAT_VISIVEIS)||{}; }catch(_){}
    const catOf=new Map(); for(const [cat,arr] of Object.entries(grp)) (arr||[]).forEach(id=>catOf.set(id,cat));
    const pavOf=new Map(); st.filter(s=>s.mi==mi).forEach(s=> s.ids.forEach(id=> pavOf.set(id, s.nome)));
    let dd=[]; try{ dd=await _lerLotesPar(V, x.model, ids, opts, 'Exportando'); }catch(e){ if(String(e&&e.message)==='CANCELADO') break; }
    const dOf=new Map(); dd.forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid!=null) dOf.set(lid,d); });
    for(const id of ids){ const d=dOf.get(id);
      const rA=d?_achaValorProfundo(d,rxA):null, rV=d?_achaValorProfundo(d,rxV):null, rL=d?_achaValorProfundo(d,rxL):null;
      rows.push({
        nome:(d&&d.Name&&d.Name.value!=null)?String(d.Name.value):('#'+id),
        classe:catOf.get(id)||'', disciplina:x.disciplina||x.nome||'',
        pavimento:pavOf.get(id)||(d?String(_achaValorQualquer(d,rxPav)||''):''),
        tipo:d?_tipoNome(d):'', material:d?_materiaisDe(d).join(', '):'',
        area:(rA&&typeof rA.val==='number')?rA.val:'', volume:(rV&&typeof rV.val==='number')?rV.val:'', comprimento:(rL&&typeof rL.val==='number')?rL.val:''
      });
    }
  }
  return rows;
}
// Dados RICOS por elemento p/ o quantitativo por disciplina (esquadria/estrutura/
// covering): dimensões, área/volume, material/cor/acabamento, fck/cobrimento, local.
// Campos custom (cor/acabamento/fck/cobrimento) por heurística de nome de propriedade.
export async function linhasQuantitativo(V, porMod){
  V._cancelar=false;
  const RX={ larg:/width|largura/i, alt:/height|altura/i, esp:/thick|espessura/i, comp:/length|comprimento/i,
    area:/area/i, vol:/vol/i, cor:/\bcor\b|colou?r/i, acab:/acabament|finish/i,
    fck:/fck|compressive|strength|resist/i, cob:/cobrim|cover/i };
  const isFogo=(nm)=>/fogo|fire/i.test(nm||'');
  const grupoDe=(cat)=>{ if(/IFCDOOR|IFCWINDOW|IFCCURTAINWALL|IFCPLATE/.test(cat)) return 'esquadria';
    if(/IFCCOLUMN|IFCBEAM|IFCSLAB|IFCFOOTING|IFCPILE|IFCMEMBER/.test(cat)) return 'estrutura';
    if(/IFCCOVERING/.test(cat)) return 'covering'; return 'outros'; };
  const st=await _storeysMapa(V);
  const opts={ attributesDefault:true, relationsDefault:{attributes:false,relations:false},
    relations:{ IsDefinedBy:{attributes:true,relations:true}, IsTypedBy:{attributes:true,relations:false}, HasAssociations:{attributes:true,relations:true} } };
  const rows=[];
  for(const [mi,ids] of Object.entries(porMod||{})){
    if(V._cancelar) break;
    const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue;
    let grp={}; try{ grp=await x.model.getItemsOfCategories(CAT_VISIVEIS)||{}; }catch(_){}
    const catOf=new Map(); for(const [cat,arr] of Object.entries(grp)) (arr||[]).forEach(id=>catOf.set(id,cat));
    const pavOf=new Map(); st.filter(s=>s.mi==mi).forEach(s=> s.ids.forEach(id=> pavOf.set(id,s.nome)));
    let dd=[]; try{ dd=await _lerLotesPar(V, x.model, ids, opts, 'Exportando'); }catch(e){ if(String(e&&e.message)==='CANCELADO') break; }
    const dOf=new Map(); dd.forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid!=null) dOf.set(lid,d); });
    // Caixas p/ o volume geométrico de pilares/vigas (área da seção × comprimento).
    let boxes=[]; try{ boxes=await x.model.getBoxes(ids); }catch(_){}
    const boxOf=new Map(); ids.forEach((id,i)=>{ if(boxes&&boxes[i]) boxOf.set(id,boxes[i]); });
    for(const id of ids){ const d=dOf.get(id); const cat=catOf.get(id)||'';
      const numPref=(rx,excl)=>{ if(!d) return ''; const cs=_valoresProfundos(d,rx);
        if(rx===RX.area){ const g=_melhorArea(cs, cat); return g?g.val:''; }   // item 57
        const g=(excl?cs.find(c=>!excl(c.nome)):null)||cs.find(c=>/net/i.test(c.nome))||cs.find(c=>!/gross/i.test(c.nome))||cs[0]; return g?g.val:''; };
      const txt=(rx)=>{ if(!d) return ''; const v=_achaValorQualquer(d,rx); return v==null?'':String(v); };
      // aceita número OU texto numérico ("30", "30 cm") — TQS exporta dims como texto.
      const numAny=(rx)=>{ if(!d) return ''; const v=_achaValorQualquer(d,rx); if(v==null||v==='') return '';
        const f=parseFloat(String(v).replace(/[^\d.,-]/g,'').replace(',','.')); return isNaN(f)?'':f; };
      const cm=(v)=> v===''?'':(v<5?Math.round(v*100):Math.round(v));   // <5 => está em metros → cm
      const secB=cm(numAny(/dimensao_?b1?|\blargura\b|\bwidth\b/i));    // TQS: Dimensao_b1 (cm)
      const secH=cm(numAny(/dimensao_?h1?|\bprofundidade\b|\bdepth\b/i));   // TQS: Dimensao_h1
      const matNome=d?(_materiaisDe(d)[0]||''):'';
      let fck=''; { const mf=/\bC[-\s]?(\d{2,3})\b/i.exec(matNome); if(mf) fck=+mf[1]; else { const p=numPref(RX.fck,isFogo); if(p!=='') fck=p; } }
      const areaVal=numPref(RX.area);
      // Volume: da propriedade; se faltar E for LINEAR (pilar/viga/estaca), calcula
      // geométrico = área da seção × maior dimensão da caixa (comprimento). Laje NUNCA
      // é deduzida (nervurada tem vazio — vem só da propriedade). `volEstim` marca o
      // que foi calculado.
      let volume=numPref(RX.vol), volEstim=false;
      if((volume===''||volume==null) && /IFCCOLUMN|IFCBEAM|IFCMEMBER|IFCPILE/.test(cat)){
        const b=boxOf.get(id);
        let secA = (secB!==''&&secH!=='')? (secB*secH)/10000 : (typeof areaVal==='number'?areaVal:'');
        if(b&&b.min&&b.max&&secA!==''&&secA>0){ const len=Math.max(b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z);
          if(isFinite(len)&&len>0){ volume=Math.round(secA*len*1000)/1000; volEstim=true; } }
      }
      rows.push({
        grupo:grupoDe(cat), classe:cat,
        nome:_nomencl(d,id),
        pavimento:pavOf.get(id)||(d?String(_achaValorQualquer(d,/planta|piso|pavim|storey|level|andar|n[íi]vel/i)||''):''),
        larg:numAny(RX.larg), alt:numAny(RX.alt), esp:numAny(RX.esp), comp:numAny(RX.comp),
        secB, secH, area:areaVal, volume, volEstim,
        material:matNome, fckMat:fck, cor:txt(RX.cor), acabamento:txt(RX.acab),
        fck, cobrimento:numPref(RX.cob, isFogo)
      });
    }
  }
  return rows;
}
// DIAGNÓSTICO: lista TODAS as propriedades (Pset → prop = valor) + atributos do
// 1º elemento do porMod. Serve p/ descobrir onde o modelo guarda marca/seção/fck.
export async function diagPrimeiro(V, porMod){
  const escal=(o)=> (o&&typeof o==='object'&&'value' in o&&typeof o.value!=='object')?o.value:undefined;
  for(const [mi,ids] of Object.entries(porMod||{})){
    const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue;
    let da=[]; try{ da=await x.model.getItemsData([ids[0]],{ attributesDefault:true,
      relations:{ IsDefinedBy:{attributes:true,relations:true}, IsTypedBy:{attributes:true,relations:true}, HasAssociations:{attributes:true,relations:true} }, relationsDefault:{attributes:false,relations:false} }); }catch(e){ return 'erro: '+(e.message||e); }
    const d=(da||[])[0]; if(!d) continue;
    const linhas=[];
    for(const [k,v] of Object.entries(d)){
      if(Array.isArray(v)){ v.forEach(ps=>{ if(!ps||typeof ps!=='object') return; const nm=(ps.Name&&ps.Name.value)||k;
        for(const [k2,v2] of Object.entries(ps)){ if(k2==='Name') continue;
          if(Array.isArray(v2)){ v2.forEach(p=>{ if(!p||typeof p!=='object')return; const pn=p.Name&&p.Name.value; const pv=escal(p.NominalValue)??escal(p.Value)??escal(p.AreaValue)??escal(p.VolumeValue)??escal(p.LengthValue); if(pn!=null&&pv!=null) linhas.push(nm+' → '+pn+' = '+pv); }); }
          else { const vv=escal(v2); if(vv!=null&&vv!=='') linhas.push(nm+' → '+k2+' = '+vv); } } }); }
      else if(k[0]!=='_'){ const vv=escal(v); if(vv!=null&&vv!=='') linhas.push('(attr) '+k+' = '+vv); }
    }
    console.log('[AURIA DIAG] elemento cru:', d);
    return linhas.join('\n');
  }
  return 'sem elementos.';
}
// Aplica a AÇÃO sobre um porMod já calculado.
export async function isolarPorMod(V, porMod){
  const T=V.THREE; let total=0;
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
  for(const [mi,ids] of Object.entries(porMod||{})){ const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue; total+=ids.length;
    try{ await x.model.setVisible(ids,true); }catch(_){}
    try{ await x.model.highlight(ids,{color:new T.Color(LARANJA),renderedFaces:1,opacity:1,transparent:false}); }catch(_){} }
  if(total>0){ V._isolado=true; V._isoladoPorMod=porMod; V._ultimaSelecao=porMod; V._colorido=false; V._cores=null; }
  else { for(const x of V.modelos){ try{ await x.model.setVisible(undefined,true); }catch(_){} } }
  try{ await V.fragments.update(true); }catch(_){}
  if(total>0) await enquadrarIds(V, porMod);
  return total;
}
export async function ocultarPorMod(V, porMod){
  let total=0;
  for(const [mi,ids] of Object.entries(porMod||{})){ const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue; total+=ids.length;
    try{ await x.model.setVisible(ids,false); }catch(_){} }
  V._isolado=false; V._isoladoPorMod=null; V._ultimaSelecao=porMod; V._colorido=false; V._cores=null;
  try{ await V.fragments.update(true); }catch(_){}
  return total;
}
// Restaura o modelo cheio (limpa isolar/ocultar/colorir).
export async function limparFiltro(V){
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,true); }catch(_){} }
  V._isolado=false; V._isoladoPorMod=null; V._colorido=false; V._cores=null;
  try{ await V.fragments.update(true); }catch(_){}
}

// ── COLORIR (Round 3): recolore subconjuntos SEM esconder o resto ──────────
export const PALETA=[0xE8960A,0x22D3EE,0x8B5CF6,0x10B981,0xEF4444,0xF59E0B,0x3B82F6,0xEC4899,0x84CC16,0x14B8A6,0xA855F7,0xF97316,0x0EA5E9,0x64748B];
async function _reaplicarCores(V){
  const T=V.THREE;
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,true); }catch(_){} }
  for(const g of (V._cores||[])){
    for(const [mi,ids] of Object.entries(g.porMod||{})){ const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue;
      try{ await x.model.highlight(ids, { color:new T.Color(g.cor), renderedFaces:1, opacity:1, transparent:false }); }catch(_){}
    }
  }
}
// Pinta UM grupo de uma cor (acumula sobre o que já estiver pintado).
export async function colorirGrupo(V, porMod, cor){
  V._isolado=false; V._isoladoPorMod=null; V._colorido=true; V._ultimaSelecao=porMod;
  V._cores = V._cores || [];
  V._cores.push({ porMod, cor });
  await _reaplicarCores(V);
  try{ await V.fragments.update(true); }catch(_){}
  let n=0; for(const ids of Object.values(porMod||{})) n+=(ids?ids.length:0); return n;
}
// Colore a ÚLTIMA SELEÇÃO (o que foi isolado/achado por último) de uma cor, e
// volta a mostrar o modelo inteiro. "selecionar X → colorir seleção de azul".
export async function colorirSelecao(V, cor){
  if(!V._ultimaSelecao) return { n:0, semSel:true };
  const n=await colorirGrupo(V, V._ultimaSelecao, cor);
  return { n };
}
// Colore o modelo inteiro por CATEGORIA (uma cor por tipo). Retorna a legenda.
export async function colorirPorCategoria(V, cats){
  V._isolado=false; V._isoladoPorMod=null; V._cores=[];
  const legenda=[];
  for(let i=0;i<cats.length;i++){
    if(V._cancelar) break;
    const porMod=await acharElementos(V, [cats[i].regex], [], null);
    let n=0; for(const ids of Object.values(porMod)) n+=ids.length;
    if(n>0){ const cor=PALETA[legenda.length%PALETA.length]; V._cores.push({porMod, cor}); legenda.push({label:cats[i].label, cor, n}); }
  }
  V._colorido=true;
  await _reaplicarCores(V);
  try{ await V.fragments.update(true); }catch(_){}
  return legenda;
}
// ── CLASH (fase ampla / broad-phase por caixa envolvente AABB) ─────────────
// Quais das categorias têm elementos no modelo (p/ montar o menu só com o que existe).
export async function categoriasPresentes(V, lista){
  // UMA chamada por modelo com a UNIÃO de todas as categorias — antes era uma
  // chamada `getItemsOfCategories` por categoria × modelo (sequencial), o que
  // deixava a abertura do menu de clash lenta. Aqui pegamos tudo de uma vez e
  // contamos por categoria localmente.
  const todasRx=[];
  lista.forEach(item=> item.rx.split(',').forEach(c=>{ const t=c.trim(); if(t) todasRx.push(new RegExp('^'+t+'$','i')); }));
  const contagem=new Map();   // nome-da-categoria → total de itens no conjunto federado
  for(const x of V.modelos){
    let porCat={}; try{ porCat=await x.model.getItemsOfCategories(todasRx)||{}; }catch(_){}
    for(const [cat, ids] of Object.entries(porCat)){
      contagem.set(cat, (contagem.get(cat)||0) + (ids ? ids.length : 0));
    }
  }
  const out=[];
  for(const item of lista){
    const rxs=item.rx.split(',').map(c=>new RegExp('^'+c.trim()+'$','i'));
    let n=0;
    for(const [cat, cnt] of contagem){ if(rxs.some(r=>r.test(cat))) n+=cnt; }
    if(n>0) out.push({ ...item, n });
  }
  return out;
}
// Coleta {mi,id,caixa} de um conjunto de categorias.
async function _caixasDe(V, regexes){
  const arr=[];
  for(let mi=0; mi<V.modelos.length; mi++){
    const x=V.modelos[mi];
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(regexes)||{}).flat(); }catch(_){}
    if(!ids.length) continue;
    const cache = await _boxesCacheadas(V, mi, x, ids);
    ids.forEach(id=>{ const b=cache.get(id); if(b) arr.push({mi,id,b}); });
  }
  return arr;
}
// Caixas envolventes ESTÁVEIS por modelo. O `getBoxes` do Fragments varia com os
// tiles que a câmera já carregou (streaming/LOD do `useCamera`): medir a cada
// clash dava caixas diferentes p/ os MESMOS elementos → o clash oscilava ao
// repetir, e inverter A/B (lógica simétrica) mudava a resposta. Aqui cada caixa
// é medida UMA vez e guardada em `V._boxCache[mi]`; toda execução de clash reusa
// a MESMA caixa → resultado repetível e simétrico. Só cacheamos caixas VÁLIDAS
// (finitas): se um item ainda não tinha geometria carregada, ele é remedido na
// próxima passada (converge p/ completo em vez de travar num valor degenerado).
// Invalidado ao federar/descarregar, junto dos outros caches.
async function _boxesCacheadas(V, mi, x, ids){
  if(!V._boxCache) V._boxCache={};
  let m=V._boxCache[mi]; if(!m){ m=new Map(); V._boxCache[mi]=m; }
  const faltam = ids.filter(id=>!m.has(id));
  if(faltam.length){
    try{ await V.fragments.update(true); }catch(_){}   // melhor chance de a geometria estar carregada
    let boxes=[]; try{ boxes=await x.model.getBoxes(faltam); }catch(_){}
    faltam.forEach((id,i)=>{ const b=(boxes||[])[i];
      if(b && isFinite(b.min.x) && isFinite(b.max.x)) m.set(id, b); });
  }
  return m;
}
// ── FASE FINA DO CLASH (2026-11-15) ─────────────────────────────────────────
// A fase larga (caixas) marcava como conflito tudo que caía dentro da CAIXA da
// outra peça: no Q Tower, ELE×EST deu 830 eletrodutos × lajes e 34 × pilares,
// TODOS falsos — as lajes "Piso" são faixas estreitas (9,8 m² de laje numa caixa
// de 110 m²) e os pilares irregulares (L/U) têm caixa muito maior que a peça.
// Aqui cada par candidato é confirmado na GEOMETRIA REAL (triângulos):
//   1. triângulos de cada peça que caem na sobreposição das caixas;
//   2. aresta×triângulo (as superfícies se cruzam?) ou peça contida na outra
//      (teste de paridade de raio); nenhum dos dois → FALSO, sai da lista;
//   3. profundidade = maior distância de um ponto de uma peça, dentro da outra,
//      até a superfície dela; ≤ tolerância → só ENCOSTA, sai da lista.
// ATENÇÃO: getItemsGeometry devolve no sistema do MODELO, sem o deslocamento da
// federação (model.object.matrixWorld — no Q Tower o EST vem deslocado 14,5 m);
// por isso as duas matrizes são aplicadas.
const _ID4=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function _mul4(a,b){ const r=new Array(16);
  for(let c=0;c<4;c++) for(let l=0;l<4;l++) r[c*4+l]=a[l]*b[c*4]+a[4+l]*b[c*4+1]+a[8+l]*b[c*4+2]+a[12+l]*b[c*4+3];
  return r; }
// Triângulos em MUNDO por peça (Float64Array, 9 números por triângulo), cacheados
// como as caixas. Peça sem geometria não entra no cache (fica "não verificada").
async function _trisCacheados(V, mi, ids){
  if(!V._triCache) V._triCache={};
  let m=V._triCache[mi]; if(!m){ m=new Map(); V._triCache[mi]=m; }
  const faltam=ids.filter(id=>!m.has(id)); if(!faltam.length) return m;
  const x=V.modelos[mi]; const o=x.model.object;
  try{ o.updateMatrixWorld(true); }catch(_){}
  const W=(o&&o.matrixWorld&&o.matrixWorld.elements)||_ID4;
  for(let p=0;p<faltam.length;p+=100){
    const lote=faltam.slice(p,p+100); let geo=[];
    try{ geo=await x.model.getItemsGeometry(lote); }catch(_){ continue; }
    for(let i=0;i<lote.length;i++){
      const partes=(geo&&geo[i])||[]; let n=0;
      for(const g of partes) if(g&&g.indices&&g.positions) n+=g.indices.length;
      if(!n) continue;
      const t=new Float64Array(n*3); let k=0;
      for(const g of partes){ const P=g&&g.positions, I=g&&g.indices; if(!P||!I) continue;
        const e=(g.transform&&g.transform.elements)||(Array.isArray(g.transform)&&g.transform.length===16?g.transform:_ID4);
        const M=_mul4(W,e);
        for(let j=0;j<I.length;j++){ const q=3*I[j], X=P[q],Y=P[q+1],Z=P[q+2];
          t[k++]=M[0]*X+M[4]*Y+M[8]*Z+M[12]; t[k++]=M[1]*X+M[5]*Y+M[9]*Z+M[13]; t[k++]=M[2]*X+M[6]*Y+M[10]*Z+M[14]; } }
      m.set(lote[i], t);
    }
  }
  return m;
}
// Índices dos triângulos de `t` cuja caixa toca a caixa `b` ({x0,y0,z0,x1,y1,z1}).
function _trisNaCaixa(t, b){ const out=[];
  const ix=_indiceXZ(t), bb=ix.bb, visto=new Set();
  const i0=Math.max(0,Math.floor((b.x0-ix.x0)/ix.s)), i1=Math.min(ix.nx-1,Math.floor((b.x1-ix.x0)/ix.s));
  const j0=Math.max(0,Math.floor((b.z0-ix.z0)/ix.s)), j1=Math.min(ix.nz-1,Math.floor((b.z1-ix.z0)/ix.s));
  for(let a=i0;a<=i1;a++) for(let c=j0;c<=j1;c++){ const l=ix.cel.get(a*ix.nz+c); if(!l) continue;
    for(const k of l){ if(visto.has(k)) continue; visto.add(k);
      if(bb[6*k+1]<b.x0||bb[6*k]>b.x1||bb[6*k+3]<b.y0||bb[6*k+2]>b.y1||bb[6*k+5]<b.z0||bb[6*k+4]>b.z1) continue;
      out.push(9*k); } }
  return out; }
// Raio (origem o, direção d) × triângulo em t[i..i+8] (Möller–Trumbore). Devolve o parâmetro do raio ou -1.
function _raioTri(ox,oy,oz, dx,dy,dz, t, i){
  const ax=t[i],ay=t[i+1],az=t[i+2];
  const e1x=t[i+3]-ax,e1y=t[i+4]-ay,e1z=t[i+5]-az, e2x=t[i+6]-ax,e2y=t[i+7]-ay,e2z=t[i+8]-az;
  const hx=dy*e2z-dz*e2y, hy=dz*e2x-dx*e2z, hz=dx*e2y-dy*e2x; const det=e1x*hx+e1y*hy+e1z*hz;
  if(det>-1e-12 && det<1e-12) return -1; const f=1/det;
  const sx=ox-ax,sy=oy-ay,sz=oz-az; const u=f*(sx*hx+sy*hy+sz*hz); if(u<0||u>1) return -1;
  const qx=sy*e1z-sz*e1y, qy=sz*e1x-sx*e1z, qz=sx*e1y-sy*e1x; const v=f*(dx*qx+dy*qy+dz*qz); if(v<0||u+v>1) return -1;
  return f*(e2x*qx+e2y*qy+e2z*qz); }
// Índice em PLANTA (grade XZ) dos triângulos de uma malha, cacheado por malha:
// lajes chegam a 25 mil triângulos e testar todos por ponto deixava 1.645 pares
// lajes×tubos em minutos. Cada célula guarda os triângulos cuja caixa a cobre.
const _idxXZ=new WeakMap();
function _indiceXZ(t){
  let ix=_idxXZ.get(t); if(ix) return ix;
  const n=t.length/9; let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
  for(let i=0;i<t.length;i+=3){ const x=t[i], z=t[i+2]; if(x<x0)x0=x; if(x>x1)x1=x; if(z<z0)z0=z; if(z>z1)z1=z; }
  const W=Math.max(1e-3,x1-x0), D=Math.max(1e-3,z1-z0);
  let s=Math.max(0.05, Math.sqrt(W*D/Math.max(1,n/2)));
  while((W/s)*(D/s)>65536) s*=1.5;
  const nx=Math.max(1,Math.ceil(W/s)), nz=Math.max(1,Math.ceil(D/s));
  const cel=new Map(); const yMax=new Float64Array(n), bb=new Float64Array(n*6);
  for(let k=0;k<n;k++){ const i=9*k;
    const a0=Math.min(t[i],t[i+3],t[i+6]), a1=Math.max(t[i],t[i+3],t[i+6]);
    const b0=Math.min(t[i+1],t[i+4],t[i+7]), b1=Math.max(t[i+1],t[i+4],t[i+7]);
    const c0=Math.min(t[i+2],t[i+5],t[i+8]), c1=Math.max(t[i+2],t[i+5],t[i+8]);
    bb.set([a0,a1,b0,b1,c0,c1], 6*k); yMax[k]=b1;
    const i0=Math.max(0,Math.floor((a0-x0)/s)), i1=Math.min(nx-1,Math.floor((a1-x0)/s));
    const j0=Math.max(0,Math.floor((c0-z0)/s)), j1=Math.min(nz-1,Math.floor((c1-z0)/s));
    for(let a=i0;a<=i1;a++) for(let c=j0;c<=j1;c++){ const key=a*nz+c; let l=cel.get(key); if(!l){ l=[]; cel.set(key,l); } l.push(k); } }
  ix={ x0,z0,s,nx,nz,cel,bb,yMax }; _idxXZ.set(t, ix); return ix; }
// Ponto dentro da malha fechada `t`? Paridade de cruzamentos de um raio VERTICAL
// (+Y), só com os triângulos da coluna do ponto. O ponto é deslocado uma fração
// de mícron p/ o raio não passar exatamente por arestas de geometria ortogonal.
function _dentroMalha(px,py,pz, t){
  const ix=_indiceXZ(t); px+=3.1e-7; pz+=1.7e-7;
  const a=Math.floor((px-ix.x0)/ix.s), c=Math.floor((pz-ix.z0)/ix.s);
  if(a<0||c<0||a>=ix.nx||c>=ix.nz) return false;
  const l=ix.cel.get(a*ix.nz+c); if(!l) return false;
  let n=0;
  for(const k of l){ if(ix.yMax[k]<py) continue; const s=_raioTri(px,py,pz, 0,1,0, t, 9*k); if(s>1e-9) n++; }
  return (n&1)===1; }
// Distância do ponto à superfície de `t`, mas só procurando até `lim`: devolve
// `lim` se nenhum triângulo estiver mais perto (= o ponto está mais fundo que lim).
function _distAte(px,py,pz, t, lim){
  const ix=_indiceXZ(t); let d=lim;
  const i0=Math.max(0,Math.floor((px-lim-ix.x0)/ix.s)), i1=Math.min(ix.nx-1,Math.floor((px+lim-ix.x0)/ix.s));
  const j0=Math.max(0,Math.floor((pz-lim-ix.z0)/ix.s)), j1=Math.min(ix.nz-1,Math.floor((pz+lim-ix.z0)/ix.s));
  const visto=new Set();
  for(let a=i0;a<=i1;a++) for(let c=j0;c<=j1;c++){ const l=ix.cel.get(a*ix.nz+c); if(!l) continue;
    for(const k of l){ if(visto.has(k)) continue; visto.add(k); const b=ix.bb;
      if(px<b[6*k]-d||px>b[6*k+1]+d||py<b[6*k+2]-d||py>b[6*k+3]+d||pz<b[6*k+4]-d||pz>b[6*k+5]+d) continue;
      const e=_distPtTri(px,py,pz,t,9*k); if(e<d) d=e; } }
  return d; }
// Alguma aresta de um triângulo atravessa o outro? (cobre o cruzamento não coplanar)
function _triTri(ta, ia, tb, ib){
  for(let r=0;r<2;r++){ const T1=r?tb:ta, i1=r?ib:ia, T2=r?ta:tb, i2=r?ia:ib;
    for(let e=0;e<3;e++){ const p=i1+3*e, q=i1+3*((e+1)%3);
      const dx=T1[q]-T1[p], dy=T1[q+1]-T1[p+1], dz=T1[q+2]-T1[p+2];
      const s=_raioTri(T1[p],T1[p+1],T1[p+2], dx,dy,dz, T2, i2); if(s>=0 && s<=1) return true; } }
  return false; }
// Distância de um ponto ao triângulo t[i..] (ponto mais próximo — Ericson, RTCD 5.1.5).
function _distPtTri(px,py,pz, t, i){
  const ax=t[i],ay=t[i+1],az=t[i+2], bx=t[i+3],by=t[i+4],bz=t[i+5], cx=t[i+6],cy=t[i+7],cz=t[i+8];
  const abx=bx-ax,aby=by-ay,abz=bz-az, acx=cx-ax,acy=cy-ay,acz=cz-az, apx=px-ax,apy=py-ay,apz=pz-az;
  const d1=abx*apx+aby*apy+abz*apz, d2=acx*apx+acy*apy+acz*apz; let qx,qy,qz;
  if(d1<=0&&d2<=0){ qx=ax;qy=ay;qz=az; }
  else { const bpx=px-bx,bpy=py-by,bpz=pz-bz; const d3=abx*bpx+aby*bpy+abz*bpz, d4=acx*bpx+acy*bpy+acz*bpz;
    if(d3>=0&&d4<=d3){ qx=bx;qy=by;qz=bz; }
    else { const vc=d1*d4-d3*d2;
      if(vc<=0&&d1>=0&&d3<=0){ const v=d1/(d1-d3); qx=ax+v*abx;qy=ay+v*aby;qz=az+v*abz; }
      else { const cpx=px-cx,cpy=py-cy,cpz=pz-cz; const d5=abx*cpx+aby*cpy+abz*cpz, d6=acx*cpx+acy*cpy+acz*cpz;
        if(d6>=0&&d5<=d6){ qx=cx;qy=cy;qz=cz; }
        else { const vb=d5*d2-d1*d6;
          if(vb<=0&&d2>=0&&d6<=0){ const w=d2/(d2-d6); qx=ax+w*acx;qy=ay+w*acy;qz=az+w*acz; }
          else { const va=d3*d6-d5*d4;
            if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){ const w=(d4-d3)/((d4-d3)+(d5-d6)); qx=bx+w*(cx-bx);qy=by+w*(cy-by);qz=bz+w*(cz-bz); }
            else { const den=1/(va+vb+vc), v=vb*den, w=vc*den; qx=ax+abx*v+acx*w;qy=ay+aby*v+acy*w;qz=az+abz*v+acz*w; } } } } } }
  _QX=qx; _QY=qy; _QZ=qz;
  return Math.hypot(px-qx,py-qy,pz-qz); }
let _QX=0,_QY=0,_QZ=0;   // ponto mais próximo da última _distPtTri
// Menor distância entre os segmentos p1-q1 e p2-q2 (Ericson, RTCD 5.1.9); grava os
// dois pontos mais próximos em _S1/_S2.
const _S1=[0,0,0], _S2=[0,0,0];
function _distSegSeg(p1x,p1y,p1z,q1x,q1y,q1z, p2x,p2y,p2z,q2x,q2y,q2z){
  const d1x=q1x-p1x,d1y=q1y-p1y,d1z=q1z-p1z, d2x=q2x-p2x,d2y=q2y-p2y,d2z=q2z-p2z, rx=p1x-p2x,ry=p1y-p2y,rz=p1z-p2z;
  const a=d1x*d1x+d1y*d1y+d1z*d1z, e=d2x*d2x+d2y*d2y+d2z*d2z, f=d2x*rx+d2y*ry+d2z*rz;
  let s=0,t=0; const cl=(v)=>v<0?0:(v>1?1:v);
  if(a<=1e-12 && e<=1e-12){ s=t=0; }
  else if(a<=1e-12){ s=0; t=cl(f/e); }
  else { const c=d1x*rx+d1y*ry+d1z*rz;
    if(e<=1e-12){ t=0; s=cl(-c/a); }
    else { const b=d1x*d2x+d1y*d2y+d1z*d2z, den=a*e-b*b;
      s = den>1e-12 ? cl((b*f-c*e)/den) : 0;
      t=(b*s+f)/e;
      if(t<0){ t=0; s=cl(-c/a); } else if(t>1){ t=1; s=cl((b-c)/a); } } }
  _S1[0]=p1x+d1x*s; _S1[1]=p1y+d1y*s; _S1[2]=p1z+d1z*s; _S2[0]=p2x+d2x*t; _S2[1]=p2y+d2y*t; _S2[2]=p2z+d2z*t;
  return Math.hypot(_S1[0]-_S2[0], _S1[1]-_S2[1], _S1[2]-_S2[2]); }
// Menor distância entre duas malhas, procurando só até `lim` (devolve lim se não
// houver nada mais perto). Triângulo×triângulo = 0 se cruzam; senão o menor entre
// vértice×triângulo (6) e aresta×aresta (9). Grava o ponto médio do trecho mais curto.
function _distMalhas(ta, tb, ba, bb, lim){
  const reg={ x0:Math.max(ba.min.x,bb.min.x)-lim, y0:Math.max(ba.min.y,bb.min.y)-lim, z0:Math.max(ba.min.z,bb.min.z)-lim,
              x1:Math.min(ba.max.x,bb.max.x)+lim, y1:Math.min(ba.max.y,bb.max.y)+lim, z1:Math.min(ba.max.z,bb.max.z)+lim };
  const fa=_trisNaCaixa(ta, reg), fb=_trisNaCaixa(tb, reg);
  let d=lim, pt=null; if(!fa.length || !fb.length) return { d, pt };
  const bxB=fb.map(i=>[Math.min(tb[i],tb[i+3],tb[i+6]),Math.max(tb[i],tb[i+3],tb[i+6]),Math.min(tb[i+1],tb[i+4],tb[i+7]),Math.max(tb[i+1],tb[i+4],tb[i+7]),Math.min(tb[i+2],tb[i+5],tb[i+8]),Math.max(tb[i+2],tb[i+5],tb[i+8])]);
  const melhor=(x1,y1,z1,x2,y2,z2,e)=>{ if(e<d){ d=e; pt={x:(x1+x2)/2,y:(y1+y2)/2,z:(z1+z2)/2}; } };
  for(const ia of fa){
    const ax0=Math.min(ta[ia],ta[ia+3],ta[ia+6]), ax1=Math.max(ta[ia],ta[ia+3],ta[ia+6]), ay0=Math.min(ta[ia+1],ta[ia+4],ta[ia+7]), ay1=Math.max(ta[ia+1],ta[ia+4],ta[ia+7]), az0=Math.min(ta[ia+2],ta[ia+5],ta[ia+8]), az1=Math.max(ta[ia+2],ta[ia+5],ta[ia+8]);
    for(let j=0;j<fb.length;j++){ const q=bxB[j], ib=fb[j];
      if(ax1+d<q[0]||ax0-d>q[1]||ay1+d<q[2]||ay0-d>q[3]||az1+d<q[4]||az0-d>q[5]) continue;
      if(_triTri(ta, ia, tb, ib)){ d=0; pt={x:(Math.max(ax0,q[0])+Math.min(ax1,q[1]))/2, y:(Math.max(ay0,q[2])+Math.min(ay1,q[3]))/2, z:(Math.max(az0,q[4])+Math.min(az1,q[5]))/2}; return { d, pt }; }
      for(let v=0;v<3;v++){
        const x=ta[ia+3*v],y=ta[ia+3*v+1],z=ta[ia+3*v+2]; const e1=_distPtTri(x,y,z,tb,ib); melhor(x,y,z,_QX,_QY,_QZ,e1);
        const X=tb[ib+3*v],Y=tb[ib+3*v+1],Z=tb[ib+3*v+2]; const e2=_distPtTri(X,Y,Z,ta,ia); melhor(X,Y,Z,_QX,_QY,_QZ,e2); }
      for(let u=0;u<3;u++){ const p=ia+3*u, pq=ia+3*((u+1)%3);
        for(let w=0;w<3;w++){ const r=ib+3*w, rq=ib+3*((w+1)%3);
          const e=_distSegSeg(ta[p],ta[p+1],ta[p+2],ta[pq],ta[pq+1],ta[pq+2], tb[r],tb[r+1],tb[r+2],tb[rq],tb[rq+1],tb[rq+2]);
          melhor(_S1[0],_S1[1],_S1[2],_S2[0],_S2[1],_S2[2],e); } } } }
  return { d, pt }; }
// Pontos de amostra dos triângulos `idx` de `t`, só os que caem na caixa `b`,
// com espaçamento adaptado à área (no máx. ~`cap` pontos).
function _amostrasNaCaixa(t, idx, b, cap){
  let area=0; const ar=idx.map(i=>{ const ux=t[i+3]-t[i],uy=t[i+4]-t[i+1],uz=t[i+5]-t[i+2], vx=t[i+6]-t[i],vy=t[i+7]-t[i+1],vz=t[i+8]-t[i+2];
    const a=Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx)/2; area+=a; return a; });
  const passo=Math.max(0.01, Math.sqrt(area/Math.max(1,cap)));
  const pts=[]; const dentro=(x,y,z)=>x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1&&z>=b.z0&&z<=b.z1;
  idx.forEach(i=>{ const L=Math.max(Math.hypot(t[i+3]-t[i],t[i+4]-t[i+1],t[i+5]-t[i+2]), Math.hypot(t[i+6]-t[i],t[i+7]-t[i+1],t[i+8]-t[i+2]), Math.hypot(t[i+6]-t[i+3],t[i+7]-t[i+4],t[i+8]-t[i+5]));
    const n=Math.min(40, Math.max(1, Math.ceil(L/passo)));
    for(let u=0;u<=n;u++) for(let v=0;v<=n-u;v++){ const w=n-u-v;
      const x=(t[i]*u+t[i+3]*v+t[i+6]*w)/n, y=(t[i+1]*u+t[i+4]*v+t[i+7]*w)/n, z=(t[i+2]*u+t[i+5]*v+t[i+8]*w)/n;
      if(dentro(x,y,z)) pts.push(x,y,z); } });
  return pts; }
// Pontos de `pts` dentro da malha `t`: maior profundidade (distância à superfície)
// e centro dos pontos internos. Profundidade medida até PROF_MAX (acima disso,
// "≥ 50 cm"). Para cedo quando já tem pontos de sobra e passou da tolerância.
const PROF_MAX=0.5;
function _penetracao(pts, t, tol){
  let prof=0, sx=0,sy=0,sz=0, n=0;
  for(let k=0;k<pts.length;k+=3){ const x=pts[k],y=pts[k+1],z=pts[k+2];
    if(!_dentroMalha(x,y,z,t)) continue;
    n++; sx+=x; sy+=y; sz+=z;
    if(prof<PROF_MAX){ const d=_distAte(x,y,z,t,PROF_MAX); if(d>prof) prof=d; }
    if(n>=200 && prof>tol) break; }
  return { prof, n, c: n?{x:sx/n,y:sy/n,z:sz/n}:null }; }
// Confirma um par na geometria. Retorna {tipo:'real'|'toque'|'falso'|'semGeo', prof, pt}.
function _parFino(ta, tb, ba, bb, tol){
  if(!ta || !tb) return { tipo:'semGeo', prof:0, pt:null };
  const e=0.002;
  const ov={ x0:Math.max(ba.min.x,bb.min.x)-e, y0:Math.max(ba.min.y,bb.min.y)-e, z0:Math.max(ba.min.z,bb.min.z)-e,
             x1:Math.min(ba.max.x,bb.max.x)+e, y1:Math.min(ba.max.y,bb.max.y)+e, z1:Math.min(ba.max.z,bb.max.z)+e };
  const fa=_trisNaCaixa(ta, ov), fb=_trisNaCaixa(tb, ov);
  // 1) as superfícies se cruzam?
  let cruza=false;
  if(fa.length && fb.length){
    const bxB=fb.map(i=>[Math.min(tb[i],tb[i+3],tb[i+6]),Math.max(tb[i],tb[i+3],tb[i+6]),Math.min(tb[i+1],tb[i+4],tb[i+7]),Math.max(tb[i+1],tb[i+4],tb[i+7]),Math.min(tb[i+2],tb[i+5],tb[i+8]),Math.max(tb[i+2],tb[i+5],tb[i+8])]);
    for(const ia of fa){ if(cruza) break;
      const ax0=Math.min(ta[ia],ta[ia+3],ta[ia+6]), ax1=Math.max(ta[ia],ta[ia+3],ta[ia+6]), ay0=Math.min(ta[ia+1],ta[ia+4],ta[ia+7]), ay1=Math.max(ta[ia+1],ta[ia+4],ta[ia+7]), az0=Math.min(ta[ia+2],ta[ia+5],ta[ia+8]), az1=Math.max(ta[ia+2],ta[ia+5],ta[ia+8]);
      for(let j=0;j<fb.length;j++){ const q=bxB[j];
        if(ax1<q[0]||ax0>q[1]||ay1<q[2]||ay0>q[3]||az1<q[4]||az0>q[5]) continue;
        if(_triTri(ta, ia, tb, fb[j])){ cruza=true; break; } } }
  }
  // 2) uma dentro da outra (sem cruzar superfície)?
  if(!cruza){
    const contida=(fa.length && _dentroMalha(ta[fa[0]],ta[fa[0]+1],ta[fa[0]+2], tb)) || (fb.length && _dentroMalha(tb[fb[0]],tb[fb[0]+1],tb[fb[0]+2], ta));
    if(!contida) return { tipo:'falso', prof:0, pt:null };
  }
  // 3) quanto entra: pontos de A dentro de B e de B dentro de A
  const pa=_penetracao(_amostrasNaCaixa(ta, fa, ov, 1500), tb, tol);
  const pb=pa.prof>tol ? {prof:0,n:0,c:null} : _penetracao(_amostrasNaCaixa(tb, fb, ov, 1500), ta, tol);
  const prof=Math.max(pa.prof, pb.prof);
  const pt=pa.c||pb.c||{ x:(ov.x0+ov.x1)/2, y:(ov.y0+ov.y1)/2, z:(ov.z0+ov.z1)/2 };
  return { tipo: prof>tol ? 'real' : 'toque', prof, pt };
}

// Conflitos entre A e B. Fase larga: pares cujas CAIXAS se interpenetram além da
// tolerância `tol` (m), com grade uniforme. Fase fina: cada candidato é confirmado
// na geometria real (ver acima). Retorna os elementos envolvidos por modelo, p/ destacar.
// nCand = candidatos pela caixa; nPares = confirmados (+ os sem geometria, nSemGeo).
// FOLGA MÍNIMA (`folga`, m; 0/ausente = não verifica): pares que NÃO conflitam mas
// ficam a menos de `folga` um do outro entram como achado de folga (p.folga=true,
// p.dist = distância medida na geometria); contados em nFolga, fora de nPares.
export async function clashCandidatos(V, regexesA, regexesB, tol, folga){
  V._cancelar=false; tol = (tol==null?0.01:tol); folga = (folga>0 ? folga : 0);
  const A=await _caixasDe(V, regexesA), B=await _caixasDe(V, regexesB);
  if(!A.length || !B.length) return { nPares:0, nCand:0, nFolga:0, nA:0, nB:0, vazioA:!A.length, vazioB:!B.length, porModA:{}, porModB:{} };
  const cell=2.0, grid=new Map();
  const cellsOf=(b,m)=>{ const out=[]; m=m||0;
    for(let cx=Math.floor((b.min.x-m)/cell);cx<=Math.floor((b.max.x+m)/cell);cx++)
    for(let cy=Math.floor((b.min.y-m)/cell);cy<=Math.floor((b.max.y+m)/cell);cy++)
    for(let cz=Math.floor((b.min.z-m)/cell);cz<=Math.floor((b.max.z+m)/cell);cz++) out.push(cx+'|'+cy+'|'+cz);
    return out; };
  B.forEach((it,bi)=>{ for(const k of cellsOf(it.b)){ let a=grid.get(k); if(!a){a=[];grid.set(k,a);} a.push(bi); } });
  const inter=(a,b)=>{ return (Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x))>tol
    && (Math.min(a.max.y,b.max.y)-Math.max(a.min.y,b.min.y))>tol
    && (Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z))>tol; };
  // perto: as caixas ficam a menos de `folga` (candidato só à verificação de folga)
  const perto=(a,b)=>(Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x))>-folga
    && (Math.min(a.max.y,b.max.y)-Math.max(a.min.y,b.min.y))>-folga
    && (Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z))>-folga;
  // Fase larga: candidatos pela caixa (cands) e só por proximidade (candsF).
  const cands=[], candsF=[];
  for(let ai=0; ai<A.length; ai++){
    if(V._cancelar) throw new Error('CANCELADO');
    const it=A[ai]; const cand=new Set();
    for(const k of cellsOf(it.b, folga)){ const arr=grid.get(k); if(arr) for(const bi of arr) cand.add(bi); }
    for(const bi of cand){ const jb=B[bi];
      if(jb.mi===it.mi && jb.id===it.id) continue;              // não conflita consigo mesmo
      if(inter(it.b, jb.b)) cands.push([it, jb]);
      else if(folga && perto(it.b, jb.b)) candsF.push([it, jb]);
    }
    if(ai%150===0){ if(V.on&&V.on.dica) V.on.dica('Verificando conflitos… '+ai+'/'+A.length); await new Promise(r=>setTimeout(r,0)); }
  }
  // Fase fina: geometria real de quem é candidato (uma leitura por peça, cacheada).
  const idsGeo={};
  cands.concat(candsF).forEach(([a,b])=>{ (idsGeo[a.mi]=idsGeo[a.mi]||new Set()).add(a.id); (idsGeo[b.mi]=idsGeo[b.mi]||new Set()).add(b.id); });
  const tri={};
  for(const [mi,set] of Object.entries(idsGeo)){
    if(V.on&&V.on.dica) V.on.dica('Lendo geometria dos candidatos… ('+cands.length+' pares)');
    tri[mi]=await _trisCacheados(V, +mi, [...set]);
  }
  const porModA={}, porModB={}; const vA=new Set(), vB=new Set(); let nPares=0, nToque=0, nFalso=0, nSemGeo=0, nFolga=0;
  const marca=(it,jb)=>{ const ka=it.mi+':'+it.id; if(!vA.has(ka)){ vA.add(ka); (porModA[it.mi]=porModA[it.mi]||[]).push(it.id); }
    const kb=jb.mi+':'+jb.id; if(!vB.has(kb)){ vB.add(kb); (porModB[jb.mi]=porModB[jb.mi]||[]).push(jb.id); } };
  const folgas=[];   // achados de folga (vão para a lista depois dos conflitos)
  const testaFolga=(it,jb)=>{ const ta=tri[it.mi].get(it.id), tb=tri[jb.mi].get(jb.id); if(!ta||!tb) return;
    const m=_distMalhas(ta, tb, it.b, jb.b, folga); if(m.d>=folga) return;
    nFolga++; marca(it,jb);
    if(m.pt) V._clashPt.set(it.mi+':'+it.id+'|'+jb.mi+':'+jb.id, m.pt);
    if(folgas.length<CAP) folgas.push({ aMi:it.mi, aId:it.id, bMi:jb.mi, bId:jb.id, y:m.pt?m.pt.y:(it.b.min.y+it.b.max.y)/2, folga:true, dist:m.d, folgaMin:folga }); };
  const pares=[]; const CAP=400;   // lista individual (limitada p/ não travar a UI)
  if(!V._clashPt) V._clashPt=new Map();
  let t0=performance.now();
  for(let ci=0; ci<cands.length; ci++){
    if(V._cancelar) throw new Error('CANCELADO');
    const [it, jb]=cands[ci];
    const r=_parFino(tri[it.mi].get(it.id), tri[jb.mi].get(jb.id), it.b, jb.b, tol);
    if(r.tipo==='falso'){ nFalso++; if(folga) testaFolga(it,jb); }
    else if(r.tipo==='toque'){ nToque++; if(folga) testaFolga(it,jb); }
    else {
      nPares++; if(r.tipo==='semGeo') nSemGeo++;
      marca(it,jb);
      if(r.pt) V._clashPt.set(it.mi+':'+it.id+'|'+jb.mi+':'+jb.id, r.pt);
      if(pares.length<CAP) pares.push({ aMi:it.mi, aId:it.id, bMi:jb.mi, bId:jb.id,
        y: r.pt ? r.pt.y : (Math.max(it.b.min.y,jb.b.min.y)+Math.min(it.b.max.y,jb.b.max.y))/2,
        prof: r.tipo==='semGeo' ? null : r.prof, semGeo: r.tipo==='semGeo' });
    }
    if(performance.now()-t0>60){ t0=performance.now();
      if(V.on&&V.on.dica) V.on.dica('Conferindo na geometria… '+ci+'/'+cands.length);
      await new Promise(r=>setTimeout(r,0)); }
  }
  for(let ci=0; ci<candsF.length; ci++){
    if(V._cancelar) throw new Error('CANCELADO');
    testaFolga(candsF[ci][0], candsF[ci][1]);
    if(performance.now()-t0>60){ t0=performance.now();
      if(V.on&&V.on.dica) V.on.dica('Medindo folgas… '+ci+'/'+candsF.length);
      await new Promise(r=>setTimeout(r,0)); }
  }
  folgas.sort((a,b)=>a.dist-b.dist);
  pares.push(...folgas);   // até CAP conflitos + até CAP folgas (as mais apertadas primeiro)
  // Nomes dos envolvidos (limitado aos que estão na lista) p/ rotular cada conflito.
  const idsPorMod={};
  pares.forEach(p=>{ (idsPorMod[p.aMi]=idsPorMod[p.aMi]||new Set()).add(p.aId); (idsPorMod[p.bMi]=idsPorMod[p.bMi]||new Set()).add(p.bId); });
  const nomeMap={};
  for(const [mi,set] of Object.entries(idsPorMod)){
    const x=V.modelos[mi]; if(!x) continue; const ids=[...set];
    let da=[]; try{ da=await x.model.getItemsData(ids,{attributesDefault:true,relationsDefault:{attributes:false,relations:false}}); }catch(_){}
    (da||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return;
      const nm=(d.Name&&d.Name.value)||(d.ObjectType&&d.ObjectType.value)||('#'+lid);
      nomeMap[mi+':'+lid]=String(nm).split(':')[0]; });
  }
  pares.forEach(p=>{ p.aNome=nomeMap[p.aMi+':'+p.aId]||('#'+p.aId); p.bNome=nomeMap[p.bMi+':'+p.bId]||('#'+p.bId); });
  // Pavimento de cada conflito (pela altura do cruzamento): sem ele a lista era
  //  300 linhas iguais "Tipos de tubos × TQS - Viga retangular".
  let fx=[]; try{ fx=_faixasUnicas(await _faixasPavimento(V)); }catch(_){}
  pares.forEach(p=>{ const f=_faixaNoY(fx, p.y); p.pav=f?f.nome:''; });
  return { nPares, nCand:cands.length, nToque, nFalso, nSemGeo, nFolga, nA:vA.size, nB:vB.size, porModA, porModB, pares };
}
// Botão de CONTEXTO (🗺️): reexibe o MODELO TODO mantendo o par aceso, SEM mexer
// na câmera — o prédio "materializa" ao redor do conflito na vista atual. Leve.
export async function mostrarClashModeloTodo(V, aMi, aId, bMi, bId){
  const T=V.THREE;
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,true); }catch(_){} }
  try{ await V.modelos[aMi].model.highlight([aId],{color:new T.Color(0xEF4444),renderedFaces:1,opacity:1,transparent:false}); }catch(_){}
  try{ await V.modelos[bMi].model.highlight([bId],{color:new T.Color(0x22D3EE),renderedFaces:1,opacity:1,transparent:false}); }catch(_){}
  V._isolado=false; V._isoladoPorMod=null; V._colorido=false; V._cores=null;
  try{ await V.fragments.update(true); }catch(_){}
}
// Restaura a opacidade do fantasma anterior (só nos ids que mexemos — preciso).
async function _limparFantasma(V){
  if(V._fantasmaIds){ for(const [mi,ids] of Object.entries(V._fantasmaIds)){ const x=V.modelos[mi]; if(x&&ids&&ids.length){ try{ await x.model.setOpacity(ids,1); }catch(_){} try{ await x.model.resetOpacity(ids); }catch(_){} } } }
  V._fantasmaIds=null; V._fantasma=false;
}
// Botão de CONTEXTO (◌/🗺️): mostra SÓ a vizinhança do conflito, translúcida,
// com o par OPACO em vermelho/ciano, e leva a câmera até o ponto.
//  2026-11-15: antes o resto do prédio ficava OPACO e a câmera não se mexia —
//  pela Revisão (sem zoom antes) o par ficava escondido dentro do prédio. Agora:
//  · centro = ponto medido na geometria (pontoClash), não o meio das caixas;
//  · caixas do CACHE do clash (getBoxes cru varia com os tiles da câmera);
//  · o que está fora do raio some (setVisible), o que está dentro fica 12%;
//  · teto de peças pelas MAIS PRÓXIMAS (antes o 1º modelo gastava o teto).
export async function mostrarClashFantasma(V, aMi, aId, bMi, bId){
  await _tirarAntiga(V);
  const T=V.THREE;
  await _limparFantasma(V);
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} }
  const pt=await pontoClash(V, aMi, aId, bMi, bId);
  const R=6, TETO=1500;   // 6 m ao redor do conflito; no máx. 1500 peças translúcidas
  const cand=[];          // [dist², mi, id]
  if(pt){
    for(let mi=0; mi<V.modelos.length; mi++){ const x=V.modelos[mi];
      let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(CAT_VISIVEIS)||{}).flat(); }catch(_){}
      if(!ids.length) continue;
      const bx=await _boxesCacheadas(V, mi, x, ids);
      for(const id of ids){ const b=bx.get(id); if(!b) continue;
        if((mi===aMi&&id===aId)||(mi===bMi&&id===bId)) continue;
        // distância do ponto à CAIXA (0 se dentro): peça longa que passa perto entra
        const dx=Math.max(b.min.x-pt.x,0,pt.x-b.max.x), dy=Math.max(b.min.y-pt.y,0,pt.y-b.max.y), dz=Math.max(b.min.z-pt.z,0,pt.z-b.max.z);
        const d2=dx*dx+dy*dy+dz*dz; if(d2<=R*R) cand.push([d2,mi,id]); }
    }
  }
  cand.sort((u,v)=>u[0]-v[0]); if(cand.length>TETO) cand.length=TETO;
  const fant={}; for(const [,mi,id] of cand) (fant[mi]=fant[mi]||[]).push(id);
  const vis={}; for(const [mi,ids] of Object.entries(fant)) vis[mi]=ids.slice();
  (vis[aMi]=vis[aMi]||[]).push(aId); (vis[bMi]=vis[bMi]||[]).push(bId);
  for(let mi=0; mi<V.modelos.length; mi++){ const x=V.modelos[mi];
    try{ await x.model.setVisible(undefined,false); }catch(_){}
    if(vis[mi]&&vis[mi].length){ try{ await x.model.setVisible(vis[mi],true); }catch(_){} }
    if(fant[mi]&&fant[mi].length){ try{ await x.model.setOpacity(fant[mi], 0.12); }catch(_){} }
  }
  V._fantasmaIds=fant;
  // par: opaco + cor
  try{ await V.modelos[aMi].model.setOpacity([aId],1); await V.modelos[aMi].model.highlight([aId],{color:new T.Color(0xEF4444),renderedFaces:1,opacity:1,transparent:false}); }catch(_){}
  try{ await V.modelos[bMi].model.setOpacity([bId],1); await V.modelos[bMi].model.highlight([bId],{color:new T.Color(0x22D3EE),renderedFaces:1,opacity:1,transparent:false}); }catch(_){}
  V._isolado=true; V._isoladoPorMod=vis; V._ultimaSelecao=vis; V._colorido=false; V._cores=null; V._fantasma=true;
  try{ await V.fragments.update(true); }catch(_){}
  if(pt) enquadrarPonto(V, pt, 3);   // câmera no conflito com uns metros de entorno
  try{ await V.fragments.update(true); }catch(_){}
  return { n: cand.length };
}
// Ponto (centro) de um conflito, em coordenadas de mundo — p/ ancorar o pino do apontamento.
export async function pontoClash(V, aMi, aId, bMi, bId){
  const T=V.THREE;
  // Ponto medido na geometria pela fase fina (centro da parte de uma peça que está dentro da outra).
  const fino=V._clashPt && (V._clashPt.get(aMi+':'+aId+'|'+bMi+':'+bId) || V._clashPt.get(bMi+':'+bId+'|'+aMi+':'+aId));
  if(fino) return { x:fino.x, y:fino.y, z:fino.z };
  const caixa=async(mi,id)=>{ try{ const bs=await V.modelos[mi].model.getBoxes([id]); const b=(bs||[])[0]; if(b) return new T.Box3(new T.Vector3(b.min.x,b.min.y,b.min.z), new T.Vector3(b.max.x,b.max.y,b.max.z)); }catch(_){} return null; };
  const bA=await caixa(aMi,aId), bB=await caixa(bMi,bId);
  if(!bA || !bB) return (bA||bB)?.getCenter(new T.Vector3()) || null;
  // Centro da INTERSEÇÃO = onde as duas peças de fato se cruzam (o clash).
  // O centro da UNIÃO (antigo) dava o meio-termo entre elas — pino fora do
  // ponto do conflito, ex.: tubo longo cruzando porta.
  const inter=bA.clone().intersect(bB);
  if(!inter.isEmpty()){ const c=inter.getCenter(new T.Vector3()); return { x:c.x, y:c.y, z:c.z }; }
  // Sem sobreposição real (caso da tolerância): meio-termo entre os centros.
  const ca=bA.getCenter(new T.Vector3()), cb=bB.getCenter(new T.Vector3());
  return { x:(ca.x+cb.x)/2, y:(ca.y+cb.y)/2, z:(ca.z+cb.z)/2 };
}
// Mostra o resultado do clash: isola os envolvidos, A em vermelho, B em ciano.
export async function mostrarClash(V, porModA, porModB){
  await _tirarAntiga(V);
  const T=V.THREE;
  if(V._fantasma) await _limparFantasma(V);
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
  for(const [mi,ids] of Object.entries(porModA||{})){ const x=V.modelos[mi]; if(!x||!ids.length) continue; try{ await x.model.setVisible(ids,true); }catch(_){} try{ await x.model.highlight(ids,{color:new T.Color(0xEF4444),renderedFaces:1,opacity:1,transparent:false}); }catch(_){} }
  for(const [mi,ids] of Object.entries(porModB||{})){ const x=V.modelos[mi]; if(!x||!ids.length) continue; try{ await x.model.setVisible(ids,true); }catch(_){} try{ await x.model.highlight(ids,{color:new T.Color(0x22D3EE),renderedFaces:1,opacity:1,transparent:false}); }catch(_){} }
  const uni={}; for(const [mi,ids] of Object.entries(porModA||{})){ (uni[mi]=uni[mi]||[]).push(...ids); } for(const [mi,ids] of Object.entries(porModB||{})){ (uni[mi]=uni[mi]||[]).push(...ids); }
  V._isolado=true; V._isoladoPorMod=uni; V._ultimaSelecao=uni; V._colorido=false; V._cores=null;
  try{ await V.fragments.update(true); }catch(_){}
  await enquadrarIds(V, uni);   // zoom-extend nos conflitos
}
export async function limparDestaqueCategoria(V){
  await _tirarAntiga(V);
  await _limparFantasma(V);
  V._isolado=false; V._isoladoPorMod=null; V._colorido=false; V._cores=null;
  for(const x of V.modelos){
    try{ await x.model.resetHighlight(); }catch(_){}
    try{ await x.model.setVisible(undefined, true); }catch(_){}   // reexibe tudo
  }
  try{ await V.fragments.update(true); }catch(_){}
}

// ── PÉ-DIREITO MÍNIMO (regra de conformidade) ──────────────────────────────
//  Altura livre em cada trecho = fundo do obstáculo suspenso − topo da laje do
//  pavimento. Onde < mínimo (padrão 2,30 m), sinaliza. É por ELEMENTO (viga,
//  duto, tubo, forro, laje) — a varredura em grade (qualquer ponto) fica p/ fase 2.
//
//  A seleção de disciplina vira seleção de MODELOS (cada disciplina federada é um
//  modelo); as categorias "suspensas" são UNIVERSAIS (cada modelo só devolve as
//  que tem). Paredes/pilares/portas/mobiliário ficam de fora — vão do piso ao teto
//  e dariam falso positivo.
const PD_CATS = [/^IFCBEAM$/,/^IFCSLAB$/,/^IFCCOVERING$/,/^IFCDUCTSEGMENT$/,/^IFCDUCTFITTING$/,
  /^IFCPIPESEGMENT$/,/^IFCPIPEFITTING$/,/^IFCFLOWSEGMENT$/,/^IFCFLOWFITTING$/,
  /^IFCCABLECARRIERSEGMENT$/,/^IFCCABLESEGMENT$/,/^IFCLIGHTFIXTURE$/,
  /^IFCFLOWTERMINAL$/,/^IFCAIRTERMINAL$/,/^IFCMEMBER$/];
const PD_ROT = { IFCBEAM:'Viga', IFCSLAB:'Laje', IFCCOVERING:'Forro', IFCDUCTSEGMENT:'Duto',
  IFCDUCTFITTING:'Conexão de duto', IFCPIPESEGMENT:'Tubo', IFCPIPEFITTING:'Conexão',
  IFCFLOWSEGMENT:'Tubo', IFCFLOWFITTING:'Conexão', IFCCABLECARRIERSEGMENT:'Eletrocalha',
  IFCCABLESEGMENT:'Cabo', IFCLIGHTFIXTURE:'Luminária', IFCFLOWTERMINAL:'Terminal',
  IFCAIRTERMINAL:'Difusor', IFCMEMBER:'Elemento' };
export async function verificarPeDireito(V, opts){
  V._cancelar=false;
  // INTERVALO de altura livre [altMin, altMax): foca o pé-direito quase-no-limite
  // (2,00–2,30) e não afoga o analista com tubo/encaminhamento rente ao chão
  // (0,9 m), que também importa mas é outra fatia. O piso do intervalo substitui
  // o antigo corte fixo.
  let altMin=(opts&&opts.altMin!=null)?+opts.altMin:2.00;
  let altMax=(opts&&opts.altMax!=null)?+opts.altMax:2.30;
  if(altMin>altMax){ const t=altMin; altMin=altMax; altMax=t; }   // tolera inverter
  const modelIdx=(opts&&opts.modelIdx)||null;   // índices de V.modelos a varrer; null = todos
  const pav=(opts&&opts.pav)||null;             // nome do pavimento; null = todos
  const faixas=_faixasUnicas(await _faixasPavimento(V));
  if(!faixas.length) return { erroFaixas:true, achados:[], total:0 };
  const achados=[];
  for(let mi=0; mi<V.modelos.length; mi++){
    if(modelIdx && !modelIdx.includes(mi)) continue;
    const x=V.modelos[mi]; const disc=x.disciplina||x.nome||'';
    let porCat={}; try{ porCat=await x.model.getItemsOfCategories(PD_CATS)||{}; }catch(_){}
    for(const [cat, ids] of Object.entries(porCat)){
      if(!ids||!ids.length) continue;
      const catU=String(cat).toUpperCase();
      for(let s=0; s<ids.length; s+=400){
        if(V._cancelar) throw new Error('CANCELADO');
        const lote=ids.slice(s,s+400);
        let boxes=[]; try{ boxes=await x.model.getBoxes(lote); }catch(_){}
        lote.forEach((id,i)=>{
          const b=(boxes||[])[i]; if(!b||!isFinite(b.min.y)) return;
          const cy=(b.min.y+b.max.y)/2; const fx=_faixaNoY(faixas,cy); if(!fx) return;
          if(pav && fx.nome!==pav) return;   // varredura só do pavimento escolhido
          const clear=b.min.y-fx.y;   // fundo do elemento − topo da laje (piso do nível)
          if(clear>=altMin && clear<altMax){
            achados.push({ mi, id, cat:catU, catLbl:PD_ROT[catU]||catU, disc,
              clear, piso:fx.y, botY:b.min.y, x:(b.min.x+b.max.x)/2, z:(b.min.z+b.max.z)/2, pav:fx.nome||'' });
          }
        });
        if(V.on&&V.on.dica) V.on.dica('Verificando pé-direito… '+(s+lote.length));
        await new Promise(r=>setTimeout(r,0));
      }
    }
  }
  achados.sort((a,b)=>a.clear-b.clear);
  const CAP=300; const cortou=achados.length>CAP; const lista=achados.slice(0,CAP);
  // nomes só dos infratores (bloco por modelo)
  const idsPorMod={}; lista.forEach(a=>{ (idsPorMod[a.mi]=idsPorMod[a.mi]||new Set()).add(a.id); });
  for(const [mi,set] of Object.entries(idsPorMod)){
    const x=V.modelos[mi]; if(!x) continue; const ids=[...set]; const nm={};
    let da=[]; try{ da=await x.model.getItemsData(ids,{attributesDefault:true,relationsDefault:{attributes:false,relations:false}}); }catch(_){}
    (da||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return;
      nm[lid]=String((d.Name&&d.Name.value)||(d.ObjectType&&d.ObjectType.value)||('#'+lid)).split(':')[0]; });
    lista.forEach(a=>{ if(a.mi==mi) a.nome=nm[a.id]||('#'+a.id); });
  }
  return { achados:lista, total:achados.length, cortou, altMin, altMax };
}
// Cota VERTICAL (90°) gerada por código: linha yA→yB no (x,z), rótulo com o texto.
// Vira uma "medida" normal (some/reaparece na tela junto com as outras); marcada
// com _peDireito p/ o limparPeDireito remover só essas.
export function cotaVertical(V, x, yA, yB, z, texto, tag){
  const T=V.THREE, M=V.medida;
  const a=new T.Vector3(x,yA,z), b=new T.Vector3(x,yB,z);
  const mk=(p)=>{ const e=new T.Mesh(new T.SphereGeometry(1,10,10), new T.MeshBasicMaterial({color:LARANJA,depthTest:false})); e.position.copy(p); e.renderOrder=999; V.scene.add(e); return e; };
  const m1=mk(a), m2=mk(b);
  const linha=new T.Line(new T.BufferGeometry().setFromPoints([a,b]), new T.LineBasicMaterial({color:LARANJA,depthTest:false})); linha.renderOrder=999; V.scene.add(linha);
  const el=document.createElement('div'); el.className='bim3dCota';
  el.style.cssText='position:absolute;z-index:3;transform:translate(-50%,-50%);pointer-events:none;'
    +'background:rgba(239,68,68,.95);color:#fff;font-size:11px;font-weight:700;padding:2px 6px;'
    +'border-radius:5px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4)';
  el.textContent=texto; V.cont.appendChild(el);
  const medida={ id:(++M._seq), marks:[m1,m2], line:linha, el, meio:a.clone().add(b).multiplyScalar(0.5), dist:Math.abs(yB-yA), texto, visivel:true, _peDireito:!!tag };
  M.medidas.push(medida);
  return medida;
}
// ── Nível (cota Z) ──────────────────────────────────────────────────────────
// Formata uma elevação como cota de projeto: sinal explícito, 2 casas, "m".
//  +1,55 m · −0,53 m · ±0,00 m (menos tipográfico e ± p/ ficar limpo).
export function fmtCotaZ(v){
  const n=Math.abs(Math.round(v*100)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  return (Math.abs(v)<0.005 ? '±' : (v>0?'+':'−')) + n + ' m';
}
// Deslocamento vertical do recentro do Fragments (autoCoordinate). baseCoordinates
// guarda [tx,ty,tz, ...orientação] do 1º modelo em Y-up; o Fragments soma isso ao
// posicionar, então worldY = cotaReal + ty. Calibrado com o modelo (topo da laje do
// térreo: worldY = baseCoordinates[1] → cota 0). Subtraindo ty volto à coordenada
// NATIVA do IFC — igual em App/CDE e independente da ordem de carga.
function _cotaOffsetBase(V){
  try{ const bc=V.fragments && V.fragments.baseCoordinates; if(bc && bc.length>=2 && isFinite(+bc[1])) return +bc[1]; }catch(_){}
  return 0;
}
// Cota Z (elevação REAL, coordenada nativa do IFC) de um ponto.
export function cotaZ(V, ponto, modelo){
  return ponto.y - _cotaOffsetBase(V) - (V.nivelZero||0);
}
// Reancora a malha na cota 0 do projeto (que no mundo fica em baseCoordinates[1],
// por causa do recentro do Fragments). Chamada após a carga (a config pode ter
// criado a malha antes de o baseCoordinates existir).
function _reposicionarGrade(V){
  if(V._grade){ try{ V._grade.position.y = _cotaOffsetBase(V) - 0.005; }catch(_){} }
}
// Fixa um SÍMBOLO DE NÍVEL (▽) no ponto clicado, com a cota. Vira uma "medida"
// normal (aparece na lista, some/reaparece, apagável no ×). A cota é o Z real do
// IFC (ver cotaZ), então bate entre App e CDE e com o modelo TQS.
export function marcarNivel(V, ponto, modelo){
  const T=V.THREE, M=V.medida;
  const p=ponto.clone();
  const cota=cotaZ(V, p, modelo);
  const esf=new T.Mesh(new T.SphereGeometry(1,12,12), new T.MeshBasicMaterial({color:0x2563EB,depthTest:false}));
  esf.position.copy(p); esf.renderOrder=999; V.scene.add(esf);
  const texto=fmtCotaZ(cota);
  const el=document.createElement('div'); el.className='bim3dNivel';
  el.style.cssText='position:absolute;z-index:3;transform:translate(-50%,-135%);pointer-events:auto;'
    +'background:rgba(37,99,235,.96);color:#fff;font-size:12px;font-weight:800;padding:2px 5px 2px 7px;'
    +'border-radius:5px;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.45);display:flex;align-items:center;gap:5px';
  el.innerHTML='<span style="opacity:.9;font-size:11px">▽</span><span>'+texto+'</span>'
    +'<span class="x" title="Apagar esta cota" style="cursor:pointer;font-weight:800;font-size:13px;line-height:1;opacity:.7;padding:0 1px">×</span>';
  V.cont.appendChild(el);
  const medida={ id:(++M._seq), marks:[esf], line:null, el, meio:p.clone(), dist:0, texto, cotaZ:cota, visivel:true, _nivel:true };
  el.querySelector('.x').addEventListener('click',(e)=>{ e.stopPropagation(); removerMedida(V, medida); if(V.on.medidas) V.on.medidas(V); });
  M.medidas.push(medida);
  if(V.on.medidas) V.on.medidas(V);
  return medida;
}
export async function limparPeDireito(V){
  await _tirarAntiga(V);
  _limparMapaPd(V); await _limparFantasma(V);
  (V.medida.medidas||[]).slice().forEach(md=>{ if(md._peDireito) removerMedida(V, md); });
  if(V.on.medidas) V.on.medidas(V);
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,true); }catch(_){} }
  V._isolado=false; V._isoladoPorMod=null; V._colorido=false; V._cores=null;
  try{ await V.fragments.update(true); }catch(_){}
}
// Mostra os infratores em VERMELHO sobre o modelo completo (contexto ajuda no
// pé-direito) + uma cota vertical em cada + zoom-extend no conjunto.
export async function mostrarPeDireito(V, achados){
  await _tirarAntiga(V);
  const T=V.THREE;
  await limparPeDireito(V);
  const porMod={}; (achados||[]).forEach(a=>{ (porMod[a.mi]=porMod[a.mi]||[]).push(a.id); });
  for(const [mi,ids] of Object.entries(porMod)){ const x=V.modelos[mi]; if(!x||!ids.length) continue;
    try{ await x.model.highlight(ids,{color:new T.Color(0xEF4444),renderedFaces:1,opacity:1,transparent:false}); }catch(_){} }
  (achados||[]).forEach(a=>{ try{ cotaVertical(V, a.x, a.piso, a.botY, a.z, fmtDist(a.clear), true); }catch(_){} });
  if(V.on.medidas) V.on.medidas(V);
  try{ await V.fragments.update(true); }catch(_){}
  if(Object.keys(porMod).length) await enquadrarIds(V, porMod);
}
// ── COMPARAR REVISÕES (2026-11-15) ─────────────────────────────────────────
//  A revisão ANTIGA de um modelo aberto é carregada pelo mesmo motor, mas FORA
//  de V.modelos (nenhuma outra análise a enxerga) e fora da cena; só entra na
//  cena, com as peças escolhidas, quando um achado pede o fantasma dela.
//  Casa as peças pelo GlobalId; se menos de 30% casar (exportador que gera
//  GlobalId novo a cada exportação), casa pela POSIÇÃO: mesma classe e caixa
//  igual dentro da tolerância.
export async function abrirRevisaoAntiga(V, m){
  if(V._cmp && V._cmp.id===m.id) return V._cmp;
  await fecharRevisaoAntiga(V);
  const bytes=await _baixar(m);
  const model=await V.fragments.load(bytes,{ modelId:opts_id(V)+':cmp:'+m.id, camera:V.camera });
  V._cmp={ id:m.id, nome:m.nome||'', revisao:m.revisao||'', model, _boxes:null };
  try{ await V.fragments.update(true); }catch(_){}
  return V._cmp;
}
export async function fecharRevisaoAntiga(V){
  const c=V._cmp; if(!c) return; V._cmp=null;
  try{ V.scene.remove(c.model.object); }catch(_){}
  try{ await c.model.dispose(); }catch(_){}
  if(V.modelos.length){ try{ await V.fragments.update(true); }catch(_){} }
}
async function _tirarAntiga(V){
  const c=V._cmp; if(!c||!c.model.object.parent) return;
  try{ V.scene.remove(c.model.object); }catch(_){}
  try{ await c.model.resetHighlight(); }catch(_){}
}
const _CMP_FORA=/^IFC(SPACE|OPENINGELEMENT|ANNOTATION|GRID|SITE|BUILDING|BUILDINGSTOREY|PROJECT|VIRTUALELEMENT)$/;
async function _pecasRev(V, model, boxesCache){
  const ids=await model.getItemsIdsWithGeometry(); const tem=new Set(ids), cat=new Map();
  Object.entries(await model.getItemsOfCategories([/^IFC/])||{}).forEach(([k,v])=>{ const K=String(k).toUpperCase();
    if(!_ehElemento(K)||_CMP_FORA.test(K)) return; (v||[]).forEach(i=>{ if(tem.has(i)) cat.set(i,K); }); });
  const lista=ids.filter(i=>cat.has(i));
  let guids=[]; try{ guids=await model.getGuidsByLocalIds(lista)||[]; }catch(_){}
  const box=new Map();
  if(boxesCache){ for(const id of lista){ const b=boxesCache.get(id); if(b) box.set(id,b); } }
  else { let bs=[]; try{ bs=await model.getBoxes(lista)||[]; }catch(_){} lista.forEach((id,i)=>{ const b=bs[i]; if(b&&isFinite(b.min.x)&&isFinite(b.max.x)) box.set(id,b); }); }
  return { lista, cat, guid:new Map(lista.map((id,i)=>[id,guids[i]||null])), box };
}
// Propriedades "achatadas" (atributos + Psets) p/ comparar: nome → valor em texto.
function _propsPlanas(d){
  const out=new Map(); if(!d) return out;
  const esc=(o)=> (o && typeof o==='object' && 'value' in o && typeof o.value!=='object') ? o.value : undefined;
  for(const [k,v] of Object.entries(d)){ if(k[0]==='_'||Array.isArray(v)||k==='GlobalId') continue; const x=esc(v); if(x!==undefined) out.set(k, String(x)); }
  for(const ps of (d.IsDefinedBy||[])){ if(!ps||typeof ps!=='object') continue; const pn=(ps.Name&&ps.Name.value)||'';
    for(const lst of [ps.HasProperties, ps.Quantities]) for(const p of (lst||[])){ if(!p||!p.Name) continue;
      let v=esc(p.NominalValue); if(v===undefined) for(const [k,w] of Object.entries(p)){ if(/Value$/.test(k)){ const x=esc(w); if(x!==undefined){ v=x; break; } } }
      if(v===undefined) continue; if(typeof v==='number') v=Math.round(v*1e4)/1e4;
      out.set((pn?pn+'.':'')+p.Name.value, String(v)); } }
  return out;
}
const _ROT_REV={ novo:'Novas', removido:'Removidas', deslocado:'Deslocadas', modificado:'Geometria mudada', props:'Propriedade mudada' };
export async function compararRevisoes(V, mi, opts){
  V._cancelar=false; const t0=performance.now();
  const x=V.modelos[mi], c=V._cmp; if(!x||!c) return { erro:'Abra o modelo e a revisão antiga.' };
  const tol=Math.max(0.001,(opts&&opts.tol!=null)?+opts.tol:0.01), comProps=!!(opts&&opts.props);
  const dica=(t)=>{ if(V.on&&V.on.dica) V.on.dica(t); };
  dica('Comparando revisões: lendo a revisão atual…');
  const idsN=(await x.model.getItemsIdsWithGeometry())||[];
  const N=await _pecasRev(V, x.model, await _boxesCacheadas(V, mi, x, idsN));
  dica('Comparando revisões: lendo a '+(c.revisao||'revisão antiga')+'…');
  if(!c._pecas) c._pecas=await _pecasRev(V, c.model, null);
  const O=c._pecas;
  // 1) GlobalId
  const porGuid=new Map(); O.lista.forEach(id=>{ const g=O.guid.get(id); if(g) porGuid.set(g,id); });
  let pares=[]; const usadoO=new Set(), usadoN=new Set();
  N.lista.forEach(id=>{ const g=N.guid.get(id), o=g&&porGuid.get(g); if(o!=null){ pares.push([id,o]); usadoO.add(o); usadoN.add(id); } });
  let porPosicao=false;
  const base=Math.min(N.lista.length,O.lista.length);
  if(base && pares.length < 0.3*base){
    // 2) posição: mesma classe + caixa igual (tolerância), por grade de centros
    porPosicao=true; pares=[]; usadoO.clear(); usadoN.clear();
    const tp=Math.max(tol,0.02), cel=Math.max(0.05,tp*2), grade=new Map();
    const ctr=(b)=>[(b.min.x+b.max.x)/2,(b.min.y+b.max.y)/2,(b.min.z+b.max.z)/2];
    const key=(a,b,d)=>a+'|'+b+'|'+d;
    O.lista.forEach(id=>{ const b=O.box.get(id); if(!b) return; const [cx,cy,cz]=ctr(b);
      const k=key(Math.floor(cx/cel),Math.floor(cy/cel),Math.floor(cz/cel)); let l=grade.get(k); if(!l){ l=[]; grade.set(k,l); } l.push(id); });
    for(const id of N.lista){ const b=N.box.get(id); if(!b) continue; const [cx,cy,cz]=ctr(b), ct=N.cat.get(id);
      const i0=Math.floor(cx/cel), j0=Math.floor(cy/cel), k0=Math.floor(cz/cel); let ach=null;
      for(let i=i0-1;i<=i0+1&&ach==null;i++) for(let j=j0-1;j<=j0+1&&ach==null;j++) for(let k=k0-1;k<=k0+1&&ach==null;k++){
        for(const o of (grade.get(key(i,j,k))||[])){ if(usadoO.has(o)||O.cat.get(o)!==ct) continue; const q=O.box.get(o);
          if(Math.abs(q.min.x-b.min.x)<=tp&&Math.abs(q.min.y-b.min.y)<=tp&&Math.abs(q.min.z-b.min.z)<=tp&&Math.abs(q.max.x-b.max.x)<=tp&&Math.abs(q.max.y-b.max.y)<=tp&&Math.abs(q.max.z-b.max.z)<=tp){ ach=o; break; } } }
      if(ach!=null){ pares.push([id,ach]); usadoO.add(ach); usadoN.add(id); } }
  }
  // 3) classifica
  const faixas=_faixasUnicas(await _faixasPavimento(V));
  const pavDe=(b)=>{ if(!b) return ''; const f=_faixaNoY(faixas,(b.min.y+b.max.y)/2); return f?(f.nome||''):''; };
  const grupos=new Map();
  const add=(tipo, cat, b, idN, idO, desl, prop)=>{ const pav=pavDe(b), k=tipo+'|'+cat+'|'+pav; let g=grupos.get(k);
    if(!g){ g={ tipo, cat, rot:_rotObst(cat), pav, idsN:[], idsO:[], maxDesl:0, props:new Map(), box:null }; grupos.set(k,g); }
    if(idN!=null) g.idsN.push(idN); if(idO!=null) g.idsO.push(idO); if(desl>g.maxDesl) g.maxDesl=desl;
    if(prop){ const e=g.props.get(prop.nome); if(e) e.n++; else g.props.set(prop.nome,{n:1,antes:prop.antes,depois:prop.depois}); }
    if(b){ if(!g.box) g.box={x0:b.min.x,y0:b.min.y,z0:b.min.z,x1:b.max.x,y1:b.max.y,z1:b.max.z};
      else { g.box.x0=Math.min(g.box.x0,b.min.x); g.box.y0=Math.min(g.box.y0,b.min.y); g.box.z0=Math.min(g.box.z0,b.min.z); g.box.x1=Math.max(g.box.x1,b.max.x); g.box.y1=Math.max(g.box.y1,b.max.y); g.box.z1=Math.max(g.box.z1,b.max.z); } } };
  let nNovo=0,nRem=0,nAlt=0,nProp=0,nIgual=0;
  N.lista.forEach(id=>{ if(!usadoN.has(id)){ nNovo++; add('novo', N.cat.get(id), N.box.get(id), id, null, 0); } });
  O.lista.forEach(id=>{ if(!usadoO.has(id)){ nRem++; add('removido', O.cat.get(id), O.box.get(id), null, id, 0); } });
  const iguais=[];
  for(const [n,o] of pares){ const a=N.box.get(n), b=O.box.get(o); if(!a||!b){ iguais.push([n,o]); continue; }
    const d=Math.max(Math.abs(a.min.x-b.min.x),Math.abs(a.min.y-b.min.y),Math.abs(a.min.z-b.min.z),Math.abs(a.max.x-b.max.x),Math.abs(a.max.y-b.max.y),Math.abs(a.max.z-b.max.z));
    if(d<=tol){ iguais.push([n,o]); continue; }
    const tam=Math.max(Math.abs((a.max.x-a.min.x)-(b.max.x-b.min.x)),Math.abs((a.max.y-a.min.y)-(b.max.y-b.min.y)),Math.abs((a.max.z-a.min.z)-(b.max.z-b.min.z)));
    const dx=(a.min.x+a.max.x-b.min.x-b.max.x)/2, dy=(a.min.y+a.max.y-b.min.y-b.max.y)/2, dz=(a.min.z+a.max.z-b.min.z-b.max.z)/2;
    nAlt++; add(tam<=tol?'deslocado':'modificado', N.cat.get(n), a, n, o, Math.sqrt(dx*dx+dy*dy+dz*dz)); }
  // 4) propriedades (opcional, só das peças com geometria igual)
  if(comProps && iguais.length){
    dica('Comparando revisões: propriedades…');
    const dn=await _lerPsetsEmLotes(V, x.model, iguais.map(p=>p[0]), 'Propriedades (atual)');
    const dO=await _lerPsetsEmLotes(V, c.model, iguais.map(p=>p[1]), 'Propriedades (antiga)');
    const mapa=(dd)=>{ const m=new Map(); (dd||[]).forEach(d=>{ const l=d&&d._localId&&d._localId.value; if(l!=null) m.set(l,d); }); return m; };
    const MN=mapa(dn), MO=mapa(dO);
    for(const [n,o] of iguais){ const A=_propsPlanas(MN.get(n)), B=_propsPlanas(MO.get(o)); let dif=null;
      for(const [k,v] of A){ if(k==='Tag'||k==='ObjectPlacement') continue; if(B.has(k)&&B.get(k)!==v){ dif={nome:k.replace(/^.*\./,''),antes:B.get(k),depois:v}; break; } }
      if(!dif) for(const k of B.keys()){ if(k==='Tag') continue; if(!A.has(k)){ dif={nome:k.replace(/^.*\./,''),antes:B.get(k),depois:'(sem)'}; break; } }
      if(!dif) for(const k of A.keys()){ if(k==='Tag') continue; if(!B.has(k)){ dif={nome:k.replace(/^.*\./,''),antes:'(sem)',depois:A.get(k)}; break; } }
      if(dif){ nProp++; add('props', N.cat.get(n), N.box.get(n), n, o, 0, dif); } else nIgual++; }
  } else nIgual=iguais.length;
  const ORD={removido:0,modificado:1,deslocado:2,props:3,novo:4};
  const lista=[...grupos.values()].sort((a,b)=> (ORD[a.tipo]-ORD[b.tipo]) || ((b.idsN.length+b.idsO.length)-(a.idsN.length+a.idsO.length)));
  lista.forEach(g=>{ const n=Math.max(g.idsN.length,g.idsO.length); g.n=n;
    // "Removidas: 54 × Peça genérica" — sem flexionar o nome da classe
    g.titulo=_ROT_REV[g.tipo]+(g.tipo==='deslocado'||g.tipo==='modificado'?' (até '+fmtDist(g.maxDesl)+')':'')+': '+n+' × '+g.rot;
    if(g.tipo==='props'){ const top=[...g.props.entries()].sort((a,b)=>b[1].n-a[1].n)[0]; if(top) g.detalhe='“'+top[0]+'” '+top[1].antes+' → '+top[1].depois+(g.props.size>1?' + '+(g.props.size-1)+' outra(s)':''); }
    g.props=undefined; });
  V._cmpRes={ mi, grupos:lista };
  dica('');
  return { grupos:lista, nNovo, nRem, nAlt, nProp, nIgual, nN:N.lista.length, nO:O.lista.length, casados:pares.length, porPosicao, ms:Math.round(performance.now()-t0) };
}
// Clique num grupo: só as peças dele — atual (verde novo / âmbar alterado) e,
// da revisão antiga, o fantasma (vermelho removido / cinza posição antiga).
export async function mostrarGrupoRev(V, mi, g){
  const T=V.THREE; if(!g) return;
  await _limparFantasma(V); await _tirarAntiga(V);
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
  const x=V.modelos[mi], c=V._cmp;
  const cor={ novo:0x34D399, deslocado:0xE8960A, modificado:0xE8960A, props:0xE8960A }[g.tipo];
  if(x && g.idsN.length){ try{ await x.model.setVisible(g.idsN,true); await x.model.highlight(g.idsN,{color:new T.Color(cor),renderedFaces:1,opacity:1,transparent:false}); }catch(_){} }
  if(c && g.idsO.length && g.tipo!=='props'){
    const o=c.model.object;
    if(x){ o.position.copy(x.model.object.position); o.quaternion.copy(x.model.object.quaternion); o.scale.copy(x.model.object.scale); o.updateMatrixWorld(true); }
    V.scene.add(o);
    try{ await c.model.setVisible(undefined,false); await c.model.setVisible(g.idsO,true); }catch(_){}
    const rem=g.tipo==='removido';
    try{ await c.model.highlight(g.idsO,{color:new T.Color(rem?0xE74C3C:0x8CA0C4),renderedFaces:1,opacity:rem?0.5:0.3,transparent:true}); }catch(_){}
  }
  V._isolado=true; V._isoladoPorMod={[mi]:g.idsN.slice()}; V._ultimaSelecao=V._isoladoPorMod; V._colorido=false; V._cores=null;
  try{ await V.fragments.update(true); }catch(_){}
  if(g.box){ const b=g.box, m=0.5; _fitBox(V, new T.Box3(new T.Vector3(b.x0-m,b.y0-m,b.z0-m), new T.Vector3(b.x1+m,b.y1+m,b.z1+m))); }
  try{ await V.fragments.update(true); }catch(_){}
}

// ── PÉ-DIREITO EM GRADE (2026-11-15) ───────────────────────────────────────
//  Em vez de medir cada peça pela caixa, cobre o pavimento com uma grade de
//  pontos (passo 25/50/100 cm). Em cada ponto:
//   · PISO = topo da laje estrutural logo abaixo (raio para baixo nas lajes;
//     ponto sem laje embaixo fica de fora — vazios, fachada, fora do prédio);
//   · TETO = primeiro obstáculo SUSPENSO acima (raio para cima, geometria exata,
//     a mesma do clash). Suspenso = caixa começa ≥ 30 cm acima do piso: assim
//     paredes, pilares, portas, móveis, prumadas e revestimento de piso não
//     contam, e qualquer outra coisa (registro, sprinkler, peça genérica) conta.
//  Pontos com altura livre no intervalo [altMin, altMax) são vermelhos e se
//  juntam em MANCHAS (vizinhos de lado); até 10 cm acima do máximo = âmbar, só
//  no mapa. Com IfcSpace no modelo, opção de medir só dentro dos ambientes.
const PDG_FORA=/^IFC(WALL|WALLSTANDARDCASE|COLUMN|DOOR|WINDOW|CURTAINWALL|PLATE|RAILING|STAIR|STAIRFLIGHT|RAMP|RAMPFLIGHT|FURNISHINGELEMENT|FURNITURE|SPACE|OPENINGELEMENT|FOOTING|PILE|SLAB|VIRTUALELEMENT|ANNOTATION|GRID|SITE|BUILDING|BUILDINGSTOREY|PROJECT|SANITARYTERMINAL)$/;
const _ehElemento=(cat)=> /^IFC/.test(cat) && !/TYPE$|^IFC(PROPERTY|MATERIAL|SIUNIT|DERIVEDUNIT|UNITASSIGNMENT|RELATIONSHIP|REL)/.test(cat);
function _rotObst(cat){ return PD_ROT[cat] || ({IFCBUILDINGELEMENTPROXY:'Peça genérica',IFCFLOWCONTROLLER:'Registro',IFCVALVE:'Válvula',IFCFIRESUPPRESSIONTERMINAL:'Sprinkler',
  IFCSANITARYTERMINAL:'Louça',IFCFLOWMOVINGDEVICE:'Bomba/ventilador',IFCUNITARYEQUIPMENT:'Equipamento',IFCENERGYCONVERSIONDEVICE:'Equipamento'})[cat] || cat.replace(/^IFC/,'').toLowerCase(); }
export async function temAmbientes(V){
  for(const x of V.modelos){ try{ const g=await x.model.getItemsOfCategories([/^IFCSPACE$/])||{}; if(Object.values(g).some(a=>a&&a.length)) return true; }catch(_){} }
  return false; }
// Menor parâmetro de raio vertical (sentido sg=+1 sobe, -1 desce) contra a malha t, no ponto (px,pz).
function _raioVert(px,py,pz, sg, t){
  const ix=_indiceXZ(t);
  const a=Math.floor((px-ix.x0)/ix.s), c=Math.floor((pz-ix.z0)/ix.s);
  if(a<0||c<0||a>=ix.nx||c>=ix.nz) return Infinity;
  const l=ix.cel.get(a*ix.nz+c); if(!l) return Infinity;
  let best=Infinity;
  for(const k of l){ const b=6*k;
    if(px<ix.bb[b]||px>ix.bb[b+1]||pz<ix.bb[b+4]||pz>ix.bb[b+5]) continue;
    if(sg>0 ? ix.bb[b+3]<py : ix.bb[b+2]>py) continue;
    const s=_raioTri(px,py,pz, 0,sg,0, t, 9*k); if(s>1e-9 && s<best) best=s; }
  return best; }
// Menor Y da malha t DENTRO do quadrado [x0,x1]×[z0,z1] (triângulos recortados
// no quadrado — Sutherland–Hodgman em XZ, Y interpolado). Um raio só no centro
// da célula perdia peças finas (conector PEX de 3 cm, tubo correndo entre duas
// linhas da grade); a célula inteira não perde.
function _minYCelula(t, x0,x1,z0,z1, y0,y1){
  let best=Infinity;
  for(const i of _trisNaCaixa(t,{x0,y0,z0,x1,y1,z1})){
    let P=[[t[i],t[i+1],t[i+2]],[t[i+3],t[i+4],t[i+5]],[t[i+6],t[i+7],t[i+8]]];
    const corta=(ax,lim,dentroMaior)=>{ const out=[]; for(let k=0;k<P.length;k++){ const a=P[k], b=P[(k+1)%P.length];
        const ia=dentroMaior?a[ax]>=lim:a[ax]<=lim, ib=dentroMaior?b[ax]>=lim:b[ax]<=lim;
        if(ia) out.push(a);
        if(ia!==ib){ const u=(lim-a[ax])/(b[ax]-a[ax]); out.push([a[0]+u*(b[0]-a[0]),a[1]+u*(b[1]-a[1]),a[2]+u*(b[2]-a[2])]); } }
      P=out; };
    corta(0,x0,true); if(P.length) corta(0,x1,false); if(P.length) corta(2,z0,true); if(P.length) corta(2,z1,false);
    for(const q of P) if(q[1]<best) best=q[1];
  }
  return best; }
// Índice simples em planta (célula `s`) de itens pela caixa: Map(chave → [[mi,id,t]...]).
function _gradeItens(lista, s){ const cel=new Map();
  for(const it of lista){ const b=it.b;
    const i0=Math.floor(b.min.x/s), i1=Math.floor(b.max.x/s), j0=Math.floor(b.min.z/s), j1=Math.floor(b.max.z/s);
    for(let i=i0;i<=i1;i++) for(let j=j0;j<=j1;j++){ const k=i+'|'+j; let l=cel.get(k); if(!l){ l=[]; cel.set(k,l); } l.push(it); } }
  return { s, cel, em(x,z){ return cel.get(Math.floor(x/s)+'|'+Math.floor(z/s))||[]; } }; }
export async function verificarPeDireitoGrade(V, opts){
  V._cancelar=false; const t0=performance.now();
  let altMin=(opts&&opts.altMin!=null)?+opts.altMin:2.00, altMax=(opts&&opts.altMax!=null)?+opts.altMax:2.30;
  if(altMin>altMax){ const t=altMin; altMin=altMax; altMax=t; }
  const ALERTA=0.10, SUSP=0.30;
  const passo=Math.max(0.1,(opts&&opts.passo)||0.5);
  const modelIdx=(opts&&opts.modelIdx)||null, pav=(opts&&opts.pav)||null;
  const soAmb=!!(opts&&opts.ambientes);
  const faixas=_faixasUnicas(await _faixasPavimento(V));
  if(!faixas.length) return { erroFaixas:true, manchas:[], grade:[], total:0 };
  const dica=(t)=>{ if(V.on&&V.on.dica) V.on.dica(t); };
  // caixas (cache do clash) e categoria de tudo que é elemento
  const todos=[];   // {mi,id,cat,b}
  for(let mi=0; mi<V.modelos.length; mi++){ const x=V.modelos[mi];
    let g={}; try{ g=await x.model.getItemsOfCategories([/^IFC/])||{}; }catch(_){}
    const ids=[], catOf=new Map();
    for(const [cat,arr] of Object.entries(g)){ const c=String(cat).toUpperCase(); if(!_ehElemento(c)) continue; (arr||[]).forEach(id=>{ ids.push(id); catOf.set(id,c); }); }
    if(!ids.length) continue;
    dica('Pé-direito em grade: lendo caixas… '+(x.disciplina||x.nome||''));
    const bx=await _boxesCacheadas(V, mi, x, ids);
    for(const id of ids){ const b=bx.get(id); if(b) todos.push({mi,id,cat:catOf.get(id),b}); }
  }
  const ehEst=V.modelos.map(x=>/\b(EST|FUN|CON|MET)\b/i.test(String(x.disciplina||'')+' '+String(x.nome||'').replace(/[-_]/g,' ')));
  const temEst=ehEst.some(Boolean);
  const AREA_MIN=0.75;   // mancha menor (chuveiro, conector solto) fica só no mapa
  const manchas=[], grade=[]; let pontos=0, pequenas=0;
  for(let fi=0; fi<faixas.length; fi++){ const f=faixas[fi];
    if(pav && f.nome!==pav) continue;
    if(V._cancelar) throw new Error('CANCELADO');
    const yF=f.y, yTopo=yF+altMax+ALERTA;
    // lajes do piso: topo perto do nível. Só da ESTRUTURA quando ela está aberta
    //  (laje da arquitetura = piso acabado, 4 cm acima → vigas a 2,31 viravam 2,27).
    const lajes=todos.filter(o=>o.cat==='IFCSLAB' && (!temEst||ehEst[o.mi]) && o.b.max.y>yF-0.4 && o.b.max.y<yF+0.4);
    if(!lajes.length) continue;
    // obstáculos: só das disciplinas marcadas, suspensos, com fundo abaixo do topo da busca
    const obst=todos.filter(o=>(!modelIdx||modelIdx.includes(o.mi)) && !PDG_FORA.test(o.cat)
      && o.b.min.y>=yF+SUSP-0.15 && o.b.min.y<yTopo && o.b.max.y>yF+SUSP);
    const amb = soAmb ? todos.filter(o=>o.cat==='IFCSPACE' && o.b.min.y<yF+1.0 && o.b.max.y>yF+1.0) : [];
    dica('Pé-direito em grade: '+(f.nome||'')+' — geometria…');
    const porMi=(arr)=>{ const m={}; arr.forEach(o=>{ (m[o.mi]=m[o.mi]||[]).push(o.id); }); return m; };
    const triDe=async(arr)=>{ for(const [mi,ids] of Object.entries(porMi(arr))){ const m=await _trisCacheados(V, +mi, ids); arr.forEach(o=>{ if(o.mi==mi) o.t=m.get(o.id)||null; }); } return arr.filter(o=>o.t); };
    const L=await triDe(lajes), O=await triDe(obst), A=soAmb?await triDe(amb):[];
    if(!L.length) continue;
    const gL=_gradeItens(L,4), gO=_gradeItens(O,2), gA=soAmb?_gradeItens(A,4):null;
    let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity; L.forEach(o=>{ x0=Math.min(x0,o.b.min.x); x1=Math.max(x1,o.b.max.x); z0=Math.min(z0,o.b.min.z); z1=Math.max(z1,o.b.max.z); });
    const nx=Math.max(1,Math.ceil((x1-x0)/passo)), nz=Math.max(1,Math.ceil((z1-z0)/passo));
    const cls=new Int8Array(nx*nz);              // 0 nada, 1 livre, 2 âmbar, 3 vermelho, -1 fora
    const clr=new Float32Array(nx*nz), piso=new Float32Array(nx*nz), quem=new Array(nx*nz);
    for(let i=0;i<nx;i++){
      if((i&15)===0){ if(V._cancelar) throw new Error('CANCELADO'); await new Promise(r=>setTimeout(r,0)); }
      for(let j=0;j<nz;j++){ const k=i*nz+j;
        const px=x0+(i+0.5)*passo+3.1e-7, pz=z0+(j+0.5)*passo+1.7e-7;
        // piso: topo da laje mais alta logo abaixo de yF+0,25
        const yIni=yF+0.25; let yP=-Infinity;
        for(const o of gL.em(px,pz)){ if(px<o.b.min.x||px>o.b.max.x||pz<o.b.min.z||pz>o.b.max.z) continue;
          const sd=_raioVert(px,yIni,pz,-1,o.t); if(sd<Infinity){ const y=yIni-sd; if(y>yP) yP=y; } }
        if(!(yP>yF-0.4)){ cls[k]=-1; continue; }
        if(gA){ let dentro=false; for(const o of gA.em(px,pz)){ if(px<o.b.min.x||px>o.b.max.x||pz<o.b.min.z||pz>o.b.max.z) continue; if(_dentroMalha(px,yP+1.0,pz,o.t)){ dentro=true; break; } }
          if(!dentro){ cls[k]=-1; continue; } }
        pontos++; piso[k]=yP;
        // teto: o ponto mais baixo de qualquer obstáculo SUSPENSO sobre a célula
        //  (suspenso em relação ao piso MEDIDO: reservatório apoiado numa base de
        //  11 cm não é teto — antes comparava com o nível do pavimento).
        const cx0=x0+i*passo, cz0=z0+j*passo, cx1=cx0+passo, cz1=cz0+passo, yS=yP+SUSP;
        let best=Infinity, who=null; const vistos=new Set();
        for(const q of [[cx0,cz0],[cx1,cz0],[cx0,cz1],[cx1,cz1]]) for(const o of gO.em(q[0],q[1])){
          if(vistos.has(o)) continue; vistos.add(o);
          if(o.b.max.x<cx0||o.b.min.x>cx1||o.b.max.z<cz0||o.b.min.z>cz1||o.b.max.y<yS||o.b.min.y<yP+0.20||o.b.min.y>=best) continue;
          const y=_minYCelula(o.t, cx0,cx1,cz0,cz1, yP, Math.min(best,yP+altMax+ALERTA)); if(y<best){ best=y; who=o; } }
        const c=best<Infinity ? best-yP : Infinity; clr[k]=c;
        if(c<altMin) cls[k]=1;                        // abaixo do intervalo: fora do foco (como por peça)
        else if(c<altMax){ cls[k]=3; quem[k]=who; }
        else if(c<altMax+ALERTA) cls[k]=2;
        else cls[k]=1;
      }
    }
    // manchas: vermelhos ligados pelos lados
    const vis=new Uint8Array(nx*nz);
    for(let k0=0;k0<nx*nz;k0++){ if(cls[k0]!==3||vis[k0]) continue;
      const pilha=[k0]; vis[k0]=1; const cel=[]; let mn=Infinity, kMin=k0; const cont=new Map();
      while(pilha.length){ const k=pilha.pop(); cel.push(k); if(clr[k]<mn){ mn=clr[k]; kMin=k; }
        const o=quem[k]; if(o){ const ky=o.mi+':'+o.id; const e=cont.get(ky); if(e) e.n++; else cont.set(ky,{mi:o.mi,id:o.id,cat:o.cat,n:1}); }
        const i=(k/nz)|0, j=k%nz;
        if(i>0&&cls[k-nz]===3&&!vis[k-nz]){ vis[k-nz]=1; pilha.push(k-nz); } if(i<nx-1&&cls[k+nz]===3&&!vis[k+nz]){ vis[k+nz]=1; pilha.push(k+nz); }
        if(j>0&&cls[k-1]===3&&!vis[k-1]){ vis[k-1]=1; pilha.push(k-1); } if(j<nz-1&&cls[k+1]===3&&!vis[k+1]){ vis[k+1]=1; pilha.push(k+1); } }
      let a0=Infinity,a1=-Infinity,c0=Infinity,c1=-Infinity; cel.forEach(k=>{ const i=(k/nz)|0, j=k%nz; a0=Math.min(a0,i); a1=Math.max(a1,i); c0=Math.min(c0,j); c1=Math.max(c1,j); });
      const iM=(kMin/nz)|0, jM=kMin%nz;
      if(cel.length<2 || cel.length*passo*passo < AREA_MIN-1e-9){ pequenas++; continue; }   // peça pontual (1 célula) também fica só no mapa
      manchas.push({ pav:f.nome||'', fi, n:cel.length, area:cel.length*passo*passo, min:mn, piso:piso[kMin],
        pt:{ x:x0+(iM+0.5)*passo, y:piso[kMin]+mn, z:z0+(jM+0.5)*passo },
        box:{ x0:x0+a0*passo, x1:x0+(a1+1)*passo, z0:z0+c0*passo, z1:z0+(c1+1)*passo }, passo,
        cels: cel.map(k=>{ const i=(k/nz)|0, j=k%nz; return [x0+i*passo, z0+j*passo, piso[k]]; }),
        obst:[...cont.values()].sort((u,v)=>v.n-u.n) });
    }
    const celulas=[]; for(let k=0;k<nx*nz;k++){ if(cls[k]===2||cls[k]===3){ const i=(k/nz)|0, j=k%nz; celulas.push([x0+i*passo, z0+j*passo, piso[k], cls[k]]); } }
    grade.push({ pav:f.nome||'', fi, passo, celulas });
  }
  manchas.sort((u,v)=> u.min-v.min || v.area-u.area);
  const CAP=300, cortou=manchas.length>CAP, lista=manchas.slice(0,CAP);
  // nomes dos obstáculos principais (2 por mancha)
  const pedir={}; lista.forEach(m=>m.obst.slice(0,2).forEach(o=>{ (pedir[o.mi]=pedir[o.mi]||new Set()).add(o.id); }));
  const nome={};
  for(const [mi,set] of Object.entries(pedir)){ const x=V.modelos[mi]; let da=[];
    try{ da=await x.model.getItemsData([...set],{attributesDefault:true,relationsDefault:{attributes:false,relations:false}}); }catch(_){}
    (da||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return;
      nome[mi+':'+lid]=String((d.Name&&d.Name.value)||(d.ObjectType&&d.ObjectType.value)||'').split(':')[0].trim(); }); }
  lista.forEach((m,i)=>{ m.cod='M'+(i+1);
    // 1 peça → categoria + nome; várias → categorias por ordem de presença + total
    if(m.obst.length===1){ const o=m.obst[0], r=_rotObst(o.cat), n=nome[o.mi+':'+o.id]; m.obstTxt=(n && !_norm(n).includes(_norm(r)))? r+' '+n : (n||r); }
    else { const cs=new Map(); m.obst.forEach(o=>{ const r=_rotObst(o.cat); cs.set(r,(cs.get(r)||0)+o.n); });
      m.obstTxt=[...cs.entries()].sort((u,v)=>v[1]-u[1]).map(e=>e[0]).slice(0,3).join(' + ')+' · '+m.obst.length+' peças'; }
    m.disc=[...new Set(m.obst.map(o=>{ const x=V.modelos[o.mi]; return x&&(x.disciplina||x.nome)||''; }))].join(', '); });
  V._pdGrade={ grade, manchas:lista };
  dica('');
  return { manchas:lista, grade, total:manchas.length, cortou, pontos, pequenas, areaMin:AREA_MIN, ms:Math.round(performance.now()-t0), altMin, altMax, passo };
}
// Mapa no piso: quadradinhos vermelho/âmbar logo acima do piso medido.
function _limparMapaPd(V){ if(V._pdMapa){ try{ V.scene.remove(V._pdMapa); V._pdMapa.geometry.dispose(); V._pdMapa.material.dispose(); }catch(_){} V._pdMapa=null; } }
export function mostrarMapaPd(V, fis, sel){
  const T=V.THREE; _limparMapaPd(V);
  const G=(V._pdGrade&&V._pdGrade.grade)||[]; const pos=[], col=[];
  const R=[0.91,0.30,0.24], A=[0.91,0.59,0.04], S=[0.95,0.55,0.16];
  // mancha selecionada: laranja (seleção no Auria), por cima das demais
  const selCel=()=>{ if(!(sel && sel.cels)) return; const p=sel.passo, m=p*0.06;   // desenhada por ÚLTIMO (fica por cima)
    for(const [x,z,y] of sel.cels){ const yy=y+0.05, a=x+m, b=x+p-m, d=z+m, e=z+p-m;
      pos.push(a,yy,d, b,yy,e, b,yy,d,  a,yy,d, a,yy,e, b,yy,e); for(let q=0;q<6;q++) col.push(...S); } };
  for(const g of G){ if(fis && !fis.includes(g.fi)) continue; const p=g.passo, m=p*0.06;
    for(const [x,z,y,c] of g.celulas){ const yy=y+0.03, a=x+m, b=x+p-m, d=z+m, e=z+p-m, k=c===3?R:A;
      pos.push(a,yy,d, b,yy,e, b,yy,d,  a,yy,d, a,yy,e, b,yy,e); for(let q=0;q<6;q++) col.push(...k); } }
  selCel();
  if(!pos.length) return 0;
  const geo=new T.BufferGeometry(); geo.setAttribute('position',new T.Float32BufferAttribute(pos,3)); geo.setAttribute('color',new T.Float32BufferAttribute(col,3));
  const mat=new T.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0.6,side:T.DoubleSide,depthWrite:false});
  const mesh=new T.Mesh(geo,mat); mesh.renderOrder=5; V.scene.add(mesh); V._pdMapa=mesh;
  try{ V.fragments.update(true); }catch(_){}
  return pos.length/18; }
// Clique numa mancha: só o entorno do pavimento (translúcido), obstáculos da
// mancha opacos em vermelho, mapa daquele pavimento e câmera na mancha.
export async function mostrarManchaPd(V, m){
  await _tirarAntiga(V);
  const T=V.THREE; if(!m) return;
  await _limparFantasma(V);
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} }
  const f=(_faixasUnicas(await _faixasPavimento(V)))[m.fi]||null;
  const yLo=m.piso-0.5, yHi=f&&isFinite(f.y1)?f.y1+0.3:m.piso+3.5, M=3;
  const reg={x0:m.box.x0-M,x1:m.box.x1+M,z0:m.box.z0-M,z1:m.box.z1+M};
  const dest={}; m.obst.forEach(o=>{ (dest[o.mi]=dest[o.mi]||[]).push(o.id); });
  const cx=(reg.x0+reg.x1)/2, cz=(reg.z0+reg.z1)/2, cand=[];
  for(let mi=0; mi<V.modelos.length; mi++){ const x=V.modelos[mi];
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(CAT_VISIVEIS)||{}).flat(); }catch(_){}
    if(!ids.length) continue; const bx=await _boxesCacheadas(V, mi, x, ids); const ds=new Set(dest[mi]||[]);
    for(const id of ids){ const b=bx.get(id); if(!b||ds.has(id)) continue;
      if(b.max.x<reg.x0||b.min.x>reg.x1||b.max.z<reg.z0||b.min.z>reg.z1||b.max.y<yLo||b.min.y>yHi) continue;
      const dx=Math.max(b.min.x-cx,0,cx-b.max.x), dz=Math.max(b.min.z-cz,0,cz-b.max.z); cand.push([dx*dx+dz*dz,mi,id]); } }
  cand.sort((u,v)=>u[0]-v[0]); if(cand.length>1500) cand.length=1500;
  const fant={}; cand.forEach(([,mi,id])=>{ (fant[mi]=fant[mi]||[]).push(id); });
  const vis={}; for(let mi=0; mi<V.modelos.length; mi++){ const v=[...(fant[mi]||[]),...(dest[mi]||[])]; if(v.length) vis[mi]=v; }
  for(let mi=0; mi<V.modelos.length; mi++){ const x=V.modelos[mi];
    try{ await x.model.setVisible(undefined,false); }catch(_){}
    if(vis[mi]){ try{ await x.model.setVisible(vis[mi],true); }catch(_){} }
    if(fant[mi]){ try{ await x.model.setOpacity(fant[mi],0.12); }catch(_){} } }
  V._fantasmaIds=fant; V._fantasma=true;
  for(const [mi,ids] of Object.entries(dest)){ try{ await V.modelos[mi].model.setOpacity(ids,1); await V.modelos[mi].model.highlight(ids,{color:new T.Color(0xEF4444),renderedFaces:1,opacity:1,transparent:false}); }catch(_){} }
  V._isolado=true; V._isoladoPorMod=vis; V._ultimaSelecao=vis; V._colorido=false; V._cores=null;
  mostrarMapaPd(V,[m.fi],m);
  try{ await V.fragments.update(true); }catch(_){}
  const r=Math.max(2.5, (m.box.x1-m.box.x0)/2, (m.box.z1-m.box.z0)/2);
  _fitBox(V, new T.Box3(new T.Vector3(m.box.x0-1,m.piso,m.box.z0-1), new T.Vector3(m.box.x1+1,m.piso+Math.max(2.6,r),m.box.z1+1)));
  try{ await V.fragments.update(true); }catch(_){}
}
export async function zoomPeDireito(V, mi, id){ try{ await enquadrarIds(V, {[mi]:[id]}); }catch(_){} }
// Lista de pavimentos (nomes únicos), p/ os seletores. Prefere a ESTRUTURA
// ESPACIAL (storeys — nomes reais); só cai nas faixas de laje se não houver.
export async function listaPavimentos(V){
  const st=await _storeysMapa(V);
  if(st.length){ const seen=new Set(); const out=[]; st.forEach(s=>{ if(!seen.has(s.nome)){ seen.add(s.nome); out.push({ nome:s.nome }); } }); return out; }
  const f=await _faixasPavimento(V); return (f||[]).map(x=>({ nome:x.nome, y:x.y }));
}

// ── ÁRVORE ESPACIAL do modelo (Projeto→Terreno→Edifício→Pavimento→…→Elemento) ─
//  O Fragments entrega isso pronto em getSpatialStructure(), mas num formato que
//  ALTERNA nó-categoria (category!=null, localId=null) com nó-instância
//  (category=null, localId=N). A instância é o objeto REAL; o tipo dela é a
//  categoria do nó-pai. Aqui achato para instâncias {id, tipo, filhos} e
//  resolvo o NOME só dos nós espaciais (poucos); nomes de elemento vêm sob
//  demanda (nomesElementos) porque podem ser milhares.
const _ESPACIAL = new Set(['IFCPROJECT','IFCSITE','IFCBUILDING','IFCBUILDINGSTOREY','IFCSPACE']);
export async function arvoreEspacial(V, mi){
  const x=V.modelos[mi]; if(!x||!x.model) return null;
  let raw=null; try{ raw=await x.model.getSpatialStructure(); }catch(_){}
  if(!raw) return null;
  const limpar=(inst, tipo)=>{
    const filhos=[];
    for(const catNode of (inst.children||[])){
      const cat=catNode.category||tipo;
      for(const ch of (catNode.children||[])) filhos.push(limpar(ch, cat));
    }
    return { id:inst.localId, tipo, filhos };
  };
  // raw é o nó-categoria raiz (IFCPROJECT) com children = [instância do projeto]
  const arvore = (raw.children||[]).map(pi=> limpar(pi, raw.category));
  // nomes só dos nós ESPACIAIS (projeto/terreno/edifício/pavimento/ambiente)
  const espIds=[]; const col=(n)=>{ if(_ESPACIAL.has(String(n.tipo).toUpperCase()) && n.id!=null) espIds.push(n.id); (n.filhos||[]).forEach(col); };
  arvore.forEach(col);
  const nomes={};
  for(let s=0;s<espIds.length;s+=400){
    const lote=espIds.slice(s,s+400); let da=[];
    try{ da=await x.model.getItemsData(lote,{attributesDefault:true,relationsDefault:{attributes:false,relations:false}}); }catch(_){}
    (da||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return;
      nomes[lid]=String((d.Name&&d.Name.value)||(d.LongName&&d.LongName.value)||(d.ObjectType&&d.ObjectType.value)||'').trim(); });
  }
  return { arvore, nomes };
}
// Nomes de um lote de elementos (sob demanda, ao expandir um grupo).
export async function nomesElementos(V, mi, ids){
  const x=V.modelos[mi]; if(!x||!ids||!ids.length) return {};
  const out={};
  for(let s=0;s<ids.length;s+=400){
    const lote=ids.slice(s,s+400); let da=[];
    try{ da=await x.model.getItemsData(lote,{attributesDefault:true,relationsDefault:{attributes:false,relations:false}}); }catch(_){}
    (da||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return;
      out[lid]=String((d.Name&&d.Name.value)||(d.ObjectType&&d.ObjectType.value)||('#'+lid)).split(':')[0]; });
  }
  return out;
}
// Isola um conjunto de elementos de UM modelo (esconde o resto), realça e enquadra.
export async function isolarElementos(V, mi, ids){
  const T=V.THREE;
  if(V._fantasma) await _limparFantasma(V);
  for(const y of V.modelos){ try{ await y.model.setVisible(undefined,false); }catch(_){} try{ await y.model.resetHighlight(); }catch(_){} }
  const x=V.modelos[mi];
  if(x && ids && ids.length){
    try{ await x.model.setVisible(ids,true); }catch(_){}
    if(ids.length<=250){ try{ await x.model.highlight(ids,{color:new T.Color(0x22D3EE),renderedFaces:1,opacity:1,transparent:false}); }catch(_){} }
  }
  V._isolado=true; V._isoladoPorMod={[mi]:ids}; V._ultimaSelecao={[mi]:ids}; V._colorido=false; V._cores=null;
  try{ await V.fragments.update(true); }catch(_){}
  if(ids && ids.length) await enquadrarIds(V, {[mi]:ids});
}

// ── CONTAR / AGRUPAR por propriedade (Nível 3 da IA) ───────────────────────
//  Sem `termoProp`: conta o total da(s) categoria(s) (rápido, só a lista de ids).
//  Com `termoProp` (ex.: "largura"): agrupa pela propriedade e conta cada valor.
//  Lê ATRIBUTOS-ONLY (ex.: IfcDoor.OverallWidth, OverallHeight) — rápido; para
//  propriedades que vivem em Pset/quantidade a busca não acha (refinar depois).
function _termoRegex(t){
  t=(t||'').toLowerCase();
  if(/larg|width/.test(t))  return /width|larg/i;
  if(/alt|height/.test(t))  return /height|alt/i;
  if(/esp|thick/.test(t))   return /thick|esp/i;
  if(/[áa]rea/.test(t))     return /area/i;
  if(/vol/.test(t))         return /vol/i;    // pega volume, NetVolume, auria_vol…
  if(/per[íi]m/.test(t))    return /perim/i;
  if(/comprim|length/.test(t)) return /length|comprimento/i;   // metro linear
  if(/pavim|piso|andar|n[íi]vel|storey|level/.test(t)) return /piso|planta|pavim|storey|level|andar|n[íi]vel|nivel|restri[çc][aã]o da base|base ?constraint/i;
  if(/tipo|type|classif/.test(t)) return /tipo|type|classif/i;
  if(/mat/.test(t))         return /material/i;
  return new RegExp((t.replace(/[^a-z0-9]/gi,'')||'.'),'i');
}
function _achaValor(d, rx){
  const escal=(o)=> (o&&typeof o==='object'&&'value' in o&&typeof o.value!=='object')?o.value:undefined;
  for(const [k,v] of Object.entries(d)){
    if(k[0]==='_'||k==='Name') continue;
    if(rx.test(k)){ const vv=escal(v); if(vv!=null && vv!=='') return vv; }
  }
  return null;
}
function _rotuloValor(v, termo){
  if(typeof v==='number'){
    // Comprimentos (largura/altura/espessura) vêm em METROS → mostra em cm,
    // arredondado ao cm, que é como se fala de porta/janela.
    if(/larg|width|alt|height|esp|thick/i.test(termo||'') && Math.abs(v)<10){
      return String(Math.round(v*100))+' cm';
    }
    return String(Math.round(v*1000)/1000).replace('.',',');
  }
  return String(v);
}
// Conta uma categoria FILTRADA por texto (nome/tipo/atributos). Sem termos =
// total da categoria. Leve (atributos-only).
export async function contarFiltrado(V, regexes, termos, pavim){
  V._cancelar=false;
  if((termos||[]).some(t=>/^c\d{2}$/i.test(String(t).trim()))){ const pm=await acharElementos(V, regexes, termos, pavim); let c=0; for(const a of Object.values(pm)) c+=(a?a.length:0); return c; }
  if(_pavSetsDe(V, pavim)){ const pm=await acharElementos(V, regexes, termos, pavim); let c=0; for(const a of Object.values(pm)) c+=(a?a.length:0); return c; }
  const termosLc=(termos||[]).map(t=>String(t).trim().toLowerCase()).filter(Boolean);
  const pavN = pavim ? _norm(pavim) : '';
  let n=0;
  for(const x of V.modelos){
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(regexes)||{}).flat(); }catch(_){}
    if(!ids.length) continue;
    if(!termosLc.length && !pavN){ n+=ids.length; continue; }
    if(pavN && !termosLc.length){
      const fx=_faixaDe(await _faixasPavimento(V), pavN);
      if(fx){
        let boxes=[]; try{ boxes=await x.model.getBoxes(ids); }catch(_){}
        ids.forEach((id,i)=>{ if(_naFaixa((boxes||[])[i], fx)) n++; });
      } else {
        const cache=await _pavimMapModelo(V, x, ids, 'Contando');
        for(const id of ids){ if(_batePavim(cache.get(id)||'', pavN)) n++; }
      }
      continue;
    }
    let da=[];
    if(pavN || termosLc.includes('@fire') || termosLc.some(t=>/^c\d{2}$/.test(t))){ da=await _lerPsetsEmLotes(V, x.model, ids, 'Contando'); }
    else { try{ da=await x.model.getItemsData(ids, { attributesDefault:true, relationsDefault:{attributes:false,relations:false} }); }catch(_){} }
    (da||[]).forEach(d=>{ if(!d) return;
      if(termosLc.length && !_bateTermos(d, termosLc)) return;
      if(pavN && !_batePavim(_pavimEl(d), pavN)) return;
      n++;
    });
  }
  return n;
}
// Retorna { total, grupos:[{label, n, porMod:{modelIndex:[localIds]}}] } — os
// ids por grupo permitem destacar aquele conjunto ao clicar na tabela.
export async function contarPorPropriedade(V, regexes, termoProp){
  const termo=(termoProp||'').trim();
  const rx = termo ? _termoRegex(termo) : null;
  let total=0; const dist=new Map();   // label -> {n, porMod:{mi:[ids]}}
  for(let mi=0; mi<V.modelos.length; mi++){
    const x=V.modelos[mi];
    let ids=[];
    try{ ids=Object.values(await x.model.getItemsOfCategories(regexes)||{}).flat(); }catch(_){}
    if(!ids.length) continue;
    if(!rx){ total+=ids.length; continue; }
    let dados=[];
    try{ dados=await x.model.getItemsData(ids, { attributesDefault:true,
      relationsDefault:{attributes:false,relations:false} }); }catch(_){}
    (dados||[]).forEach(d=>{ if(!d) return; const lid=d._localId&&d._localId.value; if(lid==null) return; total++;
      const v=_achaValor(d, rx);
      const chave=(v==null)?'(sem valor)':_rotuloValor(v, termo);
      let g=dist.get(chave); if(!g){ g={n:0, porMod:{}}; dist.set(chave,g); }
      g.n++; (g.porMod[mi]=g.porMod[mi]||[]).push(lid);
    });
  }
  const grupos=[...dist.entries()].map(([label,g])=>({label, n:g.n, porMod:g.porMod})).sort((a,b)=> b.n-a.n);
  return { total, grupos };
}
// Busca PROFUNDA (atributo direto OU propriedade de Pset) o 1º valor NUMÉRICO
// cuja chave/nome casa com rx. Retorna {val, nome} ou null.
// Coleta TODOS os valores numéricos (atributo direto OU propriedade de Pset) cujo
// nome casa rx → [{val, nome}]. Base do _achaValorProfundo e do somarPorNome.
function _valoresProfundos(d, rx){
  const cands=[]; if(!d) return cands;
  const escal=(o)=> (o && typeof o==='object' && 'value' in o && typeof o.value!=='object') ? o.value : undefined;
  for(const [k,v] of Object.entries(d)){          // 1) atributos diretos
    if(k[0]==='_'||Array.isArray(v)) continue;
    if(rx.test(_norm(k))){ const vv=escal(v); if(typeof vv==='number') cands.push({val:vv, nome:k}); }
  }
  for(const [k,v] of Object.entries(d)){          // 2) dentro dos Psets
    if(!Array.isArray(v)) continue;
    for(const ps of v){
      if(!ps || typeof ps!=='object') continue;
      for(const sub of Object.values(ps)){
        if(!Array.isArray(sub)) continue;
        for(const p of sub){
          if(!p || typeof p!=='object') continue;
          const pn=p.Name && p.Name.value;
          if(pn && rx.test(_norm(pn))){          // insensível a acento ("Área"→area)
            const pv=escal(p.NominalValue)??escal(p.AreaValue)??escal(p.VolumeValue)??escal(p.LengthValue)??escal(p.Value);
            if(typeof pv==='number') cands.push({val:pv, nome:String(pn)});
          }
        }
      }
      for(const [k2,v2] of Object.entries(ps)){
        if(k2==='Name'||Array.isArray(v2)) continue;
        if(rx.test(_norm(k2))){ const vv=escal(v2); if(typeof vv==='number') cands.push({val:vv, nome:k2}); }
      }
    }
  }
  return cands;
}
// ÁREA: qual das quantidades IFC vale como "área do elemento" (item 57). O critério antigo
// ("1ª que tem Net") pegava NetFootprintArea em parede (comprimento × espessura — a pegada
// no piso), por isso a área de parede saía errada. Ordem: face lateral (Side) > área
// líquida > bruta > superfície > seção; pegada (Footprint) só se não houver mais nada.
// Elemento LINEAR (pilar/viga/estaca) mantém a seção (CrossSectionArea) — é a base do volume.
function _rankArea(nome, cat){
  const n=String(nome||'').toLowerCase();
  const linear=/IFCCOLUMN|IFCBEAM|IFCMEMBER|IFCPILE/.test(cat||'');
  if(linear && /cross|se[cç][aã]o|section/.test(n)) return 20;
  if(/netside/.test(n)) return 19;  if(/grossside/.test(n)) return 18;
  if(/^netarea$|netarea|[áa]rea ?l[íi]quida/.test(n) && !/footprint|pegada/.test(n)) return 17;
  if(/^grossarea$|grossarea|[áa]rea ?bruta/.test(n) && !/footprint|pegada/.test(n)) return 16;
  if(/surface|superf/.test(n)) return 12;
  if(/cross|se[cç][aã]o|section/.test(n)) return 10;
  if(/footprint|pegada/.test(n)) return /net/.test(n) ? 2 : 1;
  if(/net/.test(n)) return 9; if(!/gross/.test(n)) return 8; return 7;
}
function _melhorArea(cands, cat){
  if(!cands||!cands.length) return null;
  let best=null, bs=-1; cands.forEach(c=>{ const s=_rankArea(c.nome, cat); if(s>bs){ bs=s; best=c; } }); return best;
}
function _achaValorProfundo(d, rx, cat){
  const cands=_valoresProfundos(d, rx); if(!cands.length) return null;
  if(/area|[áa]rea/i.test(String(rx))) return _melhorArea(cands, cat);
  // Demais quantidades (volume/comprimento): Net > (não-Gross) > primeiro.
  return cands.find(c=>/net/i.test(c.nome)) || cands.find(c=>!/gross/i.test(c.nome)) || cands[0];
}
export function rankArea(nome, cat){ return _rankArea(nome, cat); }
// Soma a quantidade SEPARADA por NOME de propriedade (ex.: NetArea × GrossArea ×
// Área): mostra ao usuário qual bater o esperado, em vez de misturar. Uma medição
// por elemento por nome (pega o 1º valor daquele nome). Retorna [{nome,soma,n}].
export async function somarPorNome(V, porMod, termoProp){
  V._cancelar=false;
  const rx=_termoRegex(termoProp);
  const map=new Map();
  for(const [mi,ids] of Object.entries(porMod||{})){
    const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue;
    const dd=await _lerPsetsEmLotes(V, x.model, ids, 'Somando');
    (dd||[]).forEach(d=>{
      const vistos=new Set();
      _valoresProfundos(d, rx).forEach(c=>{ const k=_norm(c.nome); if(vistos.has(k)) return; vistos.add(k);
        let g=map.get(k); if(!g){ g={nome:c.nome, soma:0, n:0}; map.set(k,g); } g.soma+=c.val; g.n++; });
    });
  }
  return [...map.values()].sort((a,b)=> b.n-a.n || b.soma-a.soma);
}
// SOMA uma quantidade (área/volume/comprimento) sobre um subconjunto filtrado.
// `termos` (opcional) filtra por texto nos atributos (ex.: "ACM"); `termoProp` é
// o que somar. Lê Psets só do subconjunto filtrado (bounded).
// ── ÁREA PELA MALHA 3D (precisa) ────────────────────────────────────────────
// Usada quando o IFC não traz a área (ex.: paredes de ACM do Revit, sem Qto).
// Peça VERTICAL (parede/painel), do mais exato ao menos exato:
//  1) espessura conhecida (propriedade ou nome do tipo "(17.5)", "e=14 cm", "L=19CM")
//     → área = volume da malha ÷ espessura (exato p/ espessura constante, reta OU curva,
//     com recortes) — validada: não pode ser maior que metade das faces verticais;
//  2) parede reta: soma dos triângulos das DUAS faces principais ÷ 2 (bordas e
//     contornos de janela ficam de fora: são perpendiculares);
//  3) curva sem espessura: metade das faces verticais (ESTIMATIVA, inclui as bordas).
// Peça HORIZONTAL (laje/piso/cobertura): área da face de cima.
// Conferido no PINI: (1) e (2) batem até 0,03 m² em 11 de 12 paredes de ACM.
// Espessuras CANDIDATAS lidas do nome do tipo (m). A unidade varia entre famílias:
// "(17.5)" e "e=14 cm" são cm; "… ACM 040" é mm (40 mm) e "… ACM 017.2" é cm (17,2 cm) —
// por isso o número solto no fim entra nas DUAS leituras e a GEOMETRIA decide
// (_areaPecas só aceita espessura compatível com o volume e as faces da peça).
function _espsDoNome(nome){
  const s=String(nome||'').replace(/:\d+\s*$/,'');   // tira o ":1295263" da instância
  const c=[]; let m;
  if((m=s.match(/\((\d{1,3}(?:[.,]\d+)?)\)/))) c.push(parseFloat(m[1].replace(',','.'))/100);
  if((m=s.match(/\b[eEL]\s*=\s*(\d{1,3}(?:[.,]\d+)?)\s*cm/i))) c.push(parseFloat(m[1].replace(',','.'))/100);
  if((m=s.match(/\b[eEL]\s*=\s*(\d{1,4}(?:[.,]\d+)?)\s*mm/i))) c.push(parseFloat(m[1].replace(',','.'))/1000);
  if((m=s.match(/(?:^|[\s_-])(\d{2,3}(?:[.,]\d+)?)\s*$/))){ const x=parseFloat(m[1].replace(',','.')); c.push(x/1000, x/100); }
  return c.filter(x=>isFinite(x)&&x>0.002&&x<1.5);
}
function _espDaProp(d){
  const v=_achaValorQualquer(d, /^(width|largura|espessura|thickness|espessura total)$/i);
  const x=v==null?NaN:+v; if(!isFinite(x)||x<=0) return null;
  return x>5 ? x/1000 : x;   // mm → m quando vier em mm
}
async function _areaPecas(model, ids, dOf){
  const r={ soma:0, exatas:0, estimadas:0, n:0 };
  for(let p=0;p<ids.length;p+=150){
    const lote=ids.slice(p,p+150);
    let geo=[]; try{ geo=await model.getItemsGeometry(lote); }catch(_){ continue; }
    for(let i=0;i<lote.length;i++){
      const id=lote[i]; const tris=[]; let Aup=0, Av=0;
      for(const m of (geo[i]||[])){
        const e=m.transform&&m.transform.elements, P=m.positions, I=m.indices; if(!e||!P||!I) continue;
        const tp=k=>{ const x=P[3*k],y=P[3*k+1],z=P[3*k+2]; return [e[0]*x+e[4]*y+e[8]*z+e[12], e[1]*x+e[5]*y+e[9]*z+e[13], e[2]*x+e[6]*y+e[10]*z+e[14]]; };
        for(let t=0;t<I.length;t+=3){
          const a=tp(I[t]),b=tp(I[t+1]),c=tp(I[t+2]);
          const u0=b[0]-a[0],u1=b[1]-a[1],u2=b[2]-a[2], v0=c[0]-a[0],v1=c[1]-a[1],v2=c[2]-a[2];
          const n0=u1*v2-u2*v1, n1=u2*v0-u0*v2, n2=u0*v1-u1*v0; const L=Math.hypot(n0,n1,n2); if(!L) continue;
          const ar=L/2, ny=n1/L;
          if(Math.abs(ny)<0.2){ const h=Math.hypot(n0,n2); tris.push({ar, x:n0/h, z:n2/h}); Av+=ar; }
          else if(ny>0.7) Aup+=ar;
        }
      }
      if(!Av && !Aup) continue;
      r.n++;
      if(Aup>Av){ r.soma+=Aup; r.exatas++; continue; }                 // horizontal: face de cima
      const d=dOf&&dOf.get(id);
      const cands=d?[_espDaProp(d)].concat(_espsDoNome(d.Name&&d.Name.value), _espsDoNome(_tipoNome(d))).filter(Boolean):[];
      if(cands.length){
        let vol=0; try{ vol=+(await model.getItemsVolume([id]))||0; }catch(_){}
        // compatível: área ≤ metade das faces verticais (a outra parte são bordas) e
        // ≥ 30% dela (unidade errada erra 10×: cai fora com folga; peça pequena real fica ~60%+)
        const ok=vol>0 ? cands.find(t=>{ const A=vol/t; return A<=Av/2*1.005 && A>=Av/2*0.3; }) : null;
        if(ok){ r.soma+=vol/ok; r.exatas++; continue; }
      }
      let sc=0, ss=0; tris.forEach(t=>{ const th=Math.atan2(t.z,t.x)*2; sc+=t.ar*Math.cos(th); ss+=t.ar*Math.sin(th); });
      const th=Math.atan2(ss,sc)/2, dx=Math.cos(th), dz=Math.sin(th);
      const main=tris.reduce((s,t)=>s+(Math.abs(t.x*dx+t.z*dz)>0.985?t.ar:0),0);
      if(main/Av>=0.6){ r.soma+=main/2; r.exatas++; }
      else { r.soma+=Av/2; r.estimadas++; }
    }
    await new Promise(z=>setTimeout(z,0));
  }
  return r;
}
export async function areaMalha(V, porMod){
  const tot={ soma:0, exatas:0, estimadas:0, n:0 };
  for(const [mi,ids] of Object.entries(porMod||{})){
    const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue;
    const dOf=new Map(); for(let p=0;p<ids.length;p+=500){ let da=[]; try{ da=await x.model.getItemsData(ids.slice(p,p+500),{attributesDefault:true,relations:{IsDefinedBy:{attributes:true,relations:true}},relationsDefault:{attributes:false,relations:false}}); }catch(_){}
      (da||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid!=null) dOf.set(lid,d); }); }
    const r=await _areaPecas(x.model, ids, dOf);
    tot.soma+=r.soma; tot.exatas+=r.exatas; tot.estimadas+=r.estimadas; tot.n+=r.n;
  }
  return tot;
}
export async function somarPropriedade(V, regexes, termos, termoProp, pavim){
  const termosLc=(termos||[]).map(t=>String(t).trim().toLowerCase()).filter(Boolean);
  const rx=_termoRegex(termoProp);
  const tp=(termoProp||'').toLowerCase();
  const ehArea=/[áa]rea/.test(tp), ehComp=/larg|width|alt|height|comp|length/.test(tp), ehVol=/vol/.test(tp);
  let n=0, comValor=0, calculados=0, soma=0; const nomes=new Set();
  // Pavimento pedido ("volume das lajes do 10º"): o conjunto vem do mesmo achador
  // do destacar/contar (classe + filtro + pavimento) — antes a soma ignorava o andar.
  const porPav = (pavim && String(pavim).trim()) ? await acharElementos(V, regexes, termos, pavim) : null;
  const ehLaje = (regexes||[]).some(r=>/SLAB|ROOF/i.test(String(r&&r.source||r)));
  for(let mi=0; mi<V.modelos.length; mi++){ const x=V.modelos[mi];
    let ids=[];
    if(porPav){ ids=(porPav[mi]||[]).slice(); }
    else { try{ ids=Object.values(await x.model.getItemsOfCategories(regexes)||{}).flat(); }catch(_){} }
    if(!ids.length) continue;
    if(termosLc.length && !porPav){                          // filtro por texto (atributos, leve)
      let da=[]; try{ da=await x.model.getItemsData(ids, { attributesDefault:true, relationsDefault:{attributes:false,relations:false} }); }catch(_){}
      const ok=[]; (da||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return; if(_bateTermos(d, termosLc)) ok.push(lid); });
      ids=ok;
    }
    if(!ids.length) continue;
    n+=ids.length;
    let dd=[]; try{ dd=await x.model.getItemsData(ids, { attributesDefault:true,
      relations:{ IsDefinedBy:{attributes:true,relations:true} }, relationsDefault:{attributes:false,relations:false} }); }catch(_){}
    const faltam=[];
    (dd||[]).forEach((d,i)=>{ const r=_achaValorProfundo(d, rx, String((regexes||[]).map(x=>x&&x.source||x).join('|')));
      if(r && typeof r.val==='number'){ soma+=r.val; comValor++; nomes.add(r.nome); }
      else faltam.push(ids[i]);
    });
    // VOLUME sem propriedade: volume da MALHA da peça (Fragments getItemsVolume —
    // mesmo cálculo da concretagem; exato p/ a geometria, inclusive laje nervurada
    // exportada em camadas, que são somadas peça a peça).
    if(faltam.length && ehVol){
      for(let p=0;p<faltam.length;p+=500){ const lote=faltam.slice(p,p+500);
        let v=0; try{ v=+(await x.model.getItemsVolume(lote))||0; }catch(_){ v=0; }
        if(v>0){ soma+=v; calculados+=lote.length; nomes.add('malha 3D'); } }
    }
    // ÁREA sem propriedade: medida na MALHA 3D (_areaPecas — faces reais, sem caixa).
    if(faltam.length && ehArea){
      const dOf=new Map(); (dd||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid!=null) dOf.set(lid,d); });
      const ra=await _areaPecas(x.model, faltam, dOf);
      if(ra.n){ soma+=ra.soma; calculados+=ra.n; if(ra.exatas) nomes.add('malha 3D'); if(ra.estimadas){ nomes.add('malha 3D (estimativa)'); V._areaEstimadas=(V._areaEstimadas||0)+ra.estimadas; } }
    }
    // Reserva pela caixa só p/ COMPRIMENTO (maior dimensão horizontal).
    if(faltam.length && ehComp && !ehArea && !ehVol){
      let boxes=[]; try{ boxes=await x.model.getBoxes(faltam); }catch(_){}
      (boxes||[]).forEach(b=>{ if(!b||!b.min||!b.max||!isFinite(b.max.y)) return;
        const dy=b.max.y-b.min.y, hd=[b.max.x-b.min.x, b.max.z-b.min.z].sort((a,b)=>b-a);
        const val = ehArea ? (ehLaje ? hd[0]*hd[1] : hd[0]*dy) : hd[0];
        if(isFinite(val)){ soma+=val; calculados++; nomes.add('geometria'); }
      });
    }
  }
  return { n, comValor, calculados, soma, nomes:[...nomes] };
}
// Acha o 1º valor (texto OU número) cuja chave/nome casa com rx — para chave de
// AGRUPAMENTO (ex.: pavimento="TERREO", Piso=33).
function _achaValorQualquer(d, rx){
  const escal=(o)=> (o && typeof o==='object' && 'value' in o && typeof o.value!=='object') ? o.value : undefined;
  for(const [k,v] of Object.entries(d)){ if(k[0]==='_'||Array.isArray(v)) continue; if(rx.test(_norm(k))){ const vv=escal(v); if(vv!=null&&vv!=='') return vv; } }
  for(const [k,v] of Object.entries(d)){ if(!Array.isArray(v)) continue;
    for(const ps of v){ if(!ps||typeof ps!=='object') continue;
      for(const sub of Object.values(ps)){ if(!Array.isArray(sub)) continue; for(const p of sub){ if(!p||typeof p!=='object') continue; const pn=p.Name&&p.Name.value; if(pn&&rx.test(_norm(pn))){ const pv=escal(p.NominalValue)??escal(p.Value); if(pv!=null&&pv!=='') return pv; } } }
      for(const [k2,v2] of Object.entries(ps)){ if(k2==='Name'||Array.isArray(v2)) continue; if(rx.test(_norm(k2))){ const vv=escal(v2); if(vv!=null&&vv!=='') return vv; } }
    }
  }
  return null;
}
// TABELA AGRUPADA: agrupa por `propGrupo` (ex.: pavimento) e, se `propValor`
// (ex.: volume), soma-o por grupo; senão só conta. Retorna linhas com ids p/
// permitir clicar e isolar o grupo.
export async function tabelaAgrupada(V, regexes, termos, propGrupo, propValor, pavim){
  V._cancelar=false;
  const termosLc=(termos||[]).map(t=>String(t).trim().toLowerCase()).filter(Boolean);
  const pavN = pavim ? _norm(pavim) : '';
  const rxG=_termoRegex(propGrupo);
  const rxV=propValor?_termoRegex(propValor):null;
  const map=new Map();   // label -> {n, soma, comValor, porMod:{mi:[ids]}}
  for(let mi=0; mi<V.modelos.length; mi++){
    const x=V.modelos[mi];
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(regexes)||{}).flat(); }catch(_){}
    if(!ids.length) continue;
    if(termosLc.length){
      let da=[]; try{ da=await x.model.getItemsData(ids,{attributesDefault:true,relationsDefault:{attributes:false,relations:false}}); }catch(_){}
      const ok=[]; (da||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null)return; if(_bateTermos(d, termosLc)) ok.push(lid); }); ids=ok;
    }
    if(!ids.length) continue;
    const dd=await _lerPsetsEmLotes(V, x.model, ids, 'Montando tabela');   // lotes + Parar
    (dd||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return;
      if(pavN && !_batePavim(_pavimEl(d), pavN)) return;   // filtra pelo pavimento pedido
      const gk=_achaValorQualquer(d, rxG);
      const label = (gk==null||gk==='') ? '(sem valor)' : String(gk);
      let g=map.get(label); if(!g){ g={n:0,soma:0,comValor:0,porMod:{}}; map.set(label,g); }
      g.n++; (g.porMod[mi]=g.porMod[mi]||[]).push(lid);
      if(rxV){ const vv=_achaValorProfundo(d, rxV); if(vv&&typeof vv.val==='number'){ g.soma+=vv.val; g.comValor++; } }
    });
  }
  return [...map.entries()].map(([grupo,g])=>({grupo, n:g.n, soma:g.soma, comValor:g.comValor, porMod:g.porMod}))
    // Ordena pela CHAVE do grupo (pavimento 1,2,3…; "(sem valor)" por último) —
    // antes ordenava por quantidade, o que embaralhava os pavimentos.
    .sort((a,b)=>{
      if(a.grupo==='(sem valor)') return 1; if(b.grupo==='(sem valor)') return -1;
      const na=parseFloat(String(a.grupo).replace(',','.')), nb=parseFloat(String(b.grupo).replace(',','.'));
      const aNum=!isNaN(na)&&/^\s*-?[\d.,]+\s*$/.test(a.grupo), bNum=!isNaN(nb)&&/^\s*-?[\d.,]+\s*$/.test(b.grupo);
      if(aNum&&bNum) return na-nb;
      return String(a.grupo).localeCompare(String(b.grupo), 'pt', {numeric:true});
    });
}
// Destaca um conjunto explícito de ids (por índice de modelo) — usado ao clicar
// numa linha da tabela de contagem. ISOLA: esconde tudo, mostra só o alvo.
export async function destacarIds(V, porMod){
  for(const x of V.modelos){
    try{ await x.model.resetHighlight(); }catch(_){}
    try{ await x.model.setVisible(undefined, false); }catch(_){}
  }
  let total=0;
  for(let mi=0; mi<V.modelos.length; mi++){
    const x=V.modelos[mi]; const ids=(porMod&&porMod[mi])||[];
    if(!ids.length) continue; total+=ids.length;
    try{ await x.model.setVisible(ids, true); }catch(_){}
    try{ await x.model.highlight(ids, { color:new V.THREE.Color(LARANJA), renderedFaces:1, opacity:1, transparent:false }); }catch(_){}
  }
  if(total>0){ V._isolado=true; V._isoladoPorMod=porMod; V._ultimaSelecao=porMod; }
  try{ await V.fragments.update(true); }catch(_){}
  if(total>0) await enquadrarIds(V, porMod);   // zoom-extend na seleção
  return total;
}

// ── Raio-X (peça sob o cursor fica transparente) ──────────────────────────
//  Modelo mental: como o médico "afasta" o tecido para ver o osso, aqui
//  você "afasta" a peça sob o cursor para ver o que está atrás — parede
//  → tubulação, forro → dutos, laje → armadura. Só UMA peça por vez fica
//  translúcida: a que o raycast atinge primeiro. Instantâneo — não indexa
//  nada, cada movimento do mouse é só um raycast + setOpacity numa peça.
//
//  Antes existia um modo "esfera de 1 m" que pré-indexava as caixas de
//  todas as peças e pegava várias por vez. Ficou confuso — pegava peças
//  atrás que o usuário não estava mirando. Simplificado para este.
// Aceita um HIT único (compat) OU uma LISTA de hits + profundidade N. Quando
// vem lista, extrai as N primeiras peças ÚNICAS ao longo do raio (mesma peça
// pode aparecer duas vezes se o raio pega a face frontal e a traseira).
// Diff em relação ao conjunto anterior — só quem saiu vira reset, só quem
// entrou vira setOpacity.
export async function raiosXHover(V, hitOuHits, prof){
  const OPAC = 0.12;
  // Normaliza para lista de alvos { modelo, id }
  let alvos = [];
  const visto = new Set();
  const consumir = (h)=>{
    if(!h || !h.__modelo || h.localId===undefined || h.localId===null) return;
    const k = (h.__modelo.arquivoId || h.__modelo.nome || '?') + ':' + h.localId;
    if(visto.has(k)) return;
    visto.add(k);
    alvos.push({ modelo: h.__modelo, id: h.localId, k });
  };
  if(Array.isArray(hitOuHits)){
    const N = Math.max(1, prof|0 || 1);
    for(const h of hitOuHits){ consumir(h); if(alvos.length>=N) break; }
  } else if(hitOuHits){
    consumir(hitOuHits);
  }
  // Diff com o anterior — sem trabalho se conjunto igual
  const prev = V._xrayUlt || [];
  const alvosSet = new Set(alvos.map(a=>a.k));
  const prevSet  = new Set(prev.map(a=>a.k));
  if(alvos.length===prev.length && prev.every(a=>alvosSet.has(a.k))) return;
  // Agrupa saídas por modelo (uma chamada resetOpacity por modelo)
  const sairPor = new Map();
  prev.forEach(a=>{ if(!alvosSet.has(a.k)){
    const arr = sairPor.get(a.modelo) || []; arr.push(a.id); sairPor.set(a.modelo, arr);
  }});
  for(const [m,ids] of sairPor){ try{ await m.model.resetOpacity(ids); }catch(_){} }
  // Agrupa entradas por modelo (uma chamada setOpacity por modelo)
  const entrarPor = new Map();
  alvos.forEach(a=>{ if(!prevSet.has(a.k)){
    const arr = entrarPor.get(a.modelo) || []; arr.push(a.id); entrarPor.set(a.modelo, arr);
  }});
  for(const [m,ids] of entrarPor){ try{ await m.model.setOpacity(ids, OPAC); }catch(_){} }
  V._xrayUlt = alvos;
  try{ await V.fragments.update(true); }catch(_){}
}
// Solta tudo. Chamada ao desligar o raio-X ou ao descartar o visualizador.
// Também zera opacidade em TODAS as peças (defesa: se por qualquer motivo
// tivesse sobrado gente translúcida do modo esfera antigo, sai limpo).
export async function raiosXLimpa(V){
  V._xrayUlt = null;
  for(const x of V.modelos){ try{ await x.model.resetOpacity(undefined); }catch(_){} }
  try{ await V.fragments.update(true); }catch(_){}
}

// ── Esconder / mostrar peças (right-click do App) ─────────────────────────
//  Semantica diferente do raio-X: aqui é visibility, não opacidade. A peça
//  some completamente e o raycast passa direto (então você pode clicar de
//  novo pra esconder o que estava atrás dela). V._escondidos guarda a lista
//  por modelo pra depois restaurar de uma só vez.
export async function esconderPeca(V, hit){
  if(!hit || !hit.__modelo || hit.localId===undefined || hit.localId===null) return;
  try{
    await hit.__modelo.model.setVisible([hit.localId], false);
    if(!V._escondidos) V._escondidos = new Map();
    const set = V._escondidos.get(hit.__modelo) || new Set();
    set.add(hit.localId);
    V._escondidos.set(hit.__modelo, set);
    await V.fragments.update(true);
  }catch(_){}
}
export async function mostrarTodos(V){
  if(!V._escondidos || !V._escondidos.size) return;
  for(const [m, ids] of V._escondidos){
    if(!ids.size) continue;
    try{ await m.model.setVisible([...ids], true); }catch(_){}
  }
  V._escondidos = new Map();
  try{ await V.fragments.update(true); }catch(_){}
}

// ── Medição ────────────────────────────────────────────────────────────────
export function modoMedir(V, lig){
  if(lig && V.corte.ativo) modoCorte(V,false);
  V.medida.ativo=lig;
  V.canvas.style.cursor = lig ? 'crosshair' : '';
  // Sair do modo NÃO apaga as cotas já feitas (estilo Solibri: elas persistem
  // na tela até você apagar). Só descarta um primeiro-ponto pendente e o snap.
  if(!lig){ snapEsconder(V); if(V.medida.pend){ try{ V.scene.remove(V.medida.pend.mark); }catch(_){} V.medida.pend=null; } }
  else dica(V,'Clique em dois pontos para medir. O cursor gruda em vértices, arestas e faces. As cotas ficam na tela.');
}
export function medirModo(V, modo){ V.medida.modo=modo; }
// Liga/desliga o snap da trena (grudar em vértice/aresta/face). Desligado, a
// medição usa o ponto cru do raycast na superfície. Preferência do usuário.
export function setSnap(V, on){ V.medida.snapOn=!!on; if(!on) snapEsconder(V); }
export function fmtDist(d){
  if(!isFinite(d)) return '—';
  if(d<1) return (d*100).toFixed(1).replace('.',',')+' cm';
  return d.toFixed(d<10?3:2).replace('.',',')+' m';
}

// ── Snap da trena (estilo Solibri) ───────────────────────────────────────────
//  A lib Fragments tem raycastWithSnapping: além do ponto da face, devolve o
//  vértice mais próximo (POINT=0), a aresta (LINE=1, com os dois extremos) ou
//  a face (FACE=2). Priorizamos POINT > LINE > FACE — é o que o Solibri faz:
//  perto de um canto, gruda no canto; senão na aresta; senão na superfície.
const SNAP_COR = { 0:0x22c55e, 1:0x22d3ee, 2:LARANJA };   // vértice / aresta / face
function snapMelhorQue(r, cur){
  if(r.snappingClass!==cur.snappingClass) return r.snappingClass < cur.snappingClass;
  return (r.distance||0) < (cur.distance||0);
}
async function melhorSnap(V, ev){
  const mouse=new V.THREE.Vector2(ev.clientX, ev.clientY);
  let melhor=null;
  for(const x of V.modelos){
    if(x.visivel===false) continue;
    try{
      const rs=await x.model.raycastWithSnapping({ camera:V.camera, mouse, dom:V.canvas, snappingClasses:[0,1,2] });
      (rs||[]).forEach(r=>{ if(r && r.point){ r.__modelo=x; if(!melhor || snapMelhorQue(r,melhor)) melhor=r; } });
    }catch(_){}
  }
  return melhor;
}
// Garante os 3 marcadores de hover (um por tipo) + a linha de realce da aresta.
function snapVis(V){
  const T=V.THREE, M=V.medida;
  if(M.snapVis) return M.snapVis;
  const mat=(c)=> new T.MeshBasicMaterial({ color:c, depthTest:false });
  const mk=(geo,c)=>{ const m=new T.Mesh(geo,mat(c)); m.renderOrder=1000; m.visible=false; V.scene.add(m); return m; };
  const vis={
    // vértice: cubinho; aresta: losango (octaedro); face: esfera
    0: mk(new T.BoxGeometry(1.8,1.8,1.8), SNAP_COR[0]),
    1: mk(new T.OctahedronGeometry(1.2),  SNAP_COR[1]),
    2: mk(new T.SphereGeometry(1,12,12),  SNAP_COR[2]),
    linha: (()=>{ const l=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(),new T.Vector3()]),
                    new T.LineBasicMaterial({ color:SNAP_COR[1], depthTest:false, linewidth:2 }));
                  l.renderOrder=1000; l.visible=false; V.scene.add(l); return l; })()
  };
  M.snapVis=vis; return vis;
}
export function snapEsconder(V){
  const vis=V&&V.medida&&V.medida.snapVis; if(!vis) return;
  vis[0].visible=vis[1].visible=vis[2].visible=vis.linha.visible=false;
  V.medida.snap=null;
}
// Hover: chamada a cada movimento do mouse com a trena ligada. Faz o snapping
// e posiciona os marcadores. Guarda o ponto grudado em V.medida.snap para o
// clique usar exatamente o mesmo ponto que o usuário vê.
export async function medirHover(V, ev){
  if(!V.vivo || !V.medida.ativo) return;
  if(!V.medida.snapOn){ snapEsconder(V); return; }
  const s=await melhorSnap(V, ev);
  if(!V.vivo || !V.medida.ativo) return;
  V.medida.snap=s;
  const vis=snapVis(V);
  vis[0].visible=vis[1].visible=vis[2].visible=vis.linha.visible=false;
  if(!s){ return; }
  const cls=s.snappingClass|0;
  const mk=vis[cls] || vis[2];
  mk.position.copy(s.point); mk.visible=true;
  // aresta: realça o segmento inteiro entre os dois extremos
  if(cls===1 && s.snappedEdgeP1 && s.snappedEdgeP2){
    const g=vis.linha.geometry;
    const pos=g.attributes.position;
    pos.setXYZ(0, s.snappedEdgeP1.x, s.snappedEdgeP1.y, s.snappedEdgeP1.z);
    pos.setXYZ(1, s.snappedEdgeP2.x, s.snappedEdgeP2.y, s.snappedEdgeP2.z);
    pos.needsUpdate=true; g.computeBoundingSphere();
    vis.linha.visible=true;
  }
}
const EIXO_IFC={ x:'X', y:'Z', z:'Y' };   // Fragments entrega Y p/ cima; o IFC usa Z
async function medirPonto(V, ev){
  // Usa o ponto GRUDADO (snap) se houver — é o que o cursor mostrava. Só cai
  // no raycast puro se o snapping não achou nada (fora do modelo) ou se o
  // usuário desligou o snap nas configurações.
  let pt=null;
  if(V.medida.snapOn){
    const s=await melhorSnap(V, ev);
    if(!V.vivo) return;
    if(s && s.point) pt=s.point.clone();
  }
  if(!pt){ const hit=await raycast(V,ev); if(!V.vivo) return; if(hit&&hit.point) pt=hit.point.clone(); }
  if(!pt){ dica(V,'Clique sobre o modelo.'); return; }
  const T=V.THREE, M=V.medida;
  // Modo NÍVEL: em vez da cota de 2 pontos, fixa um símbolo de nível (▽) no ponto
  // — vira uma "medida" normal (entra na lista, apagável). Reusa o snap acima.
  if(M.modo==='nivel'){ marcarNivel(V, pt); return; }
  // Raio 1 + escala por quadro: o marcador fica com tamanho constante NA TELA.
  const esf=new T.Mesh(new T.SphereGeometry(1,12,12), new T.MeshBasicMaterial({color:LARANJA, depthTest:false}));
  esf.position.copy(pt); esf.renderOrder=999; V.scene.add(esf);
  // Primeiro ponto → fica pendente até o segundo.
  if(!M.pend){ M.pend={ mark:esf, pt:pt.clone() }; dica(V,'Agora o segundo ponto.'); return; }
  // Segundo ponto → completa a medida (uma unidade deletável).
  const a=M.pend.pt; let b=pt, rot='';
  if(M.modo==='eixo'){
    const d=new T.Vector3().subVectors(pt,a);
    const e=(Math.abs(d.x)>=Math.abs(d.y)&&Math.abs(d.x)>=Math.abs(d.z))?'x':(Math.abs(d.y)>=Math.abs(d.z)?'y':'z');
    b=a.clone(); b[e]=pt[e]; rot=EIXO_IFC[e]+' ';
    esf.position.copy(b);
  }
  const linha=new T.Line(new T.BufferGeometry().setFromPoints([a,b]),
    new T.LineBasicMaterial({color:LARANJA, depthTest:false}));
  linha.renderOrder=999; V.scene.add(linha);
  const dist=a.distanceTo(b);
  const el=document.createElement('div');
  el.className='bim3dCota';
  el.style.cssText='position:absolute;z-index:3;transform:translate(-50%,-50%);pointer-events:auto;'
    +'background:rgba(232,150,10,.95);color:#231703;font-size:11px;font-weight:700;padding:2px 4px 2px 8px;'
    +'border-radius:5px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;gap:4px';
  const texto=rot+fmtDist(dist);
  const medida={ id:(++M._seq), marks:[M.pend.mark, esf], line:linha, el,
    meio:a.clone().add(b).multiplyScalar(0.5), dist, texto, visivel:true };
  el.innerHTML='<span>'+texto+'</span><span class="x" title="Apagar esta medida" style="cursor:pointer;font-weight:800;font-size:13px;line-height:1;opacity:.65;padding:0 2px">×</span>';
  el.querySelector('.x').addEventListener('click', (e)=>{ e.stopPropagation(); removerMedida(V, medida); if(V.on.medidas) V.on.medidas(V); });
  V.cont.appendChild(el);
  M.medidas.push(medida);
  M.pend=null;
  dica(V,'Medida: '+texto+' — clique para medir outra.');   // senão ficava "Agora o segundo ponto."
  if(V.on.medir)   V.on.medir(dist);
  if(V.on.medidas) V.on.medidas(V);   // avisa o host para redesenhar o painel de cotas
}
// Remove UMA medida (o ×) — dispõe seus objetos da cena e a etiqueta.
function removerMedida(V, medida){
  const M=V.medida; const i=M.medidas.indexOf(medida); if(i<0) return;
  medida.marks.forEach(m=>{ try{ V.scene.remove(m); m.geometry&&m.geometry.dispose(); m.material&&m.material.dispose(); }catch(_){} });
  try{ V.scene.remove(medida.line); medida.line.geometry&&medida.line.geometry.dispose(); medida.line.material&&medida.line.material.dispose(); }catch(_){}
  try{ medida.el.remove(); }catch(_){}
  M.medidas.splice(i,1);
}
// Apaga TODAS as medidas (botão limpar) + um pendente.
export function limparMedidas(V){
  const M=V.medida;
  (M.medidas||[]).slice().forEach(md=> removerMedida(V, md));
  if(M.pend){ try{ V.scene.remove(M.pend.mark); }catch(_){} M.pend=null; }
  if(V.on.medidas) V.on.medidas(V);
}
// ── API do painel de cotas (lista estilo Solibri) ───────────────────────────
export function listaMedidas(V){
  return (V&&V.medida&&V.medida.medidas||[]).map(m=>({ id:m.id, texto:m.texto, visivel:m.visivel!==false, nivel:!!m._nivel }));
}
export function contarMedidas(V){ return (V&&V.medida&&V.medida.medidas)?V.medida.medidas.length:0; }
export function removerMedidaId(V, id){
  const md=(V.medida.medidas||[]).find(m=>m.id===id);
  if(md){ removerMedida(V, md); if(V.on.medidas) V.on.medidas(V); }
}
// Liga/desliga a VISUALIZAÇÃO de uma cota (sem apagá-la): esconde/mostra a
// linha, os marcadores e a etiqueta.
export function medidaVisivel(V, id, vis){
  const md=(V.medida.medidas||[]).find(m=>m.id===id); if(!md) return;
  md.visivel = (vis===undefined) ? !md.visivel : !!vis;
  const on=md.visivel;
  try{ md.line.visible=on; }catch(_){}
  md.marks.forEach(m=>{ try{ m.visible=on; }catch(_){} });
  md.el.style.display = on ? 'flex' : 'none';
  md._forcarOculto = !on;   // atualizarCotas respeita o oculto
  if(V.on.medidas) V.on.medidas(V);
}
function escalarMarcas(V){
  const M=V.medida;
  const h=V.cont.clientHeight||1;
  const k=2*Math.tan((V.camera.fov*Math.PI/180)/2)/h*5;   // ~5px de raio
  const esc=(m)=> m.scale.setScalar(Math.max(1e-6, V.camera.position.distanceTo(m.position)*k));
  (M.medidas||[]).forEach(md=> md.marks.forEach(esc));
  if(M.pend) esc(M.pend.mark);
  // marcadores de snap (hover) também mantêm tamanho constante na tela
  const vis=M.snapVis;
  if(vis){ [vis[0],vis[1],vis[2]].forEach(m=>{ if(m.visible) esc(m); }); }
}
function atualizarCotas(V){
  const M=V.medida; if(!M.medidas||!M.medidas.length) return;
  const w=V.cont.clientWidth, h=V.cont.clientHeight;
  M.medidas.forEach(md=>{
    if(md._forcarOculto){ md.el.style.display='none'; return; }   // desligada no painel
    const p=md.meio.clone().project(V.camera);
    if(p.z>1){ md.el.style.display='none'; return; }
    md.el.style.display='flex';
    md.el.style.left=((p.x*0.5+0.5)*w)+'px';
    md.el.style.top =((-p.y*0.5+0.5)*h)+'px';
  });
}

// ── Corte ──────────────────────────────────────────────────────────────────
export function modoCorte(V, lig){
  if(lig && V.medida.ativo) modoMedir(V,false);
  V.corte.ativo=lig;
  V.canvas.style.cursor = lig ? 'crosshair' : '';
  // Enquanto se corta, o esquerdo ARRASTA O PLANO — girar vai pro direito.
  V.controls.mouseButtons = lig
    ? { LEFT:null, MIDDLE:V.THREE.MOUSE.PAN, RIGHT:V.THREE.MOUSE.ROTATE }
    : { LEFT:V.THREE.MOUSE.ROTATE, MIDDLE:V.THREE.MOUSE.PAN, RIGHT:null };
  if(!lig){ V.corte.mostrarAjuda=false; sumirAjudaCorte(V); }
  else { V.corte.mostrarAjuda=true; if(V.corte.ancora) corteAplicar(V); }
}
export function cortePor(V, ponto, normal){
  const T=V.THREE, C=V.corte;
  const paraCam=V.camera.position.clone().sub(ponto);
  const N=(normal&&normal.lengthSq()>0)?normal.clone().normalize():paraCam.clone().normalize().negate();
  let dir;
  if(Math.abs(N.y)>0.7) dir=new T.Vector3(0, paraCam.y>=0?-1:1, 0);
  else{
    const nx=N.x,nz=N.z,len=Math.hypot(nx,nz)||1;
    const s=(nx*paraCam.x+nz*paraCam.z)>=0?-1:1;
    dir=new T.Vector3(s*nx/len,0,s*nz/len);
  }
  C.ancora=ponto.clone();
  // Para ENXERGAR o corte, o que sai é o lado de CÁ. No three a normal aponta
  // para o lado que FICA, então ela aponta para longe da câmera.
  C.normal=dir.normalize(); C.inv=false;
  corteAplicar(V);
  corteArestas(V).catch(()=>{});
}
export function corteAplicar(V){
  const T=V.THREE, C=V.corte;
  if(!C.ancora||!C.normal){
    V.renderer.clippingPlanes=[];
    V.modelos.forEach(x=>{ try{ x.model.getClippingPlanesEvent=()=>[]; }catch(_){} });
    sumirAjudaCorte(V); sumirArestas(V);
    V.fragments.update(true).catch(()=>{});
    return;
  }
  const n=C.normal.clone(); if(C.inv) n.negate();
  const plano=new T.Plane(n, -n.dot(C.ancora));
  C.plano=plano;
  V.renderer.localClippingEnabled=true;
  V.renderer.clippingPlanes=[plano];
  V.modelos.forEach(x=>{ try{ x.model.getClippingPlanesEvent=()=>[plano]; }catch(_){} });
  sumirAjudaCorte(V);
  if(C.mostrarAjuda!==false){
    const lado=(V.unidade||1)*120;
    const geo=new T.PlaneGeometry(lado,lado);
    const malha=new T.Mesh(geo, new T.MeshBasicMaterial({color:LARANJA, transparent:true, opacity:0.10, side:T.DoubleSide, depthWrite:false}));
    malha.position.copy(C.ancora);
    malha.quaternion.setFromUnitVectors(new T.Vector3(0,0,1), n);
    malha.add(new T.LineSegments(new T.EdgesGeometry(geo), new T.LineBasicMaterial({color:LARANJA})));
    malha.renderOrder=998;
    V.scene.add(malha); C.ajuda=malha;
  }
  V.fragments.update(true).catch(()=>{});
}
export function corteInverter(V){ if(V.corte.ancora){ V.corte.inv=!V.corte.inv; corteAplicar(V); corteArestas(V).catch(()=>{}); } }
// Liga/desliga só a hachura (o preenchimento da seção). As arestas laranja
// continuam — sem elas, o corte vira uma mancha sem contorno.
export function corteHachura(V, lig){
  V.hachura = !!lig;
  if(V.corte.plano) corteArestas(V).catch(()=>{});
}
export function corteRemover(V){
  const C=V.corte; C.ancora=null; C.normal=null; C.plano=null; C.inv=false;
  sumirArestas(V); corteAplicar(V);
}
function corteArrastar(V, dxPix, dyPix){
  const C=V.corte; if(!C.ancora||!C.normal) return;
  const w=V.cont.clientWidth||1, h=V.cont.clientHeight||1;
  const u=(V.unidade||1)*10;
  const a=C.ancora.clone().project(V.camera);
  const b=C.ancora.clone().addScaledVector(C.normal,u).project(V.camera);
  const ex=(b.x-a.x)*0.5*w, ey=-(b.y-a.y)*0.5*h;
  const len2=ex*ex+ey*ey;
  if(len2<1e-6) return;
  C.ancora.addScaledVector(C.normal, ((dxPix*ex+dyPix*ey)/len2)*u);
  corteAplicar(V);
}
function sumirAjudaCorte(V){
  const C=V.corte; if(!C.ajuda) return;
  try{ V.scene.remove(C.ajuda);
    C.ajuda.traverse(o=>{ if(o.geometry)o.geometry.dispose(); if(o.material)o.material.dispose(); }); }catch(_){}
  C.ajuda=null;
}
// Aresta + HACHURA da seção. getSection devolve:
//  - buffer:       posições (x,y,z...) dos segmentos de aresta e vértices de fill
//  - fillsIndices: triangulação dos fills (o "cheio" da peça atravessada)
//
// Estratégia visual: hachura opaca azul-marinho + contorno GROSSO laranja só
// no PERÍMETRO dos fills; arestas internas (que aparecem em dois triângulos
// do mesmo fill) ficam FINAS. Sem isso, cada elemento contornado com traço
// grosso vira uma malha confusa (o efeito da segunda imagem do usuário).
//
// Fronteira do polígono = aresta que aparece em UM só triângulo. Aresta
// interna do fill = dois. Chave por (min,max) dos índices do fillsIndices.
function fronteirasDosFills(idxs){
  const cont=new Map();
  const chave=(a,b)=> a<b ? (a*4294967296+b) : (b*4294967296+a);
  for(let i=0;i<idxs.length;i+=3){
    const a=idxs[i], b=idxs[i+1], c=idxs[i+2];
    for(const [p,q] of [[a,b],[b,c],[c,a]]){
      const k=chave(p,q);
      cont.set(k, (cont.get(k)||0)+1);
    }
  }
  const bordas=[];   // pares planos [i0,i1, i2,i3, ...]
  for(let i=0;i<idxs.length;i+=3){
    const a=idxs[i], b=idxs[i+1], c=idxs[i+2];
    for(const [p,q] of [[a,b],[b,c],[c,a]]){
      if(cont.get(chave(p,q))===1) bordas.push(p,q);
    }
  }
  return bordas;
}
export async function corteArestas(V){
  sumirArestas(V);
  const C=V.corte; if(!C.plano) return;
  let L; try{ L=await libsLinha(); }catch(_){ return; }
  if(!V.vivo||!V.corte.plano) return;
  const T=V.THREE;
  const grupo=new T.Group();
  for(const x of V.modelos){
    if(x.visivel===false) continue;
    try{
      // getSection ignora setVisible: mesmo com pavimentos filtrados, a
      // seção pega a laje do andar de cima e desenha o fill dele bem no
      // meio da vista atual — foi o "pavimento de cima flutuando" da
      // segunda imagem do usuário. Solução: o 2º argumento restringe a
      // peças; passamos só as visíveis quando há filtro (número menor que
      // o total de peças com geometria).
      let ids;
      try{
        const [vis, todas] = await Promise.all([
          x.model.getItemsByVisibility(true),
          x.model.getItemsWithGeometry()
        ]);
        if(vis && todas && vis.length && vis.length < todas.length) ids = vis;
      }catch(_){ ids = undefined; }
      // getSection roda no worker, em coordenadas LOCAIS do modelo (sample transforms),
      // sem o object.matrixWorld que o autoCoordinate/recentragem aplica na cena. Plano
      // em mundo → local antes; resultado local → mundo depois. Com matriz identidade
      // (1º modelo) nada muda; era isto que jogava a aresta laranja para fora do corte
      // nos demais modelos e no CDE (item 62).
      x.model.object.updateMatrixWorld(true);
      const M = x.model.object.matrixWorld.clone();
      const planoLocal = V.corte.plano.clone().applyMatrix4(M.clone().invert());
      const s = ids ? await x.model.getSection(planoLocal, ids)
                    : await x.model.getSection(planoLocal);
      if(!s||!s.buffer||!s.buffer.length) continue;
      const gModelo=new T.Group(); gModelo.applyMatrix4(M); grupo.add(gModelo);
      const temFill = V.hachura!==false && s.fillsIndices && s.fillsIndices.length;

      // Aresta FINA por baixo: todas as arestas do getSection. Ficam como
      // linhas de referência (elementos cortados que não geram fill, como
      // vidros vazados, e a estrutura interna do próprio fill).
      const gFina=new T.BufferGeometry();
      gFina.setAttribute('position', new T.BufferAttribute(s.buffer,3));
      const mFina=new T.LineBasicMaterial({ color:LARANJA, depthTest:false,
        transparent:true, opacity: temFill ? 0.45 : 1.0 });
      const linhaFina=new T.LineSegments(gFina, mFina); linhaFina.renderOrder=997;
      gModelo.add(linhaFina);

      // Hachura sólida.
      if(temFill){
        const g2=new T.BufferGeometry();
        g2.setAttribute('position', new T.BufferAttribute(s.buffer,3));
        g2.setIndex(s.fillsIndices);
        const m2=new T.MeshBasicMaterial({ color:HACHURA, side:T.DoubleSide, depthTest:false });
        const malha=new T.Mesh(g2,m2); malha.renderOrder=998;
        gModelo.add(malha);
      }

      // Contorno GROSSO só no perímetro do fill.
      if(temFill){
        const bordas=fronteirasDosFills(s.fillsIndices);
        if(bordas.length){
          const pts=new Float32Array(bordas.length*3);
          for(let i=0;i<bordas.length;i++){
            pts[i*3]   = s.buffer[bordas[i]*3];
            pts[i*3+1] = s.buffer[bordas[i]*3+1];
            pts[i*3+2] = s.buffer[bordas[i]*3+2];
          }
          const gGr=new L.LineSegmentsGeometry(); gGr.setPositions(pts);
          const mGr=new L.LineMaterial({ color:LARANJA, linewidth:2.6, depthTest:false });
          mGr.resolution.set(V.cont.clientWidth||1, V.cont.clientHeight||1);
          const linha=new L.LineSegments2(gGr, mGr); linha.renderOrder=999;
          gModelo.add(linha);
        }
      }
    }catch(_){}
  }
  if(!V.vivo||!V.corte.plano) return;
  if(grupo.children.length){
    // A aresta nasce SOBRE o plano, e o recorte vale para o material dela
    // também: na fronteira, ruído numérico faz trechos piscarem.
    const eps=Math.max((V.unidade||1)*0.05, 1e-4);
    grupo.position.copy(V.corte.plano.normal).multiplyScalar(eps);
    V.scene.add(grupo); V.corte.arestas=grupo;
  }
}
function sumirArestas(V){
  const g=V.corte.arestas; if(!g) return;
  try{ V.scene.remove(g);
    g.traverse(o=>{ if(o.geometry)o.geometry.dispose(); if(o.material)o.material.dispose(); }); }catch(_){}
  V.corte.arestas=null;
}

// ── Caminhar ───────────────────────────────────────────────────────────────
export async function modoAndar(V, lig){
  const W=V.andar;
  if(!lig){
    W.ativo=false; W.armado=false; W.teclas.clear();
    V.controls.enabled=true;
    if(W.camPos){ V.camera.position.copy(W.camPos); V.camera.quaternion.copy(W.camRot); }
    if(W.alvo) V.controls.target.copy(W.alvo);
    V.controls.update();
    V.canvas.style.cursor='';
    V.fragments.update(true).catch(()=>{});
    // Quem chamou pode não ser quem desenha o botão: o Esc sai daqui de
    // dentro, e sem este aviso o botão do App ficaria aceso sem modo ligado.
    if(V.on.modo) V.on.modo('andar', false);
    return;
  }
  dica(V,'Procurando os pavimentos…');
  await niveis(V);
  if(!V.vivo) return;
  W.armado=true;
  V.canvas.style.cursor='crosshair';
  dica(V,'Clique no piso do pavimento onde quer caminhar.');
}
export function entrarAndar(V, ponto){
  const T=V.THREE, W=V.andar, ns=V.niveis||[];
  W.armado=false;
  W.camPos=V.camera.position.clone(); W.camRot=V.camera.quaternion.clone(); W.alvo=V.controls.target.clone();
  let idx=0, melhor=Infinity;
  ns.forEach((y,i)=>{ const d=Math.abs(y-ponto.y); if(d<melhor){ melhor=d; idx=i; } });
  W.ativo=true; W.nivel=idx; W.teclas=new Set();
  V.controls.enabled=false; V.canvas.style.cursor='';
  const dir=new T.Vector3(); V.camera.getWorldDirection(dir);
  W.yaw=Math.atan2(-dir.x,-dir.z); W.pitch=0;
  W.pos=new T.Vector3(ponto.x,0,ponto.z);
  irNivel(V, idx);
  if(V.on.modo) V.on.modo('andar', true);
  dica(V,'W A S D anda · segure a RODA e arraste para olhar · Esc sai');
}
export function irNivel(V, i){
  const W=V.andar; if(!W.ativo) return;
  const ns=V.niveis||[];
  if(ns.length){ W.nivel=Math.max(0,Math.min(ns.length-1,i)); W.pos.y=ns[W.nivel]+1.70; }
  else W.pos.y=(V.caixa?V.caixa.min.y:0)+1.70;
  andarAplicar(V);
  if(V.on.nivel) V.on.nivel(W.nivel, ns);
}
function andarAplicar(V){
  const W=V.andar, T=V.THREE;
  V.camera.position.copy(W.pos);
  V.camera.up.set(0,1,0);
  V.camera.lookAt(new T.Vector3(
    W.pos.x - Math.sin(W.yaw)*Math.cos(W.pitch),
    W.pos.y + Math.sin(W.pitch),
    W.pos.z - Math.cos(W.yaw)*Math.cos(W.pitch)));
  // update() é ida ao worker: a cada quadro engasgava o movimento.
  const agora=performance.now();
  if(agora-(W.ultUpd||0)>120){ W.ultUpd=agora; V.fragments.update().catch(()=>{}); }
}
function andarQuadro(V, dt){
  const W=V.andar; if(!W.teclas.size) return;
  const T=V.THREE;
  const frente=new T.Vector3(-Math.sin(W.yaw),0,-Math.cos(W.yaw));
  const lado  =new T.Vector3(Math.cos(W.yaw),0,-Math.sin(W.yaw));
  const mov=new T.Vector3();
  if(W.teclas.has('w')) mov.add(frente);
  if(W.teclas.has('s')) mov.sub(frente);
  if(W.teclas.has('d')) mov.add(lado);
  if(W.teclas.has('a')) mov.sub(lado);
  if(!mov.lengthSq()) return;
  const v=(W.lento?1.4:4.5)*(W.teclas.has('shift')?3:1);   // celular: passo de pessoa (1,4 m/s)
  W.pos.addScaledVector(mov.normalize(), v*dt);
  andarAplicar(V);
}

// ── Visão LOCAL no celular (backlog 231 — passo 1, sem câmera) ─────────────
// Só o pavimento visível; estrutura semitransparente (raio-X) para enxergar os
// encaminhamentos das instalações por dentro; grupos coloridos (disciplina,
// interferência). Tudo por porMod {mi:[ids]}.
export async function vistaLocal(V, cfg){
  const T=V.THREE, vis=cfg.visiveis||{}, transp=cfg.transparentes||{}, cores=cfg.cores||[];
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.resetOpacity(undefined); }catch(_){} try{ await x.model.setVisible(undefined,false); }catch(_){} }
  for(const [mi,ids] of Object.entries(vis)){ const x=V.modelos[mi]; if(x&&ids&&ids.length){ try{ await x.model.setVisible(ids,true); }catch(_){} } }
  for(const g of cores){ for(const [mi,ids] of Object.entries(g.porMod||{})){ const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue;
    try{ await x.model.highlight(ids, { color:new T.Color(g.cor), renderedFaces:1, opacity:1, transparent:false }); }catch(_){} } }
  for(const [mi,ids] of Object.entries(transp)){ const x=V.modelos[mi]; if(x&&ids&&ids.length){ try{ await x.model.setOpacity(ids, cfg.opacidade!=null?cfg.opacidade:0.18); }catch(_){} } }
  V._isolado=true; V._isoladoPorMod=vis; V._colorido=!!cores.length;
  try{ await V.fragments.update(true); }catch(_){}
}
// Entra no modo caminhar no CENTRO do conjunto (o pavimento), no piso dele.
export async function entrarAndarNoCentro(V, porMod){
  const T=V.THREE, cx=new T.Box3(); let tem=false;
  for(const [mi,ids] of Object.entries(porMod||{})){ const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue;
    let bs=[]; try{ bs=await x.model.getBoxes(ids.slice(0,4000)); }catch(_){}
    (bs||[]).forEach(b=>{ if(b && !b.isEmpty()){ cx.union(b); tem=true; } }); }
  if(!tem) return false;
  await niveis(V);
  const c=cx.getCenter(new T.Vector3());
  // piso = nível de laje mais próximo da base do conjunto (e não abaixo dela)
  const ns=V.niveis||[]; let y=cx.min.y; let melhor=Infinity;
  ns.forEach(n=>{ const d=Math.abs(n-cx.min.y); if(d<melhor){ melhor=d; y=n; } });
  entrarAndar(V, new T.Vector3(c.x, y, c.z));
  return true;
}
// Toque na tela (celular): segura ▲/▼/◀/▶ = mesmas teclas do W/S/A/D.
export function andarTecla(V, k, on){ const W=V.andar; if(!W||!W.ativo) return; if(on) W.teclas.add(k); else W.teclas.delete(k); }
export function andarLento(V){ const W=V.andar; if(W){ W.lento=true; } }
// GIROSCÓPIO: o celular aponta, a vista acompanha (DeviceOrientation → yaw/pitch
// do modo caminhar). iOS exige permissão pedida num toque (feito pelo App).
// "Recentrar" mantém a direção atual da vista como referência.
export function andarGiro(V, lig){
  const W=V.andar, T=V.THREE;
  if(W._giroFn){ window.removeEventListener('deviceorientation', W._giroFn, true); W._giroFn=null; }
  W.giro=false; if(!lig) return false;
  const q=new T.Quaternion(), q1=new T.Quaternion(-Math.sqrt(0.5),0,0,Math.sqrt(0.5)), q0=new T.Quaternion(), e=new T.Euler(), Z=new T.Vector3(0,0,1), f=new T.Vector3();
  W._giroOff=null;
  W._giroFn=(ev)=>{
    if(!W.ativo || ev.alpha==null) return;
    const R=Math.PI/180, orient=((screen.orientation&&screen.orientation.angle)||window.orientation||0)*R;
    e.set(ev.beta*R, ev.alpha*R, -ev.gamma*R, 'YXZ');
    q.setFromEuler(e); q.multiply(q1); q.multiply(q0.setFromAxisAngle(Z, -orient));
    f.set(0,0,-1).applyQuaternion(q);
    const yawG=Math.atan2(-f.x,-f.z), pitch=Math.asin(Math.max(-1,Math.min(1,f.y)));
    if(W._giroOff==null) W._giroOff=W.yaw-yawG;           // 1º evento: mantém para onde a vista já olhava
    W._giroYawG=yawG;
    W.yaw=yawG+W._giroOff; W.pitch=Math.max(-1.4,Math.min(1.4,pitch));
    andarAplicar(V);
  };
  window.addEventListener('deviceorientation', W._giroFn, true);
  W.giro=true; return true;
}
// Leva quem caminha até perto de um ponto (ex.: uma interferência), olhando para ele.
export function andarIrPara(V, alvo, dist){
  const W=V.andar, T=V.THREE; if(!W||!W.ativo||!alvo) return;
  const d=dist||2.2, dx=W.pos.x-alvo.x, dz=W.pos.z-alvo.z, L=Math.hypot(dx,dz)||1;
  W.pos.x=alvo.x+dx/L*d; W.pos.z=alvo.z+dz/L*d;
  W.yaw=Math.atan2(-(alvo.x-W.pos.x), -(alvo.z-W.pos.z));
  W.pitch=Math.atan2(alvo.y-W.pos.y, d);
  if(W._giroYawG!=null) W._giroOff=W.yaw-W._giroYawG;   // giroscópio continua de onde parou
  andarAplicar(V);
}
export function andarRecentrar(V){ const W=V.andar; if(W && W._giroYawG!=null){ W._giroOff=W.yaw-W._giroYawG; } }

// Dimensões REAIS do elemento (caixa orientada), não a caixa alinhada aos eixos do
// modelo: uma parede/painel girado em planta ganhava "largura" de 1,3 m só por causa da
// projeção. Pega a geometria (getItemsGeometry: posições + transform da amostra), leva
// os vértices ao mundo, Altura = extensão vertical; em planta acha o eixo principal por
// PCA e mede ao longo dele (Comprimento) e perpendicular (Largura = espessura real).
export async function dimOrientadas(model, localId){
  try{
    const gs=await model.getItemsGeometry([localId]); const lista=(gs&&gs[0])||[]; if(!lista.length) return null;
    const pts=[]; let total=0; lista.forEach(g=>{ total+=(g.positions&&g.positions.length||0)/3; });
    const passo=Math.max(1, Math.floor(total/6000));   // no máx. ~6k vértices amostrados
    for(const g of lista){
      const P=g.positions; if(!P||!P.length) continue;
      const e=(g.transform&&g.transform.elements)||(Array.isArray(g.transform)&&g.transform.length===16?g.transform:null);
      for(let i=0;i<P.length;i+=3*passo){ let x=P[i],y=P[i+1],z=P[i+2];
        if(e){ const nx=e[0]*x+e[4]*y+e[8]*z+e[12], ny=e[1]*x+e[5]*y+e[9]*z+e[13], nz=e[2]*x+e[6]*y+e[10]*z+e[14]; x=nx; y=ny; z=nz; }
        pts.push(x,y,z); }
    }
    const n=pts.length/3; if(n<3) return null;
    let minY=Infinity,maxY=-Infinity,mx=0,mz=0;
    for(let i=0;i<pts.length;i+=3){ const y=pts[i+1]; if(y<minY)minY=y; if(y>maxY)maxY=y; mx+=pts[i]; mz+=pts[i+2]; }
    mx/=n; mz/=n; let cxx=0,czz=0,cxz=0;
    for(let i=0;i<pts.length;i+=3){ const dx=pts[i]-mx, dz=pts[i+2]-mz; cxx+=dx*dx; czz+=dz*dz; cxz+=dx*dz; }
    const th=0.5*Math.atan2(2*cxz, cxx-czz), c=Math.cos(th), s=Math.sin(th);
    let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
    for(let i=0;i<pts.length;i+=3){ const dx=pts[i]-mx, dz=pts[i+2]-mz; const u=dx*c+dz*s, v=-dx*s+dz*c; if(u<minU)minU=u; if(u>maxU)maxU=u; if(v<minV)minV=v; if(v>maxV)maxV=v; }
    const hd=[maxU-minU, maxV-minV].sort((a,b)=>b-a);
    return { altura:maxY-minY, comprimento:hd[0], largura:hd[1], angulo:th*180/Math.PI, orientado:true };
  }catch(_){ return null; }
}

// ══════════════════════════════════════════════════════════════════════════
//  BIM 4D (App Obra) — 2026-10-19
//  Índice por modelo (categoria IFC → peças; pavimento → peças) para resolver
//  as REGRAS de vínculo das tarefas sem ler propriedade peça a peça, e pintura
//  por estado (a iniciar / em execução / atrasada / concluída).
//  Os ajustes manuais são guardados por GlobalId (estável entre revisões).
// ══════════════════════════════════════════════════════════════════════════
// Modelo com BLOCOS COPIADOS (ARQ do PINI: 47 cópias do bloco tipo, cada uma com seus
// "1º…4º PAVIMENTO" em cotas deslocadas): o nome do storey não diz o andar, a COTA diz.
// Agrupa storeys pela Elevation (cm) e dá a todos o nome mais RARO do grupo (o do prédio
// principal, ex.: "5º PAVIMENTO" aparece 1×; "4º" das cópias aparece 47×); empate → maior número.
// Subníveis "_(P.A…)" e "P.A." ficam como estão.
async function _nomesPorCota(x, sts){
  const freq={}; sts.forEach(s=>freq[s.nome]=(freq[s.nome]||0)+1);
  if(!Object.values(freq).some(v=>v>1)) return {};
  const elev={}; const ids=sts.map(s=>s.id);
  for(let p=0;p<ids.length;p+=400){ let d=[]; try{ d=await x.model.getItemsData(ids.slice(p,p+400),{attributesDefault:true,relationsDefault:{attributes:false,relations:false}})||[]; }catch(_){}
    d.forEach(o=>{ const lid=o&&o._localId&&o._localId.value; const e=o&&o.Elevation&&o.Elevation.value; if(lid!=null&&e!=null&&isFinite(+e)) elev[lid]=+e; }); }
  const sub=n=>/_\(p\.?a|^p\.a\./i.test(n);
  const grupos={}; sts.forEach(s=>{ if(elev[s.id]==null) return; const suf=(s.nome.match(/_\(p\.?a.*$/i)||[''])[0]; const k=Math.round(elev[s.id]*100)+'|'+suf.toUpperCase().replace(/[^A-Z0-9,]/g,''); (grupos[k]=grupos[k]||[]).push(s); });
  const out={};
  Object.values(grupos).forEach(g=>{ const nomes=[...new Set(g.map(s=>s.nome))]; if(nomes.length<2) return;
    const num=n=>parseInt((n.match(/\d+/)||['0'])[0],10);
    nomes.sort((a,b)=>(freq[a]-freq[b])||(num(b)-num(a))); const esc=nomes[0];
    g.forEach(s=>{ if(s.nome!==esc&&!/^p\.a\./i.test(s.nome)) out[s.id]=esc; }); });
  return out;
}
// Peças no pavimento ERRADO ou SEM pavimento (ARQ do PINI: pele de vidro, perfis, portas e
// guarda-corpos soltos; o tipo inteiro lançado no 2º) → decide pela ALTURA: base da caixa da
// peça contra a cota (Elevation) dos pavimentos. Cota do IFC → Y do mundo por ajuste linear,
// calibrado com a mediana da base das peças de cada pavimento. Só mexe quando a peça está
// sem pavimento ou a mais de 2,5 m do nível do seu pavimento (não troca peça bem colocada).
// Subníveis "_(P.A…)" e "P.A." não recebem peças.
const _CLS_ANDAR=/^IFC(WALL|CURTAINWALL|MEMBER|PLATE|DOOR|WINDOW|RAILING|COVERING|SLAB|STAIR|COLUMN|BEAM|BUILDINGELEMENTPROXY|FURNISHING|FLOWTERMINAL)/;
async function _redistribuiPorAltura(V, x, sts, pavs, canon, porCat){
  canon=canon||{};
  const elev={}; const ids=sts.map(s=>s.id);
  for(let p=0;p<ids.length;p+=400){ let d=[]; try{ d=await x.model.getItemsData(ids.slice(p,p+400),{attributesDefault:true,relationsDefault:{attributes:false,relations:false}})||[]; }catch(_){}
    d.forEach(o=>{ const lid=o&&o._localId&&o._localId.value; const e=o&&o.Elevation&&o.Elevation.value; if(lid!=null&&e!=null&&isFinite(+e)) elev[lid]=+e; }); }
  const nomeDe=s=>canon[s.id]||s.nome;
  const principal=s=>!/_\(p\.?a|^p\.a\./i.test(nomeDe(s));
  const caixa=x.model.box&&!x.model.box.isEmpty()?x.model.box:null;
  const base=async l=>{ const out=new Map(); for(let i=0;i<l.length;i+=3000){ let b=[]; try{ b=await x.model.getBoxes(l.slice(i,i+3000)); }catch(_){}
      (b||[]).forEach((bx,j)=>{ if(!(bx&&bx.min&&isFinite(bx.min.y))) return; if(caixa&&(bx.min.y<caixa.min.y-1||bx.min.y>caixa.max.y+1)) return; out.set(l[i+j],bx.min.y); }); } return out; };
  // calibração por pavimento principal (amostra de 150 peças)
  const pares=[];
  for(const s of sts){ if(!principal(s)||elev[s.id]==null||s.ids.length<5) continue;
    const ys=[...(await base(s.ids.slice(0,150))).values()].sort((a,b)=>a-b); if(ys.length<5) continue;
    pares.push([elev[s.id], ys[Math.floor(ys.length/2)]]); }
  if(pares.length<3) return 0;
  // ajuste robusto: mediana dos resíduos descarta pavimentos com peças erradas
  const fit=P=>{ const n=P.length, sx=P.reduce((a,p)=>a+p[0],0), sy=P.reduce((a,p)=>a+p[1],0), sxx=P.reduce((a,p)=>a+p[0]*p[0],0), sxy=P.reduce((a,p)=>a+p[0]*p[1],0); const a=(n*sxy-sx*sy)/(n*sxx-sx*sx); return [a,(sy-a*sx)/n]; };
  let [a,b]=fit(pares); const ok=pares.filter(p=>Math.abs(a*p[0]+b-p[1])<1.0); if(ok.length>=3) [a,b]=fit(ok);
  if(!isFinite(a)||a<=0) return 0;
  const vist=new Set(); const niveis=[];
  sts.filter(s=>principal(s)&&elev[s.id]!=null).forEach(s=>{ const nm=nomeDe(s); if(vist.has(nm)) return; vist.add(nm); niveis.push({nome:nm,y:a*elev[s.id]+b}); });
  niveis.sort((p,q)=>p.y-q.y); if(niveis.length<3) return 0;
  const yDe={}; niveis.forEach(nv=>yDe[nv.nome]=nv.y);
  const nivelDe=y=>{ let alvo=null; for(const nv of niveis){ if(nv.y<=y+0.3) alvo=nv; else break; } return alvo; };   // 30 cm: base um pouco abaixo do piso
  // onde cada peça está hoje (nível principal do seu pavimento; subnível conta como o principal)
  const atual=new Map(); Object.entries(pavs).forEach(([nm,l])=>{ const pr=nm.replace(/_\(p\.?a.*$/i,''); l.forEach(id=>atual.set(id,pr)); });
  const cand=[]; Object.entries(porCat||{}).forEach(([c,l])=>{ if(_CLS_ANDAR.test(c)) l.forEach(id=>cand.push(id)); });
  const ys=await base([...new Set(cand)]);
  let mov=0; const tira=new Map();
  ys.forEach((y,id)=>{ const cur=atual.get(id); const curY=cur!=null?yDe[cur]:null;
    if(cur!=null&&(curY==null||Math.abs(y-curY)<2.5)) return;            // bem colocada (ou pavimento sem cota)
    const nv=nivelDe(y); if(!nv||nv.nome===cur) return;
    if(cur!=null){ (tira.get(cur)||tira.set(cur,new Set()).get(cur)).add(id); }
    (pavs[nv.nome]=pavs[nv.nome]||[]).push(id); mov++; });
  if(tira.size) Object.keys(pavs).forEach(nm=>{ const pr=nm.replace(/_\(p\.?a.*$/i,''); const t=tira.get(pr); if(t) pavs[nm]=pavs[nm].filter(id=>!t.has(id)); });
  return mov;
}
export async function indice4D(V){
  if(V._idx4d) return V._idx4d;
  const st=await _storeysMapa(V);
  const out=[];
  for(let mi=0; mi<V.modelos.length; mi++){
    const x=V.modelos[mi]; if(!x||!x.model) continue;
    let cats={}; try{ cats=await x.model.getItemsOfCategories([new RegExp('^IFC'+_SEM_TIPO)])||{}; }catch(_){}
    const porCat={}; Object.entries(cats).forEach(([c,ids])=>{ const k=String(c).toUpperCase(); if(_ESPACIAL.has(k)||/TYPE$|STYLE$/.test(k)||!ids||!ids.length) return; porCat[k]=ids; });
    const stm=st.filter(s=>s.mi===mi); let canon={}; try{ canon=await _nomesPorCota(x, stm); }catch(_){}
    const pavs={}; stm.forEach(s=>{ const nm=canon[s.id]||s.nome; (pavs[nm]=pavs[nm]||[]).push(...s.ids); });
    let redist=0; try{ redist=await _redistribuiPorAltura(V, x, stm, pavs, canon, porCat); }catch(e){ console.warn('4D altura:', e); }
    out.push({ mi, doc:x.documentoId||null, nome:x.nome||'', disciplina:String(x.disciplina||'').toUpperCase(), revisao:x.revisao||'', porCat, pavs, redist });
  }
  V._idx4d=out; return out;
}
export function limpaIndice4D(V){ V._idx4d=null; }
// Resolve uma regra {disciplinas, pavimentos, classes} em {mi:[ids]}.
// Vazio em disciplinas/pavimentos = todos; vazio em classes = nenhuma peça.
export function resolverRegra4D(idx, regra){
  const ds=new Set((regra.disciplinas||[]).map(d=>String(d).toUpperCase()));
  const ps=new Set(regra.pavimentos||[]), cs=(regra.classes||[]).map(c=>String(c).toUpperCase());
  const porMod={};
  idx.forEach(m=>{
    if(ds.size && !ds.has(m.disciplina)) return;
    let ids=[]; cs.forEach(c=>{ const l=m.porCat[c]; if(l) ids=ids.concat(l); });
    if(!ids.length) return;
    if(ps.size){ const ok=new Set(); ps.forEach(p=>(m.pavs[p]||[]).forEach(i=>ok.add(i))); ids=ids.filter(i=>ok.has(i)); }
    // tipos: trechos do nome da peça/tipo (ex.: "BLOCO CERAMICO") — precisa de nomes4D antes
    if((regra.tipos||[]).length){ const ts=regra.tipos.map(_n4); const nm=m.nomes||{}; ids=ids.filter(i=>{ const n=nm[i]; return n&&ts.some(t=>n.includes(t)); }); }
    if(ids.length) porMod[m.mi]=[...new Set(ids)];
  });
  return porMod;
}
const _n4=s=>String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
// Nome (Name/ObjectType) normalizado das peças das classes pedidas, guardado em idx[*].nomes (uma vez por classe).
export async function nomes4D(V, idx, classes){
  for(const m of idx){ const x=V.modelos[m.mi]; if(!x||!x.model) continue; m.nomes=m.nomes||{}; m._nomesCls=m._nomesCls||new Set();
    for(const c of (classes||[]).map(c=>String(c).toUpperCase())){ if(m._nomesCls.has(c)) continue; m._nomesCls.add(c); const ids=m.porCat[c]; if(!ids||!ids.length) continue;
      for(let i=0;i<ids.length;i+=4000){ const fat=ids.slice(i,i+4000); let d=[]; try{ d=await x.model.getItemsData(fat,{attributesDefault:false,attributes:['Name','ObjectType'],relationsDefault:{attributes:false,relations:false}})||[]; }catch(_){}
        d.forEach((o,j)=>{ const v=o&&((o.Name&&o.Name.value)||(o.ObjectType&&o.ObjectType.value)); if(v) m.nomes[fat[j]]=_n4(v); }); } } }
}
export async function guids4D(V, mi, ids){ const x=V.modelos[mi]; if(!x||!ids||!ids.length) return [];
  try{ if(x.model.getGuidsByLocalIds) return await x.model.getGuidsByLocalIds(ids); }catch(_){}
  try{ const d=await x.model.getItemsData(ids,{attributesDefault:false,attributes:['GlobalId'],relationsDefault:{attributes:false,relations:false}}); return (d||[]).map(o=>o&&o.GlobalId&&o.GlobalId.value||null); }catch(_){ return []; } }
export async function idsDeGuids4D(V, mi, guids){ const x=V.modelos[mi]; if(!x||!guids||!guids.length) return [];
  try{ if(x.model.getLocalIdsByGuids){ const r=await x.model.getLocalIdsByGuids(guids); return (r||[]).filter(v=>v!=null); } }catch(_){}
  return []; }
// Pinta o 4D. grupos = [{porMod, cor}] (cores sólidas); fantasma = {porMod, oculto:bool}.
// Peças fora de todos os grupos ficam com a cor real.
export async function pintar4D(V, grupos, fantasma){
  const T=V.THREE; V._c4d=null;
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,true); }catch(_){} try{ await x.model.resetOpacity(undefined); }catch(_){} }
  if(fantasma&&fantasma.porMod){ for(const [mi,ids] of Object.entries(fantasma.porMod)){ const x=V.modelos[mi]; if(!x||!ids.length) continue;
    if(fantasma.oculto){ try{ await x.model.setVisible(ids,false); }catch(_){} }
    else { try{ await x.model.highlight(ids,{ color:new T.Color(0x94A3B8), renderedFaces:1, opacity:.12, transparent:true }); }catch(_){} } } }
  for(const g of (grupos||[])){ for(const [mi,ids] of Object.entries(g.porMod||{})){ const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue;
    try{ await x.model.highlight(ids,{ color:new T.Color(g.cor), renderedFaces:1, opacity:1, transparent:false }); }catch(_){} } }
  V._colorido=true;
  try{ await V.fragments.update(true); }catch(_){}
}
// Pintura INCREMENTAL do 4D: alvo = Map("mi:id" → cor numérica | 'fut'). Peça fora do mapa = cor real.
// Só toca nas peças cujo estado mudou desde a última pintura (o play não repinta 40 mil peças por quadro).
export async function pintar4Dinc(V, alvo, futOculto){
  const T=V.THREE;
  if(!V._c4d){ for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,true); }catch(_){} try{ await x.model.resetOpacity(undefined); }catch(_){} } V._c4d=new Map(); V._c4dOc=futOculto; }
  const prev=V._c4d, trocouFut=V._c4dOc!==futOculto; V._c4dOc=futOculto;
  const muda=new Map();   // destino → {mi:[ids]}   ; destino 'real' | 'fut' | número
  const vis=new Map();    // mi → ids que voltam a aparecer (saíram de 'fut' oculto)
  const poe=(dest,k)=>{ let m=muda.get(dest); if(!m) muda.set(dest,m={}); const i=k.indexOf(':'); const mi=k.slice(0,i); (m[mi]=m[mi]||[]).push(+k.slice(i+1)); };
  const volta=k=>{ const i=k.indexOf(':'); const mi=k.slice(0,i); let l=vis.get(mi); if(!l) vis.set(mi,l=[]); l.push(+k.slice(i+1)); };
  alvo.forEach((c,k)=>{ const a=prev.get(k); if(a===c&&!(c==='fut'&&trocouFut)) return; if(a==='fut'&&V._c4dOcAnt) volta(k); poe(c,k); });
  prev.forEach((a,k)=>{ if(alvo.has(k)) return; if(a==='fut'&&V._c4dOcAnt) volta(k); poe('real',k); });
  V._c4dOcAnt=futOculto;
  for(const [mi,ids] of vis){ const x=V.modelos[mi]; if(x) try{ await x.model.setVisible(ids,true); }catch(_){} }
  for(const [dest,porMod] of muda){ for(const [mi,ids] of Object.entries(porMod)){ const x=V.modelos[mi]; if(!x||!ids.length) continue;
    try{
      if(dest==='real'){ await x.model.resetHighlight(ids); }
      else if(dest==='fut'){ if(futOculto){ await x.model.resetHighlight(ids); await x.model.setVisible(ids,false); } else { await x.model.resetHighlight(ids); await x.model.setVisible(ids,true); await x.model.highlight(ids,{ color:new T.Color(0x94A3B8), renderedFaces:1, opacity:.12, transparent:true }); } }
      else { await x.model.resetHighlight(ids); await x.model.highlight(ids,{ color:new T.Color(dest), renderedFaces:1, opacity:1, transparent:false }); }
    }catch(_){} } }
  V._c4d=new Map(alvo); V._colorido=true;
  if(muda.size||vis.size) try{ await V.fragments.update(true); }catch(_){}
  let n=0; muda.forEach(m=>Object.values(m).forEach(l=>n+=l.length)); return n;
}
export async function limpar4D(V){ V._c4d=null; V._c4dOcAnt=false; for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,true); }catch(_){} try{ await x.model.resetOpacity(undefined); }catch(_){} }
  V._colorido=false; try{ await V.fragments.update(true); }catch(_){} }
