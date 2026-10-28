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

### AI evidence layer (exception labelling)
Optional, **off by default** (`MORPHLINE_AI_EVIDENCE=off|on|demo`). After import, the top exception texts per process (queue-item failure reasons and faulted-job messages) are redacted, de-duplicated and labelled by a model into a fixed taxonomy (`src/ai/taxonomy.ts`: document input, classification ambiguity, reference data missing, validation rule, approval required, UI fragility, system unavailable, access/credentials, other). Labels become rule inputs **R15/R16** and are stored as `ai_inferred` evidence with every source text, label, confidence and the keyword-baseline label.

Guardrails (all tested): the model only sees redacted text and returns labels; output is validated, so unknown labels become `other_unclear`; labels can influence ranking but **never raise confidence or opportunity**, need a minimum sample (2 distinct texts, 20 occurrences) to vote, and are shown as lower-trust in the UI, plan and exports; results are cached by text hash + model + prompt version; a model failure degrades to deterministic rules and is reported in import history; audit records store counts and model id, never texts.

- `on`: needs `ANTHROPIC_API_KEY`; model `MORPHLINE_AI_EVIDENCE_MODEL` (default `claude-haiku-5-5`). **Data egress:** redacted exception texts (emails, numbers, IDs, URLs, paths and token-like strings removed; 200 chars max) leave the server. Redaction is best-effort; confirm it meets your data policy.
- `demo`: a **scripted simulated model** for the demo connector only, clearly labelled "simulated-demo". It is not a model; it exists to exercise the real request/validation/UI path.
- **Not yet validated against a real model.** `npm run` equivalent: `npx tsx scripts/eval-exception-classifier.ts` scores classifiers on `eval/exception-labels.json` (46 product-team-labelled texts incl. tricky cases). Keyword baseline today: 74% accuracy (94% when confident). The model result is blocked until a key is available.

### Package analysis (opt-in, read-only)
Off by default. Per connection you must **both** confirm the token holds `Packages.View` **and** enable analysis; otherwise nothing is downloaded. For each process Morphline then calls the read-only `DownloadPackage` for the **exact deployed version** (plus the immediately previous version, for diffing) and analyses it statically.

- **Isolation (defence in depth, all reported on the Connectors page and recorded per analysis):** a separate process with an *empty environment*; Node's filesystem permission model (reads limited to `worker/`, no writes, no child processes); a Linux network namespace via `unshare -n` (the worker has no network interfaces); `--disallow-code-generation-from-strings`; a hard timeout and output cap; and a zero-dependency analyzer whose imports are pinned by a test to `node:zlib` and `node:crypto`. Set `MORPHLINE_ANALYZER_REQUIRE_ISOLATION=1` to refuse analysis when the permission model or network namespace is unavailable (recommended for production). Where `unshare` is unavailable (some containers/macOS/Windows) the network layer is **not** in effect: run the analyzer in a container with no network.
- **Never executed:** XAML, DLLs, scripts and executables are parsed or counted as data only. DLLs and scripts are not even inflated. The XML reader rejects DTDs and entity declarations, bounds depth and size, and zip handling enforces limits on real output (not declared sizes).
- **Source status:** `source_available`, `compiled_only`, `unreadable` (encrypted, corrupt or unparseable) or `missing`; "not analysed" and download failures (denied, not found, too large) are explicit states.
- **Process Logic Graph (derived facts only):** workflows and literal/dynamic/unresolved invoke edges, entry point and unreachable workflows, activities by category, control flow (branches, loops, retry, try/catch, throw, ContinueOnError, business-rule exceptions), selector features and per-selector fingerprints, UI/API/database/file/email/queue/document/code activity counts, bare external host names, hard-coded literal *counts*, asset/queue/process/Config references, argument names, project.json dependencies, embedded script/executable counts. **Never stored:** raw selectors, connection strings, paths, email addresses, secrets, activity display names, URL paths, package bytes.
- **Raw package retention** is a separate setting (off by default): encrypted AES-256-GCM at rest, deleted when switched off.
- **Assessment (`rules-2026.12.0`):** package coverage is an explicit input. *Eligibility:* policy-constrained agentic requires a trusted analysis (deployed version, matching package identity, >=80% of workflow files parsed from source); otherwise it is shown as "not eligible" with the reason and can never be the recommendation or runner-up. *Confidence:* `+10 x coverage`, cap 90 (instead of 85) when trusted, `-5` when an analysis was attempted but unusable; confidence margins are measured against all options including gated ones, so excluding an option never raises confidence. Rules R17-R21 add risk evidence (package volatility from version diff, fragile selectors, no error handling, hard-coded literals, swallowed errors). `logicAnalysis` is `available | partial | unavailable`.
- **Relationship bases (Dependencies tab):** *confirmed in package* (literal reference in the analysed package), *confirmed in Orchestrator configuration* (queue triggers, shared deployments), *folder-scoped metadata* (exists in the folder; association unconfirmed) and *inferred* (names resolved at runtime via Config, or producer to consumer joined through a queue).
- **Known gaps:** the DownloadPackage key format (`<packageId>:<version>`) and XAML activity names are written from knowledge of UiPath, not verified against a live Orchestrator or real projects; only the synthetic demo packages have been analysed. Config.xlsx values are not read, so Config-driven names stay inferred. Modern/coded workflows (C#) and Studio "compiled" layouts beyond the heuristics here are not analysed. No package signature or hash allow-list verification.

### Optional LLM (plan summary)
If `ANTHROPIC_API_KEY` is set, plan generation asks a model to restate the structured plan as a short summary (`MORPHLINE_LLM_MODEL`, default `claude-sonnet-5-5`). It never classifies, never sees raw telemetry, and its text is stored, shown and exported marked as an **AI-generated draft**. Not exercised against a live API in this repo (the test uses a stub).

## What is mocked vs live
Live: connector code, import, normalisation, rules, plans, exports, encryption, audit, UI. Mocked: the Orchestrator itself in demo mode (`mock-orchestrator.ts`; synthetic estate with 9 processes). **The connector has not been run against a real Orchestrator**; field names follow the public OData API from memory of its schema and need verification against your instance's swagger.

## Limitations
No authentication/user management; no package/XAML analysis (see `docs/adr/0001-api-first-ingestion.md`); no business-context inputs (owner, criticality, cost); users/roles not imported; 90-day window fixed; opportunity/risk scores are heuristic ordering aids, not business value; rule weights are unvalidated against real estates; dormant detection cannot see activity older than the window; no scheduled/incremental imports.
