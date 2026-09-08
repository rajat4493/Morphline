from pathlib import Path

from packages.shared.enums import Confidence, NodeCategory
from parser.uipath.parse import parse_project

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"


def test_parses_invoice_processing_workflow_relationships():
    pm = parse_project(FIXTURES / "invoice_processing", "zip")
    assert pm.entry_point == "Main.xaml"
    files = {wf.file for wf in pm.workflows}
    assert files == {"Main.xaml", "ExtractInvoiceData.xaml"}

    main = next(wf for wf in pm.workflows if wf.file == "Main.xaml")
    assert "ExtractInvoiceData.xaml" in main.invokes

    invoked_deps = [d for d in pm.dependencies if d.kind == "invoked_workflow"]
    assert invoked_deps and invoked_deps[0].confidence == Confidence.KNOWN


def test_detects_ui_automation_and_sap_system():
    pm = parse_project(FIXTURES / "invoice_processing", "zip")
    steps = pm.all_steps()
    ui_steps = [s for s in steps if s.category == NodeCategory.DETERMINISTIC and s.selector is not None]
    assert len(ui_steps) == 4
    assert any(sysobj.name == "SAP" for sysobj in pm.systems)


def test_detects_reasoning_step_in_extract_workflow():
    pm = parse_project(FIXTURES / "invoice_processing", "zip")
    extract_wf = next(wf for wf in pm.workflows if wf.file == "ExtractInvoiceData.xaml")
    reasoning_steps = [s for s in extract_wf.steps if s.category == NodeCategory.REASONING]
    assert len(reasoning_steps) == 1
    assert reasoning_steps[0].activity_type == "DataExtractionScope"


def test_project_json_dependencies_extracted():
    pm = parse_project(FIXTURES / "invoice_processing", "zip")
    dep_names = {d.name for d in pm.dependencies if d.kind == "package"}
    assert "UiPath.Excel.Activities" in dep_names
    assert "UiPath.UIAutomation.Activities" in dep_names


def test_unrecognized_activity_marked_unknown_not_guessed(tmp_path):
    xaml = tmp_path / "Weird.xaml"
    xaml.write_text(
        '<Activity x:Class="Weird" xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities" '
        'xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">'
        '<Sequence DisplayName="Root"><TotallyMadeUpActivity DisplayName="Mystery" /></Sequence>'
        "</Activity>"
    )
    pm = parse_project(xaml, "xaml")
    steps = pm.all_steps()
    mystery = next(s for s in steps if s.activity_type == "TotallyMadeUpActivity")
    assert mystery.category == NodeCategory.UNKNOWN
    assert mystery.confidence == Confidence.UNKNOWN
    assert any("unclassified activity" in w.lower() for w in pm.parser_warnings)


def test_customer_exclusion_has_human_checkpoints_and_compliance_terms():
    pm = parse_project(FIXTURES / "customer_exclusion", "zip")
    assert len(pm.human_checkpoints) == 2
    step_names = " ".join(s.display_name.lower() for s in pm.all_steps())
    assert "exclusion" in step_names


def test_internal_report_has_no_ui_automation():
    pm = parse_project(FIXTURES / "internal_report", "zip")
    ui_steps = [s for s in pm.all_steps() if s.selector is not None]
    assert ui_steps == []
    api_steps = [s for s in pm.all_steps() if s.category == NodeCategory.API_TOOL]
    assert len(api_steps) == 2
