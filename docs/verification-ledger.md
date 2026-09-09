# Verification Ledger — Estate Intelligence Phase

For each major capability introduced in the estate-intelligence phase: what
was required, where it lives, what evidence backs the claim it works, and
what is not yet resolved. Statuses: **VERIFIED** (automated test + manual
check), **TESTED** (automated test only), **MANUAL-ONLY** (smoke-tested via
curl/script, no automated test yet), **PARTIAL** (built but with a known
gap), **NOT BUILT**.

## Correction sprint (post-review)

An external review of commit `2c09efe` found two P0 correctness issues and
two P1 issues in the estate backend before it should be trusted. All four
were fixed in this sprint, each with a regression test proving the specific
failure mode the review described:

1. **P0 — canonical normalization could silently merge different
   environments.** `normalize_system_key` stripped "production"/"uat"/
   "test"/"dev" as noise, so "SAP PROD" and "SAP UAT" collapsed onto one
   canonical dependency — a real violation of "never silently merge
   ambiguous dependencies," since an unlock claim against PROD could
   silently include automations pointed at UAT/DEV. Fixed: environment is
   now extracted into its own field (`CanonicalDependency.environment`:
   PROD/UAT/TEST/DEV/UNKNOWN) and folded into the merge key
   (`estate/normalize.py::normalize_dependency_key`), so two names only
   merge automatically when both the cleaned name AND the environment
   agree. See §1 below.
2. **P0 — API-available simulation assumed a perfect API for every UI
   step, unlabeled.** `_apply_override` converted every UI-automation step
   touching the target system into a `POST` API call regardless of what
   the step did, and unlock analysis used this to compute estate-wide
   unlock counts — an unstated "assume full functional API replacement"
   framed as a confirmed capability. Fixed: `SimulationOverride.capabilities`
   lets a caller state which operations (READ/WRITE) are actually
   confirmed; a coarse heuristic classifies each step so only matching
   steps convert (with `GET`/`POST` chosen by classification, not always
   `POST`); when no capability list is given, the simulation still runs
   but is explicitly labeled a "FULL API-EQUIVALENCE ASSUMPTION" and
   folded into `unresolved_factors`, which forces unlock confidence to
   LOW. See §5 below.
3. **P1 — shared-constraint attribution could blame the wrong system.**
   `UNSTABLE_UI_DEPENDENCY` was attributed to every `ui_automation` system
   the process touched, so a bot with one stable (bounded-subprocess)
   system and one genuinely brittle one could make estate logic blame the
   stable one. Fixed: `ConstraintDraft`/`ConstraintRecord` now carry a
   `dependency_hint` set by the recommendation engine at creation time
   (the specific brittle system(s), derived from real per-step evidence),
   which `estate/graph.py` prefers over its old whole-process
   reconstruction. See §3 below.
4. **P1 — `estimated_value` conflated technical leverage with business
   value.** Ranking purely on "unlocked / affected" made "unlocks 12 tiny
   bots" outrank "unlocks 2 processes worth £500M" as if they were the
   same kind of win. Renamed to `unlock_leverage` (+ `leverage_is_unknown`)
   with a docstring stating the intended future formula (`unlock_leverage
   × business_importance × feasibility × confidence`) once Business
   Context carries a real criticality signal — not implemented, since no
   such signal exists yet to multiply by. See §4 below.

All four fixes are covered by dedicated tests in `tests/test_estate.py`
(`test_normalization_never_merges_different_environments`,
`test_simulation_labels_full_api_equivalence_and_lowers_confidence`,
`test_simulation_capability_limited_does_not_convert_uncovered_operations`,
`test_simulation_full_equivalence_converts_more_steps_than_capability_limited`,
`test_unstable_ui_dependency_constraint_names_only_the_brittle_system`,
`test_unlock_opportunity_reports_leverage_not_business_value`). Full suite:
**85 passed, 0 failed** (up from 79 before this sprint), no existing test
weakened.

## 1. Canonical identity / normalization

- **Requirement**: fold different raw names for the same system/component
  into one canonical identity deterministically; never silently merge
  genuinely ambiguous ones — including different environments of the same
  system (PROD/UAT/TEST/DEV are different real-world dependencies, not
  cosmetic variants).
