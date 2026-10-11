package com.u1.slicer

import android.graphics.Bitmap
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
 * Phase 2 of the V3.4.2 release gate.
 *
 * Runs in a new app process AFTER the preview phase has sliced a real 3MF
 * into an actual saved job. A fresh process avoids traversing the large
 * 3D Preview semantics tree just to tap the Jobs tab.
 *
 * Never sends a file, pairs a printer, heats a nozzle or presses Print.
 */
@RunWith(AndroidJUnit4::class)
class NightPrintHistoryUiE2ETest {
    @get:Rule val screen = createAndroidComposeRule<MainActivity>()
    private val ins get() = InstrumentationRegistry.getInstrumentation()

    private fun containsText(text: String): Boolean = runCatching {
        screen.onAllNodesWithText(text, substring = true)
            .fetchSemanticsNodes().isNotEmpty()
    }.getOrDefault(false)

    private fun awaitText(text: String, ms: Long = 30_000L) {
        screen.waitUntil(ms) { containsText(text) }
    }

    private fun screenshot(step: String) {
        val shot = ins.uiAutomation.takeScreenshot()
            ?: throw AssertionError("Could not capture UI screenshot: $step")
        val base = File(ins.targetContext.getExternalFilesDir(null),
            "nightprint_visual_ui_evidence")
        require(base.isDirectory || base.mkdirs())
        val file = File(base, "ui_$step.png")
        FileOutputStream(file).use { out ->
            check(shot.compress(Bitmap.CompressFormat.PNG, 100, out))
        }
        shot.recycle()
        assertTrue("Empty screenshot: $step", file.length() > 2000L)
        println("NIGHT_PRINT_UI_SCREENSHOT=" + file.absolutePath)
    }

    @Test fun persistedRealPetgJobShows100Layers20PercentAndSwipe() {
        var stage = "fresh-history-launch"
        try {
            println("NIGHT_PRINT_UI_STAGE=" + stage)
            // Preview test persisted its job to Room. This second process
            // must read that REAL job, not an in-memory mock or fixture.
            awaitText("Jobs", 45_000L)
            screenshot("05_fresh_activity_before_jobs")
            stage = "tap-jobs"
            println("NIGHT_PRINT_UI_STAGE=" + stage)
            screen.onNodeWithText("Jobs", substring = true).performClick()
            stage = "history-visible"
            println("NIGHT_PRINT_UI_STAGE=" + stage)
            awaitText("Job History", 30_000L)
            screenshot("05_jobs_header_before_value_wait")
            stage = "history-values"
            println("NIGHT_PRINT_UI_STAGE=" + stage)
            screen.waitUntil(45_000L) {
                containsText("100") && containsText("20%") && containsText("PETG")
            }
            assertTrue("History incorrectly shows 15% for the saved PETG ring",
                !containsText("15%"))
            screenshot("05_jobs_100layers_20pct_petg")

            // Actual gesture; do not mistake a screenshot or unit test for a swipe.
            stage = "history-swipe"
            println("NIGHT_PRINT_UI_STAGE=" + stage)
            screen.onRoot().performTouchInput { swipeUp() }
            awaitText("Job History", 15_000L)
            screenshot("06_jobs_after_swipe")
            println("NIGHT_PRINT_HISTORY_UI_GATE_PASS")
        } catch (err: Throwable) {
            println("NIGHT_PRINT_UI_FAILED_AT=" + stage + " error=" + err)
            runCatching { screenshot("FAIL_" + stage) }
            throw err
        }
    }
}
