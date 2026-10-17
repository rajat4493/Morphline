# Expert labeling guide (blind)

You will label real UiPath projects **without seeing Morphline's output**. Do not ask for it until you have submitted your forms.

## What you may use
Project source at the pinned commit (`benchmark/public_manifest.json`, fetched by `python -m benchmark.public.fetch`), its README, `project.json`, and your own experience. Do **not** infer customer impact, regulation, approvals, financial exposure or reversibility from source code: mark those `UNKNOWN`.

## Evolution states (pick the state the process *should* be in, not the one it is in)
1. `DETERMINISTIC_RPA` — rules/UI/API steps only; keeping it is the right answer.
2. `AUGMENTED_RPA` — deterministic flow with discrete AI helpers (OCR, classifier, extraction).
3. `HYBRID_AGENT` — deterministic backbone with an agent making bounded decisions.
4. `ADVANCED_HYBRID` — agent plans over multiple tools with guardrails.
5. `HIGH_AUTONOMY` — agent end to end.

## Migration patterns
`KEEP_DETERMINISTIC_RPA`, `RPA_WITH_AI_AUGMENTATION`, `DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION`, `AGENT_ORCHESTRATED_RPA_TOOLS`, `AGENT_WITH_API_TOOLS`, `HYBRID_WITH_HUMAN_APPROVAL`, `HIGH_AUTONOMY_AGENT`.

## Rules
- Do not maximize autonomy. Staying deterministic is a valid, often correct answer.
- Existing AI/OCR/ML usage is **not** evidence the process needs more autonomy.
- UI brittleness is an integration/modernization problem, not an agentic opportunity.
- A business rule is not a reasoning opportunity if the rule is explicit.
- Absence of safety information is not safety. `maximum_safe_state` should be `UNKNOWN` unless the source directly evidences the risk facts.

## Confidence
`HIGH` / `MEDIUM` / `LOW` / `UNKNOWN`, given separately for (a) current implementation, (b) recommended state, (c) maximum safe state. It is normal to be HIGH on (a) and LOW on (c).

## Submit
Copy `case_form_blank.json` once per case, fill it, save as `<case>_<yourid>.json`. Do not discuss cases with other labelers before submitting. Disagreements are adjudicated afterwards.