- **Implementation**: `estate/normalize.py` (now with `extract_environment`
  and `normalize_dependency_key`), `estate/identity.py`,
  `CanonicalDependencyRow` (`apps/api/app/models/orm.py`, now with an
  `environment` column).
- **Test evidence**: `tests/test_estate.py::test_normalization_folds_aliases_without_silent_ambiguous_merge`,
  `test_normalization_never_merges_different_environments` (added in the
  correction sprint — proves PROD/UAT/DEV/unspecified each get their own
  canonical dependency, while repeated references to the *same*
  environment still fold together).
- **Manual evidence**: live API smoke test — `GET /workspaces/1/canonical-dependencies`
  showed Excel/SAP entries each with one confirmed alias and an
  `environment` field after seeding 8 sample automations.
- **Status**: VERIFIED.
- **Unresolved limitation**: no fixture yet deliberately varies raw names
  across automations (e.g. "SAP" in one, "SAP Production" in another) to
  prove cross-automation folding beyond the identical-string case; the
  identity-layer unit tests cover this directly, but no end-to-end fixture
  does.

## 2. Estate graph (system / component / constraint / state clustering)

- **Requirement**: a composed, non-duplicated view over existing
  Automation/ProcessVersion data — clusters, not a spiderweb of every step.
- **Implementation**: `estate/graph.py::build_estate_graph`,
  `apps/api/app/routers/estate.py::get_estate_graph` (4 modes).
- **Test evidence**: `tests/test_estate.py::test_case_b_shared_reusable_component_detected_in_estate_graph`,
  `test_case_g_reusable_ui_subprocess_considered_as_agent_tool`.
- **Manual evidence**: live `GET /estate/graph?mode=system` against 8 seeded
  automations — correctly produced AUTOMATION/SYSTEM/COMPONENT nodes with
  canonical dependency ids attached.
- **Status**: VERIFIED for system/component modes. `constraint` and `state`
  modes are MANUAL-ONLY (exercised via the router's own logic path, no
  dedicated automated test asserting their node/edge shape).

## 3. Shared constraints (cross-process dependency intelligence)

- **Requirement**: group identical underlying constraints across
  automations into one estate-level fact, attributed to the real canonical
  dependency (mechanically, not by string-matching free text).
- **Implementation**: `estate/graph.py::compute_shared_constraints`, now
  preferring `ConstraintRecord.dependency_hint` (set at creation time in
  `recommendation/engine.py::determine_ceiling`) over reconstructing
  attribution from every `ui_automation` system in the process.
- **Test evidence**: `test_case_a_shared_ui_dependency_detected_as_one_estate_constraint`,
  `test_case_h_no_shared_dependency_yields_no_estate_opportunity`,
  `test_unstable_ui_dependency_constraint_names_only_the_brittle_system`
  (correction sprint — a synthetic bot with one stable, bounded-subprocess
  system and one genuinely brittle inline system proves the constraint
  names only the brittle one).
- **Manual evidence**: live `GET /estate/shared-constraints` against 8 seeded
  automations — correctly grouped POOR_REVERSIBILITY (3), INSUFFICIENT_BUSINESS_CONTEXT
  (3), COMPLIANCE_RESTRICTION (2), WEAK_OBSERVABILITY (2), and split
  UNSTABLE_UI_DEPENDENCY into per-system buckets (one specifically
  attributed to "SAP", confirming the fix actually changes real output,
  not just the synthetic test).
- **Status**: VERIFIED.

## 4. Unlock analysis

- **Requirement**: "if I fix one thing, what does it unlock?" — never
  invent monetary value; LOW/MEDIUM/HIGH/unknown only; must not conflate
  technical leverage with business value.
- **Implementation**: `estate/unlock.py::compute_unlock_opportunities`.
- **Test evidence**: `test_case_c_shared_constraint_produces_unlock_opportunity_across_bots`,
  `test_case_f_unknown_business_context_reduces_confidence_not_estimate`,
  `test_modernization_priorities_ranked_without_fabricated_monetary_value`,
  `test_unlock_opportunity_reports_leverage_not_business_value` (correction
  sprint — asserts the field is named/framed as `unlock_leverage`, not
  `estimated_value`).
