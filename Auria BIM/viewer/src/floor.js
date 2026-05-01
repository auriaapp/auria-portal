import {
  Viewer, XKTLoaderPlugin,
  DistanceMeasurementsPlugin, DistanceMeasurementsMouseControl,
  SectionPlanesPlugin, NavCubePlugin,
} from "@xeokit/xeokit-sdk";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xrgxdfwxsulrjgqtrjrr.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZ3hkZnd4c3VscmpncXRyanJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNDM5NTYsImV4cCI6MjA5MjcxOTk1Nn0.Zl5wObchlzLaSaDs1dWcDyreX-tiS6mKO3B5eoTCu3U";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── URL params ────────────────────────────────────────────────────────────────
const params       = new URLSearchParams(location.search);
const projectId    = params.get("project");
const floorId      = params.get("floor");       // GUID do pavimento
const xktUrl       = params.get("xkt");
const metaUrl      = params.get("meta");
const obraId       = params.get("obra") || projectId;
const buildingName = decodeURIComponent(params.get("building") || projectId || "Auria BIM");

// ── Viewer ────────────────────────────────────────────────────────────────────
const viewer = new Viewer({
  canvasId: "viewerCanvas", transparent: false,
  backgroundColor: [0.06, 0.07, 0.09], saoEnabled: true, antialias: true,
});
viewer.camera.eye  = [10, 10, 10];
viewer.camera.look = [0, 0, 0];
viewer.camera.up   = [0, 1, 0];

new NavCubePlugin(viewer, { canvasId: "navCubeCanvas", visible: false });

// ── Elimina drift no mobile ───────────────────────────────────────────────────
viewer.cameraControl.inertia    = 0;   // inércia de rotação
viewer.cameraControl.panInertia = 0;   // inércia de pan
try { viewer.cameraControl.rotationInertia = 0; } catch(_) {}
try { viewer.cameraControl.dollyInertia    = 0; } catch(_) {}
// dollyToPointer=true (default) causa pan lateral durante pinch-zoom → desativa
try { viewer.cameraControl.dollyToPointer  = false; } catch(_) {}
try { viewer.cameraControl.pivotOnPointer  = false; } catch(_) {}

// ── Auto-home: se câmera derivar longe do modelo, retorna automaticamente ─────
// (roda 600 ms após soltar o toque — sem nenhuma ação do usuário)
let _autoHomeTimer = null;
function _flyHome(duration = 1.0) {
  const ids = floorObjectIds || viewer.scene.objectIds;
  if (!ids.length) return;
  viewer.cameraFlight.flyTo({ aabb: viewer.scene.getAABB(ids), duration });
}
function _scheduleAutoHome() {
  clearTimeout(_autoHomeTimer);
  _autoHomeTimer = setTimeout(() => {
    const ids = floorObjectIds || viewer.scene.objectIds;
    if (!ids.length) return;
    const aabb = viewer.scene.getAABB(ids);
    const mcx = (aabb[0]+aabb[3])/2, mcy = (aabb[1]+aabb[4])/2, mcz = (aabb[2]+aabb[5])/2;
    const diag = Math.hypot(aabb[3]-aabb[0], aabb[4]-aabb[1], aabb[5]-aabb[2]) || 1;
    const [ex,ey,ez] = viewer.camera.eye;
    const [lx,ly,lz] = viewer.camera.look;
    const distEye  = Math.hypot(ex-mcx, ey-mcy, ez-mcz);
    const distLook = Math.hypot(lx-mcx, ly-mcy, lz-mcz);
    // Se câmera > 20× diagonal longe OU look-point > 8× diagonal: volta ao modelo
    if (distEye > diag * 20 || distLook > diag * 8) _flyHome(1.0);
  }, 600);
}
const xktLoader    = new XKTLoaderPlugin(viewer);
const distMeas     = new DistanceMeasurementsPlugin(viewer, { defaultAxisVisible: true });
const distCtrl     = new DistanceMeasurementsMouseControl(distMeas, { snapping: true });
const sectionPlanes = new SectionPlanesPlugin(viewer, { overviewCanvasId: "sectionPlanesOverviewCanvas" });

// ── Estado ────────────────────────────────────────────────────────────────────
let activeTool     = "orbit";
let floorObjectIds = null;   // IDs do pavimento atual (null = todos)
const loadedModels = {};     // modelId → SceneModel
let regionPoints   = [];     // [{x,y,z}] pontos do polígono de região (XZ world)
let _regionClickTimer = null;
let selPickMode    = false;           // modo seleção manual ativo?
const selElements  = new Set();       // GUIDs selecionados manualmente

// ── Load modelo principal ─────────────────────────────────────────────────────
async function loadModel() {
  const loadingEl   = document.getElementById("loadingOverlay");
  const loadingText = document.getElementById("loadingText");
  try {
    const src  = xktUrl  || `/models/${projectId}.xkt`;
    const meta = metaUrl || `/models/${projectId}-metadata.json`;
    const model = xktLoader.load({ id: projectId, src, metaModelSrc: meta, edges: true, saoEnabled: true });
    loadedModels[projectId] = model;
    model.on("loaded", () => {
      filterByFloor(floorId);
      loadingEl.style.display = "none";
      updateHeader();
      updateVolumePanel();
    });
    model.on("error", err => { loadingText.textContent = `Erro: ${err}`; });
  } catch (err) {
    loadingText.textContent = `Erro: ${err.message}`;
  }
}

// ── Filtro de pavimento — robusto ─────────────────────────────────────────────
function filterByFloor(storeyId) {
  if (!storeyId) { viewer.cameraFlight.flyTo(viewer.scene); return; }

  // Tentativa 1: hierarquia do metadata
  const storeyMeta = viewer.metaScene.metaObjects[storeyId];
  let ids = storeyMeta ? storeyMeta.getObjectIDsInSubtree().filter(id => id !== storeyId) : [];

  // Tentativa 2: fallback — filtra por tipo com escopo completo (se subtree vazio)
  if (ids.length === 0) {
    ids = viewer.scene.objectIds.filter(id => {
      const mo = viewer.metaScene.metaObjects[id];
      return mo && mo.type !== "IfcBuildingStorey" && mo.parent?.id === storeyId;
    });
  }

  // Tentativa 3: mostra todos se ainda vazio (modelo sem hierarquia)
  if (ids.length === 0) ids = viewer.scene.objectIds;

  viewer.scene.setObjectsVisible(viewer.scene.objectIds, false);
  floorObjectIds = [...new Set(ids)];  // deduplica
  viewer.scene.setObjectsVisible(floorObjectIds, true);
  viewer.scene.setObjectsPickable(floorObjectIds, true);
  viewer.cameraFlight.flyTo({ aabb: viewer.scene.getAABB(floorObjectIds), duration: 0.8 });
  applyTypeFilters();
}

