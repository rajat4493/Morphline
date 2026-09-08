"""Estate graph and shared-constraint computation — pure functions over a
list of per-automation snapshots plus an injected canonical-dependency
resolver (so this stays testable without a database, matching the
scoring/recommendation packages' style).

Nothing here is persisted: the estate graph is recomputed from existing
Automation/ProcessVersion/Assessment/Constraint data on every request
(Section: "do not create a separate duplicate universe"). At V0 scale
(dozens of automations) this is cheap; see docs/DUCK_HANDOFF.md "Risks."
"""
from __future__ import annotations

from typing import Callable, Iterable, NamedTuple, Optional

from packages.shared.canonical import ProcessModel
from packages.shared.enums import ConstraintCategory, ConstraintSeverity
from packages.shared.estate_types import (
    CanonicalDependency,
    DependencyKind,
    EstateEdge,
    EstateGraph,
    EstateNode,
    EstateNodeType,
    SharedConstraint,
)
from packages.shared.memory_types import ConstraintRecord

Resolver = Callable[[DependencyKind, str], CanonicalDependency]


class AutomationFacts(NamedTuple):
    """The minimum one automation contributes to estate computation —
    deliberately narrow so tests can construct it without a full pipeline
    run. `apps/api/app/estate_service.py` adapts real DB rows into this."""

    automation_id: int
    name: str
    process_model: ProcessModel
    active_constraints: list[ConstraintRecord]


# Constraint categories whose root cause is a specific external system —
# re-derived from the process model rather than trusting free-text
# evidence, so estate-level attribution stays mechanical, not string-matched.
_UI_DEPENDENCY_CATEGORIES = {ConstraintCategory.UNSTABLE_UI_DEPENDENCY}
_ALL_SYSTEMS_CATEGORIES = {ConstraintCategory.HIGH_BLAST_RADIUS, ConstraintCategory.ARCHITECTURE_LIMITATION}


def _severity_rank(s: ConstraintSeverity) -> int:
    return [ConstraintSeverity.LOW, ConstraintSeverity.MEDIUM, ConstraintSeverity.HIGH, ConstraintSeverity.CRITICAL].index(s)


def _dependency_names_for_constraint(category: ConstraintCategory, pm: ProcessModel) -> list[str]:
    """Which raw system names (if any) a constraint category is actually
    about, re-derived from the process model rather than the constraint's
    free-text description. A category not in either set is treated as
    process-wide (not tied to one external system) — grouped by category
    alone, not fabricated onto an unrelated system."""
    if category in _UI_DEPENDENCY_CATEGORIES:
        return [s.name for s in pm.systems if s.interaction_mode == "ui_automation"]
    if category in _ALL_SYSTEMS_CATEGORIES:
        return [s.name for s in pm.systems]
    return []


def build_estate_graph(automations: Iterable[AutomationFacts], resolve: Resolver) -> EstateGraph:
    nodes: dict[str, EstateNode] = {}
    edges: list[EstateEdge] = []

    for fact in automations:
        auto_node_id = f"automation:{fact.automation_id}"
        nodes[auto_node_id] = EstateNode(
            id=auto_node_id, type=EstateNodeType.AUTOMATION, label=fact.name,
            meta={"automation_id": fact.automation_id},
        )

        for system in fact.process_model.systems:
            canonical = resolve(DependencyKind.SYSTEM, system.name)
            sys_node_id = f"system:{canonical.normalized_key}"
            nodes.setdefault(sys_node_id, EstateNode(
                id=sys_node_id, type=EstateNodeType.SYSTEM, label=canonical.canonical_name,
                meta={"canonical_dependency_id": canonical.id, "interaction_modes": []},
            ))
            modes = nodes[sys_node_id].meta.setdefault("interaction_modes", [])
            if system.interaction_mode not in modes:
                modes.append(system.interaction_mode)
            edges.append(EstateEdge(id=f"{auto_node_id}->{sys_node_id}", source=auto_node_id, target=sys_node_id, kind="depends_on"))

        invoked_names = {
            d.name for d in fact.process_model.dependencies if d.kind == "invoked_workflow"
        }
        for name in invoked_names:
            canonical = resolve(DependencyKind.COMPONENT, name)
            comp_node_id = f"component:{canonical.normalized_key}"
            nodes.setdefault(comp_node_id, EstateNode(
                id=comp_node_id, type=EstateNodeType.COMPONENT, label=canonical.canonical_name, meta={"canonical_dependency_id": canonical.id},
            ))
            edges.append(EstateEdge(id=f"{auto_node_id}->{comp_node_id}", source=auto_node_id, target=comp_node_id, kind="invokes"))

    return EstateGraph(nodes=list(nodes.values()), edges=edges)


def compute_shared_constraints(automations: Iterable[AutomationFacts], resolve: Resolver) -> list[SharedConstraint]:
    """Groups active constraints by (category, canonical dependency) so 30
    automations hitting the "same" SAP UI-dependency issue produce ONE
    estate-level fact, not 30 duplicate-looking rows (Section: "do not
    duplicate identical constraint descriptions across 30 rows")."""
    buckets: dict[tuple[str, Optional[str]], SharedConstraint] = {}

    for fact in automations:
        for c in fact.active_constraints:
            dep_raw_names = _dependency_names_for_constraint(c.category, fact.process_model)
            canonical_names = (
                [resolve(DependencyKind.SYSTEM, n).canonical_name for n in dep_raw_names] if dep_raw_names else [None]
            )
            for canonical_name in set(canonical_names):
                bucket_key = (c.category.value, canonical_name)
                bucket = buckets.get(bucket_key)
                if bucket is None:
                    bucket = SharedConstraint(
                        key=f"{c.category.value}:{canonical_name or 'estate-wide'}",
                        category=c.category, canonical_dependency=canonical_name,
                        severity=c.severity,
                    )
                    buckets[bucket_key] = bucket
                if fact.automation_id not in bucket.affected_automation_ids:
                    bucket.affected_automation_ids.append(fact.automation_id)
                    bucket.affected_automation_names.append(fact.name)
                if _severity_rank(c.severity) > _severity_rank(bucket.severity):
                    bucket.severity = c.severity
                if len(bucket.sample_evidence) < 3:
                    bucket.sample_evidence.extend(c.evidence[:1])

    for bucket in buckets.values():
        bucket.affected_count = len(bucket.affected_automation_ids)

    return sorted(buckets.values(), key=lambda b: b.affected_count, reverse=True)
