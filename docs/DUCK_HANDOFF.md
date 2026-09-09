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
  task" below). **See "End-of-phase status" near the bottom of this file
  for the final state — 79 passed, 0 failed.**

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
  database). The only *new persisted* tables are: `CanonicalDependencyRow`
  (+ its aliases, covering both SYSTEM and COMPONENT kinds in one table
  rather than separate `CanonicalSystem`/`CanonicalComponent` classes — an
  intentional simplification since both need identical alias/confidence
  machinery) for the normalization dictionary, and `EnvironmentEventRow`
  for the longitudinal "environment changed on this date" memory the brief
  explicitly asks for.
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

## Post-review correction sprint (read this first if you're picking up after §"Current task")

An external review of the estate phase's first commit (`2c09efe`) found two
P0 correctness issues and two P1 issues before the backend should be
trusted. All four are now fixed, each with a dedicated regression test:

1. **P0 — normalization could silently merge PROD/UAT/DEV.**
   `normalize_system_key` used to strip "production"/"uat"/"test"/"dev" as
   cosmetic noise, so "SAP PROD" and "SAP UAT" collapsed onto one canonical
   dependency — a real instance of the "never silently merge ambiguous
   dependencies" rule being violated by the phase's own normalization
   layer. **Fixed**: `estate/normalize.py::extract_environment` +
   `normalize_dependency_key` now keep environment as its own field
   (`CanonicalDependency.environment`) folded into the merge key, so two
   names only merge automatically when both the cleaned name AND the
   environment agree. A bare name with no environment marker gets its own
   UNKNOWN bucket rather than being assumed to mean PROD.
2. **P0 — "API becomes available" assumed a perfect API for every UI
   step, unlabeled.** The simulator converted every UI step touching the
   target system into a `POST` call regardless of what it did (Click
   Login, Type Username, Read Customer — all became identical "POST API"
   calls), and unlock analysis used this to compute estate-wide unlock
   counts. That's "assume full functional API replacement," not "API
   becomes available," and it was never labeled as such. **Fixed**:
   `SimulationOverride.capabilities` lets a caller state which operations
   (READ/WRITE) are actually confirmed; only matching steps convert
   (method is `GET`/`POST` based on classification, not always `POST`).
   With no capability list, the simulation still runs but is explicitly
   labeled `[FULL API-EQUIVALENCE ASSUMPTION]` and folded into
   `unresolved_factors`, which forces unlock confidence to LOW — so an
   un-confirmed assumption can never produce a MEDIUM/HIGH-confidence
   unlock number.
3. **P1 — shared-constraint attribution could blame the wrong system.**
   `UNSTABLE_UI_DEPENDENCY` used to be attributed to *every*
   `ui_automation` system a process touched, reconstructed after the fact
   from the whole process model. A bot with one stable (bounded-subprocess)
   system and one genuinely brittle inline system could make estate logic
   conclude the stable one was the blocker. **Fixed**: `ConstraintDraft`/
   `ConstraintRecord` now carry `dependency_hint`, set by
   `recommendation/engine.py::determine_ceiling` at creation time from real
   per-step evidence (which systems are actually touched by *brittle*,
   non-bounded UI steps) — `estate/graph.py` prefers this over
   reconstructing attribution later.
4. **P1 — `estimated_value` conflated technical leverage with business
   value.** Ranking purely on "unlocked / affected" ranked "unlocks 12 tiny
   bots" above "unlocks 2 processes worth £500M" as the same kind of win.
   **Fixed**: renamed to `unlock_leverage` (+ `leverage_is_unknown`), with
   the intended future formula documented (`unlock_leverage ×
   business_importance × feasibility × confidence`) but not implemented,
   since Business Context has no criticality/value signal yet to multiply
   by — ranking still uses leverage alone, now honestly named.

New tests: `test_normalization_never_merges_different_environments`,
`test_simulation_labels_full_api_equivalence_and_lowers_confidence`,
`test_simulation_capability_limited_does_not_convert_uncovered_operations`,
`test_simulation_full_equivalence_converts_more_steps_than_capability_limited`,
`test_unstable_ui_dependency_constraint_names_only_the_brittle_system`,
`test_unlock_opportunity_reports_leverage_not_business_value` — all in
`tests/test_estate.py`. Schema changed: `CanonicalDependencyRow` gained an
`environment` column, `Constraint` gained a `dependency_hint` column — a
fresh `morphline.db` (or a real migration, not yet written) is required;
this repo has no migration framework yet, so the dev flow is
`rm morphline.db && python -m apps.api.scripts.seed_samples`.

