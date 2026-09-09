"""Enterprise Transformation Architecture (Phase 3): models the customer's
actual platform estate (which real platforms exist and what role each
plays) and generates a per-automation TARGET architecture — not just an
evolution-state classification.

Locked rule for this phase (TheDuck): **never recommend a platform because
it merely exists in the customer's stack.** Every `TargetArchitectureComponent`
must carry a `justification` grounded in evidence already computed by
scoring/recommendation, and a `rejected_alternatives` list naming every
other catalog platform that could plausibly fill the same role and why it
wasn't chosen. When more than one candidate exists for a role and nothing
in the evidence distinguishes them, this module does NOT guess — it marks
the slot `manual_decision_required=True` and lists the candidates rather
than picking one arbitrarily (the same "never fabricate certainty" rule
that governs everything else in this codebase, applied to platform choice).
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from packages.shared.enums import Level


class PlatformRole(str, Enum):
    """A responsibility in a target architecture — not a specific vendor.
    One customer platform fills exactly one role in the catalog; the same
    role could in principle be filled by different platforms for different
    automations, which is exactly why role and platform are kept separate."""

    REASONING = "REASONING"                # LLM / reasoning engine
    AGENT_RUNTIME = "AGENT_RUNTIME"         # agent runtime / tool-boundary enforcement
    ORCHESTRATION = "ORCHESTRATION"         # workflow/orchestration layer
    BOUNDED_EXECUTION = "BOUNDED_EXECUTION"  # deterministic execution tool (RPA or otherwise)
    HUMAN_APPROVAL = "HUMAN_APPROVAL"       # approval/HITL surface
    API_GATEWAY = "API_GATEWAY"             # direct API integration surface
    DATABASE = "DATABASE"
    QUEUE = "QUEUE"
    OBSERVABILITY = "OBSERVABILITY"         # logging/tracing/audit


class PlatformProfile(BaseModel):
    """One real platform in the customer's estate. Workspace-scoped —
    every customer's actual stack differs, so this is data, not a constant."""

    id: Optional[int] = None
    name: str
    role: PlatformRole
    notes: Optional[str] = None


class MigrationStepStatus(str, Enum):
    ALREADY_TRUE = "ALREADY_TRUE"      # this precondition already holds; nothing to do
    REQUIRED = "REQUIRED"


class MigrationStep(BaseModel):
    order: int
    title: str
    description: str
    status: MigrationStepStatus = MigrationStepStatus.REQUIRED


class GuardrailType(str, Enum):
    TOOL_ALLOWLIST = "TOOL_ALLOWLIST"
    WRITE_LIMITS = "WRITE_LIMITS"
    APPROVAL_THRESHOLDS = "APPROVAL_THRESHOLDS"
    IDEMPOTENCY = "IDEMPOTENCY"
    ROLLBACK = "ROLLBACK"
    CONFIDENCE_ROUTING = "CONFIDENCE_ROUTING"
    NO_DIRECT_MODEL_CREDENTIALS = "NO_DIRECT_MODEL_CREDENTIALS"
    FULL_AUDIT_TRAIL = "FULL_AUDIT_TRAIL"


class Guardrail(BaseModel):
    type: GuardrailType
    reason: str  # which specific constraint/evidence made this guardrail mandatory


class TargetArchitectureComponent(BaseModel):
    role: PlatformRole
    platform: Optional[str] = None  # None when ambiguous — see manual_decision_required
    justification: Optional[str] = None
    rejected_alternatives: list[dict] = Field(default_factory=list)  # [{platform, reason}]
    manual_decision_required: bool = False
    candidates: list[str] = Field(default_factory=list)  # populated only when manual_decision_required


class TargetArchitecturePlan(BaseModel):
    automation_id: Optional[int] = None
    automation_name: str = ""
    current_summary: str = ""
    recommended_state: str = ""
    recommended_pattern: str = ""
    components: list[TargetArchitectureComponent] = Field(default_factory=list)
    migration_sequence: list[MigrationStep] = Field(default_factory=list)
    guardrails: list[Guardrail] = Field(default_factory=list)
    confidence: Level = Level.MEDIUM
    unresolved_factors: list[str] = Field(default_factory=list)


class EstateArchitectureSummary(BaseModel):
    """Estate-level rollup: for a given role, how many automations resolve
    to each platform, and how many are stuck on a manual decision — the
    "13 bots use SAP UI; 8 can remain UiPath tools..." view."""

    role: PlatformRole
    platform_counts: dict[str, int] = Field(default_factory=dict)
    manual_decision_count: int = 0
    total_automations: int = 0


# ---------------------------------------------------------------------------
# Phase 4: Transformation Impact — composes what-if simulation with target
# architecture generation. Nothing new is invented here: a
# TransformationImpact is just "the current TargetArchitecturePlan" and
# "the TargetArchitecturePlan generated from the simulated (post-fix)
# process model," diffed role by role, plus the evolution-state change and
# remaining blockers the simulation already computes. Composition, not a
# new decision engine.
# ---------------------------------------------------------------------------

class ComponentChange(BaseModel):
    """One role's before/after across a simulation. `added`/`removed` cover
    a role that only becomes (or stops being) necessary once the fix lands
    — e.g. HUMAN_APPROVAL disappearing once a constraint requiring it is
    resolved — not just a platform swap within the same role."""

    role: PlatformRole
    before_platform: Optional[str] = None
    after_platform: Optional[str] = None
    before_manual_decision: bool = False
    after_manual_decision: bool = False
    added: bool = False    # role wasn't needed before, is needed after
    removed: bool = False  # role was needed before, isn't needed after
    changed: bool = False  # platform, manual-decision status, or presence differs


class TransformationImpact(BaseModel):
    """One automation's full before/after picture for one simulated
    scenario: architecture diff + evolution-state change + what's still
    blocking it, side by side."""

    automation_id: int
    automation_name: str
    current_architecture: TargetArchitecturePlan
    simulated_architecture: TargetArchitecturePlan
    component_changes: list[ComponentChange] = Field(default_factory=list)
    current_state: str = ""
    simulated_state: str = ""
    state_changed: bool = False
    remaining_blockers: list[str] = Field(default_factory=list)


class TransformationImpactResult(BaseModel):
    """The full response for 'what does this fix change, architecturally,
    across the estate' — one scenario, many automations, plus the
    before/after platform-usage rollup for each role."""

    scenario_name: str = ""
    impacts: list[TransformationImpact] = Field(default_factory=list)
    platform_usage_before: list[EstateArchitectureSummary] = Field(default_factory=list)
    platform_usage_after: list[EstateArchitectureSummary] = Field(default_factory=list)
    unlock_count: int = 0
    unresolved_factors: list[str] = Field(default_factory=list)
