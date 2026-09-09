"""Phase 3 endpoints: enterprise platform catalog + per-automation and
estate-level target architecture. Nothing here is persisted except the
platform catalog itself (the one piece of genuinely new customer-specific
data this phase introduces) — target architecture plans are recomputed
fresh from existing assessment data + the current catalog on every call,
matching the estate router's compute-on-demand pattern.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from apps.api.app.architecture_service import (
    add_platform,
    build_target_architecture,
    delete_platform,
    ensure_default_catalog,
    load_platform_catalog,
)
from apps.api.app.db import get_db
from apps.api.app.estate_service import load_workspace_snapshots
from apps.api.app.models import orm
from architecture.plan import summarize_estate_architecture
from packages.shared.architecture_types import PlatformRole

router = APIRouter(tags=["architecture"])


def _get_workspace(db: Session, workspace_id: int) -> orm.Workspace:
    ws = db.query(orm.Workspace).filter_by(id=workspace_id).first()
    if not ws:
        raise HTTPException(404, "Workspace not found")
    return ws


@router.get("/workspaces/{workspace_id}/platform-catalog")
def get_platform_catalog(workspace_id: int, db: Session = Depends(get_db)):
    _get_workspace(db, workspace_id)
    ensure_default_catalog(db, workspace_id)
    return [p.model_dump(mode="json") for p in load_platform_catalog(db, workspace_id)]


class AddPlatformRequest(BaseModel):
    name: str
    role: PlatformRole
    notes: str | None = None


@router.post("/workspaces/{workspace_id}/platform-catalog", status_code=201)
def post_platform(workspace_id: int, payload: AddPlatformRequest, db: Session = Depends(get_db)):
    _get_workspace(db, workspace_id)
    ensure_default_catalog(db, workspace_id)
    profile = add_platform(db, workspace_id, payload.name, payload.role, payload.notes)
    return profile.model_dump(mode="json")


@router.delete("/workspaces/{workspace_id}/platform-catalog/{platform_id}", status_code=204)
def delete_platform_endpoint(workspace_id: int, platform_id: int, db: Session = Depends(get_db)):
    _get_workspace(db, workspace_id)
    if not delete_platform(db, workspace_id, platform_id):
        raise HTTPException(404, "Platform not found in this workspace")


@router.get("/automations/{automation_id}/target-architecture")
def get_target_architecture(automation_id: int, db: Session = Depends(get_db)):
    automation = db.query(orm.Automation).filter_by(id=automation_id).first()
    if not automation:
        raise HTTPException(404, "Automation not found")
    ensure_default_catalog(db, automation.workspace_id)
    catalog = load_platform_catalog(db, automation.workspace_id)
    snapshots = load_workspace_snapshots(db, automation.workspace_id)
    snapshot = next((s for s in snapshots if s.automation_id == automation_id), None)
    if snapshot is None:
        raise HTTPException(404, "No completed assessment for this automation yet")
    plan = build_target_architecture(snapshot, catalog)
    return plan.model_dump(mode="json")


@router.get("/workspaces/{workspace_id}/estate/architecture-summary")
def get_estate_architecture_summary(workspace_id: int, db: Session = Depends(get_db)):
    """The 'N automations resolve to platform X for role Y' rollup across
    the whole estate, one row per PlatformRole."""
    _get_workspace(db, workspace_id)
    ensure_default_catalog(db, workspace_id)
    catalog = load_platform_catalog(db, workspace_id)
    snapshots = load_workspace_snapshots(db, workspace_id)
    plans = [build_target_architecture(s, catalog) for s in snapshots]
    return [summarize_estate_architecture(plans, role).model_dump(mode="json") for role in PlatformRole]
