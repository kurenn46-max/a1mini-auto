package com.u1.slicer

import java.io.File
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NightPrintGcodeGuardTest {
    private fun check(material: String, temp: Int): String? {
        val file = File.createTempFile("night-print-guard-", ".gcode")
        return try {
            file.writeText("""
                ; filament_type = PETG
                ; nozzle_temperature = 235
                M1002 set_filament_type:$material
                M104 S$temp
                ;LAYER_CHANGE
                G1 X10 Y10 E0.1
            """.trimIndent())
            NightPrintGcodeGuard.checkA1MiniPetg(file.absolutePath, 235)
        } finally {
            file.delete()
        }
    }

    @Test fun allowsMatchingPetgAndActualTemperature() {
        assertNull(check("PETG", 235))
    }

    @Test fun blocksWrongExecutableMaterialDespiteCorrectMetadata() {
        assertTrue(check("PLA", 235)!!.contains("PLA"))
    }

    @Test fun blocksWrongExecutableTemperatureDespiteCorrectMetadata() {
        assertTrue(check("PETG", 220)!!.contains("220"))
    }

    @Test fun acceptsA1MiniMachineMetadataAndBed() {
        val file = File.createTempFile("night-a1mini-", ".gcode")
        try {
            file.writeText("""
                ; printer_model = Bambu Lab A1 mini
                ; printable_area = 0x0,180x0,180x180,0x180
                M1002 set_filament_type:PETG
                M109 S235
                ;LAYER_CHANGE
            """.trimIndent())
            assertNull(NightPrintGcodeGuard.checkA1MiniMachine(file.absolutePath))
        } finally { file.delete() }
    }

    @Test fun rejectsSnapmakerMachineEvenIfPetgSelected() {
        val file = File.createTempFile("night-wrong-target-", ".gcode")
        try {
            file.writeText("""
                ; printer_model = Snapmaker U1
                ; bed_shape = 0x0,270x0,270x270,0x270
                M109 S235
                ;LAYER_CHANGE
            """.trimIndent())
            assertTrue(NightPrintGcodeGuard.checkA1MiniMachine(file.absolutePath)!!.contains("A1 mini"))
        } finally { file.delete() }
    }

    @Test fun blocksMissingFirstLayerMarker() {
        val file = File.createTempFile("night-print-missing-", ".gcode")
        try {
            file.writeText("M1002 set_filament_type:PETG\nM104 S235")
            assertTrue(NightPrintGcodeGuard.checkA1MiniPetg(file.absolutePath, 235)!!.contains("積層開始"))
        } finally {
            file.delete()
        }
    }
}
