"""Phase 3: Enterprise Transformation Architecture. Locked TheDuck rule for
this phase: Morphline must never recommend a platform just because it
exists in the customer's stack — it must explain why that platform owns
the responsibility, and when more than one candidate could plausibly own
it, refuse to guess rather than pick arbitrarily."""
from pathlib import Path

from architecture.plan import generate_target_architecture, summarize_estate_architecture
from packages.shared.architecture_types import GuardrailType, MigrationStepStatus, PlatformProfile, PlatformRole
from packages.shared.business_context import BusinessContext
from parser.uipath.parse import parse_project
from recommendation.engine import recommend
from scoring.engine import score_process

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"

_FULL_CATALOG = [
    PlatformProfile(name="AWS Bedrock", role=PlatformRole.REASONING),
    PlatformProfile(name="AWS AgentCore", role=PlatformRole.AGENT_RUNTIME),
    PlatformProfile(name="n8n", role=PlatformRole.ORCHESTRATION),
    PlatformProfile(name="UiPath", role=PlatformRole.BOUNDED_EXECUTION),
    PlatformProfile(name="OutSystems", role=PlatformRole.HUMAN_APPROVAL),
    PlatformProfile(name="Internal API Gateway", role=PlatformRole.API_GATEWAY),
    PlatformProfile(name="Enterprise Database", role=PlatformRole.DATABASE),
    PlatformProfile(name="Enterprise Queue", role=PlatformRole.QUEUE),
    PlatformProfile(name="Enterprise Observability", role=PlatformRole.OBSERVABILITY),
]


def _plan(fixture: str, catalog=_FULL_CATALOG, biz: BusinessContext | None = None):
    pm = parse_project(FIXTURES / fixture, "zip")
    scores = score_process(pm, biz)
    rec = recommend(pm, scores, biz)
    return generate_target_architecture(1, fixture, pm, scores, rec, biz, catalog)


def test_agentic_automation_gets_reasoning_and_agent_runtime_components():
    plan = _plan("customer_exclusion")
    roles = {c.role for c in plan.components}
    assert PlatformRole.REASONING in roles
    assert PlatformRole.AGENT_RUNTIME in roles
    reasoning = next(c for c in plan.components if c.role == PlatformRole.REASONING)
    assert reasoning.platform == "AWS Bedrock"
    assert not reasoning.manual_decision_required
    assert "HYBRID_WITH_HUMAN_APPROVAL" in reasoning.justification or "requires interpreting ambiguous cases" in reasoning.justification


def test_deterministic_automation_gets_no_reasoning_component():
    """A purely deterministic recommendation must never get a REASONING/
    AGENT_RUNTIME component just because the catalog has one registered —
    the role must actually be needed first."""
    plan = _plan("nightly_reconciliation")
    roles = {c.role for c in plan.components}
    assert PlatformRole.REASONING not in roles
    assert PlatformRole.AGENT_RUNTIME not in roles


def test_ambiguous_role_is_never_guessed():
    """Two equally-plausible REASONING platforms in the catalog must never
    be silently resolved to one — this is the core TheDuck rule for this
    phase."""
    catalog = [
        PlatformProfile(name="AWS Bedrock", role=PlatformRole.REASONING),
        PlatformProfile(name="Azure OpenAI", role=PlatformRole.REASONING),
    ]
    plan = _plan("customer_exclusion", catalog=catalog)
    reasoning = next(c for c in plan.components if c.role == PlatformRole.REASONING)
    assert reasoning.platform is None
    assert reasoning.manual_decision_required is True
    assert set(reasoning.candidates) == {"AWS Bedrock", "Azure OpenAI"}
    assert plan.confidence.value == "LOW"
    assert any("REASONING" in u for u in plan.unresolved_factors)


def test_missing_catalog_role_is_a_flagged_gap_not_a_silent_skip():
    """A role the automation genuinely needs, with zero catalog platforms
    registered for it, must show up as a gap requiring a decision — not
    silently vanish from the plan."""
    catalog = [PlatformProfile(name="AWS Bedrock", role=PlatformRole.REASONING)]
    plan = _plan("customer_exclusion", catalog=catalog)
    agent_runtime = next((c for c in plan.components if c.role == PlatformRole.AGENT_RUNTIME), None)
    assert agent_runtime is not None
    assert agent_runtime.manual_decision_required is True
    assert agent_runtime.platform is None


def test_existing_bounded_subprocess_is_preserved_not_rewritten():
    """Per locked product principle, existing UiPath subprocesses remain
    valid tools — the migration sequence must mark 'wrap as bounded tools'
    ALREADY_TRUE when a bounded subprocess already exists, not REQUIRED."""
    plan = _plan("ui_heavy_reusable_tools")
    wrap_step = next((s for s in plan.migration_sequence if "bounded tools" in s.title.lower()), None)
    assert wrap_step is not None
    assert wrap_step.status == MigrationStepStatus.ALREADY_TRUE


def test_reversibility_guardrails_only_appear_when_reversibility_is_actually_weak():
    plan_risky = _plan("customer_exclusion")
    risky_types = {g.type for g in plan_risky.guardrails}
    assert GuardrailType.IDEMPOTENCY in risky_types
    assert GuardrailType.ROLLBACK in risky_types

    plan_safe = _plan("internal_report")
    safe_types = {g.type for g in plan_safe.guardrails}
    assert GuardrailType.IDEMPOTENCY not in safe_types


def test_reasoning_introduction_always_carries_tool_allowlist_and_no_direct_credentials():
    plan = _plan("customer_exclusion")
    types = {g.type for g in plan.guardrails}
    assert GuardrailType.TOOL_ALLOWLIST in types
    assert GuardrailType.NO_DIRECT_MODEL_CREDENTIALS in types


def test_migration_sequence_never_proposes_shadow_run_when_nothing_changes():
    """If recommended state equals current state, there is nothing to
    shadow-run or gradually cut over — those steps must not appear."""
    plan = _plan("nightly_reconciliation")
    if plan.recommended_state == plan.current_summary:
        titles = {s.title for s in plan.migration_sequence}
        assert "Shadow-run against current execution" not in titles


def test_estate_architecture_summary_counts_platforms_across_automations():
    """The estate rollup ('N automations resolve to platform X for role
    Y') must aggregate real per-automation plans, not re-derive counts from
    scratch."""
    plans = [_plan("customer_exclusion"), _plan("ui_heavy_reusable_tools"), _plan("nightly_reconciliation")]
    summary = summarize_estate_architecture(plans, PlatformRole.REASONING)
    assert summary.platform_counts.get("AWS Bedrock") == 2  # customer_exclusion + ui_heavy_reusable_tools
    assert summary.total_automations == 2  # nightly_reconciliation doesn't need REASONING at all


def test_estate_summary_surfaces_manual_decisions_separately_from_confident_picks():
    catalog = [
        PlatformProfile(name="AWS Bedrock", role=PlatformRole.REASONING),
        PlatformProfile(name="Azure OpenAI", role=PlatformRole.REASONING),
    ]
    plans = [_plan("customer_exclusion", catalog=catalog), _plan("ui_heavy_reusable_tools", catalog=catalog)]
    summary = summarize_estate_architecture(plans, PlatformRole.REASONING)
    assert summary.manual_decision_count == 2
    assert summary.platform_counts == {}
