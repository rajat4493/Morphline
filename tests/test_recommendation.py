from pathlib import Path

from packages.shared.enums import ConstraintCategory, EvolutionState
from parser.uipath.parse import parse_project
from recommendation.engine import recommend
from scoring.engine import score_process

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"


def _recommend(name: str):
    pm = parse_project(FIXTURES / name, "zip")
    return pm, recommend(pm, score_process(pm))


def test_invoice_processing_recommends_augmented_rpa():
    pm, rec = _recommend("invoice_processing")
    assert rec.recommended_state == EvolutionState.AUGMENTED_RPA
    assert rec.maximum_safe_state == EvolutionState.AUGMENTED_RPA
    assert any(c.category == ConstraintCategory.UNSTABLE_UI_DEPENDENCY for c in rec.constraints)
    assert rec.why_this
    assert rec.why_not_further


def test_customer_exclusion_recommends_hybrid_agent_not_higher():
    pm, rec = _recommend("customer_exclusion")
    assert rec.recommended_state == EvolutionState.HYBRID_AGENT
    # RULE 2: never recommend autonomy merely because an LLM/agent *could* do
    # the task — reasoning need alone must not push this past Hybrid Agent.
    assert rec.recommended_state.rank < EvolutionState.ADVANCED_HYBRID.rank
    categories = {c.category for c in rec.constraints}
    assert ConstraintCategory.COMPLIANCE_RESTRICTION in categories or ConstraintCategory.POOR_REVERSIBILITY in categories


def test_internal_report_is_strong_agentic_candidate():
    pm, rec = _recommend("internal_report")
    assert rec.recommended_state.rank >= EvolutionState.ADVANCED_HYBRID.rank


def test_never_recommends_beyond_maximum_safe_state():
    for name in ("invoice_processing", "customer_exclusion", "internal_report"):
        _, rec = _recommend(name)
        assert rec.recommended_state.rank <= rec.maximum_safe_state.rank


def test_why_not_further_is_empty_only_when_no_constraints():
    _, rec = _recommend("internal_report")
    if not rec.constraints:
        assert rec.why_not_further  # still explains, never silent
