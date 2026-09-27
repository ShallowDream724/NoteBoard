"""Read-only process-group sampler used by isolated browser performance tests."""
import json
import sys
import time
import psutil

root = psutil.Process(int(sys.argv[1]))
identity = (root.pid, root.create_time(), root.exe())
samples = []
for _ in range(7):
    assert root.is_running() and root.create_time() == identity[1], "Measurement root exited or PID was reused"
    rows = []
    for process in [root, *root.children(recursive=True)]:
        try:
            memory = process.memory_full_info()
            role = next((arg.split("=", 1)[1] for arg in process.cmdline() if arg.startswith("--type=")), "browser" if process.pid == root.pid else "other")
            rows.append({"pid": process.pid, "role": role, "privateCommit": memory.private, "privateWorkingSet": memory.uss, "workingSet": memory.rss})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    samples.append({"timestamp": time.time(), "processes": rows, **{field: sum(row[field] for row in rows) for field in ["privateCommit", "privateWorkingSet", "workingSet"]}})
    time.sleep(0.4)
print(json.dumps({"pid": identity[0], "createdAt": identity[1], "executable": identity[2], "samples": samples}))
