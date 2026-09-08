"""XAML activity parsing.

UiPath workflows are .NET Workflow Foundation XAML. Real compiled XAML can
be dense (VirtualizedContainerService hints, generic type arguments, etc.)
but the activity tree structure — nested container activities holding leaf
activities, with a `DisplayName` attribute and a namespace prefix that maps
back to the owning activity package — is stable and is what this module
relies on. Anything this walker cannot classify is surfaced as `UNKNOWN`
rather than guessed (Rule 4) — see `docs/uipath-parser.md` for known
limitations against real-world compiled XAML.
"""
from __future__ import annotations

import itertools
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from packages.shared.canonical import (
    ApiCall,
    Argument,
    Evidence,
    ExceptionPath,
    HumanCheckpoint,
    Selector,
    Step,
    Variable,
    Workflow,
)
from packages.shared.enums import Confidence, NodeCategory

# Container activities: their children are walked recursively rather than
# treated as leaf steps themselves, but they still appear as a Step so the
# flow diagram can show grouping (Section 7: "grouped subprocesses").
CONTAINER_TAGS = {
    "Sequence", "Flowchart", "StateMachine", "TryCatch", "If", "Switch",
    "ForEach", "ForEachRow", "While", "DoWhile", "Parallel", "ParallelForEach",
    "PickBranch", "Pick", "RetryScope", "State",
    # UiPath "scope" activities: attach/open a target application and hold
    "BrowserScope", "WindowScope", "AttachBrowser", "AttachWindow",
    # nested activities in a `.Body` — structurally containers even though
    # they aren't core Workflow Foundation control-flow tags.
    "ExcelApplicationScope", "ExcelProcessScope", "UseApplicationBrowser",
}

# Transparent WF/XAML plumbing wrappers: never real activities, but their
# children must still be walked (unlike pure metadata — see the generic
# "." skip below). `Members` holds a compiled workflow's root argument
# declarations; `ActivityAction`/`ActivityFunc` are the lambda-body wrapper
# every `.Body`-holding scope activity compiles to.
TRANSPARENT_WRAPPER_TAGS = {"Members", "ActivityAction", "ActivityFunc"}

# Disabled/commented-out activities: present in the XAML for the developer's
# reference but never executed. Counting their contents as real steps would
# misrepresent the process (Rule 4 cuts both ways — don't invent activity
# that doesn't run). The whole subtree is skipped, unlike a transparent
# wrapper.
DISABLED_TAGS = {"CommentOut"}

UI_AUTOMATION_TAGS = {
    "Click", "TypeInto", "GetText", "SendHotkey", "SelectItem", "CheckBox",
    "Highlight", "ElementExists", "GetAttribute", "Hover", "SetText",
    "OpenBrowser", "OpenApplication", "MaximizeWindow", "MinimizeWindow",
    "CloseWindow", "CloseTab", "CloseApplication", "KeyboardShortcut",
    "WaitElementVanish", "FindElement", "ScrollTo",
}

API_TAGS = {
    "HTTPRequest", "HttpClient", "RestRequest", "WebAPIRequest", "HttpRequest",
}

REASONING_TAGS = {
    "InvokeLLM", "GenerateText", "ClassifyDocument", "DataExtractionScope",
    "DocumentClassification", "ExtractEntities", "ChatCompletion",
    "SummarizeText",
}

HUMAN_TAGS = {
    "CreateTask", "WaitForFormTask", "AssignTask", "CreateFormTask",
    "WaitTaskAndResume", "CreateExternalTask",
}

RISK_TAGS = {"Throw", "Rethrow", "TerminateWorkflow"}

QUEUE_TAGS = {"AddQueueItem", "GetQueueItems", "GetTransactionItem", "AddTransactionItem"}
ASSET_TAGS = {"GetAsset", "SetAsset", "GetCredential", "GetPassword", "GetUserName", "GetRobotAsset"}
EXCEL_TAGS = {
    "ExcelApplicationScope", "ReadRange", "WriteRange", "ReadCell", "WriteCell",
    "ExcelReadRange", "ExcelWriteRange", "ExcelReadCell", "ExcelWriteCell",
    "AppendRange", "ExtractData", "FilterDataTable", "SortDataTable",
}
MAIL_TAGS = {"SendOutlookMailMessage", "SendMailMessage", "GetOutlookMailMessages", "GetIMAPMailMessages"}
DB_TAGS = {"ExecuteQuery", "ExecuteNonQuery", "DatabaseConnect"}
INVOKE_WORKFLOW_TAGS = {"InvokeWorkflowFile"}
ASSIGN_TAGS = {"Assign", "MultipleAssign"}
LOG_TAGS = {"LogMessage", "WriteLine"}

_NS_ASSEMBLY_RE = re.compile(r"assembly=([\w.]+)")


