"""Target architecture generation (Phase 3: Enterprise Transformation
Architecture). Pure function over the outputs the existing engines already
produce (`ProcessModel`, `DimensionScore`s, `RecommendationResult`,
`BusinessContext`) plus a workspace's real platform catalog — no DB access
here, matching `scoring/`, `recommendation/`, and `estate/`.

TheDuck rule this module exists to enforce: **never recommend a platform
because it merely exists in the customer's stack.** Every role this
automation actually needs is determined first, from evidence already
computed elsewhere (recommended pattern, constraints, dimension scores) —
then, and only then, is a catalog platform matched to that role. When more
than one catalog platform could fill a role and nothing distinguishes them,
this module refuses to guess (`manual_decision_required=True`) rather than
picking one arbitrarily just because it's registered.
"""
from __future__ import annotations

from typing import Optional

from packages.shared.architecture_types import (
    EstateArchitectureSummary,
    Guardrail,
    GuardrailType,
    MigrationStep,
    MigrationStepStatus,
    PlatformProfile,
    PlatformRole,
    TargetArchitectureComponent,
    TargetArchitecturePlan,
)
from packages.shared.business_context import BusinessContext
from packages.shared.canonical import ProcessModel
from packages.shared.enums import ConstraintCategory, EvolutionState, Level, MigrationPattern, TriState
from packages.shared.recommendation_types import RecommendationResult
from packages.shared.scoring_types import DimensionScore
from scoring.dimensions import ExecutionSurfaceProfile

_AGENTIC_PATTERNS = {
    MigrationPattern.DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION,
    MigrationPattern.AGENT_ORCHESTRATED_RPA_TOOLS,
    MigrationPattern.AGENT_WITH_API_TOOLS,
    MigrationPattern.HYBRID_WITH_HUMAN_APPROVAL,
    MigrationPattern.HIGH_AUTONOMY_AGENT,
}


class _RoleNeed:
    def __init__(self, needed: bool, reason: str) -> None:
        self.needed = needed
        self.reason = reason


def _determine_role_needs(
    pm: ProcessModel, scores: dict[str, DimensionScore], rec: RecommendationResult, biz: BusinessContext, profile: ExecutionSurfaceProfile,
) -> dict[PlatformRole, _RoleNeed]:
    pattern = rec.recommended_pattern
    constraint_categories = {c.category for c in rec.constraints}

    needs_reasoning = pattern in _AGENTIC_PATTERNS
    reasoning_reason = (
        f"Recommended migration pattern is {pattern.value}, which requires interpreting ambiguous cases rather than following a fixed script."
        if needs_reasoning else "Recommended pattern is fully deterministic — no reasoning component is justified."
    )

    has_ui_surface = bool(profile.stable_ui_steps or profile.brittle_ui_steps)
    needs_bounded_execution = has_ui_surface or pattern == MigrationPattern.AGENT_ORCHESTRATED_RPA_TOOLS
    bounded_reason = (
        "Existing UI-automation execution surface is present and, per product principle, remains a valid bounded tool rather than being rewritten."
        if needs_bounded_execution else "No UI-automation execution surface exists in this process."
    )

    needs_orchestration = rec.recommended_state.rank > EvolutionState.DETERMINISTIC_RPA.rank
    orchestration_reason = (
        f"Recommended state {rec.recommended_state.value} coordinates more than one execution surface/component."
        if needs_orchestration else "Recommended state is plain deterministic RPA — a single execution surface, no orchestration layer needed."
    )

    needs_approval = pattern == MigrationPattern.HYBRID_WITH_HUMAN_APPROVAL or biz.mandatory_approval == TriState.YES
    approval_reason = (
        "Mandatory human approval is required (recommended pattern or confirmed Business Context)."
        if needs_approval else "No mandatory human approval requirement was found."
    )

    needs_api = any(s.interaction_mode == "api" for s in pm.systems) or bool(pm.apis)
    api_reason = (
        "This process already integrates with at least one system via a real API."
        if needs_api else "No confirmed API integration exists in this process today."
    )

    needs_database = any(s.interaction_mode == "database" for s in pm.systems)
    db_reason = (
        "This process reads/writes a database directly."
        if needs_database else "No direct database dependency was found."
    )

    needs_queue = bool(pm.queues)
    queue_reason = (
        "This process uses a queue for work distribution."
        if needs_queue else "No queue dependency was found."
    )

    needs_observability = (
        needs_orchestration
        or scores.get("observability", None) is not None and scores["observability"].level == Level.LOW
        or ConstraintCategory.WEAK_OBSERVABILITY in constraint_categories
    )
    observability_reason = (
        "Introducing any non-deterministic or multi-component execution requires a mandatory audit trail."
        if needs_observability else "Process remains simple enough that existing logging is not flagged as a gap."
    )

    return {
        PlatformRole.REASONING: _RoleNeed(needs_reasoning, reasoning_reason),
        PlatformRole.AGENT_RUNTIME: _RoleNeed(needs_reasoning, "An agent runtime/tool boundary is required whenever a reasoning component is introduced." if needs_reasoning else "No reasoning component is needed, so no agent runtime/tool boundary is required."),
        PlatformRole.ORCHESTRATION: _RoleNeed(needs_orchestration, orchestration_reason),
        PlatformRole.BOUNDED_EXECUTION: _RoleNeed(needs_bounded_execution, bounded_reason),
        PlatformRole.HUMAN_APPROVAL: _RoleNeed(needs_approval, approval_reason),
        PlatformRole.API_GATEWAY: _RoleNeed(needs_api, api_reason),
        PlatformRole.DATABASE: _RoleNeed(needs_database, db_reason),
        PlatformRole.QUEUE: _RoleNeed(needs_queue, queue_reason),
        PlatformRole.OBSERVABILITY: _RoleNeed(needs_observability, observability_reason),
    }


