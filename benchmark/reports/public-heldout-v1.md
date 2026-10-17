# Public held-out benchmark — report v1 (blind)

> Results are preliminary. Labels are **provisional expert architecture labels** written by the product team after the blind run; they are not ground truth. Independent expert adjudication and sanitized enterprise-process validation remain required.

## A. Executive summary

On this public held-out corpus (10 real UiPath projects, none used in development), Morphline's frozen blind-v1 run achieved **30% exact state agreement** (40% if labeler-allowed alternatives are accepted), **100% adjacent-state agreement**, **30% exact pattern agreement**, 60% over-reach (all one level, AUGMENTED vs DETERMINISTIC) and 10% under-reach, with 100% parser coverage.

**Morphline recommended AUGMENTED_RPA for all 10 projects.** It behaved as a constant predictor: it did not separate deterministic bots from the hard-negative or hard-positive cases, and it **missed the one clear hard positive (R09)**. It is identical to the `ai_presence_heuristic` and `always_augmented` baselines, and it is **beaten by the trivial `always_deterministic` baseline** (60% exact, 0% over-reach) on this deterministic-heavy corpus. This benchmark does **not** show Morphline outperforming simple baselines; on this corpus it is worse than the simplest safe one.

## B. Corpus composition

| ID | Repository | Commit | License | Redistributable | Tags |
|---|---|---|---|---|---|
| R01 | Ronak77/Generate-Yearly-Report-Dispatcher | `075e62d38d` | NONE FOUND (all rights reserved by default) - not redistributable | False | real-public, uipath, reframework, dispatcher, queue, excel, ui-heavy, deterministic, reasoning-light, held-out, reporting |
| R02 | whooaaapppp/yearlyreport-performer | `ad5b1b3715` | NONE FOUND (all rights reserved by default) - not redistributable | False | real-public, uipath, reframework, performer, queue, excel, mail, ui-heavy, deterministic, reasoning-light, held-out, reporting |
| R03 | agussaputran/bi-kurs-web-scrape | `6926a40bf7` | NONE FOUND (all rights reserved by default) - not redistributable | False | real-public, uipath, sequence, excel, ui-heavy, web-ui, nupkg, deterministic, reasoning-light, held-out, data-entry |
| R04 | AsmaTrabelsi/RPA-Excel-Data-Entry-Automation | `6722da1831` | NONE FOUND (all rights reserved by default) - not redistributable | False | real-public, uipath, sequence, excel, web-ui, desktop-ui, data-entry, deterministic, reasoning-light, held-out |
| R05 | abhi-sachdev20/uipath-employee-onboarding-ref | `0cb5cb9bfd` | MIT (Copyright 2019 UiPath; REFramework template license) | True | real-public, uipath, reframework, queue, excel, deterministic, reasoning-light, held-out, HR |
| R06 | mohammedraees07/invoice-automation-uipath | `1f9c085d5c` | NONE FOUND (all rights reserved by default) - not redistributable | False | real-public, uipath, sequence, excel, document-processing, OCR, invoice-processing, augmented-current, reasoning-light, hard-negative, held-out, finance |
| R07 | balasaravanan-dev/UiPath-InvoiceProcessingAutomationWorkflow | `abefff3cdc` | NONE FOUND (all rights reserved by default) - not redistributable | False | real-public, uipath, sequence, document-processing, excel, mail, invoice-processing, augmented-current, reasoning-light, hard-negative, held-out, finance |
| R08 | Rotomator/email-automation | `2746a7264d` | GPL-3.0 | True | real-public, uipath, reframework, email, ML, augmented-current, hard-negative, held-out, customer-service |
| R09 | Manyong1204/uipath-ai-customer-service-automation | `34bf276ef4` | NONE FOUND (all rights reserved by default) - not redistributable | False | real-public, uipath, genAI, STT, email, customer-service, augmented-current, reasoning-heavy, hard-positive, held-out |
| R10 | BhargavPrashant/SAP_Automation | `922247c695` | MIT (Copyright 2019 UiPath; REFramework template license) | True | real-public, uipath, reframework, ui-heavy, deterministic, reasoning-light, held-out, invoice-processing, finance |

