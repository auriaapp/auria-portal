"""
Auria BIM — Importar Modelo
Interface gráfica para converter e publicar modelos IFC para o Auria BIM.

Dependências:
  pip install customtkinter ifcopenshell boto3 supabase qrcode[pil] pillow python-dotenv
"""

import ctypes
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections import Counter
from pathlib import Path
from urllib.parse import quote

import customtkinter as ctk
from tkinter import filedialog, messagebox

# ── Caminhos ──────────────────────────────────────────────────────────────────
SCRIPT_DIR  = Path(__file__).parent
ENV_PATH    = SCRIPT_DIR / ".env"
CONFIG_PATH = SCRIPT_DIR / "uploader_config.json"
CONVERT2XKT = SCRIPT_DIR / "node_modules" / "@xeokit" / "xeokit-convert" / "convert2xkt.js"

# Carrega .env (credenciais)
from dotenv import load_dotenv
load_dotenv(ENV_PATH)

# ── Paleta Auria ──────────────────────────────────────────────────────────────
C = {
    "bg":      "#0f1117",
    "surface": "#1a1d27",
    "border":  "#2a2d3a",
    "orange":  "#f97316",
    "blue":    "#3b82f6",
    "blue_bg": "#1e3a5f",
    "green":   "#10b981",
    "red":     "#ef4444",
    "text1":   "#e2e8f0",
    "text2":   "#94a3b8",
    "text3":   "#64748b",
}

DISCIPLINES = [
    "Estrutural", "Sanitário", "Elétrico", "Hidráulico",
    "Arquitetura", "Mecânico", "AVAC", "Incêndio", "Outro",
]

# ── Helpers IFC ───────────────────────────────────────────────────────────────
def slug(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"[\s_-]+", "-", text)


def format_floor_name(raw: str) -> str:
    n = raw.strip()
    u = n.upper()
    direct = {
        "FUNDACAO": "Fundação", "TERREO": "Térreo", "TÉRREO": "Térreo",
        "ROOFTOP": "Rooftop", "HELIPONTO": "Heliponto", "HELIPORTO": "Heliporto",
        "CMAQ": "Casa de Máquinas", "CASA DE MAQUINA": "Casa de Máquinas",
        "CASA DE MAQUINAS": "Casa de Máquinas", "CASA DE MÁQUINA": "Casa de Máquinas",
        "CASA DE MÁQUINAS": "Casa de Máquinas", "CXDAGUA": "Caixa d'Água",
        "TOPO": "Topo", "PONTO MEDIO": "Ponto Médio", "PONTO MÉDIO": "Ponto Médio",
        "LAZER": "Pavimento Lazer", "INTERLAZER": "Pavimento Inter/Lazer",
        "COBERTURA": "Cobertura", "PILOTIS": "Pilotis",
    }
    if u in direct:
        return direct[u]
    m = re.match(r"SUBSOLO\s*0*(\d+)", u)
    if m: return f"Subsolo {m.group(1)}"
    m = re.match(r"SOBRESSOLO\s*0*(\d+)", u)
    if m: return f"Sobressolo {int(m.group(1))}"
    m = re.match(r"SOBRE\s*0*(\d+)", u)
    if m: return f"Sobressolo {m.group(1)}"
    m = re.match(r"(\d+)[OoÓ°º]\s*PAV\.?\s*TIPO", u)
    if m: return f"{m.group(1)}º Pav. Tipo"
    m = re.match(r"(\d+)[OoÓ°º]PAV$", u)
    if m: return f"{m.group(1)}º Pavimento"
    m = re.match(r"TIPO(\d+)-0*(\d+)", u)
    if m: return f"Tipo {m.group(1)} — Pav. {int(m.group(2))}"
    m = re.match(r"(\d+)[OoÓ°º]?\s*PAV\b", u)
    if m: return f"{m.group(1)}º Pavimento"
    m = re.match(r"PAV\.?\s*LAZER", u)
    if m: return "Pavimento Lazer"
    m = re.match(r"PAV\.?\s*INTER", u)
    if m: return "Pavimento Inter/Lazer"
    return n.title()


def extract_floors(model) -> list[dict]:
    import ifcopenshell
    storeys = model.by_type("IfcBuildingStorey")
    elems_per_storey: Counter = Counter()
    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        c = rel.RelatingStructure
        if c and c.is_a("IfcBuildingStorey"):
            elems_per_storey[c.GlobalId] += len(rel.RelatedElements or [])
    result = []
    for s in storeys:
        raw_name = s.Name or f"Pavimento {s.id()}"
        result.append({
            "guid":      s.GlobalId,
            "name":      format_floor_name(raw_name),
            "elevation": float(s.Elevation) if s.Elevation is not None else 0.0,
            "count":     elems_per_storey.get(s.GlobalId, 0),
        })
    return sorted(result, key=lambda x: x["elevation"])


