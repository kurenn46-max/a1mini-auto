#!/usr/bin/env python3
"""Static fail-closed regression for A1 mini local project-file start patch."""
from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess
import sys

patch = Path(__file__).with_name("apply_v402_a1mini_local_start_fix.py")
with TemporaryDirectory() as tmp:
    target = Path(tmp) / "app/src/main/java/com/u1/slicer/printer/BambuLanClient.kt"
    target.parent.mkdir(parents=True)
    target.write_text(
        'val sequenceId = submissionId.toInt()\n'
        'activeSession.session.publish(requestTopic(config), payload)\n'
        'The app did not retry because that could start the same print twice.\n'
        '.put("project_id", submissionId)\n'
        '.put("task_id", submissionId)\n'
        '.put("subtask_id", submissionId)\n'
    )
    result = subprocess.run([sys.executable, str(patch), tmp], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    source = target.read_text()
    assert source.count('if (model == BambuModel.A1_MINI) "0" else submissionId') == 3
    assert 'val sequenceId = submissionId.toInt()' in source
    assert 'activeSession.session.publish' in source
    assert 'did not retry' in source

    # Reapplying a patch or drifting from pinned upstream must fail closed.
    again = subprocess.run([sys.executable, str(patch), tmp], capture_output=True)
    assert again.returncode != 0

print("PASS: A1 mini only, unique sequence kept, no-retry guard preserved, drift fails closed")
