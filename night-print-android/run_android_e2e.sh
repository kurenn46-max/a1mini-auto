#!/usr/bin/env bash
# Android-emulator-runner invokes individual YAML script lines separately.
# Keep the complete E2E transaction in one real shell process instead.
set -euo pipefail
mkdir -p /tmp/nightprint_e2e_artifacts
function save_evidence() {
  # A dead emulator must not hang diagnostics for the rest of the CI timeout.
  # Streaming logs and host-memory samples are captured BEFORE it dies.
  [ -z "${MONITOR_PID:-}" ] || kill "$MONITOR_PID" 2>/dev/null || true
  [ -z "${LOGCAT_PID:-}" ] || kill "$LOGCAT_PID" 2>/dev/null || true
  timeout 10s adb pull /sdcard/Android/data/com.u1.slicer.orca.nightprint.v342.integrated20261011/files/ /tmp/nightprint_e2e_artifacts/app_files/ >/dev/null 2>&1 || true
  timeout 6s adb logcat -d -t 12000 > /tmp/nightprint_e2e_artifacts/logcat.txt 2>/dev/null || true
}
trap save_evidence EXIT

adb shell getprop ro.product.cpu.abilist | tee /tmp/nightprint_emulator_abis.txt
if ! grep -q 'arm64-v8a' /tmp/nightprint_emulator_abis.txt; then
  echo '::error::Android image cannot translate the packaged ARM64 native slicer, so real G-code test was NOT run.'
  exit 1
fi

cd /tmp/u1-nightprint

# STAGE 0 (mandatory): execute real native Android slicing and file-driven
# G-code checks FIRST. Previous preview graphics crashes masked whether the
# imported 3MF truly produced PETG235 / bed65 / 20% / 100 layers.
# No UI gate can be credited until these real Android JUnit suites pass.
# Gradle UTP may clear app data: visual UI tests install a fresh app AFTER
# this stage, then preserve real Room data between preview and history.
if [[ "${NIGHT_PRINT_GATE_MODE:-release}" == "visual-diagnostic" ]]; then
  echo "::notice::DIAGNOSTIC ONLY: native G-code stage bypassed for fast visual regression. APK release is forbidden."
else
echo "NIGHT PRINT: stage 0, imported 3MF -> REAL executable G-code audit"
bash ./gradlew :app:connectedDebugAndroidTest --no-daemon --stacktrace \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.u1.slicer.NightPrintNativeSliceE2ETest,com.u1.slicer.NightPrintViewModelE2ETest,com.u1.slicer.NightPrintStressE2ETest'
echo "NIGHT PRINT: stage 0 native + executable 3MF G-code suites PASSED"
if [[ "${NIGHT_PRINT_GATE_MODE:-release}" == "manual-handoff" ]]; then
  # User explicitly owns the interactive physical-phone UI test. This is
  # a HANDOFF TEST CANDIDATE, never a release, never a printing certificate.
  # A separate verifier MUST inspect all Android JUnit XML and APK SHA256
  # before GitHub Actions will publish this manual-install-only artifact.
  echo "NIGHT PRINT: MANUAL HANDOFF after real native 3MF/G-code gate; UI not certified"
  exit 0
fi
fi

# Avoid Gradle UTP's automatic uninstall/clear between UI phases. The UI
# tests MUST share the real Room job history across two app processes.
# APKs are already compiled and signature-verified by the workflow.
APP_ID="com.u1.slicer.orca.nightprint.v342.integrated20261011"
APP_APK="$(find app/build/outputs/apk/debug -maxdepth 1 -name '*.apk' -type f | head -n 1)"
TEST_APK="$(find app/build/outputs/apk/androidTest/debug -maxdepth 1 -name '*.apk' -type f | head -n 1)"
test -s "$APP_APK"
test -s "$TEST_APK"
adb install -r -t "$APP_APK"
adb install -r -t "$TEST_APK"
RUNNER="$APP_ID.test/androidx.test.runner.AndroidJUnitRunner"
adb shell pm list instrumentation | tr -d '\r' | tee /tmp/nightprint_e2e_artifacts/instrumentation_packages.txt
grep -F "$APP_ID.test/androidx.test.runner.AndroidJUnitRunner" /tmp/nightprint_e2e_artifacts/instrumentation_packages.txt

# The emulator previously died before the short-lived Android instrumentation
# process returned; post-failure adb logcat was therefore empty. Begin
# host-side logs BEFORE any 3MF import or native slicing. Both are artifacts
# even if the emulator process is killed by Linux OOM or graphics failure.
adb logcat -c >/dev/null 2>&1 || true
timeout 1500s adb logcat -v threadtime -b main -b system -b crash \
  > /tmp/nightprint_e2e_artifacts/streaming_android_logcat.txt 2>&1 &
