"""The decision engine: recommends an architecture, not just a number.

Core rule (product thesis): do not maximize autonomy. This module answers
"what is the safest, most valuable form this automation can take today?" —
never "how much AI does this automation already contain?" (Section 1).

Two independent judgments feed the final recommendation, and neither one
alone determines it:

- **Evolution Value** (`_evolution_value`): would agentic reasoning
  meaningfully help this process at all? Driven by `reasoning_opportunity`
  plus exception-handling opportunity, unstructured-data opportunity, and
  manual-intervention opportunity — never by `current_ai_usage` (Section 3,
  12). A process can have excellent APIs and still correctly stay
  deterministic if there's no real judgment to be made.
- **Safety Ceiling** (`determine_ceiling`): the maximum state considered
  *safe* today, driven by risk-side dimensions plus Business Context.
  Critically, when the process can mutate production state and key
  enterprise-risk facts are still UNKNOWN, the ceiling is capped even
  though no specific risk was *confirmed* — absence of evidence is not
  evidence of safety (Section 13).

recommended_state = min(desired-from-evolution-value, ceiling). A
Migration Pattern (Section 11) is then chosen on top of the evolution
state, since two processes at the same state can call for different
architectures.
"""
from __future__ import annotations

from typing import Optional

from packages.shared.business_context import BusinessContext
from packages.shared.canonical import ProcessModel
from packages.shared.enums import (
    ConstraintCategory,
    ConstraintSeverity,
    EvolutionState,
    Level,
    MigrationPattern,
    TriState,
    WhyNotReasonType,
)
from packages.shared.recommendation_types import ConstraintDraft, RecommendationResult, WhyNotReason
from packages.shared.scoring_types import DimensionScore, EvidenceType
from scoring.dimensions import ExecutionSurfaceProfile, process_has_mutating_authority

_LADDER = list(EvolutionState)


def _rank(state: EvolutionState) -> int:
    return state.rank


def _by_rank(rank: int) -> EvolutionState:
    rank = max(1, min(len(_LADDER), rank))
    return _LADDER[rank - 1]


def _biz(context: Optional[BusinessContext]) -> BusinessContext:
    return context if context is not None else BusinessContext()


def determine_current_state(pm: ProcessModel) -> EvolutionState:
    """What the automation IS today — descriptive, from `current_ai_usage`
    only. Never conflated with what it SHOULD become (Section 1)."""
    from packages.shared.enums import NodeCategory

    steps = pm.all_steps()
    if any(s.category == NodeCategory.REASONING for s in steps):
        return EvolutionState.AUGMENTED_RPA
    return EvolutionState.DETERMINISTIC_RPA


def _evolution_value(scores: dict[str, DimensionScore]) -> int:
    """Composite "would agentic reasoning meaningfully help this process?"
    score. Reasoning Opportunity dominates; exception-handling ambiguity,
    unstructured-data reliance, and manual-intervention volume contribute
    as secondary evolution-value signals (Section 12)."""
    reasoning = scores["reasoning_opportunity"].score
    exception_opportunity = scores["exception_complexity"].score
    unstructured_opportunity = 100 - scores["data_readiness"].score
    manual_opportunity = scores["human_approval_need"].score
    return round(
        0.55 * reasoning
        + 0.20 * exception_opportunity
        + 0.15 * unstructured_opportunity
        + 0.10 * manual_opportunity
    )


def _desired_state(scores: dict[str, DimensionScore], evolution_value: int) -> EvolutionState:
    if evolution_value >= 70:
        return EvolutionState.HIGH_AUTONOMY
    if evolution_value >= 40:
        return EvolutionState.HYBRID_AGENT
    tool = scores["execution_tool_readiness"]
    data = scores["data_readiness"]
    if tool.level != Level.LOW or data.level != Level.LOW:
        return EvolutionState.AUGMENTED_RPA
    return EvolutionState.DETERMINISTIC_RPA


