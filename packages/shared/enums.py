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


class ConstraintStatus(str, Enum):
    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"
    ACCEPTED_RISK = "ACCEPTED_RISK"
    UNKNOWN = "UNKNOWN"


class ConstraintSeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


DIMENSIONS = [
    "reasoning_need",
    "determinism_value",
    "blast_radius",
    "reversibility",
    "compliance_sensitivity",
    "observability",
    "tool_readiness",
    "data_readiness",
    "human_approval_need",
    "exception_complexity",
    "dependency_complexity",
    "runtime_stability",
]

DIMENSION_LABELS = {
    "reasoning_need": "Reasoning Need",
    "determinism_value": "Determinism Value",
    "blast_radius": "Blast Radius",
    "reversibility": "Reversibility",
    "compliance_sensitivity": "Compliance Sensitivity",
    "observability": "Observability",
    "tool_readiness": "Tool / API Readiness",
    "data_readiness": "Data Readiness",
    "human_approval_need": "Human Approval Need",
    "exception_complexity": "Exception Complexity",
    "dependency_complexity": "Dependency Complexity",
    "runtime_stability": "Runtime Stability",
}
