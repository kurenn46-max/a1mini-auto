package com.u1.slicer

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

/**
 * Real visible UI, not ViewModel or mocked screen:
 *
 * Launch actual MainActivity -> ACTION_VIEW 3MF -> tap Slice Model ->
 * Preview -> tap Jobs -> swipe -> verify displayed 100 layers, 20% and PETG.
 * Captures PNG screenshots in app external files to be pulled by CI.
 *
 * NEVER taps Map & Print, Upload Only or Start Print. No physical printer
 * connection, filament loading, network upload, heater or print start.
 */
@RunWith(AndroidJUnit4::class)
class NightPrintVisualUiE2ETest {
    @get:Rule val screen = createAndroidComposeRule<MainActivity>()

    private val ins get() = InstrumentationRegistry.getInstrumentation()

    private fun containsText(text: String): Boolean = runCatching {
        screen.onAllNodesWithText(text, substring = true)
            .fetchSemanticsNodes().isNotEmpty()
    }.getOrDefault(false)

    private fun awaitText(name: String, ms: Long = 180_000L) {
        screen.waitUntil(ms) { containsText(name) }
    }

    private fun screenshot(step: String) {
        val shot = ins.uiAutomation.takeScreenshot()
            ?: throw AssertionError("Could not capture UI screenshot: $step")
        val base = File(
            ins.targetContext.getExternalFilesDir(null),
            "nightprint_visual_ui_evidence"
        )
        require(base.isDirectory || base.mkdirs())
        val file = File(base, "ui_$step.png")
        FileOutputStream(file).use { stream ->
            check(shot.compress(Bitmap.CompressFormat.PNG, 100, stream))
        }
        shot.recycle()
        assertTrue("Empty screenshot: $step", file.length() > 2000L)
        println("NIGHT_PRINT_UI_SCREENSHOT=" + file.absolutePath)
    }

    private fun tapText(text: String) {
        awaitText(text, 20_000L)
        screen.onNodeWithText(text, substring = true).performClick()
    }

    @Test fun actualPetgRingShowsCorrectPreviewAndSavedHistory() {
        val model = File(
            ins.targetContext.cacheDir,
            "nightprint_ui_ring_petg235_20pct_100layers.3mf"
        )
        ins.context.assets.open(model.name).use { source ->
            model.outputStream().use { output -> source.copyTo(output) }
        }
        try {
            awaitText("Prepare", 60_000L)
            screenshot("01_home")

            // Drive the same ACTION_VIEW import that Android Files uses;
            // the user-visible MainActivity handles this intent itself.
            // MainActivity.onNewIntent is protected; launch it via Android
            // ActivityManager, same route as a real Files-app ACTION_VIEW.
            // MainActivity is singleTask so this delivers onNewIntent.
            ins.targetContext.startActivity(
                Intent(ins.targetContext, MainActivity::class.java).apply {
                    action = Intent.ACTION_VIEW
                    setDataAndType(Uri.fromFile(model), "model/3mf")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                }
            )
            awaitText("Slice Model", 90_000L)
            screenshot("02_prepare_petg_ring")

            // Simulates user actually tapping the Compose button.
            tapText("Slice Model")
            awaitText("Slice Summary", 240_000L)
            screenshot("03_preview_after_real_native_slice")

            // Wait until async metadata reconciler, not legacy PLA slot
            // presets, owns material label.
            screen.waitUntil(30_000L) {
                containsText("Filament 1 · PETG")
            }
            assertTrue(
                "Preview still shows PLA for the PETG 235C ring",
                !containsText("Filament 1 · PLA")
            )
            assertTrue("Preview has no 100-layer evidence", containsText("100"))
            screenshot("04_preview_petg_metadata_verified")

            tapText("Jobs")
            awaitText("Job History", 30_000L)
            screen.waitUntil(45_000L) {
                containsText("100") && containsText("20%") && containsText("PETG")
            }
            assertTrue("Job History still incorrectly shows 15% infill", !containsText("15%"))
            screenshot("05_jobs_100layers_20pct_petg")
            // Real touchscreen gesture, to catch broken scrolling/navigation.
            screen.onRoot().performTouchInput { swipeUp() }
            awaitText("Job History", 10_000L)
            screenshot("06_jobs_after_swipe")
            println("NIGHT_PRINT_VISIBLE_UI_GATE_PASS")
        } catch (err: Throwable) {
            runCatching { screenshot("FAIL") }
            throw err
        } finally {
            model.delete()
        }
    }
}
