# Scoring Model

Implemented in `scoring/`. Rule-first: every score is computed from
structured evidence — parsed technical facts, supplied Business Context, or
supplied runtime data — never from an LLM call (D-006, Rule 3, Rule 7).

## Current Implementation vs. Latent Opportunity

This is the most important structural idea in the scoring model (see
`docs/product-thesis.md`). Two dimensions exist specifically to keep these
separate, and neither may leak into the other:

- **`current_ai_usage`** ("Current AI / Reasoning Usage") — descriptive
  only. Counts AI/LLM-classified activities already present in the
  implementation. Listed in
  `packages/shared/enums.py::DESCRIPTIVE_ONLY_DIMENSIONS` and explicitly
  excluded from `summary_score()` and from every recommendation-engine
  calculation (`recommendation/engine.py` never reads it).
- **`reasoning_opportunity`** — the dimension that actually drives Evolution
  Value (see `docs/recommendation-engine.md`). Estimates whether the
  underlying process contains work that would benefit from contextual
  reasoning, using signals that are deliberately *not* "does an AI activity
  exist here":
  - Manual review/approval checkpoints (`HumanCheckpoint`s) — the strongest
    signal: a human is already exercising judgment, with or without AI.
  - Branching density (If/Switch) — a weak, capped signal on its own; a
    branch on a deterministic boolean is not reasoning (explicitly not
    over-weighted, per the original bug this repair fixes).
  - **Purpose-name keyword matches** — a step's *display name* says what
    it's trying to accomplish (review, assess, determine, classify,
    investigate, decide, evaluate, interpret, check eligibility, compare
    evidence, route case, summarize, generate report, analyze, escalate,
    …), independent of what activity type implements it. A match on a step
    that *also* happens to be AI-tagged is treated as **corroborated**
    (two independent signals agree) and weighted higher; a match on any
    other step is a weaker, uncorroborated signal. This is what lets a
    zero-AI process (Section 20 Case 1) score HIGH, and what stops an
    AI activity whose *purpose* is mechanical (Case 7) from inflating the
    score just because it happens to call an LLM.
  - Unstructured input sources (email reading, OCR/document extraction)
    not already credited above.
  - Exception/fallback repetition (ambiguous failure handling).
  - Explicit-rule-table absence (many branches, no captured `BusinessRule`).

  Every evidence item is tagged `INFERRED` (naming heuristics, branch
  counts) or `TECHNICAL`/`KNOWN` (a checkpoint or unstructured-source
  activity actually being present) — never presented as more certain than
  it is.

`determinism_value` moves inversely to `reasoning_opportunity` (not to
`current_ai_usage`).

## Evidence types

Every `EvidenceItem` (`packages/shared/scoring_types.py`) carries a `type`
in addition to its per-item `confidence` (KNOWN/INFERRED/UNKNOWN):

| Type | Meaning |
|---|---|
| `TECHNICAL` | Parsed directly from the UiPath package. |
| `BUSINESS` | Supplied by a human via Business Context. |
| `RUNTIME` | Supplied Orchestrator/runtime evidence. |
| `INFERRED` | A heuristic guess — keyword match, naming pattern. |

The UI groups evidence by this type (Section 6/18) rather than flattening
everything into one anonymous bulleted list, so a reader can see at a
glance whether a HIGH score rests on a confirmed business fact or a single
inferred keyword hit.

## Dimensions

| Dimension | Primary signals |
|---|---|
| Current AI / Reasoning Usage | *Descriptive only.* Ratio of AI/LLM-classified activities to leaf activities. |
| Reasoning Opportunity | See above. Drives Evolution Value. |
| Determinism Value | Inverse of Reasoning Opportunity. |
| Blast Radius | Business Context impact/scope fields (primary) plus technical mutation authority and downstream propagation (secondary, banded — never raw count multiplication; Section 8). |
| Reversibility | Business Context `irreversible_action` if supplied (authoritative); otherwise a technical "no rollback code found" signal capped at LOW confidence — never presented as certain (Section 9). |
| Compliance Sensitivity | Business Context `regulated_process`/`mandatory_approval` if supplied (authoritative, can reach HIGH); otherwise keyword matching only, capped at MEDIUM and LOW/MEDIUM confidence — keyword hits alone can never claim HIGH (Section 7). |
| Observability | Logging activity count, exception handling presence, runtime selector-failure-rate if supplied. |
| Execution Tool Readiness | APIs, databases, queues, **and reusable UiPath subprocesses with declared arguments** (a `STABLE_RPA_TOOL`), vs. UI automation inlined directly in the orchestrator workflow (a `BRITTLE_UI_DEPENDENCY`). Existing RPA is not automatically brittle (Section 10). |
| Data Readiness | Ratio of structured (API/DB/Excel) to unstructured (OCR/document) data activities. |
| Human Approval Need | Existing checkpoints plus Business Context `mandatory_approval`. |
| Exception Complexity | Presence/absence of handling, retry vs. bare rethrow. |
| Dependency Complexity | Count of distinct systems/dependencies, weighted by unresolved (`UNKNOWN`) ones. |
| Runtime Stability | Only ever populated from explicitly supplied `RuntimeEvidence` — never fabricated (Section 24). |

## Shape of a dimension score

```json
{
  "dimension": "blast_radius",
  "score": 65,
  "level": "HIGH",
  "confidence": "MEDIUM",
  "evidence": [
    {"type": "BUSINESS", "source": "Business Context", "confidence": "KNOWN",
     "description": "Business Context marks impact HIGH (HIGH)"},
    {"type": "TECHNICAL", "source": "parsed workflow", "confidence": "KNOWN",
     "description": "Mutation propagates to 2 distinct downstream system(s)"}
  ],
  "explanation": "A wrong decision here can affect multiple systems, customers, or a meaningful scope of the business."
}
```

- `score`: 0-100, an internal/secondary UI convenience only.
- `level`: `LOW`/`MEDIUM`/`HIGH` — the primary display value (Section 19:
  never implies "73 is scientifically superior to 68").
- `confidence`: how much evidence backs the score, independent of the score
  value. A dimension can be `LEVEL=HIGH, CONFIDENCE=LOW` (a risky-looking
  but unconfirmed signal) — the UI must show both, never collapse them.
- `evidence`: structured `EvidenceItem[]`, never anonymous strings.
- `explanation`: one sentence, generated from the rule that fired.

A single optional summary score (simple weighted mean, excluding the
descriptive-only `current_ai_usage` dimension) may be shown in the UI, but
every recommendation traces to the dimension level, not the summary number
(Section 9/19).
