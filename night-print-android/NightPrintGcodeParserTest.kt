package com.u1.slicer.gcode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * NIGHT PRINT regression: G-code preview must show PRINTED layer heights,
 * never nozzle Z hops, pre-print purge or end-of-job parking.
 * Neither the G-code generator nor printer commands are modified.
 */
class NightPrintGcodeParserTest {
    private fun withGcode(gcode: String, check: (ParsedGcode) -> Unit) {
        val file = File.createTempFile("nightprint-gcode-preview", ".gcode")
        try {
            file.writeText(gcode.trimIndent() + "\n")
            check(GcodeParser.parse(file))
        } finally {
            file.delete()
        }
    }

    @Test
    fun slicerLayerMarkersIgnorePurgeZHopAndFinalParking() = withGcode(
        """
        G90
        M83
        G1 Z5.0
        G1 X10 Y10 E1.0
        ;LAYER_CHANGE
        ;Z:0.2
        G1 Z0.2
        G1 X20 Y20 E1.0
        G1 Z0.6
        G1 X21 Y21
        G1 Z0.2
        ;LAYER_CHANGE
        ;Z:0.4
        G1 Z0.4
        G1 X22 Y22 E1.0
        G1 Z150.4
        G1 Z148.4
        G1 X25 Y25
        """
    ) { actual ->
        assertEquals(2, actual.layers.size)
        assertEquals(0.2f, actual.layers[0].z, 0.0001f)
        assertEquals(0.4f, actual.layers[1].z, 0.0001f)
    }

    @Test
    fun withoutLayerMarkersCountOnlyNewExtrusionHeights() = withGcode(
        """
        G90
        M83
        G1 Z0.2
        G1 X1 Y1 E0.1
        G1 Z0.6
        G1 X2 Y2
        G1 Z0.2
        G1 X3 Y3 E0.1
        G1 Z0.4
        G1 X4 Y4 E0.1
        G1 Z10.0
        G1 X8 Y8
        """
    ) { actual ->
        assertEquals(2, actual.layers.size)
        assertEquals(0.2f, actual.layers[0].z, 0.0001f)
        assertEquals(0.4f, actual.layers[1].z, 0.0001f)
    }

    @Test
    fun travelOnlyGcodeHasNoPrintableLayers() = withGcode(
        """
        G90
        G1 Z20
        G1 X10 Y10
        G1 Z140
        G1 X15 Y15
        """
    ) { actual ->
        assertTrue(actual.layers.isEmpty())
    }
}
