"""Generate benchmark/reports/public-heldout-v1.md from frozen blind results,
provisional labels and adjudication notes. Usage: python -m benchmark.public.report"""
from __future__ import annotations

import json
from pathlib import Path

from benchmark.baselines import BASELINES
from benchmark.public.blind_run import CACHE, ROOT, zip_project
from benchmark.public.evaluate import compare, metrics, rank
from apps.api.app.pipeline import run_ingestion
from packages.shared.enums import EvolutionState as S, MigrationPattern as P
from scoring.engine import score_process


def always_aug(pm, scores):
    return S.AUGMENTED_RPA, P.RPA_WITH_AI_AUGMENTATION


def pct(x):
    return "n/a" if x is None else f"{x:.0%}"


def baseline_rows(manifest, labels):
    systems = {**BASELINES, "always_augmented": always_aug}
    out = {}
    for name, fn in systems.items():
        rows = []
        for p in manifest:
            pm = run_ingestion("p.zip", zip_project(CACHE / p["benchmark_id"]))
            st, pat = fn(pm, score_process(pm, None))
            res = dict(benchmark_id=p["benchmark_id"], parser_outcome="PARSED", parser_warnings=[], workflows=1, seconds=0,
                       scores={"reasoning_opportunity": {"level": "NA"}},
                       recommendation=dict(recommended_state=st.value, recommended_pattern=pat.value, confidence="LOW", constraints=["INSUFFICIENT_BUSINESS_CONTEXT"], missing_evidence=[]))
            rows.append(compare(res, labels[p["benchmark_id"]]))
        out[name] = metrics(rows, [dict(parser_outcome="PARSED", parser_warnings=[], workflows=1, seconds=0)] * len(rows))
    return out