The reviewer's remaining open items — estate frontend views, estate-level
LLM tasks, `docs/UAT.md` estate section, `docs/decisions.md` entries — are
still not built; see "What was deliberately deferred" below, unchanged by
this sprint.

## Phase 3: Enterprise Transformation Architecture

Once the estate backend was corrected, the next agreed step was NOT
Orchestrator integration — it's making Morphline produce implementation
architecture, not just an evolution-state classification. Locked
sequencing for this line of work: (1) estate backend corrections — done
above; (2) estate decision UI — still not built, see estate ledger §11;
(3) enterprise platform capability model; (4) target architecture
generation; (5) migration blueprint + guardrails; (6) real multi-process
UAT; (7) Orchestrator read-only integration. This phase covers (3)-(5).

**New locked TheDuck rule for this and all future architecture work**:
Morphline must never recommend a platform just because it exists in the
customer's stack. It must explain why that platform owns the
responsibility, and what alternative was rejected — or, when nothing
distinguishes two candidates, refuse to choose at all rather than guess.
This is the same "never fabricate certainty" principle already governing
ROI and dependency-merging, applied to platform choice.

**What was built**: `packages/shared/architecture_types.py` (PlatformRole,
PlatformProfile, TargetArchitectureComponent, MigrationStep, Guardrail,
TargetArchitecturePlan, EstateArchitectureSummary), `architecture/plan.py`
(pure function `generate_target_architecture` — role need is determined
FIRST from evidence the scoring/recommendation engines already computed,
THEN and only then matched against the workspace's platform catalog;
`summarize_estate_architecture` for the estate rollup), `apps/api/app/architecture_service.py`
+ `apps/api/app/routers/architecture.py` (platform catalog CRUD,
per-automation target architecture, estate architecture summary), new
`PlatformProfileRow` table seeded with a default catalog per workspace
(AWS Bedrock/AgentCore/n8n/UiPath/OutSystems/generic API-DB-Queue-
Observability platforms — ordinary editable data, not a hardcoded
recommendation).

**How the "never guess" rule is actually enforced** (`architecture/plan.py::_select_component`):
zero catalog platforms registered for a needed role → flagged as a gap
(`manual_decision_required=True`, empty `candidates`) — a missing platform
is not silently skipped. Exactly one candidate → confident pick with a
justification citing the actual evidence that made the role necessary.
More than one candidate with nothing in the automation's evidence to
distinguish them → `manual_decision_required=True`, every candidate listed
in `rejected_alternatives`, plan confidence forced to LOW. Verified live:
adding a second REASONING platform to a workspace's catalog via the real
API flips an already-confident target architecture plan to
`manual_decision_required=True` on the very next call
(`apps/api/tests/test_api.py::test_target_architecture_and_platform_catalog_endpoints`).

**Verified against the phase brief's own worked example**: `GET /automations/{customer_exclusion_id}/target-architecture`
against the seeded sample data produced exactly the example architecture
from the brief — Bedrock (reasoning) + AgentCore (agent runtime) + n8n
(orchestration) + UiPath (bounded execution, none needed here since this
particular fixture has no bounded UI surface) + OutSystems (human
approval) + Internal API Gateway + Enterprise Observability, an 8-step
migration sequence, and 6 guardrails (tool allowlist, no-direct-
credentials, approval thresholds, idempotency, rollback, full audit
trail) — see `docs/verification-ledger.md` §13 for the full trace.

**What this phase explicitly does NOT do yet** (see verification ledger
§13 for the honest gap list): no frontend for the platform catalog editor,
target architecture view, or estate architecture summary — API-only, same
gap as the estate-intelligence phase. No link from a target architecture's
platform choices back to *specific* unlock opportunities from the estate
phase — the brief's own closing example ("adding the SAP write API unlocks
6 of these migration plans") describes exactly this link, and it doesn't
exist: `estate/unlock.py`'s UnlockOpportunity and `architecture/plan.py`'s
TargetArchitecturePlan are still two separate, uncombined views over the
same underlying per-automation data. Role-need detection and platform
selection are both single-pass per automation — an automation needing two
different REASONING platforms for two genuinely distinct decision points,
or multiple UI systems needing different BOUNDED_EXECUTION treatment, is
not yet distinguished (each role is treated as single-valued).

