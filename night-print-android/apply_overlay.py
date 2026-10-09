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
    ("NightPrintPresetTest.kt", root / "app/src/test/java/com/u1/slicer/NightPrintPresetTest.kt")
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

# V2.1: put NIGHT PRINT directly in the Prepare top bar.  No browser/deep-link
# dance is required for the everyday "岡ちゃん標準" preset.  The button only
# stages the same confirmation dialog; it still cannot start a print.
patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''                actions = {
                    if (state !is SlicerViewModel.SlicerState.Idle) {''',
    '''                actions = {
                    if (modelLoaded) {
                        TextButton(onClick = {
                            pendingNightPrintRaw = """{"schema":"nightprint/v1","name":"岡ちゃん標準・確実","layer_height":0.20,"wall_loops":5,"sparse_infill_density":40,"top_shell_layers":5,"bottom_shell_layers":5,"sparse_infill_pattern":"gyroid"}"""
                        }) {
                            Text("ナイト設定", fontWeight = FontWeight.Bold)
                        }
                    }
                    if (state !is SlicerViewModel.SlicerState.Idle) {''')

print("NIGHT PRINT native overlay applied (not built or device-tested).")
