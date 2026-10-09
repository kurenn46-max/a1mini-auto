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

    // Exercise the SAME Android Prepare-screen path for both input formats.
    // A native-only 3MF test previously missed the user's real 220C error.
    private fun checkedPrepareFlow(
        fixtureName: String,
        configureMaterial: Boolean = true,
        applyNightPreset: Boolean = true,
        expectedLayerMm: Float = 0.20f,
        expectedWalls: Int = 5,
        expectedInfill: Int = 40,
        expectedTop: Int = 5,
        expectedBottom: Int = 5,
        expectedPattern: String = "gyroid",
        seedPreviousModelPreset: Boolean = false
    ) {
        assertTrue(NativeLibrary.isLoaded)
        val ins = InstrumentationRegistry.getInstrumentation()
        val app = ins.targetContext.applicationContext as U1SlicerApplication
        lateinit var vm: SlicerViewModel
        ins.runOnMainSync { vm = SlicerViewModel(app) }

        waitUntil("offline A1 mini target", 30_000) {
            vm.effectiveSliceTarget.value == SlicerTarget.BambuA1Mini
        }
        if (seedPreviousModelPreset) {
            val old = NightPrintPreset.parse(
                """{"schema":"nightprint/v1","name":"以前のモデル",
                "layer_height":0.20,"wall_loops":5,"sparse_infill_density":40,
                "top_shell_layers":5,"bottom_shell_layers":5,
                "sparse_infill_pattern":"gyroid"}""".trimIndent()
            )
            ins.runOnMainSync {
                vm.saveSlicingOverrides(old.applyTo(vm.slicingOverrides.value))
            }
            waitUntil("old NIGHT profile is actually persisted", 30_000) {
                val ov = vm.slicingOverrides.value
                ov.wallCount.value == 5 &&
                    ov.wallCount.mode == com.u1.slicer.data.OverrideMode.OVERRIDE &&
                    ov.layerHeight.mode == com.u1.slicer.data.OverrideMode.OVERRIDE
            }
        }
        val model = File(ins.targetContext.cacheDir, "nightprint_ui_flow_" + fixtureName)
        ins.context.assets.open(fixtureName).use { input ->
            model.outputStream().use { output -> input.copyTo(output) }
        }
        try {
            ins.runOnMainSync { vm.loadModelFromFile(model) }
            waitUntil("raw STL loaded", 60_000) {
                when (vm.state.value) {
                    is SlicerViewModel.SlicerState.Error ->
                        throw AssertionError("Model load failed: " + (vm.state.value as SlicerViewModel.SlicerState.Error).message)
                    is SlicerViewModel.SlicerState.ModelLoaded -> true
                    else -> false
                }
            }

            // The real phone imports a configured PETG 3MF WITHOUT calling
            // updateConfig() or selecting a PETG spool first. Verify state
            // BEFORE any NIGHT process preset or native slice.
            if (!configureMaterial) {
                assertEquals("Imported 3MF must set material without UI override",
                    "PETG", vm.config.value.filamentType)
                assertEquals("Imported 3MF must set nozzle without UI override",
                    235, vm.config.value.nozzleTemp)
                assertEquals("Imported 3MF must set bed without UI override",
                    65, vm.config.value.bedTemp)
            }
            // Use the same public Prepare-screen process preset.
            ins.runOnMainSync {
                if (configureMaterial) {
                    vm.updateConfig { cfg ->
                        cfg.copy(filamentType = "PETG", nozzleTemp = 235, bedTemp = 65, extruderCount = 1)
                    }
                    vm.setFilamentMaterialOverride(0, "PETG")
                }
                // For real user imported 3MF, never pre-seed material/temperature.
                // The original project_settings.config MUST be authoritative.
                if (!applyNightPreset && !seedPreviousModelPreset) {
                    // Control case: fresh settings, no old preset.
                    vm.saveSlicingOverrides(com.u1.slicer.data.SlicingOverrides())
                } else if (applyNightPreset) {
                    // EXACT public path used by NIGHT's '設定を反映' button:
                    val preset = NightPrintPreset.parse(
                    """{"schema":"nightprint/v1","name":"岡ちゃん標準・確実",
                    "layer_height":0.20,"wall_loops":5,
                    "sparse_infill_density":40,"top_shell_layers":5,
                    "bottom_shell_layers":5,"sparse_infill_pattern":"gyroid"}""".trimIndent()
                )
                    vm.saveSlicingOverrides(preset.applyTo(vm.slicingOverrides.value))
                }
            }
            if (applyNightPreset) {
                waitUntil("NIGHT settings persisted", 30_000) {
                    val ov = vm.slicingOverrides.value
                    ov.wallCount.value == 5 && (ov.infillDensity.value ?: 0f) > 0.395f
                }
            } else {
                waitUntil("original 3MF process remains in USE_FILE mode", 30_000) {
                    val ov = vm.slicingOverrides.value
                    ov.wallCount.mode == com.u1.slicer.data.OverrideMode.USE_FILE &&
                        ov.infillDensity.mode == com.u1.slicer.data.OverrideMode.USE_FILE &&
                        ov.layerHeight.mode == com.u1.slicer.data.OverrideMode.USE_FILE
                }
            }
            ins.runOnMainSync { vm.startSlicing() }
            waitUntil("actual UI slicing", 180_000) {
                when (val s = vm.state.value) {
                    is SlicerViewModel.SlicerState.Error -> throw AssertionError("Actual app slicing failed: " + s.message)
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
            println("NIGHT_PRINT_REAL_UI_INPUT=" + fixtureName)
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
            assertTrue("Expected ${expectedInfill}% infill", footer.contains("; sparse_infill_density = ${expectedInfill}%"))
            assertTrue("Expected top layers", footer.contains("; top_shell_layers = ${expectedTop}"))
            assertTrue("Expected bottom layers", footer.contains("; bottom_shell_layers = ${expectedBottom}"))
            assertTrue("Expected infill pattern", footer.contains("; sparse_infill_pattern = ${expectedPattern}"))
            assertTrue("Expected layer height", footer.contains("; layer_height = ${expectedLayerMm}"))
            val actualLayerCount = gcode.useLines { lines ->
                lines.count { it.trim() == ";LAYER_CHANGE" }
            }
            val expectedLayers = kotlin.math.round(20f / expectedLayerMm).toInt()
            println("NIGHT_PRINT_REAL_UI_LAYERS=$actualLayerCount expected=$expectedLayers input=$fixtureName")
            assertEquals("Real layers must match 20mm/model print profile", expectedLayers, actualLayerCount)
            assertNull("Actual Prepare-flow G-code has skipped layers",
                NightPrintGcodeGuard.checkA1MiniFixedLayers(
                    gcode.absolutePath, expectedLayerMm, expectedLayerCount = expectedLayers))
            assertTrue("Expected ${expectedWalls} wall loops", footer.contains("; wall_loops = ${expectedWalls}"))
            assertTrue("Expected PETG filament", footer.contains("; filament_type = PETG"))
            assertEquals(SlicerTarget.BambuA1Mini, vm.effectiveSliceTarget.value)
            println("NIGHT_PRINT_REAL_UI_TEST_PASSED")
        } finally {
            model.delete()
        }
    }

    @Test fun prepareFlowRawStlPetgMustProduceExecutable235C() {
        checkedPrepareFlow("nightprint_ring_20x24x20.stl")
    }

    @Test fun prepareFlowImported3mfPetgMustProduceExecutable235C() {
        checkedPrepareFlow("nightprint_ring_petg235.3mf")
    }

    @Test fun freshInstallImported3mfUsesEmbeddedPetg235WithoutConfigOverrides() {
        // Regression for the actual V3.0 phone failure: importing PETG 235C
        // must NOT require the user to manually change PLA/220C to PETG.
        checkedPrepareFlow("nightprint_ring_petg235.3mf", configureMaterial = false)
    }

    @Test fun plain3mfImportWithoutAnyManualPresetMustHonorEmbeddedProcessAndPetg() {
        checkedPrepareFlow("nightprint_ring_petg235.3mf",
            configureMaterial = false, applyNightPreset = false)
    }

    @Test fun importedFine3mfMustUse016mm4Walls25PercentCubicWithoutNightSetting() {
        checkedPrepareFlow("nightprint_ring_petg235_fine016_4w_25cubic.3mf",
            configureMaterial = false, applyNightPreset = false,
            expectedLayerMm = 0.16f, expectedWalls = 4, expectedInfill = 25,
            expectedTop = 6, expectedBottom = 4, expectedPattern = "cubic")
    }

    @Test fun importedFine3mfWithPriorNightPresetMustPreservePetg235AndApplyOverrides() {
        // NIGHT settings applied AFTER loading the 3MF remain an explicit
        // print-process override. PETG 235C must still be preserved.
        checkedPrepareFlow("nightprint_ring_petg235_fine016_4w_25cubic.3mf",
            configureMaterial = false, applyNightPreset = true)
    }

    @Test fun new3mfMustClearStaleNightSettingsFromPreviouslyImportedModel() {
        // This is the phone workflow: NIGHT settings were applied to model A,
        // then user opens model B, a 0.16mm/25% 3MF. Only B's settings should
        // apply; no "NIGHT Settings" button is pressed for model B.
        checkedPrepareFlow("nightprint_ring_petg235_fine016_4w_25cubic.3mf",
            configureMaterial = false, applyNightPreset = false,
            expectedLayerMm = 0.16f, expectedWalls = 4, expectedInfill = 25,
            expectedTop = 6, expectedBottom = 4, expectedPattern = "cubic",
            seedPreviousModelPreset = true)
    }
}