New tests: `tests/test_architecture.py` (10 tests) +
`apps/api/tests/test_api.py::test_target_architecture_and_platform_catalog_endpoints`
(1 test) — 11 new, all passing, 0 existing tests modified.

## Phase 4: Transformation Impact + Decision UX

Directed narrowly, and kept narrow: compose simulation + target
architecture; show before/after architecture; show platform-usage impact;
show remaining blockers; build an estate UI around these decisions; keep
multi-role architecture extensible but don't over-engineer it yet.

**What was built**: `architecture/impact.py` — `compute_transformation_impact`
(arbitrary `SimulationScenario` → per-automation before/after
`TargetArchitecturePlan` + role-by-role `ComponentChange` diff + platform-
usage rollups) and `compute_impact_for_shared_constraint` (the one-click
path from an already-computed `SharedConstraint`, reusing
`estate.unlock.resolution_override_for` — a new public wrapper — so the
category→assumption mapping lives in exactly one place). New endpoints
`POST /workspaces/{id}/estate/transformation-impact` and
`POST /workspaces/{id}/estate/shared-constraints/transformation-impact`.
`estate/simulation.py::simulate_automation` now also returns the mutated
`pm`/`biz` (previously discarded after use) so the impact module can feed
the exact post-simulation state into `generate_target_architecture` rather
than re-deriving an approximation.

**First real estate frontend page**: `apps/web/src/app/workspaces/[workspaceId]/transformation/page.tsx` —
lists shared constraints, and on selection shows the scenario's unlock
count, a platform-usage-impact table (before/after platform per role
across the estate), and one card per affected automation with its
evolution-state change, a before/after component table (struck-through
removed platforms, "NEW" badge on added roles, highlighted changed rows),
and remaining blockers. Linked from the workspace dashboard ("Transformation
Impact" button). Screenshotted three states (list, successful impact,
honest 422-gap message for an unmapped category) — see verification ledger
§14.

**Scope discipline honored**: multi-role architecture (a role needing more
than one simultaneous platform per automation) was NOT built — `PlatformRole`
stays single-valued, per Phase 3's documented limitation. The new types
(`ComponentChange`, `TransformationImpact`) are shaped so a future
multi-valued role only requires changing `TargetArchitectureComponent`
to hold a list, not a redesign of the diff/impact layer — extensible
without having been generalized prematurely.

New tests: `tests/test_transformation_impact.py` (9 tests) +
2 API-level tests in `apps/api/tests/test_api.py` — 11 new, all passing,
0 existing tests modified.

## End-of-phase status

- Final commit hash: see `git log` head on `claude/new-session-ekr17k` —
  the commit adding this update is the last one of this phase.
- Final test count: **107 passed**, 0 failed (`pytest -q` from repo root;
  started the estate-intelligence phase at 63, was 79 before the
  correction sprint, 85 after it, 96 after Phase 3, now 107 after Phase 4).
  44 new tests total across all four sub-phases, 0 existing tests modified.
- Verification ledger status: see `docs/verification-ledger.md`. Summary:
  8 capabilities VERIFIED, 1 MANUAL-ONLY (environment memory has no
  automated test yet), 1 PARTIAL (reusable-tool detection — the estate-level
  "shared across N automations" fact is new and verified, the underlying
  per-automation heuristic itself wasn't refined), 2 NOT BUILT (estate
  frontend views, estate-level LLM tasks).
- What shipped this phase:
  - `estate/` package: `normalize.py`, `identity.py`, `graph.py`,
    `simulation.py`, `unlock.py` — all pure functions, DB-free, matching the
    existing `scoring/`/`recommendation/` style.
  - `packages/shared/estate_types.py` — all new pydantic types (canonical
    dependency, estate graph, shared constraint, unlock opportunity,
    simulation scenario/result, modernization priority, environment event,
    execution surface profile view).
  - `apps/api/app/estate_service.py` + `apps/api/app/routers/estate.py` —
    DB orchestration + full REST surface: estate graph (4 clustering
    modes), shared constraints, unlock opportunities, modernization
    priorities, what-if simulation (never persists), canonical-dependency
    dictionary + alias confirmation, environment events.
  - Two new persisted tables: `CanonicalDependencyRow`, `EnvironmentEventRow`.
  - Execution Surface Profile wired into `scoring/dimensions.py` and
    exposed via `GET /automations/{id}/execution-surface-profile`.
  - Process flow graph readability fix (`apps/api/app/flowgraph.py`
    `_WorkflowFlattener`): structural container noise is contracted out
    while preserving real execution order; invoked workflows render as a
    distinct `invokedWorkflow` node type (frontend: dashed violet block in
    `FlowGraph.tsx`).
  - `tests/test_estate.py` (13 tests covering Cases A, B, C, D, D2, E, F, G,
    H, modernization ranking, normalization safety, execution surface
    profile) and `tests/test_flow_readability.py` (4 tests).
  - `docs/verification-ledger.md` (new).
