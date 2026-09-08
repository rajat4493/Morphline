# Duck Handoff — Continuity Contract

**Purpose of this file:** let a coding agent with zero conversation history
pick up exactly where the last one stopped. If you are that agent: read
this file fully before reading anything else, including other docs.

---

## Last agent / Last verified commit

- Last agent: Claude (Sonnet 5), this session.
- Last verified commit before this phase started: `d8fa96a` — "Fix parser
  misclassifying compiled-XAML metadata as workflow steps."
- Test baseline at start of this phase: **63 passed**, 0 failed
  (`pytest -q` from repo root).
- This phase's target commit(s): estate intelligence phase (see "Current
  task" below). Update this section again at the end with the new commit
  hash and new test count.

---

## Product intent (locked)

Morphline started as: *"upload one UiPath process, assess whether it
should become more agentic."* That is now a solved, tested, commodity
capability — a competent engineer with Claude/GPT and one XAML file can
reproduce a single-process assessment in one conversation. It is no longer
where Morphline's value lives.

**Morphline's value must now come from what does NOT fit in one
conversation:** an estate graph across many automations, cross-process
dependency intelligence, persistent institutional memory of constraints
and how they change over time, unlock analysis (what one platform change
frees up across the estate), and what-if simulation. See Section 1-3 of
the task brief that opened this phase (preserved in git history / the
originating conversation) for the full framing; the short version:

> If Claude can inspect the same process and reproduce the answer in one
> conversation, what does Morphline own that Claude does not? The answer
> must increasingly become: estate graph, cross-process dependency
> intelligence, persistent institutional memory, constraint propagation,
> unlock analysis, reassessment over time, migration outcome learning,
> eventually proof/behavioral validation.

## Locked principles (do not relitigate)

1. **Do not maximize autonomy.** Hybrid may be the permanently-correct
   architecture. Deterministic RPA may remain correct forever.
2. **Current implementation ≠ latent opportunity.** A process's existing
   AI usage never drives its recommendation (see `docs/scoring-model.md`).
3. **Absence of evidence is not evidence of safety.** Missing Business
   Context caps autonomy; it is never treated as "probably fine."
4. **Never fabricate certainty.** No invented ROI, no invented runtime
   data, no invented regulatory facts, no silently-merged ambiguous
   dependencies. Unknown stays `UNKNOWN`.
5. **LLM proposes/explains; deterministic evidence is authoritative.**
   (See `llm/provider.py`.) This phase extends what the LLM may be asked
   to summarize/explain at the estate level, but the same rule applies —
   an LLM must never invent API availability, merge dependencies, or
   override a constraint.
6. **Simulation must never mutate real stored state.** A what-if result
   is always clearly separated from the real, persisted assessment.
7. **Existing UiPath automation can remain a valid tool forever** — inside
   a hybrid architecture, inside an agent-orchestrated pattern, or as-is.
   Modernization is not automatically "replace RPA with an agent."
8. **This is a continuity-first project.** `docs/DUCK_HANDOFF.md` must be
   updated before ending any work session on this repo, and read in full
   before starting one.

## TheDuck learning captured so far (reusable by future agents)

- Single-process intelligence is easy to replicate with a raw LLM call
  over one file. It is not defensible on its own.
- Defensibility increases when information **compounds** — the 50th
  automation uploaded should make the platform smarter about the 3rd one,
  not just add a row to a table.
- Persistent constraints create longitudinal value: knowing a blocker
  existed in 2026-09 and was still open in 2027-06 is worth more than
  knowing it exists today.
- Shared-dependency unlock analysis is what turns "an assessment tool" into
  "a thing a CIO makes a budget decision from."
- Simulation (what-if) creates decision-support value precisely because it
  is *not* real — architects need to explore "what if we fixed X" without
  fear of corrupting the audit trail.
- Every new capability should be graded against: **does this get more
  valuable as more automations are added, or would it be exactly as good
  with just one?** If the answer doesn't change with scale, it's UI
  polish, not estate intelligence.

---

## Current architecture (as of the start of this phase)

