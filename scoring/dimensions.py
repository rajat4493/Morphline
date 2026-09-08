"""Rule-based scoring for each of the twelve assessment dimensions.

Every function takes the canonical `ProcessModel` and returns a
`DimensionScore`. No LLM calls happen here (D-006, Rule 3/7) — every score
traces to a concrete count or presence/absence of structured evidence.
"""
from __future__ import annotations

from packages.shared.canonical import ProcessModel
from packages.shared.enums import Confidence, Level, NodeCategory
from packages.shared.scoring_types import DimensionScore, level_from_score

_COMPLIANCE_KEYWORDS = (
    "compliance", "gdpr", "kyc", "aml", "exclusion", "legal", "tax",
    "regulat", "audit", "policy", "sanction", "privacy", "finance", "payment",
)
_ROLLBACK_KEYWORDS = ("rollback", "compensat", "undo", "reverse")
_MUTATING_METHODS = {"POST", "PUT", "DELETE", "PATCH"}
_MUTATING_TAGS = {
    "WriteRange", "WriteCell", "AddQueueItem", "SendOutlookMailMessage",
    "SendMailMessage", "ExecuteNonQuery",
}
_STRUCTURED_DATA_TAGS = {"ReadRange", "ReadCell", "ExecuteQuery", "HTTPRequest", "HttpClient", "RestRequest"}
_UNSTRUCTURED_DATA_TAGS = {"DataExtractionScope", "ClassifyDocument", "DocumentClassification", "ExtractEntities"}


def _no_evidence(dimension: str, label: str, note: str) -> DimensionScore:
    return DimensionScore(
        dimension=dimension, label=label, score=0, level=Level.LOW,
        confidence=Level.LOW, evidence=[], explanation=f"INSUFFICIENT EVIDENCE — {note}",
    )


def _confidence_for(evidence_count: int, has_direct_signal: bool) -> Level:
    if evidence_count == 0:
        return Level.LOW
    if has_direct_signal and evidence_count >= 2:
        return Level.HIGH
    return Level.MEDIUM


def score_reasoning_need(pm: ProcessModel) -> DimensionScore:
    steps = [s for s in pm.all_steps() if not s.is_container]
    if not steps:
        return _no_evidence("reasoning_need", "Reasoning Need", "no activities parsed")
    reasoning_steps = [s for s in steps if s.category == NodeCategory.REASONING]
    branch_steps = [s for s in pm.all_steps() if s.activity_type in ("If", "Switch")]
    ratio = len(reasoning_steps) / len(steps)
    score = min(100, int(ratio * 260) + min(30, len(branch_steps) * 4))
    evidence = []
    if reasoning_steps:
        evidence.append(f"{len(reasoning_steps)} reasoning/document-understanding activities detected (e.g. {reasoning_steps[0].activity_type})")
    else:
        evidence.append("No LLM/document-understanding activities detected")
    evidence.append(f"{len(branch_steps)} branching decision points (If/Switch) across the workflow")
    return DimensionScore(
        dimension="reasoning_need", label="Reasoning Need", score=score, level=level_from_score(score),
        confidence=_confidence_for(len(evidence), bool(reasoning_steps)),
        evidence=evidence,
        explanation="Judgment-requiring activities were detected." if reasoning_steps else "The process appears rule-driven with limited ambiguity.",
    )


def score_determinism_value(pm: ProcessModel) -> DimensionScore:
    reasoning = score_reasoning_need(pm)
    compliance_hits = sum(1 for br in pm.business_rules if any(k in br.description.lower() for k in _COMPLIANCE_KEYWORDS))
    score = max(0, min(100, 100 - reasoning.score + compliance_hits * 5))
    evidence = [f"Reasoning Need scored {reasoning.score}/100 (determinism value moves inversely)"]
    if compliance_hits:
        evidence.append(f"{compliance_hits} business rule(s) reference compliance-sensitive terms")
    return DimensionScore(
        dimension="determinism_value", label="Determinism Value", score=score, level=level_from_score(score),
        confidence=reasoning.confidence, evidence=evidence,
        explanation="Predictable, repeatable execution has high value here." if score >= 70 else "Repeatability is less critical than adaptability for this process.",
    )


def score_blast_radius(pm: ProcessModel) -> DimensionScore:
    steps = pm.all_steps()
    mutating = [s for s in steps if s.activity_type in _MUTATING_TAGS or (s.api and (s.api.method or "").upper() in _MUTATING_METHODS)]
    affected_systems = {sys.name for sys in pm.systems if sys.interaction_mode != "unknown"}
    if not steps:
        return _no_evidence("blast_radius", "Blast Radius", "no activities parsed")
    score = min(100, len(mutating) * 12 + min(40, len(affected_systems) * 8))
    evidence = [f"{len(mutating)} state-mutating operation(s) detected (writes/updates/sends)"]
    if affected_systems:
        evidence.append(f"Affects {len(affected_systems)} external system(s): {', '.join(sorted(affected_systems))}")
    return DimensionScore(
        dimension="blast_radius", label="Blast Radius", score=score, level=level_from_score(score),
        confidence=_confidence_for(len(evidence), bool(mutating)), evidence=evidence,
        explanation="A wrong decision here can affect multiple external systems." if score >= 70 else "Impact of an incorrect action is contained.",
    )


