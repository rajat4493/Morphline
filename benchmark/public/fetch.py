"""Fetch pinned public sources into the gitignored cache and record license
status. Usage: python -m benchmark.public.fetch

Never vendors third-party code into git. Re-running verifies the pinned SHA.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "benchmark" / "public_manifest.json"
CACHE = ROOT / "benchmark" / "cache" / "public-heldout"


def run(*a, cwd=None):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def main() -> None:
    m = json.loads(MANIFEST.read_text())
    CACHE.mkdir(parents=True, exist_ok=True)
    for item in m["projects"]:
        dest = CACHE / item["benchmark_id"]
        if not dest.exists():
            run("git", "clone", "-q", f"https://github.com/{item['repository']}", str(dest))
        run("git", "checkout", "-q", item["pinned_commit"], cwd=dest)
        head = run("git", "rev-parse", "HEAD", cwd=dest)
        assert head == item["pinned_commit"], (item["benchmark_id"], head)
        lic = [p.name for p in dest.iterdir() if p.name.lower().startswith(("license", "copying"))]
        print(item["benchmark_id"], item["repository"], head[:10], "license files:", lic or "NONE")


if __name__ == "__main__":
    main()
