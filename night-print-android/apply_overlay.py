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
    ("NightPrintGcodeGuardTest.kt", root / "app/src/test/java/com/u1/slicer/NightPrintGcodeGuardTest.kt"),
    ("NightPrintOfflineA1MiniTarget.kt", java / "NightPrintOfflineA1MiniTarget.kt"),
    ("NightPrintOfflineA1MiniTargetTest.kt", root / "app/src/test/java/com/u1/slicer/NightPrintOfflineA1MiniTargetTest.kt"),
    ("NightPrintNativeSliceE2ETest.kt", root / "app/src/androidTest/java/com/u1/slicer/NightPrintNativeSliceE2ETest.kt"),
    ("NightPrintViewModelE2ETest.kt", root / "app/src/androidTest/java/com/u1/slicer/NightPrintViewModelE2ETest.kt"),
    ("NightPrintStressE2ETest.kt", root / "app/src/androidTest/java/com/u1/slicer/NightPrintStressE2ETest.kt"),
    ("NightPrintGcodeDepositionGuard.kt", java / "NightPrintGcodeDepositionGuard.kt"),
    ("NightPrintV34Preflight.kt", java / "NightPrintV34Preflight.kt"),
    ("NightPrintV34PreflightTest.kt", root / "app/src/test/java/com/u1/slicer/NightPrintV34PreflightTest.kt"),
    ("NightPrintGcodeParserTest.kt", root / "app/src/test/java/com/u1/slicer/gcode/NightPrintGcodeParserTest.kt"),
    ("NightPrintV341GcodeMetadata.kt", java / "NightPrintV341GcodeMetadata.kt"),
    ("NightPrintV341GcodeMetadataTest.kt", root / "app/src/test/java/com/u1/slicer/NightPrintV341GcodeMetadataTest.kt"),
    ("NightPrintImported3mfProfile.kt", java / "NightPrintImported3mfProfile.kt"),
    ("NightPrint3mfProcess.kt", java / "NightPrint3mfProcess.kt"),
    ("NightPrintStlTo3mf.kt", java / "NightPrintStlTo3mf.kt"),
    ("NightPrintStlTo3mfTest.kt", root / "app/src/test/java/com/u1/slicer/NightPrintStlTo3mfTest.kt")
]:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(overlay / src, dst)
    print("Installed", dst.relative_to(root))

# Deterministic ring fixtures go into the Android instrumented test APK.
# They are not print jobs and cannot be uploaded to a printer by this overlay.
import subprocess
subprocess.run(
    [sys.executable, str(overlay / "generate_e2e_ring.py"),
     str(root / "app/src/androidTest/assets")],
    check=True,
)
subprocess.run(
    [sys.executable, str(overlay / "generate_stress_shapes.py"),
     str(root / "app/src/androidTest/assets")],
    check=True,
)

patch("app/build.gradle",
    'applicationId "com.u1.slicer.orca"',
    'applicationId "com.u1.slicer.orca.nightprint.v341.truth20261011"')

patch("app/src/main/AndroidManifest.xml",
    'android:label="@string/app_name"',
    'android:label="NIGHT PRINT V3.4.1 検証版"')

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


# V2.5 offline A1 mini: selecting a slicer target cannot depend on
# network pairing. The original app silently defaulted to Snapmaker U1
# (270-mm bed) whenever there was no active printer. Do not rewrite
# another explicitly configured printer to A1 mini: block that mismatch.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''    val effectiveSliceTarget: StateFlow<SlicerTarget> = printersRepo.activePrinter
        .map(::resolveDefaultSliceTarget)
        .stateIn(
        viewModelScope,
        SharingStarted.Eagerly,
        resolveDefaultSliceTarget(null),
    )''',
    '''    val effectiveSliceTarget: StateFlow<SlicerTarget> = printersRepo.activePrinter
        .map(::nightPrintOfflineA1MiniTarget)
        .stateIn(
        viewModelScope,
        SharingStarted.Eagerly,
        nightPrintOfflineA1MiniTarget(null),
    )''')

patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''    fun startSlicing() {
        if (!com.u1.slicer.slice.isLocalSliceAvailable(''',
    '''    fun startSlicing() {
        // A1 mini is a dedicated machine target even without LAN pairing.
        // Explicitly selected non-A1 printers are rejected, not silently converted.
        if (nightPrintOfflineA1MiniTarget(activePrinterForSlicing.value)
            != SlicerTarget.BambuA1Mini) {
            _state.value = SlicerState.Error(
                "ナイト検査: A1 mini以外のプリンターが選択されています。機種を確認してください。"
            )
            return
        }
        if (!com.u1.slicer.slice.isLocalSliceAvailable(''')

# The Prepare screen already collects effectiveSliceTarget; show it explicitly.
patch_prepare("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''Text("NIGHT PRINT", fontWeight = FontWeight.Bold)''',
    '''Text("NIGHT PRINT", fontWeight = FontWeight.Bold)
                        Text(
                            if (effectiveSliceTarget == com.u1.slicer.slice.SlicerTarget.BambuA1Mini)
                                "A1 mini 対応（接続なしでもスライス可）"
                            else "機種が一致しません：A1 miniを選択",
                            style = MaterialTheme.typography.labelSmall
                        )''')