def score_reversibility(pm: ProcessModel) -> DimensionScore:
    steps = pm.all_steps()
    mutating = [s for s in steps if s.activity_type in _MUTATING_TAGS or (s.api and (s.api.method or "").upper() in _MUTATING_METHODS)]
    rollback_hits = [s for s in steps if any(k in s.display_name.lower() for k in _ROLLBACK_KEYWORDS)]
    rollback_hits += [br for br in pm.business_rules if any(k in br.description.lower() for k in _ROLLBACK_KEYWORDS)]
    if not mutating:
        score = 90
        evidence = ["No state-mutating operations detected; actions are effectively read-only"]
        confidence = Level.MEDIUM
    elif rollback_hits:
        score = 65
        evidence = [f"{len(mutating)} mutating operation(s) detected", f"{len(rollback_hits)} rollback/compensation reference(s) found"]
        confidence = Level.MEDIUM
    else:
        score = 20
        evidence = [f"{len(mutating)} mutating operation(s) detected with no rollback/compensation logic found"]
        confidence = Level.MEDIUM if mutating else Level.LOW
    return DimensionScore(
        dimension="reversibility", label="Reversibility", score=score, level=level_from_score(score),
        confidence=confidence, evidence=evidence,
        explanation="Actions can reasonably be undone." if score >= 60 else "Actions taken by this process are difficult to reverse once executed.",
    )


def score_compliance_sensitivity(pm: ProcessModel) -> DimensionScore:
    text_blobs = [br.description for br in pm.business_rules]
    text_blobs += [s.display_name for s in pm.all_steps()]
    hits = [t for t in text_blobs if any(k in t.lower() for k in _COMPLIANCE_KEYWORDS)]
    if not hits:
        return DimensionScore(
            dimension="compliance_sensitivity", label="Compliance Sensitivity", score=10, level=Level.LOW,
            confidence=Level.LOW, evidence=["No compliance-related keywords detected in rules or step names"],
            explanation="No evidence of regulatory/compliance constraints was found (heuristic keyword match only).",
        )
    score = min(100, 30 + len(hits) * 10)
    return DimensionScore(
        dimension="compliance_sensitivity", label="Compliance Sensitivity", score=score, level=level_from_score(score),
        confidence=Level.MEDIUM,
        evidence=[f"{len(hits)} step/rule name(s) reference compliance-sensitive terms (e.g. {hits[0]!r})"],
        explanation="Regulatory or policy exposure is likely (inferred from naming, not a legal review).",
    )


def score_observability(pm: ProcessModel) -> DimensionScore:
    steps = pm.all_steps()
    if not steps:
        return _no_evidence("observability", "Observability", "no activities parsed")
    log_steps = [s for s in steps if s.activity_type in ("LogMessage", "WriteLine")]
    has_exception_handling = bool(pm.exception_paths)
    score = min(100, len(log_steps) * 8 + (30 if has_exception_handling else 0))
    evidence = [f"{len(log_steps)} logging activity(ies) found"]
    evidence.append("Exception handling with structured catch present" if has_exception_handling else "No try/catch exception handling detected")
    return DimensionScore(
        dimension="observability", label="Observability", score=score, level=level_from_score(score),
        confidence=_confidence_for(len(evidence), True), evidence=evidence,
        explanation="Incorrect behavior is likely to be detected quickly." if score >= 60 else "Little instrumentation exists to detect incorrect behavior.",
    )


def score_tool_readiness(pm: ProcessModel) -> DimensionScore:
    steps = pm.all_steps()
    api_steps = [s for s in steps if s.category == NodeCategory.API_TOOL]
    ui_steps = [s for s in steps if s.category == NodeCategory.DETERMINISTIC and s.selector is not None]
    total = len(api_steps) + len(ui_steps)
    if total == 0:
        return _no_evidence("tool_readiness", "Tool / API Readiness", "no API or UI-automation activities detected")
    score = int(100 * len(api_steps) / total)
    evidence = [f"{len(api_steps)} API/HTTP activity(ies)", f"{len(ui_steps)} UI-automation (selector-based) activity(ies)"]
    return DimensionScore(
        dimension="tool_readiness", label="Tool / API Readiness", score=score, level=level_from_score(score),
        confidence=_confidence_for(len(evidence), True), evidence=evidence,
        explanation="Stable APIs are available for most integration points." if score >= 60 else "The process remains heavily dependent on UI-level automation.",
    )


