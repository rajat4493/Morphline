import { createHash } from "node:crypto";
import { MIN_PACKAGE_COVERAGE, RULES, RULESET_VERSION, packageUsable } from "./rules";
import { RECOMMENDATIONS, type AssessmentResult, type Eligibility, type Finding, type LogicAnalysis, type ProcessFacts, type Recommendation } from "./types";

/** Confidence from API telemetry alone is capped: the package logic is not analysed. */
export const CONFIDENCE_CAP = 85;
/** With a trusted static package analysis (deployed version, identity match, >=80% of workflow files parsed) the cap rises. */
export const CONFIDENCE_CAP_WITH_PACKAGE = 90;

const NEXT_STEP: Record<Recommendation, string> = {
  deterministic: "Confirm with the process owner that exception handling is adequate; no migration work needed. Revisit if exception rates rise.",
  ai_augmented: "Sample 30-50 failed/exception items and measure how many an extraction or classification model could resolve; upload the project package for logic analysis.",
  hybrid: "Workshop the escalated/exception cases with the process owner to define the bounded decision, its allowed outcomes and the human override; upload the project package for logic analysis.",
  governed_agentic: "Define the permitted tool set, identity and approval policy on paper, and confirm each candidate tool's input/output contract, before any build.",
  retire: "Confirm with the business owner that the process is unused; check for external references (other bots, schedules outside this Orchestrator), then decommission or consolidate.",
};

const FAILURE_NOTE: Record<string, string> = {
  download_denied: "Package download was denied: the token lacks the Packages.View permission. Logic analysis is unavailable.",
  not_found: "The deployed package version was not found on the feed. Logic analysis is unavailable.",
  too_large: "The package exceeded the analysis size limit. Logic analysis is unavailable.",
  download_error: "The package could not be downloaded (see import history). Logic analysis is unavailable.",
  analyzer_failed: "The package analyzer failed on this package. Logic analysis is unavailable.",
  isolation_unavailable: "Package analysis requires sandbox isolation that this host cannot provide. Logic analysis is unavailable.",
};

