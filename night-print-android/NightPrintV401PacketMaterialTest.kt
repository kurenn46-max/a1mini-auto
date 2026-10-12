package com.u1.slicer

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.u1.slicer.slice.NightPrintA1MiniMaterialPacket
import com.u1.slicer.slice.SliceArtifact
import com.u1.slicer.slice.SlicerTarget
import com.u1.slicer.slice.buildSliceArtifact
import java.io.File
import java.util.zip.ZipFile
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/**
 * ON-DEVICE Android regression for the actual Bambu sliced-project writer.
 * Critically different from the previous 19 tests: checks the materials
 * that the A1 mini firmware reads from the *.gcode.3mf transfer package.
 * No printer connection, no heat, no print commands.
 */
@RunWith(AndroidJUnit4::class)
class NightPrintV401PacketMaterialTest {
    private fun source(type: String, commandType: String) = """
        ; HEADER_BLOCK_START
        ; total layer number: 2
        ; filament_colour = #888888
        ; filament_type = $type
        ; filament used [mm] = 14
        ; filament used [g] = 0.05
        ; max_z_height: 0.4
        ; printer_model = Bambu Lab A1 mini
        ; printable_area = 0x0,180x0,180x180,0x180
        ; HEADER_BLOCK_END
        M1002 set_filament_type:$commandType
        M109 S235
        M190 S65
        ;LAYER_CHANGE
        ;Z:0.2
        G1 X85 Y85 Z0.2 F2000
        G1 X95 Y85 E0.7
        ;LAYER_CHANGE
        ;Z:0.4
        G1 X85 Y95 Z0.4 F2000
        G1 X95 Y95 E1.5
    """.trimIndent()

    @Test fun stalePlaPresetIsNotSentToA1MiniWhenExecutableGcodeIsPetg() {
        val cache = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
            "nightprint_v401_${System.nanoTime()}").apply { mkdirs() }
        try {
            val gcode = File(cache,"ring.gcode").apply { writeText(source("PETG", "PETG")) }
            val artifact = buildSliceArtifact(
                target = SlicerTarget.BambuA1Mini,
                sourceModelName = "ring",
                gcodeFile = gcode,
                workingDir = cache,
                plateId = 1,
                filamentColours = listOf("#888888"),
                // Reproduce stale upstream slot config that yielded printer PLA.
                filamentTypes = listOf("PLA"),
            ) as SliceArtifact.BambuProjectArtifact
            ZipFile(artifact.projectFile).use { zip ->
                fun read(name: String) = zip.getInputStream(zip.getEntry(name)).bufferedReader().readText()
                val config=JSONObject(read("Metadata/project_settings.config"))
                assertEquals("PETG", config.getJSONArray("filament_type").getString(0))
                assertEquals(1, config.getJSONArray("filament_type").length())
                assertTrue(read("Metadata/slice_info.config").contains("type=\"PETG\""))
                assertTrue(read("Metadata/plate_1.gcode").contains("M1002 set_filament_type:PETG"))
                NightPrintA1MiniMaterialPacket.verifyPackagedProject(artifact.projectFile,"PETG",1)
            }
        } finally { cache.deleteRecursively() }
    }

    @Test fun rejectsConflictingGcodeRatherThanPrinting() {
        val file = File.createTempFile("nightprint-v401-conflict", ".gcode")
        try {
            file.writeText(source("PETG","PLA"))
            try {
                NightPrintA1MiniMaterialPacket.verifyGcodeAndResolveSingleMaterial(file)
                fail("Firmware would see conflicting PLA/PETG; must block")
            } catch (expected: IllegalStateException) {
                assertTrue(expected.message!!.contains("一致しません"))
            }
        } finally { file.delete() }
    }

    @Test fun rejectsMissingExecutableFilamentTypeCommand() {
        val file = File.createTempFile("nightprint-v401-missing", ".gcode")
        try {
            file.writeText(source("PETG","PETG").replace("M1002 set_filament_type:PETG", ""))
            try {
                NightPrintA1MiniMaterialPacket.verifyGcodeAndResolveSingleMaterial(file)
                fail("Missing material command must block")
            } catch (expected: IllegalStateException) {
                assertTrue(expected.message!!.contains("欠落"))
            }
        } finally { file.delete() }
    }
}
