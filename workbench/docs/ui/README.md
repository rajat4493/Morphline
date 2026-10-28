# UI redesign: before / after

Visual and interaction upgrade only. **No routes, API endpoints, services, assessment rules, plan generator, schema or tests were changed** (verified: `git status` clean under `src/services`, `src/assessment`, `src/plan`, `src/db`, `src/connectors`, `src/app/api`, `tests/`, `drizzle/`; route list identical).

Screenshots (1440px and 390px): `before/` and `after/`. Detail-page tabs are in `after/detail-<tab>-<viewport>.png`; `detail-claims-*.png` shows the redesign-review process.

## Design system (`src/components/ds`, tokens in `src/app/globals.css`)
AppShell, SidebarNav, MobileNav, PageHeader, StatusBadge/RecBadge, Metric, InfoTip (tooltips), ConfidenceRing/ConfidenceBar, DecisionPanel, Tabs (WAI-ARIA, arrow/Home/End keys, `#tab-<id>` deep links), EvidenceItem (native `<details>`), RiskPanel, CoverageNotice, DataTable (table on desktop, stacked cards under 900px), EmptyState, Skeleton. Process-specific tabs live in `src/components/process/sections.tsx`. New dependencies: `lucide-react` (icons), `@fontsource-variable/inter` (self-hosted, no runtime font request).

## Verification
- Viewports 1440 and 390 on all five pages and all five detail tabs: no horizontal overflow, no console errors.
- axe-core (WCAG 2.0/2.1 A + AA rules) on all five tabs at both widths: 0 violations. This is automated coverage only; no screen-reader or real-touch-device testing was done.
- Keyboard: ArrowRight/End/deep-link tab switching verified; evidence rows, filters and "More filters" are native `<details>`/form controls.
- Existing suite: 29/29 passing, typecheck clean, production build passes.
- Two defects found and fixed during verification: hidden tooltip bodies widened the page on mobile (now panel-anchored on small screens), and a chart/layout polish pass.

## Decisions that the data model or routes constrained (nothing was changed to satisfy them)
1. **Five-stage plan (Discover → Design → Build → Validate → Roll out) with per-phase guardrails and acceptance criteria is not possible from current data.** `PlanContent` has variable phases per recommendation (e.g. Discover, Design, Pilot, Controlled rollout), no "Build", and guardrails/acceptance only at plan level. The UI renders the real stages as a timeline and shows guardrails and acceptance criteria as plan-level panels, with a note. Per-phase fields need a plan-generator change (schema 2).
2. **Evidence "strength" and "outcome"** are derived in the UI (`strengthOf`) from the stored weight and rule id (baseline = rule `R03-baseline`; weight < 1 = risk signal). This is a heuristic; storing a finding `kind` (supports / risk / baseline) with the evidence would make it exact. Source labels map `sourceEntity` to readable names.
3. **Operations KPIs**: queue exception counts only exist for processes with a queue; others show triggers instead. Average duration and last-run time are not returned by `processDetail`, so they are not shown on the detail page.
4. **"High operational risk"** uses a UI constant (`HIGH_RISK_SCORE = 40`), not a stored field.
5. **"Share"** copies the page URL; **"Export plan"** links the existing export route for the latest plan (disabled until a plan exists).
6. **Pretty names**: underscores are replaced with spaces for display. The exact source name is in Assessment metadata.
7. **Credential-type asset names** are masked in Dependencies until the reader chooses "Reveal name". Values are never fetched (unchanged).
8. **Light theme only.** The previous build followed `prefers-color-scheme: dark`; the new canvas spec is light and the dark variant was dropped rather than shipped untested.
9. **Sidebar workspace** ("Demo workspace / demo-user") is a static label; there is still no authentication.
10. **Skeletons**: one generic page skeleton (`loading.tsx`); no per-route skeletons.
11. Tooltips are CSS hover/focus. On touch they appear on tap-focus; not tested on a physical device.
