"""DB orchestration for estate intelligence: adapts persisted rows into the
pure `estate/` package's inputs, and persists the one piece of genuinely
new institutional knowledge this phase introduces — the canonical
dependency dictionary. Everything else (graph, shared constraints, unlock
opportunities, simulation) is computed fresh from existing data on every
call; see docs/DUCK_HANDOFF.md for why.
"""
from __future__ import annotations

from typing import NamedTuple

from sqlalchemy.orm import Session

from apps.api.app.models import orm
from apps.api.app.pipeline import assessment_dimension_scores, snapshot_from_assessment
from estate import identity
from estate.graph import AutomationFacts
from estate.simulation import SimInput
from packages.shared.business_context import BusinessContext
from packages.shared.canonical import ProcessModel
from packages.shared.estate_types import AliasMapping, CanonicalDependency, DependencyKind
from packages.shared.memory_types import ConstraintRecord
from packages.shared.recommendation_types import RecommendationResult
from packages.shared.scoring_types import DimensionScore


class AutomationSnapshot(NamedTuple):
    automation_id: int
    name: str
    process_model: ProcessModel
    scores: dict[str, DimensionScore]
    recommendation: RecommendationResult
    business_context: BusinessContext
    active_constraints: list[ConstraintRecord]


def _latest_assessment(automation: orm.Automation) -> orm.Assessment | None:
    if not automation.versions:
        return None
    version = automation.versions[-1]
    if not version.assessments:
        return None
    return max(version.assessments, key=lambda a: a.created_at)


def load_workspace_snapshots(db: Session, workspace_id: int) -> list[AutomationSnapshot]:
    """Every automation in the workspace that has at least one completed
    assessment. Automations with no upload yet, or no assessment yet, are
    silently excluded — they contribute nothing to estate computation."""
    workspace = db.query(orm.Workspace).filter_by(id=workspace_id).first()
    if not workspace:
        return []

    snapshots: list[AutomationSnapshot] = []
    for automation in workspace.automations:
        assessment = _latest_assessment(automation)
        if assessment is None:
            continue
        snap = snapshot_from_assessment(db, assessment)
        if snap is None:
            continue
        version = automation.versions[-1]
        pm = ProcessModel.model_validate(version.process_model)
        scores = assessment_dimension_scores(assessment)
        snapshots.append(AutomationSnapshot(
            automation_id=automation.id, name=automation.name, process_model=pm, scores=scores,
            recommendation=snap.recommendation, business_context=snap.business_context or BusinessContext(),
            active_constraints=snap.active_constraints,
        ))
    return snapshots


def to_automation_facts(snapshots: list[AutomationSnapshot]) -> list[AutomationFacts]:
    return [
        AutomationFacts(automation_id=s.automation_id, name=s.name, process_model=s.process_model, active_constraints=s.active_constraints)
        for s in snapshots
    ]


def to_sim_inputs(snapshots: list[AutomationSnapshot]) -> list[SimInput]:
    return [
        SimInput(automation_id=s.automation_id, name=s.name, process_model=s.process_model, business_context=s.business_context, current_recommendation=s.recommendation)
        for s in snapshots
    ]


# ---------------------------------------------------------------------------
# Canonical dependency persistence
# ---------------------------------------------------------------------------

def _row_to_dependency(row: orm.CanonicalDependencyRow) -> CanonicalDependency:
    return CanonicalDependency(
        id=row.id, kind=DependencyKind(row.kind), canonical_name=row.canonical_name,
        normalized_key=row.normalized_key, aliases=[AliasMapping.model_validate(a) for a in row.aliases],
    )


def load_canonical_dependencies(db: Session, workspace_id: int) -> list[CanonicalDependency]:
    rows = db.query(orm.CanonicalDependencyRow).filter_by(workspace_id=workspace_id).all()
    return [_row_to_dependency(r) for r in rows]