Source is **not vendored**; `python -m benchmark.public.fetch` clones into gitignored `benchmark/cache/`.

## C. Contamination / development-leakage analysis

- Searched git history (`git log -S`) and all docs/code for all 10 repo names and owners: **0 hits**.
- SHA-256 of every xaml in the corpus (98 files) compared with every fixture xaml: **0 matches**.
- The only real-world fixture, `real_world_invoice_processing`, is project `Capstone-Project`, a different project from R06/R07.
- Split: **HELD_OUT_PUBLIC = 10, REGRESSION = the 9 synthetic fixtures (separate benchmark), DEVELOPMENT = none of these.**
- Residual risk: Morphline's authors (us) read these READMEs when writing this brief; no rule was tuned on them (blind v1 committed before labels existed, see git history).

## D. Per-project results

| ID | Project | Label conf. | Morphline state | Expected | Morphline pattern | Expected pattern | Over-reach | Under-reach | Reasoning (M / exp) | Disagreement class |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | Generate-Yearly-Report-Dispatcher | HIGH | AUGMENTED_RPA | DETERMINISTIC_RPA | RPA_WITH_AI_AUGMENTATION | KEEP_DETERMINISTIC_RPA | True | False | MEDIUM / LOW | MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY |
| R02 | yearlyreport-performer | HIGH | AUGMENTED_RPA | DETERMINISTIC_RPA | RPA_WITH_AI_AUGMENTATION | KEEP_DETERMINISTIC_RPA | True | False | MEDIUM / LOW | MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY |
| R03 | bi-kurs-web-scrape | HIGH | AUGMENTED_RPA | DETERMINISTIC_RPA | RPA_WITH_AI_AUGMENTATION | KEEP_DETERMINISTIC_RPA | True | False | LOW / LOW | MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY |
| R04 | RPA-Excel-Data-Entry-Automation | HIGH | AUGMENTED_RPA | DETERMINISTIC_RPA | RPA_WITH_AI_AUGMENTATION | KEEP_DETERMINISTIC_RPA | True | False | LOW / LOW | MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY |
| R05 | uipath-employee-onboarding-ref | HIGH | AUGMENTED_RPA | DETERMINISTIC_RPA | RPA_WITH_AI_AUGMENTATION | KEEP_DETERMINISTIC_RPA | True | False | MEDIUM / LOW | MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY |
| R06 | invoice-automation-uipath | MEDIUM | AUGMENTED_RPA | AUGMENTED_RPA | RPA_WITH_AI_AUGMENTATION | RPA_WITH_AI_AUGMENTATION | False | False | LOW / LOW | agree |
| R07 | UiPath-InvoiceProcessingAutomationWorkflow | MEDIUM | AUGMENTED_RPA | AUGMENTED_RPA | RPA_WITH_AI_AUGMENTATION | RPA_WITH_AI_AUGMENTATION | False | False | LOW / LOW_TO_MEDIUM | agree |
| R08 | email-automation | HIGH | AUGMENTED_RPA | AUGMENTED_RPA | RPA_WITH_AI_AUGMENTATION | RPA_WITH_AI_AUGMENTATION | False | False | LOW / MEDIUM | agree |
| R09 | uipath-ai-customer-service-automation | HIGH | AUGMENTED_RPA | HYBRID_AGENT | RPA_WITH_AI_AUGMENTATION | DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION | False | True | LOW / HIGH | PARSER_LIMITATION, MORPHLINE_LIKELY_WRONG, NEEDS_HUMAN_ADJUDICATION |
| R10 | SAP_Automation | HIGH | AUGMENTED_RPA | DETERMINISTIC_RPA | RPA_WITH_AI_AUGMENTATION | KEEP_DETERMINISTIC_RPA | True | False | MEDIUM / LOW | MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY |

