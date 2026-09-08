"""What-if simulation engine (Section: "add a lightweight what-if engine...
never mutate real stored constraints... never mark a constraint resolved
because the user simulated it").

Every override here is applied to a **deep copy** of the process model and
business context, then run back through the real, unmodified
`scoring.engine.score_process` / `recommendation.engine.recommend`. This is
deliberate: a simulation is only trustworthy if it exercises the exact same
logic a real assessment does, not a parallel "simulated scoring" shortcut.
Nothing here writes to a database — see `apps/api/app/routers/estate.py`
for the API boundary that guarantees isolation.
"""
from __future__ import annotations

from typing import NamedTuple

from packages.shared.business_context import BusinessContext
from packages.shared.canonical import ApiCall, Argument, ProcessModel
from packages.shared.enums import Confidence, EvidenceType, EvolutionState, Level, NodeCategory, TriState
from packages.shared.estate_types import SimulationAssumption, SimulationOverride, SimulationResult, SimulationScenario, StateChange
from packages.shared.recommendation_types import RecommendationResult
from packages.shared.scoring_types import DimensionScore, EvidenceItem
from estate.normalize import normalize_component_key, normalize_system_key
from parser.uipath.parse import guess_system_from_selector
from recommendation.engine import recommend
from scoring.engine import score_process

_OBSERVABILITY_MARKER = "__OBSERVABILITY_OVERRIDE__"
_FULL_EQUIVALENCE_MARKER = "__FULL_API_EQUIVALENCE__"

# Coarse, explicitly-labeled heuristic for classifying what a UI step
# *does* — not a real capability-discovery mechanism. Used only to decide
# whether a simulated "API becomes available" override should touch a given
# step when the caller has told us which capabilities (READ/WRITE) are
# actually confirmed available; when the caller gives no capability list at
# all, every touched step is converted regardless of this classification,
# but the result is explicitly labeled a "full API-equivalence assumption"
# (see `_apply_override` below) rather than presented as an informed
# estimate — a review caught that treating "API becomes available" as
# "assume a perfect API exists for every UI operation" was silently
# optimistic and could overstate estate-wide unlock counts.
_WRITE_KEYWORDS = (
    "post", "submit", "save", "update", "create", "delete", "remove",
    "approve", "reject", "send", "pay", "confirm", "type", "write",
    "upload", "set ", "exclude", "cancel", "edit", "modify",
)
_READ_KEYWORDS = (
    "search", "read", "view", "open", "get ", "select", "lookup", "find",
    "check", "review", "list", "export", "download",
)


def _infer_step_operation(step) -> str:
    """'READ' or 'WRITE' — an explicit, coarse heuristic over display name
    and activity type, not a claim of ground truth. Ambiguous/unmatched
    steps default to WRITE (the conservative direction: never silently
    treat an unclassified action as safely read-only)."""
    text = f"{step.display_name} {step.activity_type}".lower()
    if any(k in text for k in _WRITE_KEYWORDS):
        return "WRITE"
    if any(k in text for k in _READ_KEYWORDS):
        return "READ"
    return "WRITE"


class SimInput(NamedTuple):
    """One automation's real, unmutated state going into a simulation."""

    automation_id: int
    name: str
    process_model: ProcessModel
    business_context: BusinessContext
    current_recommendation: RecommendationResult


def _apply_override(pm: ProcessModel, biz: BusinessContext, override: SimulationOverride) -> tuple[ProcessModel, BusinessContext, list[str]]:
    pm = pm.model_copy(deep=True)
    biz = biz.model_copy(deep=True)
    notes: list[str] = []
    a = override.assumption

    if a in (SimulationAssumption.API_AVAILABLE, SimulationAssumption.DEPENDENCY_STABILIZED):
        target_key = normalize_system_key(override.canonical_dependency) if override.canonical_dependency else None
        allowed_ops = set(override.capabilities) if override.capabilities else None
        changed = 0
        skipped_uncovered = 0
        for wf in pm.workflows:
            for step in wf.steps:
                if step.selector is None:
                    continue
                guessed = guess_system_from_selector(step.selector.raw) or "Unidentified UI Application"
                if target_key is not None and normalize_system_key(guessed) != target_key:
                    continue
                op = _infer_step_operation(step)
                if allowed_ops is not None and op not in allowed_ops:
                    skipped_uncovered += 1
                    continue
                step.selector = None
                step.category = NodeCategory.API_TOOL
                step.api = ApiCall(
                    label=step.display_name, method="GET" if op == "READ" else "POST",
                    endpoint_hint=f"[SIMULATED] {override.canonical_dependency or guessed} API", workflow=wf.file,
                )
                changed += 1

        dep_label = override.canonical_dependency or "the target system"
        if allowed_ops is None:
            notes.append(
                f"Simulated {changed} UI-automation step(s) against {dep_label} becoming API calls "
                "[FULL API-EQUIVALENCE ASSUMPTION — no confirmed capability coverage was supplied; "
                "treat this result as an upper bound, not an estimate]"
            )
            notes.append(_FULL_EQUIVALENCE_MARKER)
        else:
            notes.append(
                f"Simulated {changed} UI-automation step(s) against {dep_label} becoming API calls "
                f"(confirmed capability coverage: {', '.join(sorted(allowed_ops))})"
            )
            if skipped_uncovered:
                notes.append(
                    f"{skipped_uncovered} UI-automation step(s) against {dep_label} left unresolved — "
                    f"no confirmed API capability covers them"
                )

    elif a == SimulationAssumption.REUSABLE_TOOL_AVAILABLE:
        target_key = normalize_component_key(override.canonical_dependency) if override.canonical_dependency else None
        touched = []
        for wf in pm.workflows:
            key = normalize_component_key(wf.file)
            if (target_key is None or key == target_key) and not wf.arguments:
                wf.arguments.append(Argument(name="simulated_bound_argument", direction="In"))
                touched.append(wf.file)
        if touched:
            notes.append(f"Simulated {', '.join(touched)} gaining declared arguments (bounded, reusable tool)")

    elif a == SimulationAssumption.ROLLBACK_ADDED:
        biz.irreversible_action = TriState.NO
        notes.append("Simulated: irreversible_action -> NO")

    elif a == SimulationAssumption.APPROVAL_ADDED:
        biz.mandatory_approval = TriState.YES
        biz.human_accountability_required = TriState.YES
        notes.append("Simulated: mandatory_approval -> YES")

    elif a == SimulationAssumption.COMPLIANCE_CLEARED:
        biz.regulated_process = TriState.NO
        notes.append("Simulated: regulated_process -> NO")

    elif a == SimulationAssumption.BUSINESS_CONTEXT_SUPPLIED:
        if override.business_context_patch:
            # Reconstruct (not setattr) so string values like "LOW" are
            # validated/coerced into their real enum types, same as any
            # other BusinessContext input (pydantic does not coerce on
            # plain attribute assignment).
            merged = {**biz.model_dump(), **override.business_context_patch}
            biz = BusinessContext(**merged)
            notes.append(f"Simulated Business Context supplied: {', '.join(override.business_context_patch.keys())}")

    elif a == SimulationAssumption.OBSERVABILITY_ADDED:
        notes.append(_OBSERVABILITY_MARKER)

    return pm, biz, notes


