package com.u1.slicer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NightPrintA1MiniMaterialBridgeTest {
    @Test fun resolvesPetgProfileUsedBySlicer() {
        val v = NightPrintA1MiniMaterialBridge.resolve(mapOf(
            "filament_type" to listOf("PETG"),
            "nozzle_temperature" to listOf("235")))
        assertEquals("PETG", v?.type)
        assertEquals(235, v?.nozzleC)
    }
    @Test fun preservesOtherFilamentSelections() {
        val v = NightPrintA1MiniMaterialBridge.resolve(mapOf(
            "filament_type" to listOf("TPU"),
            "nozzle_temperature" to listOf("220")))
        assertEquals("TPU", v?.type)
        assertEquals(220, v?.nozzleC)
    }
    @Test fun rejectsMissingMaterialOrTemperature() {
        assertNull(NightPrintA1MiniMaterialBridge.resolve(mapOf("filament_type" to listOf("PETG"))))
    }
    @Test fun rejectsOutOfRangeTemperature() {
        assertNull(NightPrintA1MiniMaterialBridge.resolve(mapOf(
            "filament_type" to listOf("PETG"),
            "nozzle_temperature" to listOf("700"))))
    }
}
