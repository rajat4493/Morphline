"""Project-level UiPath parsing: relationship analysis across XAML files.

Turns a directory of extracted UiPath project content (or a single .xaml
file) into a canonical `ProcessModel`.
"""
from __future__ import annotations

import json
from pathlib import Path

from packages.shared.canonical import (
    Asset,
    Dependency,
    Evidence,
    ProcessModel,
    Queue,
    System,
    Workflow,
)
from packages.shared.enums import Confidence, NodeCategory
from parser.uipath.xaml import (
    ASSET_TAGS,
    DB_TAGS,
    EXCEL_TAGS,
    MAIL_TAGS,
    QUEUE_TAGS,
    find_exception_paths,
    find_human_checkpoints,
    namespace_assembly_map,
    parse_xaml_file,
)

_SYSTEM_HINTS: dict[str, tuple[str, str]] = {
    "sap": ("SAP", "ui_automation"),
    "excel": ("Excel", "file"),
    "outlook": ("Outlook", "email"),
    "mail": ("Email", "email"),
    "salesforce": ("Salesforce", "api"),
    "workday": ("Workday", "api"),
}


def _guess_system_from_selector(raw_selector: str) -> str | None:
    lowered = raw_selector.lower()
    for hint, (name, _mode) in _SYSTEM_HINTS.items():
        if hint in lowered:
            return name
    return None


def _read_project_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError):
        return {}


