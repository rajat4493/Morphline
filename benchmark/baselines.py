"""Deliberately naive comparators. They stand in for the *approach* of
tools that equate AI presence or capability with readiness; they are not
claims about any specific vendor's product."""
from __future__ import annotations

from packages.shared.enums import EvolutionState as S, Level, MigrationPattern as P

_ORDER = {Level.LOW: 0, Level.MEDIUM: 1, Level.HIGH: 2}


def always_max(pm, scores):
    return S.HIGH_AUTONOMY, P.HIGH_AUTONOMY_AGENT


def always_rpa(pm, scores):
    return S.DETERMINISTIC_RPA, P.KEEP_DETERMINISTIC_RPA


def ai_presence(pm, scores):
    """'Already uses AI, so push further' — the conflation Morphline rejects."""
    lvl = scores["current_ai_usage"].level
    state = {Level.LOW: S.AUGMENTED_RPA, Level.MEDIUM: S.HYBRID_AGENT, Level.HIGH: S.ADVANCED_HYBRID}[lvl]
    return state, P.AGENT_WITH_API_TOOLS if state.rank >= 3 else P.RPA_WITH_AI_AUGMENTATION


BASELINES = {"always_max_autonomy": always_max, "always_deterministic": always_rpa, "ai_presence_heuristic": ai_presence}