# Validate firmware identity on EVERY A1 mini slice (including PLA),
# and retain the stricter PETG command audit as a separate check.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    if (target == SlicerTarget.BambuA1Mini &&
                        ftTypes.size == 1 && ftTypes[0].equals("PETG", ignoreCase = true)) {''',
    '''                    if (target == SlicerTarget.BambuA1Mini) {
                        val machineIssue = NightPrintGcodeGuard.checkA1MiniMachine(result.gcodePath)
                        if (machineIssue != null) {
                            diagnostics.clearSliceInProgress()
                            _state.value = SlicerState.Error(machineIssue)
                            return@launch
                        }
                    }
                    if (target == SlicerTarget.BambuA1Mini &&
                        ftTypes.size == 1 && ftTypes[0].equals("PETG", ignoreCase = true)) {''')
print("NIGHT PRINT v2.5: offline A1 mini target and G-code machine guard installed.")

# V2.7: instead of feeding a bare STL into the native Bambu engine (which
# hard-codes PLA/220C), generate a material-profile-bearing 3MF from the SAME
# user's STL prior to slicing. Reuse the upstream pre-slice re-embed/reload
# path so copy placement, geometry edits, print process and all native machine
# safeguards stay active. Original STL is never modified.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                val firstSliceThisLaunch = diagnostics.markSliceStart()

                // Re-embed before slicing when needed:''',
    '''                val firstSliceThisLaunch = diagnostics.markSliceStart()

                // NIGHT PRINT: the upstream native Bambu STL code seeds PLA/220.
                // The exact same geometry, when wrapped as a Bambu project 3MF
                // with resolved user material, produces genuine PETG heat commands.
                // This MUST run on every slice, not just the first import, so
                // changing the material or temperature after model load is safe.
                if (effectiveSliceTarget.value == SlicerTarget.BambuA1Mini &&
                    currentModelName.endsWith(".stl", ignoreCase = true)) {
                    if (_config.value.extruderCount != 1) {
                        _state.value = SlicerState.Error(
                            "ナイト検査: STLの複数フィラメント印刷はまだ未検証です。中止します。")
                        return@launch
                    }
                    val originalStl = rawInputFile
                        ?.takeIf { it.isFile && it.name.endsWith(".stl", ignoreCase = true) }
                        ?: throw IllegalStateException("元のSTLを見つけられません。読み込み直してください。")
                    val usedSlot = listOf(_selectedExtruder.value)
                    val (resolvedTypes, resolvedTemps) = applyNonCanonicalOverride(
                        slotTypes = resolveNonCanonicalHeaderPatchTypes(
                            usedSlot, extruderPresets.value),
                        slotTemps = resolveNonCanonicalHeaderPatchTemps(
                            usedSlot, extruderPresets.value, filaments.value),
                        override = _filamentOverrides.value[0],
                    )
                    val resolvedType = resolvedTypes.singleOrNull()
                        ?: throw IllegalStateException("使用する素材を1種類に確定できません。")
                    val resolvedTemp = resolvedTemps.singleOrNull()
                        ?: throw IllegalStateException("使用するノズル温度を確定できません。")
                    val effectiveProcess = slicingOverrides.value.resolveInto(_config.value)
                    val converted = NightPrintStlTo3mf.wrap(
                        originalStl,
                        java.io.File(transientWorkspaceDir(), "nightprint_auto_stl_profile.3mf"),
                        NightPrintStlTo3mf.Settings(
                            filamentType = resolvedType,
                            nozzleC = resolvedTemp,
                            bedC = effectiveProcess.bedTemp,
                            wallLoops = effectiveProcess.perimeters,
                            fillDensityPercent = kotlin.math.round(
                                effectiveProcess.fillDensity * 100f).toInt(),
                            layerHeightMm = effectiveProcess.layerHeight,
                            topLayers = effectiveProcess.topSolidLayers,
                            bottomLayers = effectiveProcess.bottomSolidLayers,
                            infillPattern = effectiveProcess.fillPattern,
                        ),
                    )
                    val convertedInfo = com.u1.slicer.bambu.ThreeMfParser.parse(converted)
                    check(convertedInfo.isBambu) {
                        "3MFへの素材設定の埋め込みを認識できません。"
                    }
                    val confirmedProfile = java.util.zip.ZipFile(converted).use {
                        profileEmbedder.parseSourceConfig(it)
                    } ?: throw IllegalStateException("3MFからPETG設定を読み取れません。")
                    sourceModelFile = converted
                    sourceModelInfo = convertedInfo
                    _fileThreeMfInfo = convertedInfo
                    _sourceConfig.value = confirmedProfile
                    diagnostics.recordEvent(
                        "nightprint_stl_material_profile",
                        mapOf("material" to resolvedType, "nozzleC" to resolvedTemp,
                            "sourceTriangles" to originalStl.length(), "confirmed" to true),
                    )
                }

                // Re-embed before slicing when needed:''')

print("NIGHT PRINT V2.7: native STL slices now use generated PETG-profile-bearing 3MF, with fail-closed executable G-code audit.")


# V2.8: V2.7's generated 3MF was fed into embedProfile() once again,
# where BambuImportedConfigComposer and the explicit STL overrides could
# reintroduce PLA-baseline 220C. The native ARM64 3MF E2E test has already
# proven that directly loading the generated profile creates PETG startup
# commands. Load that exact profiled file, and skip the second profile merge.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                val firstSliceThisLaunch = diagnostics.markSliceStart()

                // NIGHT PRINT:''',
    '''                val firstSliceThisLaunch = diagnostics.markSliceStart()
                var nightWrappedStlForThisSlice = false

                // NIGHT PRINT:''')

patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    _sourceConfig.value = confirmedProfile
                    diagnostics.recordEvent(
                        "nightprint_stl_material_profile",''',
    '''                    _sourceConfig.value = confirmedProfile
                    nightWrappedStlForThisSlice = true
                    diagnostics.recordEvent(
                        "nightprint_stl_material_profile",''')

patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                        val isSingleExtruderRefresh = profileNeedsReEmbed && remap == null && _config.value.extruderCount <= 1''',
    '''                        val isSingleExtruderRefresh = nightWrappedStlForThisSlice ||
                            (profileNeedsReEmbed && remap == null && _config.value.extruderCount <= 1)''')

patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                        val reembedded = embedProfile(src, srcInfo, transientWorkspaceDir(), plateId = reembedPlateId)
                        // Acquire previewMutex''',
    '''                        // For NIGHT's STL wrapper, do NOT re-compose/re-embed the
                        // Bambu profile: it already contains the resolved PETG
                        // temps and process. The native 3MF E2E verifies this
                        // exact source path. Re-embedding can replace 235 with 220.
                        val reembedded = if (nightWrappedStlForThisSlice) {
                            require(src.isFile && src.extension.equals("3mf", ignoreCase = true))
                            diagnostics.recordEvent(
                                "nightprint_direct_profile_reload",
                                mapOf("path" to src.absolutePath, "length" to src.length()),
                            )
                            src
                        } else {
                            embedProfile(src, srcInfo, transientWorkspaceDir(), plateId = reembedPlateId)
                        }
                        // Acquire previewMutex''')

