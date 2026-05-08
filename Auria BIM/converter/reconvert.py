# -*- coding: utf-8 -*-
"""Reconversao headless: gera metadata (sem calculo de volume) + XKT + upload."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

import json, os, shutil, subprocess
from pathlib import Path

SCRIPT_DIR  = Path(__file__).parent
ENV_PATH    = SCRIPT_DIR / ".env"

# Usa o node_modules do build antigo (completo, com todos os pacotes ESM)
_OLD_INTERNAL = SCRIPT_DIR / "dist" / "AuriaBIM_Uploader_old" / "_internal"
_OLD_CONVERT  = _OLD_INTERNAL / "node_modules" / "@xeokit" / "xeokit-convert" / "convert2xkt.js"
if _OLD_CONVERT.exists():
    CONVERT2XKT = _OLD_CONVERT
    NODE_CWD    = str(_OLD_INTERNAL)
else:
    CONVERT2XKT = SCRIPT_DIR / "node_modules" / "@xeokit" / "xeokit-convert" / "convert2xkt.js"
    NODE_CWD    = str(SCRIPT_DIR)

from dotenv import load_dotenv
load_dotenv(ENV_PATH)

IFC_PATH   = Path(r"C:\Users\tiago\Downloads\IFCs - PNF\PINI-EST-EX-1000-IFC-R04.IFC")
BUILDING   = "Diagonal by Pininfarina"
OBRA_ID    = "diagonal"
DISCIPLINE = "Estrutural"

import re
def slug(text):
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"[\s_-]+", "-", text)

PROJECT_ID = slug(f"{OBRA_ID}-{DISCIPLINE}")
print(f"Project ID: {PROJECT_ID}")

import ifcopenshell
import boto3
from supabase import create_client

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

from auria_uploader import generate_metadata, extract_floors, patch_loaders_gl

# ── 1. Metadata (sem calculo de volume - rapido) ──────────────────────────────
print("\n[1/5] Gerando metadata + volumes parametricos...")
model    = ifcopenshell.open(str(IFC_PATH))
metadata = generate_metadata(model, skip_psets=False, calc_volumes=True)

out_dir  = SCRIPT_DIR / "output" / PROJECT_ID
out_dir.mkdir(parents=True, exist_ok=True)
meta_path = out_dir / f"{PROJECT_ID}-metadata.json"
meta_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")

floors_data = extract_floors(model)
print(f"   {len(metadata.get('metaObjects',[]))} objetos, {len(floors_data)} pavimentos")
del model

# ── 2. XKT ────────────────────────────────────────────────────────────────────
print("\n[2/5] Convertendo IFC -> XKT...")
# Patch the node_modules we will actually use
patch_loaders_gl()
# Also patch in the old build's node_modules if that's where convert2xkt.js lives
_old_polyfills = _OLD_INTERNAL / "node_modules" / "@loaders.gl" / "polyfills" / "dist"
if _old_polyfills.is_dir():
    _stub = "// stub\nexport function installFilePolyfills(){}\nexport function installWorkerPolyfills(){}\nexport default {};\n"
    for _fn in ("index.js", "index.browser.js"):
        (_old_polyfills / _fn).write_text(_stub, encoding="utf-8")
node = shutil.which("node")
if not node:
    print("ERRO: Node.js nao encontrado"); sys.exit(1)

xkt_path = out_dir / f"{PROJECT_ID}.xkt"

# convert2xkt detecta o formato pela extensao do arquivo; .IFC (maiusculo) nao e reconhecido.
# Cria uma copia temporaria com extensao .ifc minuscula se necessario.
import tempfile
if IFC_PATH.suffix.upper() == ".IFC" and IFC_PATH.suffix != ".ifc":
    _tmp_ifc = Path(tempfile.gettempdir()) / (IFC_PATH.stem + ".ifc")
    import shutil as _sh
    _sh.copy2(str(IFC_PATH), str(_tmp_ifc))
    ifc_src = _tmp_ifc
    print(f"   Copia temporaria: {ifc_src}")
else:
    ifc_src = IFC_PATH

proc = subprocess.Popen(
    [node, "--max-old-space-size=8192",
     str(CONVERT2XKT), "-s", str(ifc_src), "-o", str(xkt_path)],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    text=True, encoding="utf-8", errors="replace", cwd=NODE_CWD,
    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=="win32" else 0,
)
brep = 0
for line in proc.stdout:
    line = line.rstrip()
    if not line: continue
    if "TriangulateBounds" in line: brep += 1
    else: print(f"   {line}")
rc = proc.wait()
# Remove copia temporaria se foi criada
if ifc_src != IFC_PATH:
    try: ifc_src.unlink()
    except Exception: pass
if brep: print(f"   {brep} avisos BREP ignorados")
if not xkt_path.exists():
    print(f"ERRO: XKT nao gerado (codigo {rc})"); sys.exit(1)
print(f"   XKT: {xkt_path.stat().st_size/1024/1024:.1f} MB")

# ── 3. Upload R2 ──────────────────────────────────────────────────────────────
print("\n[3/5] Upload para R2...")
for local, key in [(xkt_path,  f"{PROJECT_ID}/{PROJECT_ID}.xkt"),
                   (meta_path, f"{PROJECT_ID}/{PROJECT_ID}-metadata.json")]:
    r2.upload_file(str(local), R2_BUCKET, key,
                   ExtraArgs={"ContentType":"application/octet-stream","CacheControl":"no-cache"})
    print(f"   OK: {key}")

xkt_url  = f"{R2_PUBLIC}/{PROJECT_ID}/{PROJECT_ID}.xkt"
meta_url = f"{R2_PUBLIC}/{PROJECT_ID}/{PROJECT_ID}-metadata.json"

# ── 4. Elimina modelo antigo ───────────────────────────────────────────────────
print("\n[4/5] Eliminando modelos antigos de estrutura...")
existing = sb.table("projects").select("id,discipline").eq("obra_id", OBRA_ID).execute()
old_ids = [p["id"] for p in (existing.data or [])
           if ("estrutur" in p["id"].lower() or "estrutur" in str(p.get("discipline","")).lower())
           and p["id"] != PROJECT_ID]  # nao remover o projeto que acabou de ser criado
print(f"   Encontrados para remover: {old_ids}")
for old_id in old_ids:
    sb.table("floors").delete().eq("project_id", old_id).execute()
    sb.table("projects").delete().eq("id", old_id).execute()
    for suffix in [".xkt", "-metadata.json"]:
        try:
            r2.delete_object(Bucket=R2_BUCKET, Key=f"{old_id}/{old_id}{suffix}")
            print(f"   R2 removido: {old_id}{suffix}")
        except Exception as e:
            print(f"   R2 skip: {e}")
    print(f"   Removido: {old_id}")

# ── 5. Cria projeto no Supabase ────────────────────────────────────────────────
print("\n[5/5] Criando projeto no Supabase...")
sb.table("projects").upsert({
    "id":         PROJECT_ID,
    "name":       f"{BUILDING} -- {DISCIPLINE}",
    "building":   BUILDING,
    "obra_id":    OBRA_ID,
    "discipline": DISCIPLINE,
    "xkt_url":    xkt_url,
    "meta_url":   meta_url,
}).execute()

for f in floors_data:
    floor_id = slug(f["name"])
    sb.table("floors").upsert({
        "id":         f"{PROJECT_ID}-{floor_id}",
        "project_id": PROJECT_ID,
        "ifc_guid":   f["guid"],
        "name":       f["name"],
        "elevation":  f["elevation"],
    }).execute()
    print(f"   Pavimento: {f['name']}")

print(f"\nConcluido!")
print(f"URL viewer: {PUBLIC_BASE}/floor.html?project={PROJECT_ID}&xkt={xkt_url}&meta={meta_url}")
