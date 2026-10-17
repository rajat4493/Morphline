"""Run: python -m benchmark.run [--scale N] [--out benchmark/results.md]

Metrics (all deterministic and reproducible; no LLM calls, so cost per
assessment is compute only):
  accuracy      recommended state within the expert-acceptable set
  pattern_acc   migration pattern within the acceptable set
  unsafe_rate   recommended state above the expert safety ceiling
  p50/p95 ms    parse+score+recommend latency per process
  throughput    processes/sec over an N-process synthetic estate
"""
from __future__ import annotations

import argparse
import statistics
import time
from pathlib import Path

from benchmark.baselines import BASELINES
from benchmark.corpus import CORPUS
from parser.uipath.parse import parse_project
from recommendation.engine import recommend
from scoring.engine import score_process

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"


def morphline(pm, scores):
    rec = recommend(pm, scores, None)
    return rec.recommended_state, rec.recommended_pattern


SYSTEMS = {"morphline": morphline, **BASELINES}


def evaluate() -> dict:
    out = {}
    for name, fn in SYSTEMS.items():
        ok = pat = unsafe = 0
        lat = []
        for lab in CORPUS:
            t = time.perf_counter()
            pm = parse_project(FIXTURES / lab.fixture, "zip")
            scores = score_process(pm, None)
            state, pattern = fn(pm, scores)
            lat.append((time.perf_counter() - t) * 1000)
            ok += state in lab.acceptable
            pat += pattern in lab.patterns
            unsafe += state.rank > lab.safety_ceiling.rank
        n = len(CORPUS)
        lat.sort()
        out[name] = dict(accuracy=ok / n, pattern_acc=pat / n, unsafe_rate=unsafe / n,
                         p50_ms=statistics.median(lat), p95_ms=lat[int(0.95 * (n - 1))])
    return out


def scale(n: int) -> dict:
    names = [l.fixture for l in CORPUS]
    t = time.perf_counter()
    for i in range(n):
        pm = parse_project(FIXTURES / names[i % len(names)], "zip")
        recommend(pm, score_process(pm, None), None)
    dt = time.perf_counter() - t
    return dict(n=n, seconds=dt, per_sec=n / dt)


def render(res: dict, sc: dict | None) -> str:
    lines = ["# Morphline benchmark", "",
             f"Corpus: {len(CORPUS)} synthetic fixtures, labels authored by the product team (unvalidated by external experts).", "",
             "| System | State accuracy | Pattern accuracy | Unsafe over-reach | p50 ms | p95 ms |", "|---|---|---|---|---|---|"]
    for k, v in res.items():
        lines.append(f"| {k} | {v['accuracy']:.0%} | {v['pattern_acc']:.0%} | {v['unsafe_rate']:.0%} | {v['p50_ms']:.1f} | {v['p95_ms']:.1f} |")
    if sc:
        lines += ["", f"Scale: {sc['n']} processes in {sc['seconds']:.1f}s ({sc['per_sec']:.0f}/s), single thread, no LLM cost."]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=int, default=0)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    text = render(evaluate(), scale(a.scale) if a.scale else None)
    print(text)
    if a.out:
        Path(a.out).write_text(text)