# An explicit Bambu override for the raw STL's old filament library can
# overwrite nozzle temp in the already-correct generated 3MF. Treat the
# wrapped file's validated filament profile as the single source of truth.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                        ).keys.joinToString(separator = "|", prefix = "|", postfix = "|")
                    } else {
                        ""
                    },
                )
                val result = native.slice(jniSliceConfig)''',
    '''                        ).keys.filterNot { key ->
                            nightWrappedStlForThisSlice &&
                                key in setOf(
                                    "filament_type",
                                    "nozzle_temperature",
                                    "nozzle_temperature_initial_layer",
                                )
                        }.joinToString(separator = "|", prefix = "|", postfix = "|")
                    } else {
                        ""
                    },
                )
                val result = native.slice(jniSliceConfig)''')
print("NIGHT PRINT V2.8: A1 mini STL profile directly loaded into native slicer, no second Bambu composition.")



# V3.0: A simple single-material Bambu 3MF can already contain a complete
# PETG process profile. Upstream's SECOND re-embed recreates that profile from
# a stale PLA/220 default. Only bypass it when the ORIGINAL source 3MF profile
# and the exact user-visible process agree. Unsupported/edited 3MF continues
# via the guarded original path. Never rewrite executable G-code.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                // Re-embed before slicing when needed:''',
    '''                // NIGHT PRINT V3.0: fail-safe fast path for simple, verified
                // imported PETG 3MF (the V2.9 real Android UI regression).
                // The original 3MF is the single source of truth, exactly as
                // in the passing real native 3MF E2E; the later re-embed can
                // otherwise overwrite PETG 235C with PLA 220C.
                if (effectiveSliceTarget.value == SlicerTarget.BambuA1Mini &&
                    currentModelName.endsWith(".3mf", ignoreCase = true) &&
                    _config.value.extruderCount == 1 &&
                    toolRemapSlots == null &&
                    additionalModelFiles.isEmpty() &&
                    _duplicateOps.value.isEmpty() &&
                    _splitObjectOps.value.isEmpty() &&
                    _splitVolumeOps.value.isEmpty() &&
                    _perVolumeExtruders.value.isEmpty() &&
                    // The app stores a default pose for even untouched models.
                    // F66 replays that pose after reload; it is NOT a hazard.
                    _copyCount.value == 1) {
                    // NIGHT PRINT V3.2: on a custom 3MF do NOT fall back to
                    // the upstream profile composer, which loses PETG 235C.
                    // Reconcile ONLY explicit process changes into a transient
                    // copy of the exact original project; keep mesh/material.
                    val original = rawInputFile?.takeIf {
                        it.isFile && it.extension.equals("3mf", ignoreCase = true)
                    }
                    val imported = original?.let { source ->
                        val resolved = slicingOverrides.value.resolveInto(_config.value)
                        NightPrint3mfProcess.prepare(
                            source,
                            java.io.File(transientWorkspaceDir(),
                                "nightprint_verified_process.3mf"),
                            slicingOverrides.value,
                            resolved,
                        )
                    }
                    if (imported != null) {
                        val profileJson = runCatching {
                            java.util.zip.ZipFile(imported).use { zip ->
                                val entry = zip.getEntry("Metadata/project_settings.config")
                                if (entry == null) null
                                else org.json.JSONObject(zip.getInputStream(entry)
                                    .bufferedReader(Charsets.UTF_8).use { it.readText() })
                            }
                        }.getOrNull()
                        // A freshly imported 3MF normally uses USE_FILE for
                        // process settings. Never compare its 5 walls/40% infill
                        // against unrelated Snapmaker defaults (2 walls/15%).
                        // Only an explicit user OVERRIDE requires matching.
                        val userOptions = slicingOverrides.value
                        fun <T> acceptsProjectValue(
                            opt: com.u1.slicer.data.OverrideValue<T>, embedded: T?
                        ): Boolean = when (opt.mode) {
                            OverrideMode.USE_FILE -> true
                            OverrideMode.OVERRIDE -> embedded != null && opt.value == embedded
                            OverrideMode.ORCA_DEFAULT -> embedded != null
                        }
                        val mat = profileJson?.optJSONArray("filament_type")
                        val temp = profileJson?.optJSONArray("nozzle_temperature")
                        val initial = profileJson?.optJSONArray("nozzle_temperature_initial_layer")
                        val matchingProfile = profileJson != null &&
                            mat?.length() == 1 &&
                            mat.optString(0).equals("PETG", ignoreCase = true) &&
                            _config.value.filamentType.equals("PETG", ignoreCase = true) &&
                            temp?.length() == 1 && initial?.length() == 1 &&
                            temp.optString(0).toIntOrNull() == _config.value.nozzleTemp &&
                            initial.optString(0).toIntOrNull() == _config.value.nozzleTemp &&
                            acceptsProjectValue(userOptions.wallCount,
                                profileJson.optString("wall_loops").toIntOrNull()) &&
                            acceptsProjectValue(userOptions.topShellLayers,
                                profileJson.optString("top_shell_layers").toIntOrNull()) &&
                            acceptsProjectValue(userOptions.bottomShellLayers,
                                profileJson.optString("bottom_shell_layers").toIntOrNull()) &&
                            acceptsProjectValue(userOptions.layerHeight,
                                profileJson.optString("layer_height").toFloatOrNull()) &&
                            acceptsProjectValue(userOptions.infillDensity,
                                profileJson.optString("sparse_infill_density")
                                    .removeSuffix("%").toFloatOrNull()?.div(100f)) &&
                            acceptsProjectValue(userOptions.infillPattern,
                                profileJson.optString("sparse_infill_pattern").takeIf { it.isNotEmpty() }) &&
                            acceptsProjectValue(userOptions.bedTemp,
                                profileJson.optJSONArray("textured_plate_temp")
                                    ?.optString(0)?.toIntOrNull())
                        Log.i("SlicerVM", "NIGHTPRINT_V3_3MF_PROFILE_MATCH=$matchingProfile " +
                            "copies=${_copyCount.value} poses=${_perObjectPoses.value.size} " +
                            "material=${_config.value.filamentType} nozzle=${_config.value.nozzleTemp}")
                        if (matchingProfile) {
                            val originalInfo = com.u1.slicer.bambu.ThreeMfParser.parse(imported)
                            if (originalInfo.isBambu && !originalInfo.isMultiPlate &&
                                !originalInfo.hasPaintData && !originalInfo.hasLayerToolChanges &&
                                !originalInfo.hasMultiExtruderAssignments &&
                                originalInfo.detectedExtruderCount <= 1) {
                                val parsed = java.util.zip.ZipFile(imported).use {
                                    profileEmbedder.parseSourceConfig(it)
                                }
                                if (parsed != null) {
                                    sourceModelFile = imported
                                    sourceModelInfo = originalInfo
                                    _fileThreeMfInfo = originalInfo
                                    _sourceConfig.value = parsed
                                    nightWrappedStlForThisSlice = true
                                    Log.i("SlicerVM", "NIGHTPRINT_V3_3MF_DIRECT_PROFILE_APPLIED")
                                    diagnostics.recordEvent(
                                        "nightprint_verified_imported_3mf_direct_reload",
                                        mapOf("path" to imported.absolutePath,
                                            "material" to "PETG",
                                            "nozzleC" to _config.value.nozzleTemp),
                                    )
                                }
                            }
                        }
                    }
                }

                // Re-embed before slicing when needed:''')
