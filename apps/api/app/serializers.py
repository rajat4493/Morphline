from apps.api.app.models import orm


def serialize_dimension(d: orm.AssessmentDimension) -> dict:
    return {
        "dimension": d.dimension, "label": d.label, "score": d.score, "level": d.level,
        "confidence": d.confidence, "evidence": d.evidence, "explanation": d.explanation,
    }


def serialize_recommendation(r: orm.Recommendation) -> dict:
    return {
        "current_state": r.current_state, "recommended_state": r.recommended_state,
        "maximum_safe_state": r.maximum_safe_state, "next_possible_state": r.next_possible_state,
        "recommended_pattern": r.recommended_pattern,
        "confidence": r.confidence, "why_this": r.why_this, "why_not_further": r.why_not_further,
        "top_reasons": r.top_reasons, "top_blockers": r.top_blockers,
        "missing_evidence": r.missing_evidence,
        "business_context_snapshot": r.business_context_snapshot,
    }


def serialize_constraint(c: orm.Constraint) -> dict:
    return {
        "id": c.id, "category": c.category, "description": c.description, "evidence": c.evidence,
        "severity": c.severity, "status": c.status, "source": c.source,
        "autonomy_cap": c.autonomy_cap, "resolution_condition": c.resolution_condition, "owner": c.owner,
        "created_at": c.created_at, "last_seen_at": c.last_seen_at,
        "resolved_at": c.resolved_at, "resolution_notes": c.resolution_notes,
    }


def serialize_assessment(a: orm.Assessment, include_dimensions: bool = True) -> dict:
    out = {
        "id": a.id, "process_version_id": a.process_version_id, "summary_score": a.summary_score,
        "created_at": a.created_at,
        "recommendation": serialize_recommendation(a.recommendation) if a.recommendation else None,
    }
    if include_dimensions:
        out["dimensions"] = [serialize_dimension(d) for d in a.dimensions]
    return out


def serialize_event(e: orm.EvolutionEvent) -> dict:
    return {
        "id": e.id, "event_type": e.event_type, "description": e.description,
        "occurred_at": e.occurred_at, "process_version_id": e.process_version_id,
        "assessment_id": e.assessment_id,
    }


def serialize_business_context(row: orm.BusinessContextRow | None) -> dict:
    if row is None:
        from packages.shared.business_context import BusinessContext
        return BusinessContext().model_dump(mode="json")
    return row.data
