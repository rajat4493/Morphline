from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from packages.shared.enums import ConstraintCategory, ConstraintSeverity, ConstraintStatus
from packages.shared.recommendation_types import RecommendationResult
from packages.shared.scoring_types import DimensionScore


class ConstraintRecord(BaseModel):
    id: Optional[int] = None
    category: ConstraintCategory
    description: str
    evidence: list[str] = Field(default_factory=list)
    severity: ConstraintSeverity
    status: ConstraintStatus = ConstraintStatus.ACTIVE
    created_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None


class AssessmentSnapshot(BaseModel):
    """A minimal view of one assessment used for diffing across reassessments."""

    assessment_id: Optional[int] = None
    dimensions: dict[str, DimensionScore]
    recommendation: RecommendationResult
    active_constraints: list[ConstraintRecord] = Field(default_factory=list)


class ReassessmentDiff(BaseModel):
    what_changed: list[str] = Field(default_factory=list)
    what_resolved: list[str] = Field(default_factory=list)
    new_risks: list[str] = Field(default_factory=list)
    higher_level_possible: bool = False
    why: list[str] = Field(default_factory=list)