def _batch_calc_volumes(model) -> dict:
    """Calcula volumes em lote via ifcopenshell.geom.iterator (muito mais rápido).
    Retorna dict {guid: volume_m3} apenas para elementos de concreto."""
    import ifcopenshell.geom
    import multiprocessing

    CONCRETE = {"IfcColumn","IfcBeam","IfcSlab","IfcFooting",
                "IfcPile","IfcWall","IfcMember","IfcPlate"}

    # Filtra apenas elementos de concreto com geometria
    elems = [e for e in model.by_type("IfcElement") if e.is_a() in CONCRETE]
    if not elems:
        return {}

    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, False)  # coordenadas locais: mais preciso

    volumes = {}
    cores = max(1, multiprocessing.cpu_count() - 1)
    iterator = ifcopenshell.geom.iterator(settings, model, cores, include=elems)

    if not iterator.initialize():
        return {}

    while True:
        shape = iterator.get()
        verts = shape.geometry.verts
        faces = shape.geometry.faces
        if verts and faces:
            n  = len(verts) // 3
            cx = sum(verts[i*3]   for i in range(n)) / n
            cy = sum(verts[i*3+1] for i in range(n)) / n
            cz = sum(verts[i*3+2] for i in range(n)) / n
            vol = 0.0
            for k in range(0, len(faces), 3):
                a, b, c = faces[k]*3, faces[k+1]*3, faces[k+2]*3
                ax  = verts[a]  -cx;  ay  = verts[a+1]-cy;  az  = verts[a+2]-cz
                bx  = verts[b]  -cx;  by  = verts[b+1]-cy;  bz  = verts[b+2]-cz
                ccx = verts[c]  -cx;  ccy = verts[c+1]-cy;  ccz = verts[c+2]-cz
                vol += (ax*(by*ccz - bz*ccy)
                      + bx*(ccy*az - ccz*ay)
                      + ccx*(ay*bz - az*by)) / 6.0
            v = abs(vol)
            if v > 0:
                volumes[shape.guid] = round(v, 6)
        if not iterator.next():
            break

    return volumes


def generate_metadata(model, skip_psets: bool = False, calc_volumes: bool = False) -> dict:
    meta_objects = []
    property_sets = []
    seen_psets = set()
    elem_to_storey = {}
    space_to_storey = {}

    _CONCRETE = {"IfcColumn","IfcBeam","IfcSlab","IfcFooting","IfcPile","IfcWall","IfcMember","IfcPlate"}
    _volumes = {}  # volumes pre-calculados (vazio por padrao — viewer calcula do XKT)

    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        container = rel.RelatingStructure
        if container is None:
            continue
        if container.is_a("IfcBuildingStorey"):
            sg = container.GlobalId
            for elem in (rel.RelatedElements or []):
                elem_to_storey[elem.GlobalId] = sg
                if elem.is_a("IfcSpace"):
                    space_to_storey[elem.GlobalId] = sg

    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        container = rel.RelatingStructure
        if container is None or not container.is_a("IfcSpace"):
            continue
        sg = space_to_storey.get(container.GlobalId)
        if sg:
            for elem in (rel.RelatedElements or []):
                if elem.GlobalId not in elem_to_storey:
                    elem_to_storey[elem.GlobalId] = sg

    try:
        for rel in model.by_type("IfcRelReferencedInSpatialStructure"):
            container = rel.RelatingStructure
            if container and container.is_a("IfcBuildingStorey"):
                sg = container.GlobalId
                for elem in (rel.RelatedElements or []):
                    if elem.GlobalId not in elem_to_storey:
                        elem_to_storey[elem.GlobalId] = sg
    except Exception:
        pass

    # Propaga pavimento para sub-elementos via IfcRelAggregates.
    # Necessário para IfcStairFlight (filho de IfcStair), IfcRampFlight, etc.
    # que têm geometria mas não estão em IfcRelContainedInSpatialStructure.
    # Repete 3 vezes para cobrir hierarquias profundas (ex: Stair→Flight→Step).
    try:
        for _ in range(3):
            changed = False
            for rel in model.by_type("IfcRelAggregates"):
                whole = rel.RelatingObject
                if not hasattr(whole, "GlobalId"):
                    continue
                sg = elem_to_storey.get(whole.GlobalId)
                if not sg:
                    continue
                for part in (rel.RelatedObjects or []):
                    if hasattr(part, "GlobalId") and part.GlobalId not in elem_to_storey:
                        elem_to_storey[part.GlobalId] = sg
                        changed = True
            if not changed:
                break
    except Exception:
        pass

    SKIP = {"IfcBuildingStorey","IfcSpace","IfcSite","IfcBuilding","IfcProject",
            "IfcOpeningElement","IfcVirtualElement","IfcAnnotation","IfcGrid"}

    for storey in model.by_type("IfcBuildingStorey"):
        raw = storey.Name or f"Pavimento {storey.id()}"
        meta_objects.append({
            "id":   storey.GlobalId,
            "name": format_floor_name(raw),
            "type": "IfcBuildingStorey",
        })

    for elem in model.by_type("IfcElement"):
        if elem.is_a() in SKIP:
            continue
        guid = elem.GlobalId
        obj  = {
            "id":   guid,
            "name": elem.Name or f"{elem.is_a()} {elem.id()}",
            "type": elem.is_a(),
        }
        sg = elem_to_storey.get(guid)
        if sg:
            obj["parent"] = sg

        if not skip_psets:
            elem_psets = []
            for rel in getattr(elem, "IsDefinedBy", []):
                if not rel.is_a("IfcRelDefinesByProperties"):
                    continue
                pdef    = rel.RelatingPropertyDefinition
                pset_id = pdef.GlobalId
                props   = []
                if pdef.is_a("IfcElementQuantity"):
                    for qty in pdef.Quantities:
                        val = None
                        for attr in ("VolumeValue","AreaValue","LengthValue"):
                            v = getattr(qty, attr, None)
                            if v is not None:
                                val = float(v); break
                        if val is not None:
                            props.append({"name": qty.Name, "value": val})
                elif pdef.is_a("IfcPropertySet"):
                    for prop in pdef.HasProperties:
                        if not prop.is_a("IfcPropertySingleValue"):
                            continue
                        nv = prop.NominalValue
                        if nv is None:
                            continue
                        raw_val = getattr(nv, "wrappedValue", None)
                        if raw_val is not None:
                            props.append({"name": prop.Name, "value": raw_val})
                if props and pset_id not in seen_psets:
                    seen_psets.add(pset_id)
                    property_sets.append({"id": pset_id, "name": pdef.Name or "Propriedades",
                                           "properties": props})
                if props:
                    elem_psets.append(pset_id)

            if elem_psets:
                obj["propertySets"] = elem_psets

        # Adiciona volume pré-calculado ao metadata
        if not skip_psets and guid in _volumes:
            vol_pset_id = f"auria_vol_{guid}"
            property_sets.append({
                "id": vol_pset_id,
                "name": "Auria_Quantities",
                "properties": [{"name": "Volume", "value": _volumes[guid]}]
            })
            obj.setdefault("propertySets", []).append(vol_pset_id)

        meta_objects.append(obj)

    return {"metaObjects": meta_objects, "propertySets": property_sets}


