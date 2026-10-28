import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { UiPathConnector } from "@/connectors/uipath";
import { createEmbeddedDb, type Db } from "@/db/client";
import * as s from "@/db/schema";
import { createMockOrchestrator, DEMO_TOKEN } from "@/demo/mock-orchestrator";
import { writeZip } from "@/demo/zip-writer";
import { decryptBytes } from "@/lib/crypto";
import { resolveTenant, type TenantContext } from "@/lib/tenant";
import { createDemoConnector } from "@/services/connectors";
import { runImport } from "@/services/import";
import { updatePackageSettings } from "@/services/package-analysis";
import { analyzeAndReassess } from "@/services/reassess";

type Env = { db: Db; ctx: TenantContext; id: string; log: string[]; result: Awaited<ReturnType<typeof runImport>> };
const noAi = { classifier: null };
async function setup(opts: { enabled?: boolean; confirmed?: boolean; retain?: boolean; mock?: Parameters<typeof createMockOrchestrator>[0]; import?: boolean } = {}): Promise<Env> {
  const db = await createEmbeddedDb(), ctx = await resolveTenant(db), c = await createDemoConnector(db, ctx), log: string[] = [];
  if (opts.enabled !== undefined) await updatePackageSettings(db, ctx, c.id, { enabled: opts.enabled, permissionConfirmed: opts.confirmed ?? true, retainRaw: opts.retain ?? false });
  const result = await runImport(db, ctx, c.id, { fetch: createMockOrchestrator({ log, ...opts.mock }), ai: noAi });
  return { db, ctx, id: c.id, log, result };
}
const downloads = (e: Env) => e.log.filter((l) => l.includes("DownloadPackage"));
const byName = async (db: Db) => { const rows = await db.select().from(s.assessments).innerJoin(s.automationProcesses, eq(s.assessments.processId, s.automationProcesses.id)); return Object.fromEntries(rows.map((r) => [r.automation_processes.name, r.assessments])); };

let off: Env, on: Env, A: Awaited<ReturnType<typeof byName>>, B: Awaited<ReturnType<typeof byName>>;
beforeAll(async () => { off = await setup(); on = await setup({ enabled: true }); A = await byName(off.db); B = await byName(on.db); });

describe("opt-in and read-only", () => {
  it("downloads nothing unless package analysis is enabled", () => { expect(downloads(off)).toHaveLength(0); });
  it("enabling without confirming Packages.View does not enable it", async () => {
    const e = await setup({ enabled: true, confirmed: false });
    expect(downloads(e)).toHaveLength(0);
    expect((await e.db.select().from(s.connectors))[0]).toMatchObject({ packageAnalysisEnabled: false, packagePermissionConfirmed: false });
    expect((await e.db.select().from(s.packageAnalyses)).length).toBe(0);
  });
  it("downloads only the deployed (and one previous) version of each process, GET only", () => {
    expect(downloads(on)).toHaveLength(14); // 9 deployed + 5 previous versions for diffing
    expect(on.log.every((l) => l.startsWith("GET "))).toBe(true);
    expect(downloads(on).every((l) => /DownloadPackage\(key='[A-Za-z]+%3A[0-9.]+'\)/.test(l))).toBe(true);
  });
  it("does not re-download on the next import (analyses are cached per exact version)", async () => {
    const before = downloads(on).length;
    await runImport(on.db, on.ctx, on.id, { fetch: createMockOrchestrator({ log: on.log }), ai: noAi });
    expect(downloads(on).length - before).toBe(0); // every outcome, including 'not found', is cached for that exact version
  }, 60000);
});

describe("source detection per demo package", () => {
  it("reports source_available, compiled_only, unreadable and missing explicitly", async () => {
    const rows = await on.db.select().from(s.packageAnalyses).innerJoin(s.automationProcesses, eq(s.packageAnalyses.processId, s.automationProcesses.id));
    const st = (n: string, v?: string) => rows.filter((r) => r.automation_processes.name === n && (!v || r.package_analyses.version === v)).map((r) => [r.package_analyses.sourceStatus, r.package_analyses.failure]);
    expect(st("Invoice_Data_Extraction", "1.5.2")).toEqual([["source_available", null]]);
    expect(st("Customer_Email_Classifier")).toEqual([["compiled_only", null]]);
    expect(st("ServiceDesk_AccessProvisioning")).toEqual([["unreadable", null]]);
    expect(st("Weekly_Sales_Report_Copy")).toEqual([["missing", "not_found"]]);
  });
  it("records the sandbox layers that were in effect", async () => {
    const [a] = await on.db.select().from(s.packageAnalyses).where(eq(s.packageAnalyses.sourceStatus, "source_available")).limit(1);
    expect(a.isolation).toMatchObject({ separateProcess: true, emptyEnvironment: true, codeGenerationFromStringsDisabled: true });
  });
});

