import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://xrgxdfwxsulrjgqtrjrr.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZ3hkZnd4c3VscmpncXRyanJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNDM5NTYsImV4cCI6MjA5MjcxOTk1Nn0.Zl5wObchlzLaSaDs1dWcDyreX-tiS6mKO3B5eoTCu3U"
);

// Cor por disciplina
const DISC_COLORS = {
  "estrutural":  "#f59e0b",
  "hidráulico":  "#38bdf8",
  "hidraulico":  "#38bdf8",
  "elétrico":    "#fbbf24",
  "eletrico":    "#fbbf24",
  "arquitetura": "#a78bfa",
  "instalações": "#34d399",
  "instalacoes": "#34d399",
  "mecânico":    "#fb923c",
  "mecanico":    "#fb923c",
};
function discColor(disc) {
  return DISC_COLORS[(disc || "").toLowerCase()] || "#60a5fa";
}

function floorUrl(p, f) {
  return `/floor.html?project=${p.id}`
    + `&floor=${encodeURIComponent(f.ifc_guid)}`
    + `&xkt=${encodeURIComponent(p.xkt_url)}`
    + `&meta=${encodeURIComponent(p.meta_url)}`
    + `&building=${encodeURIComponent(p.building || p.name)}`
    + `&obra=${encodeURIComponent(p.obra_id || p.id)}`;
}

function fullModelUrl(p) {
  return `/floor.html?project=${p.id}`
    + `&xkt=${encodeURIComponent(p.xkt_url)}`
    + `&meta=${encodeURIComponent(p.meta_url)}`
    + `&building=${encodeURIComponent(p.building || p.name)}`
    + `&obra=${encodeURIComponent(p.obra_id || p.id)}`;
}

async function loadProjects() {
  const grid = document.getElementById("projectsGrid");

  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !projects?.length) return;

  const { data: floors } = await supabase
    .from("floors")
    .select("*")
    .in("project_id", projects.map(p => p.id))
    .order("elevation", { ascending: true });

  // Indexa pavimentos por projeto
  const floorsByProject = {};
  for (const f of floors || []) {
    if (!floorsByProject[f.project_id]) floorsByProject[f.project_id] = [];
    floorsByProject[f.project_id].push(f);
  }

  // Agrupa projetos por empreendimento (obra_id)
  const byBuilding = new Map();
  for (const p of projects) {
    const key = p.obra_id || p.id;
    if (!byBuilding.has(key)) {
      byBuilding.set(key, { name: p.building || p.name, projects: [] });
    }
    byBuilding.get(key).projects.push(p);
  }

  let html = "";

  for (const [, building] of byBuilding) {
    const disciplinesHtml = building.projects.map(p => {
      const pFloors = floorsByProject[p.id] || [];
      const color   = discColor(p.discipline);

      const floorsHtml = pFloors.length
        ? pFloors.map(f =>
            `<a class="floor-row" href="${floorUrl(p, f)}">
              <span>${f.name}</span>
              <span class="floor-arrow">→</span>
            </a>`
          ).join("")
        : `<div class="no-floors">Nenhum pavimento cadastrado</div>`;

      return `
        <div class="disc-card" data-pid="${p.id}">
          <div class="disc-header">
            <span class="disc-dot" style="background:${color}"></span>
            <span class="disc-label">${p.discipline || "BIM"}</span>
            <a class="disc-full-link" href="${fullModelUrl(p)}">modelo completo</a>
            <span class="disc-chevron">›</span>
          </div>
          <div class="disc-body">
            ${floorsHtml}
          </div>
        </div>`;
    }).join("");

    html += `
      <div class="building-section">
        <div class="building-title">
          <span class="building-dot"></span>
          ${building.name}
        </div>
        <div class="disciplines-list">
          ${disciplinesHtml}
        </div>
      </div>`;
  }

  grid.innerHTML = html;

  // Toggle recolher/expandir ao clicar no header da disciplina
  grid.querySelectorAll(".disc-header").forEach(header => {
    header.addEventListener("click", e => {
      if (e.target.closest(".disc-full-link")) return; // link direto, não alterna
      header.closest(".disc-card").classList.toggle("open");
    });
  });
}

loadProjects();
