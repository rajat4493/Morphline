"""Rule-based scoring for each assessment dimension.

Every function takes the canonical `ProcessModel` (and, where relevant, an
optional `BusinessContext`) and returns a `DimensionScore`. No LLM calls
happen here (D-006, Rule 3/7) — every score traces to a concrete count,
keyword match, or business-context field, each tagged with an
`EvidenceType` (TECHNICAL/BUSINESS/RUNTIME/INFERRED) so the UI never
flattens "why" into an anonymous list.

Core distinction this module exists to enforce (see docs/scoring-model.md
"Current Implementation vs Latent Opportunity"): `current_ai_usage`
describes what the automation already does and must never feed the
recommendation engine's desired-state or ceiling logic;
`reasoning_opportunity` estimates whether the underlying *business process*
would benefit from contextual reasoning, independent of whether that
reasoning has been implemented yet. A deterministic RPA bot with zero AI
activities can — and often should — score HIGH on reasoning_opportunity.
"""
from __future__ import annotations

from typing import Optional

from packages.shared.business_context import BusinessContext
from packages.shared.canonical import ProcessModel
from packages.shared.enums import Confidence, EvidenceType, Level, NodeCategory, TriState
from packages.shared.scoring_types import DimensionScore, EvidenceItem, level_from_score

_COMPLIANCE_KEYWORDS = (
    "compliance", "gdpr", "kyc", "aml", "exclusion", "legal", "tax",
    "regulat", "audit", "policy", "sanction", "privacy", "finance", "payment",
)
_ROLLBACK_KEYWORDS = ("rollback", "compensat", "undo", "reverse")
_MUTATING_METHODS = {"POST", "PUT", "DELETE", "PATCH"}
_MUTATING_TAGS = {
    "WriteRange", "WriteCell", "AddQueueItem", "SendOutlookMailMessage",
    "SendMailMessage", "ExecuteNonQuery", "ExcelWriteRange", "ExcelWriteCell",
    "AppendRange",
}
_STRUCTURED_DATA_TAGS = {
    "ReadRange", "ReadCell", "ExecuteQuery", "HTTPRequest", "HttpClient", "RestRequest",
    "ExcelReadRange", "ExcelReadCell",
}
_UNSTRUCTURED_DATA_TAGS = {"DataExtractionScope", "ClassifyDocument", "DocumentClassification", "ExtractEntities"}
_UNSTRUCTURED_SOURCE_TAGS = _UNSTRUCTURED_DATA_TAGS | {"GetOutlookMailMessages", "GetIMAPMailMessages"}
_DB_TAGS = {"ExecuteQuery", "ExecuteNonQuery", "DatabaseConnect"}
_QUEUE_TAGS = {"AddQueueItem", "GetQueueItems", "GetTransactionItem", "AddTransactionItem"}

# Section 3B: naming signals that a step's *purpose* involves judgment,
# interpretation, or ambiguity resolution — regardless of what activity type
# implements it. Deliberately broad; each match is INFERRED, never DIRECT,
# because it's a naming heuristic, not a semantic analysis.
_REASONING_OPPORTUNITY_KEYWORDS = (
    "review", "assess", "determine", "classify", "investigate", "decide",
    "evaluate", "interpret", "check eligibility", "eligibility", "compare evidence",
    "route case", "summarize", "summarise", "generate report", "narrative",
    "analyze", "analyse", "draft", "compose", "synthesize", "synthesise",
    "escalat", "judgment", "judgement", "recommend",
)


def _ev(type_: EvidenceType, source: str, confidence: Confidence, description: str, reference: Optional[str] = None) -> EvidenceItem:
    return EvidenceItem(type=type_, source=source, confidence=confidence, description=description, reference=reference)


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


def _biz(context: Optional[BusinessContext]) -> BusinessContext:
    return context if context is not None else BusinessContext()


# ---------------------------------------------------------------------------
# Current AI / Reasoning Usage — DESCRIPTIVE ONLY. Never used to determine
# whether a process *should* become more agentic (packages/shared/enums.py
# DESCRIPTIVE_ONLY_DIMENSIONS enforces this at the recommendation layer too).
# ---------------------------------------------------------------------------