// ── Filtros por tipo ──────────────────────────────────────────────────────────
function getActiveTypes() {
  const s = new Set();
  document.querySelectorAll("[data-types]").forEach(inp => {
    if (inp.checked) inp.dataset.types.split(",").forEach(t => s.add(t.trim()));
  });
  return s;
}
function applyTypeFilters() {
  const active = getActiveTypes();
  const scope  = floorObjectIds || viewer.scene.objectIds;
  const show   = scope.filter(id => {
    const mo = viewer.metaScene.metaObjects[id];
    return !mo || active.has(mo.type) || mo.type === "IfcBuildingStorey";
  });
  viewer.scene.setObjectsVisible(scope, false);
  viewer.scene.setObjectsVisible(show, true);
  updateVolumePanel();
}
document.querySelectorAll("[data-types]").forEach(i => i.addEventListener("change", applyTypeFilters));

// ── Volume ────────────────────────────────────────────────────────────────────
const CONCRETE = new Set(["IfcColumn","IfcBeam","IfcSlab","IfcFooting","IfcPile","IfcWall","IfcMember"]);
const TYPE_LABELS = { IfcColumn:"Pilares", IfcBeam:"Vigas", IfcMember:"Membros",
  IfcSlab:"Lajes", IfcFooting:"Fundações", IfcPile:"Estacas", IfcWall:"Paredes" };

// ── Volume via teorema da divergência (geometria 3D exata) ────────────────────
function computeEntityVolume(entity) {
  if (!entity) return 0;
  let total = 0;
  const meshes = entity.meshes;
  if (meshes?.length) {
    for (const mesh of meshes) {
      const g = mesh.geometry;
      if (!g) continue;
      let pos = g.positions;
      // Descomprime posições quantizadas se necessário
      if (!pos?.length && g.positionsCompressed?.length && g.positionsDecodeMatrix) {
        const pc = g.positionsCompressed, dm = g.positionsDecodeMatrix;
        pos = new Float32Array(pc.length);
        for (let i = 0; i < pc.length; i += 3) {
          pos[i]   = pc[i]   * dm[0]  + dm[12];
          pos[i+1] = pc[i+1] * dm[5]  + dm[13];
          pos[i+2] = pc[i+2] * dm[10] + dm[14];
        }
      }
      const idx = g.indices;
      if (!pos?.length || !idx?.length) continue;
      let vol = 0;
      for (let k = 0; k < idx.length; k += 3) {
        const a = idx[k]*3, b = idx[k+1]*3, c = idx[k+2]*3;
        vol += (pos[a]*(pos[b+1]*pos[c+2] - pos[b+2]*pos[c+1])
              + pos[b]*(pos[c+1]*pos[a+2] - pos[c+2]*pos[a+1])
              + pos[c]*(pos[a+1]*pos[b+2] - pos[a+2]*pos[b+1])) / 6;
      }
      total += Math.abs(vol);
    }
    if (total > 0) return total; // XKT em metros → resultado já em m³
  }
  // Fallback AABB — coordenadas em metros, volume direto em m³
  const bb = entity.aabb;
  if (bb) return Math.abs((bb[3]-bb[0]) * (bb[4]-bb[1]) * (bb[5]-bb[2]));
  return 0;
}

function getFck(mo) {
  for (const ps of (mo.propertySets || [])) {
    for (const p of (ps.properties || [])) {
      const raw = typeof p.value === "object" ? p.value?.value : p.value;
      // TQS exporta Material = "Concreto C50" — extrai o número da classe
      if (p.name === "Material") {
        const m = String(raw || "").match(/C\s*(\d+)/i);
        if (m) return m[1];
      }
      // Fallback: propriedade Fck direta
      if (/^fck$/i.test(p.name) && raw != null) return String(raw);
    }
  }
  return null;
}

// ── Detecção de sobreposições Pilar×Viga ─────────────────────────────────────
// Pilares (+ fundações/estacas) têm prioridade sobre vigas.
// O volume da região de interseção é descontado das vigas para evitar
// dupla contagem na concretagem de trechos.
const OVERLAP_PRIORITY  = new Set(["IfcColumn","IfcFooting","IfcPile"]);
const OVERLAP_SECONDARY = new Set(["IfcBeam","IfcMember"]);
const OVERLAP_MIN_M3    = 0.0001; // 100 cm³ — ignora ruído numérico de AABBs

/** Intersecção volumétrica de dois AABBs [minX,minY,minZ,maxX,maxY,maxZ] */
function _aabbOverlapVol(a1, a2) {
  const ox = Math.max(0, Math.min(a1[3],a2[3]) - Math.max(a1[0],a2[0]));
  const oy = Math.max(0, Math.min(a1[4],a2[4]) - Math.max(a1[1],a2[1]));
  const oz = Math.max(0, Math.min(a1[5],a2[5]) - Math.max(a1[2],a2[2]));
  return ox * oy * oz;
}

/**
 * Calcula volumes de concreto com desconto automático de sobreposições.
 * @param {string[]} elementIds
 * @param {boolean}  skipTypeFilter — true para seleção manual (ignora filtro ativo)
 * @returns {{ elems, byType, byFck, total, totalRaw, totalOverlap, overlapPairs,
 *             affectedBeams, deductions }}
 */
function computeVolumeWithOverlaps(elementIds, skipTypeFilter = false) {
  const active = getActiveTypes();
  const elems  = [];

  for (const id of elementIds) {
    const mo = viewer.metaScene.metaObjects[id];
    if (!mo || !CONCRETE.has(mo.type)) continue;
    if (!skipTypeFilter && !active.has(mo.type)) continue;
    const entity = viewer.scene.objects[id];
    if (!entity?.visible || !entity.aabb) continue;
    const vol = computeEntityVolume(entity);
    if (vol <= 0) continue;
    elems.push({
      id, mo, entity, vol,
      fck:         getFck(mo),
      isPriority:  OVERLAP_PRIORITY.has(mo.type),
      isSecondary: OVERLAP_SECONDARY.has(mo.type),
    });
  }

  // Cruza cada pilar/fundação com cada viga e acumula deduções
  const priority   = elems.filter(e => e.isPriority);
  const secondary  = elems.filter(e => e.isSecondary);
  const deductions = {};   // id → m³ a descontar desta viga
  let totalOverlap = 0, overlapPairs = 0;

  for (const p of priority) {
    for (const s of secondary) {
      const ov = _aabbOverlapVol(p.entity.aabb, s.entity.aabb);
      if (ov > OVERLAP_MIN_M3) {
        deductions[s.id] = (deductions[s.id] || 0) + ov;
        totalOverlap += ov;
        overlapPairs++;
      }
    }
  }

  const affectedBeams = Object.keys(deductions).length;

  // Totais por tipo e por fck — já com desconto aplicado
  const byType = {}, byFck = {};
  let total = 0, totalRaw = 0;

  for (const el of elems) {
    totalRaw += el.vol;
    const ded    = deductions[el.id] || 0;
    const adjVol = Math.max(0, el.vol - ded);
    byType[el.mo.type] = (byType[el.mo.type] || 0) + adjVol;
    total += adjVol;
    if (el.fck) byFck[el.fck] = (byFck[el.fck] || 0) + adjVol;
  }

  return { elems, byType, byFck, total, totalRaw, totalOverlap, overlapPairs, affectedBeams, deductions };
}

