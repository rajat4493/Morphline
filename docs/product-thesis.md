# Product Thesis

## The problem

Enterprises have thousands of UiPath (and other RPA) automations. Leadership
is under pressure to "make everything agentic," but most advice on this is
either a generic LLM-wrapper pitch or a hand-wavy maturity slide. Nobody can
answer, process by process:

- What is this automation actually doing?
- What would it take to move it to agentic execution?
- Is that even the right target, or should it stay deterministic?
- What specifically is blocking it, and is that still true today?

## The core bet

**Do not maximize autonomy. Optimize for business outcome within enterprise
risk constraints.**

A process may correctly remain deterministic RPA forever. Full autonomy is
not a universal goal — it is one possible endpoint among several valid ones
(deterministic, augmented, hybrid, advanced hybrid, highly agentic). The
product's job is to determine, defend, and remember the *right* target state
for each process, not to push everything toward the most autonomous option.

## Why this is not "just an LLM wrapper"

Anyone can point an LLM at a XAML file and ask "should this be an agent?".
That produces an unfalsifiable opinion with no persistence, no audit trail,
and no memory. This product owns four things an LLM call alone cannot:

1. **A canonical, platform-independent automation model** — structured,
   versioned, queryable, not tied to UiPath's XML shape.
2. **Evidence-driven, rule-first scoring** — every dimension score traces to
   concrete evidence (an activity, a selector, a dependency). LLM reasoning
   may supplement interpretation but never silently overwrites structured
   evidence.
3. **Constraint memory** — the system remembers *why* a process was blocked
   from evolving, so re-evaluation is a diff against history, not a fresh
   guess every time.
4. **Evolution history** — an auditable timeline per process, across
   reassessments, that a CIO or auditor can trust.

## What "done" looks like for Phase 1 (personal V0)

A single user, running locally, can upload a real UiPath project, see it
reconstructed as a readable flow, understand it in plain English, see an
evidence-backed assessment across the twelve dimensions, see the recommended
evolution state and the explicit "why not further" reasoning, save that
assessment, re-upload a changed version, see a diff, and view an estate-wide
dashboard across everything uploaded so far. See `docs/decisions.md` for the
concrete engineering choices made to get there and `SECURITY.md` for what is
and isn't safe about handling untrusted UiPath packages in this phase.

## Non-goals for this phase

No Orchestrator auth, no SSO, no multi-tenant billing, no automatic
deployment back to UiPath or to an agent runtime, no other RPA vendors, no
compliance certification. These are deferred by design (see
`docs/uipath-orchestrator-future.md` and `docs/enterprise-deployment.md`),
not forgotten.