```
apps/web        Next.js + TypeScript + Tailwind + React Flow frontend
apps/api        FastAPI backend + SQLAlchemy models (SQLite, Postgres-portable)
packages/shared Canonical automation model + BusinessContext + scoring/
                recommendation types (Pydantic) — platform-independent
parser/uipath   UiPath-specific ingestion (only UiPath-aware code)
scoring         Rule-based, evidence-typed dimension scoring (13 dimensions)
recommendation  Evolution-state + Migration Pattern decision engine
memory          Constraint memory + evolution history + reassessment diff
migration       Migration pack generation
llm             Optional LLM provider abstraction (narrative only)
fixtures/uipath 9 synthetic + 1 real (sanitized) UiPath projects
tests/, apps/api/tests/  63 tests
```

Everything above operates on **one `Automation` at a time**. There is
currently no cross-automation model, no normalization layer, and no
estate-level computation beyond the simple aggregate counts in
`apps/api/app/routers/dashboard.py` (total processes, evolution-state
histogram, naive top-constraints-by-raw-category-string count — this
existing dashboard does NOT normalize dependencies across automations and
will be superseded/extended by this phase's estate intelligence, not
duplicated).

### Persisted entities (`apps/api/app/models/orm.py`) before this phase

`Workspace → Automation → ProcessVersion → Assessment → 
{AssessmentDimension, Recommendation}`; `Automation → Constraint`
(process-level, lifecycle ACTIVE/RESOLVED/POSSIBLY_RESOLVED/ACCEPTED_RISK/
UNKNOWN); `Automation → BusinessContextRow` (one per automation, not per
version); `Automation → EvolutionEvent` (timeline); `MigrationRun`.

### Canonical model (`packages/shared/canonical.py`)

`ProcessModel` holds `workflows[]`, `dependencies[]` (kind=package|
invoked_workflow), `systems[]` (name + interaction_mode, e.g. "SAP" /
ui_automation), `queues[]`, `assets[]`, `apis[]`, plus exception paths,
human checkpoints, runtime evidence. **System/dependency names are raw
strings from the parser** (e.g. "SAP", "Unidentified UI Application",
literal invoked-workflow filenames) — there has been no cross-automation
normalization of these strings before this phase. This is precisely the
gap Section on "canonical identity" in this phase's brief addresses.

### Scoring (13 dimensions, see `docs/scoring-model.md`)

`current_ai_usage` (descriptive only) / `reasoning_opportunity` (drives
Evolution Value) / `determinism_value` / `blast_radius` / `reversibility`
/ `compliance_sensitivity` / `observability` / `execution_tool_readiness`
/ `data_readiness` / `human_approval_need` / `exception_complexity` /
`dependency_complexity` / `runtime_stability`. Every `DimensionScore`
carries `evidence: EvidenceItem[]` typed TECHNICAL/BUSINESS/RUNTIME/
INFERRED, each with its own KNOWN/INFERRED/UNKNOWN confidence.

`execution_tool_readiness` currently produces a single 0-100 score + level
from a ratio of "stable" (API/DB/queue/bounded-subprocess) vs. "brittle"
(inline UI automation) surfaces (`scoring/dimensions.py::
ExecutionSurfaceProfile`). This phase's brief asks for this to become a
richer, non-collapsed profile (API coverage / reusable-subprocess coverage
/ queue-tool coverage / UI dependency, each independently leveled) — see
"Current task" below; `ExecutionSurfaceProfile` already exists as the
right seam to extend, it just needs to stop being purely an internal
counting helper and become a serializable, displayed profile.

### Recommendation engine (`recommendation/engine.py`)

`Evolution Value` (composite, reasoning_opportunity-dominant) vs. `Safety
Ceiling` (risk dimensions + `BusinessContext.has_critical_unknowns()`
capping autonomy on mutating processes with unconfirmed enterprise risk).
Produces `EvolutionState` + `MigrationPattern` + `WhyNotReason[]` typed
BLOCKED/UNKNOWN/NOT_READY/NOT_VALUABLE + `missing_evidence[]`.

### Constraint memory (`memory/constraints.py`, `memory/diff.py`)

Per-automation only before this phase. Reconciliation is category-keyed;
`POSSIBLY_RESOLVED` exists for constraints whose original evidence was
`INFERRED` rather than `KNOWN`. `INSUFFICIENT_BUSINESS_CONTEXT` is a
constraint category. **No shared/estate-level constraint concept exists
yet** — this is new in this phase.

### Frontend (`apps/web/src`)

