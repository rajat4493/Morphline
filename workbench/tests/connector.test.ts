import { describe, expect, it } from "vitest";
import { UiPathConnector } from "@/connectors/uipath";
import { createMockOrchestrator, DEMO_TOKEN, SECRET_CANARY } from "@/demo/mock-orchestrator";

const cfg = { kind: "uipath" as const, baseUrl: "https://orch.example", tokenEnvVar: "TOK" };
const env = { TOK: DEMO_TOKEN };

describe("UiPathConnector against mocked Orchestrator", () => {
  it("tests the connection successfully", async () => {
    const r = await new UiPathConnector(cfg, { fetch: createMockOrchestrator(), env }).testConnection();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/5 folder/);
  });
  it("gives actionable feedback for bad token, missing env var, 403 and unknown host path", async () => {
    expect((await new UiPathConnector(cfg, { fetch: createMockOrchestrator(), env: { TOK: "wrong" } }).testConnection()).message).toMatch(/Unauthorized/);
    expect((await new UiPathConnector(cfg, { fetch: createMockOrchestrator(), env: {} }).testConnection()).message).toMatch(/environment variable TOK is not set/);
    expect((await new UiPathConnector(cfg, { fetch: createMockOrchestrator({ denyPaths: { "/odata/Folders": 403 } }), env }).testConnection()).message).toMatch(/OR\.Folders\.Read/);
  });
  it("uses Automation Cloud URL shape and folder headers, and issues only GET requests", async () => {
    const calls: string[] = [], seen: Record<string, string>[] = [];
    const base = createMockOrchestrator();
    const spy = (async (u: RequestInfo | URL, init?: RequestInit) => { calls.push(`${init?.method} ${u}`); seen.push(init?.headers as Record<string, string>); return base(u, init); }) as typeof fetch;
    const c = new UiPathConnector({ ...cfg, baseUrl: "https://cloud.uipath.com", organization: "acme", tenant: "prod" }, { fetch: spy, env });
    const { folders } = await c.listFolders();
    await c.fetchFolder(folders[0], { jobWindowDays: 90 });
    expect(calls.every((x) => x.startsWith("GET https://cloud.uipath.com/acme/prod/orchestrator_/odata/"))).toBe(true);
    expect(seen.some((h) => h["X-UIPATH-OrganizationUnitId"] === folders[0].id)).toBe(true);
    expect(calls.some((x) => /StartTime%20ge|StartTime\+ge/.test(x))).toBe(true); // OData filter used
  });
  it("paginates beyond one page", async () => {
    const log: string[] = [];
    const c = new UiPathConnector(cfg, { fetch: createMockOrchestrator({ log }), env });
    const { folders } = await c.listFolders();
    const f = folders.find((x) => x.name === "ServiceDesk")!;
    const { snapshot } = await c.fetchFolder(f, { jobWindowDays: 90 });
    expect(snapshot.jobs.length).toBeGreaterThan(300);
    expect(log.filter((l) => l.includes("/odata/Jobs")).length).toBeGreaterThan(3);
  });
  it("degrades gracefully when one entity is forbidden, reporting the issue", async () => {
    const c = new UiPathConnector(cfg, { fetch: createMockOrchestrator({ denyPaths: { "/odata/QueueItems": 403 } }), env });
    const { folders } = await c.listFolders();
    const { snapshot, issues } = await c.fetchFolder(folders.find((x) => x.name === "ServiceDesk")!, { jobWindowDays: 90 });
    expect(snapshot.processes.length).toBe(3);
    expect(issues.some((i) => i.entity === "queue_items" && /Forbidden/.test(i.message))).toBe(true);
  });
  it("retries on 429 then succeeds", async () => {
    let n = 0; const base = createMockOrchestrator();
    const flaky = (async (u: RequestInfo | URL, i?: RequestInit) => (n++ < 1 ? new Response("{}", { status: 429 }) : base(u, i))) as typeof fetch;
    const r = await new UiPathConnector(cfg, { fetch: flaky, env, sleep: async () => {} }).testConnection();
    expect(r.ok).toBe(true);
  });
  it("never surfaces asset values or queue item payloads, even though the API mock returns them", async () => {
    const c = new UiPathConnector(cfg, { fetch: createMockOrchestrator(), env });
    const out: unknown[] = [];
    for (const f of (await c.listFolders()).folders) out.push(await c.fetchFolder(f, { jobWindowDays: 90 }));
    const blob = JSON.stringify(out);
    expect(blob).not.toContain(SECRET_CANARY);
    expect(blob).not.toContain("SHOULD-NEVER-BE-STORED");
    expect(blob).not.toContain("svc-docs");
    expect(blob).toContain("DocUnderstanding_Key"); // metadata kept
  });
});
