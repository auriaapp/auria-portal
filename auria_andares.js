/* auria_andares.js — andares do IFC × pavimentos do empreendimento (backlog 220/221).
   Compartilhado entre o CDE (onde a coordenação confere o de-para do modelo principal)
   e o App Obra (que usa o de-para salvo em obra_modelo_auria.pav_map).
   - ler(model): andares (IfcBuildingStorey) de um modelo Fragments, em ordem de cota,
     com os ids das peças de cada um.
   - parear(nomes, pavs): sugestão automática andar → pavimento (mesma regra que o
     App Obra já usava: âncoras por nome + preenchimento na ordem entre âncoras). */
(function(){
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[º°ª]/g, '').replace(/\s+/g, ' ').trim();
  const SIN = [ ['SUBSOLO','SUB','SS'], ['SOBRESSOLO','SOBRE','SB'], ['TERREO','TER'], ['LAZER','LAZ'], ['ROOFTOP','ROOF','ROF'],
                ['CASA DE MAQUINAS','CMAQ','CMQ','MAQUINAS'], ['COBERTURA','COB','HELIPONTO','TOPO'], ['FUNDACAO','FUND'], ['MEZANINO','MEZ'], ['PILOTIS','PIL'], ['GARAGEM','GAR'] ];
  function chave(nome){
    const n = norm(nome); if (!n) return null;
    if (/^[A-Z]+\d*-\d{2,}$/.test(n.replace(/\s/g, ''))) return null;           // repetição do TQS (TIPO1-001)
    const num = (n.match(/\d+/) || [])[0]; const nn = num ? String(parseInt(num, 10)) : '';
    for (const g of SIN) if (g.some(w => n.replace(/\d+/g, ' ').split(/[^A-Z]+/).includes(w) || (w.length > 4 && n.includes(w)))) return g[0] + '#' + nn;
    if (/PAV|TIPO|ANDAR/.test(n) && nn) return 'PAV#' + nn;
    return null;
  }
  // Posição física pela chave (o cadastro do empreendimento nem sempre está em ordem
  // de subsolo → topo: no PINI vinha 1PV, 02T…47T, CMQ, LAZ, ROF, SB1…, SS1…, TER).
  const RANK = { FUNDACAO:-1000, SUBSOLO:-10, TERREO:0, PILOTIS:1, GARAGEM:1.5, SOBRESSOLO:2, MEZANINO:6, LAZER:8, PAV:100, ROOFTOP:900, 'CASA DE MAQUINAS':950, COBERTURA:990 };
  function rank(p){
    const c = chave(p.nome) || chave(p.codigo); if (!c) return null;
    const [g, n] = c.split('#'), k = parseInt(n, 10) || 0, b = RANK[g]; if (b == null) return null;
    return g === 'SUBSOLO' ? b * (k || 1) : g === 'SOBRESSOLO' ? b + k * 0.1 : g === 'PAV' ? b + k : b;
  }
  function ordemFisica(pavs){
    const r = pavs.map((p, i) => ({ p, i, r: rank(p) }));
    if (r.filter(x => x.r != null).length < 2) return pavs;          // sem como ordenar: mantém o cadastro
    return r.sort((a, b) => (a.r == null ? 1e9 + a.i : a.r) - (b.r == null ? 1e9 + b.i : b.r)).map(x => x.p);
  }
  function parear(nomes, pavsTodos){
    const pavs = ordemFisica((pavsTodos || []).filter(p => p.tipo !== 'grupo' && p.tipo !== 'vista'));
    const chP = pavs.map(p => chave(p.nome) || chave(p.codigo));
    const chM = nomes.map(chave);
    const res = new Array(nomes.length).fill(null);
    const anc = []; let ultP = -1;
    chM.forEach((c, i) => { if (!c) return; const js = chP.map((x, j) => x === c ? j : -1).filter(j => j > ultP);
      if (js.length === 1 || (js.length && chP.filter(x => x === c).length === 1)){ res[i] = pavs[js[0]]; anc.push([i, js[0]]); ultP = js[0]; } });
    // código exato do pavimento no nome do andar (ex.: "10T", "SS1")
    nomes.forEach((nm, i) => { if (res[i]) return; const n = norm(nm).replace(/\s/g, '');
      const p = pavs.find(p => p.codigo && norm(p.codigo).replace(/\s/g, '') === n); if (p) res[i] = p; });
    const marcos = [[-1, -1]].concat(anc, [[nomes.length, pavs.length]]);
    for (let k = 0; k + 1 < marcos.length; k++){
      const [i0, j0] = marcos[k], [i1, j1] = marcos[k + 1];
      const mi = []; for (let i = i0 + 1; i < i1; i++) if (!res[i] && !/FUNDAC|CX ?D.?AGUA|RESERVAT|TOPO|BARRILETE/.test(norm(nomes[i]))) mi.push(i);
      const pj = []; for (let j = j0 + 1; j < j1; j++) pj.push(j);
      if (mi.length && mi.length === pj.length) mi.forEach((i, t) => res[i] = pavs[pj[t]]);
    }
    return res;
  }
  const ESP = new Set(['IFCPROJECT','IFCSITE','IFCBUILDING','IFCBUILDINGSTOREY','IFCSPACE']);
  async function ler(md){
    let raw = null; try { raw = await md.getSpatialStructure(); } catch (_){}
    if (!raw) return [];
    const storeys = [];
    const folhas = (inst, acc) => { for (const cn of (inst.children || [])){ const c = String(cn.category || '').toUpperCase();
      for (const ch of (cn.children || [])){ if (ESP.has(c)) folhas(ch, acc); else if (ch.localId != null) acc.push(ch.localId); } } };
    const walk = (inst, tipoPai) => {
      if (String(tipoPai).toUpperCase() === 'IFCBUILDINGSTOREY' && inst.localId != null){ const acc = []; folhas(inst, acc); storeys.push({ id:inst.localId, ids:acc }); return; }
      for (const cn of (inst.children || [])) for (const ch of (cn.children || [])) walk(ch, cn.category);
    };
    for (const inst of (raw.children || [])) walk(inst, raw.category);
    const nm = {}, elev = {}, sids = storeys.map(s => s.id);
    for (let p = 0; p < sids.length; p += 400){
      let da = []; try { da = await md.getItemsData(sids.slice(p, p + 400), { attributesDefault:true, relationsDefault:{ attributes:false, relations:false } }); } catch (_){}
      (da || []).forEach(d => { const lid = d && d._localId && d._localId.value; if (lid == null) return;
        nm[lid] = String((d.Name && d.Name.value) || (d.LongName && d.LongName.value) || '');
        elev[lid] = d.Elevation && isFinite(+d.Elevation.value) ? +d.Elevation.value : null; });
    }
    return storeys.map((s, k) => ({ id:s.id, ids:s.ids, nome:nm[s.id] || '', z:elev[s.id] != null ? elev[s.id] : k })).sort((a, b) => a.z - b.z);
  }
  window.AuriaAndares = { norm, chave, parear, ler, ordemFisica };
})();
