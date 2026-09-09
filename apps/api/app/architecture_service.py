"""DB orchestration for Phase 3 (Enterprise Transformation Architecture):
loads/persists a workspace's platform catalog and adapts persisted
automations into `architecture.plan.generate_target_architecture`'s pure
inputs. Nothing about the target-architecture computation itself lives
here — this only ever loads data and calls the pure `architecture/`
package, matching `estate_service.py`.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from apps.api.app.estate_service import AutomationSnapshot
from apps.api.app.models import orm
from architecture.plan import generate_target_architecture
from packages.shared.architecture_types import PlatformProfile, PlatformRole, TargetArchitecturePlan

# A starting catalog, not a hardcoded recommendation: seeded once per
# workspace so there is something to look at, but every row is ordinary
# data a user can edit/replace via the API. architecture/plan.py never
# treats "seeded by us" specially — it only ever matches on role.
DEFAULT_CATALOG: list[tuple[str, PlatformRole]] = [
    ("AWS Bedrock", PlatformRole.REASONING),
    ("AWS AgentCore", PlatformRole.AGENT_RUNTIME),
    ("n8n", PlatformRole.ORCHESTRATION),
    ("UiPath", PlatformRole.BOUNDED_EXECUTION),
    ("OutSystems", PlatformRole.HUMAN_APPROVAL),
    ("Internal API Gateway", PlatformRole.API_GATEWAY),
    ("Enterprise Database", PlatformRole.DATABASE),
    ("Enterprise Queue", PlatformRole.QUEUE),
    ("Enterprise Observability", PlatformRole.OBSERVABILITY),
]


def _row_to_profile(row: orm.PlatformProfileRow) -> PlatformProfile:
    return PlatformProfile(id=row.id, name=row.name, role=PlatformRole(row.role), notes=row.notes)


def ensure_default_catalog(db: Session, workspace_id: int) -> None:
    """Seeds the default catalog for a workspace exactly once — never
    re-seeds or overwrites rows a user has since edited/deleted."""
    existing = db.query(orm.PlatformProfileRow).filter_by(workspace_id=workspace_id).first()
    if existing is not None:
        return
    for name, role in DEFAULT_CATALOG:
        db.add(orm.PlatformProfileRow(workspace_id=workspace_id, name=name, role=role.value))
    db.commit()


def load_platform_catalog(db: Session, workspace_id: int) -> list[PlatformProfile]:
    rows = db.query(orm.PlatformProfileRow).filter_by(workspace_id=workspace_id).all()
    return [_row_to_profile(r) for r in rows]


def add_platform(db: Session, workspace_id: int, name: str, role: PlatformRole, notes: str | None = None) -> PlatformProfile:
    row = orm.PlatformProfileRow(workspace_id=workspace_id, name=name, role=role.value, notes=notes)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_profile(row)


def delete_platform(db: Session, workspace_id: int, platform_id: int) -> bool:
    row = db.query(orm.PlatformProfileRow).filter_by(id=platform_id, workspace_id=workspace_id).first()
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def build_target_architecture(snapshot: AutomationSnapshot, catalog: list[PlatformProfile]) -> TargetArchitecturePlan:
    return generate_target_architecture(
        automation_id=snapshot.automation_id, automation_name=snapshot.name,
        pm=snapshot.process_model, scores=snapshot.scores, rec=snapshot.recommendation,
        biz=snapshot.business_context, catalog=catalog,
    )