def main() -> None:
    res_doc = json.loads((ROOT / "benchmark/results/public-heldout-blind-v1.json").read_text())
    results = res_doc["results"]
    lab_doc = json.loads((ROOT / "benchmark/labels/public-heldout-v1.json").read_text())
    labels = {l["benchmark_id"]: l for l in lab_doc["labels"]}
    adj = json.loads((ROOT / "benchmark/labels/public-heldout-v1-adjudication.json").read_text())
    manifest = json.loads((ROOT / "benchmark/public_manifest.json").read_text())["projects"]
    held = [p for p in manifest if not p["used_in_product_development"]]
    rows = [compare(r, labels[r["benchmark_id"]]) for r in results if r["parser_outcome"] == "PARSED" and r["benchmark_id"] in {p["benchmark_id"] for p in held}]
    m = metrics(rows, results)
    lenient = sum(r["state_exact"] or labels[r["id"]]["expert_architecture"]["disagreements_allowed"].count(r["morphline_state"]) > 0 for r in rows) / len(rows)
    base = baseline_rows(held, labels)
    rb = {r["benchmark_id"]: r for r in results}
    L = []
    w = L.append
    w("# Public held-out benchmark — report v1 (blind)\n")
    w("> Results are preliminary. Labels are **provisional expert architecture labels** written by the product team after the blind run; they are not ground truth. Independent expert adjudication and sanitized enterprise-process validation remain required.\n")
    w("## A. Executive summary\n")
    w(f"On this public held-out corpus ({m['n']} real UiPath projects, none used in development), Morphline's frozen blind-v1 run achieved **{pct(m['state_exact'])} exact state agreement** ({pct(lenient)} if labeler-allowed alternatives are accepted), **{pct(m['state_adjacent'])} adjacent-state agreement**, **{pct(m['pattern_exact'])} exact pattern agreement**, {pct(m['unsafe_over_reach'])} over-reach (all one level, AUGMENTED vs DETERMINISTIC) and {pct(m['conservative_under_reach'])} under-reach, with {pct(m['parser_coverage'])} parser coverage.\n")
    w("**Morphline recommended AUGMENTED_RPA for all 10 projects.** It behaved as a constant predictor: it did not separate deterministic bots from the hard-negative or hard-positive cases, and it **missed the one clear hard positive (R09)**. It is identical to the `ai_presence_heuristic` and `always_augmented` baselines, and it is **beaten by the trivial `always_deterministic` baseline** (60% exact, 0% over-reach) on this deterministic-heavy corpus. This benchmark does **not** show Morphline outperforming simple baselines; on this corpus it is worse than the simplest safe one.\n")
    w("## B. Corpus composition\n")
    w("| ID | Repository | Commit | License | Redistributable | Tags |\n|---|---|---|---|---|---|")
    for p in manifest:
        w(f"| {p['benchmark_id']} | {p['repository']} | `{p['pinned_commit'][:10]}` | {p['license']} | {p['redistributable']} | {', '.join(labels[p['benchmark_id']]['tags'])} |")
    w("\nSource is **not vendored**; `python -m benchmark.public.fetch` clones into gitignored `benchmark/cache/`.\n")
    w("## C. Contamination / development-leakage analysis\n")
    w("- Searched git history (`git log -S`) and all docs/code for all 10 repo names and owners: **0 hits**.\n- SHA-256 of every xaml in the corpus (98 files) compared with every fixture xaml: **0 matches**.\n- The only real-world fixture, `real_world_invoice_processing`, is project `Capstone-Project`, a different project from R06/R07.\n- Split: **HELD_OUT_PUBLIC = 10, REGRESSION = the 9 synthetic fixtures (separate benchmark), DEVELOPMENT = none of these.**\n- Residual risk: Morphline's authors (us) read these READMEs when writing this brief; no rule was tuned on them (blind v1 committed before labels existed, see git history).\n")
    w("## D. Per-project results\n")
    w("| ID | Project | Label conf. | Morphline state | Expected | Morphline pattern | Expected pattern | Over-reach | Under-reach | Reasoning (M / exp) | Disagreement class |\n|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        c = adj["cases"].get(r["id"], {}).get("class", [])
        w(f"| {r['id']} | {rb[r['id']]['repository'].split('/')[1]} | {r['label_confidence']} | {r['morphline_state']} | {r['expected_state']} | {r['morphline_pattern']} | {r['expected_pattern']} | {r['over_reach']} | {r['under_reach']} | {r['reasoning_morphline']} / {r['reasoning_expected']} | {', '.join(c) or 'agree'} |")
    w("\n## E. Aggregate metrics (Morphline, blind v1)\n")
    w("| Metric | Value |\n|---|---|")
    for k in ["state_exact", "state_adjacent", "pattern_exact", "unsafe_over_reach", "conservative_under_reach", "unknown_preservation", "no_fabricated_certainty", "parser_coverage"]:
        w(f"| {k} | {pct(m[k])} |")
    w(f"| parser_warnings_per_workflow | {m['parser_warnings_per_workflow']:.1f} |\n| median_seconds_per_project | {m['median_seconds']:.2f} |\n")
    w("## F. Hard negatives (R06, R08)\n")
    w(f"State accuracy {pct(m['hard_negative_accuracy'])}, over-reach {pct(m['hard_negative_over_reach'])}. Morphline did not mistake OCR/ML presence for agentic need — **but it also reported `current_ai_usage = LOW` for both, so it did not see the ML/OCR at all (Python Scope, OCR).** This is a pass for the wrong reason: the outcome is the same constant AUGMENTED output.\n")
    w("## G. Hard positive (R09)\n")
    w(f"Recall {pct(m['hard_positive_recall'])}. Morphline scored reasoning LOW ('no branching, review checkpoints, interpretive naming, or unstructured input detected') and AI usage LOW for a project that calls OpenAI STT/GenAI 13 times. Classified PARSER_LIMITATION + MORPHLINE_LIKELY_WRONG.\n")
    w("## H. UNKNOWN discipline\n")
    w(f"Morphline preserved unknown business context in {pct(m['unknown_preservation'])} of projects (INSUFFICIENT_BUSINESS_CONTEXT or Business Context in missing evidence, and confidence never HIGH). **Weak evidence:** confidence was LOW for all 10, so this metric cannot yet distinguish discipline from uniform caution. No enterprise-safety label was inferred from source (all UNKNOWN).\n")
    w("## I. Parser coverage\n")
    w(f"{pct(m['parser_coverage'])} of projects parsed without exception, but with **{m['parser_warnings_per_workflow']:.1f} warnings per workflow** (unclassified activities such as HttpClient, BuildDataTable, GetRobotCredential, UiPathScreenOCR). 'Parsed' overstates real coverage.\n")
    w("## J. Morphline vs naive baselines (same labels)\n")
    w("| System | State exact | Adjacent | Pattern exact | Over-reach | Under-reach |\n|---|---|---|---|---|---|")
    w(f"| **morphline (blind v1)** | {pct(m['state_exact'])} | {pct(m['state_adjacent'])} | {pct(m['pattern_exact'])} | {pct(m['unsafe_over_reach'])} | {pct(m['conservative_under_reach'])} |")
    for k, v in base.items():
        w(f"| {k} | {pct(v['state_exact'])} | {pct(v['state_adjacent'])} | {pct(v['pattern_exact'])} | {pct(v['unsafe_over_reach'])} | {pct(v['conservative_under_reach'])} |")
    w("\n`always_deterministic` beats Morphline here (60% vs 30%, 0% vs 60% over-reach) but is useless on the hard cases (hard-positive recall 0%, under-reach 40%): class imbalance (6 of 10 labeled deterministic) makes accuracy alone misleading. Morphline's own failure is that it adds nothing over a constant on either axis.\n")
    w("## K. Morphline vs LLM baseline\n")
    w("**BLOCKED:** no `ANTHROPIC_API_KEY` in this environment. `benchmark/public/llm_baseline.py` (fixed prompt `llm-architect-v1`, temperature 0, label-free evidence packets already generated and leak-checked) is ready to run. Running the baseline inside this session was rejected as contaminated (the session had seen Morphline outputs and labels).\n")
    w("## L. Failure / adjudication cases\n")
    for k, v in adj["cases"].items():
        w(f"- **{k}** [{', '.join(v['class'])}]: {v['note']}")
    w("\nGlobal findings:\n" + "\n".join(f"- {g}" for g in adj["global_findings"]) + "\n")
    w("## M. What this benchmark proves\n")
    w("- The pipeline runs end-to-end on 10 unseen real public UiPath projects without crashing, and never reported HIGH confidence under unknown business context.\n- Morphline did not escalate any project above AUGMENTED_RPA (no multi-level over-reach).\n- On this corpus Morphline does **not** distinguish deterministic, ML-augmented and genAI-reasoning processes: the discriminating dimensions (reasoning opportunity, AI usage) did not fire on real-world HTTP/Python-based AI, and the AUGMENTED floor applied regardless of evolution value.\n")
    w("## N. What it absolutely does NOT prove\n")
    w("- Not that Morphline is accurate, or better than RPA architects, UiPath, or any LLM (LLM baseline not run).\n- Not enterprise validity or that any recommendation is objectively correct; labels are provisional, single-author, n=10, with one hard positive.\n- Not safety in production: enterprise safety labels are UNKNOWN by design.\n- Nothing about scale or cost.\n")
    w("## O. TheDuck challenge pass\n")
    w("1. Real projects? Yes: public GitHub repos, fetched and SHA-verified (R05/R10 are UiPath REFramework-template derivatives; R06/R07 are near-blank student projects, so 'real' is not 'production-grade').\n2. Pinned? Yes, 40-char commit SHAs in the manifest.\n3. Used in development? No evidence (0 name hits, 0 xaml hash matches).\n4. Is public source enough for the labels? For current implementation, mostly. For reasoning opportunity, moderately (R07 DU usage unconfirmed). For safety ceiling, no: all UNKNOWN.\n5. Enterprise unknowns preserved? Labels: yes. Morphline: yes but uniformly LOW confidence.\n6. UI brittleness labeled agentic? No in labels; Morphline raised AUGMENTED despite LOW value (see adjudication).\n7. OCR/ML presence labeled reasoning need? No in labels; Morphline did not either, but largely did not detect ML/OCR/GenAI at all.\n8. Naive baseline suspiciously high? always_deterministic 60% > Morphline 30%, because 6/10 labels are deterministic. The corpus is imbalanced with a single hard positive (n=1: high variance).\n9. Both hard positives and negatives? Yes, but only 1 positive and 2 negatives.\n10. Gaming through leakage? Unlikely: no tuning, blind run committed before labels.\n11. LLM baseline competitive? Not run (blocked).\n12. Failures visible? Yes, none excluded; no parser exceptions occurred.\n13. Parser failures counted? Yes (0 of 10), plus warnings per workflow reported.\n14. Usefulness and safety vs accuracy? Reported separately, but 'usefulness' is only proxied by hard-positive recall.\n")
    out = ROOT / "benchmark/reports"; out.mkdir(exist_ok=True)
    (out / "public-heldout-v1.md").write_text("\n".join(L))
    print("\n".join(L[:12]))
    print(json.dumps(base, indent=1)[:900])


if __name__ == "__main__":
    main()