def score_current_ai_usage(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    steps = [s for s in pm.all_steps() if not s.is_container]
    if not steps:
        return _no_evidence("current_ai_usage", "Current AI / Reasoning Usage", "no activities parsed")
    ai_steps = [s for s in steps if s.category == NodeCategory.REASONING]
    ratio = len(ai_steps) / len(steps)
    score = min(100, int(ratio * 260))
    evidence = []
    if ai_steps:
        names = ", ".join(sorted({s.activity_type for s in ai_steps})[:4])
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN,
                             f"{len(ai_steps)} AI/reasoning activity(ies) already implemented ({names})"))
    else:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN,
                             "No LLM/AI-classified activities are currently implemented"))
    return DimensionScore(
        dimension="current_ai_usage", label="Current AI / Reasoning Usage", score=score, level=level_from_score(score),
        confidence=Level.HIGH, evidence=evidence,
        explanation=(
            "This describes what the automation already does — it is descriptive only and does not by itself "
            "justify (or rule out) further evolution. See Reasoning Opportunity for that judgment."
        ),
    )


# ---------------------------------------------------------------------------
# Reasoning Opportunity — the dimension that actually feeds Evolution Value.
# ---------------------------------------------------------------------------

def score_reasoning_opportunity(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    all_steps = pm.all_steps()
    if not all_steps:
        return _no_evidence("reasoning_opportunity", "Reasoning Opportunity", "no activities parsed")

    evidence: list[EvidenceItem] = []
    score = 0
    credited_ids: set[str] = set()

    # 1. Human checkpoints: someone is *already* applying judgment here —
    # the strongest, most direct signal that reasoning is needed, entirely
    # independent of whether any AI activity exists.
    checkpoints = pm.human_checkpoints
    if checkpoints:
        pts = min(44, len(checkpoints) * 22)
        score += pts
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN,
                             f"{len(checkpoints)} manual review/approval checkpoint(s) — a human currently exercises judgment here"))

    # 2. Branching density — a weak, capped signal on its own (an If on a
    # deterministic boolean is not reasoning), but real evidence when
    # combined with the other signals below.
    branch_steps = [s for s in all_steps if s.activity_type in ("If", "Switch")]
    if branch_steps:
        pts = min(30, len(branch_steps) * 3)
        score += pts
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.INFERRED,
                             f"{len(branch_steps)} decision branch(es) (If/Switch) across the workflow(s) — "
                             "counted as weak evidence only; a branch on a deterministic value is not reasoning"))

    # 3. Purpose-name keyword matches. A step's DISPLAY NAME says what it's
    # trying to accomplish; its activity tag says how it's currently
    # implemented. A name match on a REASONING-tagged step is corroborated
    # (two independent signals agree this is a genuine interpretation task);
    # a name match on any other step is a weaker, uncorroborated signal.
    corroborated = 0
    base_matches = 0
    matched_examples: list[str] = []
    for s in all_steps:
        if s.id in credited_ids:
            continue
        name = s.display_name.lower()
        if any(kw in name for kw in _REASONING_OPPORTUNITY_KEYWORDS):
            credited_ids.add(s.id)
            matched_examples.append(s.display_name)
            if s.category == NodeCategory.REASONING:
                corroborated += 1
            else:
                base_matches += 1
    if corroborated:
        pts = min(80, corroborated * 28)
        score += pts
        evidence.append(_ev(EvidenceType.INFERRED, "step naming", Confidence.INFERRED,
                             f"{corroborated} step(s) whose name indicates interpretation/judgment AND whose "
                             f"activity type is already an AI/reasoning activity (e.g. {matched_examples[0]!r}) — "
                             "corroborated signal that this is a genuine reasoning task, not just an implementation choice"))
    if base_matches:
        pts = min(36, base_matches * 12)
        score += pts
        evidence.append(_ev(EvidenceType.INFERRED, "step naming", Confidence.INFERRED,
                             f"{base_matches} step/workflow name(s) suggest judgment or interpretation "
                             f"(e.g. {matched_examples[-1]!r}) without an existing AI activity backing them"))

    # 4. Unstructured input sources (email, OCR/document extraction) not
    # already credited above.
    unstructured_sources = [s for s in all_steps if s.activity_type in _UNSTRUCTURED_SOURCE_TAGS and s.id not in credited_ids]
    if unstructured_sources:
        score += 15
        kinds = sorted({s.activity_type for s in unstructured_sources})
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN,
                             f"Unstructured input source(s) detected: {', '.join(kinds)}"))

    # 5. Exception/fallback repetition — repeated fallback routing suggests
    # ambiguous failure handling rather than a single deterministic path.
    if len(pm.exception_paths) > 1:
        pts = min(15, (len(pm.exception_paths) - 1) * 4)
        score += pts
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.INFERRED,
                             f"{len(pm.exception_paths)} exception/fallback paths detected — repeated fallback routing"))

    # 6. Explicit rule table absence — inferred note only, no points, but
    # material to the explanation (Section 3B's worked example).
    no_rule_table = len(branch_steps) >= 3 and not pm.business_rules
    if no_rule_table:
        evidence.append(_ev(EvidenceType.INFERRED, "parsed workflow", Confidence.UNKNOWN,
                             "No explicit rule table was detected backing these branches"))

    score = min(100, score)

    direct_categories = sum([
        bool(checkpoints), bool(corroborated), bool(unstructured_sources),
    ])
    if not evidence:
        return _no_evidence("reasoning_opportunity", "Reasoning Opportunity",
                             "no branching, review checkpoints, interpretive naming, or unstructured input detected")
    confidence = Level.HIGH if direct_categories >= 2 else (Level.MEDIUM if direct_categories >= 1 or base_matches or branch_steps else Level.LOW)

    level = level_from_score(score)
    if level == Level.HIGH:
        explanation = (
            "The implementation contains substantial decision scaffolding, review checkpoints, or "
            "interpretation-oriented steps around ambiguous inputs, suggesting a strong opportunity for "
            "contextual reasoning — independent of whether AI is already used here."
        )
    elif level == Level.MEDIUM:
        explanation = "Some signals suggest ambiguity or judgment in this process, but the evidence is limited."
    else:
        explanation = "Little evidence of ambiguity, judgment, or unstructured input was found; this looks like a rule-driven process."

    return DimensionScore(
        dimension="reasoning_opportunity", label="Reasoning Opportunity", score=score, level=level,
        confidence=confidence, evidence=evidence, explanation=explanation,
    )