## E. Aggregate metrics (Morphline, blind v1)

| Metric | Value |
|---|---|
| state_exact | 30% |
| state_adjacent | 100% |
| pattern_exact | 30% |
| unsafe_over_reach | 60% |
| conservative_under_reach | 10% |
| unknown_preservation | 100% |
| no_fabricated_certainty | 100% |
| parser_coverage | 100% |
| parser_warnings_per_workflow | 4.6 |
| median_seconds_per_project | 0.24 |

## F. Hard negatives (R06, R08)

State accuracy 100%, over-reach 0%. Morphline did not mistake OCR/ML presence for agentic need — **but it also reported `current_ai_usage = LOW` for both, so it did not see the ML/OCR at all (Python Scope, OCR).** This is a pass for the wrong reason: the outcome is the same constant AUGMENTED output.

## G. Hard positive (R09)

Recall 0%. Morphline scored reasoning LOW ('no branching, review checkpoints, interpretive naming, or unstructured input detected') and AI usage LOW for a project that calls OpenAI STT/GenAI 13 times. Classified PARSER_LIMITATION + MORPHLINE_LIKELY_WRONG.

## H. UNKNOWN discipline

Morphline preserved unknown business context in 100% of projects (INSUFFICIENT_BUSINESS_CONTEXT or Business Context in missing evidence, and confidence never HIGH). **Weak evidence:** confidence was LOW for all 10, so this metric cannot yet distinguish discipline from uniform caution. No enterprise-safety label was inferred from source (all UNKNOWN).

## I. Parser coverage

100% of projects parsed without exception, but with **4.6 warnings per workflow** (unclassified activities such as HttpClient, BuildDataTable, GetRobotCredential, UiPathScreenOCR). 'Parsed' overstates real coverage.

## J. Morphline vs naive baselines (same labels)

| System | State exact | Adjacent | Pattern exact | Over-reach | Under-reach |
|---|---|---|---|---|---|
| **morphline (blind v1)** | 30% | 100% | 30% | 60% | 10% |
| always_max_autonomy | 0% | 0% | 0% | 100% | 0% |
| always_deterministic | 60% | 90% | 60% | 0% | 40% |
| ai_presence_heuristic | 30% | 100% | 30% | 60% | 10% |
| always_augmented | 30% | 100% | 30% | 60% | 10% |

`always_deterministic` beats Morphline here (60% vs 30%, 0% vs 60% over-reach) but is useless on the hard cases (hard-positive recall 0%, under-reach 40%): class imbalance (6 of 10 labeled deterministic) makes accuracy alone misleading. Morphline's own failure is that it adds nothing over a constant on either axis.

## K. Morphline vs LLM baseline

**BLOCKED:** no `ANTHROPIC_API_KEY` in this environment. `benchmark/public/llm_baseline.py` (fixed prompt `llm-architect-v1`, temperature 0, label-free evidence packets already generated and leak-checked) is ready to run. Running the baseline inside this session was rejected as contaminated (the session had seen Morphline outputs and labels).

## L. Failure / adjudication cases

