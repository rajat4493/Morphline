from packages.shared.enums import ConstraintCategory, ConstraintSeverity, ConstraintStatus, EvolutionState, Level
from packages.shared.memory_types import AssessmentSnapshot, ConstraintRecord
from packages.shared.recommendation_types import ConstraintDraft, RecommendationResult
from packages.shared.scoring_types import DimensionScore
from memory.constraints import reconcile_constraints
from memory.diff import compare_assessments


def _dim(name, score, level=Level.MEDIUM, confidence=Level.HIGH, label=None):
    return DimensionScore(dimension=name, label=label or name, score=score, level=level, confidence=confidence, evidence=["e"], explanation="x")


def _rec(state: EvolutionState) -> RecommendationResult:
    return RecommendationResult(
        current_state=EvolutionState.DETERMINISTIC_RPA, recommended_state=state,
        maximum_safe_state=state, next_possible_state=state, confidence=Level.MEDIUM,
    )


def test_reconcile_creates_new_and_resolves_missing():
    previous = [ConstraintRecord(id=1, category=ConstraintCategory.UNSTABLE_UI_DEPENDENCY, description="d", severity=ConstraintSeverity.HIGH, status=ConstraintStatus.ACTIVE)]
    new_drafts = [ConstraintDraft(category=ConstraintCategory.POOR_REVERSIBILITY, description="d2", severity=ConstraintSeverity.HIGH)]

    to_create, to_resolve = reconcile_constraints(previous, new_drafts)

    assert len(to_create) == 1 and to_create[0].category == ConstraintCategory.POOR_REVERSIBILITY
    assert len(to_resolve) == 1 and to_resolve[0].id == 1
    assert to_resolve[0].status == ConstraintStatus.RESOLVED


def test_reconcile_leaves_still_active_constraints_untouched():
    previous = [ConstraintRecord(id=1, category=ConstraintCategory.HIGH_BLAST_RADIUS, description="d", severity=ConstraintSeverity.HIGH, status=ConstraintStatus.ACTIVE)]
    new_drafts = [ConstraintDraft(category=ConstraintCategory.HIGH_BLAST_RADIUS, description="d", severity=ConstraintSeverity.HIGH)]

    to_create, to_resolve = reconcile_constraints(previous, new_drafts)
    assert to_create == []
    assert to_resolve == []


def test_compare_assessments_detects_higher_level_possible():
    previous = AssessmentSnapshot(
        dimensions={"tool_readiness": _dim("tool_readiness", 20, Level.LOW, label="Tool / API Readiness")},
        recommendation=_rec(EvolutionState.AUGMENTED_RPA),
        active_constraints=[ConstraintRecord(category=ConstraintCategory.UNSTABLE_UI_DEPENDENCY, description="d", severity=ConstraintSeverity.HIGH)],
    )
    current = AssessmentSnapshot(
        dimensions={"tool_readiness": _dim("tool_readiness", 90, Level.HIGH, label="Tool / API Readiness")},
        recommendation=_rec(EvolutionState.HYBRID_AGENT),
        active_constraints=[],
    )
    diff = compare_assessments(previous, current)
    assert diff.higher_level_possible is True
    assert diff.what_resolved
    assert diff.new_risks == []
    assert any("Tool" in c for c in diff.what_changed)


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