print("NIGHT PRINT V3.2: verified imported PETG 3MF process and material are reconciled before native slice.")

# V2.9 G-code layer sanity: native Orca must emit all fixed 0.20mm
# layers for a 20mm vertical tube, not merely report 100 layers in UI.
# Keep the same fail-closed behavior as the PETG/nozzle G-code guard.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                            _state.value = SlicerState.Error(nightGuardError)
                            return@launch
                        }
                    }''',
    '''                            _state.value = SlicerState.Error(nightGuardError)
                            return@launch
                        }
                    }
                    if (target == SlicerTarget.BambuA1Mini &&
                        ov.layerHeight.mode == OverrideMode.OVERRIDE) {
                        val layerIssue = NightPrintGcodeGuard.checkA1MiniFixedLayers(
                            result.gcodePath, targetAwareSliceConfig.layerHeight
                        )
                        if (layerIssue != null) {
                            diagnostics.clearSliceInProgress()
                            _state.value = SlicerState.Error(layerIssue)
                            return@launch
                        }
                    }''')

print("NIGHT PRINT V2.9: welded manifold 3MF and strict fixed-layer G-code validation installed.")


# V3.1: importing single-material 3MF must not silently reset PETG/235 to
# the printer's unrelated PLA/220C slot. Bind the file profile before ModelLoaded,
# after upstream's saveConfig, WITHOUT changing the persistent spool settings.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    // Persist the reset so wipeTowerEnabled=false survives across sessions (B24 fix).
                    saveConfig()
                    Log.i("SlicerVM", "Single-color model: set preview colors from slots ${colors}")''',
    '''                    // Persist the reset so wipeTowerEnabled=false survives across sessions (B24 fix).
                    saveConfig()
                    val nightImported = NightPrintImported3mfProfile.read(rawInputFile)
                    val nightImportedInfo = _fileThreeMfInfo ?: _threeMfInfo.value
                    if (effectiveSliceTarget.value == SlicerTarget.BambuA1Mini &&
                        nightImported != null &&
                        nightImportedInfo?.isBambu == true &&
                        !nightImportedInfo.isMultiPlate &&
                        !nightImportedInfo.hasPaintData &&
                        !nightImportedInfo.hasLayerToolChanges &&
                        !nightImportedInfo.hasMultiExtruderAssignments &&
                        nightImportedInfo.detectedExtruderCount <= 1
                    ) {
                        _config.value = _config.value.copy(
                            filamentType = nightImported.filamentType,
                            nozzleTemp = nightImported.nozzleC,
                            bedTemp = nightImported.bedC,
                            extruderCount = 1,
                            extruderTemps = intArrayOf(nightImported.nozzleC),
                            filamentTypes = arrayOf(nightImported.filamentType),
                            filamentNozzleTempInitialLayers = intArrayOf(nightImported.nozzleC),
                        )
                        Log.i("SlicerVM",
                            "NIGHTPRINT_V31_IMPORTED_PROFILE_READY=" +
                                "${nightImported.filamentType}:" +
                                "${nightImported.nozzleC}C")
                    }
                    Log.i("SlicerVM", "Single-color model: set preview colors from slots ${colors}")''')

# The native A1 mini 3MF path already honors the embedded PETG profile.
# For the narrow validated direct-profile import, do not re-stamp its G-code
# header with the stale printer slot's PLA/220 material (post-slice only).
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    val ftTypes: List<String>
                    val ntTemps: List<Int>''',
    '''                    var ftTypes: List<String>
                    var ntTemps: List<Int>''')
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    val ftPatched = fixFilamentTypeHeader(result.gcodePath, ftTypes)''',
    '''                    if (nightWrappedStlForThisSlice &&
                        currentModelName.endsWith(".3mf", ignoreCase = true)) {
                        val source = NightPrintImported3mfProfile.read(rawInputFile)
                            ?: throw IllegalStateException(
                                "ナイト検査: 元の3MFのPETG素材設定が消失しました。印刷禁止。")
                        ftTypes = listOf(source.filamentType)
                        ntTemps = listOf(source.nozzleC)
                    }
                    val ftPatched = fixFilamentTypeHeader(result.gcodePath, ftTypes)''')
