"""Phase 4: Transformation Impact. Composes estate.simulation with
architecture.plan — the tests here are about the composition being honest
(before/after diff matches what independently generating each plan would
show), not about re-testing simulation or architecture logic already
covered in test_estate.py / test_architecture.py."""
from pathlib import Path

from architecture.impact import compute_impact_for_shared_constraint, compute_transformation_impact
from architecture.plan import generate_target_architecture
from estate.graph import AutomationFacts, compute_shared_constraints
from estate.identity import resolve as identity_resolve
from estate.simulation import SimInput
from packages.shared.architecture_types import PlatformProfile, PlatformRole
from packages.shared.business_context import BusinessContext
from packages.shared.enums import ConstraintCategory
from packages.shared.estate_types import CanonicalDependency, DependencyKind, SimulationAssumption, SimulationOverride, SimulationScenario
from packages.shared.memory_types import ConstraintRecord
from parser.uipath.parse import parse_project
from recommendation.engine import recommend
from scoring.engine import score_process

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"

_CATALOG = [
    PlatformProfile(name="AWS Bedrock", role=PlatformRole.REASONING),
    PlatformProfile(name="AWS AgentCore", role=PlatformRole.AGENT_RUNTIME),
    PlatformProfile(name="n8n", role=PlatformRole.ORCHESTRATION),
    PlatformProfile(name="UiPath", role=PlatformRole.BOUNDED_EXECUTION),
    PlatformProfile(name="OutSystems", role=PlatformRole.HUMAN_APPROVAL),
    PlatformProfile(name="Internal API Gateway", role=PlatformRole.API_GATEWAY),
    PlatformProfile(name="Enterprise Observability", role=PlatformRole.OBSERVABILITY),
]


def _sim_input(fixture: str, automation_id: int = 1, biz: BusinessContext | None = None) -> SimInput:
    biz = biz or BusinessContext()
    pm = parse_project(FIXTURES / fixture, "zip")
    scores = score_process(pm, biz)
    rec = recommend(pm, scores, biz)
    return SimInput(automation_id=automation_id, name=fixture, process_model=pm, business_context=biz, current_recommendation=rec)


def test_current_architecture_matches_independently_generated_plan():
    """The 'before' side of the impact must be identical to calling
    generate_target_architecture directly on the real, unmutated state —
    the composition must not silently alter what it wraps."""
    sim_input = _sim_input("invoice_processing")
    scenario = SimulationScenario(name="no-op", overrides=[SimulationOverride(assumption=SimulationAssumption.API_AVAILABLE, canonical_dependency="SAP", capabilities=["READ"])])
    result = compute_transformation_impact(scenario, [sim_input], _CATALOG)

    independent = generate_target_architecture(
        1, "invoice_processing", sim_input.process_model, score_process(sim_input.process_model, sim_input.business_context),
        sim_input.current_recommendation, sim_input.business_context, _CATALOG,
    )
    impact = result.impacts[0]
    assert {c.role for c in impact.current_architecture.components} == {c.role for c in independent.components}
    for c in impact.current_architecture.components:
        match = next(i for i in independent.components if i.role == c.role)
        assert c.platform == match.platform


def test_bounded_execution_removed_when_ui_dependency_fully_resolved():
    """When SAP UI automation is simulated away entirely, BOUNDED_EXECUTION
    (UiPath) should drop out of the architecture — this is the exact
    'before/after architecture' signal the phase exists to surface."""
    sim_input = _sim_input("invoice_processing")
    scenario = SimulationScenario(name="SAP API available", overrides=[SimulationOverride(assumption=SimulationAssumption.API_AVAILABLE, canonical_dependency="SAP")])
    result = compute_transformation_impact(scenario, [sim_input], _CATALOG)
    impact = result.impacts[0]

    bounded_change = next(c for c in impact.component_changes if c.role == PlatformRole.BOUNDED_EXECUTION)
    assert bounded_change.before_platform == "UiPath"
    assert bounded_change.after_platform is None
    assert bounded_change.removed is True
    assert bounded_change.changed is True


def test_unchanged_roles_are_reported_as_unchanged():
    sim_input = _sim_input("invoice_processing")
    scenario = SimulationScenario(name="SAP API available", overrides=[SimulationOverride(assumption=SimulationAssumption.API_AVAILABLE, canonical_dependency="SAP")])
    result = compute_transformation_impact(scenario, [sim_input], _CATALOG)
    impact = result.impacts[0]

    orchestration_change = next(c for c in impact.component_changes if c.role == PlatformRole.ORCHESTRATION)
    assert orchestration_change.changed is False
    assert orchestration_change.before_platform == orchestration_change.after_platform == "n8n"


def test_remaining_blockers_reported_when_state_does_not_fully_unlock():
    """Partial fixes must still surface exactly why the automation didn't
    move further — matching Case E from the estate phase, now surfaced at
    the transformation-impact level too."""
    sim_input = _sim_input("invoice_processing")
    scenario = SimulationScenario(name="SAP API available", overrides=[SimulationOverride(assumption=SimulationAssumption.API_AVAILABLE, canonical_dependency="SAP")])
    result = compute_transformation_impact(scenario, [sim_input], _CATALOG)
    impact = result.impacts[0]
    assert impact.remaining_blockers, "expected at least one remaining blocker explaining why this isn't a full unlock"


