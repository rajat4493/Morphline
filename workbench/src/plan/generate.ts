import type { ProcessFacts, Recommendation } from "@/assessment/types";
import { RECOMMENDATION_LABEL } from "@/assessment/types";

export type PlanInput = {
  assessmentId: string; ruleVersion: string; recommendation: Recommendation; runnerUp: string | null; confidence: number; redesignReview: boolean;
  riskFlags: string[]; missingInformation: string[]; logicAnalysis?: "unavailable" | "partial" | "available"; evidence: { ruleId: string; signal: string; observed: string; effect: string; sourceRefs: string[]; provenance?: string }[];
};
export type PlanContent = {
  schema: 1; processName: string; folderPath: string; generatedAt: string; assessmentId: string; ruleVersion: string; recommendation: Recommendation; recommendationLabel: string; confidence: number;
  targetPattern: { name: string; description: string };
  retainedRpaElements: string[]; candidateIntegrations: { name: string; kind: string; basis: string }[];
  policies: string[]; identityAndRbac: string[]; approvalPoints: string[]; validationCriteria: string[];
  backlog: { phase: string; goal: string; items: string[] }[]; assumptions: string[]; unknowns: string[];
  evidence: { signal: string; observed: string; ruleId: string; refs: string[]; provenance?: string }[]; riskFlags: string[]; logicAnalysis: "unavailable" | "partial" | "available";
};

const PATTERN: Record<Recommendation, { name: string; description: string }> = {
  deterministic: { name: "Keep deterministic RPA (stabilise)", description: "Fixed sequence and rules remain appropriate. The work is reliability and ownership, not adding AI." },
  ai_augmented: { name: "Deterministic flow + AI capability", description: "The existing flow stays in control; an AI service is called for a bounded task (classification/extraction/summarisation) and its output is validated before the flow continues." },
  hybrid: { name: "Hybrid: bounded AI decision, RPA/API execution", description: "An AI step makes a bounded decision from a fixed set of outcomes; existing automations execute the chosen path. Low-confidence outcomes go to a human." },
  governed_agentic: { name: "Policy-constrained agentic", description: "A model may choose its next permitted tool within explicit policy, identity, approval and audit limits. Not recommended until hybrid has run stably and tool contracts are known." },
  retire: { name: "Retire / consolidate", description: "Decommission or merge into the surviving deployment after owner confirmation." },
};

