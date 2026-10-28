# ADR 0003: Opt-in, sandboxed, static package analysis

**Status:** accepted · **Date:** 2026-11-04 · **Supersedes** the "package analysis later" consequence of ADR 0001.

## Context
Telemetry cannot show what a process does. The deployed `.nupkg` can, but a package is untrusted input (archives, XML, embedded binaries and scripts), downloading it needs a permission most read-only integrations do not hold (`Packages.View`), and its contents (selectors, endpoints, paths, addresses, occasionally secrets) are more sensitive than telemetry.

## Decisions
1. **Explicit opt-in, twice.** A connection must be enabled *and* the operator must confirm the token holds Packages.View. A 403 stops further downloads in the run and is recorded per process.
2. **Exact deployed version.** The key is `<packageId>:<currentVersion>`; the package's own nuspec identity must match or the analysis is ignored by the assessment. One previous version is also fetched, only to diff.
3. **Analyse, never execute.** A fixed zero-dependency analyzer reads bytes and emits JSON. Package content is data. Isolation is layered (separate process, empty env, permission model, network namespace, no eval, timeout/output caps) and is *reported*, not assumed.
4. **Store derived structure only.** No raw selectors, literals, display names or bytes by default. Selector fingerprints use a canonical form so reformatting is not seen as change. Raw retention is separate, encrypted, and purged when disabled.
5. **Coverage gates decisions.** Trusted coverage (>=80% parsed, version and identity match) is an input to eligibility (governed agentic) and confidence (cap 90, +10 x coverage, -5 when attempted but unusable). Gated options still count against confidence margins so excluding one cannot make us more certain.
6. **Evidence basis on every relationship:** confirmed in package / confirmed in Orchestrator / folder-scoped / inferred. A name read through `Config("...")` is never promoted to confirmed.
7. **Diffs are evidence, not verdicts.** Volatility needs enough workflows (>=4) or selectors (>=5) before ratios count, so tiny packages do not look unstable.

## Consequences
- Confidence ceilings and the governed-agentic gate now depend on opt-in setup, so an un-analysed estate scores exactly as before except that governed agentic is excluded (pinned by a regression test).
- **Isolation is only as strong as the host.** If `unshare`/the permission model are unavailable the corresponding layer is off and the UI says so; production should set `MORPHLINE_ANALYZER_REQUIRE_ISOLATION=1` or run the analyzer in a network-less container. A kernel/Node escape is out of scope.
- **Unverified against reality:** DownloadPackage key format, activity names and Studio layouts are from knowledge of UiPath; only synthetic packages were analysed. Validate on a sanitised real export before trusting coverage numbers.
- Hostnames and process-target names are kept as derived facts; organisations that treat these as sensitive can disable analysis or add redaction.
