import { CATEGORY_INFO, type ExceptionCategory } from "@/ai/taxonomy";
import type { ExceptionAiItem, Finding, ProcessFacts } from "./types";

export const RULESET_VERSION = "rules-2026.11.0";

const DOC = /(layout|ocr|extract|pdf|scan|attachment|unstructured|intent|classif|invoice|document|email)/i;
const REASON_DOC = /(layout|ocr|unstructured|attachment|intent|language|confidence|not recogni[sz]ed)/i;
const REASON_ROUTING = /(category|rout|triage|unclear|multiple|ambiguous|judg)/i;
const UI_FAULT = /(selector|element not found|ui timeout|screen|ui element)/i;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const MIN_AI_CONFIDENCE = 60;
/** Minimum sample before AI labels may vote: a single odd message must not move a recommendation. */
export const MIN_AI_TEXTS = 2, MIN_AI_OCCURRENCES = 20;
/** Share of AI-labelled exception occurrences per category, counting only labels the model was reasonably sure about. */
export function aiMix(items: ExceptionAiItem[]) {
  const total = items.reduce((a, i) => a + i.count, 0);
  const by = new Map<string, number>();
  for (const i of items) if (i.confidence >= MIN_AI_CONFIDENCE && i.label !== "other_unclear") by.set(i.label, (by.get(i.label) ?? 0) + i.count);
  const share = (c: ExceptionCategory) => (total ? (by.get(c) ?? 0) / total : 0);
  return { total, by, share, labelled: [...by.values()].reduce((a, b) => a + b, 0) };
}

export type Rule = { id: string; description: string; evaluate: (f: ProcessFacts) => Finding | null };