def _select_component(role: PlatformRole, need: _RoleNeed, catalog: list[PlatformProfile]) -> Optional[TargetArchitectureComponent]:
    if not need.needed:
        return None

    candidates = [p for p in catalog if p.role == role]
    if not candidates:
        return TargetArchitectureComponent(
            role=role, platform=None, manual_decision_required=True, candidates=[],
            justification=f"{need.reason} No platform is registered for this role in the estate catalog — this is a gap, not a recommendation.",
        )
    if len(candidates) == 1:
        return TargetArchitectureComponent(
            role=role, platform=candidates[0].name,
            justification=f"{need.reason} {candidates[0].name} is the only catalog platform registered for this role.",
            rejected_alternatives=[],
        )
    return TargetArchitectureComponent(
        role=role, platform=None, manual_decision_required=True,
        candidates=[c.name for c in candidates],
        justification=(
            f"{need.reason} Multiple platforms are registered for this role "
            f"({', '.join(c.name for c in candidates)}) and no automation-specific evidence "
            "distinguishes them — flagged for a human decision rather than guessed."
        ),
        rejected_alternatives=[{"platform": c.name, "reason": "ambiguous — not automatically distinguishable from the other candidate(s)"} for c in candidates],
    )


def _migration_sequence(
    rec: RecommendationResult, components: list[TargetArchitectureComponent], profile: ExecutionSurfaceProfile,
) -> list[MigrationStep]:
    by_role = {c.role: c for c in components}
    needs_reasoning = PlatformRole.REASONING in by_role
    needs_approval = PlatformRole.HUMAN_APPROVAL in by_role
    needs_observability = PlatformRole.OBSERVABILITY in by_role
    state_changes = rec.recommended_state.rank > rec.current_state.rank

    template: list[tuple[str, str, bool, bool]] = [
        (
            "Preserve current deterministic execution",
            "Keep the existing deterministic workflow running unchanged as the fallback path while the target architecture is built alongside it.",
            True, True,
        ),
        (
            "Isolate the business-decision step",
            "Identify and isolate the specific point(s) in the workflow where judgment — not fixed rules — actually drives the outcome.",
            needs_reasoning, needs_reasoning,
        ),
        (
            "Wrap existing execution as bounded tools",
            (
                "Existing bounded, argument-bound subprocesses are already usable as tools as-is."
                if profile.bounded_subprocess_files else
                "Wrap existing UI-automation steps in a reusable, argument-bound subprocess so they can be safely invoked as a bounded tool."
            ),
            PlatformRole.BOUNDED_EXECUTION in by_role,
            bool(profile.bounded_subprocess_files),
        ),
        (
            "Introduce reasoning only at ambiguity points",
            "Route only the isolated decision step(s) through the reasoning component; everything else stays deterministic.",
            needs_reasoning, False,
        ),
        (
            "Add human approval before high-impact actions",
            "Require explicit human sign-off before any action this process takes that mutates production state or has customer/financial/legal impact.",
            needs_approval, False,
        ),
        (
            "Add observability and rollback",
            "Add logging/tracing sufficient to detect an incorrect decision quickly, and a compensating action for anything that can't be trivially undone.",
            needs_observability, False,
        ),
        (
            "Shadow-run against current execution",
            "Run the target architecture in parallel with the existing deterministic process without letting it take real actions.",
            state_changes, False,
        ),
        (
            "Compare outcomes",
            "Compare the shadow run's decisions against the existing process's actual outcomes before trusting it with real actions.",
            state_changes, False,
        ),
        (
            "Gradually shift execution",
            "Move execution over incrementally (e.g. by case type or business unit), keeping the deterministic path as an immediate fallback.",
            state_changes, False,
        ),
    ]

    steps: list[MigrationStep] = []
    order = 1
    for title, description, included, already_true in template:
        if not included:
            continue
        steps.append(MigrationStep(
            order=order, title=title, description=description,
            status=MigrationStepStatus.ALREADY_TRUE if already_true else MigrationStepStatus.REQUIRED,
        ))
        order += 1
    return steps


