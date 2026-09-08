# Constraint Memory

The system remembers *why* a process could not evolve further, and whether
that is still true. Implemented across `memory/constraints.py` (the
reconciliation rule), `apps/api/app/models/orm.py::Constraint` (persistence),
and `apps/api/app/pipeline.py` (wiring it into the upload/reassessment flow).

## Lifecycle

```
ACTIVE ──(no longer produced by the recommendation engine)──> RESOLVED
ACTIVE ──(user/architect decision, not automated in V0)──────> ACCEPTED_RISK
```

`UNKNOWN` status exists in the schema for a constraint whose status cannot
currently be determined automatically; V0's automated pipeline never
produces it, but manual data entry or a future connector might.

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
  existing row is marked `RESOLVED`, with `resolved_by_assessment_id` set
  to the assessment that resolved it.
- A category present in both → left untouched (no duplicate row, history
  preserved).

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
data quality, insufficient context, unresolved custom dependency, high
exception rate, customer impact, monetary risk, legal risk, security
restriction, architecture limitation, missing rollback, insufficient
runtime evidence). Only a subset is currently produced by the V0
recommendation engine's ceiling logic (`recommendation/engine.py`); the
rest are modeled for constraints that will become derivable once
Orchestrator runtime evidence (Section 24) and richer LLM-assisted
interpretation are wired in.
