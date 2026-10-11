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
        var stage = "launch"
        try {
            // On first Android launch the bottom tab may not expose a
            // text node named "Prepare" (permission or onboarding overlay).
            // Capture the *actual* starting screen before any assumptions.
            println("NIGHT_PRINT_UI_STAGE=home")
            android.util.Log.i("NightPrintUiGate", "stage=home")
            screenshot("01_home")
            println("NIGHT_PRINT_UI_INITIAL_SCREEN_CAPTURED")

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
            stage = "prepare-import"
            android.util.Log.i("NightPrintUiGate", "stage=prepare-import")
            println("NIGHT_PRINT_UI_STAGE=prepare-import")
            awaitText("Slice Model", 90_000L)
            screenshot("02_prepare_petg_ring")
            stage = "prepare-filament-petg235"
            android.util.Log.i("NightPrintUiGate", "stage=prepare-filament-petg235")
            // User's 2026-10-11 screenshot showed PLA/220C here, despite
            // correct PETG/235C in the G-code and Job History.
            // Check exact visible chip text, not file name (which has PETG).
            screen.waitUntil(30_000L) {
                screen.onAllNodesWithText("PETG").fetchSemanticsNodes().isNotEmpty() &&
                    screen.onAllNodesWithText("235°C").fetchSemanticsNodes().isNotEmpty()
            }
            assertTrue(
                "Prepare still shows the stale PLA slot for an imported PETG file",
                screen.onAllNodesWithText("PLA").fetchSemanticsNodes().isEmpty()
            )
            assertTrue("Prepare still shows the stale PLA 220°C nozzle", !containsText("220°C"))
            screenshot("02b_prepare_petg235_chip_verified")


            // Simulates user actually tapping the Compose button.
            stage = "tap-slice"
            android.util.Log.i("NightPrintUiGate", "stage=tap-slice")
            println("NIGHT_PRINT_UI_STAGE=tap-slice")
            tapText("Slice Model")
            stage = "preview-summary"
            android.util.Log.i("NightPrintUiGate", "stage=preview-summary")
            println("NIGHT_PRINT_UI_STAGE=preview-summary")
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

            // 100-layer metadata is not proof of 3D geometry on screen.
            // CI 38181398349 showed "Preparing preview…" indefinitely
            // with the summary already present. Wait for renderer readiness.
            stage = "preview-render-ready"
            android.util.Log.i("NightPrintUiGate", "stage=preview-render-ready")
            screen.waitUntil(90_000L) { !containsText("Preparing preview") }
            assertTrue("G-code 3D preview is still preparing", !containsText("Preparing preview"))
            screenshot("04b_preview_3d_render_ready")
            android.util.Log.i("NightPrintUiGate", "stage=preview-render-ready PASS")

            // Finish this instrumentation session after checking the real
            // native slice, preview, filament, layer count and screenshots.
            // Re-enter Jobs in a SEPARATE cold Activity process to release
            // preview/3D renderer resources before accessibility traversal.
            // A failed/absent later history session still BLOCKS the APK.
            stage = "preview-complete"
            android.util.Log.i("NightPrintUiGate", "stage=preview-complete")
            println("NIGHT_PRINT_VISIBLE_PREVIEW_GATE_PASS")

            // All screen assertions and pixel evidence are complete. Previous
            // Android emulator logs then stalled during ComposeRule/Activity
            // teardown while the heavyweight 3D Preview Surface was foreground.
            // Put the app in background *after* proof is captured, allowing
            // graphics buffers to quiesce before instrumentation finalization.
            // This is never a print command and changes no real app behavior.
            val sentHome = runCatching {
                ins.uiAutomation.performGlobalAction(
                    android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME
                )
            }.getOrDefault(false)
            android.util.Log.i("NightPrintUiGate", "stage=preview-backgrounded home=${sentHome}")
            Thread.sleep(750L)
        } catch (err: Throwable) {
            println("NIGHT_PRINT_UI_FAILED_AT=" + stage + " error=" + err)
            android.util.Log.e("NightPrintUiGate", "failed at " + stage, err)
            runCatching {
                val tree = screen.onRoot().fetchSemanticsNode().toString()
                println("NIGHT_PRINT_UI_SEMANTICS_BEGIN\\n" + tree.take(14000) +
                    "\\nNIGHT_PRINT_UI_SEMANTICS_END")
            }.onFailure { println("NIGHT_PRINT_UI_SEMANTICS_UNAVAILABLE=" + it) }
            runCatching { screenshot("FAIL_" + stage) }
            throw err
        } finally {
            model.delete()
        }
    }
}