export function assess(facts: ProcessFacts): AssessmentResult {
  const findings = RULES.map((r) => r.evaluate(facts)).filter((f): f is Finding => f !== null);
  const scores = Object.fromEntries(RECOMMENDATIONS.map((r) => [r, 0])) as Record<Recommendation, number>;
  for (const f of findings) for (const [rec, w] of Object.entries(f.votes)) scores[rec as Recommendation] += w ?? 0;

  // ---- package coverage: an explicit input to eligibility and confidence ----
  const pkg = facts.package ?? null;
  const usable = packageUsable(facts);
  const pkgCoverage = usable ? pkg!.coverage : 0;
  const pkgTrusted = pkgCoverage >= MIN_PACKAGE_COVERAGE;
  const logicAnalysis: LogicAnalysis = pkgTrusted ? "available" : pkgCoverage > 0 ? "partial" : "unavailable";

  const eligibility = Object.fromEntries(RECOMMENDATIONS.map((r) => [r, { eligible: true, reasons: [] as string[] }])) as Eligibility;
  if (!pkgTrusted) {
    const why = !pkg ? "Requires static package analysis, which has not been run (it is opt-in in Connectors)."
      : !pkg.versionMatches || pkg.identityMatches === false ? "The stored package analysis does not match the deployed version or package identity."
      : pkg.status !== "source_available" ? `Package analysis found no readable source (status: ${pkg.status.replace("_", " ")}${pkg.failure ? `, ${pkg.failure.replace("_", " ")}` : ""}).`
      : `Package analysis covers ${Math.round(pkgCoverage * 100)}% of workflow files; at least ${Math.round(MIN_PACKAGE_COVERAGE * 100)}% must parse from source.`;
    eligibility.governed_agentic = { eligible: false, reasons: [`Policy-constrained agentic needs known workflow logic. ${why}`] };
  }
  const eligible = RECOMMENDATIONS.filter((r) => eligibility[r].eligible);
  const rankOf = (sc: Record<Recommendation, number>) => [...eligible].sort((a, b) => sc[b] - sc[a] || RECOMMENDATIONS.indexOf(a) - RECOMMENDATIONS.indexOf(b));
  const ranked = rankOf(scores);
  const recommendation = ranked[0];
  const runnerUp = ranked[1] && scores[ranked[1]] > 0 ? ranked[1] : null;
  const gated = RECOMMENDATIONS.filter((r) => !eligibility[r].eligible && scores[r] > 0).map((r) => ({ option: r, score: scores[r], reasons: eligibility[r].reasons }));

  const riskFlags = findings.filter((f) => f.risk).map((f) => `${f.risk!.code}: ${f.risk!.text}`);
  const riskScore = Math.min(100, findings.reduce((a, f) => a + (f.risk?.weight ?? 0), 0));
  const redesignReview = findings.some((f) => f.risk?.redesign);

  const logicNote = !pkg ? "Logic analysis unavailable: Orchestrator APIs expose operational telemetry, not the package's workflow logic. Enable package analysis (opt-in, Connectors) or upload the project package to analyse decision points, selectors and integrations."
    : !pkg.versionMatches || pkg.identityMatches === false ? "Logic analysis unavailable: the stored package analysis does not match the deployed version or package identity, so it is ignored."
    : pkg.status === "source_available" ? (pkgTrusted ? `Package analysed (v${pkg.analyzedVersion}): ${pkg.workflows} workflow file(s), ${Math.round(pkg.coverage * 100)}% parsed from source. Runtime behaviour, data sensitivity and business context are still unknown.` : `Package partially analysed (${Math.round(pkg.coverage * 100)}% of workflow files parsed): workflow logic is only partly known. Request the unparsed source.`)
    : pkg.status === "compiled_only" ? "Package analysed but it contains only compiled assemblies: workflow logic cannot be read statically. Request the source project (XAML)."
    : pkg.status === "unreadable" ? "Package could not be read (encrypted, corrupt or unparseable workflow files): workflow logic is unknown."
    : FAILURE_NOTE[pkg.failure ?? ""] ?? "The package is missing or could not be analysed. Logic analysis is unavailable.";
  const missing: string[] = [
    logicNote,
    pkgTrusted ? "Asset and queue usage comes from literal references in the package; names resolved only at runtime (Config keys, expressions) are inferred, not confirmed." : "Process-level asset and credential usage cannot be determined from the API (only folder-scope asset metadata is imported).",
    "No business context supplied (process owner, business criticality, data sensitivity, cost per transaction).",
  ];
  if (facts.jobs.total === 0) missing.push(`No execution history within the ${facts.jobs.windowDays}-day import window; older activity is unknown.`);
  else if (facts.jobs.total < 30) missing.push(`Only ${facts.jobs.total} jobs in the window; failure and volume statistics are weak.`);
  if (facts.triggers.some((t) => t.kind === "queue") && !facts.queue) missing.push("A queue trigger exists but queue-item signals could not be imported (check OR.Queues permissions).");
  if (!facts.queue && !facts.triggers.length) missing.push("No trigger found: how the process is started (manual, external API) is unknown.");
  if (recommendation === "hybrid" || recommendation === "governed_agentic") missing.push("Downstream tool/bot contracts (inputs, outputs, side effects) are unknown.");
  if (pkg?.embedded && (pkg.embedded.scripts > 0 || pkg.embedded.executables > 0)) missing.push(`The package embeds ${pkg.embedded.scripts} script(s) and ${pkg.embedded.executables} executable(s). They were listed, never opened or run, and are not analysed.`);

  const dataDomains = [facts.jobs.total > 0, !!facts.queue || !facts.triggers.some((t) => t.kind === "queue"), facts.triggers.length > 0, facts.versionCount > 0].filter(Boolean).length / 4;
  const cap = pkgTrusted ? CONFIDENCE_CAP_WITH_PACKAGE : CONFIDENCE_CAP;
  /** Confidence from a score table + finding set, over ELIGIBLE options only. Used twice: with everything, and with deterministic findings only. */
  const confidenceOf = (sc: Record<Recommendation, number>, fs: Finding[]) => {
    // The recommendation comes from ELIGIBLE options only, but uncertainty is measured against ALL options: a gated option that scores close to
    // the winner means we cannot tell whether the answer would change once it becomes eligible, so excluding it must never make us more confident.
    const rec = rankOf(sc)[0], top = sc[rec];
    const second = Math.max(0, ...RECOMMENDATIONS.filter((r) => r !== rec).map((r) => sc[r]));
    const margin = top > 0 ? Math.max(0, (top - second) / top) : 0;
    const strong = fs.filter((f) => Object.keys(f.votes).length > 0 && f.ruleId !== "R03-baseline").length;
    const pkgTerm = Math.round(10 * pkgCoverage) - (pkg && pkgCoverage === 0 ? 5 : 0); // attempted but unusable: small penalty
    const raw = Math.round(Math.max(10, Math.min(cap, 20 + 35 * margin + 25 * dataDomains + Math.min(15, strong * 5) - Math.min(15, riskFlags.length * 3) - (facts.jobs.total < 30 ? 10 : 0) + pkgTerm)));
    return strong === 0 ? Math.min(raw, 40) : raw; // only the weak default prior fired: placeholder, not a finding
  };
  const detFindings = findings.filter((f) => f.provenance !== "ai_inferred");
  const detScores = Object.fromEntries(RECOMMENDATIONS.map((r) => [r, 0])) as Record<Recommendation, number>;
  for (const f of detFindings) for (const [rec, w] of Object.entries(f.votes)) detScores[rec as Recommendation] += w ?? 0;
  // AI-inferred evidence may influence the ranking, but can never raise confidence above what deterministic evidence alone supports.
  const confidence = Math.min(confidenceOf(scores, findings), confidenceOf(detScores, detFindings));

  // Opportunity is an ordering aid for priority lists: it uses deterministic evidence for ELIGIBLE options only.
  const supportPoints = Math.max(...(["ai_augmented", "hybrid", "governed_agentic"] as const).filter((r) => eligibility[r].eligible).map((r) => detScores[r]));
  const volume = facts.jobs.perDay >= 10 ? 25 : facts.jobs.perDay >= 3 ? 15 : facts.jobs.perDay >= 1 ? 8 : 0;
  const opportunityScore = recommendation === "retire" ? 0 : Math.min(100, supportPoints * 9 + volume + (facts.queue ? Math.round(facts.queue.businessExceptionRate * 60) : 0));

  const rationale = findings.filter((f) => Object.keys(f.votes).length > 0 && f.ruleId !== "R03-baseline").map((f) => `${f.provenance === "ai_inferred" ? "[AI-inferred] " : ""}${f.signal}: ${f.observed}. ${f.effect}`);
  if (rationale.length === 0) rationale.push("No strong signals in the imported data; defaulted to deterministic (weak prior).");
  for (const g of gated) rationale.push(`Not eligible: ${g.option.replace("_", " ")} has supporting evidence (score ${g.score}) but is excluded. ${g.reasons.join(" ")}`);
  if (redesignReview) rationale.push("Risk signals indicate a redesign/risk review should precede any migration; the recommendation above is the direction once the process is stable, not an instruction to add AI.");

  const aiUsed = findings.some((f) => f.provenance === "ai_inferred");
  if (aiUsed) missing.push("Some evidence is AI-inferred (model-labelled exception texts). It is lower trust: review the labelled texts in Evidence. It can influence ranking but never raises confidence.");
  if (facts.exceptionAi) {
    const items = facts.exceptionAi.items, tot = items.reduce((a, i) => a + i.count, 0) || 1;
    const dis = items.filter((i) => i.label !== "other_unclear" && i.keywordLabel !== "other_unclear" && i.label !== i.keywordLabel);
    if (dis.reduce((a, i) => a + i.count, 0) / tot >= 0.2) missing.push(`The AI labels disagree with the keyword baseline on ${dis.length} exception text(s) (${Math.round((dis.reduce((a, i) => a + i.count, 0) / tot) * 100)}% of occurrences). Human review of those labels is recommended.`);
  }
  const inputHash = createHash("sha256").update(JSON.stringify({ rules: RULESET_VERSION, facts })).digest("hex").slice(0, 16);
  const gateStep = gated.some((g) => g.option === "governed_agentic" && g.score >= scores[recommendation]) ? "Analyse the package source (Connectors > package analysis) to evaluate policy-constrained agentic eligibility. Then: " : "";
  const next = `${gateStep}${NEXT_STEP[recommendation]}`;
  return { ruleVersion: RULESET_VERSION, recommendation, runnerUp, confidence, opportunityScore, riskScore, rationale, riskFlags, missingInformation: missing, nextStep: redesignReview ? `Run a redesign/risk review first (root-cause the failures). Then: ${next}` : next, redesignReview, logicAnalysis, eligibility, gated, packageAnalysisId: pkg?.analysisId ?? null, scores, findings, inputHash };
}
