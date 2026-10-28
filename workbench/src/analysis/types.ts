export type SourceStatus = "source_available" | "compiled_only" | "unreadable" | "missing";
export type Counts = { ui: number; imageBased: number; api: number; database: number; file: number; email: number; queue: number; asset: number; document: number; code: number; branches: number; loops: number; retries: number; tryCatch: number; catches: number; finallyBlocks: number; throws: number; rethrows: number; continueOnError: number; businessRuleExceptions: number };
export type WorkflowFacts = { file: string; test: boolean; parsed: boolean; error: string | null; activities: number; depth: number; complexity: number; hash: string | null; args: { name: string; dir: string; type: string }[]; invokes: { kind: "file" | "dynamic"; target: string | null; resolved: boolean }[]; counts: Counts | null; selectorFps: string[]; selectors: { total: number; fragile: number } | null };
export type RefLiteral = { name: string; op: string; workflow: string };
export type ConfigRef = { key: string; op: string; workflow: string };
export type Totals = {
  activities: number; byCategory: Record<"ui" | "imageBased" | "api" | "database" | "file" | "email" | "queue" | "asset" | "document" | "code", number>; topActivities: Record<string, number>; unclassified: Record<string, number>;
  control: { branches: number; loops: number; retries: number; tryCatch: number; catches: number; finallyBlocks: number; throws: number; rethrows: number; continueOnError: number; businessRuleExceptions: number; maxDepth: number; cyclomatic: number };
  ui: { selectors: number; fragile: number; idx: number; dynamic: number; byRoot: Record<string, number>; apps: string[] };
  integrations: { hosts: string[]; dbProviders: string[]; hardcodedConnectionStrings: number; hardcodedPaths: number; hardcodedEmails: number; hardcodedSecrets: number; fileExts: Record<string, number> };
  references: { assets: RefLiteral[]; queues: RefLiteral[]; configKeys: Record<string, number>; externalProcesses: string[]; dynamic: number; assetConfigRefs: ConfigRef[]; queueConfigRefs: ConfigRef[] };
  args: { inbound: number; outbound: number };
};
export type PackageGraph = {
  analyzerVersion: string; sha256: string; bytes: number; entryCount: number;
  source: { status: SourceStatus; reasons: string[]; xamlTotal: number; xamlParsed: number; xamlFailed: number; dllCount: number; encryptedEntries: number };
  coverage: number; identity: { id: string | null; version: string | null } | null;
  project: { name: string; projectType: string | null; expressionLanguage: string | null; studioVersion: string | null; targetFramework: string | null; main: string | null; entryPoints: string[]; dependencies: { id: string; version: string }[] } | null;
  workflows: WorkflowFacts[]; edges: { from: string; to: string | null; kind: "file" | "dynamic"; resolved: boolean }[]; entry: string | null; unreachable: string[]; totals: Totals | null;
  embedded: { scripts: number; executables: number; dlls: number; other: number; byExt: Record<string, number> }; limits: { hit: string[] }; warnings: string[];
};

export type PackageDiff = {
  comparable: boolean; reasons: string[]; fromVersion: string; toVersion: string;
  workflowsAdded: string[]; workflowsRemoved: string[]; workflowsChanged: string[]; workflowsTotal: number; changeRatio: number;
  selectorsAdded: number; selectorsRemoved: number; selectorUnion: number; selectorChurn: number;
  dependencyChanges: { added: { id: string; version: string }[]; removed: { id: string; version: string }[]; changed: { id: string; from: string; to: string }[] };
  activityDelta: Record<string, number>; invokesAdded: number; invokesRemoved: number; argChanges: number;
};