def score_determinism_value(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    opportunity = score_reasoning_opportunity(pm, biz)
    score = max(0, min(100, 100 - opportunity.score))
    evidence = [_ev(EvidenceType.INFERRED, "derived", Confidence.INFERRED,
                     f"Reasoning Opportunity scored {opportunity.score}/100 (determinism value moves inversely)")]
    return DimensionScore(
        dimension="determinism_value", label="Determinism Value", score=score, level=level_from_score(score),
        confidence=opportunity.confidence, evidence=evidence,
        explanation="Predictable, repeatable execution has high value here." if score >= 70 else "Repeatability is less critical than adaptability for this process.",
    )


def score_blast_radius(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    biz = _biz(biz)
    steps = pm.all_steps()
    mutating = [s for s in steps if s.activity_type in _MUTATING_TAGS or (s.api and (s.api.method or "").upper() in _MUTATING_METHODS)]
    affected_systems = {sys.name for sys in pm.systems if sys.interaction_mode != "unknown"}

    evidence: list[EvidenceItem] = []
    score = 0
    have_signal = False

    # Technical: authority (does it mutate at all?) and propagation
    # (how many systems does that mutation reach?) — bands, not raw counts.
    if mutating:
        have_signal = True
        score += 25
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN,
                             f"Process has authority to mutate production state ({len(mutating)} mutating operation(s))"))
        if len(affected_systems) >= 2:
            score += 20
            evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN,
                                 f"Mutation propagates to {len(affected_systems)} distinct downstream system(s): {', '.join(sorted(affected_systems))}"))
        elif affected_systems:
            score += 10

    # Business: impact + scope are the primary drivers when supplied — this
    # is deliberately weighted above raw technical counts (Section 8).
    impact_fields = [biz.customer_impact, biz.financial_impact, biz.external_party_impact]
    worst_impact = next((f for f in impact_fields if f.value == "HIGH"), None)
    if worst_impact:
        have_signal = True
        score += 40
        evidence.append(_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN,
                             f"Business Context marks impact HIGH ({worst_impact.value})"))
    elif any(f.value == "MEDIUM" for f in impact_fields):
        have_signal = True
        score += 20
        evidence.append(_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN,
                             "Business Context marks customer/financial/external-party impact as MEDIUM"))
    elif any(f.value == "NONE" for f in impact_fields) and not mutating:
        evidence.append(_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN,
                             "Business Context marks impact as NONE"))

    if biz.maximum_scope.value in ("ENTERPRISE", "EXTERNAL_CUSTOMERS"):
        have_signal = True
        score += 20
        evidence.append(_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN,
                             f"Maximum scope: {biz.maximum_scope.value}"))
    elif biz.maximum_scope.value in ("BUSINESS_UNIT", "MULTIPLE_CASES"):
        have_signal = True
        score += 10
        evidence.append(_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN,
                             f"Maximum scope: {biz.maximum_scope.value}"))
    elif biz.maximum_scope.value == "UNKNOWN":
        evidence.append(_ev(EvidenceType.INFERRED, "Business Context", Confidence.UNKNOWN,
                             "Maximum scope of impact not supplied"))

    if pm.runtime_evidence and pm.runtime_evidence.volume:
        evidence.append(_ev(EvidenceType.RUNTIME, "Runtime Evidence", Confidence.KNOWN,
                             f"Observed volume: {pm.runtime_evidence.volume} run(s)"))

    if not have_signal:
        return _no_evidence("blast_radius", "Blast Radius",
                             "no mutating actions detected and no business-context impact fields supplied")

    score = min(100, score)
    business_confirmed = worst_impact is not None or biz.maximum_scope.value != "UNKNOWN"
    confidence = Level.HIGH if business_confirmed else (Level.MEDIUM if mutating else Level.LOW)

    return DimensionScore(
        dimension="blast_radius", label="Blast Radius", score=score, level=level_from_score(score),
        confidence=confidence, evidence=evidence,
        explanation=(
            "A wrong decision here can affect multiple systems, customers, or a meaningful scope of the business."
            if level_from_score(score) == Level.HIGH else
            "Impact of an incorrect action appears contained, based on available evidence."
        ),
    )


