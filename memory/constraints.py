"""Constraint memory (Section 12): the system remembers why a process was
blocked, and tracks whether that is still true across reassessments.

Constraints are matched across assessments by category — a simple but
effective key at this scale. If the same category is no longer produced by
the recommendation engine on reassessment, the prior constraint transitions
to RESOLVED — or, if the original evidence was never fully certain, to
POSSIBLY_RESOLVED (D-012 / Section 15): a category disappearing because an
INFERRED/UNKNOWN-confidence signal simply stopped firing is not the same
as a confirmed fix, and auto-resolving it would claim certainty the system
doesn't have.
"""
from __future__ import annotations

from datetime import datetime, timezone

from packages.shared.enums import Confidence, ConstraintStatus
from packages.shared.memory_types import ConstraintRecord
from packages.shared.recommendation_types import ConstraintDraft


def _was_fully_certain(record: ConstraintRecord) -> bool:
    """Whether the constraint being resolved rested entirely on KNOWN
    evidence. Business-context-derived constraints with no technical
    evidence at all (e.g. INSUFFICIENT_BUSINESS_CONTEXT) are never
    "fully certain" in this sense — they resolve only when a human
    supplies the missing context, which the reassessment flow handles
    explicitly rather than through this generic path."""
    if not record.evidence:
        return False
    return all(item.confidence == Confidence.KNOWN for item in record.evidence)


def reconcile_constraints(
    previously_active: list[ConstraintRecord],
    new_drafts: list[ConstraintDraft],
) -> tuple[list[ConstraintRecord], list[ConstraintRecord]]:
    """Returns (constraints_to_create, constraints_to_transition).

    Transitioned constraints carry their new `status` (RESOLVED or
    POSSIBLY_RESOLVED) — the caller persists whichever status is set.
    Existing active constraints whose category still appears in
    `new_drafts` are left untouched by the caller (not returned in either
    list) — only genuinely new or genuinely resolved/possibly-resolved
    constraints are acted on, so status/created_at history is preserved.
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
                autonomy_cap=draft.autonomy_cap,
                resolution_condition=draft.resolution_condition,
                created_at=now,
                first_seen=now,
                last_seen=now,
            ))

    to_transition: list[ConstraintRecord] = []
    for category, record in previous_by_category.items():
        if category not in new_by_category:
            new_status = ConstraintStatus.RESOLVED if _was_fully_certain(record) else ConstraintStatus.POSSIBLY_RESOLVED
            note = (
                "No longer detected by the recommendation engine on reassessment."
                if new_status == ConstraintStatus.RESOLVED else
                "Potential resolution detected — the triggering evidence was inferred, not confirmed. "
                "Confirm before treating this as resolved."
            )
            to_transition.append(record.model_copy(update={
                "status": new_status,
                "resolved_at": now,
                "resolution_notes": note,
            }))

    return to_create, to_transition
