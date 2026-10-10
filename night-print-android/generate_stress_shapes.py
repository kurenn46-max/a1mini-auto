#!/usr/bin/env python3
"""Deterministic manifold test shapes as self-contained PETG 235C Bambu 3MF.

No slicer, CAD toolkit, printer, or network is required to generate fixtures.
Positive cases are NOT validated by assertion alone: Android native Orca E2E
must still slice the output. All mesh faces have consistent outward winding.
"""
from __future__ import annotations
import json
import math
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET

outdir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("app/src/androidTest/assets")
outdir.mkdir(parents=True, exist_ok=True)
NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
ET.register_namespace("", NS)

def poly_area(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1]
               - p[(i + 1) % len(p)][0] * p[i][1]
               for i in range(len(p))) / 2

def earcut(points):
    assert poly_area(points) > 0, "2D polygon must be CCW"
    remaining = list(range(len(points)))
    result = []
    def cross(i, j, k):
        a, b, c = points[i], points[j], points[k]
        return (b[0]-a[0]) * (c[1]-a[1]) - (b[1]-a[1]) * (c[0]-a[0])
    def inside(i, j, k, t):
        return min(cross(i, j, t), cross(j, k, t), cross(k, i, t)) >= -1e-9
    for _ in range(len(points) + 1):
        if len(remaining) == 3:
            result.append(tuple(remaining))
            break
        for n in range(len(remaining)):
            i, j, k = (remaining[(n-1) % len(remaining)],
                       remaining[n], remaining[(n+1) % len(remaining)])
            if cross(i, j, k) <= 1e-9:
                continue
            if any(inside(i, j, k, t) for t in remaining if t not in (i, j, k)):
                continue
            result.append((i, j, k))
            remaining.remove(j)
            break
        else:
            raise ValueError("Could not triangulate nonconvex polygon")
    return result

def extrude_xy(poly, z0, z1):
    """Extrude CCW XY polygon; bottom faces -Z, top faces +Z."""
    assert z1 > z0 and poly_area(poly) > 0
    n = len(poly)
    vertices = [(x,y,z0) for x,y in poly] + [(x,y,z1) for x,y in poly]
    faces = []
    for a,b,c in earcut(poly):
        faces.extend([(c,b,a), (a+n,b+n,c+n)])
    for i in range(n):
        j = (i+1)%n
        faces.extend([(i,j,j+n),(i,j+n,i+n)])
    return vertices, faces

def extrude_xz(poly, y0, y1):
    """T bracket, with true unsupported cantilever in the X/Z profile."""
    assert y1 > y0 and poly_area(poly) > 0
    n = len(poly)
    vertices = [(x,y0,z) for x,z in poly] + [(x,y1,z) for x,z in poly]
    faces = []
    for a,b,c in earcut(poly):
        faces.extend([(a,b,c),(c+n,b+n,a+n)])
    for i in range(n):
        j=(i+1)%n
        faces.extend([(j,i,i+n),(j,i+n,j+n)])
    return vertices, faces

def tube(points_outer, points_inner, z0, z1):
    """Manifold polygon annulus with a REAL through-hole (no printed cap)."""
    n = len(points_outer)
    assert n >= 4 and len(points_inner) == n
    assert poly_area(points_outer)>0 and poly_area(points_inner)>0
    vertices = (
        [(x,y,z0) for x,y in points_outer] +
        [(x,y,z1) for x,y in points_outer] +
        [(x,y,z0) for x,y in points_inner] +
        [(x,y,z1) for x,y in points_inner]
    )
    faces = []
    for i in range(n):
        j=(i+1)%n
        ob_i,ob_j=i,j
        ot_i,ot_j=i+n,j+n
        ib_i,ib_j=i+2*n,j+2*n
        it_i,it_j=i+3*n,j+3*n
        faces.extend([
            (ob_i,ob_j,ot_j),(ob_i,ot_j,ot_i),
            (ib_i,it_j,ib_j),(ib_i,it_i,it_j),
            (ot_i,ot_j,it_j),(ot_i,it_j,it_i),
            (ob_i,ib_j,ob_j),(ob_i,ib_i,ib_j),
        ])
    return vertices,faces

def circle(rad, count=64):
    return [(rad*math.cos(2*math.pi*i/count),rad*math.sin(2*math.pi*i/count))
            for i in range(count)]

