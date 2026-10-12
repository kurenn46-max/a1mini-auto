#!/usr/bin/env python3
"""V4.0.1 hotfix: align A1 mini direct-print 3MF material with actual G-code.

Applied *after* V3.4.2 upstream overlay. For single-material A1 mini ONLY;
multi-material and non-A1-mini paths are unchanged.
Fail-closed if source or packaged metadata disagree. Does not rewrite G-code
or touch an actual printer.
"""
from pathlib import Path
import sys
root=Path(sys.argv[1])
src=Path(__file__).parent
target=root/"app/src/main/java/com/u1/slicer/slice/SliceArtifact.kt"
s=target.read_text()
needle='''        stageComplete("h2d_transform")
        BambuProjectWriter.writeSinglePlateProject('''
replacement='''        stageComplete("h2d_transform")
        // NIGHT PRINT V4.0.1: the genuine sliced PETG commands are authoritative.
        // The old preset may still be PLA and must NOT enter the printer's
        // Metadata/project_settings.config or Metadata/slice_info.config.
        val nightA1MiniMaterial = if (
            target == SlicerTarget.BambuA1Mini && narrowedFilaments.first.size == 1
        ) NightPrintA1MiniMaterialPacket.verifyGcodeAndResolveSingleMaterial(packagedGcode)
        else null
        BambuProjectWriter.writeSinglePlateProject('''
assert s.count(needle)==1, "unexpected Bambu packaging anchor; STOP"
s=s.replace(needle,replacement)
needle="            filamentTypes = narrowedFilaments.second,"
replacement='''            filamentTypes = nightA1MiniMaterial?.let { listOf(it) } ?: narrowedFilaments.second,'''
assert s.count(needle)==1, "unexpected filament list anchor; STOP"
s=s.replace(needle,replacement)
needle='''        stageComplete("archive_write")
        SliceArtifact.BambuProjectArtifact('''
replacement='''        // Independently inspect actual bytes of the zipped transfer payload.
        // If any material field was lost/fallbacked to PLA, no project artifact
        // reaches the UI's printer upload or Start Print code paths.
        if (nightA1MiniMaterial != null) {
            NightPrintA1MiniMaterialPacket.verifyPackagedProject(
                projectFile, nightA1MiniMaterial, plateId
            )
        }
        stageComplete("archive_write")
        SliceArtifact.BambuProjectArtifact('''
assert s.count(needle)==1,"unexpected archive anchor; STOP"
s=s.replace(needle,replacement)
target.write_text(s)
kotlin=root/"app/src/main/java/com/u1/slicer/slice/NightPrintA1MiniMaterialPacket.kt"
assert not kotlin.exists()
kotlin.write_text((src/"NightPrintA1MiniMaterialPacket.kt").read_text())
test=root/"app/src/androidTest/java/com/u1/slicer/NightPrintV401PacketMaterialTest.kt"
assert not test.exists()
test.write_text((src/"NightPrintV401PacketMaterialTest.kt").read_text())
print("Applied fail-closed A1 mini single-material direct-print metadata guard")
