"""Assembles all dimension scores for a ProcessModel (+ optional BusinessContext)."""
from __future__ import annotations

from typing import Optional

from packages.shared.business_context import BusinessContext
from packages.shared.canonical import ProcessModel
from packages.shared.enums import DESCRIPTIVE_ONLY_DIMENSIONS, DIMENSIONS
from packages.shared.scoring_types import DimensionScore
from scoring.dimensions import DIMENSION_SCORERS


def score_process(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> dict[str, DimensionScore]:
    return {dim: DIMENSION_SCORERS[dim](pm, biz) for dim in DIMENSIONS}


def summary_score(scores: dict[str, DimensionScore]) -> int:
    """A single weighted mean, shown as a UI convenience only.

    Never used by the recommendation engine, which reasons from individual
    dimensions (Section 9: "do not use a meaningless black-box score").
    `current_ai_usage` is descriptive-only (Section 3) and excluded here too
    — it should not inflate or deflate a summary meant to represent
    evolution readiness.
    """
    weights = {
        "reasoning_opportunity": 1.25, "determinism_value": 0.5, "blast_radius": 1.0,
        "reversibility": 1.0, "compliance_sensitivity": 1.0, "observability": 0.75,
        "execution_tool_readiness": 1.25, "data_readiness": 0.75, "human_approval_need": 0.5,
        "exception_complexity": 0.75, "dependency_complexity": 0.75, "runtime_stability": 0.5,
    }
    relevant = {d: s for d, s in scores.items() if d not in DESCRIPTIVE_ONLY_DIMENSIONS}
    if not relevant:
        return 0
    total_w = sum(weights.get(d, 1.0) for d in relevant)
    total = sum(s.score * weights.get(d, 1.0) for d, s in relevant.items())
    return int(total / total_w) if total_w else 0
