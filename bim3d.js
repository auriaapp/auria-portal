// bim3d version: 2026-08-18b  (comentário serve p/ humanos; app.html usa o ?v= do import)
// ============================================================================
//  Visualizador BIM do Auria — BASE ÚNICA (CDE e App)
//  --------------------------------------------------------------------------
//  Existia uma cópia em cde_obra.html e outra em app.html. A do App nasceu
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
    const resp = await fetch(await m.url());
    if(!resp.ok) throw new Error(`não consegui baixar "${m.nome||''}" (HTTP ${resp.status})`);
    return { m, bytes:new Uint8Array(await resp.arrayBuffer()) };
  }));
  if(V._job!==meu || !V.vivo) return;
  for(const {m, bytes} of baixados){
    aviso(baixados.length>1 ? `Carregando ${m.nome||''}…` : 'Carregando modelo…');
    const model = await V.fragments.load(bytes, { modelId:(opts_id(V))+':'+(m.id||m.nome), camera:V.camera });
    if(V._job!==meu || !V.vivo) return;
    V.modelos.push({ ...m, model, visivel:true });
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
let _seq=0; function opts_id(V){ return V._id || (V._id='v'+(++_seq)); }

// ── Carga incremental (adicionar/remover UM modelo sem recarregar os outros) ─
//  Padrão Solibri: marcar/desmarcar disciplina não reprocessa o resto. E
//  crítico: NÃO chama enquadrar() — quem já está posicionado numa parte da
//  cena mantém a mesma vista quando outra disciplina entra. Só a primeira
//  chamada (V.modelos vazio) enquadra, para o modelo aparecer no centro.
export async function adicionarModelo(V, m, msg){
  const aviso = msg || (()=>{});
  const meu = ++V._job;
  aviso('Baixando '+(m.nome||'modelo')+'…');
  const resp = await fetch(await m.url());
  if(!resp.ok) throw new Error('HTTP '+resp.status+' baixando "'+(m.nome||'')+'"');
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if(V._job!==meu || !V.vivo) return null;
  aviso('Carregando '+(m.nome||'modelo')+'…');
  const model = await V.fragments.load(bytes, {
    modelId: opts_id(V)+':'+(m.id||m.nome),
    camera: V.camera
  });
  if(V._job!==meu || !V.vivo){ try{ model.dispose(); }catch(_){} return null; }
  const wrapper = { ...m, model, visivel:true };
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
  V.niveis=null; V._faixas=null; V.porNivel=null; V._storeys=null; V._boxCache=null;   //novo modelo → recalcula níveis/pavimentos/caixas do clash
  try{ await V.fragments.update(true); }catch(_){}
  V._pronto = true;   // defensivo: qualquer caminho de carga libera pins/sombra
  return wrapper;
}
// Remove um modelo específico da cena e libera memória.
export async function descarregarUm(V, idBusca){
  const i = V.modelos.findIndex(x => (x.arquivoId||x.id||x.nome) === idBusca);
  if(i<0) return;
  const x = V.modelos[i];
  V.modelos.splice(i, 1);
  try{ V.scene.remove(x.model.object); }catch(_){}
  try{ x.model.dispose(); }catch(_){}
  // Se a peça anterior de raio-X estava neste modelo, some junto.
  if(V._xrayUlt && V._xrayUlt.modelo === x) V._xrayUlt = null;
  // Se estava escondendo peça deste modelo, esquece.
  if(V._escondidos && V._escondidos.has(x)) V._escondidos.delete(x);
  V._xrayReady = false; V._xrayCache = null;
  V.niveis=null; V._faixas=null; V.porNivel=null; V._storeys=null; V._boxCache=null;   //conjunto de lajes mudou → recalcula pavimentos/caixas do clash
  try{ await V.fragments.update(true); }catch(_){}
}

export function descartar(V){
  if(!V) return;
  V.vivo=false; V._job++;
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
  if(!V.vivo || !hit || !(hit.distance>0)) return;
  const dir=new V.THREE.Vector3(); V.camera.getWorldDirection(dir);
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
      color:new T.Color(LARANJA), renderedFaces:1, opacity:1, transparent:false }); }catch(_){}
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
    if(k[0]==='_') continue;                          // pula _guid/_localId/_category
    if(Array.isArray(v)){
      v.forEach(ps=>{ if(!ps||typeof ps!=='object') return;
        Object.values(ps).forEach(sub=>{
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
  const R=[]; const N=100;   // lotes menores → o Parar responde mais rápido
  for(let i=0;i<ids.length;i+=N){
    if(V._cancelar) throw new Error('CANCELADO');
    let da=[]; try{ da=await model.getItemsData(ids.slice(i,i+N), { attributesDefault:true,
      relations:{ IsDefinedBy:{attributes:true,relations:true} }, relationsDefault:{attributes:false,relations:false} }); }catch(_){}
    if(V._cancelar) throw new Error('CANCELADO');   // checa também DEPOIS da leitura
    for(const d of (da||[])) R.push(d);
    if(V.on && V.on.dica) V.on.dica((rotulo||'Processando')+'… '+Math.min(i+N,ids.length)+'/'+ids.length);
    await new Promise(r=>setTimeout(r,0));   // cede o thread p/ o clique em Parar rodar
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
  for(const x of V.modelos){
    let sids=[]; try{ sids=Object.values(await x.model.getItemsOfCategories([/^IFCSLAB$/])||{}).flat(); }catch(_){}
    if(!sids.length) continue;
    const cache=await _pavimMapModelo(V, x, sids, 'Mapeando pavimentos');   // Pset só das lajes
    let boxes=[]; try{ boxes=await x.model.getBoxes(sids); }catch(_){}
    sids.forEach((id,i)=>{ const nm=cache.get(id); const b=(boxes||[])[i];
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
const CAT_VISIVEIS=[/^IFCWALL/,/^IFCSLAB/,/^IFCCOLUMN/,/^IFCBEAM/,/^IFCDOOR/,/^IFCWINDOW/,/^IFCSTAIR/,
  /^IFCRAILING/,/^IFCROOF/,/^IFCCURTAINWALL/,/^IFCPLATE/,/^IFCMEMBER/,/^IFCCOVERING/,/^IFCFOOTING/,
  /^IFCPILE/,/^IFCRAMP/,/^IFCBUILDINGELEMENTPROXY/,/^IFCFURNI/,/^IFCFLOWSEGMENT/,/^IFCFLOWTERMINAL/,/^IFCFLOWFITTING/];
// Isola um PAVIMENTO INTEIRO (todas as categorias) pela faixa de altura — para
// "destacar o pavimento térreo" sem citar classe. Sem realce (cores naturais).
export async function isolarPavimento(V, pavim){
  V._cancelar=false;
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
export async function acharElementos(V, regexes, termos, pavim){
  V._cancelar=false;
  const termosLc=(termos||[]).map(t=>String(t).trim().toLowerCase()).filter(Boolean);
  const pavN = pavim ? _norm(pavim) : '';
  const porMod={};
  for(let mi=0; mi<V.modelos.length; mi++){
    const x=V.modelos[mi];
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(regexes)||{}).flat(); }catch(_){}
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
        let dados=[]; const precisaPset = pavN || termosLc.includes('@fire');
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
  let n=0, comValor=0, soma=0; const nomes=new Set();
  for(const [mi,ids] of Object.entries(porMod||{})){
    const x=V.modelos[mi]; if(!x||!ids||!ids.length) continue; n+=ids.length;
    const dd=await _lerPsetsEmLotes(V, x.model, ids, 'Somando');
    (dd||[]).forEach(d=>{ const r=_achaValorProfundo(d, rx); if(r&&typeof r.val==='number'){ soma+=r.val; comValor++; nomes.add(r.nome); } });
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
// Candidatos de conflito entre A e B: pares cujas CAIXAS se interpenetram além
// da tolerância `tol` (m). Broad-phase com grade uniforme (rápido). Retorna os
// elementos envolvidos por modelo, p/ destacar. NÃO é clash geométrico confirmado.
export async function clashCandidatos(V, regexesA, regexesB, tol){
  V._cancelar=false; tol = (tol==null?0.01:tol);
  const A=await _caixasDe(V, regexesA), B=await _caixasDe(V, regexesB);
  if(!A.length || !B.length) return { nPares:0, nA:0, nB:0, vazioA:!A.length, vazioB:!B.length, porModA:{}, porModB:{} };
  const cell=2.0, grid=new Map();
  const cellsOf=(b)=>{ const out=[];
    for(let cx=Math.floor(b.min.x/cell);cx<=Math.floor(b.max.x/cell);cx++)
    for(let cy=Math.floor(b.min.y/cell);cy<=Math.floor(b.max.y/cell);cy++)
    for(let cz=Math.floor(b.min.z/cell);cz<=Math.floor(b.max.z/cell);cz++) out.push(cx+'|'+cy+'|'+cz);
    return out; };
  B.forEach((it,bi)=>{ for(const k of cellsOf(it.b)){ let a=grid.get(k); if(!a){a=[];grid.set(k,a);} a.push(bi); } });
  const inter=(a,b)=>{ return (Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x))>tol
    && (Math.min(a.max.y,b.max.y)-Math.max(a.min.y,b.min.y))>tol
    && (Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z))>tol; };
  const porModA={}, porModB={}; const vA=new Set(), vB=new Set(); let nPares=0;
  const pares=[]; const CAP=400;   // lista individual (limitada p/ não travar a UI)
  for(let ai=0; ai<A.length; ai++){
    if(V._cancelar) throw new Error('CANCELADO');
    const it=A[ai]; const cand=new Set();
    for(const k of cellsOf(it.b)){ const arr=grid.get(k); if(arr) for(const bi of arr) cand.add(bi); }
    for(const bi of cand){ const jb=B[bi];
      if(jb.mi===it.mi && jb.id===it.id) continue;              // não conflita consigo mesmo
      if(inter(it.b, jb.b)){ nPares++;
        const ka=it.mi+':'+it.id; if(!vA.has(ka)){ vA.add(ka); (porModA[it.mi]=porModA[it.mi]||[]).push(it.id); }
        const kb=jb.mi+':'+jb.id; if(!vB.has(kb)){ vB.add(kb); (porModB[jb.mi]=porModB[jb.mi]||[]).push(jb.id); }
        if(pares.length<CAP) pares.push({ aMi:it.mi, aId:it.id, bMi:jb.mi, bId:jb.id });
      }
    }
    if(ai%150===0){ if(V.on&&V.on.dica) V.on.dica('Verificando conflitos… '+ai+'/'+A.length); await new Promise(r=>setTimeout(r,0)); }
  }
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
  return { nPares, nA:vA.size, nB:vB.size, porModA, porModB, pares };
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
// Botão de CONTEXTO FANTASMA (🗺️): deixa translúcido só a VIZINHANÇA do clash
// (conjunto pequeno → setOpacity seguro, sem o estouro do global) e mantém o par
// OPACO em vermelho/ciano. Como é um zoom local, a vizinhança já basta de contexto.
export async function mostrarClashFantasma(V, aMi, aId, bMi, bId){
  const T=V.THREE;
  await _limparFantasma(V);
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,true); }catch(_){} }
  // Região centrada no PONTO do conflito (interseção das caixas), tamanho FIXO.
  //  Antes eu expandia a UNIÃO das caixas: um tubo longo tinha caixa enorme e a
  //  vizinhança capturava milhares de peças → setOpacity estourava a memória e
  //  travava os cliques seguintes. Agora é uma caixa pequena e com TETO.
  let bA=null,bB=null;
  try{ bA=((await V.modelos[aMi].model.getBoxes([aId]))||[])[0]; }catch(_){}
  try{ bB=((await V.modelos[bMi].model.getBoxes([bId]))||[])[0]; }catch(_){}
  const ctr=(a,b,ax)=> (a&&b)? (Math.max(a.min[ax],b.min[ax])+Math.min(a.max[ax],b.max[ax]))/2 : (a?(a.min[ax]+a.max[ax])/2 : (b?(b.min[ax]+b.max[ax])/2 : null));
  const px=ctr(bA,bB,'x'), py=ctr(bA,bB,'y'), pz=ctr(bA,bB,'z');
  if(px!=null){
    const R=7, TETO=1500;   // 7 m ao redor do conflito; no máx. 1500 peças
    const reg={minx:px-R,maxx:px+R,miny:py-R,maxy:py+R,minz:pz-R,maxz:pz+R};
    const fant={}; let total=0;
    for(let mi=0; mi<V.modelos.length && total<TETO; mi++){ const x=V.modelos[mi];
      let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(CAT_VISIVEIS)||{}).flat(); }catch(_){}
      if(!ids.length) continue;
      let boxes=[]; try{ boxes=await x.model.getBoxes(ids); }catch(_){}
      const near=[];
      for(let i=0;i<ids.length && total<TETO;i++){ const b=(boxes||[])[i]; if(!b) continue; const id=ids[i];
        if(b.min.x<reg.maxx&&b.max.x>reg.minx&&b.min.y<reg.maxy&&b.max.y>reg.miny&&b.min.z<reg.maxz&&b.max.z>reg.minz
           && !(mi===aMi&&id===aId) && !(mi===bMi&&id===bId)){ near.push(id); total++; }
      }
      if(near.length){ fant[mi]=near; try{ await x.model.setOpacity(near, 0.12); }catch(_){} }
    }
    V._fantasmaIds=fant;
  }
  // par: opaco + cor
  try{ await V.modelos[aMi].model.setOpacity([aId],1); await V.modelos[aMi].model.highlight([aId],{color:new T.Color(0xEF4444),renderedFaces:1,opacity:1,transparent:false}); }catch(_){}
  try{ await V.modelos[bMi].model.setOpacity([bId],1); await V.modelos[bMi].model.highlight([bId],{color:new T.Color(0x22D3EE),renderedFaces:1,opacity:1,transparent:false}); }catch(_){}
  V._isolado=false; V._isoladoPorMod=null; V._colorido=false; V._cores=null; V._fantasma=true;
  try{ await V.fragments.update(true); }catch(_){}
}
// Ponto (centro) de um conflito, em coordenadas de mundo — p/ ancorar o pino do apontamento.
export async function pontoClash(V, aMi, aId, bMi, bId){
  const T=V.THREE;
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
  const faixas=await _faixasPavimento(V);
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
  (V.medida.medidas||[]).slice().forEach(md=>{ if(md._peDireito) removerMedida(V, md); });
  if(V.on.medidas) V.on.medidas(V);
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} try{ await x.model.setVisible(undefined,true); }catch(_){} }
  V._isolado=false; V._isoladoPorMod=null; V._colorido=false; V._cores=null;
  try{ await V.fragments.update(true); }catch(_){}
}
// Mostra os infratores em VERMELHO sobre o modelo completo (contexto ajuda no
// pé-direito) + uma cota vertical em cada + zoom-extend no conjunto.
export async function mostrarPeDireito(V, achados){
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
    if(pavN || termosLc.includes('@fire')){ da=await _lerPsetsEmLotes(V, x.model, ids, 'Contando'); }
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
function _achaValorProfundo(d, rx){
  if(!d) return null;
  const escal=(o)=> (o && typeof o==='object' && 'value' in o && typeof o.value!=='object') ? o.value : undefined;
  const cands=[];   // coleta TODOS os matches p/ escolher o melhor (evita misturar Net/Gross)
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
  if(!cands.length) return null;
  // Preferência p/ somar CONSISTENTE: Net > (não-Gross) > primeiro. Assim não
  // mistura NetVolume de uns com GrossVolume de outros.
  return cands.find(c=>/net/i.test(c.nome)) || cands.find(c=>!/gross/i.test(c.nome)) || cands[0];
}
// SOMA uma quantidade (área/volume/comprimento) sobre um subconjunto filtrado.
// `termos` (opcional) filtra por texto nos atributos (ex.: "ACM"); `termoProp` é
// o que somar. Lê Psets só do subconjunto filtrado (bounded).
export async function somarPropriedade(V, regexes, termos, termoProp){
  const termosLc=(termos||[]).map(t=>String(t).trim().toLowerCase()).filter(Boolean);
  const rx=_termoRegex(termoProp);
  const tp=(termoProp||'').toLowerCase();
  const ehArea=/[áa]rea/.test(tp), ehComp=/larg|width|alt|height|comp|length/.test(tp), ehVol=/vol/.test(tp);
  let n=0, comValor=0, calculados=0, soma=0; const nomes=new Set();
  for(const x of V.modelos){
    let ids=[]; try{ ids=Object.values(await x.model.getItemsOfCategories(regexes)||{}).flat(); }catch(_){}
    if(!ids.length) continue;
    if(termosLc.length){                          // filtro por texto (atributos, leve)
      let da=[]; try{ da=await x.model.getItemsData(ids, { attributesDefault:true, relationsDefault:{attributes:false,relations:false} }); }catch(_){}
      const ok=[]; (da||[]).forEach(d=>{ const lid=d&&d._localId&&d._localId.value; if(lid==null) return; if(_bateTermos(d, termosLc)) ok.push(lid); });
      ids=ok;
    }
    if(!ids.length) continue;
    n+=ids.length;
    let dd=[]; try{ dd=await x.model.getItemsData(ids, { attributesDefault:true,
      relations:{ IsDefinedBy:{attributes:true,relations:true} }, relationsDefault:{attributes:false,relations:false} }); }catch(_){}
    const faltam=[];
    (dd||[]).forEach((d,i)=>{ const r=_achaValorProfundo(d, rx);
      if(r && typeof r.val==='number'){ soma+=r.val; comValor++; nomes.add(r.nome); }
      else faltam.push(ids[i]);
    });
    // Reserva GEOMÉTRICA (só área/comprimento; volume NUNCA — regra do TQS
    // nervurado). Área ≈ maior horizontal × altura (face de parede).
    if(faltam.length && (ehArea||ehComp) && !ehVol){
      let boxes=[]; try{ boxes=await x.model.getBoxes(faltam); }catch(_){}
      (boxes||[]).forEach(b=>{ if(!b||!b.min||!b.max||!isFinite(b.max.y)) return;
        const dy=b.max.y-b.min.y, hd=[b.max.x-b.min.x, b.max.z-b.min.z].sort((a,b)=>b-a);
        const val = ehArea ? (hd[0]*dy) : hd[0];
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
      const s = ids ? await x.model.getSection(V.corte.plano, ids)
                    : await x.model.getSection(V.corte.plano);
      if(!s||!s.buffer||!s.buffer.length) continue;
      const temFill = V.hachura!==false && s.fillsIndices && s.fillsIndices.length;

      // Aresta FINA por baixo: todas as arestas do getSection. Ficam como
      // linhas de referência (elementos cortados que não geram fill, como
      // vidros vazados, e a estrutura interna do próprio fill).
      const gFina=new T.BufferGeometry();
      gFina.setAttribute('position', new T.BufferAttribute(s.buffer,3));
      const mFina=new T.LineBasicMaterial({ color:LARANJA, depthTest:false,
        transparent:true, opacity: temFill ? 0.45 : 1.0 });
      const linhaFina=new T.LineSegments(gFina, mFina); linhaFina.renderOrder=997;
      grupo.add(linhaFina);

      // Hachura sólida.
      if(temFill){
        const g2=new T.BufferGeometry();
        g2.setAttribute('position', new T.BufferAttribute(s.buffer,3));
        g2.setIndex(s.fillsIndices);
        const m2=new T.MeshBasicMaterial({ color:HACHURA, side:T.DoubleSide, depthTest:false });
        const malha=new T.Mesh(g2,m2); malha.renderOrder=998;
        grupo.add(malha);
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
          grupo.add(linha);
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
  const v=4.5*(W.teclas.has('shift')?3:1);
  W.pos.addScaledVector(mov.normalize(), v*dt);
  andarAplicar(V);
}
