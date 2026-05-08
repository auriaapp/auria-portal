import{c as b}from"./index-DnZfQelR.js";const l=b("https://xrgxdfwxsulrjgqtrjrr.supabase.co","eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZ3hkZnd4c3VscmpncXRyanJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNDM5NTYsImV4cCI6MjA5MjcxOTk1Nn0.Zl5wObchlzLaSaDs1dWcDyreX-tiS6mKO3B5eoTCu3U"),I={estrutural:"#f59e0b",hidráulico:"#38bdf8",hidraulico:"#38bdf8",elétrico:"#fbbf24",eletrico:"#fbbf24",arquitetura:"#a78bfa",instalações:"#34d399",instalacoes:"#34d399",mecânico:"#fb923c",mecanico:"#fb923c"};function g(o){return I[(o||"").toLowerCase()]||"#60a5fa"}function h(o,i){return`/floor.html?project=${o.id}&floor=${encodeURIComponent(i.ifc_guid)}&xkt=${encodeURIComponent(o.xkt_url)}&meta=${encodeURIComponent(o.meta_url)}&building=${encodeURIComponent(o.building||o.name)}&obra=${encodeURIComponent(o.obra_id||o.id)}`}function $(o){return`/floor.html?project=${o.id}&xkt=${encodeURIComponent(o.xkt_url)}&meta=${encodeURIComponent(o.meta_url)}&building=${encodeURIComponent(o.building||o.name)}&obra=${encodeURIComponent(o.obra_id||o.id)}`}async function j(){const o=document.getElementById("projectsGrid"),{data:i,error:f}=await l.from("projects").select("*").order("created_at",{ascending:!1});if(f||!(i!=null&&i.length))return;const{data:u}=await l.from("floors").select("*").in("project_id",i.map(e=>e.id)).order("elevation",{ascending:!0}),c={};for(const e of u||[])c[e.project_id]||(c[e.project_id]=[]),c[e.project_id].push(e);const t=new Map;for(const e of i){const n=e.obra_id||e.id;t.has(n)||t.set(n,{name:e.building||e.name,projects:[]}),t.get(n).projects.push(e)}let a="";for(const[,e]of t){const n=e.projects.map(s=>{const d=c[s.id]||[],m=g(s.discipline),p=d.length?d.map(r=>`<a class="floor-row" href="${h(s,r)}">
              <span>${r.name}</span>
              <span class="floor-arrow">→</span>
            </a>`).join(""):'<div class="no-floors">Nenhum pavimento cadastrado</div>';return`
        <div class="disc-card" data-pid="${s.id}">
          <div class="disc-header">
            <span class="disc-dot" style="background:${m}"></span>
            <span class="disc-label">${s.discipline||"BIM"}</span>
            <a class="disc-full-link" href="${$(s)}">modelo completo</a>
            <span class="disc-chevron">›</span>
          </div>
          <div class="disc-body">
            ${p}
          </div>
        </div>`}).join("");a+=`
      <div class="building-section">
        <div class="building-title">
          <span class="building-dot"></span>
          ${e.name}
        </div>
        <div class="disciplines-list">
          ${n}
        </div>
      </div>`}o.innerHTML=a,o.querySelectorAll(".disc-header").forEach(e=>{e.addEventListener("click",n=>{n.target.closest(".disc-full-link")||e.closest(".disc-card").classList.toggle("open")})})}j();