def score_data_readiness(pm: ProcessModel) -> DimensionScore:
    steps = pm.all_steps()
    structured = [s for s in steps if s.activity_type in _STRUCTURED_DATA_TAGS]
    unstructured = [s for s in steps if s.activity_type in _UNSTRUCTURED_DATA_TAGS]
    total = len(structured) + len(unstructured)
    if total == 0:
        return DimensionScore(
            dimension="data_readiness", label="Data Readiness", score=50, level=Level.MEDIUM, confidence=Level.LOW,
            evidence=["No structured or unstructured data-extraction activities detected"],
            explanation="Insufficient evidence to judge data readiness; assumed neutral.",
        )
    score = int(100 * len(structured) / total)
    evidence = [f"{len(structured)} structured data activity(ies) (API/DB/Excel reads)", f"{len(unstructured)} unstructured/document-extraction activity(ies)"]
    return DimensionScore(
        dimension="data_readiness", label="Data Readiness", score=score, level=level_from_score(score),
        confidence=_confidence_for(len(evidence), True), evidence=evidence,
        explanation="Reliable structured context is available to support reasoning." if score >= 60 else "The process depends significantly on unstructured/extracted data.",
    )


def score_human_approval_need(pm: ProcessModel) -> DimensionScore:
    n = len(pm.human_checkpoints)
    score = min(100, n * 35)
    evidence = [f"{n} human task/approval checkpoint(s) detected"] if n else ["No human task/approval activities detected"]
    return DimensionScore(
        dimension="human_approval_need", label="Human Approval Need", score=score, level=level_from_score(score),
        confidence=Level.HIGH if n else Level.MEDIUM, evidence=evidence,
        explanation="A human must remain in the loop for key decisions." if n else "No explicit human checkpoint was found in the workflow.",
    )


def score_exception_complexity(pm: ProcessModel) -> DimensionScore:
    steps = pm.all_steps()
    if not steps:
        return _no_evidence("exception_complexity", "Exception Complexity", "no activities parsed")
    handled = bool(pm.exception_paths)
    has_retry = any(ep.has_retry for ep in pm.exception_paths)
    rethrow = any(ep.kind == "rethrow" for ep in pm.exception_paths)
    if not handled:
        score, evidence, explanation = 85, ["No exception handling detected across the workflow"], "Failure modes are undefined; exceptions would surface unhandled."
    elif has_retry and not rethrow:
        score, evidence, explanation = 25, [f"{len(pm.exception_paths)} exception path(s) with a retry scope, no bare rethrow"], "Exceptions appear deterministic and recoverable."
    else:
        score, evidence, explanation = 55, [f"{len(pm.exception_paths)} exception path(s) detected"], "Some exception paths exist but recoverability is unclear."
    return DimensionScore(
        dimension="exception_complexity", label="Exception Complexity", score=score, level=level_from_score(score),
        confidence=Level.MEDIUM, evidence=evidence, explanation=explanation,
    )


def score_dependency_complexity(pm: ProcessModel) -> DimensionScore:
    unknown_deps = [d for d in pm.dependencies if d.confidence == Confidence.UNKNOWN]
    total_deps = len(pm.dependencies) + len(pm.systems)
    if total_deps == 0:
        return _no_evidence("dependency_complexity", "Dependency Complexity", "no dependencies or external systems detected")
    score = min(100, total_deps * 6 + len(unknown_deps) * 10)
    evidence = [f"{len(pm.dependencies)} package/workflow dependency(ies)", f"{len(pm.systems)} distinct external system(s)"]
    if unknown_deps:
        evidence.append(f"{len(unknown_deps)} unresolved dependency(ies) with UNKNOWN confidence")
    return DimensionScore(
        dimension="dependency_complexity", label="Dependency Complexity", score=score, level=level_from_score(score),
        confidence=_confidence_for(len(evidence), True), evidence=evidence,
        explanation="The process depends on many external systems/components." if score >= 60 else "Dependencies are limited and well understood.",
    )


def score_runtime_stability(pm: ProcessModel) -> DimensionScore:
    ev = pm.runtime_evidence
    if ev is None or ev.success_rate is None:
        return DimensionScore(
            dimension="runtime_stability", label="Runtime Stability", score=0, level=Level.LOW, confidence=Level.LOW,
            evidence=[], explanation="INSUFFICIENT EVIDENCE — no runtime/Orchestrator data has been supplied for this process.",
        )
    score = int(ev.success_rate * 100)
    evidence = [f"Supplied runtime success rate: {ev.success_rate:.1%}"]
    if ev.volume:
        evidence.append(f"Observed volume: {ev.volume}")
    return DimensionScore(
        dimension="runtime_stability", label="Runtime Stability", score=score, level=level_from_score(score),
        confidence=Level.HIGH, evidence=evidence,
        explanation="Runtime evidence shows stable execution." if score >= 70 else "Runtime evidence shows meaningful instability.",
    )


DIMENSION_SCORERS = {
    "reasoning_need": score_reasoning_need,
    "determinism_value": score_determinism_value,
    "blast_radius": score_blast_radius,
    "reversibility": score_reversibility,
    "compliance_sensitivity": score_compliance_sensitivity,
    "observability": score_observability,
    "tool_readiness": score_tool_readiness,
    "data_readiness": score_data_readiness,
    "human_approval_need": score_human_approval_need,
    "exception_complexity": score_exception_complexity,
    "dependency_complexity": score_dependency_complexity,
    "runtime_stability": score_runtime_stability,
}