def score_reversibility(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    biz = _biz(biz)
    steps = pm.all_steps()
    mutating = [s for s in steps if s.activity_type in _MUTATING_TAGS or (s.api and (s.api.method or "").upper() in _MUTATING_METHODS)]
    rollback_hits = [s for s in steps if any(k in s.display_name.lower() for k in _ROLLBACK_KEYWORDS)]
    rollback_hits += [br for br in pm.business_rules if any(k in br.description.lower() for k in _ROLLBACK_KEYWORDS)]

    if biz.irreversible_action == TriState.YES:
        return DimensionScore(
            dimension="reversibility", label="Reversibility", score=15, level=Level.LOW, confidence=Level.HIGH,
            evidence=[_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN, "Business Context confirms this action is irreversible")],
            explanation="Business Context confirms actions taken by this process cannot be undone.",
        )
    if biz.irreversible_action == TriState.NO:
        return DimensionScore(
            dimension="reversibility", label="Reversibility", score=85, level=Level.HIGH, confidence=Level.HIGH,
            evidence=[_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN, "Business Context confirms this action can be reversed")],
            explanation="Business Context confirms actions taken by this process can be reversed if needed.",
        )

    # No business confirmation either way — technical evidence can suggest a
    # direction but must never be presented with confident certainty
    # (Section 9): absence of a rollback activity is not proof of
    # irreversibility, it's an open question.
    if not mutating:
        return DimensionScore(
            dimension="reversibility", label="Reversibility", score=80, level=Level.HIGH, confidence=Level.MEDIUM,
            evidence=[_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, "No state-mutating operations detected; actions are effectively read-only")],
            explanation="No mutating actions were found, so there is nothing to reverse — moderately confident this is safe by default.",
        )
    evidence = [_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{len(mutating)} mutating operation(s) detected")]
    if rollback_hits:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.INFERRED, f"{len(rollback_hits)} rollback/compensation reference(s) found by name"))
        score, level = 55, Level.MEDIUM
    else:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, "No rollback/compensation logic detected in the automation"))
        score, level = 25, Level.LOW
    evidence.append(_ev(EvidenceType.INFERRED, "Business Context", Confidence.UNKNOWN, "Business reversibility (can this be undone operationally/contractually?) has not been confirmed"))

    return DimensionScore(
        dimension="reversibility", label="Reversibility", score=score, level=level,
        confidence=Level.LOW,  # never claim more than LOW confidence without business confirmation
        evidence=evidence,
        explanation=(
            "No technical rollback path was detected. Whether the underlying business action can be reversed "
            "(e.g. by policy, contract, or a manual correction process) is unknown."
        ),
    )


