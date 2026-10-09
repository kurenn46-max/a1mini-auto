package com.u1.slicer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.ZipFile

class NightPrintStlTo3mfTest {
    private val settings = NightPrintStlTo3mf.Settings(
        filamentType = "PETG",
        nozzleC = 245,
        bedC = 65,
        wallLoops = 5,
        fillDensityPercent = 40,
        layerHeightMm = 0.20f,
        topLayers = 5,
        bottomLayers = 5,
        infillPattern = "gyroid",
    )

    private fun asciiTetrahedron(): String = buildString {
        append("solid test\n")
        val points = listOf(
            arrayOf("0 0 0", "1 0 0", "0 1 0"),
            arrayOf("0 0 0", "0 1 0", "0 0 1"),
            arrayOf("0 0 0", "0 0 1", "1 0 0"),
            arrayOf("1 0 0", "0 0 1", "0 1 0"),
        )
        for (tri in points) {
            append("facet normal 0 0 0\n outer loop\n")
            for (p in tri) append("vertex " + p + "\n")
            append(" endloop\nendfacet\n")
        }
        append("endsolid test\n")
    }

    private fun fixture(extension: String, body: ByteArray): File {
        val f = File.createTempFile("nightprint-convert-", extension)
        f.writeBytes(body)
        return f
    }

    @Test fun asciiStlPreservesGeometryAndEmbedsChosenPetgTemperature() {
        val stl = fixture(".stl", asciiTetrahedron().toByteArray())
        val out = File.createTempFile("nightprint-", ".3mf").apply { delete() }
        try {
            NightPrintStlTo3mf.wrap(stl, out, settings)
            ZipFile(out).use { zip ->
                assertTrue(zip.size() >= 4)
                val mesh = zip.getInputStream(zip.getEntry("3D/3dmodel.model")).bufferedReader().readText()
                val p = zip.getInputStream(zip.getEntry("Metadata/project_settings.config")).bufferedReader().readText()
                assertEquals(12, Regex("<vertex x=").findAll(mesh).count())
                assertEquals(4, Regex("<triangle v1=").findAll(mesh).count())
                assertTrue(mesh.contains("unit=\"millimeter\""))
                assertTrue(mesh.contains("x=\"1.0\""))
                assertTrue(p.contains("\"filament_type\":[\"PETG\"]"))
                assertTrue(p.contains("\"nozzle_temperature\":[\"245\"]"))
                assertTrue(p.contains("\"sparse_infill_density\":\"40%\""))
                assertTrue(p.contains("\"wall_loops\":\"5\""))
            }
        } finally { stl.delete(); out.delete() }
    }

    @Test fun binaryStlWithSolidHeaderStillParsesAsBinary() {
        val header = ByteArray(84)
        "solid definitely binary".toByteArray().copyInto(header)
        ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN).putInt(80, 4)
        val facet = ByteBuffer.allocate(50).order(ByteOrder.LITTLE_ENDIAN)
        facet.position(12)
        for (v in floatArrayOf(0f,0f,0f, 1f,0f,0f, 0f,1f,0f)) facet.putFloat(v)
        val stl = fixture(".stl", header + facet.array() + facet.array() + facet.array() + facet.array())
        val out = File.createTempFile("nightprint-bin-", ".3mf").apply { delete() }
        try {
            NightPrintStlTo3mf.wrap(stl, out, settings)
            ZipFile(out).use { zip ->
                val mesh = zip.getInputStream(zip.getEntry("3D/3dmodel.model")).bufferedReader().readText()
                assertEquals(12, Regex("<vertex x=").findAll(mesh).count())
                assertEquals(4, Regex("<triangle v1=").findAll(mesh).count())
            }
        } finally { stl.delete(); out.delete() }
    }

    @Test fun rejectsInvalidAndUnsafeTemperature() {
        val stl = fixture(".stl", asciiTetrahedron().toByteArray())
        val out = File.createTempFile("nightprint-invalid-", ".3mf").apply { delete() }
        try {
            var rejected = false
            try { NightPrintStlTo3mf.wrap(stl, out, settings.copy(nozzleC = 350)) }
            catch (_: IllegalArgumentException) { rejected = true }
            assertTrue(rejected)
            assertFalse(out.exists())
        } finally { stl.delete(); out.delete() }
    }
}
