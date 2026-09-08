"""Types shared between scoring, recommendation, memory, migration and the API."""
from __future__ import annotations

from pydantic import BaseModel, Field

from packages.shared.enums import Level


class DimensionScore(BaseModel):
    dimension: str
    label: str
    score: int  # 0-100
    level: Level
    confidence: Level  # how much evidence backs this score
    evidence: list[str] = Field(default_factory=list)
    explanation: str


def level_from_score(score: int) -> Level:
    if score >= 70:
        return Level.HIGH
    if score >= 40:
        return Level.MEDIUM
    return Level.LOW
