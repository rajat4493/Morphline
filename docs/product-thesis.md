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

## What Morphline actually evaluates

Morphline answers **"what is the safest, most valuable form this automation
can take today?"** — never **"how much AI does this automation already
contain?"** Those are different questions with different answers, and
conflating them was the single biggest conceptual bug in the first version
of this product (see D-013 in `docs/decisions.md`).

Concretely, this means Morphline always keeps two things separate:

- **Current Implementation** — what the automation does today, including
  whatever AI/LLM activities already exist in it. Purely descriptive.
- **Latent Evolution Opportunity** — whether the underlying *business
  process* contains work that would genuinely benefit from contextual
  reasoning, independent of whether that reasoning has been implemented yet.

A deterministic RPA bot with zero AI activities can score HIGH on
opportunity — often precisely *because* the platform it was built on
couldn't do contextual judgment, so a human absorbed that judgment instead
(manual review queues, exception-routing decision trees, free-text triage).
Conversely, a process that already calls an LLM for something mechanical
(reformatting a date string, say) can correctly score LOW on opportunity —
the AI call doesn't mean agentic reasoning is *needed* there, just that it
was used. See `docs/scoring-model.md` for how this is implemented.

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
5. **Structured Business Context** — enterprise risk facts (customer/
   financial/legal impact, reversibility, approval requirements) that
   cannot be reliably read out of a XAML file at all. Morphline treats
   these as first-class, explicitly-supplied, persisted data — never
   hallucinated from the package — and lets their absence itself cap
   recommended autonomy (Section 13: absence of evidence is not evidence
   of safety).

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
