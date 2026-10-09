package com.u1.slicer

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.u1.slicer.slice.SlicerTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * App-path E2E: load a raw STL exactly like the Prepare screen, apply PETG
 * and print settings, then invoke the SAME public startSlicing() used by UI.
 *
 * The earlier V2.7 E2E called native.slice() directly on the converted 3MF
 * and missed a SECOND profile embed/220C temperature overwrite in ViewModel.
 * No simulated success: the actual output G-code must pass executable checks.
 * Does not pair, upload, heat, or send anything to a printer.
 */
@RunWith(AndroidJUnit4::class)
class NightPrintViewModelE2ETest {
    private fun waitUntil(phase: String, timeoutMillis: Long, test: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (System.currentTimeMillis() < deadline) {
            if (test()) return
            Thread.sleep(200)
        }
        fail("NIGHT PRINT $phase timed out after $timeoutMillis milliseconds")
    }

    @Test fun prepareFlowRawStlPetgMustProduceExecutable235C() {
        assertTrue(NativeLibrary.isLoaded)
        val ins = InstrumentationRegistry.getInstrumentation()
        val app = ins.targetContext.applicationContext as U1SlicerApplication
        lateinit var vm: SlicerViewModel
        ins.runOnMainSync { vm = SlicerViewModel(app) }

        waitUntil("offline A1 mini target", 30_000) {
            vm.effectiveSliceTarget.value == SlicerTarget.BambuA1Mini
        }
        val model = File(ins.targetContext.cacheDir, "nightprint_ui_flow_ring.stl")
        ins.context.assets.open("nightprint_ring_20x24x20.stl").use { input ->
            model.outputStream().use { output -> input.copyTo(output) }
        }
        try {
            ins.runOnMainSync { vm.loadModelFromFile(model) }
            waitUntil("raw STL loaded", 60_000) {
                when (vm.state.value) {
                    is SlicerViewModel.SlicerState.Error ->
                        fail("Model load failed: " + (vm.state.value as SlicerViewModel.SlicerState.Error).message)
                    is SlicerViewModel.SlicerState.ModelLoaded -> true
                    else -> false
                }
            }

            // Use the same public Prepare-screen overrides and configuration.
            ins.runOnMainSync {
                vm.updateConfig { cfg ->
                    cfg.copy(
                        filamentType = "PETG", nozzleTemp = 235, bedTemp = 65,
                        extruderCount = 1,
                        layerHeight = 0.20f, perimeters = 5,
                        topSolidLayers = 5, bottomSolidLayers = 5,
                        fillDensity = 0.40f, fillPattern = "gyroid",
                    )
                }
                vm.setFilamentMaterialOverride(0, "PETG")
                vm.startSlicing()
            }
            waitUntil("actual UI slicing", 180_000) {
                when (val s = vm.state.value) {
                    is SlicerViewModel.SlicerState.Error -> fail("Actual app slicing failed: " + s.message)
                    is SlicerViewModel.SlicerState.SliceComplete -> true
                    else -> false
                }
            }
            val state = vm.state.value as SlicerViewModel.SlicerState.SliceComplete
            val gcode = File(state.result.gcodePath)
            assertTrue("Actual UI did not save the G-code", gcode.isFile && gcode.length() > 1000L)
            val details = gcode.useLines { lines ->
                lines.filter { l ->
                    l.startsWith("M1002 set_filament_type:") ||
                    l.startsWith("M104 S") || l.startsWith("M109 S")
                }.take(24).joinToString(" | ")
            }
            println("NIGHT_PRINT_REAL_UI_GCODE_PATH=" + gcode.absolutePath)
            println("NIGHT_PRINT_REAL_UI_COMMANDS=" + details)
            assertNull(
                "Actual app produced the wrong A1 mini target",
                NightPrintGcodeGuard.checkA1MiniMachine(gcode.absolutePath)
            )
            assertNull(
                "Actual app produced unsafe PETG executable commands",
                NightPrintGcodeGuard.checkA1MiniPetg(gcode.absolutePath, 235)
            )
            val footer = gcode.readText().takeLast(300_000)
            assertTrue("Expected 40% infill", footer.contains("; sparse_infill_density = 40%"))
            assertTrue("Expected 5 wall loops", footer.contains("; wall_loops = 5"))
            assertTrue("Expected PETG filament", footer.contains("; filament_type = PETG"))
            assertEquals(SlicerTarget.BambuA1Mini, vm.effectiveSliceTarget.value)
            println("NIGHT_PRINT_REAL_UI_TEST_PASSED")
        } finally {
            model.delete()
        }
    }
}
