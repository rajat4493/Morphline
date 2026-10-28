# Morphline Workbench

An RPA → agentic migration **assessment** workbench. It connects **read-only** to a UiPath Orchestrator estate, builds an inventory with operating signals, recommends for each process whether it should stay deterministic, be AI-augmented, become hybrid, become policy-constrained agentic, or be retired, explains why with evidence, and generates a human-reviewable migration plan.

It does not execute jobs, change Orchestrator, store secrets, or run agents. (The older Python prototype in the repo root is a separate project; this app is self-contained in `workbench/`.)

## Run it

Requires Node 20+. No database server needed for the demo (embedded Postgres via PGlite).

```bash
cd workbench
npm install
export MORPHLINE_MASTER_KEY="any-long-random-string"   # required with `next start`; dev uses an insecure default
npm run build && npm start        # http://localhost:3100   (or: npm run dev)
```

Open the app, click **Create demo connection** on the Overview, then **Connectors & imports → Run import**. Or seed from the CLI (stop the server first; embedded DB is single-process): `npm run seed`.

```bash
npm test            # 29 tests (rules, connector with mocked Orchestrator, import, plans, secrets)
npm run typecheck
```

Use real Postgres by setting `DATABASE_URL=postgres://...`; migrations in `drizzle/` run on first connection. (The Postgres path uses the same Drizzle schema but has only been exercised through PGlite in this repo.)

## Pages
Overview (distribution, recent imports, top risk/opportunity, filters) · Estate inventory · Process detail (runs/failure trend, triggers, queues, dependencies, rationale, evidence, gaps) · Migration plan (with Markdown/HTML export) · Connectors & imports.

## Architecture
```
src/connectors/types.ts   platform-neutral snapshot types + EstateConnector interface (future: n8n, Bedrock AgentCore, OutSystems, generic API)
src/connectors/uipath.ts  read-only Orchestrator client (GET only; OData paging/filtering; folder headers; retries; error explanations)
src/demo/mock-orchestrator.ts  in-process fake Orchestrator. Demo mode runs the REAL connector against it, so only the transport is simulated
src/services/import.ts    snapshot -> normalised tables, derived dependencies, assessments, audit events
src/assessment/           facts -> transparent rules (rules.ts, versioned) -> result (engine.ts). No LLM involved
src/plan/                 plan generator (from stored assessment + evidence), exports, optional bounded narrator
src/db/schema.ts          Drizzle schema (all tables carry tenant_id)
```

### Data model
Tenant · Connector (encrypted config) · ImportRun · Folder · AutomationProcess (`source_id`, `raw` JSON kept separately from normalised columns) · ProcessVersion · ProcessDeployment · ExecutionJob · Queue · QueueSignal (aggregates only) · Trigger · Machine · AssetMetadata (**no value column**) · Dependency · Assessment · AssessmentEvidence · MigrationPlan · AuditEvent.

### Connector configuration
Per connection: Orchestrator URL, optional organisation + tenant (Automation Cloud URL shape `{url}/{org}/{tenant}/orchestrator_/odata/...`; on-prem uses `{url}/odata/...`), and the **name** of a server environment variable holding the bearer token (e.g. `UIPATH_ACCESS_TOKEN`). The token is read at request time and is never stored or logged. Folder-scoped calls send `X-UIPATH-OrganizationUnitId` (+ `X-UIPATH-FolderKey` when known). Your instance's exact API is at `{Orchestrator URL}/swagger/index.html`.

Endpoints used (all GET): `Folders`, `Releases`, `Processes/...GetProcessVersions`, `Jobs` (`$filter=StartTime ge`), `QueueDefinitions`, `QueueItems` (`$select` of status/exception fields only, never payloads), `ProcessSchedules`, `QueueTriggers`, `Assets` (`$select` excludes values), `Machines`. Suggested token scopes: `OR.Folders.Read OR.Execution.Read OR.Jobs.Read OR.Queues.Read OR.Assets.Read OR.Machines.Read`. A forbidden or missing endpoint degrades that entity and is reported in the import history; the rest still imports. Users/roles import is **not implemented**. Paging stops at 5,000 rows per entity per folder and reports truncation.

### Assessment rules (`rules-2026.10.1`)
Each rule reads imported facts and emits a finding with observed values, effect, source entity and weighted votes for recommendations. The highest score wins; the runner-up is shown. Confidence combines vote margin, data coverage and evidence count, is **capped at 85** (logic is never analysed from API telemetry) and at 40 when only the weak default prior fired. High failure rates, volatile selectors and version churn raise a **redesign/risk review** flag; they never push a process toward agentic. Every assessment stores rule version, an input hash, rationale, risk flags, missing information and next discovery step; each finding is stored as an `AssessmentEvidence` row.

### Security model
- All Orchestrator calls are server-side; the browser never sees tokens or Orchestrator URLs' credentials.
- Connection config is AES-256-GCM encrypted with `MORPHLINE_MASTER_KEY`; production refuses to start without it. Tokens are referenced by env-var name only.
- Asset values are never requested and the mapper whitelists fields; `asset_metadata` has no value column. Queue-item payloads are never selected; only counts and top error reasons are stored. A test plants canary secrets in the mock API and asserts they appear nowhere in the database or exports.
- Audit events scrub secret-like keys. Server error logs contain messages only.
- Tenant isolation: every table has `tenant_id` and services take a `TenantContext`. The demo resolves one tenant; replace `resolveTenant` with a session lookup for multi-tenancy. **There is no user authentication yet.**
- Exports HTML-escape all content.

### Optional LLM
If `ANTHROPIC_API_KEY` is set, plan generation asks a model to restate the structured plan as a short summary (`MORPHLINE_LLM_MODEL`, default `claude-sonnet-5-5`). It never classifies, never sees raw telemetry, and its text is stored, shown and exported marked as an **AI-generated draft**. Not exercised against a live API in this repo (the test uses a stub).

## What is mocked vs live
Live: connector code, import, normalisation, rules, plans, exports, encryption, audit, UI. Mocked: the Orchestrator itself in demo mode (`mock-orchestrator.ts`; synthetic estate with 9 processes). **The connector has not been run against a real Orchestrator**; field names follow the public OData API from memory of its schema and need verification against your instance's swagger.

## Limitations
No authentication/user management; no package/XAML analysis (see `docs/adr/0001-api-first-ingestion.md`); no business-context inputs (owner, criticality, cost); users/roles not imported; 90-day window fixed; opportunity/risk scores are heuristic ordering aids, not business value; rule weights are unvalidated against real estates; dormant detection cannot see activity older than the window; no scheduled/incremental imports.
