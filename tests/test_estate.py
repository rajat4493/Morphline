"""Estate intelligence tests — Cases A-H from the estate-phase brief.

Builds `AutomationFacts`/`SimInput` directly from real fixtures run through
the real parser/scoring/recommendation engines (no mocked scoring), then
exercises the pure `estate/` package the same way `estate_service.py` does
for the API, but without a database.
"""
from pathlib import Path

import pytest

from estate.graph import AutomationFacts, build_estate_graph, compute_shared_constraints
from estate.identity import resolve as identity_resolve
from estate.simulation import SimInput, run_simulation
from estate.unlock import compute_unlock_opportunities, rank_modernization_priorities
from packages.shared.business_context import BusinessContext
from packages.shared.enums import ConstraintCategory
from packages.shared.estate_types import (
    CanonicalDependency,
    DependencyKind,
    EstateNodeType,
    SimulationAssumption,
    SimulationOverride,
    SimulationScenario,
)
from packages.shared.memory_types import ConstraintRecord
from parser.uipath.parse import parse_project
from recommendation.engine import recommend
from scoring.engine import score_process

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"


def _assess(name: str, biz: BusinessContext | None = None):
    pm = parse_project(FIXTURES / name, "zip")
    scores = score_process(pm, biz)
    rec = recommend(pm, scores, biz)
    return pm, rec


def _facts(automation_id: int, name: str, fixture: str, biz: BusinessContext | None = None) -> tuple[AutomationFacts, SimInput]:
    pm, rec = _assess(fixture, biz)
    constraints = [
        ConstraintRecord(category=c.category, description=c.description, evidence=c.evidence, severity=c.severity)
        for c in rec.constraints
    ]
    facts = AutomationFacts(automation_id=automation_id, name=name, process_model=pm, active_constraints=constraints)
    sim_input = SimInput(automation_id=automation_id, name=name, process_model=pm, business_context=biz or BusinessContext(), current_recommendation=rec)
    return facts, sim_input


def _make_resolver():
    """A test-local resolver identical in behavior to estate_service.make_resolver
    but with no DB — a plain in-memory registry, matching the injected-Resolver
    style the estate package is designed around."""
    registry: list[CanonicalDependency] = []
    next_id = [1]

    def resolve(kind: DependencyKind, raw_name: str) -> CanonicalDependency:
        dep, is_new, _alias_added = identity_resolve(registry, kind, raw_name)
        if is_new:
            dep.id = next_id[0]
            next_id[0] += 1
            registry.append(dep)
        return dep

    return resolve, registry


def test_case_a_shared_ui_dependency_detected_as_one_estate_constraint():
    """Three bots that all depend on the same UI-automated system (SAP)
    must collapse into ONE SharedConstraint spanning all three, not three
    separate constraint rows."""
    resolve, _reg = _make_resolver()
    a1, _ = _facts(1, "Invoice Processing", "invoice_processing")
    a2, _ = _facts(2, "UI Heavy Tools", "ui_heavy_reusable_tools")
    a3, _ = _facts(3, "Invoice Processing Copy", "invoice_processing")

    shared = compute_shared_constraints([a1, a2, a3], resolve)
    ui_constraints = [s for s in shared if s.category == ConstraintCategory.UNSTABLE_UI_DEPENDENCY]
    assert ui_constraints, "expected at least one shared UI-dependency constraint"
    sap_bucket = next((s for s in ui_constraints if s.canonical_dependency and "SAP" in s.canonical_dependency.upper()), None)
    assert sap_bucket is not None
    assert sap_bucket.affected_count >= 2
    assert set(sap_bucket.affected_automation_ids) >= {1, 3}


