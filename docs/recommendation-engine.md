# Recommendation Engine

Implemented in `recommendation/engine.py`. Answers two questions for every
process: **WHY THIS STATE?** and **WHY NOT THE NEXT STATE?** (Section 11).
The second is treated as at least as important as the first — see Rule 2:
never recommend autonomy merely because an LLM/agent could technically do
the task.

## The two-part decision

1. **Desired state** (`_desired_state`): what the process's *reasoning
   profile* alone would justify — driven by `reasoning_need` (and, when
   reasoning need is low, whether any tool/data readiness exists at all to
   distinguish "stays fully deterministic" from "augmented").
2. **Ceiling** (`determine_ceiling`): the maximum state considered *safe*
   today, driven entirely by risk-side dimensions:
   - `tool_readiness == LOW` → capped at Augmented RPA (an agent cannot be
     trusted to operate ambiguous authority through brittle UI selectors).
   - `blast_radius == HIGH` or `compliance_sensitivity == HIGH` or
     `reversibility == LOW` → capped at Hybrid Agent (a human must remain
     accountable for irreversible or high-impact/regulated decisions).
   - `observability == LOW` → capped at Hybrid Agent (incorrect autonomous
     behavior would not be reliably detected).
   - Otherwise → Advanced Hybrid / High Autonomy is available.

The **recommended state is `min(desired, ceiling)`** — reasoning need can
only pull the recommendation up to the ceiling, never past it. This is the
literal implementation of "do not maximize autonomy."

Every ceiling-triggering condition also becomes a `ConstraintDraft` (see
`docs/constraint-memory.md`), so "why not further" is never a vague
sentence — it is the same structured list that persists into constraint
memory.

## Worked example (matches the illustrative case in the product brief)

A process with high reasoning need, strong tool readiness, high compliance
sensitivity, and low reversibility:

- Desired state (reasoning need HIGH) → High Autonomy.
- Ceiling: tool readiness is fine, but compliance is HIGH and reversibility
  is LOW → ceiling = Hybrid Agent.
- Recommended = min(High Autonomy, Hybrid Agent) = **Hybrid Agent**.
- Why this: reasoning need and tool readiness support agent involvement.
- Why not further: compliance exposure and poor reversibility require a
  human to remain accountable for the final action.

This is exercised as an automated test against the `customer_exclusion`
sample fixture in `tests/test_recommendation.py`.

## Confidence

`RecommendationResult.confidence` is downgraded when multiple underlying
dimensions had `LOW` confidence (i.e., were themselves `INSUFFICIENT
EVIDENCE`) — a recommendation built on thin evidence says so rather than
presenting false certainty (Rule 4).