`/` (workspace list), `/workspaces/[id]` (estate dashboard — currently
single-workspace aggregate counts only, no cross-process dependency view),
`/workspaces/[id]/upload`, `/automations/[id]` (tabbed detail: Overview,
Process Flow — React Flow + dagre, currently renders every parsed `Step`
including structural containers 1:1, which is the "raw node dump" problem
flagged for this phase — Evolution Assessment, Why/Why Not, Business
Context — editable form, triggers reassessment, Dependencies, Constraints,
Evolution History, Evidence).

---

## Completed capabilities (verified, do not re-litigate scope)

1. Safe UiPath ingestion (`.nupkg`/`.zip`/`.xaml`), validated against a
   real Studio-compiled export (`fixtures/uipath/real_world_invoice_processing/`,
   sanitized — its one DPAPI-protected credential blob was redacted before
   commit). Zero parser warnings on that fixture.
2. 13-dimension evidence-typed scoring; reasoning need is explicitly split
   from current AI usage (the core repair from the previous phase).
3. Evolution Value + Safety Ceiling recommendation engine; Migration
   Pattern selection recognizing reusable UiPath subprocesses as valid
   tools (`AGENT_ORCHESTRATED_RPA_TOOLS`).
4. BusinessContext as a first-class, persisted, human-supplied model;
   saving it triggers reassessment; unknown critical fields cap autonomy.
5. Per-automation constraint memory with RESOLVED vs. POSSIBLY_RESOLVED
   distinction, evolution timeline, reassessment diff (technical +
   business-context changes + migration-pattern changes).
6. Migration pack generation (11 files including Business Context).
7. Full frontend for the single-automation flow, screenshot-verified.

## Verified evidence

- `pytest -q` from repo root: 63 passed (baseline for this phase).
- Manual: seeded 8 synthetic fixtures + 1 real fixture through the full
  API, screenshotted the UI (Overview, Process Flow, Why/Why Not,
  Business Context, Constraints, Evidence tabs) — all render correctly.
- Real-world fixture specifically validates the parser against dense,
  Studio-compiled XAML (metadata skipping, `.Body` unwrapping, disabled
  `CommentOut` block exclusion) — see `docs/uipath-parser.md` and
  `tests/test_real_world_xaml.py`.

## Known defects / gaps (honest, as of start of this phase)

- **No cross-automation intelligence at all.** This is the entire point
  of this phase, not a bug per se, but stated here so it's never mistaken
  for "already handled."
- Estate dashboard (`apps/api/app/routers/dashboard.py`) computes
  "top_constraints" by grouping raw `Constraint.category` strings — this
  double-counts unrelated constraints that happen to share a category
  (e.g. two different UNSTABLE_UI_DEPENDENCY constraints against two
  unrelated systems look identical) and has no concept of *which system or
  component* is actually the shared root cause. Superseded, not
  duplicated, by this phase's shared-constraint model.
- Process Flow tab renders every parsed `Step` 1:1, including single-child
  structural `Sequence` wrappers that add no semantic value — confirmed
  "raw node dump" complaint from real-world testing. Flagged for a
  targeted (not total-rewrite) fix in this phase.
- `execution_tool_readiness` collapses API/DB/queue/subprocess/UI signals
  into one ratio — flagged for a richer profile in this phase.
- No normalization layer for system/component names across automations
  ("SAP" vs "SAP GUI" vs "SAP Production" are unrelated strings today).

## Open decisions made during this phase (record as you make them)

*(Fill in as you go if you are continuing this work. As of the plan
below, the following calls have been made — see `docs/decisions.md` for
the numbered entries once written:)*

- Estate graph, shared constraints, and unlock opportunities are
  **computed on demand from existing per-automation data**, not
  persisted as a duplicate universe (per the brief's own instruction not
  to build a "separate duplicate universe" and not to reach for a graph
  database). The only *new persisted* tables are: `CanonicalSystemRow`
  (+ its aliases) for the normalization dictionary (this must persist —
  it's a growing piece of institutional knowledge and user-confirmable
  state), and `EnvironmentEventRow` for the longitudinal "environment
  changed on this date" memory the brief explicitly asks for.
- Simulation (`SimulationScenario`/`SimulationOverride`/`SimulationResult`)
  is entirely in-memory / request-response — never persisted — which is
  the simplest possible way to guarantee it can never corrupt real state.
