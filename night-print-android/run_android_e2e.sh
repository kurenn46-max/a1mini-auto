#!/usr/bin/env bash
# Android-emulator-runner invokes individual YAML script lines separately.
# Keep the complete E2E transaction in one real shell process instead.
set -euo pipefail
mkdir -p /tmp/nightprint_e2e_artifacts
function save_evidence() {
  # A dead emulator must not hang diagnostics for the rest of the CI timeout.
  timeout 25s adb pull /sdcard/Android/data/com.u1.slicer.orca.nightprint.v342.visual20261011/files/ /tmp/nightprint_e2e_artifacts/app_files/ >/dev/null 2>&1 || true
  timeout 15s adb logcat -d -t 12000 > /tmp/nightprint_e2e_artifacts/logcat.txt 2>/dev/null || true
}
trap save_evidence EXIT

adb shell getprop ro.product.cpu.abilist | tee /tmp/nightprint_emulator_abis.txt
if ! grep -q 'arm64-v8a' /tmp/nightprint_emulator_abis.txt; then
  echo '::error::Android image cannot translate the packaged ARM64 native slicer, so real G-code test was NOT run.'
  exit 1
fi

cd /tmp/u1-nightprint
# Stage 1: run real MainActivity ACTION_VIEW -> tap Slice Model -> Preview.
# This phase already reached 100 layers, PETG, 20% and 235C in earlier CI.
# The previous combined test disconnected Android when searching for Jobs
# immediately after the large 3D preview: isolate the Jobs navigation.
echo "NIGHT PRINT: phase 1, visible 3MF import/slice/preview"
if ! bash ./gradlew :app:connectedDebugAndroidTest --no-daemon --stacktrace \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.u1.slicer.NightPrintVisualUiE2ETest'; then
  echo "::error::Visible import/slice/preview test failed; no release APK"
  exit 1
fi

# Download preview screenshots BEFORE leaving the preview process. This
# catches failures to produce actual screen evidence rather than unit mocks.
adb pull /sdcard/Android/data/com.u1.slicer.orca.nightprint.v342.visual20261011/files/nightprint_visual_ui_evidence/ /tmp/nightprint_e2e_artifacts/visible_ui/ >/dev/null
for step in 01_home 02_prepare_petg_ring 03_preview_after_real_native_slice 04_preview_petg_metadata_verified; do
  if ! find /tmp/nightprint_e2e_artifacts/visible_ui -name "ui_${step}.png" -size +2000c | grep -q .; then
    echo "::error::Phase 1 missing real screenshot ${step}; no release APK"
    exit 1
  fi
done
echo "phase1_preview_pass" >> /tmp/nightprint_e2e_artifacts/stages.txt
timeout 15s adb logcat -d -t 12000 > /tmp/nightprint_e2e_artifacts/logcat_after_preview.txt || true

# Release renderer/ViewModel resources in a NEW process before opening Jobs.
# The Android application data and Room job history remain untouched.
adb shell am force-stop com.u1.slicer.orca.nightprint.v342.visual20261011
echo "NIGHT PRINT: phase 2, fresh-process Jobs tab, saved G-code values, swipe"
if ! bash ./gradlew :app:connectedDebugAndroidTest --no-daemon --stacktrace \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.u1.slicer.NightPrintHistoryUiE2ETest'; then
  echo "::error::Persisted Jobs / swipe UI test failed; no release APK"
  exit 1
fi

# Fail CLOSED until BOTH phases have pixel evidence and correct job history.
adb pull /sdcard/Android/data/com.u1.slicer.orca.nightprint.v342.visual20261011/files/nightprint_visual_ui_evidence/ /tmp/nightprint_e2e_artifacts/visible_ui/ >/dev/null
for step in 01_home 02_prepare_petg_ring 03_preview_after_real_native_slice 04_preview_petg_metadata_verified 05_jobs_100layers_20pct_petg 06_jobs_after_swipe; do
  if ! find /tmp/nightprint_e2e_artifacts/visible_ui -name "ui_${step}.png" -size +2000c | grep -q .; then
    echo "::error::Missing visible UI screenshot for ${step}, APK release gate failed"
    exit 1
  fi
done
echo "phase2_history_swipe_pass" >> /tmp/nightprint_e2e_artifacts/stages.txt
echo "NIGHT PRINT visible UI gates PASSED; beginning native G-code safety E2E"

# Stage 2: independently verify the Orca ARM64 slicer, Bambu PETG machine
# profile, actual 100-layer G-code, plus multiple test geometries.
adb shell am force-stop com.u1.slicer.orca.nightprint.v342.visual20261011 || true
bash ./gradlew :app:connectedDebugAndroidTest --no-daemon --stacktrace \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.u1.slicer.NightPrintNativeSliceE2ETest,com.u1.slicer.NightPrintViewModelE2ETest,com.u1.slicer.NightPrintStressE2ETest'
echo "NIGHT PRINT both UI and native G-code safety release gates PASSED"
