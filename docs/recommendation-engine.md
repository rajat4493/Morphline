# Recommendation Engine

Implemented in `recommendation/engine.py`. Answers two questions for every
process: **WHY THIS STATE?** and **WHY NOT THE NEXT STATE?** (Section 11).
The second is treated as at least as important as the first — see Rule 2:
never recommend autonomy merely because an LLM/agent could technically do
the task, or because good tooling exists with nothing else to justify going
further.

## Two independent judgments

Neither one alone determines the final recommendation:

### 1. Evolution Value (`_evolution_value`) — "would this help at all?"

A composite, not `reasoning_opportunity` alone (Section 12):

```
evolution_value = 0.55 × reasoning_opportunity
                + 0.20 × exception_complexity        (ambiguous/repeated fallback routing)
                + 0.15 × (100 − data_readiness)       (unstructured-data reliance)
                + 0.10 × human_approval_need           (manual-intervention volume)
```

`current_ai_usage` never appears in this formula (see
`docs/scoring-model.md`). The desired state is then read off this
composite: `>=70` → High Autonomy, `40-69` → Hybrid Agent, `<40` →
Augmented RPA if there's *any* tool/data readiness at all, else stays
Deterministic RPA.

This directly implements the two worked examples in Section 12: a process
with low reasoning opportunity, low exception complexity, and low manual
intervention stays deterministic **even with excellent APIs** — good
tooling alone no longer inflates the desired state.

### 2. Safety Ceiling (`determine_ceiling`) — "what's safe today?"

Driven by risk-side dimensions, same structure as before, plus one new,
critical rule:

- `execution_tool_readiness == LOW` → capped at Augmented RPA.
- A **confirmed** (Business-Context-backed, `confidence == HIGH`) blast
  radius, compliance, or reversibility risk → capped at Hybrid Agent,
  and the corresponding "Why Not Further" reason is `BLOCKED`.
- An **unconfirmed** risk (keyword-inferred compliance, no-rollback-found
  reversibility) → also capped at Hybrid Agent, but the reason is
  `UNKNOWN`, not `BLOCKED` — the system is honest that it doesn't yet know
  whether this is really a problem (Section 7/9/14).
- `observability == LOW` → capped at Hybrid Agent.
- `dependency_complexity == HIGH` → capped at Advanced Hybrid.
- **`INSUFFICIENT_BUSINESS_CONTEXT`** (Section 13): if the process can
  mutate production state (`process_has_mutating_authority()`) and any
  critical Business Context field is still `UNKNOWN`
  (`BusinessContext.has_critical_unknowns()`), the ceiling is capped at
  Hybrid Agent **regardless of whether any other constraint fired**.
  Absence of evidence is not evidence of safety — a clean-looking process
  with nothing confirmed is not the same as a process confirmed safe.

`recommended_state = min(desired-from-evolution-value, ceiling)`.

## Migration Pattern (Section 11)

A `MigrationPattern` is chosen on top of the evolution state
(`_select_migration_pattern`), since two processes at the same state can
call for different architectures:

| Recommended state | Pattern chosen |
|---|---|
| Deterministic RPA | `KEEP_DETERMINISTIC_RPA` |
| Augmented RPA | `RPA_WITH_AI_AUGMENTATION` |
| High Autonomy | `HIGH_AUTONOMY_AGENT` |
| Hybrid Agent / Advanced Hybrid, mandatory approval required | `HYBRID_WITH_HUMAN_APPROVAL` |
| Hybrid Agent / Advanced Hybrid, reusable bounded UiPath subprocesses dominate | `AGENT_ORCHESTRATED_RPA_TOOLS` |
| Hybrid Agent / Advanced Hybrid, APIs dominate | `AGENT_WITH_API_TOOLS` |
| Hybrid Agent, no strong tool signal either way | `DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION` |

Existing UiPath subprocesses are a **valid deterministic tool** an agent
can orchestrate (`AGENT_ORCHESTRATED_RPA_TOOLS`) — UI automation is only
treated as unsafe when it's inlined directly in the orchestrator workflow
with no encapsulation (see `execution_tool_readiness` in
`docs/scoring-model.md`). This is exercised by the `ui_heavy_reusable_tools`
fixture and its test (Section 20 Case 4).

## Why Not Further: four distinct reasons (Section 14)

`WhyNotReason.reason_type` is one of:

- **`BLOCKED`** — a confirmed risk or requirement stands in the way.
- **`UNKNOWN`** — a risk-relevant fact hasn't been confirmed yet (includes
  `INSUFFICIENT_BUSINESS_CONTEXT`).
- **`NOT_READY`** — tooling/observability isn't there yet
  (`UNSTABLE_UI_DEPENDENCY`, `WEAK_OBSERVABILITY`).
- **`NOT_VALUABLE`** — further autonomy wouldn't meaningfully help. Used
  when there are no active constraints *and* Evolution Value is itself low
  (`< 25`): "This process is already highly deterministic and shows little
  evidence of ambiguity... there is no meaningful reason to make this more
  autonomous." This is a first-class, intentional product output, not a
  fallback failure message (Section 14/28).

The UI never merges these into one flat list — see the "Why / Why Not" tab,
which renders a colored badge per reason.

## Worked example (matches the illustrative case in the product brief)

A process with high reasoning opportunity, strong tool readiness, and
Business-Context-confirmed compliance sensitivity + reversibility:

- Evolution Value driven high by reasoning opportunity → desired High
  Autonomy.
- Ceiling: tool readiness is fine, but compliance and reversibility are
  *confirmed* HIGH-risk → ceiling = Hybrid Agent, reasons `BLOCKED`.
- Recommended = min(High Autonomy, Hybrid Agent) = **Hybrid Agent**.
- Pattern: mandatory approval confirmed → `HYBRID_WITH_HUMAN_APPROVAL`.

Without that Business Context supplied, the same technical profile still
caps at Hybrid Agent — but every reason reads `UNKNOWN`, not `BLOCKED`,
and an additional `INSUFFICIENT_BUSINESS_CONTEXT` reason appears. Both
paths are exercised in `tests/test_case_scenarios.py`.

## Confidence

`RecommendationResult.confidence` is downgraded when multiple underlying
dimensions had `LOW` confidence, and additionally whenever
`BusinessContext.has_critical_unknowns()` is true — a recommendation built
on thin technical evidence *or* missing enterprise context says so rather
than presenting false certainty (Rule 4).
