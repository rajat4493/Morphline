# Architecture

## Overview

```
apps/web        Next.js + TypeScript + Tailwind frontend
apps/api        FastAPI backend (HTTP API, SQLAlchemy models, DB session)

packages/shared Canonical automation model (Pydantic) + enums — the
                platform-independent contract every other package imports.

parser/uipath   UiPath-specific ingestion: archive extraction, XAML
                parsing, project relationship analysis. Only place in the
                codebase allowed to know what a XAML file looks like.

scoring         Rule-based dimension scoring over a ProcessModel.
memory          Constraint memory + evolution history + reassessment diff.
recommendation  Evolution-state decision engine (Why This / Why Not).
migration       Migration pack file generation.
llm             LLM provider abstraction (narrative text only, optional).

fixtures/uipath Three synthetic sample projects for dev/testing.
tests           Cross-package tests (also: apps/api/tests for API tests).
docs            This documentation set.
```

## Request flow (upload → recommendation)

```
Browser
  → POST /workspaces/{id}/uploads (multipart file)
      apps/api/app/routers/uploads.py
      → parser.uipath.extract.safe_extract()       (security-checked temp dir)
      → parser.uipath.parse.parse_project()          → ProcessModel (canonical)
      → persisted as Automation + ProcessVersion (process_model JSON column)
      → scoring.engine.score_process(ProcessModel)   → dict[dimension -> DimensionScore]
      → recommendation.engine.recommend(scores, ProcessModel)
                                                       → Recommendation + Constraint[]
      → memory.timeline.record_evolution_event(...)   → EvolutionEvent
      → persisted as Assessment + AssessmentDimension[] + Constraint[]
  ← process id + assessment summary
Browser
  → GET /processes/{id}                              → overview
  → GET /processes/{id}/flow                          → React Flow graph JSON
  → GET /processes/{id}/assessments/latest            → dimensions, evidence
  → GET /processes/{id}/constraints
  → GET /processes/{id}/history
  → POST /processes/{id}/migration-pack               → zip of generated files
```

Reassessment (re-uploading a changed version of the same Automation) runs
the identical pipeline, then `memory.diff.compare_assessments()` produces
the "what changed" payload instead of silently overwriting history (D-007).

## Why FastAPI + Next.js instead of a single framework

Keeps the deterministic parsing/scoring core (Python: XML tooling, rule
engines, easy to unit test) decoupled from a frontend optimized for a rich
interactive graph UI (React Flow has no mature Python equivalent). The
canonical model in `packages/shared` is imported directly by Python code and
mirrored as TypeScript types in `apps/web` (kept manually in sync at this
scale — see `docs/canonical-model.md`); a generated OpenAPI client would be
the natural next step once the schema stabilizes.

## Database

SQLite for local V0 (`sqlite:///./morphline.db`), via SQLAlchemy models
that avoid SQLite-only features so a `DATABASE_URL` swap to Postgres needs
no model changes (D-005). Tables are created via `Base.metadata.create_all()`
on startup; Alembic is deferred to the Postgres migration (D-005).

## LLM abstraction

`llm/provider.py` defines the interface:

```python
analyze_process_context(process: ProcessModel) -> str
summarize_process(process: ProcessModel) -> str
explain_recommendation(process, scores, recommendation) -> str
suggest_target_architecture(process, recommendation) -> str
```

A `NullLLMProvider` (templated, non-LLM fallback) is the default so the
product works with zero API keys configured. An `AnthropicProvider` can be
enabled via `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`. LLM output is
narrative-only and stored separately from structured scores/evidence
(D-006, Rule 7).

## Security boundary

Uploaded packages are untrusted input. See `SECURITY.md`. In short:
extraction is sandboxed to a per-upload temp directory, entry names are
validated against path traversal, size limits are enforced, and nothing
uploaded is ever executed, imported, or eval'd.
