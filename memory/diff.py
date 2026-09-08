"""Reassessment comparison (Section 14): never silently overwrite, always diff."""
from __future__ import annotations

from packages.shared.memory_types import AssessmentSnapshot, ReassessmentDiff
from packages.shared.scoring_types import DimensionScore

_SIGNIFICANT_DELTA = 10  # score points


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


def compare_assessments(previous: AssessmentSnapshot, current: AssessmentSnapshot) -> ReassessmentDiff:
    what_changed = _dimension_changes(previous.dimensions, current.dimensions)

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

    why = []
    if higher_level_possible:
        why.append(
            f"Recommended state moved from {previous.recommendation.recommended_state.label} to "
            f"{current.recommendation.recommended_state.label} because: " + "; ".join(what_resolved or what_changed or ["updated evidence"])
        )
    elif curr_rank < prev_rank:
        why.append(
            f"Recommended state moved down from {previous.recommendation.recommended_state.label} to "
            f"{current.recommendation.recommended_state.label} because: " + "; ".join(new_risks or what_changed or ["updated evidence"])
        )
    else:
        why.append("Recommended state is unchanged since the previous assessment.")

    return ReassessmentDiff(
        what_changed=what_changed,
        what_resolved=what_resolved,
        new_risks=new_risks,
        higher_level_possible=higher_level_possible,
        why=why,
    )