export function generatePlan(facts: ProcessFacts, a: PlanInput, now = new Date()): PlanContent {
  const rec = a.recommendation;
  const queue = facts.queue, trig = facts.triggers;
  const tools = facts.stableSiblingTools;
  const ev = a.evidence.map((e) => ({ signal: e.signal, observed: e.observed, ruleId: e.ruleId, refs: e.sourceRefs, provenance: e.provenance }));
  const uiVolatile = a.riskFlags.some((f) => f.startsWith("VOLATILE_UI"));

  const retained: string[] = [];
  if (trig.some((t) => t.kind === "time")) retained.push(`Time trigger(s): ${trig.filter((t) => t.kind === "time").map((t) => t.cron ?? "?").join(", ")}`);
  if (queue) retained.push(`Work queue "${queue.name}" and its retry/exception handling (${(queue.successRate * 100).toFixed(0)}% success over ${queue.total} items)`);
  retained.push(`Package ${facts.packageId} v${facts.version} as the execution layer${rec === "deterministic" || rec === "retire" ? "" : " (deterministic steps stay in RPA)"}`);

  const integrations: PlanContent["candidateIntegrations"] = [];
  if (rec === "hybrid" || rec === "governed_agentic") for (const t of tools) integrations.push({ name: t.name, kind: "existing UiPath process as tool", basis: `Stable in imported history: ${(t.failureRate * 100).toFixed(1)}% failures over ${t.jobs} jobs. Input/output contract UNKNOWN.` });
  if (rec === "ai_augmented") integrations.push({ name: "Document extraction / classification service", kind: "AI service (to be selected)", basis: `Exception reasons: ${queue?.topReasons.map((r) => `"${r.reason}"`).join(", ") || "none imported"}` });
  if (uiVolatile) integrations.push({ name: "API or data-layer replacement for the UI-driven steps", kind: "integration", basis: "Faults are dominated by selector/UI errors; target application API availability is UNKNOWN." });

  const policies = rec === "retire" ? ["No new development; freeze the schedule while confirmation is pending."] : rec === "deterministic" ? ["Change control on package publishing; alert on failure-rate regression."] : [
    "Allowed outcomes are an explicit enumerated list; anything else is rejected and escalated.",
    "Confidence threshold below which the case routes to a human (set during discovery).",
    "Every AI input/output and decision is logged with the model version and prompt version.",
    ...(rec === "governed_agentic" ? ["Explicit allow-list of tools; no tool may be added without review.", "Hard limits on actions per run and per hour; kill switch owned by operations."] : []),
  ];
  const identity = rec === "retire" || rec === "deterministic" ? ["Confirm the robot account is least-privilege and has an accountable owner."] : [
    "A dedicated, least-privilege service identity for the AI step; no shared human or robot credentials.",
    ...(facts.folderAssets.credentialLike ? [`${facts.folderAssets.credentialLike} credential-type asset(s) exist in ${facts.folderPath}: confirm which (if any) this process uses and scope access accordingly (usage is not visible via the API).`] : []),
    ...(rec === "governed_agentic" ? ["Per-tool permissions; the agent must never hold broader rights than the tool it invokes."] : []),
  ];
  const approvals = rec === "retire" ? ["Business-owner sign-off before decommissioning."] : rec === "deterministic" ? ["Process owner reviews the exception metrics quarterly."] : [
    "Human review of all low-confidence or out-of-policy outcomes during pilot.",
    "Process-owner approval of the decision criteria before go-live.",
    ...(rec === "governed_agentic" ? ["Human approval for any irreversible or externally visible action until a documented autonomy review passes."] : []),
  ];
  const validation = rec === "retire" ? ["No consumer reports an outage during a 30-day disabled period."] : rec === "deterministic" ? [`Failure rate stays at or below ${Math.max(5, Math.ceil(facts.jobs.failureRate * 100))}% over the next 90 days.`] : [
    "Offline evaluation on a labelled sample (target agreed with the owner) before any live traffic.",
    "Shadow mode: AI output compared with current outcomes, no side effects, for a defined period.",
    `Baseline to beat: ${queue ? `${(queue.businessExceptionRate * 100).toFixed(1)}% business-exception rate on queue "${queue.name}"` : `${(facts.jobs.failureRate * 100).toFixed(1)}% job failure rate`}.`,
    "Rollback to the current automation is a single configuration change and is tested.",
  ];

  const backlog: PlanContent["backlog"] = rec === "retire" ? [
    { phase: "1. Confirm", goal: "Establish that the process is unused", items: ["Ask the owner and downstream consumers", "Check schedules/triggers outside this Orchestrator"] },
    { phase: "2. Disable", goal: "Reversible switch-off", items: ["Disable triggers, keep the package", "Monitor 30 days"] },
    { phase: "3. Remove", goal: "Decommission", items: ["Archive package and documentation", "Remove release and unused assets"] }] : rec === "deterministic" ? [
    { phase: "1. Baseline", goal: "Understand current reliability", items: ["Assign an owner", "Set alert thresholds on failures and queue exceptions"] },
    ...(a.redesignReview ? [{ phase: "2. Redesign / risk review", goal: "Root-cause the failures before any migration", items: ["Analyse top error messages", ...(uiVolatile ? ["Evaluate API or data-layer alternatives to the UI steps", "Introduce resilient selectors or object repository"] : []), "Review the recent version history for patch-on-patch changes"] }] : []),
    { phase: `${a.redesignReview ? 3 : 2}. Operate`, goal: "Keep it healthy", items: ["Quarterly review of exception metrics"] }] : [
    { phase: "1. Discover", goal: "Close the information gaps", items: ["Upload the project package/XAML for logic analysis (when available)", "Sample and label 30-50 exception cases", "Document the decision criteria with the owner"] },
    { phase: "2. Design", goal: "Define the target pattern and guardrails", items: ["Specify allowed outcomes and confidence thresholds", "Define identities, logging and approval points", ...(integrations.length ? ["Confirm contracts for: " + integrations.map((i) => i.name).join(", ")] : [])] },
    { phase: "3. Pilot (shadow)", goal: "Prove value with no side effects", items: ["Run the AI step in shadow mode", "Compare against current outcomes"] },
    { phase: "4. Controlled rollout", goal: "Limited live traffic with human review", items: ["Gate on the validation criteria", "Keep rollback tested"] },
    ...(rec === "governed_agentic" ? [{ phase: "5. Expand autonomy", goal: "Only after hybrid is stable", items: ["Autonomy review against incident and error data", "Add tools one at a time"] }] : [])];

  return {
    schema: 1, processName: facts.name, folderPath: facts.folderPath, generatedAt: now.toISOString(), assessmentId: a.assessmentId, ruleVersion: a.ruleVersion, recommendation: rec, recommendationLabel: RECOMMENDATION_LABEL[rec], confidence: a.confidence,
    targetPattern: PATTERN[rec], retainedRpaElements: retained, candidateIntegrations: integrations, policies, identityAndRbac: identity, approvalPoints: approvals, validationCriteria: validation, backlog,
    assumptions: ["Imported Orchestrator telemetry (last 90 days) is representative of normal operation.", a.logicAnalysis === "available" ? `The package (v${facts.package?.analyzedVersion}) was analysed statically: workflow structure, selectors and references come from its source. Runtime behaviour, data content and business context were not observed.` : a.logicAnalysis === "partial" ? "The package was only partly analysed; unparsed workflows are unknown." : "The package's internal logic has NOT been analysed; decision points and integrations are inferred only from operational signals.", ...(a.runnerUp ? [`Runner-up recommendation by rule score: ${a.runnerUp}.`] : [])],
    unknowns: a.missingInformation, evidence: ev, riskFlags: a.riskFlags, logicAnalysis: a.logicAnalysis ?? "unavailable",
  };
}
