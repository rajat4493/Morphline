"""Reassessment comparison (Section 14/16): never silently overwrite, always
diff — and compare Business Context alongside the technical model, since a
process can move Migration Pattern (or become newly eligible) purely
because enterprise context changed, with no code change at all."""
from __future__ import annotations

from typing import Optional

from packages.shared.business_context import BusinessContext
from packages.shared.memory_types import AssessmentSnapshot, ReassessmentDiff
from packages.shared.scoring_types import DimensionScore

_SIGNIFICANT_DELTA = 10  # score points

_BUSINESS_FIELDS = (
    "customer_impact", "financial_impact", "legal_regulatory_impact", "employee_impact",
    "external_party_impact", "maximum_scope", "monetary_exposure",
    "human_accountability_required", "mandatory_approval", "irreversible_action",
    "regulated_process", "sensitive_data", "critical_service",
)


def _dimension_changes(previous: dict[str, DimensionScore], current: dict[str, DimensionScore]) -> list[str]:
    changes = []
    for dim, cur in current.items():
        prev = previous.get(dim)
        if prev is None:
            continue
        delta = cur.score - prev.score
        if abs(delta) >= _SIGNIFICANT_DELTA or prev.level != cur.level:
            direction = "increased" if delta > 0 else "decreased"
            changes.append(f"{cur.label} {direction} from {prev.score} ({prev.level.value}) to {cur.score} ({cur.level.value})")
    return changes


def _business_context_changes(previous: Optional[BusinessContext], current: Optional[BusinessContext]) -> list[str]:
    if previous is None and current is None:
        return []
    prev = previous or BusinessContext()
    curr = current or BusinessContext()
    changes = []
    for field in _BUSINESS_FIELDS:
        old_val, new_val = getattr(prev, field), getattr(curr, field)
        if old_val != new_val:
            changes.append(f"{field.replace('_', ' ')} changed from {old_val.value} to {new_val.value}")
    return changes


def compare_assessments(previous: AssessmentSnapshot, current: AssessmentSnapshot) -> ReassessmentDiff:
    what_changed = _dimension_changes(previous.dimensions, current.dimensions)
    business_context_changes = _business_context_changes(previous.business_context, current.business_context)

    prev_categories = {c.category for c in previous.active_constraints}
    curr_categories = {c.category for c in current.active_constraints}

    what_resolved = [
        f"{c.category.value.replace('_', ' ').title()} constraint resolved: {c.description}"
        for c in previous.active_constraints
        if c.category not in curr_categories
    ]
    new_risks = [
        f"{c.category.value.replace('_', ' ').title()}: {c.description}"
        for c in current.active_constraints
        if c.category not in prev_categories
    ]

    prev_rank = previous.recommendation.recommended_state.rank
    curr_rank = current.recommendation.recommended_state.rank
    higher_level_possible = curr_rank > prev_rank
    evolution_state_changed = curr_rank != prev_rank
    migration_pattern_changed = previous.recommendation.recommended_pattern != current.recommendation.recommended_pattern

    why = []
    if higher_level_possible:
        why.append(
            f"Recommended state moved from {previous.recommendation.recommended_state.label} to "
            f"{current.recommendation.recommended_state.label} because: " + "; ".join(what_resolved or business_context_changes or what_changed or ["updated evidence"])
        )
    elif curr_rank < prev_rank:
        why.append(
            f"Recommended state moved down from {previous.recommendation.recommended_state.label} to "
            f"{current.recommendation.recommended_state.label} because: " + "; ".join(new_risks or what_changed or ["updated evidence"])
        )
    else:
        why.append("Recommended state is unchanged since the previous assessment.")

    if migration_pattern_changed:
        why.append(
            f"Recommended Migration Pattern changed from {previous.recommendation.recommended_pattern.label} to "
            f"{current.recommendation.recommended_pattern.label}" + (f" because: {'; '.join(business_context_changes)}" if business_context_changes else ".")
        )

    return ReassessmentDiff(
        what_changed=what_changed,
        what_resolved=what_resolved,
        new_risks=new_risks,
        business_context_changes=business_context_changes,
        evolution_state_changed=evolution_state_changed,
        migration_pattern_changed=migration_pattern_changed,
        higher_level_possible=higher_level_possible,
        why=why,
    )