- **R01** [MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY]: Morphline reported Evolution Value 11-ish/100 yet recommended AUGMENTED_RPA: engine._desired_state returns AUGMENTED whenever tool/data readiness is not LOW, independent of value. A low-value deterministic dispatcher should stay DETERMINISTIC_RPA per the product thesis. One-level difference, no autonomy increase in practice.
- **R02** [MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY]: Same readiness-driven AUGMENTED floor as R01.
- **R03** [MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY]: Reasoning LOW, AI usage LOW, yet AUGMENTED. UI brittleness correctly yields UNSTABLE_UI_DEPENDENCY, but that should not raise the recommended state.
- **R04** [MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY]: Same as R03.
- **R05** [MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY]: Reasoning scored MEDIUM, likely driven by REFramework template branching/BusinessRuleException structure rather than a judgment surface (label: explicit validation rules are not reasoning opportunity). Needs per-evidence trace before attributing.
- **R10** [MORPHLINE_LIKELY_WRONG, TAXONOMY_AMBIGUITY]: Reasoning scored MEDIUM on a deterministic REFramework UI bot; same suspected template-branching inflation as R05.
- **R09** [PARSER_LIMITATION, MORPHLINE_LIKELY_WRONG, NEEDS_HUMAN_ADJUDICATION]: Morphline scored reasoning LOW ('no branching, review checkpoints, interpretive naming, or unstructured input detected') and current_ai_usage LOW although the project makes 13 HttpClient calls to OpenAI STT/GenAI endpoints with ~17 Ifs. HTTP-based GenAI is invisible to the AI-usage and reasoning scorers; many activities unclassified. The label itself needs adjudication: current state is already GenAI-augmented, so AUGMENTED_RPA may be acceptable (see disagreements_allowed).

Global findings:
- On this corpus Morphline's recommended state was AUGMENTED_RPA for all 10 projects, i.e. it behaved as a constant predictor and did not separate deterministic, hard-negative and hard-positive cases.
- Parser emits ~4.6 warnings per workflow (unclassified activities, e.g. HttpClient, BuildDataTable, GetRobotCredential, UiPathScreenOCR): real-world parser coverage is shallow even though every project 'parsed'.
- 'unknown_preservation' = 100% is weak evidence: Morphline reports LOW confidence everywhere, so it cannot distinguish projects where context truly matters.

## M. What this benchmark proves

- The pipeline runs end-to-end on 10 unseen real public UiPath projects without crashing, and never reported HIGH confidence under unknown business context.
- Morphline did not escalate any project above AUGMENTED_RPA (no multi-level over-reach).
- On this corpus Morphline does **not** distinguish deterministic, ML-augmented and genAI-reasoning processes: the discriminating dimensions (reasoning opportunity, AI usage) did not fire on real-world HTTP/Python-based AI, and the AUGMENTED floor applied regardless of evolution value.

## N. What it absolutely does NOT prove

- Not that Morphline is accurate, or better than RPA architects, UiPath, or any LLM (LLM baseline not run).
- Not enterprise validity or that any recommendation is objectively correct; labels are provisional, single-author, n=10, with one hard positive.
- Not safety in production: enterprise safety labels are UNKNOWN by design.
- Nothing about scale or cost.

## O. TheDuck challenge pass

1. Real projects? Yes: public GitHub repos, fetched and SHA-verified (R05/R10 are UiPath REFramework-template derivatives; R06/R07 are near-blank student projects, so 'real' is not 'production-grade').
2. Pinned? Yes, 40-char commit SHAs in the manifest.
3. Used in development? No evidence (0 name hits, 0 xaml hash matches).
4. Is public source enough for the labels? For current implementation, mostly. For reasoning opportunity, moderately (R07 DU usage unconfirmed). For safety ceiling, no: all UNKNOWN.
5. Enterprise unknowns preserved? Labels: yes. Morphline: yes but uniformly LOW confidence.
6. UI brittleness labeled agentic? No in labels; Morphline raised AUGMENTED despite LOW value (see adjudication).
7. OCR/ML presence labeled reasoning need? No in labels; Morphline did not either, but largely did not detect ML/OCR/GenAI at all.
8. Naive baseline suspiciously high? always_deterministic 60% > Morphline 30%, because 6/10 labels are deterministic. The corpus is imbalanced with a single hard positive (n=1: high variance).
9. Both hard positives and negatives? Yes, but only 1 positive and 2 negatives.
10. Gaming through leakage? Unlikely: no tuning, blind run committed before labels.
11. LLM baseline competitive? Not run (blocked).
12. Failures visible? Yes, none excluded; no parser exceptions occurred.
13. Parser failures counted? Yes (0 of 10), plus warnings per workflow reported.
14. Usefulness and safety vs accuracy? Reported separately, but 'usefulness' is only proxied by hard-positive recall.
