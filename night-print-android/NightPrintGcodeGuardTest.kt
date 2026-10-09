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
