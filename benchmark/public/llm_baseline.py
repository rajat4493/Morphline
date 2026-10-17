"""LLM_ARCHITECT_BASELINE. Fixed prompt, fixed config, no Morphline output and
no labels in the prompt. BLOCKED in sessions without ANTHROPIC_API_KEY.

Usage: python -m benchmark.public.llm_baseline [--packets-only]
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

from apps.api.app.pipeline import run_ingestion
from benchmark.public.blind_run import CACHE, ROOT, zip_project

PROMPT_VERSION = "llm-architect-v1"
MODEL = os.environ.get("BASELINE_MODEL", "claude-opus-5-5")
TEMPERATURE = 0
SYSTEM = (
    "You are a senior enterprise RPA/automation architect. Given evidence about ONE UiPath project, answer in JSON only. "
    "Evolution states: DETERMINISTIC_RPA, AUGMENTED_RPA, HYBRID_AGENT, ADVANCED_HYBRID, HIGH_AUTONOMY. "
    "Patterns: KEEP_DETERMINISTIC_RPA, RPA_WITH_AI_AUGMENTATION, DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION, AGENT_ORCHESTRATED_RPA_TOOLS, AGENT_WITH_API_TOOLS, HYBRID_WITH_HUMAN_APPROVAL, HIGH_AUTONOMY_AGENT. "
    "Principles: do not maximize autonomy; existing AI usage is not evidence a process needs more autonomy; "
    "UI brittleness is not an agentic opportunity; unknown business context must stay unknown. "
    'Keys: current_state, recommended_state, recommended_pattern, reasoning_opportunity (LOW|MEDIUM|HIGH), '
    'maximum_safe_state (a state or "UNKNOWN"), missing_evidence (list), why_not_further (list).'
)


def packet(item: dict) -> str:
    d = CACHE / item["benchmark_id"]
    meta = (d / "project.json").read_text(encoding="utf-8-sig", errors="ignore")[:4000]
    readme = next(iter(d.glob("README*")), None)
    readme_txt = readme.read_text(encoding="utf-8", errors="ignore")[:6000] if readme else "(none)"
    pm = run_ingestion("p.zip", zip_project(d))
    summary = {"workflows": [w.file for w in pm.workflows][:40], "systems": [s.name for s in pm.systems],
               "step_types": sorted({s.display_name for s in pm.all_steps()})[:120]}
    return f"project.json:\n{meta}\n\nREADME:\n{readme_txt}\n\nExtracted technical evidence:\n{json.dumps(summary, ensure_ascii=False)}\n\nBusiness Context: none supplied (all UNKNOWN)."


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--packets-only", action="store_true"); a = ap.parse_args()
    manifest = json.loads((ROOT / "benchmark/public_manifest.json").read_text())["projects"]
    out = ROOT / "benchmark/results"; out.mkdir(exist_ok=True)
    packets = {p["benchmark_id"]: packet(p) for p in manifest}
    (ROOT / "benchmark/cache/llm-packets.json").write_text(json.dumps(packets, ensure_ascii=False, indent=1))
    if a.packets_only:
        print(f"wrote {len(packets)} label-free packets"); return
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("BLOCKED: ANTHROPIC_API_KEY not set; LLM baseline not run")
    import anthropic
    client, res = anthropic.Anthropic(), []
    for k, text in packets.items():
        t = time.perf_counter()
        r = client.messages.create(model=MODEL, max_tokens=1200, temperature=TEMPERATURE, system=SYSTEM, messages=[{"role": "user", "content": text}])
        res.append(dict(benchmark_id=k, model=MODEL, temperature=TEMPERATURE, prompt_version=PROMPT_VERSION,
                        input_tokens=r.usage.input_tokens, output_tokens=r.usage.output_tokens, seconds=time.perf_counter() - t,
                        output="".join(b.text for b in r.content if hasattr(b, "text"))))
    (out / "public-heldout-llm-baseline-v1.json").write_text(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
