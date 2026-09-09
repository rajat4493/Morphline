"""Unlock analysis: "if I fix one thing, what does it unlock?" (the
brief's central estate-level question). Built entirely on top of
`estate.graph.compute_shared_constraints` and `estate.simulation.run_simulation`
— no separate scoring path, so an unlock estimate can never disagree with
what a real reassessment would show once the fix actually lands.

Rule enforced here: never invent a monetary value. `unlock_leverage` is
always LOW/MEDIUM/HIGH derived from the actual simulated unlock count, or
explicitly `leverage_is_unknown=True` — never a fabricated ROI number. Note
this is technical leverage (how much moves), not business value (how much
it's worth) — see the field's docstring in estate_types.py for why those
are kept separate rather than conflated into one "estimated value".
"""
from __future__ import annotations

from collections import Counter
from typing import Optional

from packages.shared.enums import ConstraintCategory, Level
from packages.shared.estate_types import (
    ModernizationPriority,
    SharedConstraint,
    SimulationAssumption,
    SimulationOverride,
    SimulationScenario,
    UnlockOpportunity,
)
from estate.simulation import SimInput, run_simulation

# Which simulated assumption resolves which constraint category. A category
# with no entry here still shows up as a SharedConstraint (visible,
# countable) but produces no unlock estimate — we do not guess at a
# resolution mechanism we haven't modeled (e.g. INSUFFICIENT_BUSINESS_CONTEXT
# has no single estate-wide "fix"; it's resolved per-automation by a human
# supplying that automation's own facts, not by one platform change).
_RESOLUTION_ASSUMPTION: dict[ConstraintCategory, SimulationAssumption] = {
    ConstraintCategory.UNSTABLE_UI_DEPENDENCY: SimulationAssumption.API_AVAILABLE,
    ConstraintCategory.POOR_REVERSIBILITY: SimulationAssumption.ROLLBACK_ADDED,
    ConstraintCategory.WEAK_OBSERVABILITY: SimulationAssumption.OBSERVABILITY_ADDED,
    ConstraintCategory.COMPLIANCE_RESTRICTION: SimulationAssumption.COMPLIANCE_CLEARED,
    ConstraintCategory.MANDATORY_APPROVAL: SimulationAssumption.APPROVAL_ADDED,
    ConstraintCategory.ARCHITECTURE_LIMITATION: SimulationAssumption.DEPENDENCY_STABILIZED,
}


def _resolution_override(category: ConstraintCategory, canonical_dependency: Optional[str]) -> Optional[SimulationOverride]:
    assumption = _RESOLUTION_ASSUMPTION.get(category)
    if assumption is None:
        return None
    return SimulationOverride(assumption=assumption, canonical_dependency=canonical_dependency)


def resolution_override_for(category: ConstraintCategory, canonical_dependency: Optional[str]) -> Optional[SimulationOverride]:
    """Public wrapper so other callers (e.g. `architecture/impact.py`, when
    a caller wants the transformation impact of resolving one specific
    already-computed SharedConstraint) reuse the exact same
    category -> assumption mapping unlock analysis uses, instead of
    duplicating it. Returns None for a category with no modeled resolution
    mechanism (e.g. INSUFFICIENT_BUSINESS_CONTEXT) — same as unlock
    analysis silently skipping it, just surfaced to the caller instead."""
    return _resolution_override(category, canonical_dependency)


def _estimate_leverage(affected_count: int, unlock_count: int) -> tuple[Level, bool]:
    if affected_count == 0:
        return Level.LOW, True
    ratio = unlock_count / affected_count
    if unlock_count >= 5 or ratio >= 0.6:
        return Level.HIGH, False
    if unlock_count >= 2 or ratio >= 0.3:
        return Level.MEDIUM, False
    return Level.LOW, False


def _priority_from(unlock_count: int, confidence: Level) -> Level:
    if unlock_count >= 5 and confidence != Level.LOW:
        return Level.HIGH
    if unlock_count >= 2:
        return Level.MEDIUM
    return Level.LOW


def compute_unlock_opportunities(
    shared_constraints: list[SharedConstraint], sim_inputs_by_automation_id: dict[int, SimInput]
) -> list[UnlockOpportunity]:
    opportunities: list[UnlockOpportunity] = []

    for sc in shared_constraints:
        if sc.affected_count == 0:
            continue
        override = _resolution_override(sc.category, sc.canonical_dependency)
        if override is None:
            continue

        inputs = [sim_inputs_by_automation_id[aid] for aid in sc.affected_automation_ids if aid in sim_inputs_by_automation_id]
        if not inputs:
            continue

        scenario = SimulationScenario(
            name=f"Resolve {sc.category.value}" + (f" ({sc.canonical_dependency})" if sc.canonical_dependency else ""),
            overrides=[override], automation_ids=[i.automation_id for i in inputs],
        )
        result = run_simulation(scenario, inputs)

        confidence = Level.LOW if result.unresolved_factors else Level.MEDIUM
        leverage, leverage_unknown = _estimate_leverage(sc.affected_count, result.unlock_count)

        opportunities.append(UnlockOpportunity(
            constraint_key=sc.key, constraint_category=sc.category, canonical_dependency=sc.canonical_dependency,
            affected_automation_ids=sc.affected_automation_ids, affected_count=sc.affected_count,
            current_states=dict(Counter(r.current_state.value for r in result.results)),
            simulated_states=dict(Counter(r.simulated_state.value for r in result.results)),
            state_changes=result.results, estimated_unlock_count=result.unlock_count,
            unlock_leverage=leverage, leverage_is_unknown=leverage_unknown, confidence=confidence,
            evidence=[f"{r.automation_name}: {r.current_state.value} -> {r.simulated_state.value}" for r in result.results if r.changed],
            assumptions=result.assumptions, unresolved_factors=result.unresolved_factors,
            priority=_priority_from(result.unlock_count, confidence),
        ))

    return sorted(opportunities, key=lambda o: o.estimated_unlock_count, reverse=True)


_LEVEL_RANK = {Level.LOW: 0, Level.MEDIUM: 1, Level.HIGH: 2}


def rank_modernization_priorities(opportunities: list[UnlockOpportunity]) -> list[ModernizationPriority]:
    ranked = sorted(opportunities, key=lambda o: (_LEVEL_RANK[o.priority], o.estimated_unlock_count), reverse=True)
    out: list[ModernizationPriority] = []
    for i, o in enumerate(ranked, start=1):
        title = (
            f"{o.canonical_dependency} modernization" if o.canonical_dependency
            else f"{o.constraint_category.value.replace('_', ' ').title()} resolution"
        )
        reasons = [f"{o.affected_count} automation(s) affected", f"{o.estimated_unlock_count} likely evolution unlock(s)"]
        if o.unresolved_factors:
            reasons.append(f"{len(o.unresolved_factors)} unresolved factor(s) remain even after this fix")
        if o.leverage_is_unknown:
            reasons.append("unlock leverage unknown — no automations currently affected enough to estimate")
        out.append(ModernizationPriority(
            rank=i, title=title, canonical_dependency=o.canonical_dependency, affected_count=o.affected_count,
            estimated_unlock_count=o.estimated_unlock_count, priority=o.priority, confidence=o.confidence, reasons=reasons,
        ))
    return out
