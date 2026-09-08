from __future__ import annotations

import io
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from apps.api.app.db import get_db
from apps.api.app.flowgraph import build_flow_graph
from apps.api.app.models import orm
from apps.api.app.pipeline import assessment_dimension_scores, load_business_context, snapshot_from_assessment
from apps.api.app.serializers import serialize_assessment, serialize_business_context, serialize_constraint, serialize_event
from memory.diff import compare_assessments
from migration.pack import generate_pack
from packages.shared.canonical import ProcessModel
from llm.provider import get_llm_provider
from scoring.dimensions import build_execution_surface_profile_view

router = APIRouter(prefix="/automations", tags=["automations"])


def _get_automation(db: Session, automation_id: int) -> orm.Automation:
    automation = db.query(orm.Automation).filter_by(id=automation_id).first()
    if not automation:
        raise HTTPException(404, "Automation not found")
    return automation


def _latest_version(automation: orm.Automation) -> orm.ProcessVersion | None:
    return automation.versions[-1] if automation.versions else None


def _latest_assessment(version: orm.ProcessVersion) -> orm.Assessment | None:
    return max(version.assessments, key=lambda a: a.created_at) if version.assessments else None


@router.get("/{automation_id}")
def get_overview(automation_id: int, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    version = _latest_version(automation)
    if not version:
        return {"id": automation.id, "name": automation.name, "status": "NO_VERSIONS"}
    assessment = _latest_assessment(version)
    pm = ProcessModel.model_validate(version.process_model)
    narrative = get_llm_provider().summarize_process(pm)
    return {
        "id": automation.id,
        "name": automation.name,
        "is_sample": automation.is_sample,
        "latest_version": {"id": version.id, "version_number": version.version_number, "uploaded_filename": version.uploaded_filename, "created_at": version.created_at},
        "summary": narrative,
        "assessment": serialize_assessment(assessment) if assessment else None,
        "parser_warnings": pm.parser_warnings,
        "dependencies": [d.model_dump() for d in pm.dependencies],
        "systems": [s.model_dump() for s in pm.systems],
        "queues": [q.model_dump() for q in pm.queues],
        "assets": [a.model_dump() for a in pm.assets],
        "business_context": serialize_business_context(automation.business_context),
    }


@router.get("/{automation_id}/flow")
def get_flow(automation_id: int, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    version = _latest_version(automation)
    if not version:
        raise HTTPException(404, "No process version uploaded yet")
    pm = ProcessModel.model_validate(version.process_model)
    return build_flow_graph(pm)


@router.get("/{automation_id}/execution-surface-profile")
def get_execution_surface_profile(automation_id: int, db: Session = Depends(get_db)):
    """Richer per-surface breakdown (API/reusable-subprocess/queue coverage
    plus UI dependency) instead of the single execution_tool_readiness
    ratio — see docs/DUCK_HANDOFF.md Estate Phase 5."""
    automation = _get_automation(db, automation_id)
    version = _latest_version(automation)
    if not version:
        raise HTTPException(404, "No process version uploaded yet")
    pm = ProcessModel.model_validate(version.process_model)
    profile = build_execution_surface_profile_view(pm)
    return profile.model_dump(mode="json")


@router.get("/{automation_id}/assessments")
def list_assessments(automation_id: int, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    assessments = [a for v in automation.versions for a in v.assessments]
    assessments.sort(key=lambda a: a.created_at)
    return [serialize_assessment(a, include_dimensions=False) for a in assessments]


@router.get("/{automation_id}/assessments/latest")
def get_latest_assessment(automation_id: int, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    version = _latest_version(automation)
    if not version:
        raise HTTPException(404, "No process version uploaded yet")
    assessment = _latest_assessment(version)
    if not assessment:
        raise HTTPException(404, "No assessment found")
    return serialize_assessment(assessment)


@router.get("/{automation_id}/assessments/{assessment_id}")
def get_assessment(automation_id: int, assessment_id: int, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    assessment = db.query(orm.Assessment).filter_by(id=assessment_id).first()
    if not assessment or assessment.process_version.automation_id != automation.id:
        raise HTTPException(404, "Assessment not found")
    return serialize_assessment(assessment)


@router.get("/{automation_id}/constraints")
def get_constraints(automation_id: int, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    return [serialize_constraint(c) for c in sorted(automation.constraints, key=lambda c: c.created_at)]


@router.get("/{automation_id}/history")
def get_history(automation_id: int, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    return [serialize_event(e) for e in automation.events]


@router.get("/{automation_id}/reassessment-diff")
def get_reassessment_diff(automation_id: int, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    assessments = sorted([a for v in automation.versions for a in v.assessments], key=lambda a: a.created_at)
    if len(assessments) < 2:
        raise HTTPException(400, "Need at least two assessments to compute a diff")
    previous = snapshot_from_assessment(db, assessments[-2])
    current = snapshot_from_assessment(db, assessments[-1])
    if not previous or not current:
        raise HTTPException(400, "Could not build snapshots for diffing")
    diff = compare_assessments(previous, current)
    return diff.model_dump()


@router.post("/{automation_id}/migration-pack")
def generate_migration_pack(automation_id: int, db: Session = Depends(get_db)):
    automation = _get_automation(db, automation_id)
    version = _latest_version(automation)
    if not version:
        raise HTTPException(404, "No process version uploaded yet")
    assessment = _latest_assessment(version)
    if not assessment or not assessment.recommendation:
        raise HTTPException(404, "No assessment found")

    pm = ProcessModel.model_validate(version.process_model)
    scores = assessment_dimension_scores(assessment)
    snapshot = snapshot_from_assessment(db, assessment)
    rec = snapshot.recommendation
    active_constraints = snapshot.active_constraints
    biz = load_business_context(db, automation.id)

    files = generate_pack(pm, scores, rec, active_constraints, biz)

    db.add(orm.MigrationRun(assessment_id=assessment.id, files=files))
    db.commit()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{automation.name}_migration_pack.zip"'},
    )
