package com.u1.slicer

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.u1.slicer.data.SlicingOverrides
import com.u1.slicer.data.SliceConfig
import com.u1.slicer.slice.SlicerTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.round

/**
 * Every shape goes through the real app import -> ViewModel.startSlicing()
 * -> native Orca -> executable G-code, NOT a mocked slicing success.
 *
 * No printer connection, upload, heating or auto-print occurs.
 * A slicing success is NOT proof of real-world adhesion/strength/printability.
 */
@RunWith(AndroidJUnit4::class)
class NightPrintStressE2ETest {
    private fun waitFor(label: String, ms: Long = 180_000, ready: () -> Boolean) {
        val until = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < until) {
            if (ready()) return
            Thread.sleep(150)
        }
        fail("NIGHTPRINT_STRESS_TIMEOUT=" + label + " afterMs=" + ms)
    }

    private fun input(name: String): File {
        val ins = InstrumentationRegistry.getInstrumentation()
        val file = File(ins.targetContext.cacheDir, "nightprint_stress_" + name)
        ins.context.assets.open(name).use { src ->
            file.outputStream().use { dst -> src.copyTo(dst) }
        }
        return file
    }

    private fun digest(file: File): String =
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(file.readBytes()).joinToString("") { "%02x".format(it) }

    private fun checked(
        name: String, layer: Float, height: Float,
        walls: Int, infill: Int, pattern: String,
        top: Int, bottom: Int,
    ) {
        assertTrue(NativeLibrary.isLoaded)
        val ins = InstrumentationRegistry.getInstrumentation()
        val app = ins.targetContext.applicationContext as U1SlicerApplication
        val model = input(name)
        val originalHash = digest(model)
        val expectedMaterial = NightPrintImported3mfProfile.read(model)
        assertNotNull("3MF does not contain a verified PETG source profile",expectedMaterial)
        assertEquals(235,expectedMaterial!!.nozzleC)
        assertEquals(65,expectedMaterial.bedC)
        lateinit var vm: SlicerViewModel
        ins.runOnMainSync { vm = SlicerViewModel(app) }
        waitFor("offline A1 mini target",30_000) {
            vm.effectiveSliceTarget.value == SlicerTarget.BambuA1Mini
        }
        try {
            val begin = System.currentTimeMillis()
            ins.runOnMainSync { vm.loadModelFromFile(model) }
            waitFor("model load " + name,90_000) {
                when (val state = vm.state.value) {
                    is SlicerViewModel.SlicerState.ModelLoaded -> true
                    is SlicerViewModel.SlicerState.Error ->
                        throw AssertionError("Model load failed: " + state.message)
                    else -> false
                }
            }
            val loaded = System.currentTimeMillis()
            assertEquals("Imported PETG nozzle was overwritten",235,vm.config.value.nozzleTemp)
            assertEquals("Imported PETG type was overwritten","PETG",vm.config.value.filamentType)
            // Never press NIGHT settings: each 3MF is the process source of truth.
            waitFor("source 3MF owns process",30_000) {
                vm.slicingOverrides.value.layerHeight.mode ==
                    com.u1.slicer.data.OverrideMode.USE_FILE
            }
            ins.runOnMainSync { vm.startSlicing() }
            waitFor("native slice " + name,180_000) {
                when (val state = vm.state.value) {
                    is SlicerViewModel.SlicerState.SliceComplete -> true
                    is SlicerViewModel.SlicerState.Error ->
                        throw AssertionError("Native slice failed: " + state.message)
                    else -> false
                }
            }
            val finished = System.currentTimeMillis()
            val gcode = File((vm.state.value as SlicerViewModel.SlicerState.SliceComplete)
                .result.gcodePath)
            assertTrue("No native G-code output",gcode.isFile && gcode.length()>1000)
            // Preserve actual executable evidence for review, not just green UI.
            val evidence = File(ins.targetContext.getExternalFilesDir(null),
                "nightprint_stress_" + name.replace(".3mf",".gcode"))
            gcode.copyTo(evidence,overwrite=true)
            val expectedLayers = round(height/layer).toInt()
            assertNull("Actual Z-layer corruption",
                NightPrintGcodeGuard.checkA1MiniFixedLayers(
                    gcode.absolutePath,layer,expectedLayerCount=expectedLayers))
            assertNull("Wrong A1 mini target",
                NightPrintGcodeGuard.checkA1MiniMachine(gcode.absolutePath))
            assertNull("Executable PETG 235C mismatch",
                NightPrintGcodeGuard.checkA1MiniPetg(gcode.absolutePath,235))
            assertNull("Embedded source settings mismatch native G-code",
                NightPrint3mfProcess.checkOutput(model,gcode.absolutePath))
            val audit = NightPrintGcodeDepositionGuard.audit(gcode.absolutePath)
            assertNull("Unsafe/outside-bed extrusion or an empty printed layer",audit.issue)
            val metrics=audit.metrics
            assertNotNull("G-code deposition metrics unavailable",metrics)
            assertEquals("Wrong deposition layer count",expectedLayers,metrics!!.layerCount)
            val footer=gcode.readText().takeLast(300_000)
            assertTrue(footer.contains("; wall_loops = " + walls))
            assertTrue(footer.contains("; sparse_infill_density = " + infill + "%"))
            assertTrue(footer.contains("; sparse_infill_pattern = " + pattern))
            assertTrue(footer.contains("; top_shell_layers = " + top))
            assertTrue(footer.contains("; bottom_shell_layers = " + bottom))
            assertTrue(footer.contains("; filament_type = PETG"))
            // Unlike legacy fixture's density=0, explicitly configured PETG
            // density must remain meaningful for weight/consumption estimates.
            val density = footer.lineSequence().lastOrNull {
                it.startsWith("; filament_density = ")
            }?.substringAfter(" = ")?.toDoubleOrNull()
            assertTrue("PETG density from project was lost (weight is unreliable)",
                density != null && density > 1.0 && density < 1.5)
            assertEquals("Input 3MF was changed",originalHash,digest(model))
            println("NIGHTPRINT_STRESS_PASS input=" + name +
                " layers=" + expectedLayers +
                " loadMs=" + (loaded-begin) + " sliceMs=" + (finished-loaded) +
                " gcodeBytes=" + gcode.length() +
                " depositionMoves=" + metrics.depositionMoves +
                " xyBounds=[" + metrics.minX + "," + metrics.minY + "," +
                metrics.maxX + "," + metrics.maxY + "]")
        } finally { model.delete() }
    }

    @Test fun solidPrismFlatRoof() =
        checked("nightprint_shape_solid_cube_petg235.3mf",.20f,12f,3,20,"rectilinear",4,4)

    @Test fun concaveLBracketInternalCorners() =
        checked("nightprint_shape_l_bracket_petg235.3mf",.20f,10f,4,30,"gyroid",4,4)

    @Test fun smallCircularThroughHolePlate() =
        checked("nightprint_shape_round_hole_plate_petg235.3mf",.20f,5f,3,35,"grid",3,3)

    @Test fun fineLayerThinWallOpenTube() =
        checked("nightprint_shape_thin_wall_tube_petg235.3mf",.16f,12.8f,2,15,"gyroid",3,3)

    @Test fun topCantileverAndOverhang() =
        checked("nightprint_shape_cantilever_T_petg235.3mf",.20f,16f,4,25,"cubic",4,4)

    @Test fun taperedSolidChangingCrossSection() =
        checked("nightprint_shape_taper_frustum_petg235.3mf",.24f,12f,3,25,"rectilinear",4,4)

    @Test fun twoIndependentPartsSingle3mf() =
        checked("nightprint_shape_two_objects_petg235.3mf",.20f,12f,3,25,"grid",4,4)

    @Test fun rejectCorruptPlaAndMismatchedMaterialProfile() {
        for (name in listOf(
            "nightprint_bad_pla.3mf",
            "nightprint_bad_heat_mismatch.3mf",
            "nightprint_bad_missing_profile.3mf",
            "nightprint_bad_invalid_zip.3mf"
        )) {
            val file=input(name)
            try {
                assertNull("Unsafe source was accepted: " + name,
                    NightPrintImported3mfProfile.read(file))
                println("NIGHTPRINT_STRESS_REJECTED=" + name)
            } finally { file.delete() }
        }
    }

    @Test fun pathTraversalArchiveMustBeRejectedWithNoOverrides() {
        val malicious=input("nightprint_bad_path_traversal.3mf")
        val output=File(malicious.parentFile,"nightprint_stress_no_write.3mf")
        // Ensure the NEGATIVE fixture truly has a traversal entry.
        val maliciousEntries = java.util.zip.ZipFile(malicious).use { zip ->
            zip.entries().toList().map { it.name }
        }
        assertTrue("Test fixture lost its ../ entry",
            maliciousEntries.any { it.split('/').contains("..") })
        println("NIGHTPRINT_STRESS_TRAVERSAL_ENTRIES=" + maliciousEntries)
        output.delete()
        var rejected=false
        try {
            try {
                NightPrint3mfProcess.prepare(
                    malicious,output,SlicingOverrides(),SliceConfig())
            } catch (_: IllegalArgumentException) {
                rejected=true
            } catch (_: IllegalStateException) {
                rejected=true
            }
            assertTrue("ZIP path traversal was accepted by process loader",rejected)
            assertFalse("Malformed 3MF produced output",output.exists())
            println("NIGHTPRINT_STRESS_REJECTED=path_traversal")
        } finally {
            malicious.delete()
            output.delete()
        }
    }
}