def determine_ceiling(
    pm: ProcessModel, scores: dict[str, DimensionScore], biz: BusinessContext
) -> tuple[EvolutionState, list[ConstraintDraft]]:
    """The maximum safe state today, plus the constraints that produced it."""
    blast = scores["blast_radius"]
    reversibility = scores["reversibility"]
    compliance = scores["compliance_sensitivity"]
    tool = scores["execution_tool_readiness"]
    observability = scores["observability"]
    dependency = scores["dependency_complexity"]

    constraints: list[ConstraintDraft] = []

    if tool.level == Level.LOW:
        constraints.append(ConstraintDraft(
            category=ConstraintCategory.UNSTABLE_UI_DEPENDENCY,
            description="No reliable, bounded execution surface (API, database, queue, or reusable subprocess) is "
                        "available yet; any UI automation present is not encapsulated as a reusable, bounded tool. "
                        "Handing ambiguous authority to an agent without a dependable way to act is not safe yet.",
            evidence=tool.evidence, severity=ConstraintSeverity.HIGH,
            autonomy_cap=EvolutionState.AUGMENTED_RPA,
            resolution_condition="Wrap the UI automation in a reusable, argument-bound subprocess, or replace it with a stable API/DB/queue integration.",
        ))

    # Confirmed (HIGH-confidence) risk factors block outright; risk factors
    # resting only on inference or absent confirmation are treated as
    # UNKNOWN, not BLOCKED — see docs/recommendation-engine.md.
    confirmed_high_risk: list[ConstraintDraft] = []
    if blast.level == Level.HIGH:
        confirmed_high_risk.append(ConstraintDraft(
            category=ConstraintCategory.HIGH_BLAST_RADIUS,
            description="An incorrect autonomous decision could affect multiple external systems, customers, or a meaningful scope of the business.",
            evidence=blast.evidence, severity=ConstraintSeverity.HIGH,
            autonomy_cap=EvolutionState.HYBRID_AGENT,
            resolution_condition="Confirm impact is contained, or add a human checkpoint before any high-blast-radius action.",
        ))
    if compliance.level == Level.HIGH and compliance.confidence == Level.HIGH:
        confirmed_high_risk.append(ConstraintDraft(
            category=ConstraintCategory.COMPLIANCE_RESTRICTION,
            description="Regulatory/policy exposure is confirmed and requires a human to remain accountable for the decision.",
            evidence=compliance.evidence, severity=ConstraintSeverity.HIGH,
            autonomy_cap=EvolutionState.HYBRID_AGENT,
            resolution_condition="A compliance/legal review would need to explicitly clear autonomous execution.",
        ))
    if reversibility.level == Level.LOW and reversibility.confidence == Level.HIGH:
        confirmed_high_risk.append(ConstraintDraft(
            category=ConstraintCategory.POOR_REVERSIBILITY,
            description="Actions taken cannot be reliably undone if the decision is wrong (confirmed by Business Context).",
            evidence=reversibility.evidence, severity=ConstraintSeverity.HIGH,
            autonomy_cap=EvolutionState.HYBRID_AGENT,
            resolution_condition="Add a compensating/rollback action, or confirm the business can tolerate/manually correct errors.",
        ))
    constraints.extend(confirmed_high_risk)

    unconfirmed_risk: list[ConstraintDraft] = []
    if reversibility.level == Level.LOW and reversibility.confidence != Level.HIGH:
        unconfirmed_risk.append(ConstraintDraft(
            category=ConstraintCategory.POOR_REVERSIBILITY,
            description="No technical rollback path was detected, and business reversibility has not been confirmed.",
            evidence=reversibility.evidence, severity=ConstraintSeverity.MEDIUM,
            autonomy_cap=EvolutionState.HYBRID_AGENT,
            resolution_condition="Confirm via Business Context whether this action can be reversed operationally, contractually, or manually.",
        ))
    if compliance.level in (Level.MEDIUM, Level.HIGH) and compliance.confidence != Level.HIGH:
        unconfirmed_risk.append(ConstraintDraft(
            category=ConstraintCategory.COMPLIANCE_RESTRICTION,
            description="Compliance-sensitive terminology was detected but not confirmed by Business Context.",
            evidence=compliance.evidence, severity=ConstraintSeverity.MEDIUM,
            autonomy_cap=EvolutionState.HYBRID_AGENT,
            resolution_condition="Confirm via Business Context whether policy or regulation requires human approval.",
        ))
    constraints.extend(unconfirmed_risk)

    if observability.level == Level.LOW:
        constraints.append(ConstraintDraft(
            category=ConstraintCategory.WEAK_OBSERVABILITY,
            description="Incorrect autonomous behavior would not be reliably or quickly detected.",
            evidence=observability.evidence, severity=ConstraintSeverity.MEDIUM,
            autonomy_cap=EvolutionState.HYBRID_AGENT,
            resolution_condition="Add logging/alerting sufficient to detect an incorrect autonomous decision quickly.",
        ))

    if dependency.level == Level.HIGH:
        constraints.append(ConstraintDraft(
            category=ConstraintCategory.ARCHITECTURE_LIMITATION,
            description="The process depends on many external systems/components, increasing coordination risk for autonomous execution.",
            evidence=dependency.evidence, severity=ConstraintSeverity.MEDIUM,
            autonomy_cap=EvolutionState.ADVANCED_HYBRID,
            resolution_condition="Reduce or stabilize the dependency surface, or validate coordinated failure handling.",
        ))

    # Section 13: absence of evidence is not evidence of safety. If this
    # process can mutate production state and the enterprise-risk-relevant
    # fields are still unknown, autonomy is capped regardless of whether any
    # specific technical blocker fired.
    mutates = process_has_mutating_authority(pm)
    if mutates and biz.has_critical_unknowns():
        constraints.append(ConstraintDraft(
            category=ConstraintCategory.INSUFFICIENT_BUSINESS_CONTEXT,
            description=(
                "This process can mutate production state, but critical enterprise risk factors "
                f"({', '.join(biz.critical_unknown_fields())}) have not been supplied. "
                "Full autonomy cannot be justified until impact, compliance, and reversibility are confirmed."
            ),
            evidence=[],
            severity=ConstraintSeverity.HIGH,
            autonomy_cap=EvolutionState.HYBRID_AGENT,
            resolution_condition="Complete the Business Context for this process (customer/financial/legal impact, scope, reversibility, approval requirements).",
        ))

    if tool.level == Level.LOW:
        ceiling = EvolutionState.AUGMENTED_RPA
    elif confirmed_high_risk or unconfirmed_risk or (mutates and biz.has_critical_unknowns()):
        ceiling = EvolutionState.HYBRID_AGENT
    elif observability.level == Level.LOW:
        ceiling = EvolutionState.HYBRID_AGENT
    elif dependency.level == Level.HIGH:
        ceiling = EvolutionState.ADVANCED_HYBRID
    else:
        ceiling = EvolutionState.HIGH_AUTONOMY

    return ceiling, constraints


