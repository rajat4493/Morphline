from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from packages.shared.enums import (
    ConstraintCategory,
    ConstraintSeverity,
    EvolutionState,
    Level,
    MigrationPattern,
    WhyNotReasonType,
)
from packages.shared.scoring_types import EvidenceItem


class ConstraintDraft(BaseModel):
    """A blocker produced by the recommendation engine, not yet persisted."""

    category: ConstraintCategory
    description: str
    evidence: list[EvidenceItem] = Field(default_factory=list)
    severity: ConstraintSeverity
    # The evolution state this constraint caps the ceiling at — lets
    # constraint memory explain *what* it's blocking, not just *that*
    # something is blocked (Section 15).
    autonomy_cap: Optional[EvolutionState] = None
    # What would need to become true for this to resolve — shown to an
    # architect a year later (Section 15 / TheDuck Q8).
    resolution_condition: Optional[str] = None


class WhyNotReason(BaseModel):
    """One entry in "Why Not Further," explicitly typed so the product never
    conflates a confirmed risk with an unconfirmed fact with "there's simply
    no upside to more autonomy here" (Section 14)."""

    reason_type: WhyNotReasonType
    text: str


class RecommendationResult(BaseModel):
    current_state: EvolutionState
    recommended_state: EvolutionState
    maximum_safe_state: EvolutionState
    next_possible_state: EvolutionState
    recommended_pattern: MigrationPattern
    confidence: Level
    why_this: list[str] = Field(default_factory=list)
    why_not_further: list[WhyNotReason] = Field(default_factory=list)
    top_reasons: list[str] = Field(default_factory=list)
    top_blockers: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    constraints: list[ConstraintDraft] = Field(default_factory=list)
