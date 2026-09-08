"""The upload → parse → score → recommend → persist pipeline.

Shared by the initial-upload, re-upload, and business-context-change
reassessment paths so all three go through identical scoring/recommendation
logic (Rule 6: never overwrite, always create a new Assessment).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from apps.api.app.models import orm
from memory.constraints import reconcile_constraints
from memory.diff import compare_assessments
from memory.timeline import initial_assessment_event, reassessment_event
from packages.shared.business_context import BusinessContext
from packages.shared.canonical import ProcessModel
from packages.shared.enums import ConstraintStatus, EvolutionState, Level, MigrationPattern, WhyNotReasonType
from packages.shared.memory_types import AssessmentSnapshot, ConstraintRecord
from packages.shared.recommendation_types import RecommendationResult, WhyNotReason
from packages.shared.scoring_types import DimensionScore, EvidenceItem
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


def load_business_context(db: Session, automation_id: int) -> BusinessContext:
    row = db.query(orm.BusinessContextRow).filter_by(automation_id=automation_id).first()
    if row is None:
        return BusinessContext()
    return BusinessContext.model_validate(row.data)


def save_business_context(db: Session, automation_id: int, biz: BusinessContext) -> orm.BusinessContextRow:
    row = db.query(orm.BusinessContextRow).filter_by(automation_id=automation_id).first()
    if row is None:
        row = orm.BusinessContextRow(automation_id=automation_id, data=biz.model_dump(mode="json"))
        db.add(row)
    else:
        row.data = biz.model_dump(mode="json")
    db.flush()
    return row


def _dimension_from_row(d: orm.AssessmentDimension) -> DimensionScore:
    return DimensionScore(
        dimension=d.dimension, label=d.label, score=d.score, level=d.level,
        confidence=d.confidence, evidence=[EvidenceItem.model_validate(e) for e in d.evidence],
        explanation=d.explanation,
    )


def _constraint_record_from_row(c: orm.Constraint) -> ConstraintRecord:
    return ConstraintRecord(
        id=c.id, category=c.category, description=c.description,
        evidence=[EvidenceItem.model_validate(e) for e in c.evidence],
        severity=c.severity, status=c.status, source=c.source,
        autonomy_cap=EvolutionState(c.autonomy_cap) if c.autonomy_cap else None,
        resolution_condition=c.resolution_condition, owner=c.owner,
        created_at=c.created_at, first_seen=c.created_at, last_seen=c.last_seen_at,
        resolved_at=c.resolved_at, resolution_notes=c.resolution_notes,
    )


def assessment_dimension_scores(assessment: orm.Assessment) -> dict[str, DimensionScore]:
    return {d.dimension: _dimension_from_row(d) for d in assessment.dimensions}


def snapshot_from_assessment(db: Session, assessment: orm.Assessment) -> AssessmentSnapshot | None:
    if assessment.recommendation is None:
        return None

    dims = assessment_dimension_scores(assessment)
    r = assessment.recommendation
    rec = RecommendationResult(
        current_state=EvolutionState(r.current_state), recommended_state=EvolutionState(r.recommended_state),
        maximum_safe_state=EvolutionState(r.maximum_safe_state), next_possible_state=EvolutionState(r.next_possible_state),
        recommended_pattern=MigrationPattern(r.recommended_pattern),
        confidence=Level(r.confidence),
        why_this=r.why_this,
        why_not_further=[WhyNotReason(reason_type=WhyNotReasonType(w["reason_type"]), text=w["text"]) for w in r.why_not_further],
        top_reasons=r.top_reasons, top_blockers=r.top_blockers, missing_evidence=r.missing_evidence, constraints=[],
    )
    business_context = BusinessContext.model_validate(r.business_context_snapshot) if r.business_context_snapshot else None

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
    active_constraints = [_constraint_record_from_row(c) for c in constraint_rows]
    return AssessmentSnapshot(
        assessment_id=assessment.id, dimensions=dims, recommendation=rec,
        business_context=business_context, active_constraints=active_constraints,
    )


def _latest_version(db: Session, automation_id: int) -> orm.ProcessVersion | None:
    return (
        db.query(orm.ProcessVersion)
        .filter_by(automation_id=automation_id)
        .order_by(orm.ProcessVersion.version_number.desc())
        .first()
    )


def _latest_assessment_snapshot(db: Session, automation_id: int) -> AssessmentSnapshot | None:
    latest_version = _latest_version(db, automation_id)
    if latest_version is None or not latest_version.assessments:
        return None
    assessment = max(latest_version.assessments, key=lambda a: a.created_at)
    return snapshot_from_assessment(db, assessment)


def _score_and_persist_assessment(
    db: Session,
    automation: orm.Automation,
    process_model: ProcessModel,
    version: orm.ProcessVersion,
    biz: BusinessContext,
    event_type_if_first: str = "INITIAL_ASSESSMENT",
) -> orm.Assessment:
    """Core logic shared by upload-triggered and business-context-triggered
    reassessment: score, recommend, persist, reconcile constraints, and
    record an evolution-timeline event. Never overwrites a prior Assessment
    (Rule 6)."""
    previous_snapshot = _latest_assessment_snapshot(db, automation.id)

    scores: dict[str, DimensionScore] = score_process(process_model, biz)
    rec_result = recommend(process_model, scores, biz)

    assessment = orm.Assessment(process_version_id=version.id, summary_score=summary_score(scores))
    db.add(assessment)
    db.flush()

    for dim, score in scores.items():
        db.add(orm.AssessmentDimension(
            assessment_id=assessment.id, dimension=dim, label=score.label, score=score.score,
            level=score.level.value, confidence=score.confidence.value,
            evidence=[e.model_dump(mode="json") for e in score.evidence],
            explanation=score.explanation,
        ))

    db.add(orm.Recommendation(
        assessment_id=assessment.id,
        current_state=rec_result.current_state.value,
        recommended_state=rec_result.recommended_state.value,
        maximum_safe_state=rec_result.maximum_safe_state.value,
        next_possible_state=rec_result.next_possible_state.value,
        recommended_pattern=rec_result.recommended_pattern.value,
        confidence=rec_result.confidence.value,
        why_this=rec_result.why_this,
        why_not_further=[{"reason_type": w.reason_type.value, "text": w.text} for w in rec_result.why_not_further],
        top_reasons=rec_result.top_reasons,
        top_blockers=rec_result.top_blockers,
        missing_evidence=rec_result.missing_evidence,
        business_context_snapshot=biz.model_dump(mode="json"),
    ))

    previous_active = previous_snapshot.active_constraints if previous_snapshot else []
    now = datetime.now(timezone.utc)
    to_create, to_transition = reconcile_constraints(previous_active, rec_result.constraints)

    for draft in to_create:
        db.add(orm.Constraint(
            automation_id=automation.id, created_by_assessment_id=assessment.id,
            category=draft.category.value, description=draft.description,
            evidence=[e.model_dump(mode="json") for e in draft.evidence],
            severity=draft.severity.value, status=ConstraintStatus.ACTIVE.value,
            autonomy_cap=draft.autonomy_cap.value if draft.autonomy_cap else None,
            resolution_condition=draft.resolution_condition,
            last_seen_at=now,
        ))
    for transitioned in to_transition:
        row = db.query(orm.Constraint).filter_by(id=transitioned.id).first()
        if row:
            row.status = transitioned.status.value
            row.resolved_at = transitioned.resolved_at
            row.resolved_by_assessment_id = assessment.id
            row.resolution_notes = transitioned.resolution_notes

    # Constraints whose category is still active in both snapshots: refresh
    # last_seen/evidence/description/severity so a still-blocking constraint
    # never shows stale text (e.g. an INSUFFICIENT_BUSINESS_CONTEXT
    # description naming fields that were since supplied, if other fields
    # are still missing) — without disturbing created_at/history (Section 15).
    previous_by_category = {c.category for c in previous_active}
    still_active_categories = {d.category for d in rec_result.constraints} & previous_by_category
    if still_active_categories:
        for row in automation.constraints:
            if row.status == ConstraintStatus.ACTIVE.value and row.category in {c.value for c in still_active_categories}:
                draft = next(d for d in rec_result.constraints if d.category.value == row.category)
                row.description = draft.description
                row.evidence = [e.model_dump(mode="json") for e in draft.evidence]
                row.severity = draft.severity.value
                row.autonomy_cap = draft.autonomy_cap.value if draft.autonomy_cap else None
                row.resolution_condition = draft.resolution_condition
                row.last_seen_at = now

    if previous_snapshot is None:
        event_desc = initial_assessment_event(rec_result)
        event_type = event_type_if_first
    else:
        current_snapshot = AssessmentSnapshot(
            assessment_id=assessment.id, dimensions=scores, recommendation=rec_result, business_context=biz,
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


def process_upload_and_assess(
    db: Session,
    automation: orm.Automation,
    original_filename: str,
    data: bytes,
) -> orm.Assessment:
    """Parses a newly uploaded package, creates a new ProcessVersion, and
    runs the scoring/recommendation pipeline against it plus the
    automation's current Business Context."""
    process_model = run_ingestion(original_filename, data)

    next_version_number = db.query(orm.ProcessVersion).filter_by(automation_id=automation.id).count() + 1
    version = orm.ProcessVersion(
        automation_id=automation.id,
        version_number=next_version_number,
        uploaded_filename=original_filename,
        source_kind=process_model.source_kind,
        process_model=process_model.model_dump(mode="json"),
    )
    db.add(version)
    db.flush()

    biz = load_business_context(db, automation.id)
    return _score_and_persist_assessment(db, automation, process_model, version, biz)


def reassess_with_current_context(db: Session, automation: orm.Automation) -> orm.Assessment:
    """Re-runs scoring/recommendation against the *same* latest uploaded
    ProcessVersion using the current Business Context — used when Business
    Context changes without a new file upload (Section 5: "When business
    context changes: trigger reassessment")."""
    version = _latest_version(db, automation.id)
    if version is None:
        raise ValueError("Automation has no uploaded process version to reassess")
    process_model = ProcessModel.model_validate(version.process_model)
    biz = load_business_context(db, automation.id)
    return _score_and_persist_assessment(db, automation, process_model, version, biz)