/** Gera o bloco HTML de aviso de sobreposições */
function _overlapWarningHtml(r, decimals = 3) {
  if (r.totalOverlap < OVERLAP_MIN_M3) return "";
  const fmt = v => v.toFixed(decimals);
  return `
    <div style="margin-top:12px;padding:9px 11px;background:#1c1200;
         border:1px solid #78350f;border-radius:7px;line-height:1.55">
      <div style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:.07em;margin-bottom:5px">
        ⚠ SOBREPOSIÇÕES DETECTADAS
      </div>
      <div style="color:#94a3b8;font-size:11px">
        <b style="color:#fbbf24">${r.affectedBeams}</b>
        viga${r.affectedBeams>1?"s":""}
        &nbsp;·&nbsp;
        <b style="color:#fbbf24">${r.overlapPairs}</b>
        par${r.overlapPairs>1?"es":""} Pilar×Viga
        &nbsp;·&nbsp;
        <span style="color:#f87171">−${fmt(r.totalOverlap)} m³</span> descontado
      </div>
      <div style="margin-top:4px;font-size:10px;color:#64748b">
        Volume bruto:&nbsp;<span style="color:#94a3b8">${fmt(r.totalRaw)} m³</span>
        &nbsp;→&nbsp;
        Volume líquido:&nbsp;<span style="color:#34d399;font-weight:700">${fmt(r.total)} m³</span>
      </div>
    </div>`;
}

function updateVolumePanel() {
  const scope  = [...new Set(floorObjectIds || viewer.scene.objectIds)];
  const result = computeVolumeWithOverlaps(scope);
  const { byType, byFck, total, deductions, elems } = result;

  const rows = document.getElementById("volumeRows");
  if (!Object.keys(byType).length) {
    rows.innerHTML = `<div class="volume-row"><span class="volume-label" style="color:#475569">Geometria não acessível para cálculo de volume</span></div>`;
    return;
  }

  // Deduções agrupadas por tipo (para indicar quais tipos foram afetados)
  const dedByType = {};
  for (const el of elems) {
    const ded = deductions[el.id] || 0;
    if (ded > 0) dedByType[el.mo.type] = (dedByType[el.mo.type] || 0) + ded;
  }

  let html = Object.entries(byType).map(([t,v]) => {
    const ded    = dedByType[t] || 0;
    const dedTag = ded > OVERLAP_MIN_M3
      ? `<span style="color:#f87171;font-size:10px;font-weight:600;margin-left:5px" title="Desconto de sobreposição com pilares">−${ded.toFixed(3)}</span>`
      : "";
    return `<div class="volume-row volume-selectable" data-sel-type="${t}" title="Clique para selecionar no modelo" style="cursor:pointer">
      <span class="volume-label">${TYPE_LABELS[t]||t} <span style="font-size:9px;opacity:.5">▶</span></span>
      <span class="volume-value">${v.toFixed(3)} m³${dedTag}</span>
    </div>`;
  }).join("") + `<div class="volume-row volume-total">
    <span class="volume-label">TOTAL CONCRETO</span><span class="volume-value">${total.toFixed(3)} m³</span>
  </div>`;

  html += _overlapWarningHtml(result, 3);

  if (Object.keys(byFck).length) {
    html += `<div style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:.08em;margin-top:14px;margin-bottom:6px;padding-top:10px;border-top:1px solid #1e293b">POR RESISTÊNCIA (fck)</div>`;
    html += Object.entries(byFck)
      .sort((a,b) => parseFloat(a[0]) - parseFloat(b[0]))
      .map(([fck,v]) =>
        `<div class="volume-row volume-selectable" data-sel-fck="${fck}" title="Clique para selecionar no modelo" style="cursor:pointer">
          <span class="volume-label">C${fck} MPa <span style="font-size:9px;opacity:.5">▶</span></span>
          <span class="volume-value">${v.toFixed(3)} m³</span>
        </div>`
      ).join("");
  }
  rows.innerHTML = html;

  rows.querySelectorAll("[data-sel-type]").forEach(row => {
    row.addEventListener("click", () => {
      const type    = row.dataset.selType;
      const scope2  = [...new Set(floorObjectIds || viewer.scene.objectIds)];
      const targets = scope2.filter(id => viewer.metaScene.metaObjects[id]?.type === type);
      viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
      viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
      viewer.scene.setObjectsHighlighted(targets, true);
      if (targets.length) viewer.cameraFlight.flyTo({ aabb: viewer.scene.getAABB(targets), duration: 0.6 });
    });
  });
  rows.querySelectorAll("[data-sel-fck]").forEach(row => {
    row.addEventListener("click", () => {
      const fck     = row.dataset.selFck;
      const scope2  = [...new Set(floorObjectIds || viewer.scene.objectIds)];
      const targets = scope2.filter(id => getFck(viewer.metaScene.metaObjects[id]) === fck);
      viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
      viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
      viewer.scene.setObjectsHighlighted(targets, true);
      if (targets.length) viewer.cameraFlight.flyTo({ aabb: viewer.scene.getAABB(targets), duration: 0.6 });
    });
  });
}

// ── Seleção manual de elementos para volume ───────────────────────────────────
function updateSelVolume() {
  const box = document.getElementById("selVolumeBox");
  if (!selElements.size) { box.style.display = "none"; return; }
  box.style.display = "";

  // skipTypeFilter=true: inclui elementos independente do filtro de visibilidade
  const result = computeVolumeWithOverlaps([...selElements], true);
  const { elems, byType, byFck, total, deductions } = result;
  const names = elems.map(e => e.mo.name || e.id);

  // Deduções por tipo para indicativo visual
  const dedByType = {};
  for (const el of elems) {
    const ded = deductions[el.id] || 0;
    if (ded > 0) dedByType[el.mo.type] = (dedByType[el.mo.type] || 0) + ded;
  }

  let html = `<div style="font-size:10px;color:#475569;margin-bottom:8px;line-height:1.5">
    ${names.join(" + ") || "—"}
  </div>`;

  html += Object.entries(byType).map(([t, v]) => {
    const ded    = dedByType[t] || 0;
    const dedTag = ded > OVERLAP_MIN_M3
      ? `<span style="color:#f87171;font-size:10px;margin-left:4px" title="Desconto sobreposição">−${ded.toFixed(4)}</span>`
      : "";
    return `<div class="volume-row"><span class="volume-label">${TYPE_LABELS[t]||t}</span>
     <span class="volume-value">${v.toFixed(4)} m³${dedTag}</span></div>`;
  }).join("");

  html += `<div class="volume-row volume-total">
    <span class="volume-label">TOTAL</span>
    <span class="volume-value">${total.toFixed(4)} m³</span>
  </div>`;

  html += _overlapWarningHtml(result, 4);

  if (Object.keys(byFck).length) {
    html += `<div style="color:#f59e0b;font-size:10px;font-weight:700;letter-spacing:.08em;
      margin-top:10px;margin-bottom:5px;padding-top:8px;border-top:1px solid #1e293b">
      POR RESISTÊNCIA (fck)</div>`;
    html += Object.entries(byFck)
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .map(([fck, v]) =>
        `<div class="volume-row"><span class="volume-label">C${fck} MPa</span>
         <span class="volume-value">${v.toFixed(4)} m³</span></div>`
      ).join("");
  }

  document.getElementById("selVolumeRows").innerHTML = html;
}