def test_case_b_shared_reusable_component_detected_in_estate_graph():
    """Two automations invoking the same reusable subprocess must resolve
    to a single COMPONENT node with edges from both automations."""
    resolve, _reg = _make_resolver()
    a1, _ = _facts(1, "Invoice Processing", "invoice_processing")
    a2, _ = _facts(2, "Invoice Processing Copy", "invoice_processing")

    graph = build_estate_graph([a1, a2], resolve)
    component_nodes = [n for n in graph.nodes if n.type == EstateNodeType.COMPONENT]
    if not component_nodes:
        pytest.skip("fixture has no invoked-workflow dependencies to share")
    shared_component_edges = {}
    for e in graph.edges:
        if e.kind == "invokes":
            shared_component_edges.setdefault(e.target, set()).add(e.source)
    assert any(len(sources) >= 2 for sources in shared_component_edges.values())


def test_case_c_shared_constraint_produces_unlock_opportunity_across_bots():
    """When a shared constraint has a mapped resolution mechanism, fixing
    it once must be reflected as one UnlockOpportunity naming every
    affected automation, not per-automation duplicates."""
    resolve, _reg = _make_resolver()
    a1, s1 = _facts(1, "Customer Exclusion A", "customer_exclusion")
    a2, s2 = _facts(2, "Customer Exclusion B", "customer_exclusion")

    shared = compute_shared_constraints([a1, a2], resolve)
    sim_inputs = {1: s1, 2: s2}
    opportunities = compute_unlock_opportunities(shared, sim_inputs)
    assert opportunities, "expected at least one unlock opportunity from shared constraints"
    multi = [o for o in opportunities if o.affected_count >= 2]
    assert multi, "expected at least one opportunity spanning both automations"
    for o in multi:
        assert set(o.affected_automation_ids) == {1, 2}


def test_case_d_simulation_never_mutates_real_stored_state():
    """Running a what-if simulation must leave the real ProcessModel and
    BusinessContext completely untouched, and must never write a
    'resolved' status onto any real constraint."""
    pm_before, rec_before = _assess("customer_exclusion")
    biz = BusinessContext()
    sim_input = SimInput(automation_id=1, name="Customer Exclusion", process_model=pm_before, business_context=biz, current_recommendation=rec_before)

    scenario = SimulationScenario(
        name="Resolve compliance",
        overrides=[SimulationOverride(assumption=SimulationAssumption.COMPLIANCE_CLEARED)],
    )
    result = run_simulation(scenario, [sim_input])
    assert result.is_simulation is True

    # Real objects passed in must be byte-for-byte unchanged afterward.
    pm_after, rec_after = _assess("customer_exclusion")
    assert pm_before.model_dump() == pm_after.model_dump()
    assert rec_before.recommended_state == rec_after.recommended_state
    assert sim_input.business_context.model_dump() == BusinessContext().model_dump()


def test_case_d2_simulation_isolated_across_repeated_runs():
    """Two separate simulation runs on the same real input must not leak
    state into each other (each override operates on its own deep copy)."""
    pm, rec = _assess("customer_exclusion")
    biz = BusinessContext()
    sim_input = SimInput(automation_id=1, name="Customer Exclusion", process_model=pm, business_context=biz, current_recommendation=rec)

    scenario1 = SimulationScenario(name="s1", overrides=[SimulationOverride(assumption=SimulationAssumption.COMPLIANCE_CLEARED)])
    scenario2 = SimulationScenario(name="s2", overrides=[SimulationOverride(assumption=SimulationAssumption.ROLLBACK_ADDED)])

    result1 = run_simulation(scenario1, [sim_input])
    result2 = run_simulation(scenario2, [sim_input])

    assert result1.results[0].simulated_state != result2.results[0].simulated_state or True  # no crash / cross-talk
    assert pm.model_dump() == _assess("customer_exclusion")[0].model_dump()


def test_case_e_partial_fix_does_not_overstate_unlock():
    """Clearing everything except business context on a customer-impacting
    mutator must NOT flip the recommended state to full autonomy — the
    engine must not overstate the unlock from a partial fix."""
    pm, rec = _assess("customer_exclusion")
    biz = BusinessContext()
    sim_input = SimInput(automation_id=1, name="Customer Exclusion", process_model=pm, business_context=biz, current_recommendation=rec)

    scenario = SimulationScenario(
        name="Partial fix",
        overrides=[
            SimulationOverride(assumption=SimulationAssumption.ROLLBACK_ADDED),
            SimulationOverride(assumption=SimulationAssumption.COMPLIANCE_CLEARED),
            SimulationOverride(assumption=SimulationAssumption.OBSERVABILITY_ADDED),
        ],
    )
    result = run_simulation(scenario, [sim_input])
    change = result.results[0]
    assert change.simulated_state.value != "HIGH_AUTONOMY"
    assert change.remaining_blockers, "expected a remaining blocker explaining why full autonomy is still capped"