describe("only derived structural facts are persisted", () => {
  it("no raw selector, literal, display name, URL path or package byte appears anywhere in the database", async () => {
    const dump: Record<string, unknown> = {};
    for (const [name, table] of Object.entries(s)) if (typeof table === "object" && table && Symbol.for("drizzle:Name") in (table as object)) dump[name] = await on.db.select().from(table as never);
    const text = JSON.stringify(dump);
    // (Orchestrator job error text is telemetry and may contain selector fragments; these tokens occur only inside package XAML)
    for (const leak of ["&lt;wnd", "ctrl idx=", "C:\\\\Reports", "sales.xlsx", "managers@corp.example", "ap-team@corp.example", "servicedesk-leads@corp.example", "/v2/extract", "https://api.invoice-ocr.example", "https://portal.supplier.example", "supplier.example/login", "Notify AP", "Get portal login", "invoicesTab", "Call extraction API", "PK\u0003\u0004"]) expect(text, leak).not.toContain(leak);
    expect(text).toContain("tn3270.exe"); expect(text).toContain("api.invoice-ocr.example"); expect(text).toContain("portal.supplier.example"); // derived structural facts are kept: app targets and bare host names (never paths or queries)
    expect(Object.keys(dump).length).toBeGreaterThan(15);
  });
  it("stores no raw package unless retention is switched on", async () => { expect((await on.db.select().from(s.packageBlobs)).length).toBe(0); });
});

describe("optional encrypted raw-package retention", () => {
  it("is a separate setting: stores ciphertext that round-trips, and is purged when switched off", async () => {
    const e = await setup({ enabled: true, retain: true });
    const blobs = await e.db.select().from(s.packageBlobs);
    expect(blobs.length).toBeGreaterThan(8);
    for (const b of blobs) { expect(b.encrypted.startsWith("v1b.")).toBe(true); expect(b.encrypted).not.toContain("Main.xaml"); }
    const [b] = blobs, [a] = await e.db.select().from(s.packageAnalyses).where(eq(s.packageAnalyses.id, b.analysisId));
    const raw = decryptBytes(b.encrypted); expect(createHash("sha256").update(raw).digest("hex")).toBe(a.packageSha256); expect(raw.subarray(0, 2).toString()).toBe("PK");
    const c = (await e.db.select().from(s.connectors))[0];
    await updatePackageSettings(e.db, e.ctx, c.id, { enabled: true, permissionConfirmed: true, retainRaw: false });
    expect((await e.db.select().from(s.packageBlobs)).length).toBe(0);
    expect((await e.db.select().from(s.auditEvents)).some((x) => x.action === "package_analysis.settings_changed" && (x.detail as any).retainedPackagesPurged > 0)).toBe(true);
  }, 60000);
});

