import { createHash } from "node:crypto";
import { RULES, RULESET_VERSION } from "./rules";
import { RECOMMENDATIONS, type AssessmentResult, type Finding, type ProcessFacts, type Recommendation } from "./types";

/** Confidence from API telemetry alone is capped: the package logic is not analysed. */
export const CONFIDENCE_CAP = 85;

const NEXT_STEP: Record<Recommendation, string> = {
  deterministic: "Confirm with the process owner that exception handling is adequate; no migration work needed. Revisit if exception rates rise.",
  ai_augmented: "Sample 30-50 failed/exception items and measure how many an extraction or classification model could resolve; upload the project package for logic analysis.",
  hybrid: "Workshop the escalated/exception cases with the process owner to define the bounded decision, its allowed outcomes and the human override; upload the project package for logic analysis.",
  governed_agentic: "Define the permitted tool set, identity and approval policy on paper, and confirm each candidate tool's input/output contract, before any build.",
  retire: "Confirm with the business owner that the process is unused; check for external references (other bots, schedules outside this Orchestrator), then decommission or consolidate.",
};

export function assess(facts: ProcessFacts): AssessmentResult {
  const findings = RULES.map((r) => r.evaluate(facts)).filter((f): f is Finding => f !== null);
  const scores = Object.fromEntries(RECOMMENDATIONS.map((r) => [r, 0])) as Record<Recommendation, number>;
  for (const f of findings) for (const [rec, w] of Object.entries(f.votes)) scores[rec as Recommendation] += w ?? 0;

  const ranked = [...RECOMMENDATIONS].sort((a, b) => scores[b] - scores[a] || RECOMMENDATIONS.indexOf(a) - RECOMMENDATIONS.indexOf(b));
  const recommendation = ranked[0];
  const runnerUpCandidate = ranked[1];
  const runnerUp = scores[runnerUpCandidate] > 0 ? runnerUpCandidate : null;

  const riskFlags = findings.filter((f) => f.risk).map((f) => `${f.risk!.code}: ${f.risk!.text}`);
  const riskScore = Math.min(100, findings.reduce((a, f) => a + (f.risk?.weight ?? 0), 0));
  const redesignReview = findings.some((f) => f.risk?.redesign);

  const missing: string[] = [
    "Logic analysis unavailable: Orchestrator APIs expose operational telemetry, not the package's workflow logic. Upload the project package/XAML (planned) to analyse decision points, selectors and integrations.",
    "Process-level asset and credential usage cannot be determined from the API (only folder-scope asset metadata is imported).",
    "No business context supplied (process owner, business criticality, data sensitivity, cost per transaction).",
  ];
  if (facts.jobs.total === 0) missing.push(`No execution history within the ${facts.jobs.windowDays}-day import window; older activity is unknown.`);
  else if (facts.jobs.total < 30) missing.push(`Only ${facts.jobs.total} jobs in the window; failure and volume statistics are weak.`);
  if (facts.triggers.some((t) => t.kind === "queue") && !facts.queue) missing.push("A queue trigger exists but queue-item signals could not be imported (check OR.Queues permissions).");
  if (!facts.queue && !facts.triggers.length) missing.push("No trigger found: how the process is started (manual, external API) is unknown.");
  if (recommendation === "hybrid" || recommendation === "governed_agentic") missing.push("Downstream tool/bot contracts (inputs, outputs, side effects) are unknown.");

  const maxScore = Math.max(...Object.values(scores));
  const second = scores[runnerUpCandidate];
  const margin = maxScore > 0 ? (maxScore - second) / maxScore : 0;
  const strongEvidence = findings.filter((f) => Object.keys(f.votes).length > 0 && f.ruleId !== "R03-baseline").length;
  const dataDomains = [facts.jobs.total > 0, !!facts.queue || !facts.triggers.some((t) => t.kind === "queue"), facts.triggers.length > 0, facts.versionCount > 0].filter(Boolean).length / 4;
  const confidence = Math.round(Math.max(10, Math.min(CONFIDENCE_CAP, 20 + 35 * margin + 25 * dataDomains + Math.min(15, strongEvidence * 5) - Math.min(15, riskFlags.length * 3) - (facts.jobs.total < 30 ? 10 : 0))));

  const supportPoints = Math.max(scores.ai_augmented, scores.hybrid, scores.governed_agentic);
  const volume = facts.jobs.perDay >= 10 ? 25 : facts.jobs.perDay >= 3 ? 15 : facts.jobs.perDay >= 1 ? 8 : 0;
  const opportunityScore = recommendation === "retire" ? 0 : Math.min(100, supportPoints * 9 + volume + (facts.queue ? Math.round(facts.queue.businessExceptionRate * 60) : 0));

  const rationale = findings.filter((f) => Object.keys(f.votes).length > 0 && f.ruleId !== "R03-baseline").map((f) => `${f.signal}: ${f.observed}. ${f.effect}`);
  if (rationale.length === 0) rationale.push("No strong signals in the imported data; defaulted to deterministic (weak prior).");
  if (redesignReview) rationale.push("Risk signals indicate a redesign/risk review should precede any migration; the recommendation above is the direction once the process is stable, not an instruction to add AI.");

  const inputHash = createHash("sha256").update(JSON.stringify({ rules: RULESET_VERSION, facts })).digest("hex").slice(0, 16);
  return { ruleVersion: RULESET_VERSION, recommendation, runnerUp, confidence, opportunityScore, riskScore, rationale, riskFlags, missingInformation: missing, nextStep: redesignReview ? `Run a redesign/risk review first (root-cause the failures). Then: ${NEXT_STEP[recommendation]}` : NEXT_STEP[recommendation], redesignReview, logicAnalysis: "unavailable", scores, findings, inputHash };
}
