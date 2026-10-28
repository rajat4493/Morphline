export const RECOMMENDATIONS = ["deterministic", "ai_augmented", "hybrid", "governed_agentic", "retire"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  deterministic: "Deterministic (keep RPA)", ai_augmented: "AI-augmented", hybrid: "Hybrid", governed_agentic: "Policy-constrained agentic", retire: "Retire / consolidate",
};

export type ExceptionAiItem = { text: string; count: number; source: "queue" | "job"; label: string; confidence: number; rationale: string; keywordLabel: string };

export type PackageFacts = {
  analysisId: string; deployedVersion: string; analyzedVersion: string; versionMatches: boolean;
  status: "source_available" | "compiled_only" | "unreadable" | "missing"; failure: string | null; failureDetail: string | null; coverage: number; identityMatches: boolean | null;
  workflows: number; activities: number;
  ui: { actions: number; imageBased: number; selectors: number; fragile: number; idx: number };
  integrations: { api: number; database: number; file: number; email: number; queue: number; document: number; code: number };
  control: { branches: number; loops: number; retries: number; tryCatch: number; catches: number; continueOnError: number; businessRuleExceptions: number; cyclomatic: number };
  hardcoded: { secrets: number; connectionStrings: number; paths: number; emails: number }; embedded: { scripts: number; executables: number };
  diff: null | { fromVersion: string; comparable: boolean; workflowsTotal: number; selectorUnion: number; changeRatio: number; selectorChurn: number; workflowsChanged: number; workflowsAdded: number; workflowsRemoved: number; dependencyChanges: number };
};

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
  /** Static package analysis of the deployed version. null/absent = never analysed (opt-in off). */
  package?: PackageFacts | null;
};

export type Finding = {
  ruleId: string; signal: string; observed: string; effect: string;
  votes: Partial<Record<Recommendation, number>>; risk?: { code: string; text: string; weight: number; redesign?: boolean };
  sourceEntity: string; sourceRefs: string[];
  provenance?: "deterministic" | "ai_inferred"; detail?: unknown;
};

export type Eligibility = Record<Recommendation, { eligible: boolean; reasons: string[] }>;
export type LogicAnalysis = "unavailable" | "partial" | "available";

export type AssessmentResult = {
  ruleVersion: string; recommendation: Recommendation; runnerUp: Recommendation | null; confidence: number; opportunityScore: number; riskScore: number;
  rationale: string[]; riskFlags: string[]; missingInformation: string[]; nextStep: string; redesignReview: boolean; logicAnalysis: LogicAnalysis; eligibility: Eligibility; gated: { option: Recommendation; score: number; reasons: string[] }[]; packageAnalysisId: string | null;
  scores: Record<Recommendation, number>; findings: Finding[]; inputHash: string;
};