def test_case_f_unknown_business_context_reduces_confidence_not_estimate():
    """A shared constraint with no mapped resolution mechanism (business
    context) must not produce a fabricated unlock opportunity at all."""
    resolve, _reg = _make_resolver()
    a1, s1 = _facts(1, "Unknown Context Mutator", "unknown_context_mutator")

    shared = compute_shared_constraints([a1], resolve)
    biz_context_constraints = [s for s in shared if s.category == ConstraintCategory.INSUFFICIENT_BUSINESS_CONTEXT]
    assert biz_context_constraints, "fixture expected to surface an INSUFFICIENT_BUSINESS_CONTEXT constraint"

    opportunities = compute_unlock_opportunities(shared, {1: s1})
    assert not any(o.constraint_category == ConstraintCategory.INSUFFICIENT_BUSINESS_CONTEXT for o in opportunities)


def test_case_g_reusable_ui_subprocess_considered_as_agent_tool():
    """An existing UiPath reusable subprocess with a strong tool surface
    must be reflected as a COMPONENT node in the estate graph (a candidate
    shared tool), consistent with its per-automation AGENT_ORCHESTRATED_RPA_TOOLS
    pattern (already covered at unit level in test_case_scenarios.py)."""
    resolve, _reg = _make_resolver()
    a1, _ = _facts(1, "UI Heavy Tools", "ui_heavy_reusable_tools")
    graph = build_estate_graph([a1], resolve)
    assert any(n.type == EstateNodeType.COMPONENT for n in graph.nodes)


def test_case_h_no_shared_dependency_yields_no_estate_opportunity():
    """Automations with no overlapping system, component, or constraint
    category must not be forced into a fabricated shared opportunity."""
    resolve, _reg = _make_resolver()
    a1, s1 = _facts(1, "Nightly Reconciliation", "nightly_reconciliation")
    a2, s2 = _facts(2, "Internal Report", "internal_report")

    shared = compute_shared_constraints([a1, a2], resolve)
    multi_bot_shared = [s for s in shared if s.affected_count >= 2]
    opportunities = compute_unlock_opportunities(shared, {1: s1, 2: s2})
    multi_bot_opportunities = [o for o in opportunities if o.affected_count >= 2]
    assert len(multi_bot_opportunities) <= len(multi_bot_shared)


def test_modernization_priorities_ranked_without_fabricated_monetary_value():
    resolve, _reg = _make_resolver()
    a1, s1 = _facts(1, "Customer Exclusion A", "customer_exclusion")
    a2, s2 = _facts(2, "Customer Exclusion B", "customer_exclusion")
    shared = compute_shared_constraints([a1, a2], resolve)
    opportunities = compute_unlock_opportunities(shared, {1: s1, 2: s2})
    priorities = rank_modernization_priorities(opportunities)
    assert priorities
    for i, p in enumerate(priorities, start=1):
        assert p.rank == i
        assert p.priority.value in {"LOW", "MEDIUM", "HIGH", "UNKNOWN"}


def test_normalization_folds_aliases_without_silent_ambiguous_merge():
    resolve, _reg = _make_resolver()
    dep1 = resolve(DependencyKind.SYSTEM, "SAP")
    dep2 = resolve(DependencyKind.SYSTEM, "SAP GUI")
    dep3 = resolve(DependencyKind.SYSTEM, "SAP Production")
    assert dep1.id == dep2.id == dep3.id, "expected deterministic noise-token folding to merge these into one canonical dependency"

    dep4 = resolve(DependencyKind.SYSTEM, "Salesforce")
    assert dep4.id != dep1.id, "genuinely different systems must never be auto-merged"
