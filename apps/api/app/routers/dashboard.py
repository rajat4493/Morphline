from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from apps.api.app.db import get_db
from apps.api.app.models import orm

router = APIRouter(prefix="/workspaces/{workspace_id}/dashboard", tags=["dashboard"])


def _latest_assessment(automation: orm.Automation) -> orm.Assessment | None:
    if not automation.versions:
        return None
    version = automation.versions[-1]
    if not version.assessments:
        return None
    return max(version.assessments, key=lambda a: a.created_at)


@router.get("")
def get_dashboard(workspace_id: int, db: Session = Depends(get_db)):
    workspace = db.query(orm.Workspace).filter_by(id=workspace_id).first()
    if not workspace:
        raise HTTPException(404, "Workspace not found")

    automations = workspace.automations
    state_counts: Counter[str] = Counter()
    quick_wins, high_risk, newly_eligible, needs_review = [], [], [], []
    constraint_category_counts: Counter[str] = Counter()

    for automation in automations:
        assessment = _latest_assessment(automation)
        if not assessment or not assessment.recommendation:
            needs_review.append({"id": automation.id, "name": automation.name, "reason": "Not yet assessed"})
            continue

        rec = assessment.recommendation
        state_counts[rec.recommended_state] += 1

        active = [c for c in automation.constraints if c.status == "ACTIVE"]
        for c in active:
            constraint_category_counts[c.category] += 1

        card = {
            "id": automation.id, "name": automation.name,
            "current_state": rec.current_state, "recommended_state": rec.recommended_state,
            "maximum_safe_state": rec.maximum_safe_state, "confidence": rec.confidence,
            "active_constraint_count": len(active),
        }

        if rec.recommended_state != rec.current_state and len(active) <= 1:
            quick_wins.append(card)
        if any(c.severity in ("HIGH", "CRITICAL") for c in active):
            high_risk.append(card)
        events = sorted(automation.events, key=lambda e: e.occurred_at)
        if any(e.event_type == "REASSESSMENT" for e in events):
            latest_events = [e for e in events if e.event_type == "REASSESSMENT"]
            if latest_events and "moved to" in latest_events[-1].description.lower():
                newly_eligible.append(card)
        if assessment.recommendation.confidence == "LOW":
            needs_review.append({**card, "reason": "Low confidence — insufficient evidence"})

    return {
        "workspace": {"id": workspace.id, "name": workspace.name},
        "estate": {
            "total_processes": len(automations),
            "by_state": {
                "DETERMINISTIC_RPA": state_counts.get("DETERMINISTIC_RPA", 0),
                "AUGMENTED_RPA": state_counts.get("AUGMENTED_RPA", 0),
                "HYBRID_AGENT": state_counts.get("HYBRID_AGENT", 0),
                "ADVANCED_HYBRID": state_counts.get("ADVANCED_HYBRID", 0),
                "HIGH_AUTONOMY": state_counts.get("HIGH_AUTONOMY", 0),
            },
        },
        "top_constraints": [{"category": cat, "count": n} for cat, n in constraint_category_counts.most_common(6)],
        "quick_wins": quick_wins,
        "high_risk_migrations": high_risk,
        "newly_eligible": newly_eligible,
        "requires_architect_review": needs_review,
    }
