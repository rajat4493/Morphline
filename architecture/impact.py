"""Phase 4: Transformation Impact — composes `estate.simulation` with
`architecture.plan`. Deliberately does not introduce a new decision
engine: it runs the exact same simulation used for unlock analysis, then
calls `generate_target_architecture` twice (once on the real current
state, once on the simulated post-fix state) and diffs the results role by
role. If the simulation is honest (see estate/simulation.py) and the
architecture generator is honest (see architecture/plan.py), the
composition is honest for free — that's the point of keeping this module
thin.
"""
from __future__ import annotations

from packages.shared.architecture_types import (
    ComponentChange,
    EstateArchitectureSummary,
    PlatformProfile,
    PlatformRole,
    TargetArchitecturePlan,
    TransformationImpact,
    TransformationImpactResult,
)
from architecture.plan import generate_target_architecture, summarize_estate_architecture
from estate.simulation import SimInput, simulate_automation
from estate.unlock import resolution_override_for
from packages.shared.estate_types import SharedConstraint, SimulationScenario
from scoring.engine import score_process


def _diff_components(current: list, simulated: list) -> list[ComponentChange]:
    current_by_role = {c.role: c for c in current}
    simulated_by_role = {c.role: c for c in simulated}
    all_roles = set(current_by_role) | set(simulated_by_role)

    changes: list[ComponentChange] = []
    for role in all_roles:
        before = current_by_role.get(role)
        after = simulated_by_role.get(role)
        before_platform = before.platform if before else None
        after_platform = after.platform if after else None
        before_manual = before.manual_decision_required if before else False
        after_manual = after.manual_decision_required if after else False
        changed = (
            before_platform != after_platform
            or before_manual != after_manual
            or (before is None) != (after is None)
        )
        changes.append(ComponentChange(
            role=role, before_platform=before_platform, after_platform=after_platform,
            before_manual_decision=before_manual, after_manual_decision=after_manual,
            added=before is None and after is not None,
            removed=before is not None and after is None,
            changed=changed,
        ))
    return sorted(changes, key=lambda c: c.role.value)


def compute_transformation_impact(
    scenario: SimulationScenario, inputs: list[SimInput], catalog: list[PlatformProfile],
) -> TransformationImpactResult:
    targets = inputs if scenario.automation_ids is None else [i for i in inputs if i.automation_id in scenario.automation_ids]

    impacts: list[TransformationImpact] = []
    current_plans: list[TargetArchitecturePlan] = []
    simulated_plans: list[TargetArchitecturePlan] = []
    unresolved: list[str] = []
    unlock_count = 0

    for sim_input in targets:
        current_scores = score_process(sim_input.process_model, sim_input.business_context)
        current_plan = generate_target_architecture(
            sim_input.automation_id, sim_input.name, sim_input.process_model,
            current_scores, sim_input.current_recommendation, sim_input.business_context, catalog,
        )

        sim_pm, sim_biz, sim_rec, sim_scores, notes, full_equivalence_used = simulate_automation(
            sim_input.process_model, sim_input.business_context, scenario.overrides,
        )
        simulated_plan = generate_target_architecture(
            sim_input.automation_id, sim_input.name, sim_pm, sim_scores, sim_rec, sim_biz, catalog,
        )

        current_plans.append(current_plan)
        simulated_plans.append(simulated_plan)

        before_state = sim_input.current_recommendation.recommended_state
        after_state = sim_rec.recommended_state
        state_changed = before_state != after_state or sim_input.current_recommendation.recommended_pattern != sim_rec.recommended_pattern

        if state_changed and after_state.rank > before_state.rank:
            unlock_count += 1

        if full_equivalence_used:
            note = f"{sim_input.name}: relies on a full API-equivalence assumption with no confirmed capability coverage — treat as an upper bound"
            if note not in unresolved:
                unresolved.append(note)
        for m in sim_rec.missing_evidence:
            note = f"{sim_input.name}: {m}"
            if note not in unresolved:
                unresolved.append(note)

        impacts.append(TransformationImpact(
            automation_id=sim_input.automation_id, automation_name=sim_input.name,
            current_architecture=current_plan, simulated_architecture=simulated_plan,
            component_changes=_diff_components(current_plan.components, simulated_plan.components),
            current_state=before_state.value, simulated_state=after_state.value, state_changed=state_changed,
            remaining_blockers=[w.text for w in sim_rec.why_not_further],
        ))

    platform_usage_before = [summarize_estate_architecture(current_plans, role) for role in PlatformRole]
    platform_usage_after = [summarize_estate_architecture(simulated_plans, role) for role in PlatformRole]

    return TransformationImpactResult(
        scenario_name=scenario.name, impacts=impacts,
        platform_usage_before=platform_usage_before, platform_usage_after=platform_usage_after,
        unlock_count=unlock_count, unresolved_factors=unresolved,
    )


def compute_impact_for_shared_constraint(
    constraint: SharedConstraint, sim_inputs_by_automation_id: dict[int, SimInput], catalog: list[PlatformProfile],
) -> TransformationImpactResult | None:
    """The one-click path from an already-computed SharedConstraint (as
    shown to a user picking a decision to explore) to its transformation
    impact — reuses the exact same category->assumption mapping unlock
    analysis uses (`estate.unlock.resolution_override_for`), scoped to
    just the automations that constraint actually affects. Returns None
    when the category has no modeled resolution mechanism (e.g.
    INSUFFICIENT_BUSINESS_CONTEXT) — the caller should say so, not guess
    one."""
    override = resolution_override_for(constraint.category, constraint.canonical_dependency)
    if override is None:
        return None
    inputs = [sim_inputs_by_automation_id[aid] for aid in constraint.affected_automation_ids if aid in sim_inputs_by_automation_id]
    if not inputs:
        return None
    scenario = SimulationScenario(
        name=f"Resolve {constraint.category.value}" + (f" ({constraint.canonical_dependency})" if constraint.canonical_dependency else ""),
        overrides=[override], automation_ids=[i.automation_id for i in inputs],
    )
    return compute_transformation_impact(scenario, inputs, catalog)
