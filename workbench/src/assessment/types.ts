export const RECOMMENDATIONS = ["deterministic", "ai_augmented", "hybrid", "governed_agentic", "retire"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  deterministic: "Deterministic (keep RPA)", ai_augmented: "AI-augmented", hybrid: "Hybrid", governed_agentic: "Policy-constrained agentic", retire: "Retire / consolidate",
};

export type ExceptionAiItem = { text: string; count: number; source: "queue" | "job"; label: string; confidence: number; rationale: string; keywordLabel: string };

export type ProcessFacts = {
  processId: string; name: string; packageId: string; description: string; version: string; folderPath: string;
  versionCount: number; versionsLast180d: number; daysSinceLastPublish: number | null;
  jobs: { windowDays: number; total: number; successful: number; faulted: number; failureRate: number; perDay: number; daysSinceLastRun: number | null; avgDurationSec: number | null; escalated: number; topErrors: { text: string; count: number }[]; uiFaults: number };
  triggers: { kind: string; cron?: string | null; enabled: boolean; queueName?: string | null }[];
  queue: null | { name: string; total: number; successRate: number; businessExceptionRate: number; applicationExceptionRate: number; abandonedRate: number; retriedRate: number; topReasons: { reason: string; count: number }[] };
  folderAssets: { total: number; credentialLike: number };
  duplicatesOf: { processName: string; jobs: number; version: string }[];
  stableSiblingTools: { name: string; failureRate: number; jobs: number }[];
  /** Model-labelled exception texts (lower trust). Absent when the AI evidence layer is off. */
  exceptionAi?: null | { method: string; model: string; items: ExceptionAiItem[] };
};

export type Finding = {
  ruleId: string; signal: string; observed: string; effect: string;
  votes: Partial<Record<Recommendation, number>>; risk?: { code: string; text: string; weight: number; redesign?: boolean };
  sourceEntity: string; sourceRefs: string[];
  provenance?: "deterministic" | "ai_inferred"; detail?: unknown;
};

export type AssessmentResult = {
  ruleVersion: string; recommendation: Recommendation; runnerUp: Recommendation | null; confidence: number; opportunityScore: number; riskScore: number;
  rationale: string[]; riskFlags: string[]; missingInformation: string[]; nextStep: string; redesignReview: boolean; logicAnalysis: "unavailable";
  scores: Record<Recommendation, number>; findings: Finding[]; inputHash: string;
};
