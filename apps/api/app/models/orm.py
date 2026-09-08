"""SQLAlchemy models. Kept Postgres-portable (D-005): only sqlalchemy.JSON
(maps to JSONB on Postgres, TEXT-encoded JSON on SQLite), no SQLite-only
types.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    automations: Mapped[list["Automation"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class Automation(Base):
    __tablename__ = "automations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"))
    name: Mapped[str] = mapped_column(String(300))
    is_sample: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    workspace: Mapped[Workspace] = relationship(back_populates="automations")
    versions: Mapped[list["ProcessVersion"]] = relationship(back_populates="automation", cascade="all, delete-orphan", order_by="ProcessVersion.version_number")
    constraints: Mapped[list["Constraint"]] = relationship(back_populates="automation", cascade="all, delete-orphan")
    events: Mapped[list["EvolutionEvent"]] = relationship(back_populates="automation", cascade="all, delete-orphan", order_by="EvolutionEvent.occurred_at")
    business_context: Mapped["BusinessContextRow"] = relationship(back_populates="automation", uselist=False, cascade="all, delete-orphan")


class CanonicalDependencyRow(Base):
    """Workspace-scoped identity dictionary (Section: normalization layer).
    'SAP', 'SAP GUI', 'SAP Production' fold into one row here so the estate
    graph/shared-constraint/unlock logic reason about *real-world*
    dependencies, not raw parser strings. See estate/normalize.py."""

    __tablename__ = "canonical_dependencies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"))
    kind: Mapped[str] = mapped_column(String(20))  # SYSTEM | COMPONENT
    canonical_name: Mapped[str] = mapped_column(String(300))
    normalized_key: Mapped[str] = mapped_column(String(300))
    aliases: Mapped[list] = mapped_column(JSON, default=list)  # [{raw, confidence, user_confirmed}]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class EnvironmentEventRow(Base):
    """Longitudinal institutional memory: 'SAP API became available in
    2027-02'. Manually recorded by a human — never inferred, never
    auto-applied to any automation's stored assessment (Section:
    "Morphline should remember environmental changes... do NOT
    automatically upgrade them")."""

    __tablename__ = "environment_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"))
    canonical_dependency: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text)
    occurred_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recorded_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class BusinessContextRow(Base):
    """One row per Automation (Section 4/5) — persists across re-uploads,
    since enterprise risk facts describe the *process*, not any one
    uploaded package version. Updating this triggers a reassessment
    (Section 5/16) using the latest already-uploaded ProcessVersion."""

    __tablename__ = "business_contexts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    automation_id: Mapped[int] = mapped_column(ForeignKey("automations.id"), unique=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)  # serialized BusinessContext
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    automation: Mapped[Automation] = relationship(back_populates="business_context")


class ProcessVersion(Base):
    __tablename__ = "process_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    automation_id: Mapped[int] = mapped_column(ForeignKey("automations.id"))
    version_number: Mapped[int] = mapped_column(Integer)
    uploaded_filename: Mapped[str] = mapped_column(String(500))
    source_kind: Mapped[str] = mapped_column(String(50))
    process_model: Mapped[dict] = mapped_column(JSON)  # canonical ProcessModel, serialized
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    automation: Mapped[Automation] = relationship(back_populates="versions")
    assessments: Mapped[list["Assessment"]] = relationship(back_populates="process_version", cascade="all, delete-orphan")


class Assessment(Base):
    __tablename__ = "assessments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    process_version_id: Mapped[int] = mapped_column(ForeignKey("process_versions.id"))
    summary_score: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    process_version: Mapped[ProcessVersion] = relationship(back_populates="assessments")
    dimensions: Mapped[list["AssessmentDimension"]] = relationship(back_populates="assessment", cascade="all, delete-orphan")
    recommendation: Mapped["Recommendation"] = relationship(back_populates="assessment", uselist=False, cascade="all, delete-orphan")


class AssessmentDimension(Base):
    __tablename__ = "assessment_dimensions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id"))
    dimension: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(200))
    score: Mapped[int] = mapped_column(Integer)
    level: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[str] = mapped_column(String(20))
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    explanation: Mapped[str] = mapped_column(Text)

    assessment: Mapped[Assessment] = relationship(back_populates="dimensions")


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id"), unique=True)
    current_state: Mapped[str] = mapped_column(String(50))
    recommended_state: Mapped[str] = mapped_column(String(50))
    maximum_safe_state: Mapped[str] = mapped_column(String(50))
    next_possible_state: Mapped[str] = mapped_column(String(50))
    recommended_pattern: Mapped[str] = mapped_column(String(60), default="KEEP_DETERMINISTIC_RPA")
    confidence: Mapped[str] = mapped_column(String(20))
    why_this: Mapped[list] = mapped_column(JSON, default=list)
    why_not_further: Mapped[list] = mapped_column(JSON, default=list)  # [{reason_type, text}]
    top_reasons: Mapped[list] = mapped_column(JSON, default=list)
    top_blockers: Mapped[list] = mapped_column(JSON, default=list)
    missing_evidence: Mapped[list] = mapped_column(JSON, default=list)
    business_context_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)  # BusinessContext as of this assessment

    assessment: Mapped[Assessment] = relationship(back_populates="recommendation")


class Constraint(Base):
    __tablename__ = "constraints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    automation_id: Mapped[int] = mapped_column(ForeignKey("automations.id"))
    created_by_assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id"))
    category: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSON, default=list)  # [{type, source, confidence, description, reference}]
    severity: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    autonomy_cap: Mapped[str | None] = mapped_column(String(50), nullable=True)
    resolution_condition: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_assessment_id: Mapped[int | None] = mapped_column(ForeignKey("assessments.id"), nullable=True)
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    automation: Mapped[Automation] = relationship(back_populates="constraints")


class EvolutionEvent(Base):
    __tablename__ = "evolution_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    automation_id: Mapped[int] = mapped_column(ForeignKey("automations.id"))
    process_version_id: Mapped[int | None] = mapped_column(ForeignKey("process_versions.id"), nullable=True)
    assessment_id: Mapped[int | None] = mapped_column(ForeignKey("assessments.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(50))
    description: Mapped[str] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    automation: Mapped[Automation] = relationship(back_populates="events")


class MigrationRun(Base):
    __tablename__ = "migration_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id"))
    files: Mapped[dict] = mapped_column(JSON)  # {filename: content}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