describe("permission failures", () => {
  it("stops at the first Packages.View denial, records it per process, and still assesses everything", async () => {
    const e = await setup({ enabled: true, mock: { denyPaths: { DownloadPackage: 403 } } });
    expect(downloads(e)).toHaveLength(1);
    expect(e.result.status).toBe("partial"); expect(e.result.errors.some((x) => x.entity === "package_download" && /Packages\.View/.test(x.message))).toBe(true);
    const rows = await e.db.select().from(s.packageAnalyses);
    expect(rows.length).toBe(9); expect(rows.every((r) => r.failure === "download_denied" && r.sourceStatus === "missing")).toBe(true);
    const a = await byName(e.db);
    expect(Object.keys(a)).toHaveLength(9); expect(a.ServiceDesk_Ticket_Triage.missingInformation[0]).toMatch(/Packages\.View/); expect(a.ServiceDesk_Ticket_Triage.logicAnalysis).toBe("unavailable");
  }, 60000);
  it("the connector maps 403/404/oversize to explicit outcomes and never writes", async () => {
    const calls: { method?: string; url: string; headers: Record<string, string> }[] = [];
    const spy = (inner: typeof fetch) => (async (u: any, i: any) => { calls.push({ method: i?.method, url: String(u), headers: i?.headers }); return inner(u, i); }) as typeof fetch;
    const mk = (m: Parameters<typeof createMockOrchestrator>[0]) => new UiPathConnector({ kind: "uipath", baseUrl: "https://orch.example", tokenEnvVar: "T" }, { fetch: spy(createMockOrchestrator(m)), env: { T: DEMO_TOKEN } });
    expect(await mk({ denyPaths: { DownloadPackage: 403 } }).downloadPackage!({ packageId: "P", version: "1", maxBytes: 1e6 })).toMatchObject({ ok: false, code: "denied", message: expect.stringMatching(/Packages\.View/) });
    expect(await mk({}).downloadPackage!({ packageId: "Nope", version: "1", maxBytes: 1e6 })).toMatchObject({ ok: false, code: "not_found" });
    expect(await mk({}).downloadPackage!({ packageId: "InvoicePortalDownload", version: "2.3.1", maxBytes: 100 })).toMatchObject({ ok: false, code: "too_large" });
    const stream = new UiPathConnector({ kind: "uipath", baseUrl: "https://o.example", tokenEnvVar: "T" }, { fetch: (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(600)); c.enqueue(new Uint8Array(600)); c.close(); } }), { status: 200 })) as typeof fetch, env: { T: "x" } });
    expect(await stream.downloadPackage!({ packageId: "P", version: "1", maxBytes: 1000 })).toMatchObject({ ok: false, code: "too_large" });
    expect(calls.every((c) => c.method === "GET" && /Processes\/UiPath\.Server\.Configuration\.OData\.DownloadPackage\(key='/.test(c.url))).toBe(true);
  });
});

describe("identity and version checks", () => {
  it("ignores a package whose nuspec does not match the deployed version/identity", async () => {
    const wrong = writeZip([{ name: "InvoicePortalDownload.nuspec", data: "<package><metadata><id>InvoicePortalDownload</id><version>9.9.9</version></metadata></package>" }, { name: "content/project.json", data: "{}" }, { name: "content/Main.xaml", data: `<Activity xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities"><Sequence DisplayName="s"><Delay DisplayName="d" /></Sequence></Activity>` }]);
    const e = await setup({ enabled: true, mock: { packages: { "InvoicePortalDownload:2.3.1": wrong } } });
    const rows = await e.db.select().from(s.packageAnalyses).innerJoin(s.automationProcesses, eq(s.packageAnalyses.processId, s.automationProcesses.id)).where(eq(s.automationProcesses.name, "Invoice_Portal_Download"));
    expect(rows.find((r) => r.package_analyses.version === "2.3.1")!.package_analyses.identityMatches).toBe(false);
    expect(rows.find((r) => r.package_analyses.version === "2.0.0")!.package_analyses.identityMatches).toBe(true);
    const r = (await byName(e.db)).Invoice_Portal_Download;
    expect(r.logicAnalysis).toBe("unavailable"); expect(r.missingInformation[0]).toMatch(/does not match/);
  }, 60000);
});

