# ADR 0001: API-first estate ingestion; package/XAML analysis later

**Status:** accepted · **Date:** 2026-10-28

## Context
We need to assess a whole UiPath estate quickly and defensibly. Two possible sources exist: (a) the Orchestrator OData API (inventory, versions, jobs, queues, triggers, machines, asset metadata), and (b) the process packages (`.nupkg`/XAML), which contain the actual workflow logic.

## Decision
Build the MVP on (a). Treat (b) as a separate, future ingestion path behind the same platform-neutral snapshot interface, and make its absence explicit: every assessment carries `logic_analysis = "unavailable"`, a standing information-gap entry, a confidence cap of 85, and a UI/exports banner.

## Rationale
- API access is read-only, centrally governed and available for every process at once; package access needs download permissions and handling of untrusted archives.
- Operational telemetry answers questions packages cannot: is it used, how often does it fail, what do exceptions look like, what starts it.
- Telemetry cannot answer what decisions the bot makes, which systems/selectors it touches, or which assets it uses. Pretending otherwise would be misleading, hence the explicit state.

## Consequences
- Recommendations are directional; the "next discovery step" asks for package upload where it would change the answer.
- A future `PackageAnalyzer` produces additional facts (activities, selector types, invoked workflows, HTTP/AI calls) that feed the same `ProcessFacts`/rules, with evidence rows citing the package. Rules written for API facts remain valid.
- A second connector kind (n8n, AgentCore, OutSystems) implements `EstateConnector` and needs no change to assessment or planning.
