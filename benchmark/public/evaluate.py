"""Compare a frozen results file to provisional labels. Never mutates either.
Usage: python -m benchmark.public.evaluate [--results public-heldout-blind-v1.json]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from packages.shared.enums import EvolutionState as S

ROOT = Path(__file__).resolve().parents[2]
HARD_NEG, HARD_POS = ["R06", "R08"], ["R09"]


def rank(s: str) -> int:
    return S(s).rank


def has_biz_unknown(rec: dict) -> bool:
    return "INSUFFICIENT_BUSINESS_CONTEXT" in rec["constraints"] or any("Business Context" in m for m in rec["missing_evidence"])


def compare(res: dict, lab: dict) -> dict:
    rec, e = res["recommendation"], lab["expert_architecture"]
    ms, es = rank(rec["recommended_state"]), rank(e["recommended_state"])
    return dict(id=res["benchmark_id"], morphline_state=rec["recommended_state"], expected_state=e["recommended_state"],
                morphline_pattern=rec["recommended_pattern"], expected_pattern=e["recommended_pattern"],
                state_exact=ms == es, state_adjacent=abs(ms - es) <= 1, pattern_exact=rec["recommended_pattern"] == e["recommended_pattern"],
                over_reach=ms > es, under_reach=ms < es,
                reasoning_morphline=res["scores"]["reasoning_opportunity"]["level"], reasoning_expected=e["reasoning_opportunity"],
                unknown_preserved=rec["confidence"] != "HIGH" and has_biz_unknown(rec),
                no_fabricated_certainty=rec["confidence"] != "HIGH",
                label_confidence=e["label_confidence"], tags=lab["tags"])


def metrics(rows: list[dict], results: list[dict]) -> dict:
    n = len(rows)
    f = lambda k, rs=rows: sum(r[k] for r in rs) / len(rs) if rs else None
    hn = [r for r in rows if r["id"] in HARD_NEG]
    hp = [r for r in rows if r["id"] in HARD_POS]
    parsed = [r for r in results if r["parser_outcome"] == "PARSED"]
    return dict(n=n, state_exact=f("state_exact"), state_adjacent=f("state_adjacent"), pattern_exact=f("pattern_exact"),
                unsafe_over_reach=f("over_reach"), conservative_under_reach=f("under_reach"),
                hard_negative_accuracy=f("state_exact", hn), hard_negative_over_reach=f("over_reach", hn),
                hard_positive_recall=(sum(r["morphline_state"] == r["expected_state"] or rank(r["morphline_state"]) >= rank(r["expected_state"]) for r in hp) / len(hp)) if hp else None,
                unknown_preservation=f("unknown_preserved"), no_fabricated_certainty=f("no_fabricated_certainty"),
                parser_coverage=len(parsed) / len(results),
                parser_warnings_per_workflow=sum(len(r["parser_warnings"]) for r in parsed) / max(1, sum(r["workflows"] for r in parsed)),
                median_seconds=sorted(r["seconds"] for r in results)[len(results) // 2])


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--results", default="public-heldout-blind-v1.json"); a = ap.parse_args()
    results = json.loads((ROOT / "benchmark/results" / a.results).read_text())["results"]
    labels = {l["benchmark_id"]: l for l in json.loads((ROOT / "benchmark/labels/public-heldout-v1.json").read_text())["labels"]}
    manifest = {p["benchmark_id"]: p for p in json.loads((ROOT / "benchmark/public_manifest.json").read_text())["projects"]}
    rows = [compare(r, labels[r["benchmark_id"]]) for r in results if r["parser_outcome"] == "PARSED" and not manifest[r["benchmark_id"]]["used_in_product_development"]]
    print(json.dumps(metrics(rows, results), indent=2))
    for r in rows:
        if not (r["state_exact"] and r["pattern_exact"]):
            print(r["id"], r["morphline_state"], "vs", r["expected_state"], "|", r["morphline_pattern"], "vs", r["expected_pattern"])


if __name__ == "__main__":
    main()