export const RULES: Rule[] = [
  {
    id: "R01-stable-low-exception", description: "Stable history with a low failure rate favours keeping deterministic RPA",
    evaluate: (f) => f.jobs.total >= 30 && f.jobs.failureRate <= 0.05 && (!f.queue || (f.queue.businessExceptionRate < 0.05 && f.queue.applicationExceptionRate < 0.05))
      ? { ruleId: "R01-stable-low-exception", signal: "Stable execution", observed: `${f.jobs.total} jobs in ${f.jobs.windowDays}d, failure rate ${pct(f.jobs.failureRate)}${f.queue ? `, queue exceptions ${pct(f.queue.businessExceptionRate + f.queue.applicationExceptionRate)}` : ""}`, effect: "Supports deterministic: nothing in the data shows a need for AI judgment.", votes: { deterministic: 3 }, sourceEntity: "execution_jobs", sourceRefs: ["jobs:window"] }
      : null,
  },
  {
    id: "R02-scheduled-linear", description: "Scheduled, queue-less processes with no document/judgment signals look linear",
    evaluate: (f) => f.triggers.some((t) => t.kind === "time" && t.enabled) && !f.queue && f.jobs.total >= 4 && f.jobs.failureRate <= 0.1
      ? { ruleId: "R02-scheduled-linear", signal: "Time-scheduled without a work queue", observed: `Cron ${f.triggers.find((t) => t.kind === "time")?.cron ?? "?"}, no queue, ${f.jobs.total} jobs`, effect: "Supports deterministic: fixed-schedule batch pattern.", votes: { deterministic: 2 }, sourceEntity: "triggers", sourceRefs: ["triggers"] }
      : null,
  },
  {
    id: "R03-baseline", description: "Default weak prior toward deterministic when no other signal fires",
    evaluate: (f) => ({ ruleId: "R03-baseline", signal: "Baseline prior", observed: "Applies to every process", effect: "Weak default toward deterministic: absence of evidence for AI is not evidence for it.", votes: { deterministic: 1 }, sourceEntity: "automation_processes", sourceRefs: [`process:${f.processId}`] }),
  },
  {
    id: "R04-document-signal", description: "Document/extraction keywords plus document-style business exceptions suggest AI-augmentation",
    evaluate: (f) => {
      const nameHit = DOC.test(`${f.name} ${f.packageId} ${f.description}`);
      const reasons = f.queue?.topReasons.filter((r) => REASON_DOC.test(r.reason)) ?? [];
      const reasonCount = reasons.reduce((a, r) => a + r.count, 0);
      if (!nameHit || !f.queue || reasonCount === 0) return null;
      return { ruleId: "R04-document-signal", signal: "Document / unstructured input", observed: `Name/description matches document keywords; ${reasonCount} queue items failed with document-style reasons (${reasons.map((r) => `"${r.reason}"`).join(", ")})`, effect: "Supports AI-augmented: a deterministic flow with extraction/classification capability where rules fail.", votes: { ai_augmented: 4 }, sourceEntity: "queue_signals", sourceRefs: [`queue:${f.queue.name}`] };
    },
  },
  {
    id: "R05-routing-judgment", description: "Business exceptions about categorisation/routing indicate contextual judgment",
    evaluate: (f) => {
      const reasons = f.queue?.topReasons.filter((r) => REASON_ROUTING.test(r.reason)) ?? [];
      const reasonCount = reasons.reduce((a, r) => a + r.count, 0);
      if (!f.queue || reasonCount === 0 || f.queue.businessExceptionRate < 0.1) return null;
      return { ruleId: "R05-routing-judgment", signal: "Routing / triage judgment", observed: `Business exceptions ${pct(f.queue.businessExceptionRate)} of ${f.queue.total} items; routing-style reasons: ${reasons.map((r) => `"${r.reason}" (${r.count})`).join(", ")}`, effect: "Supports hybrid (and, with stable tools, governed agentic): bounded decisions where fixed rules run out.", votes: { hybrid: 3, governed_agentic: 1 }, sourceEntity: "queue_signals", sourceRefs: [`queue:${f.queue.name}`] };
    },
  },
  {
    id: "R06-manual-intervention", description: "Frequent human escalation shows decisions the automation cannot make",
    evaluate: (f) => f.jobs.total >= 30 && f.jobs.escalated / f.jobs.total >= 0.1
      ? { ruleId: "R06-manual-intervention", signal: "Manual intervention", observed: `${f.jobs.escalated} of ${f.jobs.total} jobs carry an escalation message (${pct(f.jobs.escalated / f.jobs.total)})`, effect: "Supports hybrid: a bounded decision step could absorb part of the escalations.", votes: { hybrid: 2 }, sourceEntity: "execution_jobs", sourceRefs: ["jobs:window"] }
      : null,
  },
  {
    id: "R07-stable-tools", description: "Several stable sibling automations in the same folder are candidate tools for an agent",
    evaluate: (f) => f.stableSiblingTools.length >= 2 && f.jobs.total >= 200 && f.queue && f.queue.businessExceptionRate >= 0.1
      ? { ruleId: "R07-stable-tools", signal: "Stable downstream tools", observed: `${f.stableSiblingTools.length} stable sibling processes in ${f.folderPath}: ${f.stableSiblingTools.map((t) => `${t.name} (${pct(t.failureRate)} failures, ${t.jobs} jobs)`).join("; ")}`, effect: "Supports governed agentic only as a later step: reliable execution tools exist, but their contracts and the policy surface are unknown.", votes: { governed_agentic: 3, hybrid: 1 }, sourceEntity: "execution_jobs", sourceRefs: f.stableSiblingTools.map((t) => `process:${t.name}`) }
      : null,
  },
  {
    id: "R08-dormant", description: "No recent executions suggests a retirement candidate",
    evaluate: (f) => f.jobs.total === 0
      ? { ruleId: "R08-dormant", signal: "Dormant", observed: `No executions in the last ${f.jobs.windowDays} days`, effect: "Supports retire/consolidate. Last-run date beyond the window is unknown.", votes: { retire: 5 }, risk: f.triggers.some((t) => t.enabled) ? { code: "ENABLED_TRIGGER_NO_RUNS", text: "A trigger is enabled but there were no executions in the window", weight: 10 } : undefined, sourceEntity: "execution_jobs", sourceRefs: ["jobs:window"] }
      : null,
  },
  {
    id: "R09-triggers-disabled", description: "All triggers disabled suggests the process is no longer scheduled",
    evaluate: (f) => f.triggers.length > 0 && f.triggers.every((t) => !t.enabled)
      ? { ruleId: "R09-triggers-disabled", signal: "All triggers disabled", observed: `${f.triggers.length} trigger(s), none enabled`, effect: "Supports retire/consolidate.", votes: { retire: 2 }, sourceEntity: "triggers", sourceRefs: ["triggers"] }
      : null,
  },
  {
    id: "R10-duplicate", description: "A process sharing its package with a busier one is a consolidation candidate",
    evaluate: (f) => {
      const busier = f.duplicatesOf.filter((d) => d.jobs > f.jobs.total || (d.jobs === f.jobs.total && d.processName < f.name));
      if (f.duplicatesOf.length === 0) return null;
      return busier.length > 0
        ? { ruleId: "R10-duplicate", signal: "Duplicate package", observed: `Shares package "${f.packageId}" with ${f.duplicatesOf.map((d) => `${d.processName} v${d.version} (${d.jobs} jobs)`).join(", ")}`, effect: "Supports retire/consolidate: same package is deployed under another, more active process.", votes: { retire: 3 }, risk: { code: "DUPLICATE_DEPLOYMENT", text: `Same package deployed as ${f.duplicatesOf.map((d) => d.processName).join(", ")}`, weight: 5 }, sourceEntity: "automation_processes", sourceRefs: f.duplicatesOf.map((d) => `process:${d.processName}`) }
        : { ruleId: "R10-duplicate", signal: "Duplicate package", observed: `Package "${f.packageId}" is also deployed as ${f.duplicatesOf.map((d) => d.processName).join(", ")}`, effect: "No vote; flagged for consolidation review.", votes: {}, risk: { code: "DUPLICATE_DEPLOYMENT", text: `Same package deployed as ${f.duplicatesOf.map((d) => d.processName).join(", ")}`, weight: 5 }, sourceEntity: "automation_processes", sourceRefs: f.duplicatesOf.map((d) => `process:${d.processName}`) };
    },
  },
  {
    id: "R11-high-failure", description: "A high failure rate means redesign/risk review before any migration",
    evaluate: (f) => f.jobs.total >= 30 && f.jobs.failureRate >= 0.25
      ? { ruleId: "R11-high-failure", signal: "High failure rate", observed: `${pct(f.jobs.failureRate)} of ${f.jobs.total} jobs faulted. Top errors: ${f.jobs.topErrors.slice(0, 3).map((e) => `"${e.text}" (${e.count})`).join("; ")}`, effect: "Does NOT imply agentic. Prioritise root-cause redesign/risk review.", votes: {}, risk: { code: "HIGH_FAILURE_RATE", text: `${pct(f.jobs.failureRate)} job failure rate`, weight: 35, redesign: true }, sourceEntity: "execution_jobs", sourceRefs: ["jobs:window"] }
      : null,
  },
  {
    id: "R12-ui-volatility", description: "Faults dominated by selector/UI errors signal brittle UI automation",
    evaluate: (f) => {
      const faulted = f.jobs.faulted;
      return faulted >= 10 && f.jobs.uiFaults / faulted >= 0.5
        ? { ruleId: "R12-ui-volatility", signal: "Volatile UI selectors", observed: `${f.jobs.uiFaults} of ${faulted} faulted jobs report selector/element/UI-timeout errors`, effect: "Does NOT imply agentic. Brittle UI automation: consider API or redesign; an agent on top would inherit the fragility.", votes: {}, risk: { code: "VOLATILE_UI", text: "Faults dominated by selector/UI-timeout errors", weight: 25, redesign: true }, sourceEntity: "execution_jobs", sourceRefs: ["jobs:window"] }
        : null;
    },
  },
  {
    id: "R13-version-churn", description: "Frequent republishing indicates an unstable change history",
    evaluate: (f) => f.versionsLast180d >= 5
      ? { ruleId: "R13-version-churn", signal: "Version churn", observed: `${f.versionsLast180d} package versions published in the last 180 days (${f.versionCount} total)`, effect: "Risk: frequent patching suggests ongoing breakage or unclear requirements.", votes: {}, risk: { code: "VERSION_CHURN", text: `${f.versionsLast180d} versions in 180 days`, weight: 15, redesign: true }, sourceEntity: "process_versions", sourceRefs: ["process_versions"] }
      : null,
  },
  {
    id: "R14-privileged-credentials", description: "Credential-type assets in the folder require identity design before any agent gets near them",
    evaluate: (f) => f.folderAssets.credentialLike > 0
      ? { ruleId: "R14-privileged-credentials", signal: "Credential assets in folder scope", observed: `${f.folderAssets.credentialLike} credential/secret-type asset(s) exist in ${f.folderPath} (metadata only; usage by this process cannot be determined from the API)`, effect: "Risk: any agentic design needs scoped identities and no shared credentials.", votes: {}, risk: { code: "CREDENTIALS_IN_SCOPE", text: "Credential-type assets in folder scope", weight: 10 }, sourceEntity: "asset_metadata", sourceRefs: ["assets:folder"] }
      : null,
  },
  {
    id: "R15-ai-exception-mix", description: "AI-labelled exception texts: lower-trust evidence about what kind of exceptions occur (document, ambiguity, data...)",
    evaluate: (f) => {
      const ai = f.exceptionAi; if (!ai || ai.items.length === 0) return null;
      const m = aiMix(ai.items);
      const parts = [...m.by].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${Math.round((n / m.total) * 100)}% ${CATEGORY_INFO[c as ExceptionCategory].label.toLowerCase()}`);
      const votes: Finding["votes"] = {};
      const enough = ai.items.length >= MIN_AI_TEXTS && m.total >= MIN_AI_OCCURRENCES;
      if (enough && m.share("document_input") >= 0.3) votes.ai_augmented = 2;
      if (enough && m.share("classification_ambiguity") >= 0.3) votes.hybrid = 2;
      return { ruleId: "R15-ai-exception-mix", signal: "AI-labelled exception mix", observed: `${ai.items.length} distinct exception texts (${m.total} occurrences) labelled by ${ai.model}: ${parts.join(", ") || "none labelled with enough confidence"}`,
        effect: `AI-inferred, lower trust. ${votes.ai_augmented ? "Many exceptions are document/input problems, which supports AI-augmented. " : ""}${votes.hybrid ? "Many exceptions are classification/routing ambiguity, which supports hybrid. " : ""}${Object.keys(votes).length ? "Votes are deliberately smaller than the rule-based equivalents." : (enough ? "No vote: no category passed the 30% threshold." : `No vote: sample too small (needs at least ${MIN_AI_TEXTS} distinct texts and ${MIN_AI_OCCURRENCES} occurrences).`)}`,
        votes, sourceEntity: "queue_signals", sourceRefs: [...new Set(ai.items.map((i) => `${i.source}:${i.text.slice(0, 40)}`))].slice(0, 8), provenance: "ai_inferred", detail: ai.items };
    },
  },
  {
    id: "R16-ai-exception-risk", description: "AI-labelled exceptions that point to data or UI problems rather than missing intelligence",
    evaluate: (f) => {
      const ai = f.exceptionAi; if (!ai || ai.items.length === 0) return null;
      const m = aiMix(ai.items);
      if (m.total < MIN_AI_OCCURRENCES) return null;
      if (m.share("reference_data_missing") >= 0.3) return { ruleId: "R16-ai-exception-risk", signal: "Reference-data exceptions", observed: `${Math.round(m.share("reference_data_missing") * 100)}% of labelled exception occurrences are missing reference data (lookup/master data)`, effect: "Risk: these failures are data-quality problems; adding AI will not fix them. Fix master data first.", votes: {}, risk: { code: "DATA_QUALITY_EXCEPTIONS", text: "Exceptions dominated by missing reference data (AI-inferred)", weight: 5 }, sourceEntity: "queue_signals", sourceRefs: ["ai_evidence"], provenance: "ai_inferred", detail: ai.items };
      if (m.share("ui_fragility") >= 0.5) return { ruleId: "R16-ai-exception-risk", signal: "UI-fragility exceptions", observed: `${Math.round(m.share("ui_fragility") * 100)}% of labelled exception occurrences are UI selector/element failures`, effect: "Risk: corroborates volatile UI automation. Does not raise the redesign flag on its own.", votes: {}, risk: { code: "UI_EXCEPTIONS_AI", text: "Exceptions dominated by UI failures (AI-inferred)", weight: 5 }, sourceEntity: "execution_jobs", sourceRefs: ["ai_evidence"], provenance: "ai_inferred", detail: ai.items };
      return null;
    },
  },
];
