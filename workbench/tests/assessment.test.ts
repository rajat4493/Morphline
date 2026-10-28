import { describe, expect, it } from "vitest";
import { assess, CONFIDENCE_CAP } from "@/assessment/engine";
import type { PackageFacts, ProcessFacts } from "@/assessment/types";

const base = (o: Partial<ProcessFacts> = {}): ProcessFacts => ({
  processId: "p", name: "Generic_Process", packageId: "GenericProcess", description: "", version: "1.0.0", folderPath: "Shared/X",
  versionCount: 2, versionsLast180d: 0, daysSinceLastPublish: 300,
  jobs: { windowDays: 90, total: 90, successful: 89, faulted: 1, failureRate: 0.011, perDay: 1, daysSinceLastRun: 0, avgDurationSec: 100, escalated: 0, topErrors: [], uiFaults: 0 },
  triggers: [{ kind: "time", cron: "0 6 * * *", enabled: true }], queue: null, folderAssets: { total: 0, credentialLike: 0 }, duplicatesOf: [], stableSiblingTools: [], ...o,
});
export const pkgFacts = (o: Partial<PackageFacts> = {}): PackageFacts => ({
  analysisId: "a1", deployedVersion: "1.0.0", analyzedVersion: "1.0.0", versionMatches: true, status: "source_available", failure: null, failureDetail: null, coverage: 1, identityMatches: true, workflows: 4, activities: 60,
  ui: { actions: 0, imageBased: 0, selectors: 0, fragile: 0, idx: 0 }, integrations: { api: 0, database: 0, file: 0, email: 0, queue: 0, document: 0, code: 0 },
  control: { branches: 5, loops: 2, retries: 1, tryCatch: 2, catches: 2, continueOnError: 0, businessRuleExceptions: 0, cyclomatic: 8 }, hardcoded: { secrets: 0, connectionStrings: 0, paths: 0, emails: 0 }, embedded: { scripts: 0, executables: 0 }, diff: null, ...o,
});
const queue = (o: Partial<NonNullable<ProcessFacts["queue"]>>) => ({ name: "Q", total: 500, successRate: 0.7, businessExceptionRate: 0.2, applicationExceptionRate: 0.04, abandonedRate: 0.02, retriedRate: 0.1, topReasons: [], ...o });

describe("recommendation rules", () => {
  it("stable, low-exception scheduled process -> deterministic with evidence", () => {
    const r = assess(base());
    expect(r.recommendation).toBe("deterministic");
    expect(r.findings.map((f) => f.ruleId)).toContain("R01-stable-low-exception");
    expect(r.rationale.join(" ")).toMatch(/failure rate/);
    expect(r.ruleVersion).toMatch(/^rules-/);
  });
  it("document-style exceptions -> ai_augmented", () => {
    const r = assess(base({ name: "Invoice_Data_Extraction", triggers: [{ kind: "queue", enabled: true, queueName: "Q" }], queue: queue({ topReasons: [{ reason: "Invoice layout not recognised", count: 60 }, { reason: "OCR confidence below threshold", count: 30 }] }) }));
    expect(r.recommendation).toBe("ai_augmented");
  });
  it("routing judgment + escalations -> hybrid, governed_agentic as runner-up only with stable tools", () => {
    const f = base({ name: "Ticket_Triage", jobs: { ...base().jobs, total: 1000, perDay: 11, escalated: 200 }, triggers: [{ kind: "queue", enabled: true, queueName: "Q" }],
      queue: queue({ businessExceptionRate: 0.31, topReasons: [{ reason: "Category unclear", count: 120 }, { reason: "Needs manual routing", count: 80 }] }),
      stableSiblingTools: [{ name: "A", failureRate: 0.02, jobs: 500 }, { name: "B", failureRate: 0.05, jobs: 400 }] });
    const r = assess(f);
    expect(r.recommendation).toBe("hybrid");
    // no package analysis: governed agentic has evidence but is NOT eligible, so it cannot be runner-up
    expect(r.runnerUp).not.toBe("governed_agentic");
    expect(r.eligibility.governed_agentic.eligible).toBe(false);
    expect(r.eligibility.governed_agentic.reasons[0]).toMatch(/has not been run/);
    expect(r.gated.map((g) => g.option)).toContain("governed_agentic");
    // with a trusted package analysis it becomes eligible again and is the runner-up, but only with stable tools
    expect(assess({ ...f, package: pkgFacts() }).runnerUp).toBe("governed_agentic");
    expect(assess({ ...f, stableSiblingTools: [], package: pkgFacts() }).runnerUp).not.toBe("governed_agentic");
  });
  it("high failure with UI faults -> redesign review, never agentic", () => {
    const r = assess(base({ name: "Legacy_Mainframe", versionsLast180d: 9, jobs: { ...base().jobs, total: 700, faulted: 266, successful: 434, failureRate: 0.38, uiFaults: 250, topErrors: [{ text: "Selector not found", count: 200 }] } }));
    expect(r.redesignReview).toBe(true);
    expect(["deterministic"]).toContain(r.recommendation);
    expect(r.riskFlags.join(" ")).toMatch(/VOLATILE_UI/);
    expect(r.nextStep).toMatch(/redesign\/risk review first/);
    expect(r.confidence).toBeLessThanOrEqual(40); // only the weak prior supports the label
  });
  it("dormant duplicate with disabled trigger -> retire", () => {
    const r = assess(base({ name: "Report_Copy", jobs: { ...base().jobs, total: 0, successful: 0, faulted: 0, failureRate: 0, perDay: 0, daysSinceLastRun: null }, triggers: [{ kind: "time", enabled: false }], duplicatesOf: [{ processName: "Report", jobs: 13, version: "1.1.0" }] }));
    expect(r.recommendation).toBe("retire");
    expect(r.missingInformation.join(" ")).toMatch(/No execution history/);
  });
  it("always states logic analysis is unavailable and caps confidence", () => {
    for (const f of [base(), base({ jobs: { ...base().jobs, total: 5 } })]) {
      const r = assess(f);
      expect(r.logicAnalysis).toBe("unavailable");
      expect(r.confidence).toBeLessThanOrEqual(CONFIDENCE_CAP);
      expect(r.missingInformation[0]).toMatch(/Logic analysis unavailable/);
    }
  });
  it("is deterministic: same facts -> same hash and result", () => {
    expect(assess(base()).inputHash).toBe(assess(base()).inputHash);
  });
});

