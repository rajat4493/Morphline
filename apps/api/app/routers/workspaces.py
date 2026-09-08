from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from apps.api.app.db import get_db
from apps.api.app.models import orm

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


class WorkspaceCreate(BaseModel):
    name: str


@router.get("")
def list_workspaces(db: Session = Depends(get_db)):
    rows = db.query(orm.Workspace).order_by(orm.Workspace.created_at.desc()).all()
    return [{"id": w.id, "name": w.name, "created_at": w.created_at, "automation_count": len(w.automations)} for w in rows]


@router.post("", status_code=201)
def create_workspace(payload: WorkspaceCreate, db: Session = Depends(get_db)):
    ws = orm.Workspace(name=payload.name)
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return {"id": ws.id, "name": ws.name, "created_at": ws.created_at}


@router.get("/{workspace_id}")
def get_workspace(workspace_id: int, db: Session = Depends(get_db)):
    ws = db.query(orm.Workspace).filter_by(id=workspace_id).first()
    if not ws:
        raise HTTPException(404, "Workspace not found")
    return {
        "id": ws.id,
        "name": ws.name,
        "created_at": ws.created_at,
        "automations": [{"id": a.id, "name": a.name, "is_sample": a.is_sample, "version_count": len(a.versions)} for a in ws.automations],
    }
