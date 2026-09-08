"""Regression test against a real, Studio-compiled UiPath export (sanitized:
the DPAPI-protected password blob was redacted before this fixture was
added — see fixtures/uipath/real_world_invoice_processing/).

Real compiled XAML is far denser than the synthetic fixtures: it carries
`x:Members` argument declarations, `TextExpression.NamespacesForImplementation`
/`.ReferencesForImplementation` VB-import boilerplate, `.Body`-wrapped scope
activities (OpenBrowser, BrowserScope), `ActivityAction` lambda wrappers, and
disabled `CommentOut` blocks. An earlier version of the parser walked all of
this as if every element were a candidate workflow step, producing 652
spurious "unclassified activity" warnings for this one project and wildly
inflating step counts (e.g. 126 "steps" for a workflow with ~10 real
activities). This test locks in the fix — see parser/uipath/xaml.py's
DISABLED_TAGS/TRANSPARENT_WRAPPER_TAGS and the generic "skip any
`Foo.Bar` attached-property element with no recognized owner" rule.
"""
from pathlib import Path

from parser.uipath.parse import parse_project

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "uipath" / "real_world_invoice_processing"


def test_real_world_project_parses_without_warnings():
    pm = parse_project(FIXTURE, "zip")
    assert pm.parser_warnings == []


def test_real_world_project_step_counts_are_realistic_not_inflated():
    """Before the fix, "1. Login to ACME.xaml" produced 126 "steps" — almost
    entirely VB-import/assembly-reference boilerplate misread as activities.
    The real workflow has under 20 genuine activities."""
    pm = parse_project(FIXTURE, "zip")
    steps_by_file = {wf.file: len(wf.steps) for wf in pm.workflows}
    for count in steps_by_file.values():
        assert count < 20, steps_by_file


def test_real_world_project_captures_real_arguments_and_variables():
    """x:Members-declared arguments and Sequence.Variables-declared
    variables must survive the metadata-skipping fix, not get discarded
    along with the boilerplate."""
    pm = parse_project(FIXTURE, "zip")
    main = next(wf for wf in pm.workflows if wf.file == "Main.xaml")
    assert len(main.arguments) == 3

    login = next(wf for wf in pm.workflows if wf.file == "1. Login to ACME.xaml")
    assert any(v.name == "Password" for v in login.variables)


def test_real_world_project_finds_real_activities_inside_body_wrappers():
    """OpenBrowser/BrowserScope activities nest their real content inside a
    `.Body` property-element wrapper — this must be unwrapped and walked,
    not skipped as if it were metadata."""
    pm = parse_project(FIXTURE, "zip")
    login = next(wf for wf in pm.workflows if wf.file == "1. Login to ACME.xaml")
    activity_types = {s.activity_type for s in login.steps}
    assert "TypeInto" in activity_types
    assert "Click" in activity_types


def test_real_world_project_excludes_disabled_commentout_blocks():
    """Two `<ui:CommentOut>` blocks in "2. Search all invoices.xaml" contain
    real-looking nested activities that are never executed — they must not
    be counted as steps."""
    pm = parse_project(FIXTURE, "zip")
    search = next(wf for wf in pm.workflows if wf.file == "2. Search all invoices.xaml")
    assert not any(s.activity_type == "CommentOut" for s in search.steps)
    assert len(search.steps) < 10
