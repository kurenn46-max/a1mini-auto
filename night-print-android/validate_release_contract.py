#!/usr/bin/env python3
"""Static, fail-closed NIGHT PRINT release contract audit.

This is a cheap integration/regression guard, NOT emulator or printer proof.
Run from any working directory; invoked in both PR workflows before Gradle.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
N = ROOT / "night-print-android"
APP_ID = "com.u1.slicer.orca.nightprint.v342.integrated20261011"
OLD_ID = "com.u1.slicer.orca.nightprint.v342.visual20261011"
PASS = 0


def check(condition: bool, description: str) -> None:
    global PASS
    if not condition:
        print(f"::error::NIGHT PRINT STATIC CONTRACT FAILED: {description}", flush=True)
        raise SystemExit(1)
    PASS += 1
    print(f"STATIC CHECK {PASS:02d} PASS: {description}")


def content(rel: str) -> str:
    p = ROOT / rel
    check(p.is_file(), f"{rel} exists")
    return p.read_text(encoding="utf-8")


overlay = content("night-print-android/apply_overlay.py")
ui = content("night-print-android/NightPrintVisualUiE2ETest.kt")
history = content("night-print-android/NightPrintHistoryUiE2ETest.kt")
gcode = content("night-print-android/NightPrintViewModelE2ETest.kt")
guard = content("night-print-android/NightPrintGcodeGuard.kt")
evidence = content("night-print-android/release_evidence.py")
fixture = content("night-print-android/generate_e2e_ring.py")
runner = content("night-print-android/run_android_e2e.sh")
native_ci = content(".github/workflows/nightprint-e2e.yml")
build_ci = content(".github/workflows/nightprint-android.yml")
instructions = content("AGENTS.md")

for name, txt in (("overlay", overlay), ("emulator script", runner),
                  ("native CI", native_ci), ("build CI", build_ci)):
    check(APP_ID in txt and OLD_ID not in txt, f"isolated integrated app ID in {name}")

check("NightPrintHistoryUiE2ETest.kt" in overlay,
      "PR25 separate persisted real Job History test is installed")
check("nightImportedSingleFilament" in overlay and
      "override?.materialType == null" in overlay and
      "config.filamentType to config.nozzleTemp" in overlay,
      "PR26 display fallback retains original imported profile and user override")
check("singleImportedSource ?: filamentMaterials.getOrNull(colorIdx)" in overlay and
      "hasExplicitSingleChoice" in overlay,
      "confirmed Prepare PLA220 regression: imported source precedes stale resolver and respects explicit choice")
check("config.extruderCount == 1" in overlay and
      'currentModelName.endsWith(".3mf"' in overlay,
      "Prepare profile fallback limited to 1-filament 3MF")

prepare_assert = ui.find('stage = "prepare-filament-petg235"')
slice_press = ui.find('tapText("Slice Model")')
check(prepare_assert >= 0 and prepare_assert < slice_press,
      "real Compose Prepare PETG235 assertion happens before slice")
check('onAllNodesWithText("PETG")' in ui and
      'onAllNodesWithText("235°C")' in ui and
      'onAllNodesWithText("PLA")' in ui and
      '!containsText("220°C")' in ui,
      "Prepare explicitly rejects stale PLA220 chip")
check("NIGHT_PRINT_VISIBLE_PREVIEW_GATE_PASS" in ui and
      'stage = "tap-jobs"' not in ui,
      "PR25 Preview test ends before renderer-heavy Jobs navigation")
check('screen.onNodeWithText("Jobs"' in history and
      "NIGHT_PRINT_HISTORY_UI_GATE_PASS" in history and
      'containsText("20%")' in history and 'containsText("100")' in history,
      "separate real Compose History test checks persisted PETG/20%/100 layers")

first=runner.index("run_visible_phase com.u1.slicer.NightPrintVisualUiE2ETest")
second=runner.index("run_visible_phase com.u1.slicer.NightPrintHistoryUiE2ETest")
check(first < second and
      "adb shell am force-stop" in runner[first:second] and
      'adb shell am instrument -w -e class' in runner,
      "independent instrumentation phases share persisted Room data")
check("02b_prepare_petg235_chip_verified" in runner and
      "05_jobs_100layers_20pct_petg" in runner and
      "06_jobs_after_swipe" in runner,
      "real on-device screenshots required before APK publication")
check("OK (1 test)" in runner and "INSTRUMENTATION_CODE: -1" in runner,
      "instrumentation exit code alone cannot release APK")

check('nightprint_ui_ring_petg235_20pct_100layers.3mf' in fixture and
      '"sparse_infill_density": "20%"' in fixture and
      '"nozzle_temperature"' in fixture and
      '"textured_plate_temp"' in fixture,
      "generated 3MF fixture includes real user profile")
check("exactUser3mf20Percent100LayersPetg235Bed65MustMatchRealGcode" in gcode
      and 'expectedInfill = 20' in gcode and 'expectedLayerMm = 0.20f' in gcode
      and 'bedHeaterLines.any' in gcode,
      "real Android ViewModel regression validates 20%, 100 layers, and executable bed65")
check("checkA1MiniPetg(gcode.absolutePath, 235)" in gcode and
      "checkA1MiniFixedLayers(" in gcode and
      'it.trim() == ";LAYER_CHANGE"' in gcode and
      "checkA1MiniMachine(gcode.absolutePath)" in gcode,
      "real Android G-code PETG235, A1 mini and physical layers checked")
check('lastMaterial != "PETG"' in guard and
      'lastTemperature' in guard and
      "layerCount != expectedLayerCount" in guard,
      "G-code safety guard audits executable startup and true Z structure")
check("NightPrintNativeSliceE2ETest" in runner and
      "NightPrintViewModelE2ETest" in runner and
      "NightPrintStressE2ETest" in runner,
      "native and stress instrumented regressions required")
check("gpu software" in native_ci and "timeout-minutes:" in native_ci,
      "emulator uses software GPU and bounded run")

publish = native_ci.find("- name: Publish test APK ONLY")
check(publish >= 0 and
      "if: success()" in native_ci[publish:publish+300] and
      "actions/upload-artifact@v4" in native_ci[publish:publish+330] and
      "INTEGRATED_ALL_GATES_PASS_test_apk" in native_ci,
      "test APK artifact exists only after the complete native gate succeeds")
check("release_evidence.py" in runner and
      runner.index("release_evidence.py") > runner.index("connectedDebugAndroidTest"),
      "APK manifest only generated after all native Android tests")
check("NIGHT_PRINT_V3.4.2_INTEGRATED_EVIDENCE.json" in native_ci and
      "NIGHT_PRINT_V3.4.2_INTEGRATED_EVIDENCE.json" in evidence,
      "published APK must carry its provenance manifest")
check("NightPrintNativeSliceE2ETest" in evidence and
      "NightPrintViewModelE2ETest" in evidence and
      "NightPrintStressE2ETest" in evidence and
      "junit_root.rglob" in evidence,
      "release evidence checks actual executed native Android JUnit reports")
check("actions/upload-artifact@v4" not in build_ci and
      "Hold APK until visual Android E2E passes" in build_ci,
      "JVM-only CI never publishes an unverified APK")
check("実機" in instructions and "未合格" in instructions,
      "AI instructions explicitly separate hardware handoff and incomplete tests")
print(f"\nNIGHT PRINT STATIC INTEGRATION CONTRACT PASS: {PASS} checks")
print("NOTE: Static PASS != Android emulator PASS != A1 mini print validation.")