def score_compliance_sensitivity(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    biz = _biz(biz)
    text_blobs = [br.description for br in pm.business_rules] + [s.display_name for s in pm.all_steps()]
    hits = [t for t in text_blobs if any(k in t.lower() for k in _COMPLIANCE_KEYWORDS)]

    if biz.regulated_process == TriState.YES:
        score = 85
        evidence = [_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN, "Business Context confirms this is a regulated process")]
        if biz.mandatory_approval == TriState.YES:
            score = 95
            evidence.append(_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN, "Business Context confirms mandatory human approval is required"))
        if hits:
            evidence.append(_ev(EvidenceType.INFERRED, "step naming", Confidence.INFERRED, f"Compliance-sensitive terminology also detected (e.g. {hits[0]!r})"))
        return DimensionScore(
            dimension="compliance_sensitivity", label="Compliance Sensitivity", score=score, level=Level.HIGH, confidence=Level.HIGH,
            evidence=evidence, explanation="Business Context confirms regulatory/policy exposure requiring accountability.",
        )

    if biz.regulated_process == TriState.NO:
        evidence = [_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN, "Business Context confirms this is not a regulated process")]
        return DimensionScore(
            dimension="compliance_sensitivity", label="Compliance Sensitivity", score=10, level=Level.LOW, confidence=Level.HIGH,
            evidence=evidence, explanation="Business Context confirms no regulatory/compliance constraints apply.",
        )

    # No business confirmation: keyword matching is a WEAK inference signal
    # only — never presented as strong compliance evidence (Section 7).
    if not hits:
        return DimensionScore(
            dimension="compliance_sensitivity", label="Compliance Sensitivity", score=10, level=Level.LOW, confidence=Level.LOW,
            evidence=[_ev(EvidenceType.INFERRED, "step naming", Confidence.UNKNOWN, "No compliance-related keywords detected, and no Business Context supplied")],
            explanation="No evidence of regulatory/compliance constraints was found. Confirm via Business Context if this process touches a regulated domain.",
        )
    score = min(60, 20 + len(hits) * 10)  # capped well below HIGH — keyword hits alone can never claim HIGH
    return DimensionScore(
        dimension="compliance_sensitivity", label="Compliance Sensitivity", score=score, level=level_from_score(score),
        confidence=Level.LOW if len(hits) < 3 else Level.MEDIUM,
        evidence=[_ev(EvidenceType.INFERRED, "step naming", Confidence.INFERRED, f"{len(hits)} step/rule name(s) reference compliance-sensitive terms (e.g. {hits[0]!r})")],
        explanation="Compliance-sensitive terminology was detected. Confirm whether policy or regulation requires human approval via Business Context.",
    )