describe("package coverage drives eligibility and confidence", () => {
  it("without package analysis every process keeps its pre-feature scores (only governed agentic is gated)", () => {
    const expected: Record<string, [string, number, number, number]> = { Invoice_Portal_Download: ["deterministic", 85, 8, 10], Invoice_Data_Extraction: ["ai_augmented", 73, 60, 10], ServiceDesk_Ticket_Triage: ["hybrid", 69, 98, 10], ServiceDesk_PasswordReset: ["deterministic", 82, 16, 10], ServiceDesk_AccessProvisioning: ["deterministic", 82, 17, 10], Claims_Legacy_Mainframe_Update: ["deterministic", 40, 15, 85], Weekly_Sales_Report: ["deterministic", 72, 0, 5], Weekly_Sales_Report_Copy: ["retire", 72, 0, 5], Customer_Email_Classifier: ["ai_augmented", 73, 74, 10] };
    for (const [n, [rec, c, o, r]] of Object.entries(expected)) expect([A[n].recommendation, A[n].confidence, A[n].opportunityScore, A[n].riskScore], n).toEqual([rec, c, o, r]);
    for (const a of Object.values(A)) { expect(a.eligibility.governed_agentic.eligible).toBe(false); expect(a.logicAnalysis).toBe("unavailable"); }
  });
  it("governed agentic becomes eligible, and runner-up, only with a trusted package analysis", () => {
    expect(A.ServiceDesk_Ticket_Triage.runnerUp).toBe("deterministic"); expect(B.ServiceDesk_Ticket_Triage.runnerUp).toBe("governed_agentic");
    expect(B.ServiceDesk_Ticket_Triage.eligibility.governed_agentic.eligible).toBe(true);
    for (const n of ["ServiceDesk_AccessProvisioning", "Customer_Email_Classifier", "Weekly_Sales_Report_Copy"]) { expect(B[n].eligibility.governed_agentic.eligible, n).toBe(false); expect(B[n].eligibility.governed_agentic.reasons[0], n).toMatch(/Package analysis found no readable source/); }
  });
  it("a usable analysis raises confidence (cap 90); an attempted-but-unusable one lowers it by 5", () => {
    expect(B.Invoice_Portal_Download.confidence).toBe(90); expect(A.Invoice_Portal_Download.confidence).toBe(85);
    expect(B.ServiceDesk_PasswordReset.confidence).toBe(90);
    for (const n of ["ServiceDesk_AccessProvisioning", "Customer_Email_Classifier", "Weekly_Sales_Report_Copy"]) expect(B[n].confidence, n).toBe(A[n].confidence - 5);
    for (const n of Object.keys(A)) expect(B[n].recommendation, n).toBe(A[n].recommendation); // coverage never changes WHICH option wins in the demo
  });
  it("states the logic-analysis level and why", () => {
    expect(B.Invoice_Data_Extraction.logicAnalysis).toBe("available"); expect(B.Invoice_Data_Extraction.missingInformation[0]).toMatch(/Package analysed \(v1\.5\.2\): 3 workflow file\(s\), 100%/);
    expect(B.Customer_Email_Classifier.missingInformation[0]).toMatch(/compiled assemblies/); expect(B.ServiceDesk_AccessProvisioning.missingInformation[0]).toMatch(/could not be read/); expect(B.Weekly_Sales_Report_Copy.missingInformation[0]).toMatch(/not found on the feed/);
    expect(B.ServiceDesk_Ticket_Triage.packageAnalysisId).not.toBeNull(); expect(A.ServiceDesk_Ticket_Triage.packageAnalysisId).toBeNull();
  });
});

describe("version diffing as volatility evidence", () => {
  it("diffs the deployed version against the previous one and surfaces it as evidence", async () => {
    const rows = await on.db.select().from(s.packageDiffs).innerJoin(s.automationProcesses, eq(s.packageDiffs.processId, s.automationProcesses.id));
    const d = (n: string) => rows.find((r) => r.automation_processes.name === n)!.package_diffs.summary as any;
    expect(rows.length).toBe(4);
    expect(d("Invoice_Data_Extraction")).toMatchObject({ comparable: true, fromVersion: "1.4.0", toVersion: "1.5.2", workflowsAdded: ["Extract.xaml"], workflowsChanged: ["Process.xaml"], invokesAdded: 1 });
    expect(d("Invoice_Portal_Download").workflowsChanged).toEqual(["Download.xaml"]);
    expect(d("Claims_Legacy_Mainframe_Update")).toMatchObject({ selectorChurn: 1, dependencyChanges: { changed: [{ id: "UiPath.UIAutomation.Activities", from: "[22.10.4]", to: "[23.10.12]" }] } });
    expect(d("ServiceDesk_Ticket_Triage")).toMatchObject({ changeRatio: 0, workflowsChanged: [] });
    expect(B.Claims_Legacy_Mainframe_Update.riskFlags.join()).toMatch(/PACKAGE_VOLATILITY/);
    expect(B.Invoice_Data_Extraction.riskFlags.join()).not.toMatch(/PACKAGE_VOLATILITY/); // 3 workflows: ratios are not trusted on tiny packages
    expect(B.Weekly_Sales_Report.riskFlags.join()).not.toMatch(/PACKAGE_VOLATILITY/); // previous version missing: no diff, no claim
  });
  it("structural package risks are evidence-backed and marked deterministic", async () => {
    const ev = await on.db.select().from(s.assessmentEvidence).where(eq(s.assessmentEvidence.assessmentId, B.Claims_Legacy_Mainframe_Update.id));
    const ids = ev.map((e) => e.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["R17-package-volatility", "R18-fragile-selectors", "R19-no-error-handling", "R21-swallowed-errors"]));
    expect(ev.find((e) => e.ruleId === "R18-fragile-selectors")!.observed).toMatch(/24 of 24 selectors/); expect(ev.every((e) => e.provenance === "deterministic")).toBe(true);
    expect(B.Weekly_Sales_Report.riskFlags.join()).toMatch(/HARDCODED_LITERALS/); expect(JSON.stringify(ev)).not.toContain("sales.xlsx");
  });
});

