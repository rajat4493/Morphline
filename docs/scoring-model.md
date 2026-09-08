# Scoring Model

Implemented in `scoring/`. Rule-first: every score is computed from
structured evidence in the `ProcessModel`, never from an LLM call (D-006,
Rule 3, Rule 7).

## Shape of a dimension score

```json
{
  "dimension": "tool_readiness",
  "score": 35,
  "level": "LOW",
  "confidence": "HIGH",
  "evidence": [
    "Customer update uses UI selector (CustomerUpdate.xaml)",
    "No HTTP/API activity detected for the update step",
    "SAP UI automation dependency detected (UiPath.SAP.Activities)"
  ],
  "explanation": "The process remains heavily dependent on UI-level automation."
}
```

- `score`: 0-100, normalized.
- `level`: `LOW` (0-39) / `MEDIUM` (40-69) / `HIGH` (70-100).
- `confidence`: `LOW`/`MEDIUM`/`HIGH` — how much evidence backed this score,
  independent of the score value itself. Fewer than 2 evidence items caps
  confidence at `MEDIUM`; zero evidence forces `LOW` and the explanation
  states `INSUFFICIENT EVIDENCE` (Section 22).
- `evidence`: human-readable strings, each traceable back to a source file
  and activity/dependency (Section 6).
- `explanation`: one sentence, generated from the rule that fired, not free
  text from an LLM.

## The twelve dimensions and their rule basis

| Dimension | Primary signals |
|---|---|
| Reasoning Need | Presence of ambiguous decision points: multi-branch `If`/`Switch` on non-boolean derived data, free-text classification steps, absence of a deterministic rule table, business rules marked as judgment-based. |
| Determinism Value | Inverse-weighted with Reasoning Need; boosted by presence of compliance/business rules requiring exact repeatability. |
| Blast Radius | Detected systems affected (count + type), whether the process writes/mutates external system state vs. read-only, customer-facing constraint category hits. |
| Reversibility | Presence/absence of compensating or rollback logic, whether actions are creates/updates (harder to reverse) vs. reads. |
| Compliance Sensitivity | Business rules mentioning regulated domains, mandatory human checkpoints, asset names/selectors suggesting regulated systems (heuristic keyword match, marked `INFERRED`). |
| Observability | Presence of logging activities, exception handlers with structured logging, retry scopes; absence of any error handling drags this down. |
| Tool / API Readiness | Ratio of `ApiCall` steps to UI-automation (`Click`/`Type`/selector-based) steps across the workflow. |
| Data Readiness | Presence of structured data sources (Excel/DB/API reads) vs. reliance on OCR/free text extraction. |
| Human Approval Need | Count of `HumanCheckpoint`s, presence of task/approval activities. |
| Exception Complexity | Ratio of generic `catch(Exception)`/rethrow handlers (ambiguous) vs. typed, specific catch blocks (deterministic); exception path count relative to step count. |
| Dependency Complexity | Count of distinct external systems + invoked workflows + package dependencies; unresolved/`UNKNOWN` dependencies increase this. |
| Runtime Stability | `UNKNOWN`/no evidence unless `RuntimeEvidence` is explicitly supplied (Section 24) — never fabricated. |

See `scoring/dimensions.py` for the exact rule implementation per
dimension and `scoring/engine.py` for how the twelve scores are assembled.
A single optional summary score (simple weighted mean, clearly labeled
"summary, not a hidden black box") may be shown in the UI, but every
recommendation traces to the dimension level, not the summary number
(Section 9).
