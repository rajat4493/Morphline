"""Types shared between scoring, recommendation, memory, migration and the API."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from packages.shared.enums import Confidence, EvidenceType, Level


class EvidenceItem(BaseModel):
    """One fact backing a dimension score. `type` says what *kind* of fact
    this is (parsed from the package, entered as business context, supplied
    runtime data, or a heuristic guess) — `confidence` says how certain that
    fact is. Keeping these orthogonal is what lets the UI show, e.g., "this
    HIGH compliance score rests on one INFERRED keyword match" instead of
    hiding that behind a single opaque score (Section 6/18)."""

    type: EvidenceType
    source: str
    confidence: Confidence
    description: str
    reference: Optional[str] = None

    def text(self) -> str:
        """Flat text rendering for contexts that can't show structure
        (migration pack markdown, log lines, older callers)."""
        return f"[{self.type.value}] {self.description}"


class DimensionScore(BaseModel):
    dimension: str
    label: str
    score: int  # 0-100 — a UI convenience, never the primary display (Section 19)
    level: Level
    confidence: Level  # how much evidence backs this score
    evidence: list[EvidenceItem] = Field(default_factory=list)
    explanation: str

    def evidence_by_type(self) -> dict[str, list[EvidenceItem]]:
        grouped: dict[str, list[EvidenceItem]] = {}
        for item in self.evidence:
            grouped.setdefault(item.type.value, []).append(item)
        return grouped


def level_from_score(score: int) -> Level:
    if score >= 70:
        return Level.HIGH
    if score >= 40:
        return Level.MEDIUM
    return Level.LOW
