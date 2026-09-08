# Engineering Decisions

Running log of consequential decisions made without pausing for approval,
per the "make the best reasonable call and record it" instruction. Newest
first.

---

### D-011 — Pinned `next` to 14.2.35, not 14.2.15
`npm install` flagged 14.2.15 for a known security advisory. Bumped to the
latest patched 14.2.x rather than jumping to Next 15/16 mid-build, since a
major-version upgrade is out of scope for closing a dependency CVE. A real
production deployment should track current Next.js security releases
going forward — see `SECURITY.md`.

### D-010 — Constraint "active as of assessment X" is computed by assessment ID, not timestamp
Found while testing reassessment diffing: comparing `Constraint.created_at`
against `Assessment.created_at` to reconstruct "what was active back then"
is unreliable, because rows inserted later in the same DB transaction can
get a Python-side default timestamp a few milliseconds *before* rows
inserted earlier in that same transaction, depending on flush order. Fixed
by adding `resolved_by_assessment_id` and comparing
`created_by_assessment_id <= assessment.id` /
`resolved_by_assessment_id > assessment.id` instead — assessment IDs are a
reliable monotonic ordering. See `docs/constraint-memory.md`.

### D-009 — Frontend uses React Flow (`reactflow` / `@xyflow/react`) for process diagrams
Standard, well-documented, supports custom nodes/edges, zoom/pan/fit-view,
grouping. No reason to build a custom graph renderer for V0.

### D-008 — Constraint & evolution history are append-only
`Constraint` rows are never deleted, only transitioned (ACTIVE →
RESOLVED/ACCEPTED_RISK). `EvolutionEvent` rows are never mutated. This is
what makes "why was this blocked, and is that still true" answerable later.
Costs a bit of storage; not a real constraint at V0 scale.

### D-007 — Reassessment creates a new `Assessment` + `ProcessVersion`, never overwrites
Required by Rule 6 (preserve historical assessments). The API always
returns the latest assessment by default but exposes history via
`/processes/{id}/assessments`.

### D-006 — Scoring is rule-first; LLM is optional and additive
`scoring/` produces every dimension score from structured evidence with zero
LLM calls. An `llm/` provider abstraction exists for narrative summaries
(`summarize_process`, `explain_recommendation`) but its output is stored in
separate `narrative` fields, never merged into `score`/`evidence`. If no LLM
API key is configured, the product still fully functions — narratives just
fall back to a templated (non-LLM) summary. This keeps the deterministic
core testable and keeps us honest about what's "structured evidence" vs.
"a paragraph an LLM wrote."

### D-005 — SQLite for V0, via SQLAlchemy models that don't use SQLite-only features
No JSON1-specific queries, no SQLite-only types beyond a portable JSON
column (`sqlalchemy.JSON`, which maps cleanly to Postgres JSONB). Swapping
`DATABASE_URL` to a Postgres DSN should require no model changes. V0 uses
`Base.metadata.create_all()` on startup rather than Alembic — there is
exactly one schema version and no data to preserve across changes yet.
Alembic should be introduced at the same time as the Postgres migration
(first real schema change against real data), not before; adding it now
would be migration tooling with nothing to migrate.

### D-004 — Canonical model is UiPath-agnostic; the parser is a translation layer
`parser/uipath/` is the only code that knows what a XAML file looks like.
Everything downstream (`scoring/`, `recommendation/`, `memory/`,
`migration/`) operates purely on the canonical model in
`packages/shared`. This is what makes Rule 8/9 (not permanently dependent on
UiPath) actually true rather than aspirational.

### D-003 — Confidence is a first-class field, not a UI afterthought
Every extracted fact and every dimension score carries `KNOWN` / `INFERRED`
/ `UNKNOWN`. Recommendation logic explicitly downgrades confidence in the
recommendation when key dimensions are `UNKNOWN` rather than defaulting to a
mid-range score. Prevents false certainty (Rule 4).

### D-002 — Archive extraction runs in an isolated temp dir with strict guards
Zip/nupkg extraction validates entry paths against `..`/absolute-path
traversal, enforces a per-file and total-extracted-size cap, strips
executable bits, and never executes or imports anything from the uploaded
package. See `SECURITY.md`. This is Rule 5 plus baseline zip-slip defense.

### D-001 — Repo layout: `apps/{web,api}` + top-level capability packages
Followed the structure suggested in the master prompt as-is (Section 27)
rather than inventing a variant — it already cleanly separates parsing,
scoring, recommendation, memory, and migration into independently testable
Python packages, and keeps the Next.js app and FastAPI app decoupled.
