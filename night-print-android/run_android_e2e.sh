#!/usr/bin/env bash
# Android-emulator-runner invokes individual YAML script lines separately.
# Keep the complete E2E transaction in one real shell process instead.
set -euo pipefail
mkdir -p /tmp/nightprint_e2e_artifacts
function save_evidence() {
  adb pull /sdcard/Android/data/com.u1.slicer.orca.nightprint.v342.visual20261011/files/ /tmp/nightprint_e2e_artifacts/app_files/ >/dev/null 2>&1 || true
  adb logcat -d -t 12000 > /tmp/nightprint_e2e_artifacts/logcat.txt 2>/dev/null || true
}
trap save_evidence EXIT

adb shell getprop ro.product.cpu.abilist | tee /tmp/nightprint_emulator_abis.txt
if ! grep -q 'arm64-v8a' /tmp/nightprint_emulator_abis.txt; then
  echo '::error::Android image cannot translate the packaged ARM64 native slicer, so real G-code test was NOT run.'
  exit 1
fi

cd /tmp/u1-nightprint
bash ./gradlew :app:connectedDebugAndroidTest --no-daemon --stacktrace \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.u1.slicer.NightPrintNativeSliceE2ETest,com.u1.slicer.NightPrintViewModelE2ETest,com.u1.slicer.NightPrintStressE2ETest,com.u1.slicer.NightPrintVisualUiE2ETest'

# Fail CLOSED: even if all native slicer tests pass, do not publish an APK
# unless the real Compose screen tapping/swiping test captured its evidence.
echo "NIGHT PRINT: checking visible UI screenshot evidence"
adb pull /sdcard/Android/data/com.u1.slicer.orca.nightprint.v342.visual20261011/files/nightprint_visual_ui_evidence/ /tmp/nightprint_e2e_artifacts/visible_ui/ >/dev/null
for step in 01_home 02_prepare_petg_ring 03_preview_after_real_native_slice 04_preview_petg_metadata_verified 05_jobs_100layers_20pct_petg 06_jobs_after_swipe; do
  if ! find /tmp/nightprint_e2e_artifacts/visible_ui -name "ui_${step}.png" -size +2000c | grep -q .; then
    echo "::error::Missing visible UI screenshot for ${step}, APK release gate failed"
    exit 1
  fi
done
echo "NIGHT PRINT visible UI gate PASSED — APK eligible as test artifact"
