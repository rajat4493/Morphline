from pathlib import Path

from packages.shared.enums import Level
from parser.uipath.parse import parse_project
from scoring.engine import score_process, summary_score

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"


def test_invoice_processing_is_tool_readiness_low_and_ui_dependent():
    pm = parse_project(FIXTURES / "invoice_processing", "zip")
    scores = score_process(pm)
    assert scores["tool_readiness"].level == Level.LOW
    assert scores["tool_readiness"].score == 0
    assert scores["tool_readiness"].evidence  # every score must carry evidence


def test_customer_exclusion_is_high_compliance_and_poor_reversibility():
    pm = parse_project(FIXTURES / "customer_exclusion", "zip")
    scores = score_process(pm)
    assert scores["compliance_sensitivity"].level == Level.HIGH
    assert scores["reversibility"].level == Level.LOW
    assert scores["tool_readiness"].level == Level.HIGH


def test_internal_report_is_high_reasoning_low_blast_high_reversibility():
    pm = parse_project(FIXTURES / "internal_report", "zip")
    scores = score_process(pm)
    assert scores["reasoning_need"].level == Level.HIGH
    assert scores["blast_radius"].level == Level.LOW
    assert scores["reversibility"].level == Level.HIGH


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


def test_summary_score_is_bounded():
    pm = parse_project(FIXTURES / "invoice_processing", "zip")
    scores = score_process(pm)
    total = summary_score(scores)
    assert 0 <= total <= 100