def _guardrails(rec: RecommendationResult, scores: dict[str, DimensionScore], components: list[TargetArchitectureComponent]) -> list[Guardrail]:
    by_role = {c.role for c in components}
    constraint_categories = {c.category for c in rec.constraints}
    guardrails: list[Guardrail] = []

    if PlatformRole.REASONING in by_role:
        guardrails.append(Guardrail(type=GuardrailType.TOOL_ALLOWLIST, reason="A reasoning component is being introduced — it may only invoke an explicitly allowed set of tools."))
        guardrails.append(Guardrail(type=GuardrailType.NO_DIRECT_MODEL_CREDENTIALS, reason="A reasoning component is being introduced — it must never hold direct credentials to downstream systems."))

    blast_high = scores.get("blast_radius") is not None and scores["blast_radius"].level == Level.HIGH
    if blast_high or ConstraintCategory.HIGH_BLAST_RADIUS in constraint_categories:
        guardrails.append(Guardrail(type=GuardrailType.WRITE_LIMITS, reason="High blast radius: an incorrect action could affect multiple systems, customers, or a meaningful scope of the business."))
        guardrails.append(Guardrail(type=GuardrailType.CONFIDENCE_ROUTING, reason="High blast radius: low-confidence decisions must be routed to a human rather than executed automatically."))

    if PlatformRole.HUMAN_APPROVAL in by_role:
        guardrails.append(Guardrail(type=GuardrailType.APPROVAL_THRESHOLDS, reason="Human approval is required before high-impact actions; a concrete threshold must define what counts as high-impact."))

    reversibility_low = scores.get("reversibility") is not None and scores["reversibility"].level == Level.LOW
    if reversibility_low or ConstraintCategory.POOR_REVERSIBILITY in constraint_categories:
        guardrails.append(Guardrail(type=GuardrailType.IDEMPOTENCY, reason="Poor reversibility: retried or duplicated actions must not cause double effects."))
        guardrails.append(Guardrail(type=GuardrailType.ROLLBACK, reason="Poor reversibility: a compensating/rollback action is required for anything the process cannot trivially undo."))

    if PlatformRole.OBSERVABILITY in by_role:
        guardrails.append(Guardrail(type=GuardrailType.FULL_AUDIT_TRAIL, reason="Any non-deterministic or multi-component execution requires a full audit trail to remain trustworthy."))

    return guardrails


def generate_target_architecture(
    automation_id: Optional[int], automation_name: str, pm: ProcessModel, scores: dict[str, DimensionScore],
    rec: RecommendationResult, biz: Optional[BusinessContext], catalog: list[PlatformProfile],
) -> TargetArchitecturePlan:
    biz = biz or BusinessContext()
    profile = ExecutionSurfaceProfile(pm)
    needs = _determine_role_needs(pm, scores, rec, biz, profile)

    components: list[TargetArchitectureComponent] = []
    for role, need in needs.items():
        component = _select_component(role, need, catalog)
        if component is not None:
            components.append(component)

    migration_sequence = _migration_sequence(rec, components, profile)
    guardrails = _guardrails(rec, scores, components)

    manual_decision_roles = [c.role.value for c in components if c.manual_decision_required]
    unresolved = [f"Manual platform decision required for role: {r}" for r in manual_decision_roles]
    unresolved.extend(rec.missing_evidence)

    confidence = Level.LOW if manual_decision_roles else rec.confidence

    return TargetArchitecturePlan(
        automation_id=automation_id, automation_name=automation_name,
        current_summary=f"{rec.current_state.value}",
        recommended_state=rec.recommended_state.value,
        recommended_pattern=rec.recommended_pattern.value,
        components=components, migration_sequence=migration_sequence, guardrails=guardrails,
        confidence=confidence, unresolved_factors=unresolved,
    )


def summarize_estate_architecture(plans: list[TargetArchitecturePlan], role: PlatformRole) -> EstateArchitectureSummary:
    """The estate rollup: 'N automations resolve to platform X for role Y;
    M are stuck on a manual decision.' Built the same compute-on-demand way
    as every other estate view — never persisted."""
    platform_counts: dict[str, int] = {}
    manual_count = 0
    total = 0
    for plan in plans:
        component = next((c for c in plan.components if c.role == role), None)
        if component is None:
            continue
        total += 1
        if component.manual_decision_required:
            manual_count += 1
        elif component.platform:
            platform_counts[component.platform] = platform_counts.get(component.platform, 0) + 1
    return EstateArchitectureSummary(role=role, platform_counts=platform_counts, manual_decision_count=manual_count, total_automations=total)
