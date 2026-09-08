"""Shared enums for the canonical automation model.

Kept platform-independent on purpose (Rule 8/9): nothing here mentions
UiPath. A future parser for another RPA platform reuses this module
unchanged.
"""
from enum import Enum


class Confidence(str, Enum):
    KNOWN = "KNOWN"
    INFERRED = "INFERRED"
    UNKNOWN = "UNKNOWN"


class Level(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class EvolutionState(str, Enum):
    DETERMINISTIC_RPA = "DETERMINISTIC_RPA"
    AUGMENTED_RPA = "AUGMENTED_RPA"
    HYBRID_AGENT = "HYBRID_AGENT"
    ADVANCED_HYBRID = "ADVANCED_HYBRID"
    HIGH_AUTONOMY = "HIGH_AUTONOMY"

    @property
    def rank(self) -> int:
        return list(EvolutionState).index(self) + 1

    @property
    def label(self) -> str:
        return {
            EvolutionState.DETERMINISTIC_RPA: "Deterministic RPA",
            EvolutionState.AUGMENTED_RPA: "Augmented RPA",
            EvolutionState.HYBRID_AGENT: "Hybrid Agent",
            EvolutionState.ADVANCED_HYBRID: "Advanced Hybrid",
            EvolutionState.HIGH_AUTONOMY: "High Autonomy",
        }[self]


class NodeCategory(str, Enum):
    DETERMINISTIC = "DETERMINISTIC"      # blue
    REASONING = "REASONING"              # purple
    API_TOOL = "API_TOOL"                # green
    HUMAN_APPROVAL = "HUMAN_APPROVAL"    # orange
    RISK = "RISK"                        # red
    UNKNOWN = "UNKNOWN"                  # grey


class ConstraintCategory(str, Enum):
    MISSING_API = "MISSING_API"
    UNSTABLE_UI_DEPENDENCY = "UNSTABLE_UI_DEPENDENCY"
    COMPLIANCE_RESTRICTION = "COMPLIANCE_RESTRICTION"
    MANDATORY_APPROVAL = "MANDATORY_APPROVAL"
    HIGH_BLAST_RADIUS = "HIGH_BLAST_RADIUS"
    POOR_REVERSIBILITY = "POOR_REVERSIBILITY"
    WEAK_OBSERVABILITY = "WEAK_OBSERVABILITY"
    POOR_DATA_QUALITY = "POOR_DATA_QUALITY"
    INSUFFICIENT_CONTEXT = "INSUFFICIENT_CONTEXT"
    UNRESOLVED_CUSTOM_DEPENDENCY = "UNRESOLVED_CUSTOM_DEPENDENCY"
    HIGH_EXCEPTION_RATE = "HIGH_EXCEPTION_RATE"
    CUSTOMER_IMPACT = "CUSTOMER_IMPACT"
    MONETARY_RISK = "MONETARY_RISK"
    LEGAL_RISK = "LEGAL_RISK"
    SECURITY_RESTRICTION = "SECURITY_RESTRICTION"
    ARCHITECTURE_LIMITATION = "ARCHITECTURE_LIMITATION"
    MISSING_ROLLBACK = "MISSING_ROLLBACK"
    INSUFFICIENT_RUNTIME_EVIDENCE = "INSUFFICIENT_RUNTIME_EVIDENCE"
    # Added in the business-context repair (docs/decisions.md D-012): absence
    # of enterprise risk context is itself a reason autonomy must be capped —
    # "no blocker found" is not the same as "known to be safe".
    INSUFFICIENT_BUSINESS_CONTEXT = "INSUFFICIENT_BUSINESS_CONTEXT"


class ConstraintStatus(str, Enum):
    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"
    ACCEPTED_RISK = "ACCEPTED_RISK"
    UNKNOWN = "UNKNOWN"
    # A constraint whose triggering category stopped appearing in the latest
    # recommendation, but where the underlying evidence for the *original*
    # constraint was itself INFERRED (not KNOWN) — resolving it automatically
    # would be claiming certainty the system doesn't have. See
    # docs/constraint-memory.md and D-012.
    POSSIBLY_RESOLVED = "POSSIBLY_RESOLVED"


class ConstraintSeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class EvidenceType(str, Enum):
    """Where a piece of evidence backing a score came from. Orthogonal to
    `Confidence` (which says how certain the fact is) — this says what
    *kind* of fact it is, so the UI can group "why" transparently rather
    than flattening everything into one anonymous list (Section 6/18)."""

    TECHNICAL = "TECHNICAL"    # parsed directly from the UiPath package
    BUSINESS = "BUSINESS"      # supplied by a human via Business Context
    RUNTIME = "RUNTIME"        # supplied Orchestrator/runtime evidence
    INFERRED = "INFERRED"      # a heuristic guess (keyword match, naming, etc.)


class ImpactLevel(str, Enum):
    """Business impact magnitude. Distinct from `Level` (LOW/MEDIUM/HIGH)
    because business impact fields must be able to say "genuinely none" and
    "not yet told" as different things — collapsing NONE into LOW or
    defaulting UNKNOWN to MEDIUM would misrepresent what's actually known."""

    NONE = "NONE"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    UNKNOWN = "UNKNOWN"


class ImpactScope(str, Enum):
    INTERNAL_ONLY = "INTERNAL_ONLY"
    SINGLE_CASE = "SINGLE_CASE"
    MULTIPLE_CASES = "MULTIPLE_CASES"
    BUSINESS_UNIT = "BUSINESS_UNIT"
    ENTERPRISE = "ENTERPRISE"
    EXTERNAL_CUSTOMERS = "EXTERNAL_CUSTOMERS"
    UNKNOWN = "UNKNOWN"

    @property
    def rank(self) -> int:
        """Rough ordering for "how far can a wrong action propagate," used
        by blast-radius scoring. Not a precise scale — a banded heuristic."""
        return list(ImpactScope).index(self)


class TriState(str, Enum):
    """A yes/no business fact that must be able to say "not yet told" rather
    than silently defaulting to NO (Rule 4: unknown stays unknown)."""

    YES = "YES"
    NO = "NO"
    UNKNOWN = "UNKNOWN"


class MigrationPattern(str, Enum):
    """An architecture pattern, not just an autonomy level. Two processes at
    the same EvolutionState can call for different patterns — see
    docs/recommendation-engine.md."""

    KEEP_DETERMINISTIC_RPA = "KEEP_DETERMINISTIC_RPA"
    RPA_WITH_AI_AUGMENTATION = "RPA_WITH_AI_AUGMENTATION"
    DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION = "DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION"
    AGENT_ORCHESTRATED_RPA_TOOLS = "AGENT_ORCHESTRATED_RPA_TOOLS"
    AGENT_WITH_API_TOOLS = "AGENT_WITH_API_TOOLS"
    HYBRID_WITH_HUMAN_APPROVAL = "HYBRID_WITH_HUMAN_APPROVAL"
    HIGH_AUTONOMY_AGENT = "HIGH_AUTONOMY_AGENT"

    @property
    def label(self) -> str:
        return {
            MigrationPattern.KEEP_DETERMINISTIC_RPA: "Keep Deterministic RPA",
            MigrationPattern.RPA_WITH_AI_AUGMENTATION: "RPA with AI Augmentation",
            MigrationPattern.DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION: "Deterministic Workflow with Agent Decision",
            MigrationPattern.AGENT_ORCHESTRATED_RPA_TOOLS: "Agent-Orchestrated RPA Tools",
            MigrationPattern.AGENT_WITH_API_TOOLS: "Agent with API Tools",
            MigrationPattern.HYBRID_WITH_HUMAN_APPROVAL: "Hybrid with Human Approval",
            MigrationPattern.HIGH_AUTONOMY_AGENT: "High-Autonomy Agent",
        }[self]


class WhyNotReasonType(str, Enum):
    """Classifies *why* a "Why Not Further" reason exists, so the product
    never conflates "we found a real risk" with "we don't know yet" with
    "there's simply no upside" — three very different messages (Section 14)."""

    BLOCKED = "BLOCKED"            # a confirmed risk/requirement stands in the way
    UNKNOWN = "UNKNOWN"            # a risk-relevant fact hasn't been confirmed
    NOT_READY = "NOT_READY"        # tooling/observability isn't there yet
    NOT_VALUABLE = "NOT_VALUABLE"  # further autonomy wouldn't meaningfully help


DIMENSIONS = [
    "current_ai_usage",
    "reasoning_opportunity",
    "determinism_value",
    "blast_radius",
    "reversibility",
    "compliance_sensitivity",
    "observability",
    "execution_tool_readiness",
    "data_readiness",
    "human_approval_need",
    "exception_complexity",
    "dependency_complexity",
    "runtime_stability",
]

DIMENSION_LABELS = {
    "current_ai_usage": "Current AI / Reasoning Usage",
    "reasoning_opportunity": "Reasoning Opportunity",
    "determinism_value": "Determinism Value",
    "blast_radius": "Blast Radius",
    "reversibility": "Reversibility",
    "compliance_sensitivity": "Compliance Sensitivity",
    "observability": "Observability",
    "execution_tool_readiness": "Execution Tool Readiness",
    "data_readiness": "Data Readiness",
    "human_approval_need": "Human Approval Need",
    "exception_complexity": "Exception Complexity",
    "dependency_complexity": "Dependency Complexity",
    "runtime_stability": "Runtime Stability",
}

# Dimensions that describe the CURRENT implementation only and must never be
# used to drive the desired evolution state or the safety ceiling — see
# docs/scoring-model.md "Current Implementation vs Latent Opportunity".
DESCRIPTIVE_ONLY_DIMENSIONS = {"current_ai_usage"}