def make_resolver(db: Session, workspace_id: int):
    """Returns a `Resolver` closure (see estate/graph.py) that resolves
    against — and persists new entries into — this workspace's canonical
    dependency dictionary. New rows/alias updates are flushed immediately
    so a single request that observes the same raw name twice reuses the
    same in-memory + DB row instead of creating duplicates."""
    cache = load_canonical_dependencies(db, workspace_id)
    row_by_id: dict[int, orm.CanonicalDependencyRow] = {}

    def resolve(kind: DependencyKind, raw_name: str) -> CanonicalDependency:
        dep, is_new, alias_added = identity.resolve(cache, kind, raw_name)
        if is_new:
            cache.append(dep)
            row = orm.CanonicalDependencyRow(
                workspace_id=workspace_id, kind=dep.kind.value, canonical_name=dep.canonical_name,
                normalized_key=dep.normalized_key, aliases=[a.model_dump(mode="json") for a in dep.aliases],
            )
            db.add(row)
            db.flush()
            dep.id = row.id
            row_by_id[row.id] = row
        elif alias_added:
            row = row_by_id.get(dep.id) or db.query(orm.CanonicalDependencyRow).filter_by(id=dep.id).first()
            if row:
                row.aliases = [a.model_dump(mode="json") for a in dep.aliases]
                row_by_id[dep.id] = row
        return dep

    return resolve, cache


def record_environment_event(
    db: Session, workspace_id: int, canonical_dependency: str, description: str,
    occurred_on=None, recorded_by: str | None = None,
) -> tuple[orm.EnvironmentEventRow, list[AutomationSnapshot]]:
    """Records a longitudinal environment change (Section: "Morphline
    should remember environmental changes") and returns the automations
    that reference this canonical dependency, so the caller can surface
    "N processes should be reassessed" — never auto-applying anything."""
    row = orm.EnvironmentEventRow(
        workspace_id=workspace_id, canonical_dependency=canonical_dependency,
        description=description, occurred_on=occurred_on, recorded_by=recorded_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    snapshots = load_workspace_snapshots(db, workspace_id)
    resolve, _cache = make_resolver(db, workspace_id)
    db.commit()
    target_key = identity.normalized_key_for(DependencyKind.SYSTEM, canonical_dependency)
    potentially_affected = [
        s for s in snapshots
        if any(identity.normalized_key_for(DependencyKind.SYSTEM, sysobj.name) == target_key for sysobj in s.process_model.systems)
    ]
    return row, potentially_affected


def list_environment_events(db: Session, workspace_id: int) -> list[orm.EnvironmentEventRow]:
    return (
        db.query(orm.EnvironmentEventRow)
        .filter_by(workspace_id=workspace_id)
        .order_by(orm.EnvironmentEventRow.occurred_on.is_(None), orm.EnvironmentEventRow.occurred_on, orm.EnvironmentEventRow.created_at)
        .all()
    )


def confirm_alias(db: Session, workspace_id: int, canonical_dependency_id: int, raw_name: str) -> CanonicalDependency:
    """Manually confirms a raw name belongs to an existing canonical
    dependency even though deterministic normalization didn't catch it —
    the "user-confirmable mapping" path. Never used to silently merge two
    canonical dependencies into each other."""
    row = db.query(orm.CanonicalDependencyRow).filter_by(id=canonical_dependency_id, workspace_id=workspace_id).first()
    if row is None:
        raise ValueError("Canonical dependency not found in this workspace")
    dep = _row_to_dependency(row)
    if raw_name not in {a.raw for a in dep.aliases}:
        dep.aliases.append(AliasMapping(raw=raw_name, confidence="UNKNOWN", user_confirmed=True))
    else:
        for a in dep.aliases:
            if a.raw == raw_name:
                a.user_confirmed = True
    row.aliases = [a.model_dump(mode="json") for a in dep.aliases]
    db.commit()
    return dep
