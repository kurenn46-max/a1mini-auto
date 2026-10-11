#!/usr/bin/env python3
"""Create phone-only test handoff evidence after 19 REAL Android native tests.

This does NOT certify UI, job history, printer controls or real printing.
Fail closed if the native XML report, signed APK or test provenance is missing.
"""
from __future__ import annotations
from pathlib import Path
import hashlib
import json
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = Path("/tmp/u1-nightprint/app/build")
REPORTS = ROOT / "outputs/androidTest-results/connected"
APKS = ROOT / "outputs/apk/debug"
ID = "com.u1.slicer.orca.nightprint.v342.integrated20261011"
REQUIRED = {
    "NightPrintNativeSliceE2ETest",
    "NightPrintViewModelE2ETest",
    "NightPrintStressE2ETest",
}
CRITICAL = "exactUser3mf20Percent100LayersPetg235Bed65MustMatchRealGcode"


def require(ok: bool, why: str) -> None:
    if not ok:
        raise SystemExit("::error::NIGHT PRINT MANUAL HANDOFF BLOCKED: " + why)


def main() -> None:
    files = list(APKS.glob("*.apk"))
    require(len(files) == 1 and files[0].stat().st_size > 100000, "missing/ambiguous signed APK")
    apk = files[0]
    require(os.environ.get("NIGHT_PRINT_GATE_MODE") == "manual-handoff",
            "not explicitly in isolated manual-handoff gate mode")
    package_report = Path("/tmp/nightprint_v342_package.txt")
    require(package_report.exists() and
            "package: name='" + ID + "'" in package_report.read_text(errors="replace"),
            "Android package ID has not been signed and verified against isolated app ID")
    reports = sorted(REPORTS.rglob("*.xml"))
    require(bool(reports), "native Android device test report not found")
    executed = {}
    for path in reports:
        root = ET.parse(path).getroot()
        for suite in root.iter("testsuite"):
            require(int(suite.get("failures", "0")) == 0 and
                    int(suite.get("errors", "0")) == 0 and
                    int(suite.get("skipped", "0")) == 0,
                    "native suite had failures/errors/skipped")
        for case in root.iter("testcase"):
            cls = (case.get("classname") or case.get("class") or "").rsplit(".", 1)[-1]
            name = case.get("name") or ""
            require(case.find("failure") is None and
                    case.find("error") is None and
                    case.find("skipped") is None, "failed/skipped native Android testcase: " + name)
            if cls in REQUIRED:
                require((cls, name) not in executed,
                        "duplicate native Android JUnit testcase: " + cls + "." + name)
                executed[(cls, name)] = 1
    observed = {cls: sum(c == cls for (c, _) in executed) for cls in REQUIRED}
    require(all(n > 0 for n in observed.values()), "one or more real native G-code test suites absent")
    require(len(executed) >= 19, "less than 19 native slice/stress test cases executed")
    require(("NightPrintViewModelE2ETest", CRITICAL) in executed,
            "exact 3MF PETG235, bed65, 20%-infill and 100-layer native test not executed")

    fixture = Path("/tmp/u1-nightprint/app/src/androidTest/assets/nightprint_ui_ring_petg235_20pct_100layers.3mf")
    require(fixture.is_file() and fixture.stat().st_size > 1000,
            "exact PETG235 20%-infill 100-layer 3MF fixture absent for user test")
    fixture_sha = hashlib.sha256(fixture.read_bytes()).hexdigest()
    sha = hashlib.sha256(apk.read_bytes()).hexdigest()
    manifest = {
        "status": "MANUAL_PHONE_UI_TEST_CANDIDATE_NOT_RELEASE",
        "warnings": [
            "Android emulator visual end-to-end test FAILED or is NOT VERIFIED.",
            "Job History and 3D Preview are NOT certified.",
            "Physical Bambu A1 mini printing has NOT been tested.",
            "DO NOT treat this APK or G-code as certified for unattended physical printing.",
        ],
        "target_phone_os": "Android",
        "package_id": ID,
        "github_sha": os.environ.get("GITHUB_SHA", "unknown"),
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "native_android_test_count": len(executed),
        "native_android_test_suites": observed,
        "critical_3mf_real_gcode_test": CRITICAL,
        "user_owned_manual_checks": [
            "Install alongside old app (separate package ID).",
            "Import exact known PETG 235C 3MF and confirm Prepare material and temperature.",
            "Tap Slice Model; confirm Preview loads; do not tap Print.",
            "Check layer count 100, layer height 0.20mm, infill 20%, bed 65C.",
            "Open Job History; inspect PETG and 100-layer/20% records; swipe screen.",
            "Send screenshots and failure stage to NIGHT PRINT development chat.",
        ],
        "manual_test_3mf": {"file": fixture.name, "sha256": fixture_sha},
        "physical_printer_tested": False,
        "real_android_ui_test_passed": False,
        "apk": {"file": apk.name, "bytes": apk.stat().st_size, "sha256": sha},
    }
    dest = APKS / "NIGHT_PRINT_V3.4.2_MANUAL_PHONE_UI_TEST_NOT_RELEASE.json"
    dest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("NIGHT PRINT MANUAL HANDOFF NATIVE TESTS PASS=" + str(len(executed)))
    print("NIGHT PRINT HANDOFF APK SHA256=" + sha)
    print("NIGHT PRINT UI AND PRINTING=UNVERIFIED")


if __name__ == "__main__":
    main()
