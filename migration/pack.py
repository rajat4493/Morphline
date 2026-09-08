"""Migration pack generation (Section 17).

First-pass artifacts only — never claims production-ready automatic
migration. Distinguishes AGENT REASONING / DETERMINISTIC TOOL / API /
RPA STEP / HUMAN APPROVAL / CONTROL-GUARDRAIL explicitly in the target
architecture output.
"""
from __future__ import annotations

import json

from packages.shared.canonical import ProcessModel
from packages.shared.enums import NodeCategory
from packages.shared.memory_types import ConstraintRecord
from packages.shared.recommendation_types import RecommendationResult
from packages.shared.scoring_types import DimensionScore

_CATEGORY_ARCH_LABEL = {
    NodeCategory.DETERMINISTIC: "RPA STEP / DETERMINISTIC TOOL",
    NodeCategory.REASONING: "AGENT REASONING",
    NodeCategory.API_TOOL: "API",
    NodeCategory.HUMAN_APPROVAL: "HUMAN APPROVAL",
    NodeCategory.RISK: "CONTROL / GUARDRAIL (risk point — needs a guardrail)",
    NodeCategory.UNKNOWN: "UNRESOLVED — requires architect review",
}


def _current_process_md(pm: ProcessModel) -> str:
    lines = [f"# Current Process: {pm.project_name}", "", f"Entry point: `{pm.entry_point or 'UNKNOWN'}`", "", "## Workflows"]
    for wf in pm.workflows:
        lines.append(f"- `{wf.file}`{' (entry point)' if wf.is_entry_point else ''} — {len(wf.steps)} activities")
    lines += ["", "## Systems touched"]
    for sysobj in pm.systems:
        lines.append(f"- {sysobj.name} ({sysobj.interaction_mode})")
    if pm.parser_warnings:
        lines += ["", "## Parser warnings"]
        lines += [f"- {w}" for w in pm.parser_warnings]
    return "\n".join(lines) + "\n"


def _target_architecture_md(pm: ProcessModel, rec: RecommendationResult) -> str:
    lines = [
        f"# Target Architecture: {pm.project_name}",
        "",
        f"Recommended state: **{rec.recommended_state.label}** (maximum safe state today: {rec.maximum_safe_state.label})",
        "",
        "## Why this state", "",
    ]
    lines += [f"- {r}" for r in rec.why_this]
    lines += ["", "## Why not further", ""]
    lines += [f"- {b}" for b in rec.why_not_further]
    lines += ["", "## Component classification (by current step)", ""]
    for wf in pm.workflows:
        for step in wf.steps:
            lines.append(f"- `{wf.file}` :: {step.display_name} ({step.activity_type}) → **{_CATEGORY_ARCH_LABEL[step.category]}**")
    return "\n".join(lines) + "\n"


def _migration_backlog_md(pm: ProcessModel, constraints: list[ConstraintRecord]) -> str:
    lines = [f"# Migration Backlog: {pm.project_name}", "", "First-pass backlog derived from active constraints. Not production-ready.", ""]
    for c in constraints:
        lines.append(f"- [ ] ({c.severity.value}) {c.category.value.replace('_', ' ').title()}: {c.description}")
    if not constraints:
        lines.append("- No active constraints — proceed to detailed design review.")
    return "\n".join(lines) + "\n"


def _guardrails_md(rec: RecommendationResult) -> str:
    lines = ["# Guardrails", "", "Derived from active blockers; refine with an architect before implementation.", ""]
    for b in rec.why_not_further:
        lines.append(f"- Guardrail needed for: {b}")
    lines.append("- All irreversible actions must pass through the deterministic execution layer, never direct agent action.")
    return "\n".join(lines) + "\n"


def _human_approval_points_md(pm: ProcessModel) -> str:
    lines = ["# Human Approval Points", ""]
    if not pm.human_checkpoints:
        lines.append("No existing human checkpoints detected in the current implementation. "
                      "Add at least one for any irreversible or high-blast-radius action before evolving beyond Hybrid Agent.")
    for hc in pm.human_checkpoints:
        lines.append(f"- `{hc.workflow}` :: {hc.description}")
    return "\n".join(lines) + "\n"


def _test_strategy_md(rec: RecommendationResult) -> str:
    return "\n".join([
        "# Test Strategy",
        "",
        f"Target state: {rec.recommended_state.label}",
        "",
        "- Golden-path regression tests against the deterministic execution layer.",
        "- Shadow-mode comparison: run the agentic path alongside the existing RPA path before cutover.",
        "- Human-in-the-loop review of the first N agent recommendations before enabling auto-approval.",
        "- Rollback drill: confirm the compensating/rollback action for every mutating step.",
    ]) + "\n"


def _target_tool_candidates_json(pm: ProcessModel) -> dict:
    return {
        "apis_detected": [a.model_dump() for a in pm.apis],
        "systems": [s.model_dump() for s in pm.systems],
        "note": "Candidates only. Confirm real API availability/permissions before implementation.",
    }


def generate_pack(
    pm: ProcessModel,
    scores: dict[str, DimensionScore],
    rec: RecommendationResult,
    active_constraints: list[ConstraintRecord],
) -> dict[str, str]:
    """Returns {filename: text_content} for the 11 migration pack files."""
    return {
        "current_process.md": _current_process_md(pm),
        "process_model.json": pm.model_dump_json(indent=2),
        "assessment.json": json.dumps({d: s.model_dump() for d, s in scores.items()}, indent=2, default=str),
        "target_architecture.md": _target_architecture_md(pm, rec),
        "migration_backlog.md": _migration_backlog_md(pm, active_constraints),
        "constraints.json": json.dumps([c.model_dump() for c in active_constraints], indent=2, default=str),
        "evidence.json": json.dumps(
            {d: s.evidence for d, s in scores.items()}, indent=2, default=str
        ),
        "target_tool_candidates.json": json.dumps(_target_tool_candidates_json(pm), indent=2, default=str),
        "guardrails.md": _guardrails_md(rec),
        "human_approval_points.md": _human_approval_points_md(pm),
        "test_strategy.md": _test_strategy_md(rec),
    }
