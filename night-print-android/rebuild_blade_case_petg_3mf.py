#!/usr/bin/env python3
"""Recreate a printable A1 mini blade-sheath CAD profile as PETG 3MF archives.

This is a *new parametric reconstruction*, not an exact clone of the
unavailable original V3 mesh. Do not claim prior physical fit validation.
"""
from __future__ import annotations

import io
import json
import hashlib
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

import numpy as np
import trimesh

OUTPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("rebuild-output")
OUTPUT.mkdir(parents=True, exist_ok=True)
NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
CONTENT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
ET.register_namespace("", NS)

def box(x0, x1, y0, y1, z0, z1):
    m = trimesh.creation.box(extents=(x1-x0, y1-y0, z1-z0))
    m.apply_translation(((x0+x1)/2, (y0+y1)/2, (z0+z1)/2))
    return m

def model(test: bool) -> trimesh.Trimesh:
    length = 13.0 if test else 79.6

    # Main closed sheath. Blade: 8 x 2 x 68mm.
    # Shoulder/collar: 10 x 3.8 x 7mm.
    body = box(0, length, -7, 7, 0, 8.0)
    # Rear keyring tab (hole is across Y, not along blade insertion axis).
    tab = box(0, 13, 6.8, 10.25, 6.5, 14.1)
    outer = trimesh.boolean.union([body, tab], engine="manifold")

    collar = box(-0.5, 7.8, -5.3, 5.3, 1.75, 6.25)
    blade = box(7.45, 13.5 if test else 76.2, -4.36, 4.36, 2.55, 5.45)
    hole = trimesh.creation.cylinder(radius=1.7, height=5.0, sections=64)
    hole.apply_transform(trimesh.transformations.rotation_matrix(np.pi/2, [1, 0, 0]))
    hole.apply_translation((6.5, 8.65, 10.35))

    shell = trimesh.boolean.difference([outer, collar, blade, hole], engine="manifold")
    # Low-intrusion side friction ribs. Sized for test/fit adjustment,
    # not guaranteed to fit until physically measured/printed.
    near = box(3.0, 5.5, 5.02, 5.42, 2.4, 5.6)
    far = box(3.0, 5.5, -5.42, -5.02, 2.4, 5.6)
    shell = trimesh.boolean.union([shell, near, far], engine="manifold")
    shell.merge_vertices()
    shell.remove_unreferenced_vertices()
    shell.fix_normals()

    assert shell.is_watertight, "not watertight"
    assert shell.is_winding_consistent, "bad winding"
    assert shell.volume > 0, "no positive volume"
    bounds = shell.bounds
    span = bounds[1] - bounds[0]
    expected = [length, 17.25, 14.1]
    assert np.allclose(span, expected, atol=0.01), (span,expected)
    assert np.min(bounds[:, 2]) >= -0.001
    assert max(span) <= 180
    return shell

PROFILE = {
    "filament_type": ["PETG"],
    "filament_colour": ["#222222"],
    "nozzle_temperature": ["235"],
    "nozzle_temperature_initial_layer": ["235"],
    "hot_plate_temp": ["65"],
    "hot_plate_temp_initial_layer": ["65"],
    "textured_plate_temp": ["65"],
    "textured_plate_temp_initial_layer": ["65"],
    "curr_bed_type": "Textured PEI Plate",
    "filament_flow_ratio": ["0.98"],
    "filament_max_volumetric_speed": ["2"],
    "layer_height": "0.2",
    "initial_layer_print_height": "0.2",
    "wall_loops": "4",
    "top_shell_layers": "5",
    "bottom_shell_layers": "5",
    "sparse_infill_density": "40%",
    "sparse_infill_pattern": "gyroid",
    "enable_support": "0",
}

def make_zip(mesh: trimesh.Trimesh, path: Path) -> None:
    model_root = ET.Element(
        "model", {"xmlns": NS, "unit": "millimeter", "xml:lang": "ja-JP"})
    resources = ET.SubElement(model_root, "resources")
    obj = ET.SubElement(resources, "object", {"id": "1", "type": "model"})
    imesh = ET.SubElement(obj, "mesh")
    verts = ET.SubElement(imesh, "vertices")
    tris = ET.SubElement(imesh, "triangles")
    for x,y,z in mesh.vertices:
        ET.SubElement(verts, "vertex", x=f"{x:.6f}", y=f"{y:.6f}", z=f"{z:.6f}")
    for i,j,k in mesh.faces:
        ET.SubElement(tris, "triangle", v1=str(i), v2=str(j), v3=str(k))
    build = ET.SubElement(model_root, "build")
    ET.SubElement(build, "item", objectid="1")
    document = ET.tostring(model_root, encoding="utf-8", xml_declaration=True)

    ct = ET.Element("Types", xmlns=CONTENT_NS)
    ET.SubElement(ct, "Default", Extension="rels",
        ContentType="application/vnd.openxmlformats-package.relationships+xml")
    ET.SubElement(ct, "Default", Extension="model",
        ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml")
    ET.SubElement(ct, "Default", Extension="config",
        ContentType="application/octet-stream")
    types = ET.tostring(ct, encoding="utf-8", xml_declaration=True)
    rels = ET.Element("Relationships", xmlns=REL_NS)
    ET.SubElement(rels, "Relationship",
        Id="rel0",
        Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel",
        Target="/3D/3dmodel.model")
    rr = ET.tostring(rels, encoding="utf-8", xml_declaration=True)
    with ZipFile(path,"w",ZIP_DEFLATED,compresslevel=9) as out:
        out.writestr("[Content_Types].xml",types)
        out.writestr("_rels/.rels",rr)
        out.writestr("3D/3dmodel.model",document)
        out.writestr("Metadata/project_settings.config",
            json.dumps(PROFILE, separators=(",",":"),ensure_ascii=False).encode("utf-8"))

    with ZipFile(path) as z:
        assert z.testzip() is None
        assert set(z.namelist()) == {
            "[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model",
            "Metadata/project_settings.config"}
        root = ET.fromstring(z.read("3D/3dmodel.model"))
        assert len(root.findall(f".//{{{NS}}}vertex")) == len(mesh.vertices)
        assert len(root.findall(f".//{{{NS}}}triangle")) == len(mesh.faces)
        p=json.loads(z.read("Metadata/project_settings.config"))
        assert p["filament_type"]==["PETG"]
        assert p["nozzle_temperature"]==["235"]
        assert p["textured_plate_temp"]==["65"]

results = []
for test, name in [
    (True, "NIGHT_CASE_V3_REBUILD_13MM_TEST_PETG235.3mf"),
    (False, "NIGHT_CASE_V3_REBUILD_FULL_PETG235.3mf"),
]:
    m=model(test)
    dest=OUTPUT/name
    make_zip(m,dest)
    report={"name":name, "size":dest.stat().st_size,
        "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
        "vertices":len(m.vertices), "triangles":len(m.faces),
        "bounds_mm": (m.bounds[1]-m.bounds[0]).round(4).tolist(),
        "watertight":bool(m.is_watertight), "volume_mm3":round(m.volume,2),
        "material":"PETG","nozzle_C":235,"bed_C":65,
        "physical_fit_tested":False,
        "same_mesh_as_original_v3":False}
    print(json.dumps(report,ensure_ascii=False))
    results.append(report)
(OUTPUT/"verification.json").write_text(
    json.dumps({"files":results,
        "warning":"Reconstructed geometry based on previous dimensions, not byte-identical to original V3. Test fit first."},
        indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