function toggleSelPick() {
  selPickMode = !selPickMode;
  const btn = document.getElementById("btnSelPick");
  if (selPickMode) {
    btn.textContent      = "⏹ Parar seleção";
    btn.style.background = "#1e3a5f";
    btn.style.color      = "#60a5fa";
    btn.style.borderColor= "#3b82f6";
    cvs.style.cursor     = "crosshair";
  } else {
    btn.textContent      = "☑ Selecionar";
    btn.style.background = "";
    btn.style.color      = "";
    btn.style.borderColor= "";
    cvs.style.cursor     = "";
  }
}

function clearSelElements() {
  selElements.clear();
  viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
  document.getElementById("selVolumeBox").style.display = "none";
  if (selPickMode) toggleSelPick();
}

// ── Disciplinas — carrega/descarrega modelos overlay ──────────────────────────
async function loadDisciplines() {
  const container = document.getElementById("disciplineButtons");
  const { data: siblings } = await supabase
    .from("projects")
    .select("id,name,discipline,xkt_url,meta_url")
    .eq("obra_id", obraId)
    .neq("id", projectId);

  if (!siblings?.length) return;

  document.getElementById("disciplineSec").style.display = "";
  container.innerHTML = siblings.map(s => `
    <div class="filter-row">
      <span class="filter-label">📦 ${s.discipline} <span style="font-size:10px;color:#475569">${s.name}</span></span>
      <label class="toggle-switch">
        <input type="checkbox" data-proj-id="${s.id}" data-xkt="${s.xkt_url}" data-meta="${s.meta_url}" />
        <span class="toggle-track"></span>
      </label>
    </div>
  `).join("");

  container.querySelectorAll("input[data-proj-id]").forEach(inp => {
    inp.addEventListener("change", async () => {
      const pid  = inp.dataset.projId;
      const xkt  = inp.dataset.xkt;
      const meta = inp.dataset.meta;
      if (inp.checked) {
        if (!loadedModels[pid]) {
          const m = xktLoader.load({ id: pid, src: xkt, metaModelSrc: meta, edges: true });
          loadedModels[pid] = m;
          m.on("loaded", () => {
            // Aplica filtro do pavimento ao modelo carregado
            if (floorObjectIds) {
              viewer.scene.setObjectsVisible(m.objectIds, false);
              const inFloor = m.objectIds.filter(id => floorObjectIds.includes(id));
              viewer.scene.setObjectsVisible(inFloor.length ? inFloor : m.objectIds, true);
            }
          });
        }
      } else {
        const m = loadedModels[pid];
        if (m) { m.destroy(); delete loadedModels[pid]; }
      }
    });
  });
}

// ── Picking (desktop — mouse) ─────────────────────────────────────────────────
function pickAt(canvasPos) {
  // Modo seleção manual de volume
  if (selPickMode) {
    const hit = viewer.scene.pick({ canvasPos });
    if (hit?.entity) {
      const id = hit.entity.id;
      const mo = viewer.metaScene.metaObjects[id];
      if (mo && CONCRETE.has(mo.type)) {
        if (selElements.has(id)) {
          selElements.delete(id);
          viewer.scene.setObjectsSelected([id], false);
        } else {
          selElements.add(id);
          viewer.scene.setObjectsSelected([id], true);
        }
        updateSelVolume();
      }
    }
    return;
  }
  // Modo 4D: coleta GUIDs para vincular à atividade
  if (typeof d4PickMode !== "undefined" && d4PickMode) {
    const hit = viewer.scene.pick({ canvasPos });
    if (hit?.entity) {
      const id = hit.entity.id;
      if (d4PickGuids.has(id)) d4PickGuids.delete(id);
      else                     d4PickGuids.add(id);
      viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
      viewer.scene.setObjectsHighlighted([...d4PickGuids], true);
      refreshGuids4DList();
    }
    return;
  }
  if (activeTool === "measure") return;
  const hit = viewer.scene.pick({ canvasPos, pickSurface: true });
  if (hit?.entity) showProperties(hit.entity.id);
  else             clearProperties();
}
viewer.scene.input.on("mouseclicked", coords => {
  if (activeTool === "region") {
    // Delay para distinguir single-click de double-click
    clearTimeout(_regionClickTimer);
    _regionClickTimer = setTimeout(() => addRegionPoint(coords), 220);
  } else {
    pickAt(coords);
  }
});

let touchStart = null;
const cvs = document.getElementById("viewerCanvas");

// ── Touch control próprio no mobile ──────────────────────────────────────────
// O xeokit interpreta pan de 2 dedos como translação de câmera → modelo some.
// Solução: desativar o CameraControl do xeokit no mobile e implementar
// manualmente usando a API de câmera:
//   1 dedo  → orbitYaw + orbitPitch   (sem pan)
//   2 dedos → zoom puro (pinch)        (sem pan)
//   tap     → selecionar elemento
if ("ontouchstart" in window) {
  viewer.cameraControl.active = false; // desliga input nativo do xeokit no mobile

  const ORBIT_SPEED = 0.25;  // graus por pixel
  const ZOOM_SPEED  = 0.08;  // fração do eixo eye→look por pixel de pinch

  let _tx = 0, _ty = 0, _pinchDist = null, _dragging = false;

  cvs.addEventListener("touchstart", e => {
    e.preventDefault();
    if (e.touches.length === 1) {
      _tx        = e.touches[0].clientX;
      _ty        = e.touches[0].clientY;
      _dragging  = true;
      _pinchDist = null;
      touchStart = { t: Date.now(), x: _tx, y: _ty };
    } else if (e.touches.length >= 2) {
      _dragging  = false;
      _pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: false });

  cvs.addEventListener("touchmove", e => {
    e.preventDefault();
    if (e.touches.length === 1 && _dragging) {
      // 1 dedo: órbita em torno do look-point
      const dx = e.touches[0].clientX - _tx;
      const dy = e.touches[0].clientY - _ty;
      viewer.camera.orbitYaw(dx * ORBIT_SPEED);
      viewer.camera.orbitPitch(dy * ORBIT_SPEED);
      _tx = e.touches[0].clientX;
      _ty = e.touches[0].clientY;
    } else if (e.touches.length >= 2) {
      // 2 dedos: zoom proporcional — escala a distância eye→look sem pan
      const t0   = e.touches[0], t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      if (_pinchDist !== null && dist > 1) {
        const eye  = viewer.camera.eye;
        const look = viewer.camera.look;
        // Vetor do look-point até o eye (direção de afastamento)
        const fromLook = [eye[0]-look[0], eye[1]-look[1], eye[2]-look[2]];
        const curLen   = Math.hypot(...fromLook);
        if (curLen > 0.01) {
          const norm   = fromLook.map(v => v / curLen);
          // scale < 1 → dedos afastaram → zoom in; scale > 1 → dedos fecharam → zoom out
          const scale  = _pinchDist / dist;
          const newLen = Math.max(0.3, Math.min(curLen * scale, 5000));
          viewer.camera.eye = [
            look[0] + norm[0] * newLen,
            look[1] + norm[1] * newLen,
            look[2] + norm[2] * newLen,
          ];
        }
      }
      _pinchDist = dist;
    }
  }, { passive: false });

  cvs.addEventListener("touchend", e => {
    e.preventDefault();
    _scheduleAutoHome();
    const remaining = e.touches.length;
    if (remaining === 0) {
      _dragging  = false;
      _pinchDist = null;
      // Tap: seleciona elemento
      if (touchStart) {
        const t    = e.changedTouches[0];
        const dt   = Date.now() - touchStart.t;
        const dist = Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y);
        touchStart = null;
        if (dt < 300 && dist < 15) {
          const rect = cvs.getBoundingClientRect();
          pickAt([t.clientX - rect.left, t.clientY - rect.top]);
        }
      }
    } else if (remaining === 1) {
      // Transição 2→1 dedo: retoma órbita
      _pinchDist = null;
      _dragging  = true;
      _tx        = e.touches[0].clientX;
      _ty        = e.touches[0].clientY;
    }
  }, { passive: false });
}

