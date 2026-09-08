from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from apps.api.app.db import get_db
from apps.api.app.models import orm
from apps.api.app.pipeline import process_upload_and_assess
from apps.api.app.serializers import serialize_assessment
from apps.api.app.core.config import settings
from parser.uipath.extract import UnsafeArchiveError

router = APIRouter(tags=["uploads"])


@router.post("/workspaces/{workspace_id}/uploads", status_code=201)
async def upload_process(
    workspace_id: int,
    file: UploadFile = File(...),
    automation_id: int | None = Form(default=None),
    automation_name: str | None = Form(default=None),
    db: Session = Depends(get_db),
):
    workspace = db.query(orm.Workspace).filter_by(id=workspace_id).first()
    if not workspace:
        raise HTTPException(404, "Workspace not found")

    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, "File exceeds maximum allowed upload size")

    if automation_id is not None:
        automation = db.query(orm.Automation).filter_by(id=automation_id, workspace_id=workspace_id).first()
        if not automation:
            raise HTTPException(404, "Automation not found in this workspace")
    else:
        automation = orm.Automation(workspace_id=workspace_id, name=automation_name or file.filename or "Untitled Automation")
        db.add(automation)
        db.flush()

    try:
        assessment = process_upload_and_assess(db, automation, file.filename or "upload", data)
    except UnsafeArchiveError as e:
        db.rollback()
        raise HTTPException(400, f"Rejected upload: {e}")

    return {
        "automation_id": automation.id,
        "process_version_id": assessment.process_version_id,
        "assessment": serialize_assessment(assessment),
    }
