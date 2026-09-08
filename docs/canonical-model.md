# Canonical Automation Model

Defined in `packages/shared/canonical.py` (document structure) and
`packages/shared/enums.py` (shared vocabulary). This is UiPath-agnostic by
design (Rule 8/9) — the UiPath parser is the only code that translates into
it.

## Persisted entities (SQL tables, `apps/api/app/models`)

| Entity | Notes |
|---|---|
| `Workspace` | Top-level container a user creates/selects. |
| `Automation` | One logical process, identified across versions. |
| `ProcessVersion` | One upload of an `Automation`. Holds the full `ProcessModel` JSON document (see below) plus upload metadata. |
| `Assessment` | One scoring/recommendation run against a `ProcessVersion`. Never overwritten (Rule 6) — a re-analysis creates a new row. |
| `AssessmentDimension` | One of the 12 dimension scores belonging to an `Assessment`: score, level, confidence, evidence[], explanation. |
| `Constraint` | A blocker with a lifecycle (`ACTIVE`/`RESOLVED`/`ACCEPTED_RISK`/`UNKNOWN`). Append-only (D-008). |
| `Recommendation` | Current/Recommended/Max-Safe/Next state + Why This / Why Not Further text, belongs to an `Assessment`. |
| `EvolutionEvent` | One row per timeline entry (upload, assessment, constraint resolved, state change). |
| `MigrationAction` | One generated migration-pack run, referencing the files produced. |

## In-document entities (nested inside `ProcessModel`, not separate tables)

`Workflow`, `Step`, `Dependency`, `System`, `Queue`, `Asset`, `ApiCall`
(the canonical model's name for "API"), `Selector`, `Variable`, `Argument`,
`ExceptionPath`, `BusinessRule`, `HumanCheckpoint`, `RuntimeEvidence`,
`Evidence`.

These are read and written together as a single tree per process version —
there is no query pattern in V0 that needs e.g. "all Steps across every
process" independent of their `ProcessVersion`, so normalizing them into
their own tables would add migration/query overhead with no payoff yet. If
that access pattern appears (e.g. cross-process selector search at estate
scale), promote `Step`/`System`/`Dependency` to real tables — the
`ProcessModel` Pydantic shape does not need to change to do that.

## Confidence

Every extracted fact (`Evidence.confidence`) and every dependency
(`Dependency.confidence`) carries one of `KNOWN` / `INFERRED` / `UNKNOWN`.
`KNOWN` means the parser read it directly from a file. `INFERRED` means it
was derived (e.g. "this looks like an SAP UI automation dependency based on
selector attributes" without a package reference confirming it). `UNKNOWN`
is used explicitly rather than guessing — see Rule 4.

## Node categories (visual flow)

`Step.category` is one of `DETERMINISTIC` (blue), `REASONING` (purple),
`API_TOOL` (green), `HUMAN_APPROVAL` (orange), `RISK` (red), `UNKNOWN`
(grey) — see Section 7 of the master prompt for the mapping rationale.

## Evolving the model

Adding a field to `ProcessModel` is additive and backward compatible for
already-stored `ProcessVersion.process_model` JSON (Pydantic ignores/
defaults missing fields on load). Removing or renaming a field requires a
migration note in `docs/decisions.md` and a data migration, since old JSON
blobs won't have the new shape.