# PETG guards are required even if the upstream header resolver reports PLA.
# They compare executable heating commands against the SOURCE file temperature.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    if (target == SlicerTarget.BambuA1Mini &&
                        ftTypes.size == 1 && ftTypes[0].equals("PETG", ignoreCase = true)) {
                        val nightGuardError = NightPrintGcodeGuard.checkA1MiniPetg(
                            result.gcodePath, ntTemps.firstOrNull() ?: targetAwareSliceConfig.nozzleTemp
                        )''',
    '''                    val originalPetg = if (target == SlicerTarget.BambuA1Mini &&
                        currentModelName.endsWith(".3mf", ignoreCase = true))
                        NightPrintImported3mfProfile.read(rawInputFile) else null
                    if (target == SlicerTarget.BambuA1Mini &&
                        ((ftTypes.size == 1 && ftTypes[0].equals("PETG", ignoreCase = true)) ||
                            originalPetg != null)) {
                        val nightGuardError = NightPrintGcodeGuard.checkA1MiniPetg(
                            result.gcodePath,
                            originalPetg?.nozzleC
                                ?: ntTemps.firstOrNull()
                                ?: targetAwareSliceConfig.nozzleTemp
                        )''')
print("NIGHT PRINT V3.1: imported PETG project profile is authoritative for UI, history and executable code guard.")


# V3.2 3MF-first import contract: do not leak NIGHT settings from model A
# onto an unrelated 3MF model B. Clearing happens ONCE for a real new import,
# not for silent/native re-embeds, and only for verified simple PETG project
# profiles. A user may still apply explicit process overrides AFTER import.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                rawInputFile = sourceFile
                recoveryPlateId = -1''',
    '''                rawInputFile = sourceFile
                if (!silent &&
                    filename.endsWith(".3mf", ignoreCase = true) &&
                    effectiveSliceTarget.value == SlicerTarget.BambuA1Mini &&
                    NightPrintImported3mfProfile.read(sourceFile) != null) {
                    val inherited = slicingOverrides.value
                    val fresh = inherited.copy(
                        layerHeight = com.u1.slicer.data.OverrideValue(),
                        wallCount = com.u1.slicer.data.OverrideValue(),
                        infillDensity = com.u1.slicer.data.OverrideValue(),
                        infillPattern = com.u1.slicer.data.OverrideValue(),
                        topShellLayers = com.u1.slicer.data.OverrideValue(),
                        bottomShellLayers = com.u1.slicer.data.OverrideValue(),
                        bedTemp = com.u1.slicer.data.OverrideValue(),
                    )
                    settingsRepo.saveSlicingOverrides(fresh)
                    Log.i("SlicerVM",
                        "NIGHTPRINT_V32_NEW_3MF_USES_FILE_PROFILE")
                }
                recoveryPlateId = -1''')
print("NIGHT PRINT V3.2: new 3MF resets only previous-model process overrides.")


# V3.2: even if the native Orca engine reports SliceComplete, verify that
# the ACTUAL emitted G-code matches the custom 3MF instructions. This closes
# the gap where a preview/history says 4 walls/25%/0.16mm but native uses a
# stale 5 walls/40%/0.20mm profile. No G-code rewrite. Stop on mismatch.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    val outputValidation = validateSliceOutput(''',
    '''                    if (target == SlicerTarget.BambuA1Mini &&
                        nightWrappedStlForThisSlice &&
                        currentModelName.endsWith(".3mf", ignoreCase = true)) {
                        val activeProfile = sourceModelFile
                            ?: throw IllegalStateException("3MFの素材設定を確認できません。")
                        val issue = NightPrint3mfProcess.checkOutput(
                            activeProfile, result.gcodePath)
                        if (issue != null) {
                            diagnostics.clearSliceInProgress()
                            _state.value = SlicerState.Error(issue)
                            return@launch
                        }
                    }
                    val outputValidation = validateSliceOutput(''')
