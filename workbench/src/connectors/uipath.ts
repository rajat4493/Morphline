import type { ConnectorConfig, EstateConnector, PackageDownload, EstateIssue, FolderSnapshot, SourceAsset, SourceFolder, SourceJob, SourceMachine, SourceProcess, SourceQueue, SourceTrigger, TestResult } from "./types";

type Fetch = typeof fetch;
type Odata<T> = { value: T[]; "@odata.count"?: number };
type Row = Record<string, unknown>;

export class UiPathHttpError extends Error {
  constructor(public status: number, public url: string, message: string) { super(message); }
}

const PAGE = 100;
const MAX_PAGES = 50;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? undefined : String(v));

/** Read-only UiPath Orchestrator client. Only HTTP GET is ever issued (enforced in `get`). */
export class UiPathConnector implements EstateConnector {
  readonly kind = "uipath";
  constructor(
    private cfg: ConnectorConfig,
    private deps: { fetch?: Fetch; env?: Record<string, string | undefined>; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  private get root(): string {
    const b = this.cfg.baseUrl.replace(/\/+$/, "");
    return this.cfg.organization && this.cfg.tenant ? `${b}/${this.cfg.organization}/${this.cfg.tenant}/orchestrator_` : b;
  }

  private token(): string {
    const t = (this.deps.env ?? process.env)[this.cfg.tokenEnvVar];
    if (!t) throw new UiPathHttpError(0, "", `Access token not found: environment variable ${this.cfg.tokenEnvVar} is not set on the server`);
    return t;
  }

  private async get<T>(path: string, query: Record<string, string | number> = {}, folder?: SourceFolder, attempt = 0): Promise<T> {
    const url = new URL(`${this.root}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token()}`, Accept: "application/json" };
    if (folder) { headers["X-UIPATH-OrganizationUnitId"] = folder.id; if (folder.key) headers["X-UIPATH-FolderKey"] = folder.key; }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    try {
      const res = await (this.deps.fetch ?? fetch)(url.toString(), { method: "GET", headers, signal: ac.signal });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await (this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(500 * 2 ** attempt);
        return this.get<T>(path, query, folder, attempt + 1);
      }
      if (!res.ok) throw new UiPathHttpError(res.status, path, explain(res.status, path));
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof UiPathHttpError) throw e;
      if ((e as Error).name === "AbortError") throw new UiPathHttpError(0, path, `Request to ${path} timed out after 20s`);
      throw new UiPathHttpError(0, path, `Network error calling ${path}: ${(e as Error).message}`);
    } finally { clearTimeout(timer); }
  }

  private truncations: string[] = [];

  private async page<T = Row>(path: string, query: Record<string, string | number>, folder?: SourceFolder): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < MAX_PAGES; i++) {
      const r = await this.get<Odata<T>>(path, { ...query, $top: PAGE, $skip: i * PAGE }, folder);
      out.push(...r.value);
      if (r.value.length < PAGE) return out;
    }
    this.truncations.push(`${path} truncated at ${MAX_PAGES * PAGE} rows; results are incomplete (narrow the window or folder selection)`);
    return out;
  }

  /** GET .../Processes/UiPath.Server.Configuration.OData.DownloadPackage(key='<packageId>:<version>'). Requires the Packages.View permission.
   *  The body is streamed with a hard size cap; it is never written to disk here. The key format is unverified against a live Orchestrator. */
  async downloadPackage(a: { packageId: string; version: string; folder?: SourceFolder; maxBytes: number }): Promise<PackageDownload> {
    const key = `${a.packageId}:${a.version}`;
    const url = new URL(`${this.root}/odata/Processes/UiPath.Server.Configuration.OData.DownloadPackage(key='${encodeURIComponent(key)}')`);
    let token: string;
    try { token = this.token(); } catch (e) { return { ok: false, code: "error", message: (e as Error).message }; }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/octet-stream" };
    if (a.folder) { headers["X-UIPATH-OrganizationUnitId"] = a.folder.id; if (a.folder.key) headers["X-UIPATH-FolderKey"] = a.folder.key; }
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 120_000);
    try {
      const res = await (this.deps.fetch ?? fetch)(url.toString(), { method: "GET", headers, signal: ac.signal });
      if (res.status === 401 || res.status === 403) return { ok: false, code: "denied", message: "Forbidden: the token lacks the Packages.View permission (or is invalid). No package was downloaded." };
      if (res.status === 404) return { ok: false, code: "not_found", message: `Package ${key} was not found on the feed.` };
      if (!res.ok) return { ok: false, code: "error", message: `Orchestrator returned HTTP ${res.status} for DownloadPackage.` };
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > a.maxBytes) { ac.abort(); return { ok: false, code: "too_large", message: `Package is ${declared} bytes, over the ${a.maxBytes} byte limit.` }; }
      const chunks: Buffer[] = []; let size = 0;
      const reader = res.body?.getReader();
      if (!reader) return { ok: false, code: "error", message: "Empty response body." };
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > a.maxBytes) { ac.abort(); return { ok: false, code: "too_large", message: `Package exceeded the ${a.maxBytes} byte limit while downloading.` }; } chunks.push(Buffer.from(value)); }
      return { ok: true, bytes: Buffer.concat(chunks) };
    } catch (e) { return { ok: false, code: "error", message: (e as Error).name === "AbortError" ? "DownloadPackage timed out." : `Network error: ${(e as Error).message}` }; }
    finally { clearTimeout(timer); }
  }

  async testConnection(): Promise<TestResult> {
    try {
      const r = await this.get<Odata<Row>>("/odata/Folders", { $top: 1, $count: "true" });
      return { ok: true, message: `Connected. ${r["@odata.count"] ?? "?"} folder(s) visible to this token.`, details: { folders: r["@odata.count"] ?? -1 } };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  }

  async listFolders() {
    const issues: EstateIssue[] = [];
    try {
      const rows = await this.page("/odata/Folders", { $select: "Id,Key,DisplayName,FullyQualifiedName,ParentId" });
      const folders: SourceFolder[] = rows.map((r) => ({ id: str(r.Id)!, key: str(r.Key), name: str(r.DisplayName) ?? "?", path: str(r.FullyQualifiedName) ?? str(r.DisplayName) ?? "?", parentId: str(r.ParentId), raw: r }));
      return { folders, issues };
    } catch (e) { return { folders: [], issues: [{ entity: "folders", message: (e as Error).message }] }; }
  }

  async listMachines() {
    try {
      const rows = await this.page("/odata/Machines", {});
      const machines: SourceMachine[] = rows.map((r) => ({ id: str(r.Id)!, name: str(r.Name) ?? "?", type: str(r.Type), runtimes: Number(r.UnattendedSlots ?? 0) + Number(r.NonProductionSlots ?? 0), raw: r }));
      return { machines, issues: [] as EstateIssue[] };
    } catch (e) { return { machines: [], issues: [{ entity: "machines", message: (e as Error).message }] }; }
  }

  async fetchFolder(folder: SourceFolder, opts: { jobWindowDays: number }) {
    const issues: EstateIssue[] = [];
    const guard = async <T>(entity: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch (e) { issues.push({ entity, folder: folder.path, message: (e as Error).message }); return fallback; }
    };
    const since = new Date(Date.now() - opts.jobWindowDays * 86400_000).toISOString();

    const processes = await guard("releases", async () => {
      const rows = await this.page("/odata/Releases", {}, folder);
      const out: SourceProcess[] = [];
      for (const r of rows) {
        const packageId = str(r.ProcessKey) ?? str(r.Name) ?? "?";
        const versions = await guard("package_versions", async () => {
          const v = await this.get<Odata<Row>>(`/odata/Processes/UiPath.Server.Configuration.OData.GetProcessVersions(processId='${encodeURIComponent(packageId)}')`, {}, folder);
          return v.value.map((x) => ({ version: str(x.Version) ?? "?", publishedAt: str(x.Published) }));
        }, [] as { version: string; publishedAt?: string }[]);
        out.push({ id: str(r.Id)!, key: str(r.Key), name: str(r.Name) ?? packageId, packageId, version: str(r.ProcessVersion) ?? "?", description: str(r.Description), processType: str(r.ProcessType), createdAt: str(r.CreationTime), folderId: folder.id, raw: r, versions });
      }
      return out;
    }, [] as SourceProcess[]);

    const jobs = await guard("jobs", async () => {
      const rows = await this.page("/odata/Jobs", { $filter: `StartTime ge ${since}`, $orderby: "StartTime desc", $select: "Id,Key,State,StartTime,EndTime,Source,Info,ReleaseName,HostMachineName" }, folder);
      return rows.map((r): SourceJob => ({ id: str(r.Id)!, processName: str(r.ReleaseName) ?? "?", folderId: folder.id, state: str(r.State) ?? "Unknown", startedAt: str(r.StartTime), endedAt: str(r.EndTime), source: str(r.Source), info: str(r.Info), machine: str(r.HostMachineName), raw: pick(r, ["Id", "State", "StartTime", "EndTime", "Source", "ReleaseName", "HostMachineName"]) }));
    }, [] as SourceJob[]);

    const queues = await guard("queues", async () => {
      const defs = await this.page("/odata/QueueDefinitions", {}, folder);
      const out: SourceQueue[] = [];
      for (const q of defs) {
        const queue: SourceQueue = { id: str(q.Id)!, name: str(q.Name) ?? "?", folderId: folder.id, maxRetries: q.MaxNumberOfRetries == null ? undefined : Number(q.MaxNumberOfRetries), raw: pick(q, ["Id", "Name", "MaxNumberOfRetries"]) };
        queue.signal = await guard("queue_items", () => this.queueSignal(folder, queue.id, opts.jobWindowDays, since), undefined);
        out.push(queue);
      }
      return out;
    }, [] as SourceQueue[]);

    const triggers = await guard("triggers", async () => {
      const out: SourceTrigger[] = [];
      for (const r of await this.page("/odata/ProcessSchedules", {}, folder)) out.push({ id: str(r.Id)!, kind: "time", name: str(r.Name) ?? "?", processName: str(r.ReleaseName) ?? "?", folderId: folder.id, cron: str(r.StartProcessCron), enabled: r.Enabled !== false, raw: pick(r, ["Id", "Name", "StartProcessCron", "Enabled", "ReleaseName"]) });
      try {
        for (const r of await this.page("/odata/QueueTriggers", {}, folder)) out.push({ id: str(r.Id)!, kind: "queue", name: str(r.Name) ?? "?", processName: str(r.ReleaseName) ?? "?", folderId: folder.id, enabled: r.Enabled !== false, queueName: str(r.QueueDefinitionName), raw: pick(r, ["Id", "Name", "Enabled", "ReleaseName", "QueueDefinitionName"]) });
      } catch (e) { issues.push({ entity: "queue_triggers", folder: folder.path, message: (e as Error).message }); }
      return out;
    }, [] as SourceTrigger[]);

    const assets = await guard("assets", async () => {
      // $select deliberately omits value fields; the mapper below also whitelists fields so values can never be stored.
      const rows = await this.page("/odata/Assets", { $select: "Id,Name,ValueType,ValueScope,Description" }, folder);
      return rows.map((r): SourceAsset => ({ id: str(r.Id)!, name: str(r.Name) ?? "?", valueType: str(r.ValueType) ?? "Unknown", valueScope: str(r.ValueScope), description: str(r.Description), folderId: folder.id }));
    }, [] as SourceAsset[]);

    for (const t of this.truncations.splice(0)) issues.push({ entity: "pagination", folder: folder.path, message: t });
    const snapshot: FolderSnapshot = { processes, jobs, queues, triggers, assets };
    return { snapshot, issues };
  }

  /** Aggregates queue-item outcomes without ever selecting item payloads (SpecificContent/Output). */
  private async queueSignal(folder: SourceFolder, queueId: string, windowDays: number, since: string) {
    const rows = await this.page("/odata/QueueItems", { $filter: `QueueDefinitionId eq ${queueId} and CreationTime ge ${since}`, $select: "Status,ProcessingExceptionType,RetryNumber,ReviewStatus", $expand: "ProcessingException($select=Reason)" }, folder);
    const sig = { windowDays, total: rows.length, successful: 0, applicationExceptions: 0, businessExceptions: 0, abandoned: 0, retried: 0, topErrorReasons: [] as { reason: string; count: number }[] };
    const reasons = new Map<string, number>();
    for (const r of rows) {
      if (r.Status === "Successful") sig.successful++;
      if (r.Status === "Abandoned") sig.abandoned++;
      if (Number(r.RetryNumber ?? 0) > 0) sig.retried++;
      if (r.ProcessingExceptionType === "ApplicationException") sig.applicationExceptions++;
      if (r.ProcessingExceptionType === "BusinessException") sig.businessExceptions++;
      const reason = str((r.ProcessingException as Row | undefined)?.Reason);
      if (reason) reasons.set(reason.slice(0, 160), (reasons.get(reason.slice(0, 160)) ?? 0) + 1);
    }
    sig.topErrorReasons = [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count }));
    return sig;
  }
}

const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]));

function explain(status: number, path: string): string {
  const hint: Record<number, string> = {
    401: "Unauthorized: the access token is missing, expired or for a different tenant/organisation.",
    403: "Forbidden: the token lacks the required scope/role (e.g. OR.Folders.Read, OR.Jobs.Read, OR.Queues.Read, OR.Assets.Read, OR.Machines.Read, OR.Execution.Read).",
    404: "Not found: check the Orchestrator URL, organisation and tenant names, or that this endpoint exists on your Orchestrator version (see {url}/swagger/index.html).",
  };
  return `${hint[status] ?? `Orchestrator returned HTTP ${status}`} [${path}]`;
}
