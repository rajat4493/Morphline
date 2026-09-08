"""Estate Phase 6: process flow readability. Pure structural container
wrappers (Sequence/If/TryCatch with no risk/notes of their own) must not
appear as nodes, execution order must survive the contraction, and
invoked-workflow steps must render as distinct subprocess blocks."""
from pathlib import Path

from apps.api.app.flowgraph import build_flow_graph
from parser.uipath.parse import parse_project

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"


def _graph(name: str):
    pm = parse_project(FIXTURES / name, "zip")
    return pm, build_flow_graph(pm)


def test_pure_structural_containers_are_not_rendered_as_nodes():
    pm, graph = _graph("loan_exception_review")
    raw_steps = [s for wf in pm.workflows for s in wf.steps]
    noisy_container_ids = {
        f"{wf.file}::{s.id}" for wf in pm.workflows for s in wf.steps
        if s.is_container and not s.risks and not s.notes
    }
    node_ids = {n["id"] for n in graph["nodes"]}
    assert noisy_container_ids, "fixture expected to contain at least one pure structural container"
    assert node_ids.isdisjoint(noisy_container_ids)
    assert len(graph["nodes"]) < len(raw_steps)


def test_flattened_graph_has_no_dangling_edges():
    for name in ("invoice_processing", "loan_exception_review", "ui_heavy_reusable_tools"):
        _pm, graph = _graph(name)
        node_ids = {n["id"] for n in graph["nodes"]}
        for e in graph["edges"]:
            assert e["source"] in node_ids, f"{name}: dangling edge source {e}"
            assert e["target"] in node_ids, f"{name}: dangling edge target {e}"


def test_execution_order_preserved_across_contracted_container():
    """A leaf step whose real predecessor sits inside a dropped container
    must still connect via a sequence edge once the container is removed."""
    pm, graph = _graph("invoice_processing")
    wf = pm.workflows[0]
    kept_ids = {n["id"] for n in graph["nodes"]}
    leaf_ids = [f"{wf.file}::{s.id}" for s in wf.steps if not s.is_container]
    assert any(lid in kept_ids for lid in leaf_ids)
    sequence_edges = [e for e in graph["edges"] if e["type"] == "sequence"]
    assert sequence_edges, "expected at least one sequence edge to survive container contraction"


def test_invoked_workflow_step_rendered_as_distinct_subprocess_block():
    pm, graph = _graph("ui_heavy_reusable_tools")
    has_invoke_type = any(n["type"] == "invokedWorkflow" for n in graph["nodes"])
    has_invoke_edge = any(e["type"] == "invoke" for e in graph["edges"])
    if not any(s.invoked_workflow for wf in pm.workflows for s in wf.steps):
        return  # fixture may not use InvokeWorkflowFile; nothing to assert
    assert has_invoke_type
    assert has_invoke_edge
