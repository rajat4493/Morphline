"""Canonical, platform-independent automation model.

This is the contract between any RPA-platform parser (today: UiPath) and
everything downstream (scoring, recommendation, memory, migration). Nothing
in this module may reference UiPath-specific concepts. See
`docs/canonical-model.md`.

The document produced here (`ProcessModel`) is stored as a single JSON blob
on the `ProcessVersion` database row — it is read/written as a whole rather
than normalized across dozens of tables, which is the right tradeoff for a
tree-shaped, mostly-read-together structure at this scale.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from packages.shared.enums import Confidence, NodeCategory


class Evidence(BaseModel):
    """A single piece of evidence backing a fact or a score."""

    source: str  # e.g. "Main.xaml", "project.json", "CustomerLookup.xaml"
    detail: str  # e.g. "Activity: Click", "Selector: ...", "dependency: UiPath.UIAutomation.Activities"
    confidence: Confidence = Confidence.KNOWN


class Selector(BaseModel):
    raw: str
    target_app: Optional[str] = None


class Variable(BaseModel):
    name: str
    type_hint: Optional[str] = None
    scope: Optional[str] = None  # workflow name it's declared in


class Argument(BaseModel):
    name: str
    direction: str  # In / Out / InOut / Property
    type_hint: Optional[str] = None


class ExceptionPath(BaseModel):
    workflow: str
    kind: str  # "try_catch" | "retry_scope" | "global_handler" | "rethrow"
    catch_type: Optional[str] = None
    has_retry: bool = False
    evidence: list[Evidence] = Field(default_factory=list)


class BusinessRule(BaseModel):
    workflow: str
    description: str
    evidence: list[Evidence] = Field(default_factory=list)


class HumanCheckpoint(BaseModel):
    workflow: str
    step_id: str
    description: str
    evidence: list[Evidence] = Field(default_factory=list)


class Queue(BaseModel):
    name: str
    evidence: list[Evidence] = Field(default_factory=list)


class Asset(BaseModel):
    name: str
    kind: Optional[str] = None  # Text / Credential / Integer / ...
    evidence: list[Evidence] = Field(default_factory=list)


class ApiCall(BaseModel):
    """A detected HTTP/API integration point."""

    label: str
    method: Optional[str] = None
    endpoint_hint: Optional[str] = None
    workflow: str
    evidence: list[Evidence] = Field(default_factory=list)


class System(BaseModel):
    """An external application/system the automation touches, e.g. SAP, Outlook."""

    name: str
    interaction_mode: str  # "ui_automation" | "api" | "file" | "database" | "email" | "unknown"
    evidence: list[Evidence] = Field(default_factory=list)


class Dependency(BaseModel):
    """A package or invoked-workflow dependency."""

    kind: str  # "package" | "invoked_workflow"
    name: str
    version: Optional[str] = None
    confidence: Confidence = Confidence.KNOWN
    evidence: list[Evidence] = Field(default_factory=list)


class Step(BaseModel):
    """One activity/node inside a workflow."""

    id: str
    display_name: str
    activity_type: str  # raw UiPath activity type name, e.g. "Click", "InvokeWorkflowFile"
    category: NodeCategory
    confidence: Confidence
    is_container: bool = False  # a structural container (Sequence/If/TryCatch/...), not a leaf activity
    selector: Optional[Selector] = None
    invoked_workflow: Optional[str] = None
    api: Optional[ApiCall] = None
    children: list[str] = Field(default_factory=list)  # ids of nested steps (for containers)
    next: list[str] = Field(default_factory=list)  # ids of sequential successors
    notes: Optional[str] = None
    risks: list[str] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)


class Workflow(BaseModel):
    """One XAML file."""

    file: str
    display_name: str
    is_entry_point: bool = False
    steps: list[Step] = Field(default_factory=list)
    variables: list[Variable] = Field(default_factory=list)
    arguments: list[Argument] = Field(default_factory=list)
    invokes: list[str] = Field(default_factory=list)  # other workflow files invoked


class RuntimeEvidence(BaseModel):
    """Only populated when explicitly supplied (never fabricated). See Section 24."""

    success_rate: Optional[float] = None
    failure_rate: Optional[float] = None
    median_duration_seconds: Optional[float] = None
    volume: Optional[int] = None
    selector_failure_rate: Optional[float] = None
    manual_correction_frequency: Optional[float] = None
    source: Optional[str] = None


class ProcessModel(BaseModel):
    """The full canonical document for one parsed process version."""

    project_name: str
    entry_point: Optional[str] = None
    workflows: list[Workflow] = Field(default_factory=list)
    dependencies: list[Dependency] = Field(default_factory=list)
    systems: list[System] = Field(default_factory=list)
    queues: list[Queue] = Field(default_factory=list)
    assets: list[Asset] = Field(default_factory=list)
    apis: list[ApiCall] = Field(default_factory=list)
    exception_paths: list[ExceptionPath] = Field(default_factory=list)
    business_rules: list[BusinessRule] = Field(default_factory=list)
    human_checkpoints: list[HumanCheckpoint] = Field(default_factory=list)
    runtime_evidence: Optional[RuntimeEvidence] = None
    parser_warnings: list[str] = Field(default_factory=list)
    source_kind: str = "unknown"  # "nupkg" | "zip" | "xaml" | "project_json"

    def all_steps(self) -> list[Step]:
        return [s for wf in self.workflows for s in wf.steps]
