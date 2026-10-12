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
# If Bambu packing failed, never fall back to printing raw G-code or an
# embedded stale project from the source file. A printer upload must use the
# newly verified and generated sliced project for the current G-code.
activity=root/"app/src/main/java/com/u1/slicer/MainActivity.kt"
a=activity.read_text()
gate='''if (!canSendSliceArtifactToPrinter(selectedSliceArtifact, previewActivePrinter)) {'''
assert a.count(gate)==2, "unexpected Bambu send/upload branches; STOP"
block='''if (gcodePath.isNotBlank() &&
                                    previewActivePrinter?.kind == com.u1.slicer.data.PrinterKind.BAMBU_LAN &&
                                    bambuProject?.source != PreviewBambuProject.Source.GeneratedSliceArtifact
                                ) {
                                    printerViewModel.reportSendError(
                                        "NIGHT PRINT安全検査: 印刷用3MFの材料検証に失敗しました。送信を中止しました。"
                                    )
                                } else if (!canSendSliceArtifactToPrinter(selectedSliceArtifact, previewActivePrinter)) {'''
activity.write_text(a.replace(gate,block))
kotlin=root/"app/src/main/java/com/u1/slicer/slice/NightPrintA1MiniMaterialPacket.kt"
assert not kotlin.exists()
kotlin.write_text((src/"NightPrintA1MiniMaterialPacket.kt").read_text())
test=root/"app/src/androidTest/java/com/u1/slicer/NightPrintV401PacketMaterialTest.kt"
assert not test.exists()
test.write_text((src/"NightPrintV401PacketMaterialTest.kt").read_text())
# Upgrade old skeletal A1 mini tests, not safety checks.
import subprocess
subprocess.run(["python3", str(src/"fix_v401_legacy_test_fixtures.py"), str(root)], check=True)
print("Applied fail-closed A1 mini single-material direct-print metadata guard")
