# Future: Enterprise Deployment (Not Implemented)

Explicitly out of scope for Phase 1. This document sketches the two
deployment shapes this product is expected to grow into, so V0's
architecture doesn't paint us into a corner.

## Shape 1: SaaS (multi-tenant)

The natural evolution of the current FastAPI + Postgres backend:

- `Workspace` becomes tenant-scoped with real authentication (SSO/SAML/OIDC)
  instead of the current no-auth personal-use model.
- File uploads move from local temp-dir extraction to a scanned, quarantined
  upload pipeline (e.g. extraction still sandboxed, but in an isolated
  worker/container per upload rather than in-process).
- `packages/shared` canonical model and the scoring/recommendation/memory
  packages need no changes — the multi-tenant boundary is entirely at the
  `Workspace`/auth layer, which is why V0 already models workspaces as the
  top-level container even though there's only ever one implicit user today.

## Shape 2: Customer-network read-only collector

For customers unwilling or unable to let UiPath package/execution data
leave their network to a SaaS backend directly:

- A lightweight collector process runs inside the customer's network,
  with read-only access to their UiPath Orchestrator (see
  `docs/uipath-orchestrator-future.md`) and/or file share where packages
  live.
- The collector performs extraction + parsing locally (reusing
  `parser.uipath` unchanged — it's already a pure, dependency-light
  Python package) and pushes only the resulting canonical `ProcessModel`
  JSON (already redacted of secrets — see `SECURITY.md`) outbound to the
  SaaS backend.
- **Outbound-only**: the collector initiates all connections; nothing needs
  to open an inbound port into the customer's network. This is the
  standard shape for security-conscious enterprise data collectors (agent
  polls or pushes out, never receives inbound connections).
- Scoring, recommendation, and memory stay server-side in the SaaS backend
  — the collector's only job is safe extraction + parsing + redaction, kept
  as small and auditable as possible since it runs inside a customer's
  trust boundary.

## What does not change between shapes

`packages/shared`, `parser/`, `scoring/`, `recommendation/`, `memory/`,
`migration/` are deployment-topology-agnostic by construction (D-001,
D-004) — they operate purely on the canonical model in memory. This is the
main reason those packages exist as separate top-level Python packages
rather than being embedded inside `apps/api`.