- **Manual evidence**: live `GET /estate/unlock-opportunities` — correctly
  showed 0 unlock for a POOR_REVERSIBILITY-only fix when other blockers
  remain on the same automations (real-data confirmation of Case E logic).
- **Status**: VERIFIED. `unlock_leverage` (renamed from `estimated_value` in
  the correction sprint, since a review pointed out the old name implied
  business value it doesn't measure) is provably never a fabricated
  number — it is `Level.LOW/MEDIUM/HIGH` derived from `result.unlock_count`,
  or `leverage_is_unknown=True` when `affected_count == 0`. Modernization
  Priority still ranks on leverage alone — the intended
  `leverage × business_importance × feasibility × confidence` formula is
  documented but not implemented, since Business Context carries no
  criticality/value signal yet to multiply by.

## 5. What-if simulation

- **Requirement**: never mutate real stored constraints; never mark a
  constraint resolved because the user simulated it; must run through the
  real scoring/recommendation engines, not a parallel shortcut; "API
  becomes available" must not silently assume a perfect API for every UI
  operation the bot performs.
- **Implementation**: `estate/simulation.py`, now with
  `SimulationOverride.capabilities` (confirmed READ/WRITE coverage) and an
  explicit "FULL API-EQUIVALENCE ASSUMPTION" label + forced-LOW-confidence
  path when no capability list is given.
- **Test evidence**: `test_case_d_simulation_never_mutates_real_stored_state`,
  `test_case_d2_simulation_isolated_across_repeated_runs`,
  `test_case_e_partial_fix_does_not_overstate_unlock`,
  `test_simulation_labels_full_api_equivalence_and_lowers_confidence`,
  `test_simulation_capability_limited_does_not_convert_uncovered_operations`,
  `test_simulation_full_equivalence_converts_more_steps_than_capability_limited`
  (correction sprint — proves capability-limited simulation leaves
  uncovered steps as unresolved brittle UI rather than converting
  everything, and that the unlabeled full-equivalence path is a strictly
  larger, explicitly-flagged upper bound rather than a silent default).
- **Manual evidence**: manual before/after comparison on `customer_exclusion`
  proved `model_copy(deep=True)` isolation, and that a full set of overrides
  correctly unlocks `HIGH_AUTONOMY_AGENT` while a partial set does not.
- **Status**: VERIFIED. Every override path (`_apply_override`) goes through
  the real `score_process`/`recommend` functions except `OBSERVABILITY_ADDED`,
  which patches the `observability` DimensionScore directly post-scoring
  (documented in code as the one deliberate exception, since there is no
  clean structural mutation equivalent for "assume better logging exists").

## 6. Longitudinal environment memory

- **Requirement**: remember environment changes over time; surface "N
  processes should be reassessed" without ever auto-upgrading them.
- **Implementation**: `EnvironmentEventRow` (orm.py),
  `apps/api/app/estate_service.py::record_environment_event`.
- **Test evidence**: none yet — MANUAL-ONLY.
- **Manual evidence**: `POST /workspaces/1/environment-events` with "SAP
  write API became available" correctly identified 2 potentially-affected
  automations (Invoice Processing, Order Fulfillment via Reusable
  Subprocesses) by canonical-key match, without mutating either automation's
  stored state.
- **Status**: MANUAL-ONLY. Recommended next step: an automated test that
  posts an event and asserts the returned `potentially_affected_automations`
  list and that no `ConstraintRecord.status` changed as a side effect.

## 7. Modernization priority ranking

- **Requirement**: rank platform-change candidates without inventing ROI.
- **Implementation**: `estate/unlock.py::rank_modernization_priorities`.
- **Test evidence**: `test_modernization_priorities_ranked_without_fabricated_monetary_value`.
- **Manual evidence**: live `GET /estate/modernization-priorities` ranked
  list with per-rank reasons ("N automation(s) affected", "N unresolved
  factor(s) remain").
- **Status**: VERIFIED.

## 8. Execution Surface Profile (per-surface tool readiness)

- **Requirement**: don't collapse tool readiness into one ratio — separate
  API / reusable-subprocess / queue coverage from UI dependency.
- **Implementation**: `scoring/dimensions.py::build_execution_surface_profile_view`,
  `GET /automations/{id}/execution-surface-profile`.
- **Test evidence**: `tests/test_estate.py::test_execution_surface_profile_distinguishes_bounded_ui_from_brittle_ui`.
- **Manual evidence**: confirmed on real fixtures that a UI-heavy but fully
  bounded process (`ui_heavy_reusable_tools`) reports LOW `ui_dependency`
  risk, while an un-encapsulated one (`invoice_processing`) reports HIGH.
- **Status**: VERIFIED at the scoring-package level. NOT YET surfaced in any
  frontend view (see Section 11).

## 9. Process flow readability

- **Requirement**: stop rendering a raw per-step node dump; collapse
  structural container noise; preserve execution order; render invoked
  workflows as subprocess blocks.
- **Implementation**: `apps/api/app/flowgraph.py` (`_WorkflowFlattener`),
  `apps/web/src/components/FlowGraph.tsx` (`invokedWorkflow` node type).
- **Test evidence**: `tests/test_flow_readability.py` (4 tests): noise
  containers absent from nodes, no dangling edges, execution order survives
  contraction, invoked-workflow steps get the distinct node type.
- **Manual evidence**: measured node-count reduction on real fixtures —
  `loan_exception_review` goes from 30 raw steps to 13 rendered nodes.
- **Status**: VERIFIED on the backend graph shape. The frontend visual
  change (dashed violet subprocess block) has not been checked in a running
  browser this phase — TypeScript types were confirmed compatible
  (`FlowGraph.nodes[].type: string` already permitted the new value) but no
  `next build` or manual UI screenshot was taken.

## 10. Reusable RPA tool detection

- **Requirement**: signals = invoked workflow, meaningful I/O arguments,
  bounded responsibility, naming, limited side effects, isolated external
  interaction, repeated usage, stable interface.
- **Implementation**: unchanged from the prior phase
  (`scoring/dimensions.py::ExecutionSurfaceProfile.bounded_subprocess_files`,
  used by both `score_execution_tool_readiness` and the new
  `build_execution_surface_profile_view`). The estate graph surfaces these
  as shared COMPONENT nodes when the same subprocess is invoked by multiple
  automations.
- **Test evidence**: `test_case_b_shared_reusable_component_detected_in_estate_graph`,
  `test_case_g_reusable_ui_subprocess_considered_as_agent_tool`, plus the
  pre-existing `test_case4_ui_heavy_reusable_subprocesses_considered_as_agent_tools`.
  Signals used remain: invoked-workflow status + declared arguments only.
  "Repeated usage across automations," "isolated external interaction," and
  "stable interface" are NOT independently scored refinements this phase —
  they are implied by the estate graph showing multiple inbound `invokes`
  edges to the same COMPONENT node, not a separate confidence signal.
- **Status**: PARTIAL. The estate-level "this component is reused by N
  automations" fact is new and verified; the underlying per-automation
  detection heuristic itself was not refined further this phase.

## 11. Estate-level frontend views

- **Requirement**: Estate Overview, Automation Portfolio, Systems &
  Dependencies, Constraints, Unlock Opportunities, What-If Simulator,
  Evolution History, Individual Automation — each answering a named role's
  question (CIO, CoE, Architect, Agentic team).
- **Implementation**: NOT BUILT this phase. The existing per-automation
  frontend (process detail, flow graph, dashboard) was extended only for
  the flow-readability fix (Section 9); no new estate-level page or route
  was added under `apps/web/`.
- **Status**: NOT BUILT. All estate capabilities are reachable via the
  `/workspaces/{id}/estate/*` API only. This is the single largest gap
  against the phase-completion checklist — see `docs/DUCK_HANDOFF.md`
  "Known defects/gaps" and "Next actions" for the reasoning behind
  prioritizing backend correctness + test coverage over frontend surface
  given the time available, and what the next agent should build first.

## 12. LLM estate-level tasks (cluster summaries, canonical alias
    suggestions, migration narratives, reassessment summaries)

- **Requirement**: LLM may propose/explain/summarize; must never invent
  API availability, runtime data, regulatory facts, silently merge
  dependencies, override constraints, or fabricate ROI.
- **Implementation**: NOT BUILT this phase. `llm/provider.py`'s existing
  `summarize_process` (per-automation) is unchanged; no estate-level LLM
  entry point (cluster summary, alias suggestion, migration narrative) was
  added.
- **Status**: NOT BUILT.

## Summary (estate-intelligence phase)

| # | Capability | Status |
|---|---|---|
| 1 | Canonical identity/normalization | VERIFIED |
| 2 | Estate graph | VERIFIED (system/component); MANUAL-ONLY (constraint/state modes) |
| 3 | Shared constraints | VERIFIED |
| 4 | Unlock analysis | VERIFIED |
| 5 | What-if simulation | VERIFIED |
| 6 | Environment memory | MANUAL-ONLY |
| 7 | Modernization priority | VERIFIED |
| 8 | Execution Surface Profile | VERIFIED (backend); no frontend |
| 9 | Flow readability | VERIFIED (backend); frontend unverified in-browser |
| 10 | Reusable tool detection | PARTIAL (estate-level fact new; per-automation heuristic unchanged) |
| 11 | Estate frontend views | NOT BUILT |
| 12 | LLM estate-level tasks | NOT BUILT |

Test count at end of the initial estate phase: 79 passing (63 pre-existing +
16 new). Test count at end of the post-review correction sprint: 85
passing, 0 failed (+6 new tests proving the four review findings above are
actually fixed: environment-separation, capability-aware/labeled
simulation ×3, constraint provenance, leverage-vs-value naming). No
pre-existing test was modified or weakened at either point.

## 13. Enterprise Transformation Architecture (Phase 3)

- **Requirement**: model the customer's real platform estate (which
  concrete platforms exist and what role each plays), and for each
  automation generate a target architecture — not just an evolution-state
  label — with a migration sequence and guardrails. Locked rule: **never
  recommend a platform because it merely exists in the customer's stack**;
  every recommended platform must carry a justification, and an ambiguous
  choice (multiple equally-plausible catalog platforms for one role) must
  never be silently resolved.
