#!/usr/bin/env python3
"""Create auditable manifest only *after* the full NIGHT PRINT Android gate.

This is NOT a print-safety certificate. Fail closed if any required evidence
is missing. The workflow must call it after Android connected tests complete.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sys
from datetime import datetime, timezone
import xml.etree.ElementTree as ET

APP_ID = "com.u1.slicer.orca.nightprint.v342.integrated20261011"
STEPS = (
    "01_home",
    "02_prepare_petg_ring",
    "02b_prepare_petg235_chip_verified",
    "03_preview_after_real_native_slice",
    "04_preview_petg_metadata_verified",
    "05_jobs_100layers_20pct_petg",
    "06_jobs_after_swipe",
)
EVIDENCE = Path("/tmp/nightprint_e2e_artifacts")
APK_DIR = Path("/tmp/u1-nightprint/app/build/outputs/apk/debug")


def require(ok: bool, why: str) -> None:
    if not ok:
        raise SystemExit(f"::error::NIGHT PRINT RELEASE BLOCKED: {why}")


def digest(path: Path) -> str:
    hash_ = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1_048_576), b""):
            hash_.update(part)
    return hash_.hexdigest()


def main() -> None:
    apk_files = list(APK_DIR.glob("*.apk"))
    require(len(apk_files) == 1, "expected exactly one isolated signed candidate APK")
    apk = apk_files[0]
    require(apk.stat().st_size > 100000, "APK missing or unexpectedly small")

    stages = (EVIDENCE / "stages.txt").read_text(encoding="utf-8")
    require(stages.splitlines() == ["phase1_preview_pass", "phase2_history_swipe_pass"],
            "missing exact real UI phase success markers")

    filenames = {}
    for step in STEPS:
        found = list((EVIDENCE / "visible_ui").rglob(f"ui_{step}.png"))
        require(len(found) == 1 and found[0].stat().st_size > 2000,
                f"real Android screenshot missing/ambiguous: {step}")
        filenames[step] = {"size": found[0].stat().st_size, "sha256": digest(found[0])}

    for phase in ("preview", "history"):
        log = (EVIDENCE / f"{phase}_instrumentation.txt")
        require(log.exists(), f"no raw instrumentation log for {phase}")
        txt = log.read_text(encoding="utf-8")
        require("OK (1 test)" in txt and "INSTRUMENTATION_CODE: -1" in txt,
                f"Android JUnit did not genuinely pass: {phase}")

    # Gradle exit zero alone is insufficient: require JUnit XML containing
    # ACTUALLY EXECUTED tests in each of the three native Android suites.
    junit_root = Path("/tmp/u1-nightprint/app/build/outputs/androidTest-results/connected")
    junit_files = sorted(junit_root.rglob("*.xml")) if junit_root.is_dir() else []
    require(bool(junit_files), "no connected Android JUnit XML files: native run is not verified")
    mandatory = (
        "NightPrintNativeSliceE2ETest",
        "NightPrintViewModelE2ETest",
        "NightPrintStressE2ETest",
    )
    observed = {name: 0 for name in mandatory}
    for xml in junit_files:
        try:
            root = ET.parse(xml).getroot()
        except ET.ParseError as exc:
            raise SystemExit(f"::error::Unparseable Android JUnit report {xml}: {exc}")
        for test in root.iter("testcase"):
            cls = test.get("classname", "") or test.get("class", "")
            name = test.get("name", "")
            if test.find("failure") is not None or test.find("error") is not None:
                raise SystemExit(f"::error::Android native JUnit assertion failed: {cls}.{name}")
            if test.find("skipped") is not None:
                continue
            for mandatory_class in mandatory:
                if mandatory_class in cls:
                    observed[mandatory_class] += 1
    for mandatory_class, count in observed.items():
        require(count > 0, f"{mandatory_class} had zero verified executed tests")
    print("NIGHT PRINT NATIVE ANDROID SUITES VERIFIED=" + repr(observed))

    manifest = {
        "status": "EMULATOR_NATIVE_AND_VISIBLE_UI_GATES_PASSED",
        "disclaimer": "Not tested on the owner's phone or physical Bambu A1 mini. Do not infer printing safety from emulator-only results.",
        "release": "NIGHT PRINT V3.4.2 INTEGRATED TEST APK (not stable)",
        "app_id": APP_ID,
        "tested_github_checkout_sha": os.environ.get("GITHUB_SHA") or "unknown",
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "test_input": {
            "file": "nightprint_ui_ring_petg235_20pct_100layers.3mf",
            "material": "PETG",
            "nozzle_c": 235,
            "bed_c": 65,
            "infill_percent": 20,
            "expected_real_layers": 100,
            "expected_layer_mm": 0.20,
            "printer": "Bambu Lab A1 mini"
        },
        "verification": {
            "PR25_split_real_ui": True,
            "PR26_prepare_PETG235_chip": True,
            "persisted_real_job_history": True,
            "real_arm64_native_slice_regression": True,
            "native_junit_executed_tests": observed,
            "real_gcode_startup_material_nozzle_bed_and_layer_checks": True,
            "android_emulator_only": True,
            "physical_print_tested": False,
        },
        "screenshots": filenames,
        "apk": {"filename": apk.name, "bytes": apk.stat().st_size, "sha256": digest(apk)},
    }
    output = APK_DIR / "NIGHT_PRINT_V3.4.2_INTEGRATED_EVIDENCE.json"
    output.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"NIGHT PRINT EMULATOR RELEASE MANIFEST PASS: {output}")
    print("NIGHT PRINT APK SHA256=" + manifest["apk"]["sha256"])
    print("NIGHT PRINT PHYSICAL A1 MINI TEST=NOT RUN")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as f:
            f.write(
                "\n### NIGHT PRINT integrated emulator gate\n"
                "- Result: **Passed all automated steps** (NOT a physical print test)\n"
                f"- APK SHA256: \x60{manifest['apk']['sha256']}\x60\n"
                f"- Commit: \x60{manifest['tested_github_checkout_sha']}\x60\n"
                f"- Real screenshots verified: {len(filenames)}\n"
                "- Physical Bambu A1 mini and phone verification: **Not run**\n"
            )


if __name__ == "__main__":
    main()
