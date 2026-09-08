"""Business Context endpoints (Section 4/5). Reading/writing enterprise
risk facts a human supplies — never inferred from XAML. Saving triggers an
immediate reassessment against the automation's latest uploaded process
version (Section 5/16), since the technical model didn't change but the
recommendation might."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from apps.api.app.db import get_db
from apps.api.app.models import orm
from apps.api.app.pipeline import reassess_with_current_context, save_business_context
from apps.api.app.serializers import serialize_assessment, serialize_business_context
from packages.shared.business_context import BusinessContext

router = APIRouter(prefix="/automations/{automation_id}/business-context", tags=["business-context"])


def _get_automation(db: Session, automation_id: int) -> orm.Automation:
    automation = db.query(orm.Automation).filter_by(id=automation_id).first()
    if not automation:
        raise HTTPException(404, "Automation not found")
    return automation


@router.get("")
def get_business_context(automation_id: int, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    return serialize_business_context(automation.business_context)


@router.put("")
def update_business_context(automation_id: int, payload: BusinessContext, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    save_business_context(db, automation_id, payload)

    result = {"business_context": payload.model_dump(mode="json"), "assessment": None}
    if automation.versions:
        assessment = reassess_with_current_context(db, automation)
        result["assessment"] = serialize_assessment(assessment)
    else:
        db.commit()
    return result