LOGCAT_PID=$!
(
  while true; do
    date -u '+HOST_MONITOR %Y-%m-%dT%H:%M:%SZ'
    free -m || true
    ps -eo pid,comm,rss,%cpu | grep -E '(^ *PID|qemu-system|emulator|java|adb)' || true
    timeout 4s adb get-state 2>&1 || true
    sleep 10
  done
) > /tmp/nightprint_e2e_artifacts/host_emulator_memory_monitor.txt 2>&1 &
MONITOR_PID=$!

run_visible_phase() {
  local cls="$1" phase="$2"
  local evidence="/tmp/nightprint_e2e_artifacts/${phase}_instrumentation.txt"
  # 'am instrument' may exit zero even if a test assertion failed.
  # Require BOTH raw JUnit success and instrumentation runner success.
  if ! timeout 480s adb shell am instrument -w -e class "$cls" "$RUNNER" | tee "$evidence"; then
    echo "::error::${phase}: Android instrumentation failed or timed out"
    exit 1
  fi
  if ! grep -Fq 'OK (1 test)' "$evidence" || ! grep -Fq 'INSTRUMENTATION_CODE: -1' "$evidence"; then
    echo "::error::${phase}: missing explicit Android JUnit success; no release APK"
    exit 1
  fi
}
# Stage 1: run real MainActivity ACTION_VIEW -> tap Slice Model -> Preview.
# This phase already reached 100 layers, PETG, 20% and 235C in earlier CI.
# The previous combined test disconnected Android when searching for Jobs
# immediately after the large 3D preview: isolate the Jobs navigation.
echo "NIGHT PRINT: phase 1, visible 3MF import/slice/preview"
run_visible_phase com.u1.slicer.NightPrintVisualUiE2ETest preview

# Download preview screenshots BEFORE leaving the preview process. This
# catches failures to produce actual screen evidence rather than unit mocks.
adb pull /sdcard/Android/data/com.u1.slicer.orca.nightprint.v342.integrated20261011/files/nightprint_visual_ui_evidence/ /tmp/nightprint_e2e_artifacts/visible_ui/ >/dev/null
for step in 01_home 02_prepare_petg_ring 02b_prepare_petg235_chip_verified 03_preview_after_real_native_slice 04_preview_petg_metadata_verified; do
  if ! find /tmp/nightprint_e2e_artifacts/visible_ui -name "ui_${step}.png" -size +2000c | grep -q .; then
    echo "::error::Phase 1 missing real screenshot ${step}; no release APK"
    exit 1
  fi
done
echo "phase1_preview_pass" >> /tmp/nightprint_e2e_artifacts/stages.txt
timeout 15s adb logcat -d -t 12000 > /tmp/nightprint_e2e_artifacts/logcat_after_preview.txt || true

# Release renderer/ViewModel resources in a NEW process before opening Jobs.
# The Android application data and Room job history remain untouched.
adb shell am force-stop com.u1.slicer.orca.nightprint.v342.integrated20261011
echo "NIGHT PRINT: phase 2, fresh-process Jobs tab, saved G-code values, swipe"
run_visible_phase com.u1.slicer.NightPrintHistoryUiE2ETest history

# Fail CLOSED until BOTH phases have pixel evidence and correct job history.
adb pull /sdcard/Android/data/com.u1.slicer.orca.nightprint.v342.integrated20261011/files/nightprint_visual_ui_evidence/ /tmp/nightprint_e2e_artifacts/visible_ui/ >/dev/null
for step in 01_home 02_prepare_petg_ring 02b_prepare_petg235_chip_verified 03_preview_after_real_native_slice 04_preview_petg_metadata_verified 05_jobs_100layers_20pct_petg 06_jobs_after_swipe; do
  if ! find /tmp/nightprint_e2e_artifacts/visible_ui -name "ui_${step}.png" -size +2000c | grep -q .; then
    echo "::error::Missing visible UI screenshot for ${step}, APK release gate failed"
    exit 1
  fi
done
echo "phase2_history_swipe_pass" >> /tmp/nightprint_e2e_artifacts/stages.txt
echo "NIGHT PRINT visible UI gates PASSED; confirming native G-code evidence for signed release"

# Fail CLOSED on missing screenshots, test outputs or APK checksum;
# evidence JSON is written ONLY after both visual phases AND native E2E pass.
if [[ "${NIGHT_PRINT_GATE_MODE:-release}" == "visual-diagnostic" ]]; then
  echo "::notice::VISUAL DIAGNOSTIC PASS ONLY: no release manifest or APK, real native suite not run in this job"
else
  python3 "$GITHUB_WORKSPACE/night-print-android/release_evidence.py"
  echo "NIGHT PRINT both UI and native G-code safety release gates PASSED"
fi