describe("dependency basis: confirmed package vs Orchestrator vs folder-scoped vs inferred", () => {
  const deps = async (e: Env, name: string) => (await e.db.select().from(s.dependencies).innerJoin(s.automationProcesses, eq(s.dependencies.processId, s.automationProcesses.id)).where(eq(s.automationProcesses.name, name))).map((r) => `${r.dependencies.basis}|${r.dependencies.kind}|${r.dependencies.name}`);
  it("keeps the four bases apart", async () => {
    const t = await deps(on, "ServiceDesk_Ticket_Triage");
    expect(t).toEqual(expect.arrayContaining(["confirmed_orchestrator|queue|ITTickets", "confirmed_package|queue|PasswordResets", "confirmed_package|queue|AccessRequests", "confirmed_package|process|ServiceDesk_PasswordReset", "inferred|process|ServiceDesk_AccessProvisioning", "inferred|process|ServiceDesk_PasswordReset", "folder_scoped|asset|AD_Admin"]));
    const x = await deps(on, "Invoice_Data_Extraction");
    expect(x).toEqual(expect.arrayContaining(["confirmed_package|asset|DocUnderstanding_ApiEndpoint", "folder_scoped|asset|DocUnderstanding_Key", "folder_scoped|asset|InvoiceConfidenceThreshold", "inferred|config|CredentialAsset", "inferred|config|OrchestratorQueueName", "confirmed_orchestrator|queue|InvoiceDocs", "confirmed_package|package|UiPath.PDF.Activities"]));
    expect(x).not.toContain("confirmed_package|asset|DocUnderstanding_Key"); // read through Config at runtime: never promoted to confirmed
  });
  it("without package analysis nothing is package-confirmed or inferred", async () => {
    const all = (await off.db.select().from(s.dependencies)).map((d) => d.basis);
    expect(new Set(all)).toEqual(new Set(["confirmed_orchestrator", "folder_scoped"]));
  });
  it("is rebuilt, not appended, on every import", async () => {
    const before = (await on.db.select().from(s.dependencies)).length;
    await runImport(on.db, on.ctx, on.id, { fetch: createMockOrchestrator(), ai: noAi });
    expect((await on.db.select().from(s.dependencies)).length).toBe(before);
    expect((await off.db.select().from(s.dependencies)).filter((d) => d.origin === "queue_trigger").length).toBe(5);
  }, 60000);
});

describe("on-demand analysis", () => {
  it("is refused when the connector has not opted in", async () => {
    const [p] = await off.db.select().from(s.automationProcesses).limit(1);
    expect(await analyzeAndReassess(off.db, off.ctx, p.id)).toMatchObject({ ok: false, code: "disabled" });
  });
  it("analyses one process and stores a fresh assessment that reflects the coverage", async () => {
    const e = await setup({ enabled: true, mock: undefined }); // enabled, already imported
    const [p] = await e.db.select().from(s.automationProcesses).where(eq(s.automationProcesses.name, "Invoice_Portal_Download"));
    const before = (await e.db.select().from(s.assessments).where(eq(s.assessments.processId, p.id))).length;
    const r = await analyzeAndReassess(e.db, e.ctx, p.id, { ai: noAi });
    expect(r.ok).toBe(true);
    expect((await e.db.select().from(s.assessments).where(eq(s.assessments.processId, p.id))).length).toBe(before + 1);
  }, 60000);
});
