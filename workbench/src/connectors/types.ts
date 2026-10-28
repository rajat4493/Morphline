/** Platform-neutral snapshot types. A connector (UiPath today; n8n, Bedrock AgentCore,
 *  OutSystems, generic APIs later) turns its platform into these shapes; everything
 *  downstream (import, assessment, plans) depends only on this file. */
export type SourceFolder = { id: string; key?: string; name: string; path: string; parentId?: string; raw: unknown };
export type SourceProcess = {
  id: string; key?: string; name: string; packageId: string; version: string; description?: string; processType?: string;
  createdAt?: string; folderId: string; raw: unknown; versions: { version: string; publishedAt?: string }[];
};
export type SourceJob = { id: string; processName: string; folderId: string; state: string; startedAt?: string; endedAt?: string; source?: string; info?: string; machine?: string; raw: unknown };
export type SourceQueue = { id: string; name: string; folderId: string; maxRetries?: number; raw: unknown; signal?: SourceQueueSignal };
export type SourceQueueSignal = { windowDays: number; total: number; successful: number; applicationExceptions: number; businessExceptions: number; abandoned: number; retried: number; topErrorReasons: { reason: string; count: number }[] };
export type SourceTrigger = { id: string; kind: "time" | "queue"; name: string; processName: string; folderId: string; cron?: string; enabled: boolean; queueName?: string; raw: unknown };
export type SourceMachine = { id: string; name: string; type?: string; runtimes?: number; raw: unknown };
/** Metadata only. There is intentionally no value field. */
export type SourceAsset = { id: string; name: string; valueType: string; valueScope?: string; description?: string; folderId: string };

export type FolderSnapshot = { processes: SourceProcess[]; jobs: SourceJob[]; queues: SourceQueue[]; triggers: SourceTrigger[]; assets: SourceAsset[] };
export type EstateIssue = { entity: string; folder?: string; message: string };

export type TestResult = { ok: boolean; message: string; details?: Record<string, string | number | boolean> };

export type PackageDownload = { ok: true; bytes: Buffer } | { ok: false; code: "denied" | "not_found" | "too_large" | "error"; message: string };

export interface EstateConnector {
  readonly kind: string;
  testConnection(): Promise<TestResult>;
  listFolders(): Promise<{ folders: SourceFolder[]; issues: EstateIssue[] }>;
  listMachines(): Promise<{ machines: SourceMachine[]; issues: EstateIssue[] }>;
  fetchFolder(folder: SourceFolder, opts: { jobWindowDays: number }): Promise<{ snapshot: FolderSnapshot; issues: EstateIssue[] }>;
  /** Read-only: downloads the exact package version. Optional; only called when package analysis is opted in. */
  downloadPackage?(args: { packageId: string; version: string; folder?: SourceFolder; maxBytes: number }): Promise<PackageDownload>;
}

export type ConnectorConfig = {
  kind: "uipath";
  baseUrl: string;            // e.g. https://cloud.uipath.com or https://orchestrator.corp.local
  organization?: string;      // Automation Cloud logical name
  tenant?: string;            // Automation Cloud tenant name
  tokenEnvVar: string;        // NAME of the env var holding the access token (token itself is never stored)
};
