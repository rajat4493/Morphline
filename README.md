# Morphline

An enterprise RPA-to-agentic evolution platform. Starting point: UiPath.

**Core principle:** do not maximize autonomy — optimize for business
outcome within enterprise risk constraints. A process may correctly stay
deterministic RPA forever; full autonomy is one possible endpoint among
several valid ones (deterministic → augmented → hybrid agent → advanced
hybrid → high autonomy), not the default goal.

See `docs/product-thesis.md` for the full rationale.

## What it does today (personal V0)

- Upload a UiPath project/package (`.nupkg`, `.zip`, `.xaml`, or a bare
  `project.json`-accompanied folder zipped up).
- Parses it into a platform-independent canonical model — workflows,
  activities, dependencies, systems, queues, assets, exception paths,
  human checkpoints — with every extracted fact marked `KNOWN`, `INFERRED`,
  or `UNKNOWN` (never guessed and presented as certain).
- Reconstructs the process as a readable, color-coded, zoomable/pannable
  flow diagram (blue = deterministic, purple = reasoning/agent candidate,
  green = API/tool, orange = human approval, red = risk, grey = unresolved).
- Scores the process across thirteen evidence-driven dimensions (reasoning
  opportunity, execution tool readiness, blast radius, reversibility,
  compliance sensitivity, and more — see `docs/scoring-model.md`), each with
  a score, confidence, and evidence grouped by type (technical / business /
  runtime / inferred). No black-box score — and **existing AI activities in
  the process are never used as evidence that the process needs to become
  more agentic** (see "Current Implementation vs. Latent Opportunity" in
  `docs/product-thesis.md`).
- Lets you record **Business Context** per process — customer/financial/
  legal impact, reversibility, approval requirements — the enterprise risk
  facts that cannot be read out of a XAML file. Leaving these unanswered is
  itself meaningful: it caps the maximum safe autonomy level rather than
  being silently ignored (Section 13 of the product brief).
- Recommends the right target evolution state **and** a Migration Pattern
  (e.g. "Agent-Orchestrated RPA Tools," "Hybrid with Human Approval") — and,
  just as importantly, explains **why not further**, classified as a
  confirmed blocker, an unconfirmed unknown, a tooling gap, or simply "not
  valuable yet" (see `docs/recommendation-engine.md`).
- Remembers why a process was blocked from evolving, and tracks whether
  that constraint is still true across re-assessments — including
  reassessments triggered purely by a Business Context change, with no new
  file upload (`docs/constraint-memory.md`).
- Shows an evolution history timeline per process, and a diff ("what
  changed / what resolved / what new risk appeared") between assessments.
- Shows a CIO-style estate dashboard across every uploaded process: an
  evolution funnel, quick wins, high-risk migrations, newly-eligible
  processes, and top constraints.
- Generates a first-pass migration pack (11 files: process summary, target
  architecture, migration backlog, guardrails, human approval points, test
  strategy, and the underlying structured data) as a downloadable zip.

## What it does NOT do yet (by design — see `docs/product-thesis.md`)

UiPath Orchestrator auth, enterprise SSO, multi-tenant billing, automatic
deployment back to UiPath or to an agent runtime, other RPA vendors (Power
Automate, Automation Anywhere, Blue Prism), production compliance
certification. See `docs/uipath-orchestrator-future.md` and
`docs/enterprise-deployment.md` for how these are expected to plug in
later without a rearchitecture.

## Architecture summary

```
apps/web        Next.js + TypeScript + Tailwind + React Flow frontend
apps/api        FastAPI backend + SQLAlchemy models
packages/shared Canonical automation model (Pydantic), platform-independent
parser/uipath   UiPath-specific ingestion (the only UiPath-aware code)
scoring         Rule-based, evidence-driven dimension scoring
recommendation  Evolution-state decision engine (Why This / Why Not Further)
memory          Constraint memory + evolution history + reassessment diff
migration       Migration pack generation
llm             Optional LLM provider abstraction (narrative text only)
fixtures/uipath 3 synthetic sample UiPath-like projects for dev/testing
```

Full detail in `docs/architecture.md`.

## Running locally

### Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt

# Optional: seed the three synthetic sample processes into a "Sample Workspace"
python -m apps.api.scripts.seed_samples

uvicorn apps.api.app.main:app --reload --port 8000
```

The API listens on `http://localhost:8000` and uses a local SQLite file
(`morphline.db`) by default — no external services required. Set
`DATABASE_URL` to point at Postgres instead (see `docker-compose.yml`).

### Frontend

```bash
cd apps/web
npm install
npm run dev
```

Open `http://localhost:3000`. It talks to the API at
`NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`).

### Or: both via Docker Compose

```bash
docker compose up --build
```

### Running tests

```bash
source .venv/bin/activate
pip install -r apps/api/requirements.txt
pytest
```

## Uploading a UiPath package

1. Open the app, create a workspace.
2. Click "Upload Process," choose a `.nupkg`/`.zip`/`.xaml` file.
3. The process is parsed, scored, and assessed immediately — no async job
   queue in V0, this happens synchronously in the upload request.
4. Open the process to see its flow diagram, assessment, why/why-not,
   dependencies, constraints, evolution history, and evidence. Download a
   migration pack from the process detail page.
5. Re-upload a changed version of the same process (via "Upload Process"
   with the same automation selected, or re-run the API upload with
   `automation_id` set) to see a reassessment diff and updated history.

If you don't have a real UiPath package handy, the three fixtures under
`fixtures/uipath/` (**synthetic, clearly-labeled test data — not real
UiPath exports**) are zip-able and uploadable as-is, and are what
`seed_samples.py` uses.

## Screenshots

_(Placeholder — add screenshots of the estate dashboard, process flow
view, and Why/Why-Not tab here once captured from your own local run.)_

## Security

Uploaded packages are treated as untrusted input: sandboxed extraction,
path-traversal and size-limit guards, nothing uploaded is ever executed.
See `SECURITY.md` for the full breakdown of what's protected today and what
must change before any enterprise/shared-network deployment.

## Documentation index

- `docs/product-thesis.md` — why this product exists and what it owns
- `docs/architecture.md` — system architecture
- `docs/canonical-model.md` — the platform-independent data model
- `docs/scoring-model.md` — the assessment dimensions, and current-usage vs. opportunity
- `docs/recommendation-engine.md` — the evolution-state decision logic
- `docs/constraint-memory.md` — how blockers are remembered and reconciled
- `docs/uipath-parser.md` — how XAML parsing works and its limitations
- `docs/uipath-orchestrator-future.md` — future read-only connector design
- `docs/enterprise-deployment.md` — future SaaS / customer-collector shapes
- `docs/decisions.md` — running log of engineering decisions
- `docs/UAT.md` — plain-English manual test script (no code reading required)
- `SECURITY.md` — security posture and what must change for production