// Botão home flutuante (mobile)
document.getElementById("btnHomeMobile").addEventListener("click", () => _flyHome(0.8));

// ── Propriedades ──────────────────────────────────────────────────────────────
function showProperties(objectId) {
  const mo = viewer.metaScene.metaObjects[objectId];
  if (!mo) return;
  openPanel("props");
  // Volume 3D do elemento (só para concreto)
  const entity = viewer.scene.objects[objectId];
  const vol = (entity && CONCRETE.has(mo.type)) ? computeEntityVolume(entity) : 0;
  const fck = getFck(mo);
  let html = `<div class="prop-group">
    <div class="prop-group-title">Elemento</div>
    <div class="prop-row"><span class="prop-label">Nome</span><span class="prop-value">${mo.name||objectId}</span></div>
    <div class="prop-row"><span class="prop-label">Tipo</span><span class="prop-value">${mo.type||"—"}</span></div>
    ${vol > 0 ? `<div class="prop-row"><span class="prop-label">Volume (3D)</span><span class="prop-value highlight">${vol.toFixed(4)} m³</span></div>` : ""}
    ${fck  ? `<div class="prop-row"><span class="prop-label">Resistência</span><span class="prop-value highlight">C${fck} MPa</span></div>` : ""}
    <div class="prop-row"><span class="prop-label">GUID</span><span class="prop-value" style="font-size:10px;color:#475569">${objectId}</span></div>
  </div>`;
  for (const ps of (mo.propertySets || [])) {
    if (!ps?.properties?.length) continue;
    const rowsHtml = ps.properties.map(p => {
      const raw = typeof p.value === "object" ? p.value?.value : p.value;
      const val = fmtVal(p.name, raw);
      const hi  = /volume|area|length|height|width|thickness/i.test(p.name);
      return `<div class="prop-row"><span class="prop-label">${p.name}</span><span class="prop-value${hi?" highlight":""}">${val}</span></div>`;
    }).join("");
    html += `<div class="prop-group"><div class="prop-group-title">${ps.name||"Propriedades"}</div>${rowsHtml}</div>`;
  }
  document.getElementById("propsContent").innerHTML = html;
  viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
  viewer.scene.setObjectsHighlighted([objectId], true);
}
function fmtVal(name, value) {
  if (value == null) return "—";
  if (typeof value === "number") {
    const n = name.toLowerCase();
    if (n.includes("volume")) return `${value.toFixed(3)} m³`;
    if (n.includes("area"))   return `${value.toFixed(3)} m²`;
    if (/length|height|width|thickness|comprimento|largura|altura|dimensao/i.test(n)) return `${value % 1 ? value.toFixed(1) : value} cm`;
    return value % 1 === 0 ? String(value) : value.toFixed(3);
  }
  return String(value);
}
function clearProperties() {
  viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
  document.getElementById("propsContent").innerHTML =
    `<div class="no-selection"><span>☝</span>Clique em um elemento para ver suas propriedades</div>`;
}

// ── QR Code ───────────────────────────────────────────────────────────────────
const qrModal = document.getElementById("qrModal");
document.getElementById("btnQR").addEventListener("click", async () => {
  await QRCode.toCanvas(document.getElementById("qrCanvas"), location.href,
    { width: 240, margin: 2, color: { dark: "#0f1117", light: "#ffffff" } });
  const mo = viewer.metaScene.metaObjects[floorId];
  document.getElementById("qrLabel").textContent = mo?.name || "Pavimento";
  document.getElementById("qrUrlText").textContent = location.href;
  qrModal.style.display = "flex";
});
document.getElementById("qrClose").addEventListener("click", () => { qrModal.style.display = "none"; });
qrModal.addEventListener("click", e => { if (e.target === qrModal) qrModal.style.display = "none"; });
document.getElementById("btnQRDownload").addEventListener("click", () => {
  const mo = viewer.metaScene.metaObjects[floorId];
  const a  = document.createElement("a");
  a.download = `qr-${mo?.name||"pavimento"}.png`;
  a.href = document.getElementById("qrCanvas").toDataURL();
  a.click();
});

// ── Painéis ───────────────────────────────────────────────────────────────────
function openPanel(which) {
  document.getElementById("propsPanel").classList.toggle("open", which === "props");
  document.getElementById("filterPanel").classList.toggle("open", which === "filter");
}
function closeAllPanels() {
  ["propsPanel","filterPanel"].forEach(id => document.getElementById(id).classList.remove("open"));
}
document.getElementById("btnProps").addEventListener("click", () => {
  document.getElementById("propsPanel").classList.contains("open") ? closeAllPanels() : openPanel("props");
});
document.getElementById("btnFilter").addEventListener("click", () => {
  document.getElementById("filterPanel").classList.contains("open") ? closeAllPanels() : openPanel("filter");
});
document.getElementById("propsClose").addEventListener("click", closeAllPanels);
document.getElementById("filterClose").addEventListener("click", closeAllPanels);

// ── Swipe-down para fechar painel no mobile ──────────────────────────────────
["propsPanel","filterPanel"].forEach(panelId => {
  const panel = document.getElementById(panelId);
  let swipeStartY = null;
  panel.addEventListener("touchstart", e => {
    swipeStartY = e.touches[0].clientY;
  }, { passive: true });
  panel.addEventListener("touchend", e => {
    if (swipeStartY === null) return;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    swipeStartY = null;
    if (dy > 60) closeAllPanels(); // swipe para baixo > 60px fecha o painel
  }, { passive: true });
});