- What was deliberately deferred (see verification ledger #11-12 for why):
  - **Estate-level frontend views** (Estate Overview, Automation Portfolio,
    Systems & Dependencies, Constraints, Unlock Opportunities, What-If
    Simulator, Evolution History) — the entire estate capability set is
    currently API-only. This is the single biggest gap against the
    phase-completion checklist. Reasoning for the trade-off: with limited
    remaining time in this session, correctness + test coverage of the
    actual estate *logic* (graph, simulation, unlock analysis — the parts
    that are hard to get right and easy to get subtly wrong, e.g. the
    simulation-isolation and partial-fix-doesn't-overstate-unlock
    guarantees) was prioritized over frontend surface, which is more
    mechanical to build once the API contract is stable and tested. The
    API contract in `apps/api/app/routers/estate.py` is the exact shape a
    frontend agent should build against next.
  - **Estate-level LLM tasks** (cluster summaries, alias suggestions,
    migration narratives, reassessment-change summaries) — `llm/provider.py`
    was not touched this phase; only the pre-existing per-automation
    `summarize_process` exists. No estate-level LLM entry point was added.
  - **Automated test for `EnvironmentEventRow`** — verified manually via
    curl only; no `apps/api/tests/` test posts an event and asserts the
    affected-automations list or that no constraint status silently
    changed as a side effect.
  - `docs/UAT.md` was not extended with an estate section this phase.
  - `docs/decisions.md` was not appended with numbered decision entries
    for the architectural calls made this phase (compute-on-demand vs.
    persisted, single `CanonicalDependency` type vs. separate
    System/Component classes, React Flow reuse for clustering) — those
    calls are recorded informally in "Open decisions" above but not yet
    given numbered entries in the project's decision log.

### Recommended next steps, in priority order (updated after Phase 4)

1. ~~Link unlock analysis to target architecture.~~ **DONE in Phase 4** —
   `architecture/impact.py`. Not yet done: surfacing this composed view
   from the *unlock opportunities* list itself (today it's reachable via
   the shared-constraints page, since `compute_impact_for_shared_constraint`
   takes a `SharedConstraint`, not an `UnlockOpportunity` — the two are
   closely related but not identical; wiring the same one-click flow onto
   `/estate/unlock-opportunities` rows would let a CIO go straight from
   "this unlocks 6 automations" to the architecture diff without a detour
   through the shared-constraints page).
2. Build out the remaining estate frontend
   (`apps/web/src/app/workspaces/[id]/...`) against the existing, tested
   APIs: a standalone Estate Overview (evolution funnel + top constraints,
   today only on the pre-estate dashboard), Systems & Dependencies
   (canonical dependency dictionary + alias confirmation UI), and a
   per-automation Target Architecture tab on the automation detail page
   (today `GET /automations/{id}/target-architecture` has no frontend of
   its own — only reachable indirectly via the transformation-impact
   page's per-automation cards).
3. Add the missing `EnvironmentEventRow` automated test (see verification
   ledger #6).
4. Build fixtures with deliberately varied raw system names across
   automations (e.g. "SAP" in one project, "SAP Production" in another) to
   get an end-to-end (not just unit-level) proof of alias folding across a
   real upload flow.
5. Handle multi-valued roles: an automation needing two REASONING
   platforms for two distinct decision points, or multiple UI systems
   needing different BOUNDED_EXECUTION treatment, is not yet distinguished
   by `architecture/plan.py` (each role is currently single-valued per
   automation) — worth a fixture that actually has this shape before
   generalizing the model further. Phase 4 deliberately did not tackle
   this (kept in scope, not over-engineered) but its types
   (`ComponentChange`, `TransformationImpact`) were shaped so this
   generalization stays additive when it's actually needed.
6. Append `docs/decisions.md` entries for Phases 3 and 4's architectural
   calls.
7. Only after the above: estate-level and architecture-level LLM
   summarization tasks (e.g. narrating a target architecture plan in
   prose) — lowest priority since the brief is explicit that deterministic
   evidence, not LLM narrative, is what must carry these claims.

### TheDuck learning added this phase

- A what-if simulation is only trustworthy if it is physically incapable of
  running a different code path than the real assessment. Building
  `simulate_automation` to call the exact same `score_process`/`recommend`
  functions (on a deep copy) rather than writing a parallel "simulated
  scorer" is what makes "never overstate an unlock" a structural guarantee
  instead of a hope — Case E (partial fix must not overstate) fell out of
  this for free once the isolation was right, rather than needing its own
  special-cased logic.
- Pydantic v2 does not validate/coerce on plain `setattr()` — patching a
  model field-by-field in a loop can silently leave a raw string where an
  enum was expected, and the bug won't surface until something several
  layers away does `.value` on it. Reconstruct via
  `Model(**{**instance.model_dump(), **patch})` instead of setattr-looping
  whenever "patching" a pydantic model from an untyped dict.
- Cross-automation intelligence is cheap to compute-on-demand and expensive
  to keep consistent if persisted redundantly — every estate capability
  this phase (graph, shared constraints, unlock analysis) is a pure
  function over existing per-automation snapshots precisely so there is
  never a second copy of the truth to drift out of sync.
- When a brief lists many capabilities under real time pressure, shipping
  fewer capabilities *fully verified with tests on real fixtures* beats
  shipping all of them as unverified scaffolding — a future agent can trust
  a VERIFIED row in the ledger and build on it; it cannot trust an
  unverified claim of completeness. Say what wasn't built, plainly, rather
  than implying more coverage than exists.

### TheDuck learning added in the post-review correction sprint

- A "VERIFIED" row in the ledger means the tests pass, not that the tests
  asked the right question. Every fixed issue this sprint had *passing*
  tests before the fix — the tests were checking that the mechanism ran,
  not that its output was trustworthy (e.g. "normalization folds these
  three strings together" was tested and true; "normalization never folds
  strings that shouldn't be together" was never asked). Write the
  adversarial test — "what should this *never* do" — not just the happy
  path, especially for anything the product will use to make a claim to a
  user (an unlock count, a blocked-automation count).
- "Deterministic" and "safe to auto-merge" are not the same property. A
  rule can be perfectly deterministic (same input always produces the same
  normalized key) while still being *wrong to apply automatically* — the
  PROD/UAT/DEV bug was 100% deterministic and 100% a violation of "never
  silently merge ambiguous dependencies." Determinism is necessary for an
  auto-merge rule to be trustworthy, but it says nothing about whether the
  two things being merged are actually the same real-world entity.
- A simulation "assumption" needs a visible confidence label the moment it
  stops being a structural fact and starts being a guess about scope. Deep
  copy + re-running the real engine (built correctly last phase) guarantees
  a simulation can't diverge from reality *mechanically* — it says nothing
  about whether the assumption fed into it was itself honest. "API becomes
  available" is a structural fact about connectivity; "this API covers
  every operation the bot currently performs via UI" is a scope guess, and
  conflating the two is exactly how a technically-correct simulation
  produces a business-misleading number.
- Attribute a fact at the moment you have the most evidence to attribute it
  correctly, not later by re-deriving it from a coarser signal. The
  recommendation engine has per-step, per-selector evidence about *which*
  system is brittle when it creates a constraint; estate logic, working
  only from the constraint's category and the whole process model, cannot
  recover that specificity without over-attributing. `dependency_hint` is
  the general pattern: carry the narrow fact forward as a field, don't make
  a downstream consumer reconstruct it from broader context.
- Name a field for what it actually measures, not for what you hope it
  will eventually measure. `estimated_value` invited every future caller
  (including a future agent) to treat "12 automations move up one state"
  as commensurable with "2 automations move up one state, one of them a
  £500M process" — the two are not comparable without a real business
  criticality input that doesn't exist yet. `unlock_leverage` names the
  thing actually computed; the docstring, not the field name, is where the
  aspirational future formula belongs.
