// ============================================================================
//  Auria — validação de arquivos antes do upload (item 32, etapa A)
//  Nenhum serviço externo: confere extensão permitida por contexto, assinatura
//  (magic number) do conteúdo, bloqueia executáveis/scripts renomeados e PDFs
//  com conteúdo ativo (JavaScript, /Launch, arquivo embutido, RichMedia).
//  A mesma regra roda no servidor (supabase/functions/_shared/valida.ts) — aqui
//  o objetivo é barrar cedo, com mensagem clara, antes de gastar upload.
//
//  Uso:  const r = await AuriaValida.checar(file, 'cde');  // 'cde'|'nf'|'pdf'|'logo'|'imagem'
//        if(!r.ok) alert(r.motivo);
//        const lista = await AuriaValida.checarVarios(files, 'cde'); // {ok:[File], ruins:[{file,motivo}]}
// ============================================================================
(function(){
  const CONTEXTOS = {
    cde:    ['pdf','dwg','dxf','ifc','ifczip','rvt','rfa','nwd','nwc','skp','zip','png','jpg','jpeg','xlsx','xls','docx','doc','csv','txt','kmz','kml','las','e57','obj','dae','json'],
    nf:     ['pdf','xml'],
    pdf:    ['pdf'],
    logo:   ['png','jpg','jpeg','webp'],
    imagem: ['png','jpg','jpeg','webp','gif','heic']
  };
  // Extensões que nunca entram, em qualquer posição do nome (bloqueia "planta.pdf.exe" e "x.exe.pdf")
  const PERIGOSAS = /\.(exe|dll|bat|cmd|com|scr|msi|msp|jar|hta|wsf|wsh|vbs|vbe|js|jse|ps1|psm1|pif|cpl|lnk|reg|sh|bash|app|dmg|apk|iso|url|inf|sct|chm)(\.|$)/i;
  const MAX_NOME = 180;

  function ext(nome){ return ((String(nome||'').match(/\.([^.]+)$/)||[])[1]||'').toLowerCase(); }
  function lerBytes(file, ini, fim){
    return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onerror=()=>rej(fr.error); fr.onload=()=>res(new Uint8Array(fr.result));
      fr.readAsArrayBuffer(file.slice(Math.max(0,ini), Math.min(file.size, fim))); });
  }
  function ascii(b, n){ let s=''; for(let i=0;i<Math.min(b.length,n||b.length);i++) s+=String.fromCharCode(b[i]); return s; }
  function comeca(b, hex){ const h=hex.split(' ').map(x=>parseInt(x,16)); if(b.length<h.length) return false; for(let i=0;i<h.length;i++) if(b[i]!==h[i]) return false; return true; }
  function ehTexto(b, n){ const lim=Math.min(b.length,n||4096); let ctl=0; for(let i=0;i<lim;i++){ const c=b[i]; if(c===0) return false; if(c<9||(c>13&&c<32)) ctl++; } return ctl<lim*0.02; }

  // Executáveis e afins pelo CONTEÚDO (independe do nome)
  function executavel(b){
    if(comeca(b,'4D 5A')) return 'executável Windows (MZ)';
    if(comeca(b,'7F 45 4C 46')) return 'executável Linux (ELF)';
    if(comeca(b,'FE ED FA CE')||comeca(b,'FE ED FA CF')||comeca(b,'CF FA ED FE')||comeca(b,'CA FE BA BE')) return 'executável macOS';
    if(comeca(b,'23 21')) return 'script (#!)';
    if(comeca(b,'4C 00 00 00 01 14 02 00')) return 'atalho do Windows (.lnk)';
    return null;
  }
  // Assinatura esperada por extensão. null = sem assinatura fixa (só a lista negra vale)
  function assinaturaOk(e, b){
    const a=ascii(b, 64);
    switch(e){
      case 'pdf':  return a.startsWith('%PDF-');
      case 'png':  return comeca(b,'89 50 4E 47 0D 0A 1A 0A');
      case 'jpg': case 'jpeg': return comeca(b,'FF D8 FF');
      case 'gif':  return a.startsWith('GIF87a')||a.startsWith('GIF89a');
      case 'webp': return a.startsWith('RIFF') && a.slice(8,12)==='WEBP';
      case 'heic': return a.slice(4,8)==='ftyp';
      case 'zip': case 'ifczip': case 'xlsx': case 'docx': case 'kmz': return comeca(b,'50 4B 03 04')||comeca(b,'50 4B 05 06');
      case 'dwg':  return a.startsWith('AC10')||a.startsWith('AC1.');           // AC1015, AC1018, AC1027, AC1032…
      case 'dxf':  return ehTexto(b) && /\b(SECTION|HEADER|AutoCAD|ENTITIES)\b/.test(ascii(b, 4096));
      case 'ifc':  return ehTexto(b) && /ISO-10303-21/.test(ascii(b, 512));
      case 'rvt': case 'rfa': case 'doc': case 'xls': return comeca(b,'D0 CF 11 E0 A1 B1 1A E1');   // OLE compound
      case 'skp':  return /SketchUp Model/.test(ascii(b, 64));
      case 'las':  return a.startsWith('LASF');
      case 'e57':  return /ASTM-E57/.test(ascii(b, 64));
      case 'xml': case 'kml': case 'csv': case 'txt': case 'obj': case 'dae': case 'json': return ehTexto(b);
      case 'nwd': case 'nwc': return true;   // sem assinatura pública estável
      default: return true;
    }
  }
  // PDF com conteúdo ativo. Lê o arquivo inteiro até 24 MB; acima disso, início + fim
  // (os dicionários /OpenAction e /Names ficam quase sempre no fim, no trailer/catálogo).
  async function pdfAtivo(file){
    const LIM=24*1024*1024; let s;
    if(file.size<=LIM) s=ascii(await lerBytes(file,0,file.size));
    else s=ascii(await lerBytes(file,0,6*1024*1024))+'\n…\n'+ascii(await lerBytes(file,file.size-6*1024*1024,file.size));
    const achados=[];
    if(/\/JavaScript\b|\/JS\s*[\(<\[]|\/JS\s+\d+\s+\d+\s+R/.test(s)) achados.push('JavaScript');
    if(/\/Launch\b/.test(s)) achados.push('ação /Launch (abre programa)');
    if(/\/EmbeddedFile\b/.test(s)) achados.push('arquivo embutido');
    if(/\/RichMedia\b/.test(s)) achados.push('mídia rica (Flash/3D com script)');
    if(/\/URI\s*\(\s*(file|javascript):/i.test(s)) achados.push('link para arquivo local/script');
    return achados;
  }

  async function checar(file, contexto){
    try{
      const nome=String(file&&file.name||''); const e=ext(nome);
      if(!file || !file.size) return {ok:false, motivo:'Arquivo vazio.'};
      if(nome.length>MAX_NOME) return {ok:false, motivo:'Nome de arquivo longo demais (máx. '+MAX_NOME+').'};
      if(/[\x00-\x1F‮​-‏]/.test(nome)) return {ok:false, motivo:'Nome de arquivo com caracteres invisíveis/controle.'};
      if(PERIGOSAS.test(nome)) return {ok:false, motivo:'Tipo de arquivo não permitido ('+nome.match(PERIGOSAS)[1]+').'};
      const permitidas=CONTEXTOS[contexto]||CONTEXTOS.cde;
      if(!e || !permitidas.includes(e)) return {ok:false, motivo:'Formato .'+(e||'?')+' não aceito aqui. Aceitos: '+permitidas.map(x=>'.'+x).join(', ')+'.'};
      const head=await lerBytes(file, 0, 8192);
      const exe=executavel(head); if(exe) return {ok:false, motivo:'O conteúdo é um '+exe+' renomeado como .'+e+'.'};
      if(!assinaturaOk(e, head)) return {ok:false, motivo:'O conteúdo não corresponde a um .'+e+' válido (arquivo corrompido ou renomeado).'};
      if(e==='pdf'){ const at=await pdfAtivo(file); if(at.length) return {ok:false, motivo:'PDF com conteúdo ativo ('+at.join(', ')+'). Peça uma exportação sem scripts/anexos.', ativo:at}; }
      return {ok:true, ext:e};
    }catch(err){ return {ok:false, motivo:'Não foi possível ler o arquivo ('+((err&&err.message)||err)+').'}; }
  }
  async function checarVarios(files, contexto){
    const ok=[], ruins=[];
    for(const f of [...files]){ const r=await checar(f, contexto); if(r.ok) ok.push(f); else ruins.push({file:f, motivo:r.motivo}); }
    return {ok, ruins};
  }
  function resumoRuins(ruins){ return ruins.map(x=>'• '+x.file.name+' — '+x.motivo).join('\n'); }

  // Verificação no SERVIDOR depois do upload (Edge Function arquivo-verificar): lê o começo do objeto
  // no Storage/R2 com a mesma regra e APAGA se for inválido. Quem chama deve abortar o registro se !ok.
  // Falha de rede/função indisponível → {ok:true, semServidor:true} (não trava o fluxo; o cliente já validou).
  async function verificarServidor(sb, opts){
    try{
      const r=await sb.functions.invoke('arquivo-verificar',{ body:{ provider:opts.provider||'supabase', bucket:opts.bucket||'cde', path:opts.path, nome:opts.nome, contexto:opts.contexto||'cde' } });
      if(r.error){ console.warn('[valida] servidor indisponível:', r.error.message||r.error); return {ok:true, semServidor:true}; }
      const d=r.data||{};
      if(d.error){ console.warn('[valida] servidor:', d.error); return {ok:true, semServidor:true}; }
      return d.ok ? {ok:true} : {ok:false, motivo:d.motivo||'Arquivo recusado pelo servidor.', apagado:!!d.apagado};
    }catch(e){ console.warn('[valida] servidor exceção:', e&&e.message||e); return {ok:true, semServidor:true}; }
  }
  window.AuriaValida={ checar, checarVarios, resumoRuins, verificarServidor, CONTEXTOS };
})();
