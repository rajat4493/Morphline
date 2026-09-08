from pathlib import Path

from packages.shared.business_context import BusinessContext
from packages.shared.enums import ConstraintCategory, EvolutionState, MigrationPattern, TriState, WhyNotReasonType
from parser.uipath.parse import parse_project
from recommendation.engine import recommend
from scoring.engine import score_process

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"


def _recommend(name: str, biz: BusinessContext | None = None):
    pm = parse_project(FIXTURES / name, "zip")
    return pm, recommend(pm, score_process(pm, biz), biz)


def test_invoice_processing_recommends_augmented_rpa():
    pm, rec = _recommend("invoice_processing")
    assert rec.recommended_state == EvolutionState.AUGMENTED_RPA
    assert rec.maximum_safe_state == EvolutionState.AUGMENTED_RPA
    assert rec.recommended_pattern == MigrationPattern.RPA_WITH_AI_AUGMENTATION
    assert any(c.category == ConstraintCategory.UNSTABLE_UI_DEPENDENCY for c in rec.constraints)
    assert rec.why_this
    assert rec.why_not_further


def test_customer_exclusion_recommends_hybrid_agent_not_higher():
    pm, rec = _recommend("customer_exclusion")
    assert rec.recommended_state == EvolutionState.HYBRID_AGENT
    # RULE 2: never recommend autonomy merely because an LLM/agent *could* do
    # the task — reasoning opportunity alone must not push this past Hybrid Agent.
    assert rec.recommended_state.rank < EvolutionState.ADVANCED_HYBRID.rank
    assert rec.recommended_pattern == MigrationPattern.HYBRID_WITH_HUMAN_APPROVAL
    categories = {c.category for c in rec.constraints}
    assert ConstraintCategory.COMPLIANCE_RESTRICTION in categories or ConstraintCategory.POOR_REVERSIBILITY in categories
    # Without a confirmed Business Context, these must read as UNKNOWN, not BLOCKED.
    assert all(r.reason_type == WhyNotReasonType.UNKNOWN for r in rec.why_not_further)


def test_customer_exclusion_why_not_becomes_blocked_when_business_context_confirms():
    biz = BusinessContext(regulated_process=TriState.YES, mandatory_approval=TriState.YES, irreversible_action=TriState.YES)
    pm, rec = _recommend("customer_exclusion", biz)
    assert rec.recommended_state == EvolutionState.HYBRID_AGENT
    assert any(r.reason_type == WhyNotReasonType.BLOCKED for r in rec.why_not_further)


def test_internal_report_is_strong_agentic_candidate():
    """Ceiling allows deep autonomy (good tooling, low blast radius, strong
    observability) even though the recommended state itself sits at Hybrid
    Agent — Evolution Value is a composite, not reasoning_opportunity alone,
    so "strong candidate" shows up as a high ceiling with room to grow, not
    an automatic jump to the top of the ladder (Section 12)."""
    pm, rec = _recommend("internal_report")
    assert rec.maximum_safe_state.rank >= EvolutionState.ADVANCED_HYBRID.rank
    assert rec.recommended_state.rank >= EvolutionState.HYBRID_AGENT.rank
    assert not any(r.reason_type == WhyNotReasonType.BLOCKED for r in rec.why_not_further)


def test_never_recommends_beyond_maximum_safe_state():
    for name in ("invoice_processing", "customer_exclusion", "internal_report"):
        _, rec = _recommend(name)
        assert rec.recommended_state.rank <= rec.maximum_safe_state.rank


def test_why_not_further_is_never_empty():
    """Section 14: even "nothing is wrong" must be stated explicitly, never
    left as an empty list that could be misread as an oversight."""
    for name in ("invoice_processing", "customer_exclusion", "internal_report"):
        _, rec = _recommend(name)
        assert rec.why_not_further
