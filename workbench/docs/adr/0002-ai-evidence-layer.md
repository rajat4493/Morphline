# ADR 0002: AI as a lower-trust evidence source, not a decision-maker

**Status:** accepted · **Date:** 2026-11-02

## Context
Keyword rules misread free-text exception reasons (e.g. "Supplier not found - needs manual review" is missing master data, not a routing judgment; "Portal login page layout changed" is UI fragility, not a document problem). A model can read these better, but the product's value is a defensible, reproducible, auditable recommendation.

## Decision
Add a model-backed **labelling** step for exception texts only. Its output is evidence with provenance `ai_inferred`, consumed by explicit rules (R15/R16). It never classifies a process, never sets confidence, and never changes opportunity. Deterministic evidence is computed and stored exactly as before; with the layer off, results are unchanged.

## Consequences
- **Reproducibility:** labels are cached per (text hash, model, prompt version) and stored with the assessment's evidence, so a stored assessment can always be re-read even if the model changes.
- **Safety by construction:** minimum-sample gate, confidence = min(all evidence, deterministic-only evidence), opportunity from deterministic evidence only, strict output validation, redaction before egress, failure falls back to rules.
- **Visible trust:** UI, plan and exports mark AI-derived evidence; the keyword baseline is shown beside every AI label so disagreements are inspectable.
- **Unproven:** accuracy of a real model on real estates is unmeasured. Gate any move from "demo" to "on" for customers on running `scripts/eval-exception-classifier.ts` and on a review of disagreements with the keyword baseline.
- **Data egress:** enabling `on` sends redacted exception text to a third-party model API. Redaction is best-effort, not a guarantee.