print("NIGHT PRINT V3.2: actual G-code audited against selected 3MF custom process, no silent fallback.")

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
        var sawGeneratedSlicerHeader = false
        var layerIndex = 0''')

patch("app/src/main/java/com/u1/slicer/gcode/GcodeParser.kt",
    '''                    if (startsWithAt(l, start, ";LAYER_CHANGE") || startsWithAt(l, start, "; layer_change")) {
                        if (currentMoves.isNotEmpty() || hasUnflushedMoves) {
                            layers.add(GcodeLayer(layerIndex++, currentZ, currentMoves.toList()))
                            currentMoves.clear()
                            hasUnflushedMoves = false
                        }
                    }''',
    '''                    if (startsWithAt(l, start, "; HEADER_BLOCK_START") ||
                        startsWithAt(l, start, "; generated by")) {
                        sawGeneratedSlicerHeader = true
                    }
                    if (startsWithAt(l, start, ";LAYER_CHANGE") || startsWithAt(l, start, "; layer_change")) {
                        // Generated slicer headers indicate startup purge before
                        // first real layer. Preserve first-layer extrusion in
                        // short/legacy G-code without generated slicer header.
                        if (hasPrintedOnLayer && (sawLayerMarker || !sawGeneratedSlicerHeader)) {
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


# V3.4: Show intended 3MF / override profile instead of bare base-U1 values.
patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''            // Quick summary
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                QuickStat("Layer", "%.2f mm".format(config.layerHeight))
                QuickStat("Infill", "%.0f%%".format(config.fillDensity * 100))
                QuickStat("Support", if (config.supportEnabled) "On" else "Off")
            }''',
    '''            // Prefer 3MF in USE_FILE mode; then explicit user override.
            // Bare U1 SliceConfig may still say 15% / OFF for a PETG project.
            fun fileText(key: String): String? {
                val v = sourceConfig?.get(key) ?: return null
                return if (v is List<*>) v.firstOrNull()?.toString() else v.toString()
            }
            fun fileNumber(key: String): Float? =
                fileText(key)?.trim()?.removeSuffix("%")?.toFloatOrNull()
            val ovLayer = slicingOverrides.layerHeight
            val ovInfill = slicingOverrides.infillDensity
            val ovSupport = slicingOverrides.supports
            val uiLayer = when (ovLayer.mode) {
                com.u1.slicer.data.OverrideMode.OVERRIDE -> ovLayer.value ?: config.layerHeight
                com.u1.slicer.data.OverrideMode.ORCA_DEFAULT -> 0.2f
                com.u1.slicer.data.OverrideMode.USE_FILE ->
                    fileNumber("layer_height") ?: config.layerHeight
            }
            val uiInfill = when (ovInfill.mode) {
                com.u1.slicer.data.OverrideMode.OVERRIDE -> ovInfill.value ?: config.fillDensity
                com.u1.slicer.data.OverrideMode.ORCA_DEFAULT -> 0.15f
                com.u1.slicer.data.OverrideMode.USE_FILE ->
                    fileNumber("sparse_infill_density")?.div(100f) ?: config.fillDensity
            }
            val uiSupport = when (ovSupport.mode) {
                com.u1.slicer.data.OverrideMode.OVERRIDE -> ovSupport.value ?: config.supportEnabled
                com.u1.slicer.data.OverrideMode.ORCA_DEFAULT -> false
                com.u1.slicer.data.OverrideMode.USE_FILE ->
                    when (fileText("enable_support")?.lowercase()) {
                        "1", "true" -> true
                        "0", "false" -> false
                        else -> config.supportEnabled
                    }
            }
            fun origin(found: Boolean, ov: com.u1.slicer.data.OverrideMode): String =
                when (ov) {
                    com.u1.slicer.data.OverrideMode.OVERRIDE -> "変更"
                    com.u1.slicer.data.OverrideMode.ORCA_DEFAULT -> "Orca"
                    com.u1.slicer.data.OverrideMode.USE_FILE -> if (found) "3MF" else "基本"
                }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                QuickStat("Layer·" + origin(fileNumber("layer_height") != null, ovLayer.mode),
                    "%.2f mm".format(uiLayer))
                QuickStat("Infill·" + origin(fileNumber("sparse_infill_density") != null, ovInfill.mode),
                    "%.0f%%".format(uiInfill * 100))
                QuickStat("Support·" + origin(fileText("enable_support") != null, ovSupport.mode),
                    if (uiSupport) "On" else "Off")
            }
            Text("スライス前の予定値。印刷前にG-codeと照合します。",
                style = MaterialTheme.typography.labelSmall)''')

# The slicer-provided layer estimate can be 489 although V4 has 252
# actual printable G-code layers. Use corrected parser's layer count.
patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''    val displayLayerCount = if (slicerLayerCount > 0) slicerLayerCount else gcodeLayerCount''',
    '''    val displayLayerCount = gcodeLayerCount''')
patch("app/src/main/java/com/u1/slicer/ui/GcodeViewer3DScreen.kt",
    '''    val displayLayerCount = if (slicerLayerCount > 0) slicerLayerCount else gcodeLayerCount''',
    '''    val displayLayerCount = gcodeLayerCount''')

# Preflight must run BEFORE reporting SliceComplete, not merely exist as unused code.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    val outputValidation = validateSliceOutput(''',
    '''                    if (target == SlicerTarget.BambuA1Mini) {
                        val depositionIssue =
                            NightPrintGcodeDepositionGuard.audit(result.gcodePath).issue
                        val supportIssue = if (depositionIssue == null)
                            NightPrintV34Preflight.checkSupport(
                                rawInputFile, result.gcodePath, slicingOverrides.value)
                        else null
                        val preflightIssue = depositionIssue ?: supportIssue
                        if (preflightIssue != null) {
                            diagnostics.clearSliceInProgress()
                            _state.value = SlicerState.Error(preflightIssue)
                            return@launch
                        }
                    }
                    val outputValidation = validateSliceOutput(''')


