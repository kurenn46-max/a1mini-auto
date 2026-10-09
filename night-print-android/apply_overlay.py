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
    ("NightPrintGcodeGuard.kt", java / "NightPrintGcodeGuard.kt"),
    ("NightPrintGcodeGuardTest.kt", root / "app/src/test/java/com/u1/slicer/NightPrintGcodeGuardTest.kt")
]:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(overlay / src, dst)
    print("Installed", dst.relative_to(root))

patch("app/build.gradle",
    'applicationId "com.u1.slicer.orca"',
    'applicationId "com.u1.slicer.orca.nightprint.v23"')

patch("app/src/main/AndroidManifest.xml",
    'android:label="@string/app_name"',
    'android:label="NIGHT PRINT V2.3 岡ちゃん"')

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

def patch_prepare(path, before, after):
    """Patch only the PrepareScreen() scope, never the separate PreviewScreen."""
    file = root / path
    source = file.read_text(encoding="utf-8")
    marker = "fun PrepareScreen("
    if source.count(marker) != 1:
        raise RuntimeError("PrepareScreen anchor missing/ambiguous")
    head, tail = source.split(marker, 1)
    if tail.count(before) < 1:
        raise RuntimeError("PrepareScreen top bar anchor missing")
    tail = tail.replace(before, after, 1)
    file.write_text(head + marker + tail, encoding="utf-8")
    print("Patched PrepareScreen", path)

# V2.1: the one-tap button must live in the PrepareScreen composable,
# not a sibling screen where modelLoaded/pendingNightPrintRaw are out of scope.
# Keep its state local, and do not start slicing or printing on approval.
patch_prepare("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Your One Slicer", fontWeight = FontWeight.Bold)''',
    '''    var nightPresetDialogVisible by remember { mutableStateOf(false) }
    if (nightPresetDialogVisible) {
        val preset = remember {
            NightPrintPreset.parse("""{"schema":"nightprint/v1","name":"岡ちゃん標準・確実","layer_height":0.20,"wall_loops":5,"sparse_infill_density":40,"top_shell_layers":5,"bottom_shell_layers":5,"sparse_infill_pattern":"gyroid"}""")
        }
        AlertDialog(
            onDismissRequest = { nightPresetDialogVisible = false },
            title = { Text("ナイトの印刷設定") },
            text = { Text(preset.summary()) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.saveSlicingOverrides(
                        preset.applyTo(viewModel.slicingOverrides.value)
                    )
                    nightPresetDialogVisible = false
                }) { Text("設定を反映") }
            },
            dismissButton = {
                TextButton(onClick = { nightPresetDialogVisible = false }) {
                    Text("キャンセル")
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("NIGHT PRINT", fontWeight = FontWeight.Bold)''')

patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                ),
                actions = {
                    if (state !is SlicerViewModel.SlicerState.Idle) {
                        IconButton(onClick = { viewModel.clearModel() }) {''',
    '''                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                ),
                actions = {
                    if (state is SlicerViewModel.SlicerState.ModelLoaded ||
                        state is SlicerViewModel.SlicerState.SliceComplete) {
                        TextButton(onClick = { nightPresetDialogVisible = true }) {
                            Text("ナイト設定", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (state !is SlicerViewModel.SlicerState.Idle) {
                        IconButton(onClick = { viewModel.clearModel() }) {''')


# V2.2 safety contract: NIGHT PRINT is process-only. Filament/material/nozzle/bed
# temperatures stay entirely under the upstream app's existing PETG/spool pipeline.
# Fail the build if a future edit accidentally adds those keys to the NIGHT preset.
preset_source = (overlay / "NightPrintPreset.kt").read_text(encoding="utf-8")
for forbidden in ("nozzleTemp", "filamentType", "materialType", "bedTemp"):
    if forbidden in preset_source:
        raise RuntimeError(f"NIGHT PRINT must not override upstream material setting: {forbidden}")
print("Verified: NIGHT PRINT does not override material or temperature settings")


# V2.3: Job History must reflect the slice actually produced, not the
# separate UI/default config. Otherwise it incorrectly shows PLA/210/15%
# even when the generated G-code header and process overrides are PETG/235/40%.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    val cfg = _config.value
                    val jobId = sliceJobDao.insert(''',
    '''                    // Use the exact effective process config, plus filament
                    // material/temperature resolved for the G-code header above.
                    val cfg = targetAwareSliceConfig
                    val jobMaterial = ftTypes.distinct().joinToString("/")
                        .ifBlank { cfg.filamentType }
                    val jobNozzleTemp = ntTemps.firstOrNull() ?: cfg.nozzleTemp
                    val jobId = sliceJobDao.insert(''')
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                            nozzleTemp = cfg.nozzleTemp,
                            bedTemp = cfg.bedTemp,
                            supportEnabled = cfg.supportEnabled,
                            filamentType = cfg.filamentType,''',
    '''                            nozzleTemp = jobNozzleTemp,
                            bedTemp = cfg.bedTemp,
                            supportEnabled = cfg.supportEnabled,
                            filamentType = jobMaterial,''')
print("NIGHT PRINT V2.3: Job History uses resolved slice settings and filament header")


# The Bambu A1 mini generated start G-code may still contain PLA/220C
# even when the settings footer says PETG/235C. Inspect executable commands
# before the first layer and FAIL CLOSED for single-filament PETG jobs.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    Log.i("SlicerVM", "B110 nozzle_temperature patch: $ntPatched (temps=$ntTemps)")''',
    '''                    Log.i("SlicerVM", "B110 nozzle_temperature patch: $ntPatched (temps=$ntTemps)")
                    if (target == SlicerTarget.BambuA1Mini &&
                        ftTypes.size == 1 && ftTypes[0].equals("PETG", ignoreCase = true)) {
                        val nightGuardError = NightPrintGcodeGuard.checkA1MiniPetg(
                            result.gcodePath, ntTemps.firstOrNull() ?: targetAwareSliceConfig.nozzleTemp
                        )
                        if (nightGuardError != null) {
                            diagnostics.clearSliceInProgress()
                            _state.value = SlicerState.Error(nightGuardError)
                            return@launch
                        }
                    }''')
print("NIGHT PRINT V2.3: executable PETG/temperature guard added")