def score_observability(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    steps = pm.all_steps()
    if not steps:
        return _no_evidence("observability", "Observability", "no activities parsed")
    log_steps = [s for s in steps if s.activity_type in ("LogMessage", "WriteLine")]
    has_exception_handling = bool(pm.exception_paths)
    score = min(100, len(log_steps) * 8 + (30 if has_exception_handling else 0))
    evidence = [_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{len(log_steps)} logging activity(ies) found")]
    evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN,
                         "Exception handling with structured catch present" if has_exception_handling else "No try/catch exception handling detected"))
    if pm.runtime_evidence and pm.runtime_evidence.selector_failure_rate is not None:
        score = min(100, score + 15)
        evidence.append(_ev(EvidenceType.RUNTIME, "Runtime Evidence", Confidence.KNOWN,
                             f"Observed selector failure rate: {pm.runtime_evidence.selector_failure_rate:.1%}"))
    return DimensionScore(
        dimension="observability", label="Observability", score=score, level=level_from_score(score),
        confidence=_confidence_for(len(evidence), True), evidence=evidence,
        explanation="Incorrect behavior is likely to be detected quickly." if score >= 60 else "Little instrumentation exists to detect incorrect behavior.",
    )


def score_execution_tool_readiness(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    """Whether a future agent/hybrid architecture has reliable, bounded
    execution mechanisms available — APIs, but also databases, queues, and
    *existing UiPath subprocesses that are reusable, bounded tools* (Section
    10). Existing RPA is not automatically brittle: a UI-automation workflow
    invoked with declared arguments and reused elsewhere is a STABLE_RPA_TOOL;
    the same UI automation inlined directly in the orchestrator workflow is
    a BRITTLE_UI_DEPENDENCY."""
    all_steps = pm.all_steps()
    if not all_steps:
        return _no_evidence("execution_tool_readiness", "Execution Tool Readiness", "no activities parsed")

    profile = ExecutionSurfaceProfile(pm)
    api_steps, db_queue_steps = profile.api_steps, profile.db_queue_steps
    bounded_subprocess_files = profile.bounded_subprocess_files
    stable_ui_steps, brittle_ui_steps = profile.stable_ui_steps, profile.brittle_ui_steps

    stable_count = len(api_steps) + len(db_queue_steps) + len(stable_ui_steps)
    total_execution_surfaces = stable_count + len(brittle_ui_steps)

    if total_execution_surfaces == 0:
        return _no_evidence("execution_tool_readiness", "Execution Tool Readiness", "no API, database, queue, or UI-automation activities detected")

    score = int(100 * stable_count / total_execution_surfaces)
    evidence = []
    if api_steps:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{len(api_steps)} API/HTTP activity(ies) — stable tool"))
    if db_queue_steps:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{len(db_queue_steps)} database/queue activity(ies) — stable tool"))
    if bounded_subprocess_files:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN,
                             f"{len(bounded_subprocess_files)} reusable invoked workflow(s) with declared arguments "
                             f"({', '.join(sorted(bounded_subprocess_files))}) — usable as bounded deterministic tools "
                             "even though they use UI automation internally"))
    if stable_ui_steps:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN,
                             f"{len(stable_ui_steps)} UI-automation step(s) encapsulated inside those bounded subprocesses"))
    if brittle_ui_steps:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN,
                             f"{len(brittle_ui_steps)} UI-automation step(s) remain inline in the orchestrator workflow with no encapsulation (brittle)"))

    return DimensionScore(
        dimension="execution_tool_readiness", label="Execution Tool Readiness", score=score, level=level_from_score(score),
        confidence=_confidence_for(len(evidence), True), evidence=evidence,
        explanation=(
            "Reliable, bounded execution surfaces (APIs, databases, queues, or reusable UiPath subprocesses) are "
            "available for most integration points."
            if score >= 60 else
            "Execution depends significantly on UI automation that is not encapsulated as a reusable, bounded tool."
        ),
    )


