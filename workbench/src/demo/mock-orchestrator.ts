/** In-process fake of the Orchestrator OData API used for demo mode and tests.
 *  The REAL UiPathConnector runs against this via an injected fetch, so demo mode
 *  exercises the same request building, pagination and normalisation as production.
 *  Assets deliberately include value-bearing fields to prove they are never stored. */
export const DEMO_TOKEN = "demo-token-not-a-secret";
export const SECRET_CANARY = "CANARY-SECRET-VALUE-9f3a";

type Row = Record<string, unknown>;
type Proc = { id: number; name: string; pkg: string; folder: number; versions: { v: string; daysAgo: number }[]; desc: string; type?: string;
  jobs: { perDay: number; successRate: number; activeDays: number; lastRunDaysAgo: number; faults: string[]; durSec: number; infoEscalate?: number; machines?: string[] };
  cron?: { expr: string; enabled: boolean }; queue?: string };
type Q = { id: number; name: string; folder: number; total: number; success: number; biz: number; app: number; abandoned: number; retried: number; reasons: string[] };

const DAY = 86400_000;
const FOLDERS = [
  { Id: 101, Key: "f-101", DisplayName: "AP", FullyQualifiedName: "Shared/Finance/AP", ParentId: 100 },
  { Id: 102, Key: "f-102", DisplayName: "ServiceDesk", FullyQualifiedName: "Shared/IT/ServiceDesk", ParentId: 100 },
  { Id: 103, Key: "f-103", DisplayName: "Claims", FullyQualifiedName: "Shared/Insurance/Claims", ParentId: 100 },
  { Id: 104, Key: "f-104", DisplayName: "Reporting", FullyQualifiedName: "Shared/Finance/Reporting", ParentId: 100 },
  { Id: 105, Key: "f-105", DisplayName: "CustomerService", FullyQualifiedName: "Shared/Operations/CustomerService", ParentId: 100 },
];
const MACHINES = [
  { Id: 1, Name: "PROD-RPA-01", Type: "Standard", UnattendedSlots: 4, NonProductionSlots: 0 },
  { Id: 2, Name: "PROD-RPA-02", Type: "Standard", UnattendedSlots: 4, NonProductionSlots: 0 },
  { Id: 3, Name: "LEGACY-VDI-07", Type: "Standard", UnattendedSlots: 1, NonProductionSlots: 0 },
];
const PROCS: Proc[] = [
  { id: 1, name: "Invoice_Portal_Download", pkg: "InvoicePortalDownload", folder: 101, desc: "Downloads supplier invoices from the AP portal to the shared drive.", type: "Process",
    versions: [{ v: "2.0.0", daysAgo: 700 }, { v: "2.3.1", daysAgo: 380 }], jobs: { perDay: 1, successRate: 0.99, activeDays: 90, lastRunDaysAgo: 0, faults: ["Portal login page layout changed"], durSec: 420, machines: ["PROD-RPA-01"] }, cron: { expr: "0 6 * * *", enabled: true } },
  { id: 2, name: "Invoice_Data_Extraction", pkg: "InvoiceDocumentExtraction", folder: 101, desc: "Extract header and line items from supplier invoice PDFs and post to ERP.", type: "Process",
    versions: [{ v: "1.4.0", daysAgo: 160 }, { v: "1.5.2", daysAgo: 40 }], jobs: { perDay: 4, successRate: 0.82, activeDays: 90, lastRunDaysAgo: 0, faults: ["Unrecognised invoice layout"], durSec: 300, machines: ["PROD-RPA-01", "PROD-RPA-02"] }, queue: "InvoiceDocs" },
  { id: 3, name: "ServiceDesk_Ticket_Triage", pkg: "ServiceDeskTicketTriage", folder: 102, desc: "Reads incoming IT tickets and dispatches them to fulfilment queues.", type: "Process",
    versions: [{ v: "3.1.0", daysAgo: 200 }, { v: "3.4.0", daysAgo: 25 }], jobs: { perDay: 12, successRate: 0.91, activeDays: 90, lastRunDaysAgo: 0, faults: ["Ticket category could not be determined"], durSec: 90, infoEscalate: 0.2, machines: ["PROD-RPA-02"] }, queue: "ITTickets" },
  { id: 4, name: "ServiceDesk_PasswordReset", pkg: "ServiceDeskPasswordReset", folder: 102, desc: "Resets AD passwords for verified requests.", type: "Process",
    versions: [{ v: "1.2.0", daysAgo: 260 }], jobs: { perDay: 6, successRate: 0.98, activeDays: 90, lastRunDaysAgo: 0, faults: ["AD timeout"], durSec: 60, machines: ["PROD-RPA-02"] }, queue: "PasswordResets" },
  { id: 5, name: "ServiceDesk_AccessProvisioning", pkg: "ServiceDeskAccessProvisioning", folder: 102, desc: "Grants application access from approved requests.", type: "Process",
    versions: [{ v: "1.0.4", daysAgo: 220 }], jobs: { perDay: 5, successRate: 0.95, activeDays: 90, lastRunDaysAgo: 0, faults: ["Target application API returned 500"], durSec: 120, machines: ["PROD-RPA-02"] }, queue: "AccessRequests" },
  { id: 6, name: "Claims_Legacy_Mainframe_Update", pkg: "ClaimsLegacyMainframeUpdate", folder: 103, desc: "Updates claim status in the 3270 mainframe via screen automation.", type: "Process",
    versions: ["5.0.1", "5.0.2", "5.0.3", "5.1.0", "5.1.1", "5.1.2", "5.2.0", "5.2.1", "5.2.2"].map((v, i) => ({ v, daysAgo: 175 - i * 19 })),
    jobs: { perDay: 8, successRate: 0.62, activeDays: 90, lastRunDaysAgo: 0, faults: ["Selector not found: <wnd app='tn3270.exe' title='*CLAIMS*'/>", "Element not found after 30000ms", "UI timeout waiting for screen"], durSec: 780, machines: ["LEGACY-VDI-07"] }, cron: { expr: "0 8-18 * * 1-5", enabled: true } },
  { id: 7, name: "Weekly_Sales_Report", pkg: "WeeklySalesReport", folder: 104, desc: "Builds the weekly sales workbook and emails it to regional managers.", type: "Process",
    versions: [{ v: "1.0.2", daysAgo: 500 }, { v: "1.1.0", daysAgo: 300 }], jobs: { perDay: 1 / 7, successRate: 1, activeDays: 90, lastRunDaysAgo: 0, faults: [], durSec: 240, machines: ["PROD-RPA-01"] }, cron: { expr: "0 7 * * 1", enabled: true } },
  { id: 8, name: "Weekly_Sales_Report_Copy", pkg: "WeeklySalesReport", folder: 104, desc: "Copy of the weekly sales report (old regional variant).", type: "Process",
    versions: [{ v: "1.0.2", daysAgo: 500 }], jobs: { perDay: 0, successRate: 1, activeDays: 0, lastRunDaysAgo: 140, faults: [], durSec: 240 }, cron: { expr: "0 7 * * 1", enabled: false } },
  { id: 9, name: "Customer_Email_Classifier", pkg: "CustomerEmailClassifier", folder: 105, desc: "Routes inbound customer emails by keyword rules into case queues.", type: "Process",
    versions: [{ v: "2.2.0", daysAgo: 120 }, { v: "2.3.0", daysAgo: 55 }], jobs: { perDay: 15, successRate: 0.85, activeDays: 90, lastRunDaysAgo: 0, faults: ["Intent not matched by keyword rules"], durSec: 45, machines: ["PROD-RPA-01"] }, queue: "CustomerEmails" },
];
const QUEUES: Q[] = [
  { id: 11, name: "InvoiceDocs", folder: 101, total: 600, success: 0.74, biz: 0.18, app: 0.05, abandoned: 0.03, retried: 0.1, reasons: ["Invoice layout not recognised", "OCR confidence below threshold", "Supplier not found - needs manual review"] },
  { id: 12, name: "ITTickets", folder: 102, total: 1000, success: 0.64, biz: 0.31, app: 0.03, abandoned: 0.02, retried: 0.14, reasons: ["Category unclear", "Needs manual routing", "Multiple categories detected"] },
  { id: 13, name: "PasswordResets", folder: 102, total: 500, success: 0.98, biz: 0.01, app: 0.01, abandoned: 0, retried: 0.01, reasons: ["Identity check failed"] },
  { id: 14, name: "AccessRequests", folder: 102, total: 420, success: 0.94, biz: 0.04, app: 0.02, abandoned: 0, retried: 0.02, reasons: ["Approval missing"] },
  { id: 15, name: "CustomerEmails", folder: 105, total: 1200, success: 0.7, biz: 0.22, app: 0.05, abandoned: 0.03, retried: 0.08, reasons: ["Intent not matched by keyword rules", "Unstructured attachment", "Mixed-language email"] },
];
const ASSETS: Record<number, Row[]> = {
  101: [{ Id: 1, Name: "DocUnderstanding_ApiEndpoint", ValueType: "Text", ValueScope: "Global", Description: "Doc extraction endpoint", StringValue: "https://docs.internal.example/extract" },
        { Id: 2, Name: "DocUnderstanding_Key", ValueType: "Credential", ValueScope: "Global", CredentialPassword: SECRET_CANARY, CredentialUsername: "svc-docs" },
        { Id: 3, Name: "InvoiceConfidenceThreshold", ValueType: "Integer", ValueScope: "Global", IntValue: 80 }],
  102: [{ Id: 4, Name: "ServiceDesk_ApiToken", ValueType: "Secret", ValueScope: "Global", StringValue: SECRET_CANARY }, { Id: 5, Name: "AD_Admin", ValueType: "Credential", ValueScope: "Global", CredentialPassword: SECRET_CANARY }],
  103: [{ Id: 6, Name: "Mainframe_Login", ValueType: "Credential", ValueScope: "PerRobot", CredentialPassword: SECRET_CANARY }],
  104: [{ Id: 7, Name: "SalesReport_Recipients", ValueType: "Text", ValueScope: "Global", StringValue: "managers@example.com" }],
  105: [{ Id: 8, Name: "Mailbox_Credential", ValueType: "Credential", ValueScope: "Global", CredentialPassword: SECRET_CANARY }],
};

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