def taper(r_bottom,r_top,height,segments=64):
    bottom=circle(r_bottom, segments)
    top=circle(r_top, segments)
    vertices=(
        [(x,y,0) for x,y in bottom]+[(x,y,height) for x,y in top]
        +[(0,0,0),(0,0,height)]
    )
    faces=[]
    for i in range(segments):
        j=(i+1)%segments
        faces.extend([
            (i,j,j+segments),(i,j+segments,i+segments),
            (2*segments,j,i),
            (2*segments+1,i+segments,j+segments),
        ])
    return vertices,faces

def box(x0,x1,y0,y1,z0,z1):
    return extrude_xy([(x0,y0),(x1,y0),(x1,y1),(x0,y1)],z0,z1)

def validate(vertices,faces):
    assert len(vertices)>=4 and len(faces)>=4
    assert all(math.isfinite(v) for xyz in vertices for v in xyz)
    directed=defaultdict(list)
    signed=0.0
    for tri in faces:
        a,b,c=tri
        assert len({a,b,c})==3
        assert min(tri)>=0 and max(tri)<len(vertices)
        for i,j in ((a,b),(b,c),(c,a)):
            directed[(min(i,j),max(i,j))].append((i,j))
        va,vb,vc=(vertices[k] for k in tri)
        signed+=(
            va[0]*(vb[1]*vc[2]-vb[2]*vc[1])
            +va[1]*(vb[2]*vc[0]-vb[0]*vc[2])
            +va[2]*(vb[0]*vc[1]-vb[1]*vc[0])
        )/6.0
    assert signed > 0.001, f"Faces reversed or no volume: {signed}"
    bad=[(edge,uses) for edge,uses in directed.items()
         if len(uses)!=2 or uses[0]!=uses[1][::-1]]
    assert not bad, f"Not a watertight oriented manifold: {bad[:3]}"
    mins=tuple(min(v[i] for v in vertices) for i in range(3))
    maxs=tuple(max(v[i] for v in vertices) for i in range(3))
    dims=tuple(round(hi-lo,5) for lo,hi in zip(mins,maxs))
    assert all(0<d<=180 for d in dims), f"Outside 180 mm A1 mini bed: {dims}"
    assert mins[2]>=-1e-5, f"Geometry below bed: {mins}"
    return dims, signed

def settings(height, walls, infill, pattern, top, bottom):
    assert 0.08 <= height <= 0.32 and 1<=walls<=8 and 5<=infill<=100
    assert pattern in ("gyroid","grid","rectilinear","cubic")
    return {
        "layer_height":str(height),
        "initial_layer_print_height":str(height),
        "wall_loops":str(walls),
        "top_shell_layers":str(top),
        "bottom_shell_layers":str(bottom),
        "sparse_infill_density":f"{infill}%",
        "sparse_infill_pattern":pattern,
        "curr_bed_type":"Textured PEI Plate",
        "filament_type":["PETG"],
        "filament_colour":["#999999"],
        "nozzle_temperature":["235"],
        "nozzle_temperature_initial_layer":["235"],
        "textured_plate_temp":["65"],
        "textured_plate_temp_initial_layer":["65"],
        "hot_plate_temp":["65"],
        "hot_plate_temp_initial_layer":["65"],
        "filament_density":["1.27"],
        "filament_cost":["0"],
        "filament_max_volumetric_speed":["2"],
        "filament_flow_ratio":["0.98"],
    }

REL='''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0"
 Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'''
TYPES='''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
<Default Extension="config" ContentType="application/octet-stream"/></Types>'''

