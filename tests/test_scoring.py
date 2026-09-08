from pathlib import Path

from packages.shared.business_context import BusinessContext
from packages.shared.enums import Level, TriState
from parser.uipath.parse import parse_project
from scoring.engine import score_process, summary_score

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"


def test_invoice_processing_is_tool_readiness_low_and_ui_dependent():
    pm = parse_project(FIXTURES / "invoice_processing", "zip")
    scores = score_process(pm)
    assert scores["execution_tool_readiness"].level == Level.LOW
    assert scores["execution_tool_readiness"].score == 0
    assert scores["execution_tool_readiness"].evidence  # every score must carry evidence


def test_customer_exclusion_compliance_is_only_medium_from_keywords_alone():
    """Section 7: keyword matching is a WEAK inference signal and must never
    claim HIGH compliance sensitivity on its own — only a confirmed
    Business Context can do that (see test below)."""
    pm = parse_project(FIXTURES / "customer_exclusion", "zip")
    scores = score_process(pm)
    compliance = scores["compliance_sensitivity"]
    assert compliance.level == Level.MEDIUM
    assert compliance.confidence != Level.HIGH
    assert all(e.type.value == "INFERRED" for e in compliance.evidence)


def test_customer_exclusion_compliance_is_high_when_business_context_confirms():
    pm = parse_project(FIXTURES / "customer_exclusion", "zip")
    biz = BusinessContext(regulated_process=TriState.YES, mandatory_approval=TriState.YES)
    scores = score_process(pm, biz)
    compliance = scores["compliance_sensitivity"]
    assert compliance.level == Level.HIGH
    assert compliance.confidence == Level.HIGH
    assert any(e.type.value == "BUSINESS" for e in compliance.evidence)


def test_customer_exclusion_reversibility_and_tool_readiness():
    pm = parse_project(FIXTURES / "customer_exclusion", "zip")
    scores = score_process(pm)
    assert scores["reversibility"].level == Level.LOW
    assert scores["reversibility"].confidence != Level.HIGH  # never confident without Business Context
    assert scores["execution_tool_readiness"].level == Level.HIGH


def test_reversibility_confidence_high_only_when_business_context_confirms():
    pm = parse_project(FIXTURES / "customer_exclusion", "zip")
    biz = BusinessContext(irreversible_action=TriState.YES)
    scores = score_process(pm, biz)
    reversibility = scores["reversibility"]
    assert reversibility.level == Level.LOW
    assert reversibility.confidence == Level.HIGH
    assert any(e.type.value == "BUSINESS" for e in reversibility.evidence)


def test_internal_report_reasoning_opportunity_and_reversibility():
    pm = parse_project(FIXTURES / "internal_report", "zip")
    scores = score_process(pm)
    assert scores["reasoning_opportunity"].level == Level.HIGH
    assert scores["blast_radius"].level == Level.LOW
    assert scores["reversibility"].level == Level.HIGH


def test_reasoning_opportunity_and_current_ai_usage_use_disjoint_evidence():
    """Core repair (Section 3): current_ai_usage's evidence (what AI activities
    exist) must never double as reasoning_opportunity's evidence (whether the
    process needs judgment) — they must be able to disagree in either direction."""
    pm = parse_project(FIXTURES / "invoice_processing", "zip")
    scores = score_process(pm)
    opportunity_descriptions = {e.description for e in scores["reasoning_opportunity"].evidence}
    current_ai_descriptions = {e.description for e in scores["current_ai_usage"].evidence}
    assert not (opportunity_descriptions & current_ai_descriptions)


def test_runtime_stability_is_insufficient_evidence_when_not_supplied():
    pm = parse_project(FIXTURES / "internal_report", "zip")
    scores = score_process(pm)
    rs = scores["runtime_stability"]
    assert rs.confidence == Level.LOW
    assert "INSUFFICIENT EVIDENCE" in rs.explanation
    assert rs.evidence == []


def test_every_dimension_has_score_confidence_evidence_or_explains_absence():
    pm = parse_project(FIXTURES / "customer_exclusion", "zip")
    scores = score_process(pm)
    for dim, s in scores.items():
        assert 0 <= s.score <= 100
        assert s.explanation
        if not s.evidence:
            assert "INSUFFICIENT EVIDENCE" in s.explanation


def test_summary_score_is_bounded_and_excludes_descriptive_only_dimension():
    pm = parse_project(FIXTURES / "invoice_processing", "zip")
    scores = score_process(pm)
    total = summary_score(scores)
    assert 0 <= total <= 100