export type MockOptions = { token?: string; now?: number; denyPaths?: Record<string, number>; log?: string[] };

export function createMockOrchestrator(opts: MockOptions = {}): typeof fetch {
  const now = opts.now ?? Date.now();
  const token = opts.token ?? DEMO_TOKEN;
  const jobsByProc = new Map<number, Row[]>();
  for (const p of PROCS) {
    const r = rng(p.id * 7919), rows: Row[] = [];
    const j = p.jobs;
    for (let day = j.lastRunDaysAgo; day < j.lastRunDaysAgo + j.activeDays; day++) {
      let n = Math.floor(j.perDay) + (r() < j.perDay % 1 ? 1 : 0);
      if (j.perDay < 1 && r() > j.perDay) n = 0;
      for (let k = 0; k < n; k++) {
        const ok = r() < j.successRate, start = now - day * DAY - Math.floor(r() * 3600_000 * 10), dur = Math.max(5, Math.round(j.durSec * (0.7 + r() * 0.6)));
        const info = !ok ? j.faults[Math.floor(r() * j.faults.length)] : j.infoEscalate && r() < j.infoEscalate ? "Escalated to human reviewer" : "";
        rows.push({ Id: p.id * 100000 + rows.length, Key: `job-${p.id}-${rows.length}`, State: ok ? "Successful" : "Faulted", StartTime: new Date(start).toISOString(), EndTime: new Date(start + dur * 1000).toISOString(), Source: p.cron ? "Schedule" : p.queue ? "QueueTrigger" : "Manual", Info: info, ReleaseName: p.name, HostMachineName: j.machines?.[Math.floor(r() * j.machines.length)] ?? "PROD-RPA-01" });
      }
    }
    jobsByProc.set(p.id, rows);
  }
  const itemsByQueue = new Map<number, Row[]>();
  for (const q of QUEUES) {
    const r = rng(q.id * 104729), rows: Row[] = [];
    for (let i = 0; i < q.total; i++) {
      const x = r(); let status = "Successful", type: string | null = null, reason: string | null = null;
      if (x > q.success) {
        const y = (x - q.success) / (1 - q.success);
        const bizShare = q.biz / (1 - q.success), appShare = q.app / (1 - q.success);
        if (y < bizShare) { status = "Failed"; type = "BusinessException"; reason = q.reasons[Math.floor(r() * q.reasons.length)]; }
        else if (y < bizShare + appShare) { status = "Failed"; type = "ApplicationException"; reason = "System timeout"; }
        else status = "Abandoned";
      }
      rows.push({ Id: q.id * 100000 + i, QueueDefinitionId: q.id, Status: status, ProcessingExceptionType: type, RetryNumber: r() < q.retried ? 1 : 0, ReviewStatus: "None", CreationTime: new Date(now - Math.floor(r() * 89 * DAY)).toISOString(),
        ProcessingException: reason ? { Reason: reason } : null, SpecificContent: { customerName: "SHOULD-NEVER-BE-STORED" } });
    }
    itemsByQueue.set(q.id, rows);
  }

  const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const odata = (rows: Row[], url: URL) => {
    const top = Number(url.searchParams.get("$top") ?? 100), skip = Number(url.searchParams.get("$skip") ?? 0);
    return send(200, { "@odata.count": rows.length, value: rows.slice(skip, skip + top) });
  };

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    opts.log?.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if ((init?.method ?? "GET") !== "GET") return send(405, { message: "read-only mock" });
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (auth !== `Bearer ${token}`) return send(401, { message: "Unauthorized" });
    const path = url.pathname.replace(/^.*\/orchestrator_/, "");
    for (const [frag, code] of Object.entries(opts.denyPaths ?? {})) if (path.includes(frag)) return send(code, { message: "denied" });
    const folderId = Number((init?.headers as Record<string, string> | undefined)?.["X-UIPATH-OrganizationUnitId"] ?? 0);
    const inFolder = (f: number) => !folderId || f === folderId;

    if (path === "/odata/Folders") return odata(FOLDERS, url);
    if (path === "/odata/Machines") return odata(MACHINES, url);
    if (path === "/odata/Releases") return odata(PROCS.filter((p) => inFolder(p.folder)).map((p) => ({ Id: p.id, Key: `rel-${p.id}`, Name: p.name, ProcessKey: p.pkg, ProcessVersion: p.versions.at(-1)!.v, Description: p.desc, ProcessType: p.type, CreationTime: new Date(now - p.versions[0].daysAgo * DAY).toISOString() })), url);
    const pv = path.match(/GetProcessVersions\(processId='([^']+)'\)/);
    if (pv) { const p = PROCS.find((x) => x.pkg === decodeURIComponent(pv[1])); return send(200, { value: (p?.versions ?? []).map((v) => ({ Version: v.v, Published: new Date(now - v.daysAgo * DAY).toISOString() })) }); }
    if (path === "/odata/Jobs") {
      const m = (url.searchParams.get("$filter") ?? "").match(/StartTime ge (\S+)/), since = m ? Date.parse(m[1]) : 0;
      const names = new Set(PROCS.filter((p) => inFolder(p.folder)).map((p) => p.id));
      const rows = [...names].flatMap((id) => jobsByProc.get(id)!).filter((j) => Date.parse(j.StartTime as string) >= since).sort((a, b) => Date.parse(b.StartTime as string) - Date.parse(a.StartTime as string));
      return odata(rows, url);
    }
    if (path === "/odata/QueueDefinitions") return odata(QUEUES.filter((q) => inFolder(q.folder)).map((q) => ({ Id: q.id, Name: q.name, MaxNumberOfRetries: 3 })), url);
    if (path === "/odata/QueueItems") {
      const qid = Number((url.searchParams.get("$filter") ?? "").match(/QueueDefinitionId eq (\d+)/)?.[1]);
      return odata(itemsByQueue.get(qid) ?? [], url);
    }
    if (path === "/odata/ProcessSchedules") return odata(PROCS.filter((p) => p.cron && inFolder(p.folder)).map((p) => ({ Id: p.id, Name: `${p.name}_schedule`, ReleaseName: p.name, StartProcessCron: p.cron!.expr, Enabled: p.cron!.enabled })), url);
    if (path === "/odata/QueueTriggers") return odata(PROCS.filter((p) => p.queue && inFolder(p.folder)).map((p) => ({ Id: 1000 + p.id, Name: `${p.name}_queuetrigger`, ReleaseName: p.name, QueueDefinitionName: p.queue, Enabled: true })), url);
    if (path === "/odata/Assets") return odata(folderId ? (ASSETS[folderId] ?? []) : Object.values(ASSETS).flat(), url); // returns value-bearing rows on purpose
    return send(404, { message: `no mock for ${path}` });
  }) as typeof fetch;
}
