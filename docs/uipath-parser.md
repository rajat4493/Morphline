# UiPath Parser

Implemented in `parser/uipath/`. Three modules:

- `extract.py` — safe archive extraction (`.nupkg`/`.zip`) and bare-file
  handling (`.xaml`/`project.json`). See `SECURITY.md`.
- `xaml.py` — single-file XAML activity tree parsing into canonical `Step`s.
- `parse.py` — project-level relationship analysis (invoked workflows,
  dependencies, systems, queues, assets) across all parsed workflows,
  producing the final `ProcessModel`.

## How XAML parsing works

UiPath workflows are .NET Workflow Foundation XAML. `xaml.py` walks the
activity element tree with `xml.etree.ElementTree`, treating:

- **Container activities** (`Sequence`, `If`, `TryCatch`, `ForEach`,
  `While`, `Parallel`, `Pick`, `RetryScope`, `StateMachine`, ...) as nodes
  whose children are recursed into and linked via `Step.children`.
- **Property-element syntax** (`<TryCatch.Try>`, `<If.Then>`, ...) as
  transparent wrappers — their children attach directly to the owning
  container, no separate `Step` is created for the wrapper itself.
- **Leaf activities** as `Step`s classified into one of six categories via
  a tag-name lookup table (`classify()` in `xaml.py`): `DETERMINISTIC`,
  `REASONING`, `API_TOOL`, `HUMAN_APPROVAL`, `RISK`, `UNKNOWN`.
- Anything not in the lookup table → `UNKNOWN` category, `UNKNOWN`
  confidence, and a parser warning — never silently guessed (Rule 4).

`Step.is_container` distinguishes structural containers from leaf
activities so dimension-scoring ratios (e.g. Reasoning Need) aren't diluted
by counting `Sequence`/`If`/`TryCatch` wrapper nodes as if they were
meaningful activities.

## Known limitations vs. real compiled UiPath XAML

This is a from-scratch, dependency-free XAML walker, not the actual .NET
Workflow Foundation XAML deserializer UiPath Studio uses. It works well
against realistic, readably-authored XAML (including the synthetic fixtures
in `fixtures/uipath/`), but real UiPath-exported XAML can include:

- Deeply nested generic type arguments and `sap:VirtualizedContainerService`
  layout hints that this parser ignores (harmless — they don't affect
  classification).
- Custom/internal activity libraries with tag names not in the
  classification table — these correctly fall back to `UNKNOWN` rather than
  being misclassified, but a large custom-activity codebase will show up as
  mostly `UNKNOWN` until the table is extended.
- Expression activities using VisualBasic.NET expression syntax embedded as
  attribute text — not evaluated or interpreted, only captured as raw
  attribute values.

Extending `CONTAINER_TAGS` / `UI_AUTOMATION_TAGS` / `API_TAGS` /
`REASONING_TAGS` / `HUMAN_TAGS` / `RISK_TAGS` etc. in `xaml.py` is the
primary way to improve coverage against a specific customer's real activity
usage — this was designed to be a lookup table extension, not a rewrite.

## Dependency detection

Two sources, both surfaced with explicit confidence:

1. `project.json`'s `dependencies` object → `Dependency(kind="package",
   confidence=KNOWN)`.
2. `xmlns:prefix="clr-namespace:...;assembly=X"` declarations found directly
   in XAML files whose assembly starts with `UiPath.` → `Dependency(kind=
   "package", confidence=INFERRED)` — useful when `project.json` is missing
   or incomplete (e.g. a bare `.xaml` upload).

Invoked-workflow relationships (`InvokeWorkflowFile`) become
`Dependency(kind="invoked_workflow")`, `confidence=KNOWN` if the target file
was found in the uploaded package, `UNKNOWN` (with a parser warning) if not.