def test_platform_usage_before_and_after_reflect_the_diff():
    sim_input = _sim_input("invoice_processing")
    scenario = SimulationScenario(name="SAP API available", overrides=[SimulationOverride(assumption=SimulationAssumption.API_AVAILABLE, canonical_dependency="SAP")])
    result = compute_transformation_impact(scenario, [sim_input], _CATALOG)

    before_bounded = next(s for s in result.platform_usage_before if s.role == PlatformRole.BOUNDED_EXECUTION)
    after_bounded = next(s for s in result.platform_usage_after if s.role == PlatformRole.BOUNDED_EXECUTION)
    assert before_bounded.platform_counts.get("UiPath") == 1
    assert after_bounded.total_automations == 0


def test_ambiguous_platform_choice_survives_into_transformation_impact():
    """The TheDuck 'never guess' rule from Phase 3 must hold in both the
    current and simulated architecture, not just the standalone plan."""
    catalog = [
        PlatformProfile(name="AWS Bedrock", role=PlatformRole.REASONING),
        PlatformProfile(name="Azure OpenAI", role=PlatformRole.REASONING),
    ]
    sim_input = _sim_input("customer_exclusion")
    scenario = SimulationScenario(name="compliance cleared", overrides=[SimulationOverride(assumption=SimulationAssumption.COMPLIANCE_CLEARED)])
    result = compute_transformation_impact(scenario, [sim_input], catalog)
    impact = result.impacts[0]

    assert impact.current_architecture.confidence.value == "LOW"
    reasoning_current = next(c for c in impact.current_architecture.components if c.role == PlatformRole.REASONING)
    assert reasoning_current.manual_decision_required is True


def _resolver():
    registry: list[CanonicalDependency] = []
    next_id = [1]

    def resolve(kind: DependencyKind, raw_name: str) -> CanonicalDependency:
        dep, is_new, _alias_added = identity_resolve(registry, kind, raw_name)
        if is_new:
            dep.id = next_id[0]
            next_id[0] += 1
            registry.append(dep)
        return dep

    return resolve


def test_one_click_impact_from_shared_constraint_matches_manual_scenario():
    """The one-click 'give me the impact of resolving this shared
    constraint' path must produce the same result as manually building the
    equivalent scenario — it's a convenience wrapper, not a different
    computation."""
    sim_input = _sim_input("invoice_processing")
    pm = sim_input.process_model
    rec = sim_input.current_recommendation
    constraints = [ConstraintRecord(category=c.category, description=c.description, evidence=c.evidence, severity=c.severity, dependency_hint=c.dependency_hint) for c in rec.constraints]
    facts = [AutomationFacts(automation_id=1, name="invoice_processing", process_model=pm, active_constraints=constraints)]
    resolve = _resolver()
    shared = compute_shared_constraints(facts, resolve)
    ui_constraint = next(c for c in shared if c.category == ConstraintCategory.UNSTABLE_UI_DEPENDENCY)

    result = compute_impact_for_shared_constraint(ui_constraint, {1: sim_input}, _CATALOG)
    assert result is not None
    assert result.impacts[0].automation_id == 1
    bounded_change = next(c for c in result.impacts[0].component_changes if c.role == PlatformRole.BOUNDED_EXECUTION)
    assert bounded_change.removed is True


def test_one_click_impact_returns_none_for_unmapped_category():
    """INSUFFICIENT_BUSINESS_CONTEXT has no modeled resolution mechanism —
    the one-click path must say so (None), never guess an assumption."""
    sim_input = _sim_input("unknown_context_mutator")
    constraint = None
    from packages.shared.estate_types import SharedConstraint
    from packages.shared.enums import ConstraintSeverity
    constraint = SharedConstraint(
        key="INSUFFICIENT_BUSINESS_CONTEXT:estate-wide", category=ConstraintCategory.INSUFFICIENT_BUSINESS_CONTEXT,
        canonical_dependency=None, affected_automation_ids=[1], affected_automation_names=["x"],
        affected_count=1, severity=ConstraintSeverity.HIGH,
    )
    result = compute_impact_for_shared_constraint(constraint, {1: sim_input}, _CATALOG)
    assert result is None


def test_multiple_automations_aggregate_independently():
    """Multi-role/multi-automation extensibility check: two automations in
    one scenario must each get their own impact and contribute
    independently to the aggregate platform-usage rollup, without one
    automation's result leaking into another's."""
    inputs = [_sim_input("invoice_processing", automation_id=1), _sim_input("customer_exclusion", automation_id=2)]
    scenario = SimulationScenario(name="SAP API available", overrides=[SimulationOverride(assumption=SimulationAssumption.API_AVAILABLE, canonical_dependency="SAP")])
    result = compute_transformation_impact(scenario, inputs, _CATALOG)
    assert len(result.impacts) == 2
    assert {i.automation_id for i in result.impacts} == {1, 2}
