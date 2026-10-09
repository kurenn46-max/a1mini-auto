#!/usr/bin/env python3
"""Generate deterministic, tiny PETG ring fixtures for Android native slicing CI.

Creates a real annular solid, as both raw STL and Bambu-style 3MF with a
self-contained filament/process profile. No printer or network is needed.
"""
from __future__ import annotations
import json
import math
import struct
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

dst = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("app/src/androidTest/assets")
dst.mkdir(parents=True, exist_ok=True)
segs = 128  # User's original failed ring had 1024 STL facets (8 per segment).
outer = 12.0
inner = 10.0
height = 20.0
verts = []
for i in range(segs):
    rad = i * (2.0 * math.pi / segs)
    cx, cy = math.cos(rad), math.sin(rad)
    verts.extend([
        (outer * cx, outer * cy, 0.0),
        (outer * cx, outer * cy, height),
        (inner * cx, inner * cy, 0.0),
        (inner * cx, inner * cy, height),
    ])

tris = []
for i in range(segs):
    j = (i + 1) % segs
    ob, ot, ib, it = (4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3)
    nb, nt, ni, nj = (4 * j, 4 * j + 1, 4 * j + 2, 4 * j + 3)
    tris.extend([
        (ob, nb, ot), (ot, nb, nt),       # outer wall
        (ib, it, ni), (it, nj, ni),       # inner wall
        (ot, nt, it), (it, nt, nj),       # top annulus
        (ob, ib, nb), (ib, ni, nb),       # bottom annulus
    ])

def normal(tri):
    a, b, c = [verts[i] for i in tri]
    ab = tuple(b[k] - a[k] for k in range(3))
    ac = tuple(c[k] - a[k] for k in range(3))
    v = (ab[1]*ac[2]-ab[2]*ac[1],
         ab[2]*ac[0]-ab[0]*ac[2],
         ab[0]*ac[1]-ab[1]*ac[0])
    length = math.sqrt(sum(x*x for x in v))
    return tuple(x/length for x in v)

stl = dst / "nightprint_ring_20x24x20.stl"
# Binary STL exactly matching the failed real-user fixture's 1024 facets.
# Each triangle stores independent coordinates; the converter MUST weld them.
with stl.open("wb") as out:
    out.write(b"NIGHT PRINT binary STL 20x24x20".ljust(80, b"\\0"))
    out.write(struct.pack("<I", len(tris)))
    for t in tris:
        n = normal(t)
        coords = tuple(value for idx in t for value in verts[idx])
        out.write(struct.pack("<12fH", *(n + coords), 0))
assert stl.stat().st_size == 84 + len(tris) * 50

ns = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
ET.register_namespace("", ns)
root = ET.Element(f"{{{ns}}}model", {"unit": "millimeter", "xml:lang":"en-US"})
resources = ET.SubElement(root, f"{{{ns}}}resources")
obj = ET.SubElement(resources, f"{{{ns}}}object", {"id":"1","type":"model","name":"NIGHT PRINT Ring"})
mesh = ET.SubElement(obj,f"{{{ns}}}mesh")
vxml = ET.SubElement(mesh,f"{{{ns}}}vertices")
for v in verts:
    ET.SubElement(vxml, f"{{{ns}}}vertex", {"x":str(v[0]),"y":str(v[1]),"z":str(v[2])})
txml = ET.SubElement(mesh,f"{{{ns}}}triangles")
for a,b,c in tris:
    ET.SubElement(txml,f"{{{ns}}}triangle", {"v1":str(a),"v2":str(b),"v3":str(c)})
build = ET.SubElement(root,f"{{{ns}}}build")
ET.SubElement(build,f"{{{ns}}}item", {"objectid":"1"})

profile = {
    "layer_height":"0.20",
    "initial_layer_print_height":"0.20",
    "wall_loops":"5",
    "top_shell_layers":"5",
    "bottom_shell_layers":"5",
    "sparse_infill_density":"40%",
    "sparse_infill_pattern":"gyroid",
    "curr_bed_type":"Textured PEI Plate",
    "filament_type":["PETG"],
    "filament_colour":["#888888"],
    "nozzle_temperature":["235"],
    "nozzle_temperature_initial_layer":["235"],
    "textured_plate_temp":["65"],
    "textured_plate_temp_initial_layer":["65"],
    "hot_plate_temp":["65"],
    "hot_plate_temp_initial_layer":["65"],
    "filament_max_volumetric_speed":["2"],
    "filament_flow_ratio":["0.98"],
}
three_mf = dst / "nightprint_ring_petg235.3mf"
with zipfile.ZipFile(three_mf,"w",compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr("3D/3dmodel.model", ET.tostring(root, encoding="utf-8", xml_declaration=True))
    z.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>""")
    z.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
<Default Extension="config" ContentType="application/octet-stream"/></Types>""")
    z.writestr("Metadata/project_settings.config", json.dumps(profile,separators=(",",":")))

assert len(verts)==512 and len(tris)==1024
with zipfile.ZipFile(three_mf) as z:
    assert json.loads(z.read("Metadata/project_settings.config"))["nozzle_temperature"]==["235"]
    assert z.testzip() is None
print(f"NIGHT PRINT fixture OK: {len(verts)} vertices / {len(tris)} triangles; {stl}; {three_mf}")