def local_tag(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def namespace_assembly_map(xml_text: str) -> dict[str, str]:
    """Best-effort prefix -> assembly name map from xmlns declarations."""
    mapping: dict[str, str] = {}
    for m in re.finditer(r'xmlns:([\w]+)="([^"]+)"', xml_text):
        prefix, uri = m.group(1), m.group(2)
        asm = _NS_ASSEMBLY_RE.search(uri)
        if asm:
            mapping[prefix] = asm.group(1)
    return mapping


def classify(tag: str) -> NodeCategory:
    if tag in API_TAGS:
        return NodeCategory.API_TOOL
    if tag in REASONING_TAGS:
        return NodeCategory.REASONING
    if tag in HUMAN_TAGS:
        return NodeCategory.HUMAN_APPROVAL
    if tag in RISK_TAGS:
        return NodeCategory.RISK
    if tag in (
        UI_AUTOMATION_TAGS | CONTAINER_TAGS | QUEUE_TAGS | ASSET_TAGS | EXCEL_TAGS
        | MAIL_TAGS | DB_TAGS | INVOKE_WORKFLOW_TAGS | ASSIGN_TAGS | LOG_TAGS
    ):
        return NodeCategory.DETERMINISTIC
    return NodeCategory.UNKNOWN


@dataclass
class _Counter:
    n: itertools.count = field(default_factory=itertools.count)

    def next(self, prefix: str) -> str:
        return f"{prefix}_{next(self.n)}"


def parse_xaml_file(path: Path) -> tuple[Workflow, list[str]]:
    """Parse one .xaml file into a Workflow. Returns (workflow, warnings)."""
    warnings: list[str] = []
    text = path.read_text(encoding="utf-8", errors="replace")

    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        warnings.append(f"{path.name}: XML parse error ({e}); workflow treated as empty")
        return Workflow(file=path.name, display_name=path.stem), warnings

    counter = _Counter()
    steps: list[Step] = []
    variables: list[Variable] = []
    arguments: list[Argument] = []
    invokes: list[str] = []

    def add_variable(el: ET.Element) -> None:
        name = el.get("Name")
        type_args = el.get("{http://schemas.microsoft.com/winfx/2006/xaml}TypeArguments") or el.get("TypeArguments")
        if name:
            variables.append(Variable(name=name, type_hint=type_args))

    def add_argument(name: str, direction: str, type_hint: str | None) -> None:
        arguments.append(Argument(name=name, direction=direction, type_hint=type_hint))

    def walk(el: ET.Element, parent_step: Step | None) -> str | None:
        tag = local_tag(el.tag)

        if tag.endswith(".Variables"):
            for child in el:
                if local_tag(child.tag) == "Variable":
                    add_variable(child)
            return None

        if tag in ("Sequence.Variables",):
            return None

        if tag == "Variable":
            add_variable(el)
            return None

        if tag in ("Property", "InArgument", "OutArgument", "InOutArgument"):
            # property declarations on the root Activity element
            name = el.get("Name") or el.get("DisplayName")
            direction = {"InArgument": "In", "OutArgument": "Out", "InOutArgument": "InOut"}.get(tag, "Property")
            if name:
                add_argument(name, direction, el.get("Type"))
            return None

        if tag in DISABLED_TAGS:
            # Disabled/commented-out activity: present in the file but never
            # executed. Skip the whole subtree — do not recurse — so its
            # contents never appear as steps or count toward any dimension.
            return None

        if tag in TRANSPARENT_WRAPPER_TAGS:
            # Real Studio-compiled XAML declares the root workflow's
            # arguments as <x:Members><x:Property .../></x:Members>, and
            # every `.Body`-holding scope activity compiles its nested
            # content through an <ActivityAction>/<ActivityFunc> lambda
            # wrapper. Recurse so real children are still captured, without
            # creating a spurious Step for the wrapper itself.
            for child in el:
                walk(child, parent_step)
            return None

        # Property-element syntax like <TryCatch.Try>, <If.Then>, and the
        # <SomeActivity.Body> pattern real UiPath scope/container activities
        # (OpenBrowser, ExcelApplicationScope, custom scopes, ...) use to
        # hold their nested ActivityAction body — recurse into children
        # without creating a Step for the wrapper itself, since real
        # automation logic lives inside a `.Body`/`.Then`/`.Try` regardless
        # of whether the owning activity is a core WF container we know by
        # name (Rule 4 cuts both ways: don't invent steps, but don't
        # silently drop real ones either).
        if "." in tag and (tag.split(".")[0] in CONTAINER_TAGS | {"If", "Switch"} or tag.endswith(".Body")):
            child_ids: list[str] = []
            for child in el:
                cid = walk(child, parent_step)
                if cid:
                    child_ids.append(cid)
            if parent_step is not None:
                parent_step.children.extend(child_ids)
            return None

        # Any other property-element / attached-property syntax (e.g.
        # <TextExpression.NamespacesForImplementation>,
        # <mva:VisualBasic.Settings>, <sap:VirtualizedContainerService.HintSize>,
        # <ui:Click.Target>, <ui:CursorPosition.OffsetX>,
        # <ActivityAction.Argument>) is WPF/XAML compilation metadata or
        # activity *configuration* (selector targets, cursor offsets, view
        # state) — never a nested workflow activity. Real Studio-compiled
        # XAML is full of this. Skip the whole subtree rather than walking
        # it as if its children were steps (Rule 4: don't misrepresent
        # metadata as automation logic).
        if "." in tag:
            return None

        if tag == "Activity":
            # root wrapper — not a step, just recurse
            for child in el:
                walk(child, None)
            return None

        display_name = el.get("DisplayName", tag)
        category = classify(tag)
        step_id = counter.next(tag)
        step = Step(
            id=step_id,
            display_name=display_name,
            activity_type=tag,
            category=category,
            confidence=Confidence.KNOWN if category != NodeCategory.UNKNOWN else Confidence.UNKNOWN,
            is_container=tag in CONTAINER_TAGS,
        )

        selector_attr = el.get("Selector")
        if selector_attr:
            step.selector = Selector(raw=selector_attr[:500])
            step.evidence.append(Evidence(source=path.name, detail=f"Selector on {tag}", confidence=Confidence.KNOWN))

        if tag in INVOKE_WORKFLOW_TAGS:
            wf_ref = el.get("WorkflowFileName")
            if wf_ref:
                step.invoked_workflow = wf_ref
                invokes.append(wf_ref)
                step.evidence.append(Evidence(source=path.name, detail=f"InvokeWorkflowFile -> {wf_ref}", confidence=Confidence.KNOWN))

        if category == NodeCategory.API_TOOL:
            step.api = ApiCall(
                label=display_name,
                method=el.get("Method"),
                endpoint_hint=el.get("EndPoint") or el.get("Uri") or el.get("Url"),
                workflow=path.name,
            )
            step.evidence.append(Evidence(source=path.name, detail=f"API activity: {tag}", confidence=Confidence.KNOWN))

        if category == NodeCategory.HUMAN_APPROVAL:
            step.evidence.append(Evidence(source=path.name, detail=f"Human task activity: {tag}", confidence=Confidence.KNOWN))

        if category == NodeCategory.UNKNOWN:
            step.notes = "Unrecognized/custom activity; not analyzed beyond its tag name."
            step.evidence.append(Evidence(source=path.name, detail=f"Unclassified activity tag: {tag}", confidence=Confidence.UNKNOWN))
            warnings.append(f"{path.name}: unclassified activity <{tag}> ({display_name})")

        if category == NodeCategory.RISK:
            step.risks.append(f"{tag} may terminate or rethrow without recovery")

        steps.append(step)

        child_ids = []
        for child in el:
            cid = walk(child, step)
            if cid:
                child_ids.append(cid)
        step.children.extend(child_ids)

        return step_id

    top_ids = []
    for child in root if local_tag(root.tag) == "Activity" else [root]:
        cid = walk(child, None)
        if cid:
            top_ids.append(cid)
    if local_tag(root.tag) != "Activity":
        pass

    # sequential `next` links between siblings at the top of the tree, and
    # within each container's children — approximates execution order for
    # the flow diagram without a full WF-runtime interpretation.
    id_to_step = {s.id: s for s in steps}
    for step in steps:
        kids = step.children
        for a, b in zip(kids, kids[1:]):
            if a in id_to_step:
                id_to_step[a].next.append(b)
    for a, b in zip(top_ids, top_ids[1:]):
        if a in id_to_step:
            id_to_step[a].next.append(b)

    return (
        Workflow(
            file=path.name,
            display_name=path.stem,
            steps=steps,
            variables=variables,
            arguments=arguments,
            invokes=list(dict.fromkeys(invokes)),
        ),
        warnings,
    )


def find_exception_paths(workflow: Workflow) -> list[ExceptionPath]:
    paths: list[ExceptionPath] = []
    has_retry = any(s.activity_type == "RetryScope" for s in workflow.steps)
    for step in workflow.steps:
        if step.activity_type == "TryCatch":
            paths.append(
                ExceptionPath(
                    workflow=workflow.file,
                    kind="try_catch",
                    has_retry=has_retry,
                    evidence=[Evidence(source=workflow.file, detail="TryCatch activity present", confidence=Confidence.KNOWN)],
                )
            )
        if step.activity_type == "Rethrow":
            paths.append(
                ExceptionPath(
                    workflow=workflow.file,
                    kind="rethrow",
                    evidence=[Evidence(source=workflow.file, detail="Rethrow activity present", confidence=Confidence.KNOWN)],
                )
            )
    return paths


def find_human_checkpoints(workflow: Workflow) -> list[HumanCheckpoint]:
    checkpoints = []
    for step in workflow.steps:
        if step.category == NodeCategory.HUMAN_APPROVAL:
            checkpoints.append(
                HumanCheckpoint(
                    workflow=workflow.file,
                    step_id=step.id,
                    description=step.display_name,
                    evidence=step.evidence,
                )
            )
    return checkpoints
