from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from packages.shared.business_context import BusinessContext
from packages.shared.enums import ConstraintCategory, ConstraintSeverity, ConstraintStatus, EvolutionState, MigrationPattern
from packages.shared.recommendation_types import RecommendationResult
from packages.shared.scoring_types import DimensionScore, EvidenceItem


class ConstraintRecord(BaseModel):
    id: Optional[int] = None
    category: ConstraintCategory
    description: str
    evidence: list[EvidenceItem] = Field(default_factory=list)
    severity: ConstraintSeverity
    status: ConstraintStatus = ConstraintStatus.ACTIVE
    source: Optional[str] = None
    autonomy_cap: Optional[EvolutionState] = None
    resolution_condition: Optional[str] = None
    owner: Optional[str] = None
    confidence: Optional[str] = None
    created_at: Optional[datetime] = None
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None
    # Carried through from ConstraintDraft.dependency_hint — see there for
    # why estate logic must prefer this over re-deriving attribution from
    # the whole process model.
    dependency_hint: list[str] = Field(default_factory=list)


class AssessmentSnapshot(BaseModel):
    """A minimal view of one assessment used for diffing across reassessments."""

    assessment_id: Optional[int] = None
    dimensions: dict[str, DimensionScore]
    recommendation: RecommendationResult
    business_context: Optional[BusinessContext] = None
    active_constraints: list[ConstraintRecord] = Field(default_factory=list)


class ReassessmentDiff(BaseModel):
    what_changed: list[str] = Field(default_factory=list)
    what_resolved: list[str] = Field(default_factory=list)
    new_risks: list[str] = Field(default_factory=list)
    business_context_changes: list[str] = Field(default_factory=list)
    evolution_state_changed: bool = False
    migration_pattern_changed: bool = False
    higher_level_possible: bool = False
    why: list[str] = Field(default_factory=list)
