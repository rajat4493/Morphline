"""LLM provider abstraction (Section 18).

Deterministic parsing/scoring never depends on this module. It exists only
to produce narrative text (summaries, prose explanations) that is stored
separately from structured evidence/scores (D-006, Rule 7). The default
provider requires no API key and no network access, so the product fully
functions with zero LLM configuration.
"""
from __future__ import annotations

import os
from typing import Protocol

from packages.shared.canonical import ProcessModel
from packages.shared.recommendation_types import RecommendationResult
from packages.shared.scoring_types import DimensionScore


class LLMProvider(Protocol):
    def analyze_process_context(self, process: ProcessModel) -> str: ...
    def summarize_process(self, process: ProcessModel) -> str: ...
    def explain_recommendation(
        self, process: ProcessModel, scores: dict[str, DimensionScore], recommendation: RecommendationResult
    ) -> str: ...
    def suggest_target_architecture(self, process: ProcessModel, recommendation: RecommendationResult) -> str: ...


class NullLLMProvider:
    """Templated, non-LLM fallback. No network calls, never fails."""

    def analyze_process_context(self, process: ProcessModel) -> str:
        return (
            f"'{process.project_name}' spans {len(process.workflows)} workflow(s) and touches "
            f"{len(process.systems)} external system(s)."
        )

    def summarize_process(self, process: ProcessModel) -> str:
        steps = process.all_steps()
        entry = process.entry_point or "an unspecified entry point"
        systems = ", ".join(s.name for s in process.systems) or "no identified external systems"
        return (
            f"This automation starts at {entry} and executes {len(steps)} activities across "
            f"{len(process.workflows)} workflow(s), interacting with {systems}. "
            f"(Templated summary — configure an LLM provider for a richer narrative.)"
        )

    def explain_recommendation(
        self, process: ProcessModel, scores: dict[str, DimensionScore], recommendation: RecommendationResult
    ) -> str:
        return (
            f"Recommended state is {recommendation.recommended_state.label}. "
            + " ".join(recommendation.why_this)
        )

    def suggest_target_architecture(self, process: ProcessModel, recommendation: RecommendationResult) -> str:
        return (
            f"Target architecture for {process.project_name}: agent reasoning where judgment is "
            f"required, deterministic tools/APIs for execution, human approval for irreversible actions."
        )


def get_llm_provider() -> LLMProvider:
    provider_name = os.environ.get("LLM_PROVIDER", "null").lower()
    if provider_name == "null":
        return NullLLMProvider()
    if provider_name == "anthropic":
        from llm.anthropic_provider import AnthropicProvider  # local import: optional dependency

        return AnthropicProvider()
    raise ValueError(f"Unknown LLM_PROVIDER: {provider_name!r}")
