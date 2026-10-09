package com.u1.slicer

import com.u1.slicer.data.OverrideMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import com.u1.slicer.data.SlicingOverrides

class NightPrintPresetTest {
    private val valid = """
        {"schema":"nightprint/v1","name":"岡ちゃん 強度優先","layer_height":0.2,
         "wall_loops":5,"sparse_infill_density":40,"top_shell_layers":5,
         "bottom_shell_layers":5,"sparse_infill_pattern":"gyroid"}
    """.trimIndent()

    @Test fun parsesAndAppliesAllProcessOverrides() {
        val p = NightPrintPreset.parse(valid)
        val ov = p.applyTo(SlicingOverrides())
        assertEquals(5, ov.wallCount.value)
        assertEquals(0.40f, ov.infillDensity.value!!, 0.0001f)
        assertEquals(0.20f, ov.layerHeight.value!!, 0.0001f)
        assertEquals(5, ov.topShellLayers.value)
        assertEquals(5, ov.bottomShellLayers.value)
        assertEquals(OverrideMode.OVERRIDE, ov.wallCount.mode)
        assertTrue(p.summary().contains("印刷開始はしません"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsWallCountBelowSafeMinimum() {
        NightPrintPreset.parse(valid.replace("\"wall_loops\":5", "\"wall_loops\":1"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnsupportedSchema() {
        NightPrintPreset.parse(valid.replace("nightprint/v1", "untrusted/v1"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnsupportedInfillPattern() {
        NightPrintPreset.parse(valid.replace("gyroid", "dangerous_unknown"))
    }
}
