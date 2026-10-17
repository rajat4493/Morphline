"""Expert-labeled benchmark corpus.

Labels are written from the *process semantics* (see each fixture's
project.json description), never copied from Morphline's output. Each label
says which recommended states are acceptable and the hard safety ceiling —
the highest state a careful enterprise reviewer would sign off on with NO
Business Context supplied (absence of evidence is not evidence of safety).

IMPORTANT: labels are authored by the product team on synthetic fixtures and
must be re-validated by external automation experts on real exports before
any public claim is made. See benchmark/README.md.
"""
from __future__ import annotations

from typing import NamedTuple

from packages.shared.enums import EvolutionState as S, MigrationPattern as P


class Label(NamedTuple):
    fixture: str
    acceptable: frozenset  # states a reviewer would accept as the recommendation
    safety_ceiling: S      # recommending above this is an unsafe over-reach
    patterns: frozenset    # acceptable migration patterns
    rationale: str


CORPUS: list[Label] = [
    Label("ai_overreach", frozenset({S.DETERMINISTIC_RPA, S.AUGMENTED_RPA}), S.AUGMENTED_RPA,
          frozenset({P.KEEP_DETERMINISTIC_RPA, P.RPA_WITH_AI_AUGMENTATION}),
          "Mechanical date formatting implemented via an AI activity; no real judgment, so existing AI usage must not drive autonomy up."),
    Label("customer_exclusion", frozenset({S.AUGMENTED_RPA, S.HYBRID_AGENT}), S.HYBRID_AGENT,
          frozenset({P.HYBRID_WITH_HUMAN_APPROVAL, P.DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION}),
          "Customer-impacting decision; agent only with human approval."),
    Label("internal_report", frozenset({S.AUGMENTED_RPA, S.HYBRID_AGENT, S.ADVANCED_HYBRID}), S.HIGH_AUTONOMY,
          frozenset({P.AGENT_WITH_API_TOOLS, P.RPA_WITH_AI_AUGMENTATION, P.DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION}),
          "Read-only internal reporting over APIs; low blast radius, wide latitude."),
    Label("invoice_processing", frozenset({S.AUGMENTED_RPA, S.HYBRID_AGENT}), S.HYBRID_AGENT,
          frozenset({P.RPA_WITH_AI_AUGMENTATION, P.HYBRID_WITH_HUMAN_APPROVAL, P.DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION}),
          "Unstructured document extraction plus financial posting; augmentation with approval."),
    Label("loan_exception_review", frozenset({S.AUGMENTED_RPA, S.HYBRID_AGENT}), S.HYBRID_AGENT,
          frozenset({P.RPA_WITH_AI_AUGMENTATION, P.HYBRID_WITH_HUMAN_APPROVAL, P.DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION}),
          "Large judgment-heavy decision tree in a regulated credit context; high reasoning opportunity but human-gated."),
    Label("nightly_reconciliation", frozenset({S.DETERMINISTIC_RPA, S.AUGMENTED_RPA}), S.HYBRID_AGENT,
          frozenset({P.KEEP_DETERMINISTIC_RPA, P.RPA_WITH_AI_AUGMENTATION}),
          "Pure deterministic reconciliation; should stay deterministic or lightly augmented."),
    Label("real_world_invoice_processing", frozenset({S.AUGMENTED_RPA, S.HYBRID_AGENT}), S.HYBRID_AGENT,
          frozenset({P.RPA_WITH_AI_AUGMENTATION, P.HYBRID_WITH_HUMAN_APPROVAL, P.DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION}),
          "Multi-workflow invoice flow with financial posting."),
    Label("ui_heavy_reusable_tools", frozenset({S.AUGMENTED_RPA, S.HYBRID_AGENT}), S.HYBRID_AGENT,
          frozenset({P.AGENT_ORCHESTRATED_RPA_TOOLS, P.HYBRID_WITH_HUMAN_APPROVAL}),
          "Reusable UI-driven subprocesses are viable agent tools."),
    Label("unknown_context_mutator", frozenset({S.DETERMINISTIC_RPA, S.AUGMENTED_RPA, S.HYBRID_AGENT}), S.HYBRID_AGENT,
          frozenset({P.KEEP_DETERMINISTIC_RPA, P.RPA_WITH_AI_AUGMENTATION, P.HYBRID_WITH_HUMAN_APPROVAL, P.DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION}),
          "Mutates production state with unknown business context: must be capped below Advanced Hybrid."),
]