def find_node() -> Path | None:
    node = shutil.which("node")
    if node:
        return Path(node).resolve()
    appdata = os.environ.get("APPDATA", "")
    nvm_root = Path(appdata).parent / "Local" / "nvm"
    candidates = sorted(nvm_root.glob("v*/node.exe"), reverse=True)
    return candidates[0] if candidates else None


def patch_loaders_gl():
    """Stub out @loaders.gl/polyfills so it doesn't fail in Node (not needed for IFC conversion)."""
    stub = ("// stub\nexport function installFilePolyfills() {}\n"
            "export function installWorkerPolyfills() {}\nexport default {};\n")
    loaders_base = SCRIPT_DIR / "node_modules" / "@loaders.gl"
    # Patch both the ESM index.js (may not exist) and any dist/index files
    polyfills_dist = loaders_base / "polyfills" / "dist"
    if polyfills_dist.is_dir():
        for fname in ("index.js", "index.browser.js"):
            (polyfills_dist / fname).write_text(stub, encoding="utf-8")


# ── App ───────────────────────────────────────────────────────────────────────
class AuriaUploader(ctk.CTk):
    def __init__(self):
        super().__init__()
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.title("Auria BIM — Importar Modelo")
        self.geometry("580x800")
        self.minsize(560, 700)
        self.configure(fg_color=C["bg"])

        self._cfg        = self._load_config()
        self._floors     = []
        self._floor_vars: dict = {}
        self._ifc_path   = None
        self._log_q      = queue.Queue()
        self._running    = False
        self._start_time = None

        self._build_ui()
        self._restore_fields()
        self._poll_log()

    # ── Config ────────────────────────────────────────────────────────────────
    def _load_config(self) -> dict:
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save_config(self):
        CONFIG_PATH.write_text(json.dumps({
            "building":    self.var_building.get(),
            "obra_id":     self.var_obra.get(),
            "discipline":  self.var_disc.get(),
            "disc_custom": self.var_disc_custom.get(),
            "out_dir":     self.var_out.get(),
        }, indent=2, ensure_ascii=False), encoding="utf-8")

    def _restore_fields(self):
        for key, var in [("building", self.var_building), ("obra_id", self.var_obra),
                          ("discipline", self.var_disc), ("disc_custom", self.var_disc_custom),
                          ("out_dir", self.var_out)]:
            if key in self._cfg:
                var.set(self._cfg[key])
        # Mostra campo personalizado se "Outro" estava salvo
        if self.var_disc.get() == "Outro":
            self._on_disc_change("Outro")

    def _on_disc_change(self, value):
        if value == "Outro":
            self._disc_extra.configure(height=50)
            self.entry_disc_custom.focus()
        else:
            self._disc_extra.configure(height=0)

    # ── UI ────────────────────────────────────────────────────────────────────
    def _build_ui(self):
        # ── Header ──
        hdr = ctk.CTkFrame(self, fg_color=C["surface"], corner_radius=0, height=68)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)

        try:
            from PIL import Image as PImage
            logo_path = SCRIPT_DIR.parent / "viewer" / "public" / "logo_symbol.png"
            logo_img  = ctk.CTkImage(PImage.open(logo_path), size=(38, 38))
            ctk.CTkLabel(hdr, image=logo_img, text="").pack(side="left", padx=(16,10), pady=15)
        except Exception:
            ctk.CTkLabel(hdr, text="🅐", font=("Segoe UI", 28),
                         text_color=C["orange"]).pack(side="left", padx=(16,10), pady=15)

        tf = ctk.CTkFrame(hdr, fg_color="transparent")
        tf.pack(side="left", pady=15)
        ctk.CTkLabel(tf, text="Auria BIM", font=("Segoe UI", 15, "bold"),
                     text_color=C["text1"]).pack(anchor="w")
        ctk.CTkLabel(tf, text="Importar Modelo IFC", font=("Segoe UI", 11),
                     text_color=C["text3"]).pack(anchor="w")

        # ── Separador ──
        ctk.CTkFrame(self, fg_color=C["border"], height=1).pack(fill="x")

        # ── Corpo scrollável ──
        body = ctk.CTkScrollableFrame(self, fg_color=C["bg"],
                                       scrollbar_button_color=C["border"],
                                       scrollbar_button_hover_color=C["text3"])
        body.pack(fill="both", expand=True, padx=20, pady=(16, 0))

        # ─ Projeto ─
        self._sec(body, "PROJETO")

        self.var_building = ctk.StringVar()
        self._field(body, "Empreendimento", self.var_building,
                    "Ex: Diagonal by Pininfarina")

        self.var_obra = ctk.StringVar()
        self._field(body, "ID do empreendimento", self.var_obra,
                    "Ex: diagonal  (sem espaços, sem acentos)")

        self.var_disc = ctk.StringVar(value=DISCIPLINES[0])
        self._lbl(body, "Disciplina")
        self.cb_disc = ctk.CTkComboBox(
            body, variable=self.var_disc, values=DISCIPLINES,
            fg_color=C["surface"], border_color=C["border"],
            button_color=C["border"], button_hover_color=C["text3"],
            text_color=C["text1"], dropdown_fg_color=C["surface"],
            font=("Segoe UI", 13), height=38,
            command=self._on_disc_change,
        )
        self.cb_disc.pack(fill="x", pady=(0, 6))

        # Container sempre presente; altura controlada manualmente
        self._disc_extra = ctk.CTkFrame(body, fg_color="transparent", height=0)
        self._disc_extra.pack(fill="x")
        self._disc_extra.pack_propagate(False)

        self.var_disc_custom = ctk.StringVar()
        self.entry_disc_custom = ctk.CTkEntry(
            self._disc_extra, textvariable=self.var_disc_custom,
            placeholder_text="Nome da disciplina personalizada...",
            fg_color=C["surface"], border_color=C["blue"],
            text_color=C["text1"], placeholder_text_color=C["text3"],
            font=("Segoe UI", 13), height=38,
        )
        self.entry_disc_custom.pack(fill="x", pady=(0, 10))

        # Trace como garantia extra (dispara ao selecionar OU digitar)
        self.var_disc.trace_add("write", lambda *_: self._on_disc_change(self.var_disc.get()))

        # ─ Arquivo ─
        self._sec(body, "ARQUIVO IFC")
        ifc_row = ctk.CTkFrame(body, fg_color="transparent")
        ifc_row.pack(fill="x", pady=(0, 6))
        self.lbl_ifc = ctk.CTkLabel(ifc_row, text="Nenhum arquivo selecionado",
                                     text_color=C["text3"], font=("Segoe UI", 12),
                                     anchor="w", wraplength=390)
        self.lbl_ifc.pack(side="left", fill="x", expand=True)
        ctk.CTkButton(ifc_row, text="Selecionar", width=100, height=34,
                       fg_color=C["surface"], border_color=C["border"], border_width=1,
                       text_color=C["text2"], hover_color="#1e293b",
                       command=self._pick_ifc).pack(side="right")

        # ─ Pavimentos ─
        self._sec(body, "PAVIMENTOS DETECTADOS")
        self.floors_frame = ctk.CTkFrame(body, fg_color=C["surface"],
                                          border_color=C["border"], border_width=1,
                                          corner_radius=8)
        self.floors_frame.pack(fill="x", pady=(0, 14))
        ctk.CTkLabel(self.floors_frame,
                     text="Selecione um arquivo IFC para visualizar os pavimentos.",
                     text_color=C["text3"], font=("Segoe UI", 12)).pack(pady=24)

        # ─ Saída ─
        self._sec(body, "PASTA DE SAÍDA  (QR codes locais)")
        out_row = ctk.CTkFrame(body, fg_color="transparent")
        out_row.pack(fill="x", pady=(0, 6))
        self.var_out = ctk.StringVar(value=str(Path.home() / "Desktop" / "Auria_Output"))
        ctk.CTkLabel(out_row, textvariable=self.var_out, text_color=C["text3"],
                     font=("Segoe UI", 11), anchor="w", wraplength=390).pack(side="left", fill="x", expand=True)
        ctk.CTkButton(out_row, text="Alterar", width=100, height=34,
                       fg_color=C["surface"], border_color=C["border"], border_width=1,
                       text_color=C["text2"], hover_color="#1e293b",
                       command=self._pick_out).pack(side="right")

        # ─ Log ─
        self._sec(body, "LOG")
        self.log_box = ctk.CTkTextbox(
            body, height=170, fg_color=C["surface"],
            text_color=C["text2"], font=("Consolas", 11),
            border_color=C["border"], border_width=1, state="disabled",
        )
        self.log_box.pack(fill="x", pady=(0, 12))

        # ─ Progresso ─
        self.progress = ctk.CTkProgressBar(body, fg_color=C["surface"],
                                            progress_color=C["blue"], height=6)
        self.progress.pack(fill="x", pady=(0, 6))
        self.progress.set(0)

        status_row = ctk.CTkFrame(body, fg_color="transparent")
        status_row.pack(fill="x", pady=(0, 10))
        self.lbl_status = ctk.CTkLabel(status_row, text="", text_color=C["text3"],
                                        font=("Segoe UI", 11), anchor="w")
        self.lbl_status.pack(side="left")
        self.lbl_timer = ctk.CTkLabel(status_row, text="", text_color=C["text3"],
                                       font=("Consolas", 11), anchor="e")
        self.lbl_timer.pack(side="right")

        # ── Footer com botão ──
        foot = ctk.CTkFrame(self, fg_color=C["surface"], corner_radius=0, height=72)
        foot.pack(fill="x", side="bottom")
        foot.pack_propagate(False)
        ctk.CTkFrame(foot, fg_color=C["border"], height=1).pack(fill="x")
        self.btn_run = ctk.CTkButton(
            foot, text="▶   Converter e Publicar",
            height=46, font=("Segoe UI", 14, "bold"),
            fg_color=C["blue_bg"], hover_color="#1d4ed8",
            text_color="#60a5fa", border_color=C["blue"], border_width=1,
            command=self._start,
        )
        self.btn_run.pack(fill="x", padx=20, pady=13)

    def _sec(self, parent, title):
        ctk.CTkLabel(parent, text=title, font=("Segoe UI", 10, "bold"),
                     text_color=C["text3"]).pack(anchor="w", pady=(14, 3))
        ctk.CTkFrame(parent, fg_color=C["border"], height=1).pack(fill="x", pady=(0, 10))

    def _lbl(self, parent, text):
        ctk.CTkLabel(parent, text=text, font=("Segoe UI", 12),
                     text_color=C["text2"]).pack(anchor="w", pady=(0, 4))

    def _field(self, parent, label, var, placeholder=""):
        self._lbl(parent, label)
        ctk.CTkEntry(parent, textvariable=var, placeholder_text=placeholder,
                     fg_color=C["surface"], border_color=C["border"],
                     text_color=C["text1"], placeholder_text_color=C["text3"],
                     font=("Segoe UI", 13), height=38).pack(fill="x", pady=(0, 12))

    # ── Ações ─────────────────────────────────────────────────────────────────
    def _pick_ifc(self):
        path = filedialog.askopenfilename(
            title="Selecionar arquivo IFC",
            filetypes=[("Arquivo IFC", "*.ifc"), ("Todos", "*.*")],
        )
        if not path:
            return
        self._ifc_path = Path(path)
        self.lbl_ifc.configure(text=self._ifc_path.name, text_color=C["text1"])
        self._detect_floors_async()

    def _pick_out(self):
        p = filedialog.askdirectory(title="Pasta de saída dos QR codes")
        if p:
            self.var_out.set(p)

    def _detect_floors_async(self):
        for w in self.floors_frame.winfo_children():
            w.destroy()
        ctk.CTkLabel(self.floors_frame, text="⏳  Lendo IFC...",
                     text_color=C["text3"], font=("Segoe UI", 12)).pack(pady=24)
        self.update()
        threading.Thread(target=self._detect_floors_thread, daemon=True).start()

    def _detect_floors_thread(self):
        try:
            import ifcopenshell
            model = ifcopenshell.open(str(self._ifc_path))
            floors = extract_floors(model)
            self.after(0, lambda: self._show_floors(floors))
        except Exception as e:
            self.after(0, lambda: self._show_floors_error(str(e)))

    def _show_floors(self, floors):
        self._floors = floors
        for w in self.floors_frame.winfo_children():
            w.destroy()
        self._floor_vars = {}

        with_data = [f for f in floors if f["count"] > 0]
        empty_cnt = len(floors) - len(with_data)

        info_txt = f"{len(with_data)} pavimento(s) com elementos"
        if empty_cnt:
            info_txt += f"  ·  {empty_cnt} vazio(s) ignorado(s)"
        ctk.CTkLabel(self.floors_frame, text=info_txt, text_color=C["text3"],
                     font=("Segoe UI", 11)).pack(anchor="w", padx=12, pady=(10, 6))

        scroll_h = min(200, max(60, len(with_data) * 30 + 12))
        scroll = ctk.CTkScrollableFrame(self.floors_frame, fg_color="transparent",
                                         height=scroll_h,
                                         scrollbar_button_color=C["border"])
        scroll.pack(fill="x", padx=8, pady=(0, 10))

        for fl in with_data:
            var = ctk.BooleanVar(value=True)
            self._floor_vars[fl["guid"]] = var
            row = ctk.CTkFrame(scroll, fg_color="transparent")
            row.pack(fill="x", pady=2)
            ctk.CTkCheckBox(
                row, text=fl["name"], variable=var,
                font=("Segoe UI", 12), text_color=C["text1"],
                fg_color=C["blue"], border_color=C["border"],
                checkmark_color="#fff", hover_color=C["blue_bg"],
            ).pack(side="left")
            ctk.CTkLabel(row, text=f"{fl['count']} elem.",
                         font=("Segoe UI", 10), text_color=C["text3"]).pack(side="right", padx=10)

    def _show_floors_error(self, msg):
        for w in self.floors_frame.winfo_children():
            w.destroy()
        ctk.CTkLabel(self.floors_frame, text=f"❌  Erro ao ler IFC:\n{msg}",
                     text_color=C["red"], font=("Segoe UI", 11)).pack(pady=16)

    # ── Log ───────────────────────────────────────────────────────────────────
    def _log(self, msg: str):
        self._log_q.put(msg)

    def _poll_log(self):
        try:
            while True:
                msg = self._log_q.get_nowait()
                self.log_box.configure(state="normal")
                self.log_box.insert("end", msg + "\n")
                self.log_box.see("end")
                self.log_box.configure(state="disabled")
        except queue.Empty:
            pass
        self.after(80, self._poll_log)

    def _set_prog(self, v: float, status: str = ""):
        self.progress.set(v)
        if status:
            self.lbl_status.configure(text=status, text_color=C["text3"])

    def _tick_timer(self):
        if self._running and self._start_time:
            elapsed = int(time.time() - self._start_time)
            m, s = divmod(elapsed, 60)
            self.lbl_timer.configure(text=f"⏱ {m:02d}:{s:02d}")
            self.after(1000, self._tick_timer)
        else:
            self.lbl_timer.configure(text="")

    # ── Conversão ─────────────────────────────────────────────────────────────
    def _start(self):
        if self._running:
            return

        # Resolve disciplina efetiva
        disc_raw = self.var_disc.get()
        if disc_raw == "Outro":
            disc_effective = self.var_disc_custom.get().strip()
        else:
            disc_effective = disc_raw

        # Validações básicas
        errors = []
        if not self._ifc_path or not self._ifc_path.exists():
            errors.append("Selecione um arquivo IFC válido.")
        if not self.var_building.get().strip():
            errors.append("Informe o nome do empreendimento.")
        if not self.var_obra.get().strip():
            errors.append("Informe o ID do empreendimento.")
        if not disc_effective:
            errors.append("Informe o nome da disciplina personalizada.")
        if errors:
            messagebox.showerror("Campos obrigatórios", "\n".join(errors))
            return

        # Verifica .env
        missing = [k for k in ["SUPABASE_URL","SUPABASE_SERVICE_KEY","R2_ENDPOINT",
                                 "R2_ACCESS_KEY","R2_SECRET_KEY","R2_BUCKET",
                                 "PUBLIC_BASE_URL","R2_PUBLIC_URL"]
                   if not os.environ.get(k)]
        if missing:
            messagebox.showerror("Credenciais ausentes",
                                  f"Configure o arquivo .env:\n\n{chr(10).join(missing)}")
            return

        # Verifica node.js
        node = find_node()
        if not node:
            messagebox.showerror("Node.js não encontrado",
                                  "Instale o Node.js em https://nodejs.org e reinicie o app.")
            return

        if not self._floor_vars or not any(v.get() for v in self._floor_vars.values()):
            messagebox.showerror("Pavimentos", "Selecione ao menos um pavimento.")
            return

        self._save_config()
        self._running    = True
        self._start_time = time.time()
        self.btn_run.configure(state="disabled", text="⏳  Processando...")
        self.progress.configure(progress_color=C["blue"])
        self.progress.set(0)
        self.lbl_status.configure(text="Iniciando...", text_color=C["text3"])

        # Impede o Windows de dormir durante o processamento
        if sys.platform == "win32":
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED

        self._tick_timer()

        # Limpa log
        self.log_box.configure(state="normal")
        self.log_box.delete("1.0", "end")
        self.log_box.configure(state="disabled")

        floors_sel = [f for f in self._floors
                      if self._floor_vars.get(f["guid"], ctk.BooleanVar()).get()]

        params = {
            "ifc_path":   self._ifc_path,
            "building":   self.var_building.get().strip(),
            "obra_id":    self.var_obra.get().strip(),
            "discipline": disc_effective,
            "out_dir":    Path(self.var_out.get()),
            "floors":     floors_sel,
            "node":       node,
        }
        threading.Thread(target=self._run_thread, args=(params,), daemon=True).start()

    def _run_thread(self, p):
        try:
            self._convert(p)
        except Exception as e:
            self._log(f"\n❌ Erro inesperado: {e}")
            import traceback
            self._log(traceback.format_exc())
            self.after(0, lambda: self._finish(False))

    def _convert(self, p):
        import ifcopenshell
        import boto3
        import qrcode as qrc
        from PIL import Image as PImage, ImageDraw, ImageFont
        from supabase import create_client

        ifc_path   = p["ifc_path"]
        building   = p["building"]
        obra_id    = p["obra_id"]
        discipline = p["discipline"]
        floors     = p["floors"]
        node       = p["node"]
        out_dir    = p["out_dir"]

        project_id = slug(f"{obra_id}-{discipline}")
        out_proj   = (out_dir / project_id)
        out_proj.mkdir(parents=True, exist_ok=True)

        SUPABASE_URL = os.environ["SUPABASE_URL"]
        SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
        R2_ENDPOINT  = os.environ["R2_ENDPOINT"]
        R2_ACCESS    = os.environ["R2_ACCESS_KEY"]
        R2_SECRET    = os.environ["R2_SECRET_KEY"]
        R2_BUCKET    = os.environ["R2_BUCKET"]
        R2_PUBLIC    = os.environ["R2_PUBLIC_URL"]
        PUBLIC_BASE  = os.environ["PUBLIC_BASE_URL"]

        sb = create_client(SUPABASE_URL, SUPABASE_KEY)
        r2 = boto3.client("s3", endpoint_url=R2_ENDPOINT,
                          aws_access_key_id=R2_ACCESS,
                          aws_secret_access_key=R2_SECRET,
                          region_name="auto")

        # 1. Preparação
        self._log("🔧 Preparando conversor...")
        patch_loaders_gl()
        self.after(0, lambda: self._set_prog(0.05, "Preparando..."))

        xkt_path  = (out_proj / f"{project_id}.xkt").resolve()
        meta_path = (out_proj / f"{project_id}-metadata.json").resolve()

        ifc_src = ifc_path
        tmp     = None
        if ifc_path.suffix.lower() != ".ifc":
            tmp     = Path(tempfile.mktemp(suffix=".ifc"))
            shutil.copy2(str(ifc_path), str(tmp))
            ifc_src = tmp

        # Detecta arquivos grandes (> 100 MB)
        file_mb  = ifc_path.stat().st_size / 1024 / 1024
        large    = file_mb > 100
        node_mem = 16384 if large else 8192
        if large:
            self._log(f"   Arquivo grande: {file_mb:.0f} MB — modo otimizado ativo")

        # 2. Metadata PRIMEIRO — libera RAM antes do Node.js consumir tudo
        self._log("📋 Gerando metadata.json...")
        self.after(0, lambda: self._set_prog(0.10, "Gerando metadados..."))
        model    = ifcopenshell.open(str(ifc_path))
        metadata = generate_metadata(model, skip_psets=large)
        del model   # libera memória imediatamente
        meta_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        n_objs = len(metadata.get("metaObjects", []))
        del metadata  # libera mais memória
        meta_mb = meta_path.stat().st_size / 1024 / 1024
        pset_note = "sem psets" if large else "com psets"
        self._log(f"   {n_objs} objetos · {meta_mb:.1f} MB · {pset_note}")
        self.after(0, lambda: self._set_prog(0.25, "Convertendo IFC → XKT..."))

        # 3. Conversão IFC → XKT
        self._log(f"⚙️  Convertendo {ifc_path.name} → XKT...")
        self._log(f"   (modelos grandes podem levar vários minutos — RAM: {node_mem // 1024} GB)")

        popen_kwargs = {}
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

        proc = subprocess.Popen(
            [str(node), f"--max-old-space-size={node_mem}",
             str(CONVERT2XKT), "-s", str(ifc_src), "-o", str(xkt_path)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            cwd=str(SCRIPT_DIR),
            **popen_kwargs,
        )
        brep_count = 0
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            if "TriangulateBounds" in line:
                brep_count += 1
            else:
                self._log(f"   {line}")
        rc = proc.wait()
        if tmp:
            tmp.unlink(missing_ok=True)

        if brep_count:
            self._log(f"   ⚠️  {brep_count} avisos BREP ignorados (normal em MEP/hidráulico)")
        self._log(f"   Node.js finalizado — código {rc}")

        if not xkt_path.exists():
            raise RuntimeError(
                "XKT não foi gerado. Verifique se o arquivo IFC está correto.")

        xkt_mb = xkt_path.stat().st_size / 1024 / 1024
        self._log(f"✅ XKT gerado: {xkt_mb:.1f} MB")
        self.after(0, lambda: self._set_prog(0.55, "Fazendo upload..."))

        # 4. Upload R2
        self._log("☁️  Upload XKT para R2...")
        r2.upload_file(str(xkt_path), R2_BUCKET,
                       f"{project_id}/{project_id}.xkt",
                       ExtraArgs={"ContentType": "application/octet-stream"})
        xkt_url = f"{R2_PUBLIC}/{project_id}/{project_id}.xkt"
        self._log(f"   {xkt_url}")

        self._log("☁️  Upload metadata...")
        r2.upload_file(str(meta_path), R2_BUCKET,
                       f"{project_id}/{project_id}-metadata.json",
                       ExtraArgs={"ContentType": "application/json"})
        meta_url = f"{R2_PUBLIC}/{project_id}/{project_id}-metadata.json"
        self.after(0, lambda: self._set_prog(0.70, "Registrando no Supabase..."))

        # 5. Supabase — projeto
        self._log("💾 Salvando projeto no Supabase...")
        sb.table("projects").upsert({
            "id":         project_id,
            "name":       discipline,
            "building":   building,
            "obra_id":    obra_id,
            "discipline": discipline,
            "xkt_url":    xkt_url,
            "meta_url":   meta_url,
        }).execute()

        # 6. Pavimentos + QR codes
        qr_dir = out_proj / "qrcodes"
        qr_dir.mkdir(parents=True, exist_ok=True)
        self._log(f"📍 Publicando {len(floors)} pavimento(s) + QR codes...")

        for i, floor in enumerate(floors):
            floor_id   = slug(floor["name"])
            viewer_url = (
                f"{PUBLIC_BASE}/floor.html"
                f"?project={project_id}"
                f"&floor={quote(floor['guid'], safe='')}"
                f"&xkt={quote(xkt_url, safe='')}"
                f"&meta={quote(meta_url, safe='')}"
                f"&building={quote(building, safe='')}"
                f"&obra={quote(obra_id, safe='')}"
            )
            sb.table("floors").upsert({
                "id":         f"{project_id}-{floor_id}",
                "project_id": project_id,
                "name":       floor["name"],
                "elevation":  floor["elevation"],
                "ifc_guid":   floor["guid"],
                "qr_url":     viewer_url,
            }).execute()

            # QR code PNG
            qr_obj = qrc.QRCode(error_correction=qrc.constants.ERROR_CORRECT_M,
                                  box_size=8, border=3)
            qr_obj.add_data(viewer_url)
            qr_obj.make(fit=True)
            img  = qr_obj.make_image(fill_color="#0f1117", back_color="white").convert("RGB")
            draw = ImageDraw.Draw(img)
            try:
                font = ImageFont.truetype("arial.ttf", 18)
            except Exception:
                font = ImageFont.load_default()
            w, h = img.size
            bbox = draw.textbbox((0, 0), floor["name"], font=font)
            tw   = bbox[2] - bbox[0]
            draw.text(((w - tw) // 2, h - 30), floor["name"], fill="#0f1117", font=font)
            img.save(qr_dir / f"{floor_id}.png")

            self._log(f"   ✓  {floor['name']}")
            prog = 0.70 + 0.28 * (i + 1) / len(floors)
            name_cap = floor["name"]
            self.after(0, lambda v=prog, n=name_cap: self._set_prog(v, f"QR: {n}"))

        self._log(f"\n🎉  Concluído!")
        self._log(f"   QR codes salvos em: {qr_dir}")
        self._log(f"   Acesse o app em: {PUBLIC_BASE}")
        self.after(0, lambda: self._finish(True))

    def _finish(self, success: bool):
        self._running    = False
        self._start_time = None
        self._tick_timer()  # limpa o timer

        # Restaura política de sleep do Windows
        if sys.platform == "win32":
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)  # ES_CONTINUOUS

        self.btn_run.configure(state="normal", text="▶   Converter e Publicar")
        if success:
            self.progress.set(1.0)
            self.progress.configure(progress_color=C["green"])
            self.lbl_status.configure(text="✅  Publicado com sucesso!", text_color=C["green"])
            messagebox.showinfo(
                "Publicado!",
                "Modelo publicado com sucesso.\n\n"
                "Abra o Auria BIM e atualize a página para ver o novo projeto.",
            )
        else:
            self.progress.configure(progress_color=C["red"])
            self.lbl_status.configure(text="❌  Erro — veja o log acima", text_color=C["red"])


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app = AuriaUploader()
    app.mainloop()
