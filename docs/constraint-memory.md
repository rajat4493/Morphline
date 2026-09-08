# Constraint Memory

The system remembers *why* a process could not evolve further, and whether
that is still true. Implemented across `memory/constraints.py` (the
reconciliation rule), `apps/api/app/models/orm.py::Constraint` (persistence),
and `apps/api/app/pipeline.py` (wiring it into the upload/reassessment flow).

## Lifecycle

```
ACTIVE ──(no longer produced, evidence was fully KNOWN)────────> RESOLVED
ACTIVE ──(no longer produced, evidence was INFERRED/absent)────> POSSIBLY_RESOLVED
ACTIVE ──(user/architect decision, not automated in V0)────────> ACCEPTED_RISK
```

`UNKNOWN` status exists in the schema for a constraint whose status cannot
currently be determined automatically; V0's automated pipeline never
produces it, but manual data entry or a future connector might.

**`POSSIBLY_RESOLVED`** (D-012) is the direct implementation of Section
15's "if later a new package/API mapping suggests it is resolved, do NOT
automatically mark resolved" — a category disappearing because an inferred
signal simply stopped firing (e.g. a keyword no longer matched, or a
technical heuristic changed) is not the same as a human confirming the
underlying business problem is actually fixed. The distinction is decided
by `memory/constraints.py::_was_fully_certain`: a constraint whose original
evidence was **all** `Confidence.KNOWN` resolves to `RESOLVED`; anything
resting on `INFERRED`/`UNKNOWN` evidence (or no evidence at all — this
includes every `INSUFFICIENT_BUSINESS_CONTEXT` constraint, which by
definition has no technical evidence) resolves to `POSSIBLY_RESOLVED` and
the UI shows it as "confirm before treating this as resolved" rather than a
clean checkmark.

Constraints are **append-only** (D-008): a row is never deleted, only
transitioned. `resolved_at` and `resolved_by_assessment_id` are set, never
the row itself removed — this is what makes "was this really resolved, and
when" auditable later.

## Reconciliation rule

On every assessment (initial or re-assessment), `reconcile_constraints`
(`memory/constraints.py`) compares:

- the constraints active **immediately before** this assessment ran
  (`AssessmentSnapshot.active_constraints`, reconstructed as of a specific
  prior assessment — see below), against
- the fresh `ConstraintDraft[]` the recommendation engine just produced.

Matching is by **category** (`ConstraintCategory`), not by description
text, since the wording of a constraint's evidence can change between
assessments while the underlying blocker category stays the same.

- A category present in the new drafts but not in the previous active set
  → a new `Constraint` row, `status=ACTIVE`.
- A category that was active before but is no longer produced → the
  existing row transitions to `RESOLVED` or `POSSIBLY_RESOLVED` (see
  above), with `resolved_by_assessment_id` set to the assessment that
  produced the transition.
- A category present in both → the row's `description`, `evidence`,
  `severity`, `autonomy_cap`, and `resolution_condition` are refreshed to
  the latest run's values (so a still-active constraint never shows stale
  text — e.g. an `INSUFFICIENT_BUSINESS_CONTEXT` description naming fields
  that were since supplied, while others remain missing), and `last_seen_at`
  is bumped. `created_at`/history are untouched.

## Reconstructing "active as of assessment X"

`apps/api/app/pipeline.py::snapshot_from_assessment` answers "which
constraints were active at the time assessment X ran?" by comparing
**assessment IDs**, not wall-clock timestamps:

```python
c.created_by_assessment_id <= assessment.id
and (c.resolved_by_assessment_id is None or c.resolved_by_assessment_id > assessment.id)
```

Assessment IDs are a reliable monotonic ordering (autoincrement primary
key); wall-clock `created_at` timestamps are not, because rows created
within the same database transaction can be assigned Python-side default
timestamps a few milliseconds apart depending on flush order. An earlier
version of this code compared timestamps and produced incorrect "what
resolved between these two assessments" diffs — recorded here so it isn't
reintroduced (see git history / this file's prior revisions for the bug).

## Categories

See `packages/shared/enums.py::ConstraintCategory` for the full list
(missing API, unstable UI dependency, compliance restriction, mandatory
approval, high blast radius, poor reversibility, weak observability, poor
data quality, insufficient context, **insufficient business context**,
unresolved custom dependency, high exception rate, customer impact,
monetary risk, legal risk, security restriction, architecture limitation,
missing rollback, insufficient runtime evidence). Only a subset is
currently produced by the V0 recommendation engine's ceiling logic
(`recommendation/engine.py`); the rest are modeled for constraints that
will become derivable once Orchestrator runtime evidence (Section 24) and
richer LLM-assisted interpretation are wired in.

`INSUFFICIENT_BUSINESS_CONTEXT` is the enterprise-context constraint added
in the business-context repair (D-013): it fires whenever a process can
mutate production state and `BusinessContext.has_critical_unknowns()` is
true, capping the ceiling at Hybrid Agent regardless of how clean the
technical picture looks. Its `resolution_condition` always reads "Complete
the Business Context for this process" — the only thing that resolves it
is a human supplying the missing fields, which is why saving Business
Context triggers an immediate reassessment (Section 5/16,
`apps/api/app/routers/business_context.py`).

## Extended fields (Section 15)

Beyond `category`/`description`/`evidence`/`severity`/`status`, each
`Constraint` also carries: `source` (reserved for a future explicit
provenance tag), `autonomy_cap` (the `EvolutionState` this constraint caps
the ceiling at — so an architect a year later can see *what* it was
blocking, not just *that* something was blocked), `resolution_condition`
(what would need to become true for this to resolve), `owner` (reserved
for future assignment), `created_at`/`last_seen_at`/`resolved_at`. This is
the mechanism behind TheDuck Q8 ("can a future architect understand why a
decision was made one year earlier?").
