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
| `Assessment` | One scoring/recommendation run against a `ProcessVersion`. Never overwritten (Rule 6) — a re-analysis creates a new row. Stores a `business_context_snapshot` (the `BusinessContext` as of this run) so historical assessments remain interpretable even after Business Context later changes. |
| `AssessmentDimension` | One of the 13 dimension scores belonging to an `Assessment`: score, level, confidence, evidence[] (structured `EvidenceItem`, see below), explanation. |
| `Constraint` | A blocker with a lifecycle (`ACTIVE`/`RESOLVED`/`POSSIBLY_RESOLVED`/`ACCEPTED_RISK`/`UNKNOWN`). Append-only (D-008). Also carries `source`, `autonomy_cap`, `resolution_condition`, `owner` (Section 15). |
| `Recommendation` | Current/Recommended/Max-Safe/Next state + **Recommended Migration Pattern** + Why This / Why Not Further (typed `WhyNotReason[]`) + `missing_evidence[]`, belongs to an `Assessment`. |
| `BusinessContextRow` | One row per `Automation` (not per version — enterprise facts describe the process, not a specific upload). Holds a serialized `BusinessContext`. Updating it triggers an immediate reassessment against the latest `ProcessVersion` (Section 5/16). |
| `EvolutionEvent` | One row per timeline entry (upload, assessment, constraint resolved, state change, Business Context change). |
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

## Business Context (`packages/shared/business_context.py`)

**Not** part of `ProcessModel` — it isn't parsed, it's supplied by a human,
and it belongs to the `Automation` (persists across re-uploads of the same
process), not to any single `ProcessVersion`. See Section 4.

```python
class BusinessContext(BaseModel):
    customer_impact: ImpactLevel = UNKNOWN          # NONE/LOW/MEDIUM/HIGH/UNKNOWN
    financial_impact: ImpactLevel = UNKNOWN
    legal_regulatory_impact: ImpactLevel = UNKNOWN
    employee_impact: ImpactLevel = UNKNOWN
    external_party_impact: ImpactLevel = UNKNOWN
    maximum_scope: ImpactScope = UNKNOWN             # INTERNAL_ONLY..ENTERPRISE/EXTERNAL_CUSTOMERS
    monetary_exposure: ImpactLevel = UNKNOWN
    human_accountability_required: TriState = UNKNOWN  # YES/NO/UNKNOWN
    mandatory_approval: TriState = UNKNOWN
    irreversible_action: TriState = UNKNOWN
    regulated_process: TriState = UNKNOWN
    sensitive_data: TriState = UNKNOWN
    critical_service: TriState = UNKNOWN
    process_owner, business_description, known_policies,
    known_constraints, notes: Optional[str] = None
```

Every field defaults to `UNKNOWN`/`None`. Nothing in the parser or scoring
layer is ever allowed to *infer* a value into this model — it is either
supplied by a human through the Business Context UI/API, or it stays
`UNKNOWN` and `BusinessContext.has_critical_unknowns()` /
`critical_unknown_fields()` surface that gap to the scoring and
recommendation layers (see `docs/recommendation-engine.md` "Safety
Ceiling"). This is the mechanism behind Section 13's core rule: absence of
evidence is not evidence of safety.

## Structured Evidence (`packages/shared/scoring_types.py::EvidenceItem`)

Distinct from the parser-level `Evidence` class above (which is always
`TECHNICAL` by construction — it only ever describes something read
directly out of a XAML file). `EvidenceItem` is the assessment-level
evidence attached to a `DimensionScore` or a `Constraint`, and carries an
explicit `type`:

```python
class EvidenceItem(BaseModel):
    type: EvidenceType        # TECHNICAL / BUSINESS / RUNTIME / INFERRED
    source: str
    confidence: Confidence    # KNOWN / INFERRED / UNKNOWN
    description: str
    reference: Optional[str] = None
```

This is what lets the UI (and the migration pack) group "why" by kind of
fact instead of flattening technical, business, and inferred signals into
one anonymous bulleted list (Section 6/18). See `docs/scoring-model.md`.

## Migration Pattern (`packages/shared/enums.py::MigrationPattern`)

A recommendation includes both an `EvolutionState` and a `MigrationPattern`
(Section 11) — see `docs/recommendation-engine.md` for the full mapping and
rationale (existing UiPath subprocesses are a valid deterministic tool, not
an automatic rejection).

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