def _select_migration_pattern(
    recommended: EvolutionState, scores: dict[str, DimensionScore], biz: BusinessContext, profile: ExecutionSurfaceProfile
) -> MigrationPattern:
    mandatory_approval = biz.mandatory_approval == TriState.YES or scores["human_approval_need"].level == Level.HIGH

    if recommended == EvolutionState.DETERMINISTIC_RPA:
        return MigrationPattern.KEEP_DETERMINISTIC_RPA
    if recommended == EvolutionState.AUGMENTED_RPA:
        return MigrationPattern.RPA_WITH_AI_AUGMENTATION
    if recommended == EvolutionState.HIGH_AUTONOMY:
        return MigrationPattern.HIGH_AUTONOMY_AGENT

    # HYBRID_AGENT or ADVANCED_HYBRID
    if mandatory_approval:
        return MigrationPattern.HYBRID_WITH_HUMAN_APPROVAL
    if profile.has_bounded_subprocesses and not profile.api_dominant:
        return MigrationPattern.AGENT_ORCHESTRATED_RPA_TOOLS
    if profile.has_apis:
        return MigrationPattern.AGENT_WITH_API_TOOLS
    if recommended == EvolutionState.HYBRID_AGENT:
        return MigrationPattern.DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION
    return MigrationPattern.AGENT_WITH_API_TOOLS