def simulate_automation(
    pm: ProcessModel, biz: BusinessContext, overrides: list[SimulationOverride]
) -> tuple[RecommendationResult, dict[str, DimensionScore], list[str], bool]:
    """Returns (recommendation, scores, notes, used_full_api_equivalence).
    The last element is True if any override in this scenario simulated
    "API available" without a confirmed capability list — callers must
    treat that result as an unverified upper bound, not a point estimate
    (see `run_simulation`, which folds this into `unresolved_factors` so
    unlock-analysis confidence is never HIGH/MEDIUM on an unlabeled
    full-equivalence assumption)."""
    all_notes: list[str] = []
    observability_override = False
    full_equivalence_used = False
    for ov in overrides:
        pm, biz, notes = _apply_override(pm, biz, ov)
        if _OBSERVABILITY_MARKER in notes:
            observability_override = True
            notes = [n for n in notes if n != _OBSERVABILITY_MARKER]
        if _FULL_EQUIVALENCE_MARKER in notes:
            full_equivalence_used = True
            notes = [n for n in notes if n != _FULL_EQUIVALENCE_MARKER]
        all_notes.extend(notes)

    scores = score_process(pm, biz)
    if observability_override:
        scores = dict(scores)
        scores["observability"] = DimensionScore(
            dimension="observability", label="Observability", score=90, level=Level.HIGH, confidence=Level.MEDIUM,
            evidence=[EvidenceItem(type=EvidenceType.INFERRED, source="simulation", confidence=Confidence.INFERRED,
                                    description="[SIMULATED] Observability assumed added by this scenario")],
            explanation="Simulated: adequate logging/alerting assumed to be added.",
        )
        all_notes.append("Simulated: observability -> HIGH")

    rec = recommend(pm, scores, biz)
    return rec, scores, all_notes, full_equivalence_used


def run_simulation(scenario: SimulationScenario, inputs: list[SimInput]) -> SimulationResult:
    targets = inputs if scenario.automation_ids is None else [i for i in inputs if i.automation_id in scenario.automation_ids]

    results: list[StateChange] = []
    assumptions: list[str] = []
    unresolved: list[str] = []

    for sim_input in targets:
        rec, _scores, notes, full_equivalence_used = simulate_automation(
            sim_input.process_model, sim_input.business_context, scenario.overrides
        )
        assumptions.extend(n for n in notes if n not in assumptions)

        before = sim_input.current_recommendation
        changed = rec.recommended_state != before.recommended_state or rec.recommended_pattern != before.recommended_pattern
        results.append(StateChange(
            automation_id=sim_input.automation_id, automation_name=sim_input.name,
            current_state=before.recommended_state, simulated_state=rec.recommended_state,
            current_pattern=before.recommended_pattern, simulated_pattern=rec.recommended_pattern,
            changed=changed, remaining_blockers=rec.why_not_further,
        ))
        if rec.missing_evidence:
            for m in rec.missing_evidence:
                note = f"{sim_input.name}: {m}"
                if note not in unresolved:
                    unresolved.append(note)
        if full_equivalence_used:
            note = (
                f"{sim_input.name}: this result relies on a full API-equivalence assumption with no "
                "confirmed capability coverage — treat as an upper bound, not a point estimate"
            )
            if note not in unresolved:
                unresolved.append(note)

    unlock_count = sum(1 for r in results if r.changed and _rank(r.simulated_state) > _rank(r.current_state))
    unchanged_count = sum(1 for r in results if not r.changed)

    return SimulationResult(
        scenario=scenario, results=results, unlock_count=unlock_count, unchanged_count=unchanged_count,
        assumptions=assumptions, unresolved_factors=unresolved, is_simulation=True,
    )


def _rank(state: EvolutionState) -> int:
    return state.rank
