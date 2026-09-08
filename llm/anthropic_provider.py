"""Optional Anthropic-backed narrative provider.

Only imported when LLM_PROVIDER=anthropic. Requires the `anthropic` package
and ANTHROPIC_API_KEY. Never receives raw credentials/secrets from the
process model (SECURITY.md) — only structured, already-redacted summaries.
"""
from __future__ import annotations

import os

from packages.shared.canonical import ProcessModel
from packages.shared.recommendation_types import RecommendationResult
from packages.shared.scoring_types import DimensionScore


class AnthropicProvider:
    def __init__(self) -> None:
        import anthropic  # noqa: F401 — raise ImportError early with a clear message if missing

        self._client_cls = anthropic.Anthropic
        self._model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")

    def _complete(self, prompt: str) -> str:
        client = self._client_cls()
        response = client.messages.create(
            model=self._model,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(block.text for block in response.content if hasattr(block, "text"))

    def analyze_process_context(self, process: ProcessModel) -> str:
        return self._complete(f"In two sentences, describe the business context of this automation: {process.project_name}, workflows: {[w.file for w in process.workflows]}")

    def summarize_process(self, process: ProcessModel) -> str:
        steps = [s.display_name for s in process.all_steps()]
        return self._complete(f"Summarize this RPA process in plain English for a non-technical executive. Steps: {steps}")

    def explain_recommendation(
        self, process: ProcessModel, scores: dict[str, DimensionScore], recommendation: RecommendationResult
    ) -> str:
        return self._complete(
            f"Explain in plain English why the recommended evolution state is "
            f"{recommendation.recommended_state.label} given: {recommendation.why_this}"
        )

    def suggest_target_architecture(self, process: ProcessModel, recommendation: RecommendationResult) -> str:
        return self._complete(
            f"Suggest a target architecture narrative for {process.project_name} moving toward "
            f"{recommendation.recommended_state.label}."
        )
