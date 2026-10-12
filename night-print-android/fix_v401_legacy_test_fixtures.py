#!/usr/bin/env python3
"""Upgrade skeletal upstream A1 mini packaging fixtures for fail-closed material checks.

The original unit test fixtures omitted all executable material selection and
first-layer markers. This script adds those to fixtures only. It never relaxes
the runtime PETG metadata guard and never connects to a printer.
"""
from pathlib import Path
import sys
root=Path(sys.argv[1])
test=root/"app/src/test/java/com/u1/slicer/SliceArtifactRoutingTest.kt"
s=test.read_text()
def once(old,new):
    global s
    count=s.count(old)
    assert count==1,(repr(old),count)
    s=s.replace(old,new)

once(
    'writeText("; filament used [mm] = 12\\nG28\\n")',
    'writeText("; filament_type = PLA\\nM1002 set_filament_type:PLA\\n;LAYER_CHANGE\\n; filament used [mm] = 12\\nG28\\n")',
)
# Two identical tiny model fixtures: first Snapmaker (leave untouched), second A1 mini.
old='val gcode = tmp.newFile("model.gcode").apply { writeText("G28\\n") }'
assert s.count(old)==2
parts=s.split(old)
replacement='val gcode = tmp.newFile("model.gcode").apply { writeText("; filament_type = PLA\\nM1002 set_filament_type:PLA\\n;LAYER_CHANGE\\nG28\\n") }'
s=parts[0]+old+parts[1]+replacement+parts[2]
once(
    'repeat(250) { append("; generated command\\n") }',
    'append("; filament_type = PETG\\nM1002 set_filament_type:PETG\\n;LAYER_CHANGE\\n")\n                repeat(250) { append("; generated command\\n") }',
)
once(
    'M620 S1A\n                M620.11 S1 I1 E-18 F1200',
    'M1002 set_filament_type:PETG\n                M620 S1A\n                M620.11 S1 I1 E-18 F1200',
)
once(
    'M621 S1A\n                ; filament used [mm] = 0.0,120.0,0.0,0.0',
    'M621 S1A\n                ;LAYER_CHANGE\n                ; filament used [mm] = 0.0,120.0,0.0,0.0',
)
test.write_text(s)
print("Four legacy unit-test scenarios now carry explicit material and first-layer commands.")
