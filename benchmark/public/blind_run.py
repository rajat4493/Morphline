"""Blind v1 run: Morphline's unmodified pipeline over the pinned public
corpus. Reads NO labels. Refuses to overwrite an existing results file
(immutability): later runs must use a new --out name (e.g. post-fix-v2).

Usage: python -m benchmark.public.blind_run [--out public-heldout-blind-v1.json]
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import time
import traceback
import zipfile
from pathlib import Path

from apps.api.app.pipeline import run_ingestion
from recommendation.engine import recommend
from scoring.engine import score_process

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "benchmark" / "cache" / "public-heldout"
RESULTS = ROOT / "benchmark" / "results"


def zip_project(d: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(d.rglob("*")):
            if p.is_file() and ".git" not in p.relative_to(d).parts:
                z.write(p, p.relative_to(d).as_posix())
    return buf.getvalue()


def run_one(item: dict) -> dict:
    out = {"benchmark_id": item["benchmark_id"], "repository": item["repository"], "source_commit": item["pinned_commit"]}
    t = time.perf_counter()
    try:
        pm = run_ingestion(f"{item['benchmark_id']}.zip", zip_project(CACHE / item["benchmark_id"]))
    except Exception as e:  # parser failures stay visible (counted, never dropped)
        out.update(parser_outcome="PARSER_FAILED", failure=f"{type(e).__name__}: {e}", traceback=traceback.format_exc()[-1500:])
        out["seconds"] = time.perf_counter() - t
        return out
    scores = score_process(pm, None)
    rec = recommend(pm, scores, None)
    out.update(
        parser_outcome="PARSED", parser_warnings=list(pm.parser_warnings),
        workflows=len(pm.workflows), systems=[s.name for s in pm.systems],
        scores={k: {"level": v.level.value, "score": v.score, "confidence": v.confidence.value} for k, v in scores.items()},
        recommendation=dict(current_state=rec.current_state.value, recommended_state=rec.recommended_state.value,
                            maximum_safe_state=rec.maximum_safe_state.value, next_possible_state=rec.next_possible_state.value,
                            recommended_pattern=rec.recommended_pattern.value, confidence=rec.confidence.value,
                            why_this=rec.why_this, why_not_further=[{"type": w.reason_type.value, "text": w.text} for w in rec.why_not_further],
                            missing_evidence=rec.missing_evidence, constraints=[c.category.value for c in rec.constraints]),
        architecture_result="NOT_RECORDED (requires platform catalog; out of scope for blind v1)",
    )
    out["seconds"] = time.perf_counter() - t
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public-heldout-blind-v1.json")
    a = ap.parse_args()
    dest = RESULTS / a.out
    if dest.exists():
        raise SystemExit(f"{dest} exists and is immutable; choose a new --out name")
    manifest = json.loads((ROOT / "benchmark" / "public_manifest.json").read_text())
    results = [run_one(p) for p in manifest["projects"]]
    RESULTS.mkdir(exist_ok=True)
    doc = {"corpus_version": manifest["corpus_version"], "manifest_sha256": hashlib.sha256((ROOT / "benchmark" / "public_manifest.json").read_bytes()).hexdigest(),
           "morphline_commit": __import__("subprocess").run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip(),
           "results": results}
    dest.write_text(json.dumps(doc, indent=2))
    for r in results:
        rec = r.get("recommendation", {})
        print(r["benchmark_id"], r["parser_outcome"], rec.get("recommended_state"), rec.get("recommended_pattern"), len(r.get("parser_warnings", [])), r.get("failure", ""))


if __name__ == "__main__":
    main()
