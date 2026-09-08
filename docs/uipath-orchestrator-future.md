# Future: UiPath Orchestrator Connector (Not Implemented)

Explicitly out of scope for Phase 1 (Section 23). This document describes
where a future read-only Orchestrator connector plugs into the existing
architecture, so V0's design doesn't need to change to accommodate it later.

## Why read-only, and why later

Orchestrator authentication, enterprise SSO, and multi-tenant permission
scoping are real integration surfaces that only matter once this runs
against a real enterprise tenant — not for a personal, local V0. Building
them now would be speculative: we don't yet know which Orchestrator API
version, auth flow (Cloud Orchestrator OAuth vs. on-prem), or permission
model a given deployment uses.

## What it would ingest

Subject to the APIs and permissions actually available in a given tenant:

- Process metadata, packages, releases (which package version is deployed
  where)
- Jobs (execution instances) and their outcomes
- Queues and their item-level outcomes
- Asset *metadata* (names, types — never secret values; see `SECURITY.md`)
- Folders (Orchestrator's tenancy/permission boundary)
- Triggers (schedule/queue-based)
- Execution history, exceptions, runtime statistics

## Where it plugs into the canonical model

The connector would be a second populator of `packages.shared.canonical`,
alongside `parser.uipath` — specifically:

- `RuntimeEvidence` (currently only ever supplied explicitly, never
  fabricated — Section 24) would be populated from Orchestrator job/queue
  outcome statistics instead of left `None`.
- A `ProcessVersion` could be linked to a specific Orchestrator `Release`/
  package version rather than only a manually uploaded file, letting
  reassessment be triggered automatically when a new package version is
  published instead of only on manual re-upload.
- Constraint category `INSUFFICIENT_RUNTIME_EVIDENCE` (already modeled —
  see `docs/constraint-memory.md`) would start resolving automatically once
  enough real execution history accumulates.

No change to `scoring/`, `recommendation/`, or `memory/` is anticipated —
they already consume `ProcessModel.runtime_evidence` as an optional field;
they simply see it populated more often once this connector exists.

## Design constraints for when this is built

- **Outbound-only where possible**: prefer the customer's environment
  polling/pushing to this product rather than requiring inbound network
  access into their UiPath infrastructure (this is the same posture as the
  future customer-network collector — see `docs/enterprise-deployment.md`).
- **Least privilege**: request only the read scopes needed for the data
  listed above; never request folder/tenant-admin scopes.
- **Never pull asset *values***, only asset metadata (name, type) — credential
  assets in particular must never leave Orchestrator through this path.
