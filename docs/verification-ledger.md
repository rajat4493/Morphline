# Verification Ledger — Estate Intelligence Phase

For each major capability introduced in the estate-intelligence phase: what
was required, where it lives, what evidence backs the claim it works, and
what is not yet resolved. Statuses: **VERIFIED** (automated test + manual
check), **TESTED** (automated test only), **MANUAL-ONLY** (smoke-tested via
curl/script, no automated test yet), **PARTIAL** (built but with a known
gap), **NOT BUILT**.

## 1. Canonical identity / normalization

- **Requirement**: fold different raw names for the same system/component
  into one canonical identity deterministically; never silently merge
  genuinely ambiguous ones.
- **Implementation**: `estate/normalize.py`, `estate/identity.py`,
  `CanonicalDependencyRow` (`apps/api/app/models/orm.py`).
- **Test evidence**: `tests/test_estate.py::test_normalization_folds_aliases_without_silent_ambiguous_merge`.
- **Manual evidence**: live API smoke test — `GET /workspaces/1/canonical-dependencies`
  showed Excel/SAP entries each with one confirmed alias after seeding 8
  sample automations.
- **Status**: VERIFIED.
- **Unresolved limitation**: no fixture yet deliberately varies raw names
  across automations (e.g. "SAP" in one, "SAP Production" in another) to
  prove cross-automation folding beyond the identical-string case; the
  identity-layer unit test covers this directly, but no end-to-end fixture
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
- **Implementation**: `estate/graph.py::compute_shared_constraints`.
- **Test evidence**: `test_case_a_shared_ui_dependency_detected_as_one_estate_constraint`,
  `test_case_h_no_shared_dependency_yields_no_estate_opportunity`.
- **Manual evidence**: live `GET /estate/shared-constraints` against 8 seeded
  automations — correctly grouped POOR_REVERSIBILITY (3), INSUFFICIENT_BUSINESS_CONTEXT
  (3), COMPLIANCE_RESTRICTION (2), WEAK_OBSERVABILITY (2), and a SAP-specific
  UNSTABLE_UI_DEPENDENCY bucket.
- **Status**: VERIFIED.

## 4. Unlock analysis

- **Requirement**: "if I fix one thing, what does it unlock?" — never
  invent monetary value; LOW/MEDIUM/HIGH/unknown only.
- **Implementation**: `estate/unlock.py::compute_unlock_opportunities`.
- **Test evidence**: `test_case_c_shared_constraint_produces_unlock_opportunity_across_bots`,
  `test_case_f_unknown_business_context_reduces_confidence_not_estimate`,
  `test_modernization_priorities_ranked_without_fabricated_monetary_value`.
- **Manual evidence**: live `GET /estate/unlock-opportunities` — correctly
  showed 0 unlock for a POOR_REVERSIBILITY-only fix when other blockers
  remain on the same automations (real-data confirmation of Case E logic).
- **Status**: VERIFIED. `estimated_value` is provably never a fabricated
  number — it is `Level.LOW/MEDIUM/HIGH` derived from `result.unlock_count`,
  or `value_is_unknown=True` when `affected_count == 0`.

## 5. What-if simulation

- **Requirement**: never mutate real stored constraints; never mark a
  constraint resolved because the user simulated it; must run through the
  real scoring/recommendation engines, not a parallel shortcut.
- **Implementation**: `estate/simulation.py`.
- **Test evidence**: `test_case_d_simulation_never_mutates_real_stored_state`,
  `test_case_d2_simulation_isolated_across_repeated_runs`,
  `test_case_e_partial_fix_does_not_overstate_unlock`.
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

## Summary

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

Test count at end of phase: **79 passing** (63 pre-existing + 16 new: 11 in
`tests/test_estate.py`, 1 in the same file for Execution Surface Profile,
4 in `tests/test_flow_readability.py`). No pre-existing test was modified or
weakened.