def score_data_readiness(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    steps = pm.all_steps()
    structured = [s for s in steps if s.activity_type in _STRUCTURED_DATA_TAGS]
    unstructured = [s for s in steps if s.activity_type in _UNSTRUCTURED_DATA_TAGS]
    total = len(structured) + len(unstructured)
    if total == 0:
        return DimensionScore(
            dimension="data_readiness", label="Data Readiness", score=50, level=Level.MEDIUM, confidence=Level.LOW,
            evidence=[_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.UNKNOWN, "No structured or unstructured data-extraction activities detected")],
            explanation="Insufficient evidence to judge data readiness; assumed neutral.",
        )
    score = int(100 * len(structured) / total)
    evidence = [
        _ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{len(structured)} structured data activity(ies) (API/DB/Excel reads)"),
        _ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{len(unstructured)} unstructured/document-extraction activity(ies)"),
    ]
    return DimensionScore(
        dimension="data_readiness", label="Data Readiness", score=score, level=level_from_score(score),
        confidence=_confidence_for(len(evidence), True), evidence=evidence,
        explanation="Reliable structured context is available to support reasoning." if score >= 60 else "The process depends significantly on unstructured/extracted data.",
    )


def score_human_approval_need(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    biz = _biz(biz)
    n = len(pm.human_checkpoints)
    score = min(100, n * 35)
    evidence = []
    if n:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{n} human task/approval checkpoint(s) detected"))
    else:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, "No human task/approval activities detected in the current implementation"))
    if biz.mandatory_approval == TriState.YES:
        score = max(score, 90)
        evidence.append(_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN, "Business Context confirms mandatory human approval is required"))
    elif biz.mandatory_approval == TriState.NO:
        evidence.append(_ev(EvidenceType.BUSINESS, "Business Context", Confidence.KNOWN, "Business Context confirms no mandatory approval requirement"))
    return DimensionScore(
        dimension="human_approval_need", label="Human Approval Need", score=score, level=level_from_score(score),
        confidence=Level.HIGH if (n or biz.mandatory_approval != TriState.UNKNOWN) else Level.MEDIUM, evidence=evidence,
        explanation="A human must remain in the loop for key decisions." if score >= 60 else "No confirmed requirement for a human checkpoint was found.",
    )


