/* auria_pav_equiv.js — equivalência de pavimentos (2026-10-20)
   A lista OFICIAL é a da ficha do empreendimento (cde_pavimento_auria: código + nome).
   Cada nome visto num modelo IFC (IfcBuildingStorey) ou no cronograma aponta para um
   código da ficha (tabela cde_pav_equiv_auria). O sistema SUGERE o par; gestão/obra confere.
   Uso: const PE = await PavEquiv.carregar(sb, empId);
        PE.codigo('cronograma','Tipo 10')            → '10T'
        PE.codigo('PINI-EST-EX-001-MOD','TIPO1-009', todosOsNomesDoModelo) → '10T'
        await PE.registrar('PINI-ARQ-EX-001-MOD', nomes)   // grava os nomes novos com a sugestão */
(function(){
  const _n=s=>String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  // subníveis de piso acabado do Revit/ARQ ("10º PAVIMENTO_(P.A_0,07)") = o mesmo andar
  const limpa=s=>_n(s).replace(/_\(p\.?a.*$/,'').replace(/\s+/g,' ').trim();

  // chave canônica: o mesmo andar escrito de jeitos diferentes cai na mesma chave
  function chave(nome, seq){
    const n=limpa(nome); let m;
    if(seq&&seq.has(n)) return 'pav'+seq.get(n);
    if((m=n.match(/^tipo\s*0*(\d+)$/))) return 'pav'+(+m[1]);
    if((m=n.match(/^0*(\d+)\s*(º|o|°|ª)?\s*(pav|andar)/))) return 'pav'+(+m[1]);
    if((m=n.match(/^(pavimento|pav\.?|andar)\s*0*(\d+)$/))) return 'pav'+(+m[2]);
    if((m=n.match(/^(subsolo|ss)\s*0*(\d+)$/))) return 'ss'+(+m[2]);
    if((m=n.match(/^(sobressolo|sobre|sb)\s*0*(\d+)$/))) return 'so'+(+m[2]);
    if(/^terreo/.test(n)) return 'terreo';
    if(/^lazer/.test(n)) return 'lazer';
    if(/^rooftop/.test(n)) return 'rooftop';
    if(/heliponto|^topo/.test(n)) return 'topo';
    if(/^(casa de maquina|cmaq|cxdagua|fundo caixa|caixa d.?agua)/.test(n)) return 'cmaq';
    if(/^cobertura/.test(n)) return 'cobertura';
    return null;
  }
  // Estrutural (TQS) numera os tipos à parte: 1oPAV, TIPO1-001, TIPO1-002… TIPO2-001… → 1º, 2º, 3º…
  function seqEstrutural(todos){
    const l=[...new Set((todos||[]).map(limpa))].filter(n=>/^1\s*o\s*pav$|^tipo\d+-\d+$/.test(n));
    if(!l.some(n=>/^tipo\d+-\d+$/.test(n))) return null;
    l.sort((a,b)=>/^1\s*o/.test(a)?-1:/^1\s*o/.test(b)?1:a.localeCompare(b,'pt',{numeric:true}));
    const m=new Map(); l.forEach((n,i)=>m.set(n,i+1)); return m;
  }

  async function carregar(sb, emp){
    const [rf,re]=await Promise.all([
      sb.from('cde_pavimento_auria').select('codigo,nome,tipo,ordem').eq('empreendimento_id',emp).eq('ativo',true).order('ordem'),
      sb.from('cde_pav_equiv_auria').select('fonte,nome,pavimento,sugerido').eq('empreendimento_id',emp).limit(5000)]);
    const ficha=(rf.data||[]).filter(p=>p.tipo!=='grupo');
    const porChave=new Map(); ficha.forEach(p=>{ const k=chave(p.nome)||chave(p.codigo); if(k&&!porChave.has(k)) porChave.set(k,p.codigo); });
    const salvo=new Map(); (re.data||[]).forEach(r=>salvo.set(r.fonte+'\u0001'+r.nome,r));
    const seqs=new Map();
    const PE={ ficha, semTabela:!!re.error, salvo,
      sugerir(fonte,nome,todos){ let seq=null; if(todos){ if(!seqs.has(fonte)) seqs.set(fonte,seqEstrutural(todos)); seq=seqs.get(fonte); }
        const k=chave(nome,seq); if(k&&porChave.has(k)) return porChave.get(k);
        const c=ficha.find(p=>_n(p.codigo)===limpa(nome)||_n(p.nome)===limpa(nome)); return c?c.codigo:null; },
      // código da ficha: o que foi conferido/registrado; senão a sugestão
      codigo(fonte,nome,todos){ const r=salvo.get(fonte+'\u0001'+nome); if(r) return r.pavimento||null; return PE.sugerir(fonte,nome,todos); },
      nomeDe(cod){ const p=ficha.find(x=>x.codigo===cod); return p?p.nome:cod; },
      async registrar(fonte,nomes){ if(PE.semTabela||!fonte) return 0; const novos=[...new Set(nomes||[])].filter(n=>n&&!salvo.has(fonte+'\u0001'+n));
        if(!novos.length) return 0; const itens=novos.map(n=>({nome:n,pavimento:PE.sugerir(fonte,n,nomes)||''}));
        try{ const r=await sb.rpc('pav_equiv_registrar',{p_emp:emp,p_fonte:fonte,p_itens:itens}); if(!r.error) itens.forEach(i=>salvo.set(fonte+'\u0001'+i.nome,{fonte,nome:i.nome,pavimento:i.pavimento||null,sugerido:true})); }catch(_){}
        return novos.length; } };
    return PE;
  }
  window.PavEquiv={ carregar, chave, seqEstrutural, limpa };
})();