describe("AI-labelled exception evidence (rules)", () => {
  const item = (text: string, label: string, count: number, confidence = 90) => ({ text, count, source: "queue" as const, label, confidence, rationale: "", keywordLabel: label });
  const withAi = (items: ReturnType<typeof item>[]) => base({ exceptionAi: { method: "llm", model: "m", items } });
  it("needs a minimum sample before it may vote", () => {
    const small = assess(withAi([item("Invoice layout not recognised", "document_input", 3)]));
    expect(small.scores.ai_augmented).toBe(0);
    expect(small.findings.find((f) => f.ruleId === "R15-ai-exception-mix")!.effect).toMatch(/sample too small/);
    const big = assess(withAi([item("a", "document_input", 30), item("b", "document_input", 20)]));
    expect(big.scores.ai_augmented).toBe(2);
  });
  it("ignores low-confidence labels and 'other_unclear'", () => {
    const r = assess(withAi([item("a", "document_input", 40, 40), item("b", "other_unclear", 40)]));
    expect(r.scores.ai_augmented).toBe(0);
  });
  it("is marked ai_inferred, never raises confidence, and leaves opportunity untouched", () => {
    const off = assess(base({ queue: queue({ businessExceptionRate: 0.2 }) }));
    const on = assess(withAi([item("a", "classification_ambiguity", 60), item("b", "classification_ambiguity", 40)]));
    const onSame = assess({ ...withAi([item("a", "classification_ambiguity", 60), item("b", "classification_ambiguity", 40)]), queue: queue({ businessExceptionRate: 0.2 }) });
    expect(onSame.findings.find((f) => f.ruleId === "R15-ai-exception-mix")!.provenance).toBe("ai_inferred");
    expect(onSame.confidence).toBeLessThanOrEqual(off.confidence);
    expect(onSame.opportunityScore).toBe(off.opportunityScore);
    expect(on.rationale.join(" ")).toMatch(/\[AI-inferred\]/);
  });
  it("flags dominant reference-data exceptions as a data-quality risk, not an AI opportunity", () => {
    const r = assess(withAi([item("Supplier not found", "reference_data_missing", 40), item("Vendor missing", "reference_data_missing", 30)]));
    expect(r.riskFlags.join(" ")).toMatch(/DATA_QUALITY_EXCEPTIONS/);
    expect(r.scores.ai_augmented + r.scores.hybrid).toBe(0);
  });
});
