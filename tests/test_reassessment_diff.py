from packages.shared.enums import ConstraintCategory, ConstraintSeverity, ConstraintStatus, Confidence, EvidenceType, EvolutionState, Level, MigrationPattern
from packages.shared.memory_types import AssessmentSnapshot, ConstraintRecord
from packages.shared.recommendation_types import ConstraintDraft, RecommendationResult
from packages.shared.scoring_types import DimensionScore, EvidenceItem
from memory.constraints import reconcile_constraints
from memory.diff import compare_assessments


def _known_evidence(desc="e"):
    return EvidenceItem(type=EvidenceType.TECHNICAL, source="test", confidence=Confidence.KNOWN, description=desc)


def _inferred_evidence(desc="e"):
    return EvidenceItem(type=EvidenceType.INFERRED, source="test", confidence=Confidence.INFERRED, description=desc)


def _dim(name, score, level=Level.MEDIUM, confidence=Level.HIGH, label=None):
    return DimensionScore(dimension=name, label=label or name, score=score, level=level, confidence=confidence, evidence=[_known_evidence()], explanation="x")


def _rec(state: EvolutionState) -> RecommendationResult:
    return RecommendationResult(
        current_state=EvolutionState.DETERMINISTIC_RPA, recommended_state=state,
        maximum_safe_state=state, next_possible_state=state,
        recommended_pattern=MigrationPattern.KEEP_DETERMINISTIC_RPA, confidence=Level.MEDIUM,
    )


def test_reconcile_resolves_fully_certain_constraints():
    """A constraint whose original evidence was all KNOWN (direct, technical
    or business-confirmed) resolves to RESOLVED when its category stops
    firing — the system is entitled to claim certainty here."""
    previous = [ConstraintRecord(
        id=1, category=ConstraintCategory.UNSTABLE_UI_DEPENDENCY, description="d",
        evidence=[_known_evidence()], severity=ConstraintSeverity.HIGH, status=ConstraintStatus.ACTIVE,
    )]
    new_drafts = [ConstraintDraft(category=ConstraintCategory.POOR_REVERSIBILITY, description="d2", severity=ConstraintSeverity.HIGH)]

    to_create, to_transition = reconcile_constraints(previous, new_drafts)

    assert len(to_create) == 1 and to_create[0].category == ConstraintCategory.POOR_REVERSIBILITY
    assert len(to_transition) == 1 and to_transition[0].id == 1
    assert to_transition[0].status == ConstraintStatus.RESOLVED


def test_reconcile_marks_possibly_resolved_when_evidence_was_inferred():
    """D-012: a constraint built on INFERRED (or missing) evidence must not
    silently become RESOLVED just because the category stopped firing —
    that would claim certainty the system never had."""
    previous = [ConstraintRecord(
        id=1, category=ConstraintCategory.COMPLIANCE_RESTRICTION, description="d",
        evidence=[_inferred_evidence()], severity=ConstraintSeverity.MEDIUM, status=ConstraintStatus.ACTIVE,
    )]
    new_drafts: list[ConstraintDraft] = []

    to_create, to_transition = reconcile_constraints(previous, new_drafts)

    assert to_create == []
    assert len(to_transition) == 1
    assert to_transition[0].status == ConstraintStatus.POSSIBLY_RESOLVED


def test_reconcile_leaves_still_active_constraints_untouched():
    previous = [ConstraintRecord(id=1, category=ConstraintCategory.HIGH_BLAST_RADIUS, description="d", severity=ConstraintSeverity.HIGH, status=ConstraintStatus.ACTIVE)]
    new_drafts = [ConstraintDraft(category=ConstraintCategory.HIGH_BLAST_RADIUS, description="d", severity=ConstraintSeverity.HIGH)]

    to_create, to_transition = reconcile_constraints(previous, new_drafts)
    assert to_create == []
    assert to_transition == []


def test_compare_assessments_detects_higher_level_possible():
    previous = AssessmentSnapshot(
        dimensions={"execution_tool_readiness": _dim("execution_tool_readiness", 20, Level.LOW, label="Execution Tool Readiness")},
        recommendation=_rec(EvolutionState.AUGMENTED_RPA),
        active_constraints=[ConstraintRecord(category=ConstraintCategory.UNSTABLE_UI_DEPENDENCY, description="d", severity=ConstraintSeverity.HIGH)],
    )
    current = AssessmentSnapshot(
        dimensions={"execution_tool_readiness": _dim("execution_tool_readiness", 90, Level.HIGH, label="Execution Tool Readiness")},
        recommendation=_rec(EvolutionState.HYBRID_AGENT),
        active_constraints=[],
    )
    diff = compare_assessments(previous, current)
    assert diff.higher_level_possible is True
    assert diff.what_resolved
    assert diff.new_risks == []
    assert any("Execution Tool" in c for c in diff.what_changed)


def test_compare_assessments_detects_new_risk_and_downgrade():
    previous = AssessmentSnapshot(
        dimensions={}, recommendation=_rec(EvolutionState.HYBRID_AGENT), active_constraints=[],
    )
    current = AssessmentSnapshot(
        dimensions={}, recommendation=_rec(EvolutionState.AUGMENTED_RPA),
        active_constraints=[ConstraintRecord(category=ConstraintCategory.HIGH_BLAST_RADIUS, description="new risk", severity=ConstraintSeverity.HIGH)],
    )
    diff = compare_assessments(previous, current)
    assert diff.higher_level_possible is False
    assert diff.new_risks
    assert "downgrade" not in diff.why[0].lower()  # wording check: uses "moved down", not jargon
    assert "moved down" in diff.why[0].lower()


def test_compare_assessments_detects_business_context_and_pattern_change():
    from packages.shared.business_context import BusinessContext
    from packages.shared.enums import TriState

    previous = AssessmentSnapshot(
        dimensions={}, recommendation=_rec(EvolutionState.HYBRID_AGENT).model_copy(update={"recommended_pattern": MigrationPattern.DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION}),
        business_context=BusinessContext(), active_constraints=[],
    )
    current = AssessmentSnapshot(
        dimensions={}, recommendation=_rec(EvolutionState.HYBRID_AGENT).model_copy(update={"recommended_pattern": MigrationPattern.AGENT_WITH_API_TOOLS}),
        business_context=BusinessContext(mandatory_approval=TriState.NO), active_constraints=[],
    )
    diff = compare_assessments(previous, current)
    assert diff.migration_pattern_changed is True
    assert diff.business_context_changes
    assert any("Migration Pattern changed" in w for w in diff.why)