# V3.4.1. Data source reconciliation. Saved config is NOT the actual
# process for a verified imported PETG 3MF. G-code footer & printable
# ;LAYER_CHANGE data are authoritative for summary/history labels.
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                    val cfg = _config.value
                    val jobId = sliceJobDao.insert(''',
    '''                    val cfg = _config.value
                    // Use exported G-code to persist actual job parameters,
                    // not unrelated base U1 settings (15%/PLA).
                    val nightActual = NightPrintV341GcodeMetadata.read(result.gcodePath)
                    val jobId = sliceJobDao.insert(''')
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                            totalLayers = result.totalLayers,
                            estimatedTimeSeconds = result.estimatedTimeSeconds,''',
    '''                            totalLayers = nightActual?.printedLayers ?: result.totalLayers,
                            estimatedTimeSeconds = result.estimatedTimeSeconds,''')
patch("app/src/main/java/com/u1/slicer/SlicerViewModel.kt",
    '''                            layerHeight = cfg.layerHeight,
                            fillDensity = cfg.fillDensity,
                            nozzleTemp = cfg.nozzleTemp,
                            bedTemp = cfg.bedTemp,
                            supportEnabled = cfg.supportEnabled,
                            filamentType = cfg.filamentType,''',
    '''                            layerHeight = nightActual?.layerHeight ?: cfg.layerHeight,
                            fillDensity = nightActual?.infillDensity ?: cfg.fillDensity,
                            nozzleTemp = nightActual?.nozzleTemp ?: cfg.nozzleTemp,
                            bedTemp = cfg.bedTemp,
                            supportEnabled = nightActual?.supportEnabled ?: cfg.supportEnabled,
                            filamentType = nightActual?.filamentType ?: cfg.filamentType,''')

# Preview material must name the filament encoded in the G-code; the
# configured slot preset might still be PLA on an external-spool A1 mini.
patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''                    SliceCompleteSummaryCard(
                        result = s.result,''',
    '''                    val verifiedGcode by produceState<NightPrintV341GcodeMetadata.Result?>(
                        initialValue = null,
                        key1 = s.result.gcodePath
                    ) {
                        value = withContext(kotlinx.coroutines.Dispatchers.IO) {
                            NightPrintV341GcodeMetadata.read(s.result.gcodePath)
                        }
                    }
                    SliceCompleteSummaryCard(
                        result = s.result,
                        verifiedMaterial = verifiedGcode?.filamentType,
                        verifiedLayerCount = verifiedGcode?.printedLayers,''')
patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''    result: SliceResult,
    perExtruderFilamentMm: List<Float> = emptyList(),''',
    '''    result: SliceResult,
    verifiedMaterial: String? = null,
    verifiedLayerCount: Int? = null,
    perExtruderFilamentMm: List<Float> = emptyList(),''')
patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''            InfoRow("Layers", result.totalLayers.toString())''',
    '''            InfoRow("Layers", (verifiedLayerCount ?: result.totalLayers).toString())''')
patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''                            // Material priority: slot preset (mix slices, tool i = slot i)
                            // -> override -> mapped slot preset -> canonical.''',
    '''                            // One-material G-code is authoritative for display.
                            // Slot presets may still read PLA on external-spool A1 mini.
                            // For physical tool-space mixes, preserve slot semantics.''')
patch("app/src/main/java/com/u1/slicer/MainActivity.kt",
    '''                            else override?.materialType
                                ?: mappedMaterial
                                ?: canonicalEntry?.materialType
                                ?: ""''',
    '''                            else verifiedMaterial
                                ?: override?.materialType
                                ?: canonicalEntry?.materialType
                                ?: mappedMaterial
                                ?: ""''')

# Old Job History rows saved the wrong config. Prefer their durable G-code
# without rewriting historical databases or blocking the main UI thread.
patch("app/src/main/java/com/u1/slicer/ui/JobsScreen.kt",
    '''    val dateFormat = remember { SimpleDateFormat("MMM d, yyyy HH:mm", Locale.getDefault()) }

    Card(''',
    '''    val dateFormat = remember { SimpleDateFormat("MMM d, yyyy HH:mm", Locale.getDefault()) }
    val verifiedJob by produceState<com.u1.slicer.NightPrintV341GcodeMetadata.Result?>(
        initialValue = null,
        key1 = job.gcodePath
    ) {
        value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            com.u1.slicer.NightPrintV341GcodeMetadata.read(job.gcodePath)
        }
    }

    Card(''')
patch("app/src/main/java/com/u1/slicer/ui/JobsScreen.kt",
    '''                JobStat("Layers", job.totalLayers.toString())''',
    '''                JobStat("Layers", (verifiedJob?.printedLayers ?: job.totalLayers).toString())''')
patch("app/src/main/java/com/u1/slicer/ui/JobsScreen.kt",
    '''                JobStat("Layer H", "%.2f mm".format(job.layerHeight))''',
    '''                JobStat("Layer H", "%.2f mm".format(verifiedJob?.layerHeight ?: job.layerHeight))''')
patch("app/src/main/java/com/u1/slicer/ui/JobsScreen.kt",
    '''                JobStat("Infill", "%.0f%%".format(job.fillDensity * 100))
                JobStat("Nozzle", "${job.nozzleTemp}\\u00B0C")
                JobStat("Material", job.filamentType)''',
    '''                JobStat("Infill", "%.0f%%".format((verifiedJob?.infillDensity ?: job.fillDensity) * 100))
                JobStat("Nozzle", "${verifiedJob?.nozzleTemp ?: job.nozzleTemp}\\u00B0C")
                JobStat("Material", verifiedJob?.filamentType ?: job.filamentType)''')