// ── Cor de fundo ──────────────────────────────────────────────────────────────
const BG = { bgDark:[0.06,0.07,0.09], bgGrey:[0.53,0.81,0.92], bgWhite:[0.94,0.94,0.94] };
["bgDark","bgGrey","bgWhite"].forEach(bgId => {
  document.getElementById(bgId).addEventListener("click", () => {
    const c = BG[bgId];
    try { viewer.scene.canvas.backgroundColor = c; } catch(_) {}
    try { viewer.scene._renderer.setBackgroundColor(c); } catch(_) {}
    // Força re-render: toca o estado de edges do primeiro objeto visível
    const firstId = (floorObjectIds || viewer.scene.objectIds)[0];
    const obj = firstId && viewer.scene.objects[firstId];
    if (obj) { const e = obj.edges; obj.edges = !e; obj.edges = e; }
    document.querySelectorAll(".bg-btn").forEach(b=>b.classList.remove("active"));
    document.getElementById(bgId).classList.add("active");
  });
});
document.getElementById("togEdges").addEventListener("change", e => {
  viewer.scene.objectIds.forEach(id => { const o=viewer.scene.objects[id]; if(o) o.edges=e.target.checked; });
});

// ── Header ────────────────────────────────────────────────────────────────────
function updateHeader() {
  const mo = viewer.metaScene.metaObjects[floorId];
  document.getElementById("floorName").textContent = mo?.name || "Modelo completo";
  document.getElementById("projectName").textContent = buildingName;
}

// ── Região de volume ─────────────────────────────────────────────────────────
// Projeta ponto 3D world para coordenadas CSS do canvas/SVG overlay
function worldToSvg(wx, wy, wz) {
  const rect = cvs.getBoundingClientRect();
  const vm   = viewer.camera.viewMatrix;
  const pm   = viewer.camera.project.matrix;
  // World → View (column-major)
  const vx = vm[0]*wx + vm[4]*wy + vm[8]*wz  + vm[12];
  const vy = vm[1]*wx + vm[5]*wy + vm[9]*wz  + vm[13];
  const vz = vm[2]*wx + vm[6]*wy + vm[10]*wz + vm[14];
  const vw = vm[3]*wx + vm[7]*wy + vm[11]*wz + vm[15];
  // View → Clip
  const cx = pm[0]*vx + pm[4]*vy + pm[8]*vz  + pm[12]*vw;
  const cy = pm[1]*vx + pm[5]*vy + pm[9]*vz  + pm[13]*vw;
  const cw = pm[3]*vx + pm[7]*vy + pm[11]*vz + pm[15]*vw;
  if (Math.abs(cw) < 1e-6) return null;
  return [
    ((cx/cw + 1) * 0.5) * rect.width,
    ((1 - cy/cw) * 0.5) * rect.height,
  ];
}

