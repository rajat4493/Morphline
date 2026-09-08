"""Assembles all twelve dimension scores for a ProcessModel."""
from __future__ import annotations

from packages.shared.canonical import ProcessModel
from packages.shared.enums import DIMENSIONS
from packages.shared.scoring_types import DimensionScore
from scoring.dimensions import DIMENSION_SCORERS


def score_process(pm: ProcessModel) -> dict[str, DimensionScore]:
    return {dim: DIMENSION_SCORERS[dim](pm) for dim in DIMENSIONS}


def summary_score(scores: dict[str, DimensionScore]) -> int:
    """A single weighted mean, shown as a UI convenience only.

    Never used by the recommendation engine, which reasons from individual
    dimensions (Section 9: "do not use a meaningless black-box score").
    """
    if not scores:
        return 0
    weights = {
        "reasoning_need": 1.0, "determinism_value": 0.5, "blast_radius": 1.0,
        "reversibility": 1.0, "compliance_sensitivity": 1.0, "observability": 0.75,
        "tool_readiness": 1.25, "data_readiness": 0.75, "human_approval_need": 0.5,
        "exception_complexity": 0.75, "dependency_complexity": 0.75, "runtime_stability": 0.5,
    }
    total_w = sum(weights.get(d, 1.0) for d in scores)
    total = sum(s.score * weights.get(d, 1.0) for d, s in scores.items())
    return int(total / total_w) if total_w else 0
