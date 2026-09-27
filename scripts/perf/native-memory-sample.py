"""Sample one explicitly launched native process group, never unrelated WebViews.

Usage: python scripts/perf/native-memory-sample.py .tmp/rc5-launch.json OUTPUT.json
Start from the same isolated APPDATA fixture and executable for comparisons.
Reports private commit, private working set, and RSS separately; no forced GC.
"""
from pathlib import Path
import datetime
import hashlib
import json
import statistics
import subprocess
import sys
import time
import psutil

launch_path, output_path = map(Path, sys.argv[1:3])
launch = json.loads(launch_path.read_text(encoding="utf-8"))
root = psutil.Process(launch["pid"])
exe = Path(root.exe()).resolve()
assert exe == Path(launch["exe"]).resolve(), "PID no longer belongs to the launched executable"
samples = []
for _ in range(5):
    rows = []
    for process in [root, *root.children(recursive=True)]:
        try:
            memory = process.memory_full_info()
            role = next((arg.split("=", 1)[1] for arg in process.cmdline() if arg.startswith("--type=")), "native" if process.pid == root.pid else "browser")
            rows.append({"pid": process.pid, "role": role, "privateCommit": memory.private, "privateWorkingSet": memory.uss, "workingSet": memory.rss})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    assert rows and any(row["pid"] == root.pid for row in rows), "Application exited during measurement"
    samples.append(rows)
    time.sleep(0.4)
probe = subprocess.run(["node", str(Path(__file__).with_name("native-memory-probe.mjs")), str(launch["port"])], capture_output=True, text=True, check=True)
report = {"measuredAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "executable": str(exe), "sha256": hashlib.file_digest(exe.open("rb"), "sha256").hexdigest(), "profile": launch["profile"], "samples": samples, "medianMiB": {field: round(statistics.median(sum(row[field] for row in sample) for sample in samples) / 1048576, 2) for field in ["privateCommit", "privateWorkingSet", "workingSet"]}, "webview": json.loads(probe.stdout)}
output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"output": str(output_path), "medianMiB": report["medianMiB"], "webview": report["webview"]}))