function updateRegionSvg(mouseXY) {
  const polyEl = document.getElementById("regionPoly");
  const dotsEl = document.getElementById("regionDots");
  const lineEl = document.getElementById("regionActiveLine");
  if (regionPoints.length === 0) {
    polyEl.setAttribute("points", "");
    dotsEl.innerHTML = "";
    lineEl.style.display = "none";
    return;
  }
  const svgPts = regionPoints
    .map(p => worldToSvg(p.x, p.y, p.z))
    .filter(Boolean);
  if (!svgPts.length) return;

  polyEl.setAttribute("points", svgPts.map(([x,y]) => `${x},${y}`).join(" "));
  dotsEl.innerHTML = svgPts.map(([x,y], i) => {
    const isFirst = i === 0;
    const r = isFirst ? 7 : 4;
    const fill = isFirst ? "#f59e0b" : "#3b82f6"; // 1º ponto amarelo (fechar aqui)
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="1.5" />`;
  }).join("");

  const last = svgPts[svgPts.length - 1];
  if (mouseXY && last) {
    lineEl.setAttribute("x1", last[0]); lineEl.setAttribute("y1", last[1]);
    lineEl.setAttribute("x2", mouseXY[0]); lineEl.setAttribute("y2", mouseXY[1]);
    lineEl.style.display = "";
  } else {
    lineEl.style.display = "none";
  }
}

// Raycast → ponto de superfície → adiciona ao polígono
function addRegionPoint(canvasPos) {
  const hit = viewer.scene.pick({ canvasPos, pickSurface: true });
  if (!hit?.worldPos) return;

  // Verifica se clicou perto do 1º ponto (fecha o polígono)
  if (regionPoints.length >= 3) {
    const first = regionPoints[0];
    const fp = worldToSvg(first.x, first.y, first.z);
    if (fp && Math.hypot(canvasPos[0]-fp[0], canvasPos[1]-fp[1]) < 18) {
      calcRegionVolume();
      return;
    }
  }
  regionPoints.push({ x: hit.worldPos[0], y: hit.worldPos[1], z: hit.worldPos[2] });
  updateRegionSvg();
}

// Teste ponto-em-polígono no plano XZ (raycasting 2D)
function pointInXZPoly(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length-1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    if (((zi > pz) !== (zj > pz)) && (px < (xj-xi)*(pz-zi)/(zj-zi) + xi))
      inside = !inside;
  }
  return inside;
}

function calcRegionVolume() {
  clearTimeout(_regionClickTimer);
  if (regionPoints.length < 3) return;
  activeTool = "orbit";
  cvs.style.cursor = "";
  document.getElementById("regionActiveLine").style.display = "none";
  document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("toolOrbit").classList.add("active");

  // 1. Coleta IDs dos elementos concreto cujo centróide XZ está dentro do polígono
  const scope  = [...new Set(floorObjectIds || viewer.scene.objectIds)];
  const active = getActiveTypes();
  const inReg  = [];

  for (const id of scope) {
    const mo = viewer.metaScene.metaObjects[id];
    if (!mo || !CONCRETE.has(mo.type) || !active.has(mo.type)) continue;
    const entity = viewer.scene.objects[id];
    if (!entity?.visible || !entity.aabb) continue;
    const aabb = entity.aabb;
    const cx = (aabb[0]+aabb[3])/2;
    const cz = (aabb[2]+aabb[5])/2;
    if (pointInXZPoly(cx, cz, regionPoints)) inReg.push(id);
  }

  // 2. Calcula volumes com desconto de sobreposições
  const result   = computeVolumeWithOverlaps(inReg);
  const { byType, total, totalOverlap, overlapPairs } = result;

  // 3. Destaca elementos encontrados
  viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
  if (inReg.length) viewer.scene.setObjectsHighlighted(inReg, true);

  // 4. Exibe resultado no chip flutuante
  const breakdown = Object.entries(byType)
    .map(([t,v]) => `<span style="color:#94a3b8">${TYPE_LABELS[t]||t}:</span> <b>${v.toFixed(3)}</b> m³`)
    .join(" &nbsp;·&nbsp; ");

  const overlapTag = totalOverlap > OVERLAP_MIN_M3
    ? `<span style="margin:0 8px;color:#334155">|</span>
       <span style="color:#f59e0b;font-size:11px" title="${overlapPairs} sobreposição(ões) Pilar×Viga descontada(s)">
         ⚠ −${totalOverlap.toFixed(3)} m³ sobrep.</span>`
    : "";

  const el = document.getElementById("regionResult");
  el.innerHTML = `
    <span style="color:#3b82f6;font-weight:700;margin-right:10px">📐 Região</span>
    ${breakdown || '<span style="color:#475569">Nenhum elemento concreto encontrado</span>'}
    ${breakdown ? `<span style="margin:0 10px;color:#334155">|</span>
    <span style="color:#34d399;font-weight:700">Total: ${total.toFixed(3)} m³</span>
    ${overlapTag}
    <span style="margin:0 10px;color:#334155">|</span>
    <span style="color:#64748b">${inReg.length} elem.</span>` : ""}
    <span id="regionClearBtn" style="margin-left:14px;cursor:pointer;color:#ef4444;font-size:17px;line-height:1" title="Limpar região">✕</span>
  `;
  el.style.display = "";
  document.getElementById("regionClearBtn").addEventListener("click", clearRegion);
}

function clearRegion() {
  regionPoints = [];
  clearTimeout(_regionClickTimer);
  updateRegionSvg();
  document.getElementById("regionResult").style.display = "none";
  viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
}

// Atualiza SVG quando câmera muda (polígono "segue" o modelo)
viewer.scene.on("tick", () => {
  if (regionPoints.length > 0) updateRegionSvg();
});

// Linha activa segue o mouse
cvs.addEventListener("mousemove", e => {
  if (activeTool !== "region" || regionPoints.length === 0) return;
  const rect = cvs.getBoundingClientRect();
  updateRegionSvg([e.clientX - rect.left, e.clientY - rect.top]);
});

// Double-click fecha o polígono
cvs.addEventListener("dblclick", () => {
  clearTimeout(_regionClickTimer);
  if (activeTool === "region" && regionPoints.length >= 3) calcRegionVolume();
});

// ── Fit all / Section / Ferramentas ──────────────────────────────────────────
document.getElementById("btnFitAll").addEventListener("click", () => _flyHome(0.8));
let sectionActive = false;
document.getElementById("btnSection").addEventListener("click", () => {
  sectionActive = !sectionActive;
  document.getElementById("btnSection").classList.toggle("active", sectionActive);
  if (sectionActive) { sectionPlanes.createSectionPlane({ id:"sp1", pos:[0,0,0], dir:[0,-1,0] }); sectionPlanes.showControl("sp1"); }
  else               { sectionPlanes.destroySectionPlane("sp1"); }
});
function setTool(tool) {
  activeTool = tool;
  document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
  cvs.style.cursor = "";
  distCtrl.deactivate();
  if (tool === "measure") {
    distCtrl.activate();
    document.getElementById("toolMeasure").classList.add("active");
  } else if (tool === "region") {
    clearRegion();
    cvs.style.cursor = "crosshair";
    document.getElementById("toolRegion").classList.add("active");
  } else {
    document.getElementById("toolOrbit").classList.add("active");
  }
}
document.getElementById("toolOrbit").addEventListener("click",   () => setTool("orbit"));
document.getElementById("toolMeasure").addEventListener("click", () => setTool("measure"));
document.getElementById("toolRegion").addEventListener("click",  () => setTool("region"));
document.getElementById("toolClear").addEventListener("click",   () => { distMeas.clear(); clearRegion(); setTool("orbit"); });
document.getElementById("btnSelPick").addEventListener("click",  toggleSelPick);
document.getElementById("btnSelClear").addEventListener("click", clearSelElements);

// ── BIM 4D ───────────────────────────────────────────────────────────────────
let d4Acts      = [];       // atividades do Supabase
let d4Active    = false;    // modo 4D ligado?
let d4Date      = null;     // Date atual do slider
let d4PickMode  = false;    // selecionando elementos para vincular?
let d4PickGuids = new Set();// GUIDs selecionados para nova atividade
let d4EditId    = null;     // ID da atividade sendo editada (null = nova)

const STATUS_COLOR = {
  planejado:   [0.20, 0.50, 1.00],
  em_execucao: [1.00, 0.75, 0.10],
  concluido:   [0.10, 0.80, 0.35],
  atrasado:    [0.90, 0.15, 0.15],
};

// Calcula status de uma atividade em uma data
function d4StatusAt(act, date) {
  if (act.status === "concluido")   return "concluido";
  if (act.status === "atrasado")    return "atrasado";
  const ts    = date.getTime();
  const start = act.data_inicio ? new Date(act.data_inicio).getTime() : null;
  const end   = act.data_fim    ? new Date(act.data_fim).getTime()    : null;
  if (start && ts < start) return "planejado";
  if (end   && ts > end)   return "atrasado";
  return act.status || "planejado";
}

function apply4DColors() {
  if (!d4Active || !d4Date) return;
  // Reseta cores
  for (const id of viewer.scene.objectIds) {
    const e = viewer.scene.objects[id];
    if (e) e.colorize = [1,1,1];
  }
  // Aplica cor por atividade
  for (const act of d4Acts) {
    const st  = d4StatusAt(act, d4Date);
    const col = STATUS_COLOR[st] || [1,1,1];
    for (const guid of (act.ifc_guids || [])) {
      const e = viewer.scene.objects[guid];
      if (e) e.colorize = col;
    }
  }
}

function reset4DColors() {
  for (const id of viewer.scene.objectIds) {
    const e = viewer.scene.objects[id];
    if (e) e.colorize = [1,1,1];
  }
}

function render4DList() {
  const el = document.getElementById("list4D");
  if (!d4Acts.length) {
    el.innerHTML = `<span style="color:#475569;font-size:12px">Nenhuma atividade cadastrada.</span>`;
    return;
  }
  el.innerHTML = d4Acts.map(a => {
    const st  = d4Date ? d4StatusAt(a, d4Date) : (a.status || "planejado");
    const col = { planejado:"act-planejado", em_execucao:"act-em_execucao",
                  concluido:"act-concluido", atrasado:"act-atrasado" }[st] || "act-planejado";
    const ini = a.data_inicio ? new Date(a.data_inicio+"T12:00").toLocaleDateString("pt-BR") : "—";
    const fim = a.data_fim    ? new Date(a.data_fim+"T12:00").toLocaleDateString("pt-BR")    : "—";
    return `
      <div style="background:#0f1117;border:1px solid #1e2130;border-radius:8px;padding:8px 10px;cursor:pointer"
           data-act-id="${a.id}">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;font-weight:600;color:#e2e8f0">${a.nome_atividade}</span>
          <span class="act-badge ${col}">${st.replace("_"," ")}</span>
        </div>
        <div style="font-size:10px;color:#475569;margin-top:3px">${ini} → ${fim}
          · ${(a.ifc_guids||[]).length} elementos</div>
      </div>`;
  }).join("");
  // Clique no card: destaca elementos + abre para edição
  el.querySelectorAll("[data-act-id]").forEach(card => {
    card.addEventListener("click", () => {
      const act = d4Acts.find(a => a.id === card.dataset.actId);
      if (!act) return;
      viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
      const targets = (act.ifc_guids||[]).filter(g => viewer.scene.objects[g]);
      if (targets.length) {
        viewer.scene.setObjectsHighlighted(targets, true);
        viewer.cameraFlight.flyTo({ aabb: viewer.scene.getAABB(targets), duration: 0.6 });
      }
      // Preenche form para edição
      d4EditId = act.id;
      document.getElementById("inp4DName").value  = act.nome_atividade;
      document.getElementById("inp4DStart").value  = act.data_inicio || "";
      document.getElementById("inp4DEnd").value    = act.data_fim    || "";
      document.getElementById("sel4DStatus").value = act.status || "planejado";
      d4PickGuids = new Set(act.ifc_guids || []);
      refreshGuids4DList();
      document.getElementById("btn4DSave").textContent = "💾 Atualizar atividade";
    });
  });
}

function refreshGuids4DList() {
  const el = document.getElementById("guids4DList");
  if (!d4PickGuids.size) {
    el.textContent = "Nenhum elemento selecionado";
    return;
  }
  el.innerHTML = [...d4PickGuids].map(g => {
    const mo = viewer.metaScene.metaObjects[g];
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
      <span>${mo?.name||g}</span>
      <span data-rm="${g}" style="cursor:pointer;color:#ef4444;font-size:12px;margin-left:6px">✕</span>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-rm]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      d4PickGuids.delete(btn.dataset.rm);
      refreshGuids4DList();
    });
  });
}

async function load4D() {
  const { data } = await supabase.from("cronograma").select("*")
    .eq("obra_id", obraId).order("data_inicio");
  if (!data) return;
  d4Acts = data;
  // Calcula range de datas
  const allDates = data.flatMap(a => [a.data_inicio, a.data_fim]).filter(Boolean).map(d => new Date(d+"T12:00").getTime());
  if (allDates.length) {
    const min = Math.min(...allDates), max = Math.max(...allDates);
    const sl = document.getElementById("slider4D");
    sl.min = min; sl.max = max; sl.step = 86400000; // 1 dia em ms
    sl.value = min;
    d4Date = new Date(min);
    document.getElementById("label4DDate").textContent = d4Date.toLocaleDateString("pt-BR");
    document.getElementById("label4DMin").textContent  = new Date(min).toLocaleDateString("pt-BR");
    document.getElementById("label4DMax").textContent  = new Date(max).toLocaleDateString("pt-BR");
    // Gradiente do slider
    const pct = 0;
    sl.style.background = `linear-gradient(to right,#3b82f6 ${pct}%,#2a2d3a ${pct}%)`;
  }
  render4DList();
}

// Slider
document.getElementById("slider4D").addEventListener("input", e => {
  d4Date = new Date(Number(e.target.value));
  document.getElementById("label4DDate").textContent = d4Date.toLocaleDateString("pt-BR");
  const sl = e.target;
  const pct = ((sl.value - sl.min) / (sl.max - sl.min) * 100).toFixed(1);
  sl.style.background = `linear-gradient(to right,#3b82f6 ${pct}%,#2a2d3a ${pct}%)`;
  apply4DColors();
  render4DList();
});

// Toggle modo 4D
document.getElementById("tog4D").addEventListener("change", e => {
  d4Active = e.target.checked;
  document.getElementById("sec4DControls").style.display = d4Active ? "" : "none";
  if (d4Active) { load4D().then(apply4DColors); }
  else          { reset4DColors(); }
});

// Botão de seleção de elementos para vincular
document.getElementById("btn4DPickMode").addEventListener("click", () => {
  d4PickMode = !d4PickMode;
  const btn = document.getElementById("btn4DPickMode");
  btn.style.background    = d4PickMode ? "#1e3a5f" : "#0f1117";
  btn.style.color         = d4PickMode ? "#60a5fa" : "#64748b";
  btn.style.borderColor   = d4PickMode ? "#3b82f6" : "#2a2d3a";
  btn.textContent         = d4PickMode ? "☑ Selecionando..." : "☑ Selecionar";
  cvs.style.cursor        = d4PickMode ? "crosshair" : "";
});
document.getElementById("btn4DClearGuids").addEventListener("click", () => {
  d4PickGuids.clear(); refreshGuids4DList();
});

// Salvar atividade
document.getElementById("btn4DSave").addEventListener("click", async () => {
  const nome   = document.getElementById("inp4DName").value.trim();
  const inicio = document.getElementById("inp4DStart").value;
  const fim    = document.getElementById("inp4DEnd").value;
  const status = document.getElementById("sel4DStatus").value;
  if (!nome) { alert("Informe o nome da atividade."); return; }
  const payload = {
    obra_id: obraId, nome_atividade: nome,
    data_inicio: inicio || null, data_fim: fim || null,
    status, ifc_guids: [...d4PickGuids],
  };
  const btn = document.getElementById("btn4DSave");
  btn.textContent = "Salvando..."; btn.disabled = true;
  let err;
  if (d4EditId) {
    ({ error: err } = await supabase.from("cronograma").update(payload).eq("id", d4EditId));
  } else {
    ({ error: err } = await supabase.from("cronograma").insert(payload));
  }
  btn.disabled = false;
  if (err) { alert("Erro ao salvar: " + err.message); btn.textContent = "💾 Salvar atividade"; return; }
  // Reset form
  document.getElementById("inp4DName").value  = "";
  document.getElementById("inp4DStart").value = "";
  document.getElementById("inp4DEnd").value   = "";
  document.getElementById("sel4DStatus").value = "planejado";
  d4PickGuids.clear(); refreshGuids4DList();
  d4EditId = null;
  btn.textContent = "💾 Salvar atividade";
  d4PickMode = false;
  document.getElementById("btn4DPickMode").textContent  = "☑ Selecionar";
  document.getElementById("btn4DPickMode").style.background = "#0f1117";
  document.getElementById("btn4DPickMode").style.color = "#64748b";
  cvs.style.cursor = "";
  await load4D();
  if (d4Active) apply4DColors();
});

// Abertura do painel 4D
document.getElementById("btn4D").addEventListener("click", () => {
  const p = document.getElementById("panel4D");
  if (p.classList.contains("open")) {
    p.classList.remove("open");
    document.getElementById("btn4D").classList.remove("active");
  } else {
    ["propsPanel","filterPanel"].forEach(id => document.getElementById(id).classList.remove("open"));
    p.classList.add("open");
    document.getElementById("btn4D").classList.add("active");
    load4D();
  }
});
document.getElementById("close4D").addEventListener("click", () => {
  document.getElementById("panel4D").classList.remove("open");
  document.getElementById("btn4D").classList.remove("active");
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadModel();
loadDisciplines();