def _classify_why_not(
    constraints: list[ConstraintDraft], ceiling: EvolutionState, evolution_value: int, capped: bool
) -> list[WhyNotReason]:
    reasons: list[WhyNotReason] = []
    for c in constraints:
        if c.category == ConstraintCategory.UNSTABLE_UI_DEPENDENCY:
            reasons.append(WhyNotReason(reason_type=WhyNotReasonType.NOT_READY, text=c.description))
        elif c.category == ConstraintCategory.WEAK_OBSERVABILITY:
            reasons.append(WhyNotReason(reason_type=WhyNotReasonType.NOT_READY, text=c.description))
        elif c.category == ConstraintCategory.INSUFFICIENT_BUSINESS_CONTEXT:
            reasons.append(WhyNotReason(reason_type=WhyNotReasonType.UNKNOWN, text=c.description))
        elif "not confirmed" in c.description.lower() or "not been confirmed" in c.description.lower():
            reasons.append(WhyNotReason(reason_type=WhyNotReasonType.UNKNOWN, text=c.description))
        elif c.category in (ConstraintCategory.HIGH_BLAST_RADIUS, ConstraintCategory.COMPLIANCE_RESTRICTION, ConstraintCategory.POOR_REVERSIBILITY):
            reasons.append(WhyNotReason(reason_type=WhyNotReasonType.BLOCKED, text=c.description))
        else:
            reasons.append(WhyNotReason(reason_type=WhyNotReasonType.BLOCKED, text=c.description))

    if not reasons:
        if capped:
            # Ceiling below top-of-ladder but no active constraint drafted this
            # cycle (e.g. only dependency complexity nudged it) — still say why.
            reasons.append(WhyNotReason(
                reason_type=WhyNotReasonType.NOT_READY,
                text=f"Maximum safe state today is {ceiling.label}; see Constraint Memory for the specific factors.",
            ))
        elif evolution_value < 25:
            reasons.append(WhyNotReason(
                reason_type=WhyNotReasonType.NOT_VALUABLE,
                text=(
                    "This process is already highly deterministic and shows little evidence of ambiguity, "
                    "judgment, or unstructured input. Introducing agentic reasoning here would add complexity "
                    "without a corresponding business benefit — there is no meaningful reason to make this more autonomous."
                ),
            ))
        else:
            reasons.append(WhyNotReason(
                reason_type=WhyNotReasonType.NOT_VALUABLE,
                text="No active blocker was found, but current evidence does not yet justify pushing beyond the recommended state.",
            ))
    return reasons


def recommend(pm: ProcessModel, scores: dict[str, DimensionScore], biz: Optional[BusinessContext] = None) -> RecommendationResult:
    biz = _biz(biz)
    current = determine_current_state(pm)
    evolution_value = _evolution_value(scores)
    desired = _desired_state(scores, evolution_value)
    ceiling, constraints = determine_ceiling(pm, scores, biz)

    recommended = _by_rank(min(_rank(desired), _rank(ceiling)))
    next_possible = _by_rank(_rank(recommended) + 1)
    capped = _rank(desired) > _rank(ceiling)

    profile = ExecutionSurfaceProfile(pm)
    pattern = _select_migration_pattern(recommended, scores, biz, profile)

    why_this = [
        f"Reasoning Opportunity is {scores['reasoning_opportunity'].level.value}: {scores['reasoning_opportunity'].explanation}",
        f"Execution Tool Readiness is {scores['execution_tool_readiness'].level.value}: {scores['execution_tool_readiness'].explanation}",
        f"Evolution Value score: {evolution_value}/100 (composite of reasoning opportunity, exception-handling ambiguity, unstructured-data reliance, and manual-intervention volume).",
    ]
    if capped:
        why_this.append(
            f"Although the process's evolution-value profile alone would support {desired.label}, "
            f"risk constraints cap the safe target at {ceiling.label}."
        )
    else:
        why_this.append(f"No risk constraint currently caps the recommendation below {desired.label}.")

    why_not_further = _classify_why_not(constraints, ceiling, evolution_value, capped)

    top_reasons = why_this[:3]
    top_blockers = [r.text for r in why_not_further[:3]]

    missing_evidence: list[str] = []
    for dim_key in ("blast_radius", "reversibility", "compliance_sensitivity", "runtime_stability"):
        s = scores[dim_key]
        if s.confidence == Level.LOW and not s.evidence:
            missing_evidence.append(f"{s.label}: no evidence available")
        elif s.confidence == Level.LOW:
            missing_evidence.append(f"{s.label}: only low-confidence/inferred evidence available")
    if biz.has_critical_unknowns():
        missing_evidence.append("Business Context: " + ", ".join(biz.critical_unknown_fields()) + " not supplied")

    confidence_values = [s.confidence for s in scores.values()]
    unknown_count = sum(1 for v in confidence_values if v == Level.LOW)
    overall_confidence = Level.LOW if unknown_count >= 4 or biz.has_critical_unknowns() else (Level.MEDIUM if unknown_count >= 1 else Level.HIGH)

    return RecommendationResult(
        current_state=current,
        recommended_state=recommended,
        maximum_safe_state=ceiling,
        next_possible_state=next_possible,
        recommended_pattern=pattern,
        confidence=overall_confidence,
        why_this=why_this,
        why_not_further=why_not_further,
        top_reasons=top_reasons,
        top_blockers=top_blockers,
        missing_evidence=missing_evidence,
        constraints=constraints,
    )
