"""Constraint memory (Section 12): the system remembers why a process was
blocked, and tracks whether that is still true across reassessments.

Constraints are matched across assessments by category — a simple but
effective key at this scale. If the same category is no longer produced by
the recommendation engine on reassessment, the prior constraint is resolved
rather than silently dropped (D-008: append-only lifecycle).
"""
from __future__ import annotations

from datetime import datetime, timezone

from packages.shared.enums import ConstraintStatus
from packages.shared.memory_types import ConstraintRecord
from packages.shared.recommendation_types import ConstraintDraft


def reconcile_constraints(
    previously_active: list[ConstraintRecord],
    new_drafts: list[ConstraintDraft],
) -> tuple[list[ConstraintRecord], list[ConstraintRecord]]:
    """Returns (constraints_to_create, constraints_to_resolve).

    Existing active constraints whose category still appears in
    `new_drafts` are left untouched by the caller (not returned in either
    list) — only genuinely new or genuinely resolved constraints are acted
    on, so status/created_at history is preserved.
    """
    now = datetime.now(timezone.utc)
    previous_by_category = {c.category: c for c in previously_active}
    new_by_category = {d.category: d for d in new_drafts}

    to_create: list[ConstraintRecord] = []
    for category, draft in new_by_category.items():
        if category not in previous_by_category:
            to_create.append(ConstraintRecord(
                category=draft.category,
                description=draft.description,
                evidence=draft.evidence,
                severity=draft.severity,
                status=ConstraintStatus.ACTIVE,
                created_at=now,
            ))

    to_resolve: list[ConstraintRecord] = []
    for category, record in previous_by_category.items():
        if category not in new_by_category:
            resolved = record.model_copy(update={
                "status": ConstraintStatus.RESOLVED,
                "resolved_at": now,
                "resolution_notes": "No longer detected by the recommendation engine on reassessment.",
            })
            to_resolve.append(resolved)

    return to_create, to_resolve
