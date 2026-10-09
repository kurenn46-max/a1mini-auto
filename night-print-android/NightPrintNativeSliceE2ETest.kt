package com.u1.slicer

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.u1.slicer.bambu.resolveTargetedSliceConfig
import com.u1.slicer.data.SliceConfig
import com.u1.slicer.slice.SlicerTarget
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Real native OrcaSlicer end-to-end regression. Requires ARM64 capable Android
 * device/emulator; only builds/tests G-code in local cache, NEVER sends/prints it.
 *
 * Reproduces the user's 20x24x20 ring with PETG/235C/40%/5 walls.
 * The guard checks EXECUTABLE pre-layer G-code, not rewritten footer comments.
 */
@RunWith(AndroidJUnit4::class)
class NightPrintNativeSliceE2ETest {
    private lateinit var native: NativeLibrary
    private lateinit var cache: File

    @Before fun setup() {
        assertTrue("Android ARM64 native slicer is required for actual G-code E2E", NativeLibrary.isLoaded)
        native = NativeLibrary()
        native.clearModel()
        cache = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "nightprint-e2e")
        cache.mkdirs()
    }

    @After fun tearDown() {
        native.clearModel()
        cache.deleteRecursively()
    }

    private fun fixture(name: String): File {
        val file = File(cache, name)
        InstrumentationRegistry.getInstrumentation().context.assets.open(name).use { input ->
            file.outputStream().use { output -> input.copyTo(output) }
        }
        return file
    }

    private fun checkedSlice(name: String, autoWrapStl: Boolean = false): String {
        val original = fixture(name)
        val model = if (autoWrapStl) {
            NightPrintStlTo3mf.wrap(
                original,
                File(cache, "automatically-profiled-ring.3mf"),
                NightPrintStlTo3mf.Settings(
                    filamentType = "PETG", nozzleC = 235, bedC = 65,
                    wallLoops = 5, fillDensityPercent = 40,
                    layerHeightMm = 0.20f, topLayers = 5, bottomLayers = 5,
                    infillPattern = "gyroid",
                ),
            )
        } else original
        assertTrue("Real native model load failed for $name", native.loadModel(model.absolutePath))
        val base = SliceConfig(
            layerHeight = 0.20f,
            firstLayerHeight = 0.20f,
            perimeters = 5,
            topSolidLayers = 5,
            bottomSolidLayers = 5,
            fillDensity = 0.40f,
            fillPattern = "gyroid",
            nozzleTemp = 235,
            bedTemp = 65,
            extruderCount = 1,
            filamentType = "PETG",
            filamentTypes = arrayOf("PETG"),
            extruderTemps = intArrayOf(235),
            filamentNozzleTempInitialLayers = intArrayOf(235),
            // The app should explicitly pass these material overrides for a
            // user-selected PETG spool, not rely on PLA target defaults.
            bambuExplicitOverrides =
                "|filament_type|nozzle_temperature|nozzle_temperature_initial_layer|" +
                "wall_loops|sparse_infill_density|sparse_infill_pattern|",
        )
        val targeted = resolveTargetedSliceConfig(SlicerTarget.BambuA1Mini, base)
        assertEquals("BAMBU_A1_MINI", targeted.machineTarget)
        assertEquals(180f, targeted.bedSizeX, 0.001f)
        assertEquals("PETG", targeted.filamentType)
        val slice = native.slice(targeted)
        assertNotNull("Native slice returned null for $name", slice)
        assertTrue("Native slice failed for $name: " + slice!!.errorMessage, slice.success)
        val generated = File(slice.gcodePath)
        assertTrue("Native did not create real G-code", generated.isFile && generated.length() > 1000L)
        // Preserve evidence even if assertions fail.
        val evidence = File(
            InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null),
            "nightprint-e2e-" + name.replace('.', '-') + ".gcode",
        )
        generated.copyTo(evidence, overwrite = true)
        val machineIssue = NightPrintGcodeGuard.checkA1MiniMachine(generated.absolutePath)
        val petgIssue = NightPrintGcodeGuard.checkA1MiniPetg(generated.absolutePath, 235)
        println("NIGHTPRINT_E2E input=$name generated=" + generated.length() + " bytes")
        println("NIGHTPRINT_E2E machine=" + (machineIssue ?: "PASS"))
        println("NIGHTPRINT_E2E petg=" + (petgIssue ?: "PASS"))
        println("NIGHTPRINT_E2E firstCommands=" +
            generated.useLines { it.filter { s ->
                s.trimStart().startsWith("M1002 set_filament_type:") ||
                s.trimStart().startsWith("M104 S") ||
                s.trimStart().startsWith("M109 S")
            }.take(22).toList().joinToString(" | ") })
        assertNull("WRONG A1 mini machine/bed for $name: $machineIssue", machineIssue)
        assertNull("UNSAFE PETG executable start code for $name: $petgIssue", petgIssue)
        val actualLayerCount = generated.useLines { lines ->
            lines.count { it.trim() == ";LAYER_CHANGE" }
        }
        println("NIGHTPRINT_E2E actualLayers=$actualLayerCount expected=100 input=$name")
        assertEquals("A 20mm ring at 0.20mm MUST produce 100 real layers", 100, actualLayerCount)
        assertNull("STL/3MF native G-code has missing or oversized 0.2mm layers",
            NightPrintGcodeGuard.checkA1MiniFixedLayers(
                generated.absolutePath, 0.2f, expectedLayerCount = 100))
        // Footer parameters matter for process reproduction, but are never
        // sufficient on their own to prove executable G-code is safe.
        val footer = generated.readText().takeLast(300_000)
        assertTrue("Missing 5-wall process setting for $name",
            footer.contains("; wall_loops = 5"))
        assertTrue("Missing 40% infill setting for $name",
            footer.contains("; sparse_infill_density = 40%"))
        assertTrue("Missing PETG filament profile for $name",
            footer.contains("; filament_type = PETG"))
        return slice.gcodePath
    }

    @Test fun a1MiniAutoWrappedRawStlUsesPetg235ExecutableStartup() {
        checkedSlice("nightprint_ring_20x24x20.stl", autoWrapStl = true)
    }

    @Test fun a1MiniPetgProfile3mfMustNeverUsePla220ExecutableStartup() {
        checkedSlice("nightprint_ring_petg235.3mf")
    }
}
