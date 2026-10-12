package com.u1.slicer

import com.u1.slicer.data.OverrideMode
import com.u1.slicer.data.OverrideValue
import com.u1.slicer.data.SlicingOverrides
import org.junit.Assert.*
import org.junit.Test

class NightPrintSupportModesTest {
    @Test fun standardRestoresImported3mfSettings() {
        val previous = NightPrintSupportModes.apply(NightPrintSupportLevel.LIGHT, SlicingOverrides())
        val normal = NightPrintSupportModes.apply(NightPrintSupportLevel.STANDARD, previous)
        assertEquals(OverrideMode.USE_FILE, normal.supports.mode)
        assertEquals(OverrideMode.USE_FILE, normal.supportAngle.mode)
        assertEquals(OverrideMode.USE_FILE, normal.supportBuildPlateOnly.mode)
        assertEquals(OverrideMode.USE_FILE, normal.supportPatternSpacing.mode)
    }

    @Test fun lightSupportIsActuallyEnabledWithTreeAnd55Degrees() {
        val output = NightPrintSupportModes.apply(NightPrintSupportLevel.LIGHT, SlicingOverrides())
        assertEquals(OverrideValue(OverrideMode.OVERRIDE, true), output.supports)
        assertEquals(OverrideValue(OverrideMode.OVERRIDE, "tree(auto)"), output.supportType)
        assertEquals(OverrideValue(OverrideMode.OVERRIDE, 55), output.supportAngle)
        assertEquals(OverrideValue(OverrideMode.OVERRIDE, true), output.supportBuildPlateOnly)
        assertEquals(OverrideValue(OverrideMode.OVERRIDE, 4.0f), output.supportPatternSpacing)
        assertEquals(OverrideValue(OverrideMode.OVERRIDE, 0.50f), output.supportXyDistance)
    }

    @Test fun noneDisablesSupport() {
        val output = NightPrintSupportModes.apply(NightPrintSupportLevel.NONE, SlicingOverrides())
        assertEquals(OverrideValue(OverrideMode.OVERRIDE, false), output.supports)
    }

    @Test fun strongUsesMoreConservativeAngleAndSpacing() {
        val output = NightPrintSupportModes.apply(NightPrintSupportLevel.STRONG, SlicingOverrides())
        assertEquals(OverrideValue(OverrideMode.OVERRIDE, 35), output.supportAngle)
        assertEquals(OverrideValue(OverrideMode.OVERRIDE, 2.5f), output.supportPatternSpacing)
        assertEquals(OverrideValue(OverrideMode.OVERRIDE, false), output.supportBuildPlateOnly)
    }

    @Test fun supportModeDoesNotAlterMaterialOrOtherProcessSettings() {
        val old = SlicingOverrides(
            wallCount = OverrideValue(OverrideMode.OVERRIDE, 5),
            infillDensity = OverrideValue(OverrideMode.OVERRIDE, 0.4f),
            bedTemp = OverrideValue(OverrideMode.OVERRIDE, 65)
        )
        NightPrintSupportLevel.entries.forEach { mode ->
            val updated = NightPrintSupportModes.apply(mode, old)
            assertEquals(old.wallCount, updated.wallCount)
            assertEquals(old.infillDensity, updated.infillDensity)
            assertEquals(old.bedTemp, updated.bedTemp)
        }
    }
}
