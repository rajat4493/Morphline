"""Converts a canonical ProcessModel into a React Flow-shaped graph.

Readability fix (estate brief: "current graph is a raw node dump"): pure
structural containers (Sequence/If/TryCatch wrappers with no risk/notes of
their own) are not rendered as nodes at all — they contribute no
information a reader needs, so we contract them out of the graph and
rewire sequence edges straight to their first meaningful child, and from
their last descendant onward to whatever followed the container. This
preserves real execution order and keeps `InvokeWorkflowFile` steps as
distinct subprocess blocks with an edge into the invoked workflow, while
removing the wrapper noise that used to flood the diagram.
"""
from __future__ import annotations

from typing import Optional

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


def _is_structural_noise(step: Step) -> bool:
    """A container step that adds no information of its own — safe to
    contract out of the diagram. A container flagged with risks/notes (e.g.
    a TryCatch wrapping a risky operation) is kept, since collapsing it
    would hide that information."""
    return step.is_container and not step.risks and not step.notes


class _WorkflowFlattener:
    """Contracts structural-noise container steps out of one workflow's
    step list, rewiring sequence edges so real execution order survives."""

    def __init__(self, wf: Workflow) -> None:
        self.wf = wf
        self.steps: dict[str, Step] = {s.id: s for s in wf.steps}
        self.parent_of: dict[str, str] = {}
        for s in wf.steps:
            for child_id in s.children:
                self.parent_of[child_id] = s.id
        self.drop_set = {s.id for s in wf.steps if _is_structural_noise(s)}
        self._succ_cache: dict[str, list[str]] = {}

    def _succ(self, step_id: str) -> list[str]:
        """Ids that execute immediately after `step_id` finishes, walking up
        through parent containers when `step_id` is the last in its own
        sequence (its own `next` is empty)."""
        if step_id in self._succ_cache:
            return self._succ_cache[step_id]
        self._succ_cache[step_id] = []  # cycle guard
        step = self.steps.get(step_id)
        if step is None:
            result: list[str] = []
        elif step.next:
            result = list(step.next)
        else:
            parent = self.parent_of.get(step_id)
            result = self._succ(parent) if parent else []
        self._succ_cache[step_id] = result
        return result

    def resolve_entry(self, step_id: Optional[str]) -> list[str]:
        """The kept node id(s) reached when execution enters `step_id` —
        descends into a dropped container's first child, or, if the
        container is empty, skips forward to whatever follows it."""
        if step_id is None:
            return []
        seen: set[str] = set()
        while step_id is not None and step_id in self.drop_set:
            if step_id in seen:
                return []
            seen.add(step_id)
            step = self.steps[step_id]
            if step.children:
                step_id = step.children[0]
            else:
                nxt = self._succ(step_id)
                step_id = nxt[0] if nxt else None
        return [step_id] if step_id is not None else []

    def kept_steps(self) -> list[Step]:
        return [s for s in self.wf.steps if s.id not in self.drop_set]

    def sequence_targets(self, step_id: str) -> list[str]:
        targets: list[str] = []
        for n in self._succ(step_id):
            for resolved in self.resolve_entry(n):
                if resolved not in targets:
                    targets.append(resolved)
        return targets

    def containment_targets(self, step_id: str) -> list[str]:
        """For a kept container (one with its own risks/notes), the visible
        child to link into — still descending past any dropped children."""
        step = self.steps[step_id]
        targets: list[str] = []
        for child_id in step.children:
            for resolved in self.resolve_entry(child_id) if child_id in self.drop_set else [child_id]:
                if resolved not in targets:
                    targets.append(resolved)
        return targets


def build_flow_graph(pm: ProcessModel) -> dict:
    nodes = []
    edges = []

    for wf in pm.workflows:
        flattener = _WorkflowFlattener(wf)
        kept = flattener.kept_steps()
        kept_ids = {s.id for s in kept}

        for step in kept:
            nid = _node_id(wf, step)
            nodes.append({
                "id": nid,
                "type": "invokedWorkflow" if step.invoked_workflow else "processStep",
                "data": {
                    "label": step.display_name,
                    "activityType": step.activity_type,
                    "category": step.category.value,
                    "color": _CATEGORY_COLOR[step.category.value],
                    "confidence": step.confidence.value,
                    "workflow": wf.file,
                    "isContainer": step.is_container,
                    "risks": step.risks,
                    "notes": step.notes,
                    "evidence": [f"{e.source}: {e.detail}" for e in step.evidence],
                    "selector": step.selector.raw if step.selector else None,
                    "invokedWorkflow": step.invoked_workflow,
                    "api": step.api.model_dump() if step.api else None,
                },
                "position": {"x": 0, "y": 0},  # frontend applies auto-layout
            })

            if step.is_container:
                for child_id in flattener.containment_targets(step.id):
                    if child_id in kept_ids:
                        edges.append({"id": f"{nid}->{wf.file}::{child_id}", "source": nid, "target": f"{wf.file}::{child_id}", "type": "containment"})

            for next_id in flattener.sequence_targets(step.id):
                if next_id in kept_ids:
                    edges.append({"id": f"{nid}-next->{wf.file}::{next_id}", "source": nid, "target": f"{wf.file}::{next_id}", "type": "sequence"})

            if step.invoked_workflow:
                target_wf = next((w for w in pm.workflows if w.file == step.invoked_workflow), None)
                if target_wf and target_wf.steps:
                    target_flattener = _WorkflowFlattener(target_wf)
                    entry_id = next((s.id for s in target_wf.steps if s.id not in target_flattener.drop_set), None)
                    if entry_id:
                        edges.append({"id": f"{nid}-invokes->{target_wf.file}::{entry_id}", "source": nid, "target": f"{target_wf.file}::{entry_id}", "type": "invoke"})

    return {"nodes": nodes, "edges": edges}
