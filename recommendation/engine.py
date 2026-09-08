"""The decision engine: recommends an architecture, not just a number.

Core rule (product thesis): do not maximize autonomy. A dimension score of
"HIGH reasoning need" only ever raises the *desired* state; risk-side
dimensions (blast radius, reversibility, compliance, tool readiness,
observability) act as hard ceilings that cap it back down. The two
questions this module must always answer are WHY THIS STATE and WHY NOT
THE NEXT STATE (Section 11).
"""
from __future__ import annotations

from packages.shared.canonical import ProcessModel
from packages.shared.enums import ConstraintCategory, ConstraintSeverity, EvolutionState, Level, NodeCategory
from packages.shared.recommendation_types import ConstraintDraft, RecommendationResult
from packages.shared.scoring_types import DimensionScore

_LADDER = list(EvolutionState)


def _rank(state: EvolutionState) -> int:
    return state.rank


def _by_rank(rank: int) -> EvolutionState:
    rank = max(1, min(len(_LADDER), rank))
    return _LADDER[rank - 1]


def determine_current_state(pm: ProcessModel) -> EvolutionState:
    steps = pm.all_steps()
    if any(s.category == NodeCategory.REASONING for s in steps):
        return EvolutionState.AUGMENTED_RPA
    return EvolutionState.DETERMINISTIC_RPA


def _desired_state(scores: dict[str, DimensionScore]) -> EvolutionState:
    reasoning = scores["reasoning_need"]
    if reasoning.level == Level.HIGH:
        return EvolutionState.HIGH_AUTONOMY
    if reasoning.level == Level.MEDIUM:
        return EvolutionState.HYBRID_AGENT
    tool = scores["tool_readiness"]
    data = scores["data_readiness"]
    if tool.level != Level.LOW or data.level != Level.LOW:
        return EvolutionState.AUGMENTED_RPA
    return EvolutionState.DETERMINISTIC_RPA


def determine_ceiling(scores: dict[str, DimensionScore]) -> tuple[EvolutionState, list[ConstraintDraft]]:
    """The maximum safe state today, plus the constraints that produced it."""
    blast = scores["blast_radius"]
    reversibility = scores["reversibility"]
    compliance = scores["compliance_sensitivity"]
    tool = scores["tool_readiness"]
    observability = scores["observability"]
    dependency = scores["dependency_complexity"]

    constraints: list[ConstraintDraft] = []

    if tool.level == Level.LOW:
        constraints.append(ConstraintDraft(
            category=ConstraintCategory.UNSTABLE_UI_DEPENDENCY,
            description="The process relies on UI-level automation rather than stable APIs; handing ambiguous authority to an agent operating brittle selectors is not safe yet.",
            evidence=tool.evidence, severity=ConstraintSeverity.HIGH,
        ))

    high_risk_reasons: list[ConstraintDraft] = []
    if blast.level == Level.HIGH:
        high_risk_reasons.append(ConstraintDraft(
            category=ConstraintCategory.HIGH_BLAST_RADIUS,
            description="An incorrect autonomous decision could affect multiple external systems or customers.",
            evidence=blast.evidence, severity=ConstraintSeverity.HIGH,
        ))
    if compliance.level == Level.HIGH:
        high_risk_reasons.append(ConstraintDraft(
            category=ConstraintCategory.COMPLIANCE_RESTRICTION,
            description="Regulatory/policy exposure requires a human to remain accountable for the decision.",
            evidence=compliance.evidence, severity=ConstraintSeverity.HIGH,
        ))
    if reversibility.level == Level.LOW:
        high_risk_reasons.append(ConstraintDraft(
            category=ConstraintCategory.POOR_REVERSIBILITY,
            description="Actions taken cannot be reliably undone if the decision is wrong.",
            evidence=reversibility.evidence, severity=ConstraintSeverity.HIGH,
        ))
    constraints.extend(high_risk_reasons)

    if observability.level == Level.LOW:
        constraints.append(ConstraintDraft(
            category=ConstraintCategory.WEAK_OBSERVABILITY,
            description="Incorrect autonomous behavior would not be reliably or quickly detected.",
            evidence=observability.evidence, severity=ConstraintSeverity.MEDIUM,
        ))

    if dependency.level == Level.HIGH:
        constraints.append(ConstraintDraft(
            category=ConstraintCategory.ARCHITECTURE_LIMITATION,
            description="The process depends on many external systems/components, increasing coordination risk for autonomous execution.",
            evidence=dependency.evidence, severity=ConstraintSeverity.MEDIUM,
        ))

    if tool.level == Level.LOW:
        ceiling = EvolutionState.AUGMENTED_RPA
    elif high_risk_reasons:
        ceiling = EvolutionState.HYBRID_AGENT
    elif observability.level == Level.LOW:
        ceiling = EvolutionState.HYBRID_AGENT
    else:
        ceiling = EvolutionState.HIGH_AUTONOMY

    return ceiling, constraints


def recommend(pm: ProcessModel, scores: dict[str, DimensionScore]) -> RecommendationResult:
    current = determine_current_state(pm)
    desired = _desired_state(scores)
    ceiling, constraints = determine_ceiling(scores)

    recommended = _by_rank(min(_rank(desired), _rank(ceiling)))
    next_possible = _by_rank(_rank(recommended) + 1)

    was_capped = _rank(desired) > _rank(ceiling)

    why_this = [
        f"Reasoning Need is {scores['reasoning_need'].level.value}: {scores['reasoning_need'].explanation}",
        f"Tool/API Readiness is {scores['tool_readiness'].level.value}: {scores['tool_readiness'].explanation}",
    ]
    if was_capped:
        why_this.append(
            f"Although the process's reasoning profile alone would support {desired.label}, "
            f"risk constraints cap the safe target at {ceiling.label}."
        )
    else:
        why_this.append(f"No risk constraint currently caps the recommendation below {desired.label}.")

    if constraints:
        why_not_further = [
            f"{c.category.value.replace('_', ' ').title()}: {c.description}" for c in constraints
        ]
    else:
        why_not_further = [
            f"No active blockers were found. {next_possible.label} may become appropriate once "
            "further reasoning need or tool integration evidence accumulates — reassess after "
            "runtime evidence is available."
        ]

    top_reasons = why_this[:3]
    top_blockers = why_not_further[:3]

    confidence_values = [s.confidence for s in scores.values()]
    unknown_count = sum(1 for v in confidence_values if v == Level.LOW)
    overall_confidence = Level.LOW if unknown_count >= 4 else (Level.MEDIUM if unknown_count >= 1 else Level.HIGH)

    return RecommendationResult(
        current_state=current,
        recommended_state=recommended,
        maximum_safe_state=ceiling,
        next_possible_state=next_possible,
        confidence=overall_confidence,
        why_this=why_this,
        why_not_further=why_not_further,
        top_reasons=top_reasons,
        top_blockers=top_blockers,
        constraints=constraints,
    )
