"""Helpers for building human-readable Evolution Timeline entries (Section 13).

Persistence of `EvolutionEvent` rows happens in the API layer (it's a plain
DB table); this module only decides what text an event should carry so the
wording is consistent between the upload path and the reassessment path.
"""
from __future__ import annotations

from packages.shared.memory_types import ReassessmentDiff
from packages.shared.recommendation_types import RecommendationResult


def initial_assessment_event(rec: RecommendationResult) -> str:
    blockers = "; ".join(rec.top_blockers) if rec.top_blockers else "no active blockers"
    return (
        f"Initial assessment: current state {rec.current_state.label}, "
        f"recommended {rec.recommended_state.label} ({rec.recommended_pattern.label}). "
        f"Blocked from {rec.next_possible_state.label}: {blockers}."
    )


def reassessment_event(rec: RecommendationResult, diff: ReassessmentDiff) -> str:
    if diff.higher_level_possible:
        base = f"Reassessment: moved to {rec.recommended_state.label}. " + "; ".join(diff.what_resolved or ["evidence improved"])
    elif diff.new_risks:
        base = f"Reassessment: still at {rec.recommended_state.label}. New risk(s): " + "; ".join(diff.new_risks)
    else:
        base = f"Reassessment: no change. Still {rec.recommended_state.label}."
    if diff.migration_pattern_changed:
        base += f" Migration Pattern updated to {rec.recommended_pattern.label}."
    if diff.business_context_changes:
        base += " Business Context changed: " + "; ".join(diff.business_context_changes)
    return base
