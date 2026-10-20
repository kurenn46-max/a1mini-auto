#!/usr/bin/env python3
"""A1 mini external-spool UI route fix; apply AFTER V4.0.1 pinned upstream overlay.

Stops incorrect AMS route selection when *live printer status* reports exactly
one loaded virtual/external spool and no loaded AMS. No guessing on unknown
status. Never changes printer or runs print commands. Fail closed on drift.
"""
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]).resolve()
src = Path(__file__).resolve().parent
main = root / "app/src/main/java/com/u1/slicer/MainActivity.kt"
content = main.read_text(encoding="utf-8")

def patch(before, after):
    global content
    found = content.count(before)
    if found != 1:
        raise RuntimeError("STOP: unexpected A1 mini UI anchor count=" + str(found) + ": " + before[:100])
    content = content.replace(before, after, 1)

patch(
    '''                    val bambuSlotNozzleRoutes = remember(printerFilamentSlots) {
                        buildBambuSlotNozzleRoutes(printerFilamentSlots)
                    }
                    when (canonicalState) {''',
    '''                    val bambuSlotNozzleRoutes = remember(printerFilamentSlots) {
                        buildBambuSlotNozzleRoutes(printerFilamentSlots)
                    }
                    // V4.0.2: only trust an external route explicitly reported as loaded.
                    // Without such evidence the existing UI remains unchanged.
                    val nightExternalSpoolRoute =
                        NightPrintExternalSpoolPolicy.singleLoadedExternalRoute(
                            isA1Mini = previewActivePrinter?.bambu?.model ==
                                com.u1.slicer.data.BambuModel.A1_MINI,
                            loadedRouteIds = printerFilamentSlots.filter { it.loaded }.map { it.index },
                        )
                    when (canonicalState) {'''
)
patch(
    '''                                        com.u1.slicer.ui.FilamentMappingDialog(
                                            canonicalList = narrowedList,
                                            extruderPresets = bambuSlotPresets,
                                            plateFileIndices = plateFileIndices,''',
    '''                                        com.u1.slicer.ui.FilamentMappingDialog(
                                            canonicalList = narrowedList,
                                            extruderPresets = bambuSlotPresets,
                                            initialMapping = nightExternalSpoolRoute?.let { route ->
                                                List(narrowedList.size) { route }
                                            },
                                            plateFileIndices = plateFileIndices,'''
)
patch(
    '''                                            onConfirm = { mapping ->
                                                pendingBambuSend = null
                                                navigateTab(Routes.PRINTER)
                                                printerViewModel.beginSendPreparing()
                                                printerViewModel.sendBambuProjectAndPrint(''',
    '''                                            onConfirm = { mapping ->
                                                val externalIssue =
                                                    NightPrintExternalSpoolPolicy.mappingIssue(
                                                        nightExternalSpoolRoute, mapping
                                                    )
                                                if (externalIssue != null) {
                                                    printerViewModel.reportSendError(externalIssue)
                                                } else {
                                                pendingBambuSend = null
                                                navigateTab(Routes.PRINTER)
                                                printerViewModel.beginSendPreparing()
                                                printerViewModel.sendBambuProjectAndPrint('''
)
patch(
    '''                                                    useAms = true,
                                                )
                                            },
                                            onDismiss = { pendingBambuSend = null },
                                            title = "Bambu AMS Mapping",''',
    '''                                                    useAms = NightPrintExternalSpoolPolicy.useAms(
                                                        nightExternalSpoolRoute
                                                    ),
                                                )
                                                }
                                            },
                                            onDismiss = { pendingBambuSend = null },
                                            title = "Bambu AMS Mapping",'''
)
patch(
    '''                                            invalidMappingMessage = { mapping ->
                                                if (pending.project.requiresFilamentTrackSwitch''',
    '''                                            invalidMappingMessage = { mapping ->
                                                val externalIssue =
                                                    NightPrintExternalSpoolPolicy.mappingIssue(
                                                        nightExternalSpoolRoute, mapping
                                                    )
                                                if (externalIssue != null) {
                                                    externalIssue
                                                } else if (pending.project.requiresFilamentTrackSwitch'''
)
# Checks for accidentally removing the real send action or the already
# existing compiler-enforced printer/slicing flow.
for must in (
    'printerViewModel.sendBambuProjectAndPrint(',
    'pendingBambuSend = PendingBambuSend(',
    'validateBambuAmsMapping(',
    'nightExternalSpoolRoute',
):
    if must not in content:
        raise RuntimeError("STOP: lost original printer flow " + must)

main.write_text(content, encoding="utf-8")
copy = [
    ("NightPrintExternalSpoolPolicy.kt",
     "app/src/main/java/com/u1/slicer/NightPrintExternalSpoolPolicy.kt"),
    ("NightPrintExternalSpoolPolicyTest.kt",
     "app/src/test/java/com/u1/slicer/NightPrintExternalSpoolPolicyTest.kt"),
]
for from_name, to_name in copy:
    dest = root / to_name
    if dest.exists():
        raise RuntimeError("STOP: external spool helper already exists: " + to_name)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src / from_name, dest)

print("External-spool only candidate installed; requires JVM+device tests, no print started.")
