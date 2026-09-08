"""Converts a canonical ProcessModel into a React Flow-shaped graph.

Container steps become group nodes (Section 7: "grouped subprocesses");
`InvokeWorkflowFile` steps get an edge into the invoked workflow's entry
node so multi-workflow projects render as one connected graph.
"""
from __future__ import annotations

from packages.shared.canonical import ProcessModel, Step, Workflow

_CATEGORY_COLOR = {
    "DETERMINISTIC": "#2563eb",
    "REASONING": "#7c3aed",
    "API_TOOL": "#16a34a",
    "HUMAN_APPROVAL": "#ea580c",
    "RISK": "#dc2626",
    "UNKNOWN": "#6b7280",
}


def _node_id(wf: Workflow, step: Step) -> str:
    return f"{wf.file}::{step.id}"


def build_flow_graph(pm: ProcessModel) -> dict:
    nodes = []
    edges = []

    for wf in pm.workflows:
        for step in wf.steps:
            nid = _node_id(wf, step)
            nodes.append({
                "id": nid,
                "type": "processStep",
                "data": {
                    "label": step.display_name,
                    "activityType": step.activity_type,
                    "category": step.category.value,
                    "color": _CATEGORY_COLOR[step.category.value],
                    "confidence": step.confidence.value,
                    "workflow": wf.file,
                    "isContainer": bool(step.children),
                    "risks": step.risks,
                    "notes": step.notes,
                    "evidence": [f"{e.source}: {e.detail}" for e in step.evidence],
                    "selector": step.selector.raw if step.selector else None,
                    "invokedWorkflow": step.invoked_workflow,
                    "api": step.api.model_dump() if step.api else None,
                },
                "position": {"x": 0, "y": 0},  # frontend applies auto-layout
            })
            for child_id in step.children:
                edges.append({"id": f"{nid}->{wf.file}::{child_id}", "source": nid, "target": f"{wf.file}::{child_id}", "type": "containment"})
            for next_id in step.next:
                edges.append({"id": f"{nid}-next->{wf.file}::{next_id}", "source": nid, "target": f"{wf.file}::{next_id}", "type": "sequence"})

            if step.invoked_workflow:
                target_wf = next((w for w in pm.workflows if w.file == step.invoked_workflow), None)
                if target_wf and target_wf.steps:
                    target_id = _node_id(target_wf, target_wf.steps[0])
                    edges.append({"id": f"{nid}-invokes->{target_id}", "source": nid, "target": target_id, "type": "invoke"})

    return {"nodes": nodes, "edges": edges}
