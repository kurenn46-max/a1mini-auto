#!/usr/bin/env python3
"""NIGHT PRINT V4.0.2 isolated A1 mini local job identity compatibility fix.

Run on the pinned upstream Android source *after* the V4.0.1 overlay.
This is a FIELD-TEST candidate; it does not send or start print jobs.
"""
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
client = root / "app/src/main/java/com/u1/slicer/printer/BambuLanClient.kt"
source = client.read_text(encoding="utf-8")

# On a local A1 mini SD-card print, project/task/subtask IDs are "0".
# Preserve unique sequence_id for response tracking and no-duplicate-send.
# Do not alter the legacy A-series, P/X series or H2D paths.
replacements = {
    '.put("project_id", submissionId)': '.put("project_id", if (model == BambuModel.A1_MINI) "0" else submissionId)',
    '.put("task_id", submissionId)': '.put("task_id", if (model == BambuModel.A1_MINI) "0" else submissionId)',
    '.put("subtask_id", submissionId)': '.put("subtask_id", if (model == BambuModel.A1_MINI) "0" else submissionId)',
}
for before, after in replacements.items():
    if source.count(before) != 1:
        raise SystemExit("STOP: unexpected start-command code, do not build: " + before)
    source = source.replace(before, after, 1)

# Fail closed if unique sequence or protective no-retry behaviour was removed.
for required in (
    "val sequenceId = submissionId.toInt()",
    "activeSession.session.publish(requestTopic(config), payload)",
    "The app did not retry because that could start the same print twice.",
):
    if required not in source:
        raise SystemExit("STOP: missing upstream safety invariant: " + required)

client.write_text(source, encoding="utf-8")
print("A1 mini-only local project ID fix applied; not hardware verified")
