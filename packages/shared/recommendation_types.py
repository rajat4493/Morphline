from __future__ import annotations

from pydantic import BaseModel, Field

from packages.shared.enums import ConstraintCategory, ConstraintSeverity, EvolutionState, Level


class ConstraintDraft(BaseModel):
    """A blocker produced by the recommendation engine, not yet persisted."""

    category: ConstraintCategory
    description: str
    evidence: list[str] = Field(default_factory=list)
    severity: ConstraintSeverity


class RecommendationResult(BaseModel):
    current_state: EvolutionState
    recommended_state: EvolutionState
    maximum_safe_state: EvolutionState
    next_possible_state: EvolutionState
    confidence: Level
    why_this: list[str] = Field(default_factory=list)
    why_not_further: list[str] = Field(default_factory=list)
    top_reasons: list[str] = Field(default_factory=list)
    top_blockers: list[str] = Field(default_factory=list)
    constraints: list[ConstraintDraft] = Field(default_factory=list)