def parse_project(root: Path, source_kind: str) -> ProcessModel:
    warnings: list[str] = []

    if root.is_file() and root.suffix.lower() == ".xaml":
        xaml_files = [root]
        project_json_path = None
        project_root = root.parent
    else:
        project_root = root
        xaml_files = sorted(root.rglob("*.xaml"))
        candidates = list(root.rglob("project.json"))
        project_json_path = candidates[0] if candidates else None

    project_meta = _read_project_json(project_json_path) if project_json_path else {}
    project_name = project_meta.get("name") or (root.stem if root.is_file() else root.name)
    entry_point = project_meta.get("main")

    dependencies: list[Dependency] = []
    for pkg_name, pkg_version in (project_meta.get("dependencies") or {}).items():
        dependencies.append(
            Dependency(
                kind="package",
                name=pkg_name,
                version=str(pkg_version),
                confidence=Confidence.KNOWN,
                evidence=[Evidence(source="project.json", detail=f"dependency: {pkg_name}", confidence=Confidence.KNOWN)],
            )
        )

    if not xaml_files:
        warnings.append("No .xaml files found in the uploaded package.")

    workflows: list[Workflow] = []
    systems: dict[str, System] = {}
    queues: dict[str, Queue] = {}
    assets: dict[str, Asset] = {}
    apis = []
    exception_paths = []
    business_rules: list = []
    human_checkpoints = []
    seen_assembly_deps: set[str] = set()

    for xaml_path in xaml_files:
        workflow, wf_warnings = parse_xaml_file(xaml_path)
        warnings.extend(wf_warnings)
        workflows.append(workflow)
        exception_paths.extend(find_exception_paths(workflow))
        human_checkpoints.extend(find_human_checkpoints(workflow))

        text = xaml_path.read_text(encoding="utf-8", errors="replace")
        for _prefix, assembly in namespace_assembly_map(text).items():
            if assembly not in seen_assembly_deps and assembly.startswith("UiPath."):
                seen_assembly_deps.add(assembly)
                already_known = any(d.name == assembly for d in dependencies)
                if not already_known:
                    dependencies.append(
                        Dependency(
                            kind="package",
                            name=assembly,
                            confidence=Confidence.INFERRED,
                            evidence=[Evidence(source=xaml_path.name, detail=f"xmlns assembly reference: {assembly}", confidence=Confidence.INFERRED)],
                        )
                    )

        for step in workflow.steps:
            if step.selector:
                sys_name = _guess_system_from_selector(step.selector.raw)
                if sys_name:
                    sysobj = systems.setdefault(
                        sys_name,
                        System(name=sys_name, interaction_mode="ui_automation", evidence=[]),
                    )
                    sysobj.evidence.append(
                        Evidence(source=xaml_path.name, detail=f"Selector referencing {sys_name} in {step.activity_type}", confidence=Confidence.INFERRED)
                    )
                else:
                    sysobj = systems.setdefault(
                        "Unidentified UI Application",
                        System(name="Unidentified UI Application", interaction_mode="ui_automation", evidence=[]),
                    )
                    sysobj.evidence.append(
                        Evidence(source=xaml_path.name, detail=f"UI selector on {step.activity_type} with no identifiable target application", confidence=Confidence.UNKNOWN)
                    )

            if step.api:
                apis.append(step.api)
                host = step.api.endpoint_hint or "unspecified endpoint"
                sysobj = systems.setdefault(host, System(name=host, interaction_mode="api", evidence=[]))
                sysobj.evidence.append(Evidence(source=xaml_path.name, detail=f"API call: {step.activity_type} {step.api.method or ''}".strip(), confidence=Confidence.KNOWN))

            if step.activity_type in QUEUE_TAGS:
                qname = step.display_name
                q = queues.setdefault(qname, Queue(name=qname, evidence=[]))
                q.evidence.append(Evidence(source=xaml_path.name, detail=f"{step.activity_type} on queue '{qname}'", confidence=Confidence.KNOWN))

            if step.activity_type in ASSET_TAGS:
                aname = step.display_name
                a = assets.setdefault(aname, Asset(name=aname, evidence=[]))
                a.evidence.append(Evidence(source=xaml_path.name, detail=f"{step.activity_type} referencing asset '{aname}'", confidence=Confidence.KNOWN))

            if step.activity_type in EXCEL_TAGS:
                sysobj = systems.setdefault("Excel", System(name="Excel", interaction_mode="file", evidence=[]))
                sysobj.evidence.append(Evidence(source=xaml_path.name, detail=f"{step.activity_type} activity", confidence=Confidence.KNOWN))

            if step.activity_type in MAIL_TAGS:
                sysobj = systems.setdefault("Email", System(name="Email", interaction_mode="email", evidence=[]))
                sysobj.evidence.append(Evidence(source=xaml_path.name, detail=f"{step.activity_type} activity", confidence=Confidence.KNOWN))

            if step.activity_type in DB_TAGS:
                sysobj = systems.setdefault("Database", System(name="Database", interaction_mode="database", evidence=[]))
                sysobj.evidence.append(Evidence(source=xaml_path.name, detail=f"{step.activity_type} activity", confidence=Confidence.KNOWN))

    # invoked-workflow dependency edges
    file_by_name = {wf.file: wf for wf in workflows}
    for wf in workflows:
        for invoked in wf.invokes:
            confidence = Confidence.KNOWN if invoked in file_by_name else Confidence.UNKNOWN
            dependencies.append(
                Dependency(
                    kind="invoked_workflow",
                    name=invoked,
                    confidence=confidence,
                    evidence=[Evidence(source=wf.file, detail=f"InvokeWorkflowFile -> {invoked}", confidence=confidence)],
                )
            )
            if confidence == Confidence.UNKNOWN:
                warnings.append(f"{wf.file}: invokes '{invoked}' which was not found in the uploaded package")

    if not entry_point:
        main_candidates = [wf.file for wf in workflows if wf.file.lower() == "main.xaml"]
        entry_point = main_candidates[0] if main_candidates else (workflows[0].file if workflows else None)
    for wf in workflows:
        wf.is_entry_point = wf.file == entry_point

    return ProcessModel(
        project_name=project_name,
        entry_point=entry_point,
        workflows=workflows,
        dependencies=dependencies,
        systems=list(systems.values()),
        queues=list(queues.values()),
        assets=list(assets.values()),
        apis=apis,
        exception_paths=exception_paths,
        business_rules=business_rules,
        human_checkpoints=human_checkpoints,
        runtime_evidence=None,
        parser_warnings=warnings,
        source_kind=source_kind,
    )