def emit(name, models, profile):
    root=ET.Element(f"{{{NS}}}model",{"unit":"millimeter","xml:lang":"en-US"})
    resources=ET.SubElement(root,f"{{{NS}}}resources")
    build=ET.SubElement(root,f"{{{NS}}}build")
    for i,(verts,faces) in enumerate(models,1):
        dims, volume=validate(verts,faces)
        obj=ET.SubElement(resources,f"{{{NS}}}object",{
            "id":str(i),"type":"model","name":f"NIGHT PRINT {name} part {i}"})
        mesh=ET.SubElement(obj,f"{{{NS}}}mesh")
        vx=ET.SubElement(mesh,f"{{{NS}}}vertices")
        tx=ET.SubElement(mesh,f"{{{NS}}}triangles")
        for x,y,z in verts:
            ET.SubElement(vx,f"{{{NS}}}vertex",{
                "x":format(x,'.7f'),"y":format(y,'.7f'),"z":format(z,'.7f')})
        for a,b,c in faces:
            ET.SubElement(tx,f"{{{NS}}}triangle",{
                "v1":str(a),"v2":str(b),"v3":str(c)})
        ET.SubElement(build,f"{{{NS}}}item",{"objectid":str(i)})
        print(f"{name} part={i}: verts={len(verts)} tris={len(faces)} size={dims} volume={volume:.2f}")
    f=outdir/f"nightprint_shape_{name}_petg235.3mf"
    with zipfile.ZipFile(f,"w",compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("3D/3dmodel.model",ET.tostring(root,encoding="utf-8",xml_declaration=True))
        z.writestr("_rels/.rels",REL)
        z.writestr("[Content_Types].xml",TYPES)
        z.writestr("Metadata/project_settings.config",json.dumps(profile,separators=(",",":")))
    with zipfile.ZipFile(f) as z:
        assert z.testzip() is None
        assert json.loads(z.read("Metadata/project_settings.config"))==profile
        assert len(ET.fromstring(z.read("3D/3dmodel.model")).findall(f".//{{{NS}}}object"))==len(models)
    return f

CASES=[
    ("solid_cube", [box(-9,9,-9,9,0,12)],
     settings(.20,3,20,"rectilinear",4,4)),
    ("l_bracket", [extrude_xy([(-14,-10),(14,-10),(14,-4),(-4,-4),(-4,10),(-14,10)],0,10)],
     settings(.20,4,30,"gyroid",4,4)),
    ("round_hole_plate", [tube(circle(13),circle(3),0,5)],
     settings(.20,3,35,"grid",3,3)),
    ("thin_wall_tube", [tube([(-12,-12),(12,-12),(12,12),(-12,12)],
                             [(-10.8,-10.8),(10.8,-10.8),(10.8,10.8),(-10.8,10.8)],0,12.8)],
     settings(.16,2,15,"gyroid",3,3)),
    ("cantilever_T", [extrude_xz([(9,0),(17,0),(17,12),(27,12),(27,16),(0,16),(0,12),(9,12)],0,10)],
     settings(.20,4,25,"cubic",4,4)),
    ("taper_frustum", [taper(9.5,13,12)],
     settings(.24,3,25,"rectilinear",4,4)),
    ("two_objects", [box(-20,-10,-7,5,0,8),box(9,19,-7,5,0,12)],
     settings(.20,3,25,"grid",4,4)),
]

for name,models,profile in CASES:
    emit(name,models,profile)

# Malformed fixture cases: exercise recognition/rejection ONLY.
# They must never be passed to a printer or silently treated as valid PETG.
good = outdir/"nightprint_shape_solid_cube_petg235.3mf"
with zipfile.ZipFile(good) as zin:
    parts={name:zin.read(name) for name in zin.namelist()}
def emit_bad(name, patches, extra=None):
    target=outdir/f"nightprint_bad_{name}.3mf"
    with zipfile.ZipFile(target,"w",compression=zipfile.ZIP_DEFLATED) as z:
        for key,value in {**parts,**patches}.items():
            if value is not None:
                z.writestr(key,value)
        if extra is not None:
            z.writestr(extra,b"do not extract this file")
    return target
original=json.loads(parts["Metadata/project_settings.config"])
bad_pla={**original,"filament_type":["PLA"]}
bad_heat={**original,"nozzle_temperature_initial_layer":["220"]}
emit_bad("pla",{"Metadata/project_settings.config":json.dumps(bad_pla)})
emit_bad("heat_mismatch",{"Metadata/project_settings.config":json.dumps(bad_heat)})
emit_bad("missing_profile",{"Metadata/project_settings.config":None})
emit_bad("path_traversal",{},extra="../nightprint_should_never_write.txt")
(outdir/"nightprint_bad_invalid_zip.3mf").write_bytes(b"not a zip or 3mf file")
print("NIGHT PRINT V3.3 geometry suites ready:",len(CASES),"positive and 5 rejected inputs")