- **Implementation**: `packages/shared/architecture_types.py` (all new
  types: `PlatformRole`, `PlatformProfile`, `TargetArchitectureComponent`,
  `MigrationStep`, `Guardrail`, `TargetArchitecturePlan`,
  `EstateArchitectureSummary`), `architecture/plan.py` (pure function,
  DB-free, matching `scoring/`/`recommendation/`/`estate/` style),
  `apps/api/app/architecture_service.py` + `apps/api/app/routers/architecture.py`
  (`GET/POST/DELETE /workspaces/{id}/platform-catalog`,
  `GET /automations/{id}/target-architecture`,
  `GET /workspaces/{id}/estate/architecture-summary`), new persisted table
  `PlatformProfileRow` (the one genuinely new piece of customer-specific
  data this phase introduces — everything else is computed fresh on every
  call, same compute-on-demand pattern as the estate phase).
- **How role need is determined** (never "platform exists, so recommend
  it"): each `PlatformRole` has its own need condition sourced from
  evidence the recommendation/scoring engines already computed —
  REASONING/AGENT_RUNTIME only when `recommended_pattern` is one of the
  five agentic patterns; BOUNDED_EXECUTION only when real UI-automation
  surface exists (existing automation stays a valid tool per locked
  principle 7, never rewritten just because agentic patterns are in play);
  HUMAN_APPROVAL only for `HYBRID_WITH_HUMAN_APPROVAL` or a confirmed
  `mandatory_approval`; API_GATEWAY/DATABASE/QUEUE only when the process
  actually has that kind of system today; OBSERVABILITY when anything
  beyond plain deterministic RPA is introduced or observability scored LOW.
  Only after a role is determined needed does `_select_component` look at
  the catalog — and even then: zero candidates → flagged gap
  (`manual_decision_required=True`, empty `candidates`); exactly one
  candidate → confident pick, justified; more than one candidate with no
  automation-specific evidence to distinguish them → `manual_decision_required=True`
  listing all candidates as `rejected_alternatives`, never an arbitrary
  pick.
- **Migration sequence**: built from a fixed 9-step template (preserve
  current execution → isolate the decision step → wrap/keep bounded tools
  → introduce reasoning at ambiguity points → add HITL → add observability/
  rollback → shadow-run → compare outcomes → gradually shift execution),
  but each step is only included when its precondition actually holds for
  this automation, and marked `ALREADY_TRUE` instead of `REQUIRED` when the
  process already satisfies it (e.g. "wrap as bounded tools" is
  `ALREADY_TRUE` when a bounded reusable subprocess already exists).
- **Guardrails**: derived from the same evidence — `TOOL_ALLOWLIST` +
  `NO_DIRECT_MODEL_CREDENTIALS` whenever REASONING is introduced;
  `WRITE_LIMITS` + `CONFIDENCE_ROUTING` on HIGH blast radius;
  `APPROVAL_THRESHOLDS` whenever HUMAN_APPROVAL is needed; `IDEMPOTENCY` +
  `ROLLBACK` on LOW/unconfirmed reversibility; `FULL_AUDIT_TRAIL` whenever
  OBSERVABILITY is needed. Never a fixed list applied uniformly regardless
  of the automation.
- **Test evidence**: `tests/test_architecture.py` (10 tests) —
  `test_agentic_automation_gets_reasoning_and_agent_runtime_components`,
  `test_deterministic_automation_gets_no_reasoning_component` (a
  deterministic recommendation gets no REASONING component even though the
  catalog has one registered — proves need-first, not catalog-first),
  `test_ambiguous_role_is_never_guessed` (core TheDuck rule: two REASONING
  platforms → `manual_decision_required`, confidence forced LOW),
  `test_missing_catalog_role_is_a_flagged_gap_not_a_silent_skip`,
  `test_existing_bounded_subprocess_is_preserved_not_rewritten`,
  `test_reversibility_guardrails_only_appear_when_reversibility_is_actually_weak`,
  `test_reasoning_introduction_always_carries_tool_allowlist_and_no_direct_credentials`,
  `test_migration_sequence_never_proposes_shadow_run_when_nothing_changes`,
  `test_estate_architecture_summary_counts_platforms_across_automations`,
  `test_estate_summary_surfaces_manual_decisions_separately_from_confident_picks`.
  Plus one API-level test in `apps/api/tests/test_api.py`
  (`test_target_architecture_and_platform_catalog_endpoints`) proving that
  adding a second REASONING platform via the real API flips an
  already-confident plan to `manual_decision_required` on the next call —
  end-to-end proof the ambiguity rule isn't just a unit-level artifact.
- **Manual evidence**: live API smoke test against 8 seeded automations —
  `GET /automations/2/target-architecture` (Customer Exclusion Review)
  produced exactly the worked example from the phase brief (Bedrock +
  AgentCore + n8n + OutSystems + API Gateway + Observability, with a full
  migration sequence and 6 guardrails); `GET /workspaces/1/estate/architecture-summary`
  correctly rolled up "2 automations resolve BOUNDED_EXECUTION to UiPath,
  3 resolve REASONING to AWS Bedrock" etc. across the real seeded estate.
- **Status**: VERIFIED for the core decision logic, migration sequencing,
  guardrail derivation, and the ambiguity/gap-detection rule. NOT BUILT:
  any frontend surface for this phase (platform catalog editor, target
  architecture view, estate architecture summary view) — API-only, same
  gap as the estate-intelligence phase's frontend. Also NOT BUILT: linking
  a target architecture's platform choices back to *specific* unlock
  opportunities from the estate phase (e.g. "adding the SAP write API
  unlocks 6 of these migration plans") — the phase brief's closing example
  sentence describes exactly this link, and it does not exist yet; the
  estate phase's unlock analysis and this phase's target architecture are
  currently two separate, uncombined views over the same underlying data.
- **Unresolved limitation**: role-need detection and platform selection are
  both single-pass, rule-based heuristics tuned to the fixtures on hand —
  they have not been stress-tested against automations with, e.g.,
  multiple distinct UI systems needing different BOUNDED_EXECUTION
  treatment, or a process needing two different REASONING platforms for
  two genuinely different decision points. Both are plausible real-world
  cases this V0 does not yet distinguish (it treats each role as
  single-valued per automation).
