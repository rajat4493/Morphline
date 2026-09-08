"""The upload → parse → score → recommend → persist pipeline.

Shared by the initial-upload and reassessment code paths so both go
through identical logic (Rule 6: never overwrite, always create a new
Assessment).
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from apps.api.app.models import orm
from memory.constraints import reconcile_constraints
from memory.diff import compare_assessments
from memory.timeline import initial_assessment_event, reassessment_event
from packages.shared.canonical import ProcessModel
from packages.shared.enums import ConstraintStatus
from packages.shared.memory_types import AssessmentSnapshot, ConstraintRecord
from packages.shared.scoring_types import DimensionScore
from parser.uipath.extract import extraction_dir, prepare_upload
from parser.uipath.parse import parse_project
from recommendation.engine import recommend
from scoring.engine import score_process, summary_score


def run_ingestion(original_filename: str, data: bytes) -> ProcessModel:
    """Extracts + parses an upload into a canonical ProcessModel.

    Runs entirely inside an isolated temp dir that is deleted afterward —
    nothing from the upload persists on disk once this returns (SECURITY.md).
    """
    with extraction_dir() as tmp:
        source_kind, content_path = prepare_upload(original_filename, data, tmp)
        return parse_project(content_path, source_kind)


def snapshot_from_assessment(db: Session, assessment: orm.Assessment) -> AssessmentSnapshot | None:
    if assessment.recommendation is None:
        return None
    from packages.shared.enums import EvolutionState, Level
    from packages.shared.recommendation_types import RecommendationResult

    dims = {
        d.dimension: DimensionScore(
            dimension=d.dimension, label=d.label, score=d.score, level=d.level,
            confidence=d.confidence, evidence=d.evidence, explanation=d.explanation,
        )
        for d in assessment.dimensions
    }
    r = assessment.recommendation
    rec = RecommendationResult(
        current_state=EvolutionState(r.current_state), recommended_state=EvolutionState(r.recommended_state),
        maximum_safe_state=EvolutionState(r.maximum_safe_state), next_possible_state=EvolutionState(r.next_possible_state),
        confidence=Level(r.confidence), why_this=r.why_this, why_not_further=r.why_not_further,
        top_reasons=r.top_reasons, top_blockers=r.top_blockers, constraints=[],
    )
    # Constraints active *as of this assessment*: created at or before it, and
    # not yet resolved at the time it ran. Compared by assessment id (a
    # reliable monotonic ordering) rather than by wall-clock timestamp — rows
    # created within the same transaction as this assessment can otherwise
    # get a `created_at` a few milliseconds *after* the assessment's own
    # timestamp depending on flush order, which breaks a timestamp-based
    # comparison for the assessment that created them.
    constraint_rows = [
        c for c in assessment.process_version.automation.constraints
        if c.created_by_assessment_id <= assessment.id
        and (c.resolved_by_assessment_id is None or c.resolved_by_assessment_id > assessment.id)
    ]
    active_constraints = [
        ConstraintRecord(
            id=c.id, category=c.category, description=c.description, evidence=c.evidence,
            severity=c.severity, status=c.status, created_at=c.created_at,
        )
        for c in constraint_rows
    ]
    return AssessmentSnapshot(assessment_id=assessment.id, dimensions=dims, recommendation=rec, active_constraints=active_constraints)


def _latest_assessment_snapshot(db: Session, automation_id: int) -> AssessmentSnapshot | None:
    latest_version = (
        db.query(orm.ProcessVersion)
        .filter_by(automation_id=automation_id)
        .order_by(orm.ProcessVersion.version_number.desc())
        .first()
    )
    if latest_version is None or not latest_version.assessments:
        return None
    assessment = max(latest_version.assessments, key=lambda a: a.created_at)
    return snapshot_from_assessment(db, assessment)


def process_upload_and_assess(
    db: Session,
    automation: orm.Automation,
    original_filename: str,
    data: bytes,
) -> orm.Assessment:
    """Parses the upload, scores it, recommends, persists everything, and
    returns the new Assessment row. Handles both first upload and
    reassessment of an existing Automation identically (Rule 6)."""

    previous_snapshot = _latest_assessment_snapshot(db, automation.id)

    process_model = run_ingestion(original_filename, data)
    scores: dict[str, DimensionScore] = score_process(process_model)
    rec_result = recommend(process_model, scores)

    next_version_number = (
        db.query(orm.ProcessVersion).filter_by(automation_id=automation.id).count() + 1
    )
    version = orm.ProcessVersion(
        automation_id=automation.id,
        version_number=next_version_number,
        uploaded_filename=original_filename,
        source_kind=process_model.source_kind,
        process_model=process_model.model_dump(mode="json"),
    )
    db.add(version)
    db.flush()

    assessment = orm.Assessment(process_version_id=version.id, summary_score=summary_score(scores))
    db.add(assessment)
    db.flush()

    for dim, score in scores.items():
        db.add(orm.AssessmentDimension(
            assessment_id=assessment.id, dimension=dim, label=score.label, score=score.score,
            level=score.level.value, confidence=score.confidence.value, evidence=score.evidence,
            explanation=score.explanation,
        ))

    db.add(orm.Recommendation(
        assessment_id=assessment.id,
        current_state=rec_result.current_state.value,
        recommended_state=rec_result.recommended_state.value,
        maximum_safe_state=rec_result.maximum_safe_state.value,
        next_possible_state=rec_result.next_possible_state.value,
        confidence=rec_result.confidence.value,
        why_this=rec_result.why_this,
        why_not_further=rec_result.why_not_further,
        top_reasons=rec_result.top_reasons,
        top_blockers=rec_result.top_blockers,
    ))

    previous_active = previous_snapshot.active_constraints if previous_snapshot else []
    to_create, to_resolve = reconcile_constraints(previous_active, rec_result.constraints)
    for draft in to_create:
        db.add(orm.Constraint(
            automation_id=automation.id, created_by_assessment_id=assessment.id,
            category=draft.category.value, description=draft.description, evidence=draft.evidence,
            severity=draft.severity.value, status=ConstraintStatus.ACTIVE.value,
        ))
    for resolved in to_resolve:
        row = db.query(orm.Constraint).filter_by(id=resolved.id).first()
        if row:
            row.status = ConstraintStatus.RESOLVED.value
            row.resolved_at = resolved.resolved_at
            row.resolved_by_assessment_id = assessment.id
            row.resolution_notes = resolved.resolution_notes

    if previous_snapshot is None:
        event_desc = initial_assessment_event(rec_result)
        event_type = "INITIAL_ASSESSMENT"
    else:
        current_snapshot = AssessmentSnapshot(
            assessment_id=assessment.id, dimensions=scores, recommendation=rec_result,
            active_constraints=[
                ConstraintRecord(category=c.category, description=c.description, evidence=c.evidence, severity=c.severity)
                for c in rec_result.constraints
            ],
        )
        diff = compare_assessments(previous_snapshot, current_snapshot)
        event_desc = reassessment_event(rec_result, diff)
        event_type = "REASSESSMENT"

    db.add(orm.EvolutionEvent(
        automation_id=automation.id, process_version_id=version.id, assessment_id=assessment.id,
        event_type=event_type, description=event_desc,
    ))

    db.commit()
    db.refresh(assessment)
    return assessment
