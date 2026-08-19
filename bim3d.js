// bim3d version: 2026-08-18a  (comentário serve p/ humanos; app.html usa o ?v= do import)
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

  const V = {
    THREE, FRAGS, cont, canvas, renderer, scene, camera, controls, fragments,
    luzes: { hemi, ambiente, sol, fill },   // expostas p/ o painel de configuração
    modelos:[], vivo:true, raf:null, ro:null,
    caixa:null, unidade:1, niveis:null, porNivel:null,
    facesDuplas:true, _ultFaces:0,
    corte:  { ativo:false, ancora:null, normal:null, inv:false, plano:null, ajuda:null, arestas:null, mostrarAjuda:true },
    medida: { ativo:false, modo:'eixo', snapOn:true, medidas:[], pend:null },
    andar:  { ativo:false, armado:false, nivel:0, yaw:0, pitch:0, pos:null,
              teclas:new Set(), camPos:null, camRot:null, alvo:null, ultUpd:0 },
    on: opts.on || {},          // { selecionar, medir, dica, pinos, nivel, modo, podeTeclado }
    _job:0
  };

  ligarEntrada(V);
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
  aplicarFaces(V, true);
  await V.fragments.update(true);
}
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
  // Cache do raio-X fica obsoleto (a lista de peças mudou); descarta,
  // será refeito na próxima ativação.
  V._xrayReady = false; V._xrayCache = null;
  try{ await V.fragments.update(true); }catch(_){}
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
    // esteja exatamente em cota zero.
    grade.position.y = -0.005;
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

// Tubo e duto de alguns exportadores são CASCA (superfície sem espessura). Com
// descarte de face traseira, de dentro a face some e a peça aparece pela
// metade. Barato: o Fragments compartilha materiais entre tiles.
export function aplicarFaces(V, forcar){
  const agora=performance.now();
  if(!forcar && agora-(V._ultFaces||0) < 600) return;
  V._ultFaces=agora;
  const lado = (V.facesDuplas!==false) ? V.THREE.DoubleSide : V.THREE.FrontSide;
  const vistos=new Set();
  V.modelos.forEach(x=>{ try{
    x.model.object.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        if(!mm||vistos.has(mm.uuid)) return;
        vistos.add(mm.uuid);
        if(mm.side!==lado){ mm.side=lado; mm.needsUpdate=true; }
      });
    });
  }catch(_){} });
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
    if(V.ao && V.composer) V.composer.render();
    else                   V.renderer.render(V.scene, V.camera);
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
export async function destacar(V, modelo, ids){
  for(const x of V.modelos){ try{ await x.model.resetHighlight(); }catch(_){} }
  if(modelo && ids && ids.length){
    try{ await modelo.model.highlight(ids, {
      color:new V.THREE.Color(LARANJA), renderedFaces:1, opacity:1, transparent:false }); }catch(_){}
  }
  try{ await V.fragments.update(true); }catch(_){}
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
  const medida={ marks:[M.pend.mark, esf], line:linha, el, meio:a.clone().add(b).multiplyScalar(0.5), dist };
  el.innerHTML='<span>'+rot+fmtDist(dist)+'</span><span class="x" title="Apagar esta medida" style="cursor:pointer;font-weight:800;font-size:13px;line-height:1;opacity:.65;padding:0 2px">×</span>';
  el.querySelector('.x').addEventListener('click', (e)=>{ e.stopPropagation(); removerMedida(V, medida); });
  V.cont.appendChild(el);
  M.medidas.push(medida);
  M.pend=null;
  if(V.on.medir) V.on.medir(dist);
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
}
// Quantas cotas existem (para a UI mostrar/ocultar o botão limpar).
export function contarMedidas(V){ return (V&&V.medida&&V.medida.medidas)?V.medida.medidas.length:0; }
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
