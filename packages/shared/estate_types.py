"""Estate-level types: cross-automation identity, shared constraints, unlock
analysis, and what-if simulation.

Nothing here duplicates the per-automation canonical model
(`packages/shared/canonical.py`) — these types compose *over* existing
`ProcessModel`/`Assessment`/`Constraint` data. See docs/DUCK_HANDOFF.md for
why this is computed-on-demand rather than a persisted parallel universe,
except where noted (`CanonicalDependency`, `EnvironmentEvent`, which are
genuinely new institutional knowledge that must persist).
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from packages.shared.enums import (
    Confidence,
    ConstraintCategory,
    ConstraintSeverity,
    EvolutionState,
    Level,
    MigrationPattern,
)
from packages.shared.recommendation_types import WhyNotReason
from packages.shared.scoring_types import EvidenceItem


# ---------------------------------------------------------------------------
# Canonical identity (Section: normalization layer)
# ---------------------------------------------------------------------------

class DependencyKind(str, Enum):
    SYSTEM = "SYSTEM"          # an external application/system (SAP, CRM, ...)
    COMPONENT = "COMPONENT"    # a reusable workflow / bounded subprocess


class AliasMapping(BaseModel):
    """One observed raw name folded into a CanonicalDependency.

    `confidence=INFERRED` means deterministic normalization matched it
    (safe to auto-group — see estate/normalize.py); `confidence=UNKNOWN`
    means a human or a future semantic-suggestion step proposed it and it
    is NOT yet folded into grouping until `user_confirmed=True` (Section:
    "never silently merge ambiguous dependencies").
    """

    raw: str
    confidence: Confidence
    user_confirmed: bool = False


class CanonicalDependency(BaseModel):
    id: Optional[int] = None
    kind: DependencyKind
    canonical_name: str
    normalized_key: str
    # PROD | UAT | TEST | DEV | UNKNOWN for SYSTEM dependencies; None for
    # COMPONENT. Never used to merge — it's part of what makes two systems
    # with the same cleaned name genuinely different dependencies (a
    # different environment is not the same real-world tenant).
    environment: Optional[str] = None
    aliases: list[AliasMapping] = Field(default_factory=list)

    def confirmed_raw_names(self) -> set[str]:
        """Raw names that should actually be grouped under this canonical
        entry — deterministic matches, plus anything a human confirmed."""
        return {a.raw for a in self.aliases if a.confidence == Confidence.INFERRED or a.user_confirmed}

    def pending_raw_names(self) -> set[str]:
        """Suggested but not yet confirmed — never merged, shown separately."""
        return {a.raw for a in self.aliases if a.confidence != Confidence.INFERRED and not a.user_confirmed}


# ---------------------------------------------------------------------------
# Estate graph (computed, not persisted)
# ---------------------------------------------------------------------------

class EstateNodeType(str, Enum):
    AUTOMATION = "AUTOMATION"
    SYSTEM = "SYSTEM"
    COMPONENT = "COMPONENT"
    CONSTRAINT = "CONSTRAINT"


class EstateNode(BaseModel):
    id: str
    type: EstateNodeType
    label: str
    meta: dict = Field(default_factory=dict)


class EstateEdge(BaseModel):
    id: str
    source: str
    target: str
    kind: str  # "depends_on" | "invokes" | "blocked_by"


class EstateGraph(BaseModel):
    nodes: list[EstateNode] = Field(default_factory=list)
    edges: list[EstateEdge] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Shared constraints (estate-level constraint memory)
# ---------------------------------------------------------------------------

class SharedConstraint(BaseModel):
    """Many per-automation `Constraint` rows sharing the same category and
    (where derivable) the same canonical dependency, presented as one
    estate-level fact rather than N duplicate rows. See
    docs/constraint-memory.md for how this differs from ProcessConstraint."""

    key: str
    category: ConstraintCategory
    canonical_dependency: Optional[str] = None
    affected_automation_ids: list[int] = Field(default_factory=list)
    affected_automation_names: list[str] = Field(default_factory=list)
    affected_count: int = 0
    severity: ConstraintSeverity = ConstraintSeverity.MEDIUM
    sample_evidence: list[EvidenceItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Unlock analysis
# ---------------------------------------------------------------------------

class StateChange(BaseModel):
    automation_id: int
    automation_name: str
    current_state: EvolutionState
    simulated_state: EvolutionState
    current_pattern: MigrationPattern
    simulated_pattern: MigrationPattern
    changed: bool
    remaining_blockers: list[WhyNotReason] = Field(default_factory=list)


class UnlockOpportunity(BaseModel):
    constraint_key: str
    constraint_category: ConstraintCategory
    canonical_dependency: Optional[str] = None
    affected_automation_ids: list[int] = Field(default_factory=list)
    affected_count: int = 0
    current_states: dict[str, int] = Field(default_factory=dict)   # EvolutionState.value -> count
    simulated_states: dict[str, int] = Field(default_factory=dict)
    state_changes: list[StateChange] = Field(default_factory=list)
    estimated_unlock_count: int = 0
    # Technical leverage only — how many/what share of affected automations
    # a fix would move to a higher evolution state. Deliberately NOT named
    # "estimated_value": a review pointed out that ranking purely on this
    # number conflates "unlocks 12 tiny internal bots" with "unlocks 2
    # processes worth £500M of operations" as if they were the same kind of
    # win. LOW/MEDIUM/HIGH, derived from the actual simulated unlock ratio
    # — never a fabricated number (Rule: no invented ROI). Once Business
    # Context carries a real criticality/value field, Modernization
    # Priority should become unlock_leverage × business_importance ×
    # feasibility × confidence — not implemented yet; no business-value
    # signal exists to multiply by, so priority still ranks on leverage
    # alone (see rank_modernization_priorities).
    unlock_leverage: Level = Level.MEDIUM
    leverage_is_unknown: bool = False
    confidence: Level = Level.MEDIUM
    evidence: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    unresolved_factors: list[str] = Field(default_factory=list)
    priority: Level = Level.MEDIUM


# ---------------------------------------------------------------------------
# What-if simulation — never persisted, never mutates real state
# ---------------------------------------------------------------------------

class SimulationAssumption(str, Enum):
    API_AVAILABLE = "API_AVAILABLE"
    REUSABLE_TOOL_AVAILABLE = "REUSABLE_TOOL_AVAILABLE"
    ROLLBACK_ADDED = "ROLLBACK_ADDED"
    OBSERVABILITY_ADDED = "OBSERVABILITY_ADDED"
    APPROVAL_ADDED = "APPROVAL_ADDED"
    COMPLIANCE_CLEARED = "COMPLIANCE_CLEARED"
    BUSINESS_CONTEXT_SUPPLIED = "BUSINESS_CONTEXT_SUPPLIED"
    DEPENDENCY_STABILIZED = "DEPENDENCY_STABILIZED"


class SimulationOverride(BaseModel):
    assumption: SimulationAssumption
    canonical_dependency: Optional[str] = None  # required for dependency-scoped assumptions
    business_context_patch: Optional[dict] = None  # for BUSINESS_CONTEXT_SUPPLIED
    # For API_AVAILABLE / DEPENDENCY_STABILIZED only: confirmed capability
    # coverage, e.g. ["READ", "WRITE"]. None means "no capability coverage
    # confirmed" — the simulation still runs, but as an explicitly labeled
    # full API-equivalence assumption (every touched UI step is converted,
    # regardless of what it actually does) rather than a claim that a real
    # API surface matching this process's specific operations exists. A
    # review caught that treating "API becomes available" as "assume a
    # perfect API for everything this bot does" was silently optimistic and
    # could overstate estate-wide unlock counts — this field is how a
    # caller states what's actually confirmed, and its absence is what
    # forces confidence down (see estate/simulation.py, estate/unlock.py).
    capabilities: Optional[list[str]] = None


class SimulationScenario(BaseModel):
    name: str
    overrides: list[SimulationOverride]
    automation_ids: Optional[list[int]] = None  # None = every automation in the workspace


class SimulationResult(BaseModel):
    scenario: SimulationScenario
    results: list[StateChange] = Field(default_factory=list)
    unlock_count: int = 0
    unchanged_count: int = 0
    assumptions: list[str] = Field(default_factory=list)
    unresolved_factors: list[str] = Field(default_factory=list)
    is_simulation: bool = True  # always True — a UI/API safety tripwire, never omit this field


# ---------------------------------------------------------------------------
# Modernization priority
# ---------------------------------------------------------------------------

class ModernizationPriority(BaseModel):
    rank: int
    title: str
    canonical_dependency: Optional[str]
    affected_count: int
    estimated_unlock_count: int
    priority: Level
    confidence: Level
    reasons: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Longitudinal environment memory
# ---------------------------------------------------------------------------

class EnvironmentEvent(BaseModel):
    id: Optional[int] = None
    canonical_dependency: str
    description: str
    occurred_on: Optional[datetime] = None
    recorded_by: Optional[str] = None
    potentially_affected_automation_ids: list[int] = Field(default_factory=list)
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Evidence ledger — inspectable backing for any estate-level claim
# ---------------------------------------------------------------------------

class LedgerClaim(BaseModel):
    claim: str
    evidence: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    confidence: Level = Level.MEDIUM


# ---------------------------------------------------------------------------
# Execution Surface Profile (Section: no collapsed binary readiness)
# ---------------------------------------------------------------------------

class ExecutionSurfaceProfileView(BaseModel):
    api_coverage: Level
    reusable_subprocess_coverage: Level
    queue_tool_coverage: Level
    ui_dependency: Level
    overall_readiness: Level
    confidence: Level
    api_step_count: int = 0
    db_queue_step_count: int = 0
    stable_ui_step_count: int = 0
    brittle_ui_step_count: int = 0
    bounded_subprocess_files: list[str] = Field(default_factory=list)