- The estate graph visualization reuses React Flow (already a dependency)
  in a shallow two-level clustering mode (hub node + spoke automations),
  rather than introducing a dedicated graph-visualization library or a
  graph database. Modes: by system, by constraint, by component, by
  evolution state.
- No new heavy infrastructure (no graph DB, no message queue, no
  microservices) — explicitly ruled out by the brief.

---

## Current task

Implement the estate-intelligence phase per the originating brief:
1. Canonical identity/normalization layer (`CanonicalSystem`,
   `CanonicalComponent`, `AliasMapping`) — deterministic first, user
   confirmation second, LLM suggestion later (stub only this phase).
2. Estate graph computed from existing per-automation data (no duplicate
   storage), exposed via API, with a clustered (not spiderweb) frontend
   visualization.
3. Shared-constraint detection: group per-automation constraints by
   canonical dependency, expose "how many automations does this block."
4. `UnlockOpportunity` computation: for a canonical dependency/constraint,
   simulate it resolved and report which automations' recommended states
   would change (never mutating real data).
5. What-if simulation engine (`SimulationScenario` → `SimulationResult`),
   isolated from real state.
6. `EnvironmentEventRow` — longitudinal memory of environment changes
   ("SAP API became available in 2027-02"), surfacing potentially-affected
   automations for *manual* reassessment (never auto-upgrading them).
7. Modernization priority ranking over unlock opportunities (LOW/MEDIUM/
   HIGH or UNKNOWN — never invented monetary value).
8. Execution Surface Profile: stop collapsing tool readiness into one
   ratio; expose API/subprocess/queue/UI-dependency sub-levels.
9. Reusable-tool detection heuristic refinement (bounded I/O, naming,
   isolation signals) surfaced explicitly per invoked workflow.
10. Process Flow graph readability fix: collapse semantically-empty
    single-child container wrappers; group invoked workflows as
    subprocess blocks.
11. Estate-level LLM tasks (summarize cluster, explain shared blocker,
    propose alias groupings) added to `llm/provider.py`, `NullLLMProvider`
    default keeps working with zero LLM configured.
12. Verification ledger (`docs/verification-ledger.md`) — new file.
13. Estate UAT section appended to `docs/UAT.md`.
14. Fixtures/tests for Cases A-H from the brief.
15. Frontend: Estate Overview (upgrade), Dependencies/Systems,
    Constraints (shared), Unlock Opportunities, What-If Simulator pages.

## Next actions (if you are picking this up mid-phase)

Check `docs/verification-ledger.md` first — it tracks per-capability
status (VERIFIED/IN PROGRESS/NOT STARTED). Then run `pytest -q` and
compare the count against "Test baseline" in this file. Anything not
marked VERIFIED in the ledger with a passing test is unfinished, not
assumed-working.

## Do not change

- The per-automation scoring/recommendation engine's *conceptual* rules
  (reasoning opportunity vs. current AI usage separation, safety ceiling
  logic, migration pattern selection) — this phase composes on top of
  that engine, it does not re-litigate it. Only `execution_tool_readiness`
  gets an additive profile expansion, not a rule-logic rewrite.
- `parser/uipath/xaml.py`'s metadata-skipping fix from the previous phase
  — do not revert to walking every element as a candidate step.
- Existing test files under `tests/` and `apps/api/tests/` — extend, don't
  weaken, per explicit instruction in the brief.
- The `BusinessContext` model shape — estate features consume it, they
  don't change its fields.

## Risks / assumptions

- Deterministic name normalization (strip noise tokens, lowercase, punct)
  will under-merge some real aliases (e.g. wildly different abbreviations)
  and this is intentional — better to require manual confirmation than to
  silently merge ambiguous dependencies, per the brief.
- Estate-level computations run over all of a workspace's automations at
  request time (no caching/materialization) — acceptable at V0 scale
  (dozens of automations), would need revisiting before hundreds+.
- `EnvironmentEventRow` is workspace-scoped and manually entered by a
  human (no live Orchestrator integration — explicitly out of scope this
  phase and every phase so far).

---

*(Update the section below at the end of this phase with the final
verified state before ending the session.)*

## End-of-phase status (fill in when done)

- Final commit hash:
- Final test count:
- Verification ledger status:
- Summary of what shipped vs. what was deliberately deferred:
