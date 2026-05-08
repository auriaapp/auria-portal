"""
Converte IFC → XKT por pavimento e faz upload para Cloudflare R2.
Salva metadados (pavimentos, URLs) no Supabase e gera QR codes.

Uso:
  python convert.py --ifc modelo.ifc --project "estrutura-bloco-a" --name "Estrutura Bloco A"
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import quote

import boto3
import ifcopenshell
import ifcopenshell.util.element as ifc_util
import qrcode
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFont
from supabase import create_client

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_SERVICE_KEY"]
R2_ENDPOINT     = os.environ["R2_ENDPOINT"]      # https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY   = os.environ["R2_ACCESS_KEY"]
R2_SECRET_KEY   = os.environ["R2_SECRET_KEY"]
R2_BUCKET       = os.environ["R2_BUCKET"]
PUBLIC_BASE_URL = os.environ["PUBLIC_BASE_URL"]   # URL pública do viewer (Vercel)
R2_PUBLIC_URL   = os.environ["R2_PUBLIC_URL"]     # URL pública do bucket R2

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

r2 = boto3.client(
    "s3",
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name="auto",
)

# ── IFC helpers ───────────────────────────────────────────────────────────────
def format_floor_name(raw: str) -> str:
    """Converte abreviações TQS/IFC para nomes legíveis de pavimento."""
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
    # Fallback: title-case para nomes não mapeados (evita MAIÚSCULAS no app)
    return n.title()


def extract_floors(model: ifcopenshell.file) -> list[dict]:
    storeys = model.by_type("IfcBuildingStorey")
    result = []
    for s in storeys:
        raw_name = s.Name or f"Pavimento {s.id()}"
        result.append({
            "guid":      s.GlobalId,
            "name":      format_floor_name(raw_name),
            "elevation": float(s.Elevation) if s.Elevation is not None else 0.0,
        })
    return sorted(result, key=lambda x: x["elevation"])


def generate_metadata(model: ifcopenshell.file) -> dict:
    """Gera metadados completos com hierarquia pavimento→elemento e quantitativos."""
    meta_objects = []
    property_sets = []
    seen_psets = set()

    storeys = model.by_type("IfcBuildingStorey")

    # ── Mapa: GUID do elemento → GUID do pavimento ──────────────────────────────
    # Estratégia robusta para qualquer disciplina (estrutural, MEP, arquitetura):
    # 1ª passagem — containment direto no storey + mapeia IfcSpace → storey
    # 2ª passagem — elementos dentro de IfcSpace resolvidos pelo mapa de espaços
    # 3ª passagem — IfcRelReferencedInSpatialStructure (tubulações que cruzam pav.)
    elem_to_storey = {}
    space_to_storey = {}

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
            if container is None or not container.is_a("IfcBuildingStorey"):
                continue
            sg = container.GlobalId
            for elem in (rel.RelatedElements or []):
                if elem.GlobalId not in elem_to_storey:
                    elem_to_storey[elem.GlobalId] = sg
    except Exception:
        pass  # nem todos os schemas IFC têm esta relação

    print(f"   {len(elem_to_storey)} elemento(s) com pavimento mapeado")

    # Adiciona pavimentos como raízes (com nomes formatados)
    for storey in storeys:
        raw = storey.Name or f"Pavimento {storey.id()}"
        meta_objects.append({
            "id": storey.GlobalId,
            "name": format_floor_name(raw),
            "type": "IfcBuildingStorey",
        })

    # Tipos a ignorar (não são elementos visíveis/relevantes)
    SKIP_TYPES = {
        "IfcBuildingStorey", "IfcSpace", "IfcSite", "IfcBuilding", "IfcProject",
        "IfcOpeningElement", "IfcVirtualElement", "IfcAnnotation",
        "IfcGrid", "IfcRelSpaceBoundary",
    }

    # Processa TODOS os IfcElement — funciona para qualquer disciplina
    count = 0
    try:
        for elem in model.by_type("IfcElement"):
            elem_type = elem.is_a()
            if elem_type in SKIP_TYPES:
                continue
            guid = elem.GlobalId
            obj = {
                "id":   guid,
                "name": elem.Name or f"{elem_type} {elem.id()}",
                "type": elem_type,
            }
            storey_guid = elem_to_storey.get(guid)
            if storey_guid:
                obj["parent"] = storey_guid

            # Extrai property sets (BaseQuantities + Pset_* + custom)
            elem_psets = []
            if hasattr(elem, "IsDefinedBy"):
                for rel in elem.IsDefinedBy:
                    if not rel.is_a("IfcRelDefinesByProperties"):
                        continue
                    pdef = rel.RelatingPropertyDefinition
                    pset_id = pdef.GlobalId
                    props = []

                    if pdef.is_a("IfcElementQuantity"):
                        for qty in pdef.Quantities:
                            val = None
                            if hasattr(qty, "VolumeValue") and qty.VolumeValue is not None:
                                val = float(qty.VolumeValue)
                            elif hasattr(qty, "AreaValue") and qty.AreaValue is not None:
                                val = float(qty.AreaValue)
                            elif hasattr(qty, "LengthValue") and qty.LengthValue is not None:
                                val = float(qty.LengthValue)
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
                        property_sets.append({
                            "id":         pset_id,
                            "name":       pdef.Name or "Propriedades",
                            "properties": props,
                        })
                    if props:
                        elem_psets.append(pset_id)

            if elem_psets:
                obj["propertySets"] = elem_psets
            meta_objects.append(obj)
            count += 1
    except Exception as e:
        print(f"  Aviso ao processar elementos: {e}")

    print(f"   {count} elemento(s) incluídos no metadata")

    return {"metaObjects": meta_objects, "propertySets": property_sets}


def slug(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"[\s_-]+", "-", text)


# ── Conversão IFC → XKT ───────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
CONVERT2XKT  = SCRIPT_DIR / "node_modules" / "@xeokit" / "xeokit-convert" / "convert2xkt.js"
POLYFILLS_IDX = SCRIPT_DIR / "node_modules" / "@loaders.gl" / "polyfills" / "dist" / "index.js"

def patch_loaders_gl():
    """Substitui @loaders.gl/polyfills por stub vazio — Node 18+ tem tudo nativo."""
    index = SCRIPT_DIR / "node_modules" / "@loaders.gl" / "polyfills" / "dist" / "index.js"
    if not index.exists():
        return
    content = index.read_text(encoding="utf-8", errors="ignore")
    stub = (
        "// Auria BIM stub — polyfills not needed in Node 18+\n"
        "export function installFilePolyfills() {}\n"
        "export function installWorkerPolyfills() {}\n"
        "export default {};\n"
    )
    index.write_text(stub, encoding="utf-8")
    print("- Patch aplicado em @loaders.gl/polyfills")

def convert_to_xkt(ifc_path: Path, out_dir: Path, project_id: str, model: ifcopenshell.file) -> tuple[Path, Path]:
    """
    Converte IFC → XKT diretamente usando convert2xkt.js (web-ifc interno).
    Também gera metadata.json com informações do modelo.
    """
    out_dir = out_dir.resolve()  # caminho absoluto
    out_dir.mkdir(parents=True, exist_ok=True)
    xkt_path  = (out_dir / f"{project_id}.xkt").resolve()
    meta_path = (out_dir / f"{project_id}-metadata.json").resolve()
    ifc_path  = ifc_path.resolve()

    print("- Convertendo IFC para XKT...")
    # Detecta node automaticamente; fallback para NVM se necessário
    node_exe = shutil.which("node")
    if not node_exe:
        appdata = os.environ.get("APPDATA", "")
        nvm_root = Path(appdata).parent / "Local" / "nvm"
        candidates = sorted(nvm_root.glob("v*/node.exe"), reverse=True)
        node_exe = str(candidates[0]) if candidates else None
    if not node_exe:
        sys.exit("Erro: Node.js não encontrado. Instale em https://nodejs.org")
    node_exe = Path(node_exe).resolve()

    # convert2xkt exige extensão .ifc minúscula — copia se necessário
    if ifc_path.suffix != ".ifc":
        tmp = Path(tempfile.mktemp(suffix=".ifc"))
        shutil.copy2(str(ifc_path), str(tmp))
        ifc_src = tmp
    else:
        ifc_src = ifc_path
        tmp = None

    r = subprocess.run(
        [str(node_exe),
         "--max-old-space-size=8192",   # 8 GB heap para modelos grandes
         str(CONVERT2XKT),
         "-s", str(ifc_src),
         "-o", str(xkt_path)],
        capture_output=True, text=True, cwd=str(SCRIPT_DIR)
    )
    if tmp:
        tmp.unlink(missing_ok=True)
    # Verifica se XKT foi gerado — avisos de "too many triangles" retornam exit≠0
    # mas o arquivo é criado normalmente; só falha de verdade se não existir.
    if not xkt_path.exists():
        sys.exit(f"Erro convert2xkt (XKT não gerado):\n{r.stderr[-3000:]}\n{r.stdout[-1000:]}")
    if r.returncode != 0:
        print(f"  Aviso convert2xkt (exit {r.returncode}) — XKT gerado com ressalvas.")

    print("- Gerando metadata.json...")
    metadata = generate_metadata(model)
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    return xkt_path, meta_path


# ── Upload R2 ─────────────────────────────────────────────────────────────────
def upload_file(local_path: Path, r2_key: str, content_type: str) -> str:
    print(f"- Upload {local_path.name} para R2/{r2_key}")
    r2.upload_file(
        str(local_path),
        R2_BUCKET,
        r2_key,
        ExtraArgs={"ContentType": content_type},
    )
    return f"{R2_PUBLIC_URL}/{r2_key}"


# ── QR Code ───────────────────────────────────────────────────────────────────
def generate_qr(url: str, out_path: Path, label: str):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=3)
    qr.add_data(url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="#0f1117", back_color="white").convert("RGB")

    # Label abaixo do QR
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 18)
    except Exception:
        font = ImageFont.load_default()

    w, h = img.size
    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((w - tw) // 2, h - 30), label, fill="#0f1117", font=font)

    img.save(out_path)
    print(f"- QR gerado: {out_path.name}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ifc",        required=True, help="Caminho do arquivo .ifc")
    parser.add_argument("--project",    required=True, help="ID do projeto (slug)")
    parser.add_argument("--name",       required=True, help="Nome do projeto/disciplina")
    parser.add_argument("--building",   default="",    help="Nome do empreendimento")
    parser.add_argument("--obra",       default="",    help="ID do empreendimento (para federação de disciplinas)")
    parser.add_argument("--discipline", default="Estrutural")
    parser.add_argument("--out",        default="./output", help="Pasta de saída local")
    args = parser.parse_args()

    ifc_path   = Path(args.ifc)
    project_id = args.project
    out_dir    = Path(args.out) / project_id

    patch_loaders_gl()
    print(f"\n Auria BIM Converter")
    print(f"  Projeto: {args.name} ({project_id})")
    print(f"  IFC:     {ifc_path}\n")

    # 1. Lê IFC e extrai pavimentos
    print("- Lendo IFC...")
    model  = ifcopenshell.open(str(ifc_path))
    floors = extract_floors(model)
    # Conta elementos por pavimento para filtrar vazios
    elems_per_storey: Counter = Counter()
    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        c = rel.RelatingStructure
        if c and c.is_a("IfcBuildingStorey"):
            elems_per_storey[c.GlobalId] += len(rel.RelatedElements or [])

    # Mantém apenas pavimentos com pelo menos 1 elemento
    floors_with_data = [f for f in floors if elems_per_storey.get(f["guid"], 0) > 0]
    floors_empty     = len(floors) - len(floors_with_data)

    print(f"   {len(floors)} pavimento(s) no IFC — {len(floors_with_data)} com elementos, {floors_empty} vazios (ignorados):")
    for f in floors_with_data:
        print(f"     {f['name']} ({elems_per_storey[f['guid']]} elem.) — GUID: {f['guid']}")

    floors = floors_with_data  # usa apenas os que têm dados

    # 2. Converte IFC → XKT
    xkt_path, meta_path = convert_to_xkt(ifc_path, out_dir, project_id, model)
    xkt_size = xkt_path.stat().st_size / 1024 / 1024
    print(f"   XKT gerado: {xkt_size:.1f} MB")

    # 3. Upload R2
    xkt_url  = upload_file(xkt_path,  f"{project_id}/{project_id}.xkt",              "application/octet-stream")
    meta_url = upload_file(meta_path, f"{project_id}/{project_id}-metadata.json",    "application/json")

    # 4. Salva projeto no Supabase
    obra_id = args.obra or project_id
    supabase.table("projects").upsert({
        "id":         project_id,
        "name":       args.name,
        "building":   args.building or args.name,
        "obra_id":    obra_id,
        "discipline": args.discipline,
        "xkt_url":    xkt_url,
        "meta_url":   meta_url,
    }).execute()

    # 5. Salva pavimentos + gera QR codes
    qr_dir = out_dir / "qrcodes"
    qr_dir.mkdir(parents=True, exist_ok=True)

    for floor in floors:
        floor_id = slug(floor["name"])
        viewer_url = (
            f"{PUBLIC_BASE_URL}/floor.html"
            f"?project={project_id}"
            f"&floor={quote(floor['guid'], safe='')}"
            f"&xkt={quote(xkt_url, safe='')}"
            f"&meta={quote(meta_url, safe='')}"
            f"&building={quote(args.building or args.name, safe='')}"
            f"&obra={quote(obra_id, safe='')}"
        )

        supabase.table("floors").upsert({
            "id":         f"{project_id}-{floor_id}",
            "project_id": project_id,
            "name":       floor["name"],
            "elevation":  floor["elevation"],
            "ifc_guid":   floor["guid"],
            "qr_url":     viewer_url,
        }).execute()

        generate_qr(viewer_url, qr_dir / f"{floor_id}.png", floor["name"])

    print(f"\n Concluído! QR codes em: {qr_dir}")
    print(f"   Viewer: {PUBLIC_BASE_URL}?project={project_id}\n")


if __name__ == "__main__":
    main()