def score_exception_complexity(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    steps = pm.all_steps()
    if not steps:
        return _no_evidence("exception_complexity", "Exception Complexity", "no activities parsed")
    handled = bool(pm.exception_paths)
    has_retry = any(ep.has_retry for ep in pm.exception_paths)
    rethrow = any(ep.kind == "rethrow" for ep in pm.exception_paths)
    if not handled:
        score, evidence, explanation = 85, [_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, "No exception handling detected across the workflow")], "Failure modes are undefined; exceptions would surface unhandled."
    elif has_retry and not rethrow:
        score, evidence, explanation = 25, [_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{len(pm.exception_paths)} exception path(s) with a retry scope, no bare rethrow")], "Exceptions appear deterministic and recoverable."
    else:
        score, evidence, explanation = 55, [_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{len(pm.exception_paths)} exception path(s) detected")], "Some exception paths exist but recoverability is unclear."
    return DimensionScore(
        dimension="exception_complexity", label="Exception Complexity", score=score, level=level_from_score(score),
        confidence=Level.MEDIUM, evidence=evidence, explanation=explanation,
    )


def score_dependency_complexity(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    unknown_deps = [d for d in pm.dependencies if d.confidence == Confidence.UNKNOWN]
    total_deps = len(pm.dependencies) + len(pm.systems)
    if total_deps == 0:
        return _no_evidence("dependency_complexity", "Dependency Complexity", "no dependencies or external systems detected")
    score = min(100, total_deps * 6 + len(unknown_deps) * 10)
    evidence = [
        _ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{len(pm.dependencies)} package/workflow dependency(ies)"),
        _ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.KNOWN, f"{len(pm.systems)} distinct external system(s)"),
    ]
    if unknown_deps:
        evidence.append(_ev(EvidenceType.TECHNICAL, "parsed workflow", Confidence.UNKNOWN, f"{len(unknown_deps)} unresolved dependency(ies) with UNKNOWN confidence"))
    return DimensionScore(
        dimension="dependency_complexity", label="Dependency Complexity", score=score, level=level_from_score(score),
        confidence=_confidence_for(len(evidence), True), evidence=evidence,
        explanation="The process depends on many external systems/components." if score >= 60 else "Dependencies are limited and well understood.",
    )


def score_runtime_stability(pm: ProcessModel, biz: Optional[BusinessContext] = None) -> DimensionScore:
    ev = pm.runtime_evidence
    if ev is None or ev.success_rate is None:
        return DimensionScore(
            dimension="runtime_stability", label="Runtime Stability", score=0, level=Level.LOW, confidence=Level.LOW,
            evidence=[], explanation="INSUFFICIENT EVIDENCE — no runtime/Orchestrator data has been supplied for this process.",
        )
    score = int(ev.success_rate * 100)
    evidence = [_ev(EvidenceType.RUNTIME, "Runtime Evidence", Confidence.KNOWN, f"Supplied runtime success rate: {ev.success_rate:.1%}")]
    if ev.volume:
        evidence.append(_ev(EvidenceType.RUNTIME, "Runtime Evidence", Confidence.KNOWN, f"Observed volume: {ev.volume}"))
    return DimensionScore(
        dimension="runtime_stability", label="Runtime Stability", score=score, level=level_from_score(score),
        confidence=Level.HIGH, evidence=evidence,
        explanation="Runtime evidence shows stable execution." if score >= 70 else "Runtime evidence shows meaningful instability.",
    )


def process_has_mutating_authority(pm: ProcessModel) -> bool:
    """Whether the process can mutate production state at all — used by the
    recommendation engine to decide whether missing Business Context is
    even relevant (a read-only report has no blast radius to be unsure about)."""
    steps = pm.all_steps()
    return any(s.activity_type in _MUTATING_TAGS or (s.api and (s.api.method or "").upper() in _MUTATING_METHODS) for s in steps)


class ExecutionSurfaceProfile:
    """Breakdown of *what kind* of execution surfaces are available, used by
    the recommendation engine to pick a Migration Pattern (Section 11) —
    shared with `score_execution_tool_readiness` so the two never disagree
    about what counts as an API vs. a bounded subprocess vs. brittle UI."""

    def __init__(self, pm: ProcessModel) -> None:
        all_steps = pm.all_steps()
        invoked_names = {inv for wf in pm.workflows for inv in wf.invokes}
        self.bounded_subprocess_files = {wf.file for wf in pm.workflows if wf.file in invoked_names and wf.arguments}
        self.api_steps = [s for s in all_steps if s.category == NodeCategory.API_TOOL]
        self.db_queue_steps = [s for s in all_steps if s.activity_type in (_DB_TAGS | _QUEUE_TAGS)]
        self.stable_ui_steps, self.brittle_ui_steps = [], []
        for wf in pm.workflows:
            bucket = self.stable_ui_steps if wf.file in self.bounded_subprocess_files else self.brittle_ui_steps
            bucket.extend(s for s in wf.steps if s.selector is not None)

    @property
    def has_bounded_subprocesses(self) -> bool:
        return bool(self.bounded_subprocess_files)

    @property
    def has_apis(self) -> bool:
        return bool(self.api_steps)

    @property
    def api_dominant(self) -> bool:
        """APIs outnumber bounded-subprocess UI steps as the primary stable surface."""
        return len(self.api_steps) >= len(self.stable_ui_steps)


DIMENSION_SCORERS = {
    "current_ai_usage": score_current_ai_usage,
    "reasoning_opportunity": score_reasoning_opportunity,
    "determinism_value": score_determinism_value,
    "blast_radius": score_blast_radius,
    "reversibility": score_reversibility,
    "compliance_sensitivity": score_compliance_sensitivity,
    "observability": score_observability,
    "execution_tool_readiness": score_execution_tool_readiness,
    "data_readiness": score_data_readiness,
    "human_approval_need": score_human_approval_need,
    "exception_complexity": score_exception_complexity,
    "dependency_complexity": score_dependency_complexity,
    "runtime_stability": score_runtime_stability,
}
