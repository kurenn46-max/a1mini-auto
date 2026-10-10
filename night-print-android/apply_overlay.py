#!/usr/bin/env python3
"""Apply the NIGHT PRINT source overlay to a clean upstream checkout.

This is intentionally fail-closed: upstream refactors invalidate anchors and
stop the build instead of silently producing an unmodified APK.
"""
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(".").resolve()
overlay = Path(__file__).resolve().parent
java = root / "app/src/main/java/com/u1/slicer"

def patch(path, before, after):
    file = root / path
    text = file.read_text(encoding="utf-8")
    occurrences = text.count(before)
    if occurrences != 1:
        raise RuntimeError(f"{path}: expected one patch anchor; found {occurrences}: {before[:60]}")
    file.write_text(text.replace(before, after, 1), encoding="utf-8")
    print("Patched", path)

for src, dst in [
    ("NightPrintPreset.kt", java / "NightPrintPreset.kt"),
    ("NightPrintPresetTest.kt", root / "app/src/test/java/com/u1/slicer/NightPrintPresetTest.kt"),
    ("NightPrintGcodeParserTest.kt", root / "app/src/test/java/com/u1/slicer/gcode/NightPrintGcodeParserTest.kt")
]:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(overlay / src, dst)
    print("Installed", dst.relative_to(root))

patch("app/build.gradle",
    'applicationId "com.u1.slicer.orca"',
    'applicationId "com.u1.slicer.orca.nightprint"')

patch("app/src/main/AndroidManifest.xml",
    'android:label="@string/app_name"',
    'android:label="NIGHT PRINT 岡ちゃん"')

patch("app/src/main/AndroidManifest.xml",
    '            <!-- Known 3MF/STL MIME types — works with both content:// and file:// -->',
    '''            <!-- User-confirmed local NIGHT PRINT configuration handoff. -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="nightprint" android:host="apply" />
            </intent-filter>
            <!-- Known 3MF/STL MIME types — works with both content:// and file:// -->''')

patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '    private var pendingNavigateTo: String? = null',
    '''    private var pendingNavigateTo: String? = null
    // The external URL can only stage a proposed profile. Never auto-print.
    private var pendingNightPrintRaw by mutableStateOf<String?>(null)''')

patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''            Intent.ACTION_VIEW -> {
                intent.data?.let { uri ->
                    importIncomingModelUri(uri)
                    intent.action = null
                    intent.data = null
                }
            }''',
    '''            Intent.ACTION_VIEW -> {
                intent.data?.let { uri ->
                    if (uri.scheme == "nightprint" && uri.host == "apply") {
                        // The UI requires an explicit tap before changing any settings.
                        pendingNightPrintRaw = try {
                            uri.getQueryParameter("profile") ?: ""
                        } catch (_: Exception) { "" }
                    } else {
                        importIncomingModelUri(uri)
                    }
                    intent.action = null
                    intent.data = null
                }
            }''')

patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''        setContent {
            U1SlicerTheme {
                val navController = rememberNavController()''',
    '''        setContent {
            U1SlicerTheme {
                pendingNightPrintRaw?.let { raw ->
                    val preset = remember(raw) {
                        runCatching { NightPrintPreset.parse(raw) }.getOrNull()
                    }
                    AlertDialog(
                        onDismissRequest = { pendingNightPrintRaw = null },
                        title = { Text("ナイトの印刷設定") },
                        text = {
                            Text(preset?.summary()
                                ?: "設定形式が不正です。何も変更しません。")
                        },
                        confirmButton = {
                            if (preset != null) {
                                TextButton(onClick = {
                                    // Modifies the real native app's settings repository;
                                    // no G-code is sent to the printer by this action.
                                    viewModel.saveSlicingOverrides(
                                        preset.applyTo(viewModel.slicingOverrides.value)
                                    )
                                    pendingNightPrintRaw = null
                                }) { Text("設定を反映") }
                            }
                        },
                        dismissButton = {
                            TextButton(onClick = { pendingNightPrintRaw = null }) {
                                Text("キャンセル")
                            }
                        }
                    )
                }
                val navController = rememberNavController()''')

patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''    fun saveSlicingOverrides(overrides: SlicingOverrides) {
        if (lastModelInfo != null) profileNeedsReEmbed = true''',
    '''    fun saveSlicingOverrides(overrides: SlicingOverrides) {
        _sliceStale.value = true
        if (lastModelInfo != null) profileNeedsReEmbed = true''')

# Fix preview-layer accounting without changing generated G-code or slicing.
patch("app/src/main/java/com/u1/slicer/gcode/GcodeParser.kt",
    '''        var currentZ = 0f
        var layerIndex = 0''',
    '''        var currentZ = 0f
        // Printable Z is separate from physical nozzle position. Z hops and
        // end-of-print parking must not become display layers.
        var printLayerZ = 0f
        var hasPrintedOnLayer = false
        var sawLayerMarker = false
        var layerIndex = 0''')

patch("app/src/main/java/com/u1/slicer/gcode/GcodeParser.kt",
    '''                    if (startsWithAt(l, start, ";LAYER_CHANGE") || startsWithAt(l, start, "; layer_change")) {
                        if (currentMoves.isNotEmpty() || hasUnflushedMoves) {
                            layers.add(GcodeLayer(layerIndex++, currentZ, currentMoves.toList()))
                            currentMoves.clear()
                            hasUnflushedMoves = false
                        }
                    }''',
    '''                    if (startsWithAt(l, start, ";LAYER_CHANGE") || startsWithAt(l, start, "; layer_change")) {
                        // Slicer markers are authoritative. Drop pre-print purge
                        // moves at the FIRST marker. Later markers only close
                        // layers containing actual XY extrusion.
                        if (sawLayerMarker && hasPrintedOnLayer) {
                            layers.add(GcodeLayer(layerIndex++, printLayerZ, currentMoves.toList()))
                        }
                        currentMoves.clear()
                        hasUnflushedMoves = false
                        sawLayerMarker = true
                        hasPrintedOnLayer = false
                    }''')

patch("app/src/main/java/com/u1/slicer/gcode/GcodeParser.kt",
    '''                        if (newZ != currentZ) {
                            if (currentMoves.isNotEmpty() || hasUnflushedMoves) {
                                layers.add(GcodeLayer(layerIndex++, currentZ, currentMoves.toList()))
                                currentMoves.clear()
                                hasUnflushedMoves = false
                            }
                            currentZ = newZ
                        }

                        val hasE = !newE.isNaN()
                        val eBefore = lastE
                        val isExtrude = hasE && if (absoluteE) newE > eBefore else newE > 0f
                        if (hasE) lastE = newE''',
    '''                        // Physical nozzle Z changes do not, by themselves,
                        // create a printable layer (Z hop / end parking).
                        currentZ = newZ

                        val hasE = !newE.isNaN()
                        val eBefore = lastE
                        val isExtrude = hasE && if (absoluteE) newE > eBefore else newE > 0f
                        if (hasE) lastE = newE

                        if (isExtrude && (newX != x || newY != y)) {
                            // Fallback for G-code without ;LAYER_CHANGE markers:
                            // only a different EXTRUSION height creates a layer.
                            if (!sawLayerMarker && hasPrintedOnLayer &&
                                kotlin.math.abs(currentZ - printLayerZ) > 0.01f) {
                                layers.add(GcodeLayer(layerIndex++, printLayerZ, currentMoves.toList()))
                                currentMoves.clear()
                                hasUnflushedMoves = false
                                hasPrintedOnLayer = false
                            }
                            if (!hasPrintedOnLayer) printLayerZ = currentZ
                            hasPrintedOnLayer = true
                        }''')

patch("app/src/main/java/com/u1/slicer/gcode/GcodeParser.kt",
    '''        if (currentMoves.isNotEmpty() || hasUnflushedMoves) {
            layers.add(GcodeLayer(layerIndex, currentZ, currentMoves.toList()))
        }''',
    '''        // Never append a parking-only phantom layer after the last print.
        if (hasPrintedOnLayer) {
            layers.add(GcodeLayer(layerIndex, printLayerZ, currentMoves.toList()))
        }''')

print("NIGHT PRINT native overlay applied (not built or device-tested).")
