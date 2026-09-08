"""Section 20: the seven scenarios the business-context/reasoning-opportunity
repair must demonstrably handle. Each test name maps directly to a numbered
case in the task brief."""
from pathlib import Path

from packages.shared.business_context import BusinessContext
from packages.shared.enums import EvolutionState, Level, MigrationPattern, TriState
from parser.uipath.parse import parse_project
from recommendation.engine import recommend
from scoring.engine import score_process

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"


def _assess(name: str, biz: BusinessContext | None = None):
    pm = parse_project(FIXTURES / name, "zip")
    scores = score_process(pm, biz)
    rec = recommend(pm, scores, biz)
    return pm, scores, rec


def test_case1_large_deterministic_decision_tree_scores_high_reasoning_opportunity_without_ai():
    """No AI/LLM activities anywhere in this fixture, yet substantial
    branching, manual review, and free-text (email) input must still drive
    Reasoning Opportunity to HIGH — the core repair."""
    pm, scores, rec = _assess("loan_exception_review")
    assert scores["current_ai_usage"].level == Level.LOW
    assert scores["reasoning_opportunity"].level == Level.HIGH
    assert scores["reasoning_opportunity"].confidence == Level.HIGH


def test_case2_pure_deterministic_reconciliation_scores_low_reasoning_opportunity():
    pm, scores, rec = _assess("nightly_reconciliation")
    assert scores["reasoning_opportunity"].level == Level.LOW
    # Keep deterministic or light augmentation — never pushed to Hybrid+ by
    # good tooling alone (Section 12's worked example).
    assert rec.recommended_state.rank <= EvolutionState.AUGMENTED_RPA.rank


def test_case3_customer_impacting_workflow_stays_hybrid_with_human_approval():
    pm, scores, rec = _assess("customer_exclusion")
    assert rec.recommended_state == EvolutionState.HYBRID_AGENT
    assert rec.recommended_pattern == MigrationPattern.HYBRID_WITH_HUMAN_APPROVAL


def test_case4_ui_heavy_reusable_subprocesses_considered_as_agent_tools():
    """Existing UiPath subprocesses must be a *considered* pattern, not an
    automatic rejection just because they use UI automation internally."""
    pm, scores, rec = _assess("ui_heavy_reusable_tools")
    assert scores["execution_tool_readiness"].level == Level.HIGH
    assert rec.recommended_pattern == MigrationPattern.AGENT_ORCHESTRATED_RPA_TOOLS
    assert not any(c.category.value == "UNSTABLE_UI_DEPENDENCY" for c in rec.constraints)


def test_case5_unknown_business_context_blocks_full_autonomy_on_mutating_process():
    """Absence of evidence is not evidence of safety (Section 13): a clean,
    well-tooled, mutating process with NO Business Context supplied must
    still be capped, via an explicit INSUFFICIENT_BUSINESS_CONTEXT constraint."""
    pm, scores, rec = _assess("unknown_context_mutator")
    assert rec.maximum_safe_state.rank < EvolutionState.ADVANCED_HYBRID.rank
    assert any(c.category.value == "INSUFFICIENT_BUSINESS_CONTEXT" for c in rec.constraints)
    assert rec.missing_evidence


def test_case5_supplying_business_context_lifts_the_cap():
    biz = BusinessContext(
        customer_impact="NONE", financial_impact="LOW", legal_regulatory_impact="NONE",
        maximum_scope="INTERNAL_ONLY", irreversible_action=TriState.NO, mandatory_approval=TriState.NO,
        regulated_process=TriState.NO,
    )
    pm, scores, rec = _assess("unknown_context_mutator", biz)
    assert not any(c.category.value == "INSUFFICIENT_BUSINESS_CONTEXT" for c in rec.constraints)
    assert rec.maximum_safe_state.rank >= EvolutionState.ADVANCED_HYBRID.rank


def test_case6_good_apis_low_blast_strong_observability_high_reasoning_is_strong_candidate():
    pm, scores, rec = _assess("internal_report")
    assert scores["execution_tool_readiness"].level == Level.HIGH
    assert scores["blast_radius"].level == Level.LOW
    assert scores["reasoning_opportunity"].level == Level.HIGH
    assert rec.maximum_safe_state.rank >= EvolutionState.ADVANCED_HYBRID.rank


def test_case7_existing_ai_activity_without_genuine_need_does_not_inflate_opportunity():
    """The exact confusion this repair exists to prevent: an AI activity
    present in the implementation must not, by itself, raise Reasoning
    Opportunity."""
    pm, scores, rec = _assess("ai_overreach")
    assert scores["current_ai_usage"].level == Level.HIGH
    assert scores["reasoning_opportunity"].level in (Level.LOW, Level.MEDIUM)
