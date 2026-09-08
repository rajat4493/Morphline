"""Estate-level endpoints: graph, shared constraints, unlock opportunities,
modernization priorities, what-if simulation, canonical dependency
management, and environment-change memory. Everything here is computed
fresh from existing per-automation data on each call except the canonical
dependency dictionary and environment event log, which are the only new
persisted state this phase introduces (see docs/DUCK_HANDOFF.md).
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from apps.api.app.db import get_db
from apps.api.app.estate_service import (
    confirm_alias,
    list_environment_events,
    load_canonical_dependencies,
    load_workspace_snapshots,
    make_resolver,
    record_environment_event,
    to_automation_facts,
    to_sim_inputs,
)
from apps.api.app.models import orm
from estate.graph import build_estate_graph, compute_shared_constraints
from estate.simulation import run_simulation
from estate.unlock import compute_unlock_opportunities, rank_modernization_priorities
from packages.shared.estate_types import EstateEdge, EstateGraph, EstateNode, EstateNodeType, SimulationScenario

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["estate"])


def _get_workspace(db: Session, workspace_id: int) -> orm.Workspace:
    ws = db.query(orm.Workspace).filter_by(id=workspace_id).first()
    if not ws:
        raise HTTPException(404, "Workspace not found")
    return ws


def _graph_by_component(graph: EstateGraph) -> EstateGraph:
    keep_ids = {n.id for n in graph.nodes if n.type in (EstateNodeType.AUTOMATION, EstateNodeType.COMPONENT)}
    return EstateGraph(
        nodes=[n for n in graph.nodes if n.id in keep_ids],
        edges=[e for e in graph.edges if e.source in keep_ids and e.target in keep_ids],
    )


def _graph_by_state(snapshots) -> EstateGraph:
    """Hub = evolution state, spokes = automations."""
    nodes: list[EstateNode] = []
    edges: list[EstateEdge] = []
    seen_states: set[str] = set()
    for s in snapshots:
        state = s.recommendation.recommended_state.value
        state_node_id = f"state:{state}"
        if state_node_id not in seen_states:
            seen_states.add(state_node_id)
            nodes.append(EstateNode(id=state_node_id, type=EstateNodeType.CONSTRAINT, label=state.replace("_", " ").title(), meta={}))
        auto_node_id = f"automation:{s.automation_id}"
        nodes.append(EstateNode(id=auto_node_id, type=EstateNodeType.AUTOMATION, label=s.name, meta={"automation_id": s.automation_id}))
        edges.append(EstateEdge(id=f"{auto_node_id}->{state_node_id}", source=auto_node_id, target=state_node_id, kind="depends_on"))
    return EstateGraph(nodes=nodes, edges=edges)


def _graph_by_constraint(facts, resolve) -> EstateGraph:
    """Hub = shared constraint, spokes = affected automations."""
    shared = compute_shared_constraints(facts, resolve)
    nodes: list[EstateNode] = []
    edges: list[EstateEdge] = []
    seen_autos: set[str] = set()
    for sc in shared:
        c_node_id = f"constraint:{sc.key}"
        label = sc.category.value.replace("_", " ").title()
        if sc.canonical_dependency:
            label += f" — {sc.canonical_dependency}"
        nodes.append(EstateNode(id=c_node_id, type=EstateNodeType.CONSTRAINT, label=label, meta={"affected_count": sc.affected_count}))
        for aid, aname in zip(sc.affected_automation_ids, sc.affected_automation_names):
            auto_node_id = f"automation:{aid}"
            if auto_node_id not in seen_autos:
                nodes.append(EstateNode(id=auto_node_id, type=EstateNodeType.AUTOMATION, label=aname, meta={"automation_id": aid}))
                seen_autos.add(auto_node_id)
            edges.append(EstateEdge(id=f"{auto_node_id}->{c_node_id}", source=auto_node_id, target=c_node_id, kind="blocked_by"))
    return EstateGraph(nodes=nodes, edges=edges)


@router.get("/estate/graph")
def get_estate_graph(workspace_id: int, mode: str = "system", db: Session = Depends(get_db)):
    """`mode`: system (default) | component | constraint | state. See
    Section: "clusters, not spiderweb" — every mode is a shallow two-level
    hub/spoke clustering, never a raw per-step dump."""
    _get_workspace(db, workspace_id)
    snapshots = load_workspace_snapshots(db, workspace_id)
    facts = to_automation_facts(snapshots)
    resolve, _cache = make_resolver(db, workspace_id)

    if mode == "state":
        graph = _graph_by_state(snapshots)
    elif mode == "constraint":
        graph = _graph_by_constraint(facts, resolve)
    elif mode == "component":
        graph = _graph_by_component(build_estate_graph(facts, resolve))
    else:
        graph = build_estate_graph(facts, resolve)

    db.commit()
    return graph.model_dump(mode="json")


@router.get("/estate/shared-constraints")
def get_shared_constraints(workspace_id: int, db: Session = Depends(get_db)):
    _get_workspace(db, workspace_id)
    snapshots = load_workspace_snapshots(db, workspace_id)
    facts = to_automation_facts(snapshots)
    resolve, _cache = make_resolver(db, workspace_id)
    shared = compute_shared_constraints(facts, resolve)
    db.commit()
    return [s.model_dump(mode="json") for s in shared]


@router.get("/estate/unlock-opportunities")
def get_unlock_opportunities(workspace_id: int, db: Session = Depends(get_db)):
    _get_workspace(db, workspace_id)
    snapshots = load_workspace_snapshots(db, workspace_id)
    facts = to_automation_facts(snapshots)
    resolve, _cache = make_resolver(db, workspace_id)
    shared = compute_shared_constraints(facts, resolve)
    sim_inputs = {s.automation_id: si for s, si in zip(snapshots, to_sim_inputs(snapshots))}
    opportunities = compute_unlock_opportunities(shared, sim_inputs)
    db.commit()
    return [o.model_dump(mode="json") for o in opportunities]


@router.get("/estate/modernization-priorities")
def get_modernization_priorities(workspace_id: int, db: Session = Depends(get_db)):
    _get_workspace(db, workspace_id)
    snapshots = load_workspace_snapshots(db, workspace_id)
    facts = to_automation_facts(snapshots)
    resolve, _cache = make_resolver(db, workspace_id)
    shared = compute_shared_constraints(facts, resolve)
    sim_inputs = {s.automation_id: si for s, si in zip(snapshots, to_sim_inputs(snapshots))}
    opportunities = compute_unlock_opportunities(shared, sim_inputs)
    priorities = rank_modernization_priorities(opportunities)
    db.commit()
    return [p.model_dump(mode="json") for p in priorities]


@router.post("/estate/simulate")
def simulate(workspace_id: int, scenario: SimulationScenario, db: Session = Depends(get_db)):
    """Never writes anything — a simulation is a pure read+compute over the
    real, unmutated snapshots (Section: "never mutate real stored
    constraints during simulation")."""
    _get_workspace(db, workspace_id)
    snapshots = load_workspace_snapshots(db, workspace_id)
    sim_inputs = to_sim_inputs(snapshots)
    result = run_simulation(scenario, sim_inputs)
    return result.model_dump(mode="json")


@router.get("/canonical-dependencies")
def get_canonical_dependencies(workspace_id: int, db: Session = Depends(get_db)):
    _get_workspace(db, workspace_id)
    deps = load_canonical_dependencies(db, workspace_id)
    return [d.model_dump(mode="json") for d in deps]


class ConfirmAliasRequest(BaseModel):
    raw_name: str


@router.post("/canonical-dependencies/{dependency_id}/confirm-alias")
def confirm_alias_endpoint(workspace_id: int, dependency_id: int, payload: ConfirmAliasRequest, db: Session = Depends(get_db)):
    _get_workspace(db, workspace_id)
    try:
        dep = confirm_alias(db, workspace_id, dependency_id, payload.raw_name)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return dep.model_dump(mode="json")


class EnvironmentEventRequest(BaseModel):
    canonical_dependency: str
    description: str
    occurred_on: str | None = None
    recorded_by: str | None = None


@router.get("/environment-events")
def get_environment_events(workspace_id: int, db: Session = Depends(get_db)):
    _get_workspace(db, workspace_id)
    rows = list_environment_events(db, workspace_id)
    return [
        {
            "id": r.id, "canonical_dependency": r.canonical_dependency, "description": r.description,
            "occurred_on": r.occurred_on, "recorded_by": r.recorded_by, "created_at": r.created_at,
        }
        for r in rows
    ]


@router.post("/environment-events", status_code=201)
def post_environment_event(workspace_id: int, payload: EnvironmentEventRequest, db: Session = Depends(get_db)):
    _get_workspace(db, workspace_id)
    occurred_on = datetime.fromisoformat(payload.occurred_on) if payload.occurred_on else None
    row, affected = record_environment_event(
        db, workspace_id, payload.canonical_dependency, payload.description, occurred_on, payload.recorded_by,
    )
    return {
        "id": row.id, "canonical_dependency": row.canonical_dependency, "description": row.description,
        "occurred_on": row.occurred_on, "recorded_by": row.recorded_by,
        "potentially_affected_automations": [{"id": s.automation_id, "name": s.name} for s in affected],
        "note": (
            f"Potential evolution unlock detected: {len(affected)} process(es) should be reassessed."
            if affected else "No automations currently reference this dependency."
        ),
    }
