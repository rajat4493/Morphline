import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createEmbeddedDb, type Db } from "@/db/client";
import * as s from "@/db/schema";
import { DEMO_TOKEN, SECRET_CANARY } from "@/demo/mock-orchestrator";
import { createDemoConnector, createConnector, connectorInput } from "@/services/connectors";
import { runImport } from "@/services/import";
import { createPlan } from "@/services/plans";
import { planToHtml, planToMarkdown, AI_DRAFT_NOTICE } from "@/plan/export";
import { resolveTenant, type TenantContext } from "@/lib/tenant";
import { decryptJson } from "@/lib/crypto";

let db: Db, ctx: TenantContext;
const idOf = async (name: string) => (await db.select().from(s.automationProcesses).where(eq(s.automationProcesses.name, name)))[0].id;

beforeAll(async () => {
  db = await createEmbeddedDb(); ctx = await resolveTenant(db);
  await runImport(db, ctx, (await createDemoConnector(db, ctx)).id);
});

describe("migration plans", () => {
  it("is generated from structured evidence and links back to the assessment", async () => {
    const plan = await createPlan(db, ctx, await idOf("ServiceDesk_Ticket_Triage"));
    const c = plan!.content as any;
    expect(c.recommendation).toBe("hybrid");
    expect(c.assessmentId).toBe(plan!.assessmentId);
    expect(c.evidence.some((e: any) => /Category unclear/.test(e.observed))).toBe(true);
    expect(c.candidateIntegrations.map((i: any) => i.name)).toEqual(expect.arrayContaining(["ServiceDesk_PasswordReset", "ServiceDesk_AccessProvisioning"]));
    expect(c.candidateIntegrations[0].basis).toMatch(/contract UNKNOWN/);
    expect(c.unknowns[0]).toMatch(/Logic analysis unavailable/);
    expect(c.identityAndRbac.join(" ")).toMatch(/credential-type asset/);
    for (const k of ["policies", "approvalPoints", "validationCriteria", "backlog", "assumptions"]) expect(c[k].length).toBeGreaterThan(0);
  });
  it("retire and redesign plans differ appropriately", async () => {
    const retire = (await createPlan(db, ctx, await idOf("Weekly_Sales_Report_Copy")))!.content as any;
    expect(retire.backlog.map((b: any) => b.phase).join()).toMatch(/Confirm.*Disable.*Remove/);
    const legacy = (await createPlan(db, ctx, await idOf("Claims_Legacy_Mainframe_Update")))!.content as any;
    expect(legacy.backlog.some((b: any) => /Redesign/.test(b.phase))).toBe(true);
    expect(legacy.candidateIntegrations.some((i: any) => /API or data-layer/.test(i.name))).toBe(true);
  });
  it("labels AI narrative as draft only when a narrator produced it, and exports escape HTML", async () => {
    const id = await idOf("Invoice_Data_Extraction");
    const withAi = await createPlan(db, ctx, id, { name: "stub", draft: async () => "Draft <script>alert(1)</script> summary" });
    expect(withAi!.narrativeIsAiDraft).toBe(true);
    expect(planToMarkdown(withAi!.content as any, withAi!.narrative)).toContain(AI_DRAFT_NOTICE);
    const html = planToHtml(withAi!.content as any, withAi!.narrative);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
    const none = await createPlan(db, ctx, id);
    expect(none!.narrative).toBeNull();
    expect(none!.narrativeIsAiDraft).toBe(false);
    expect(planToMarkdown(none!.content as any, none!.narrative)).not.toContain(AI_DRAFT_NOTICE);
  });
});

describe("secret handling", () => {
  it("no token, canary secret value, or queue payload appears anywhere in the database or exports", async () => {
    const dump: Record<string, unknown> = {};
    for (const [name, table] of Object.entries(s)) if (typeof table === "object" && table && Symbol.for("drizzle:Name") in (table as object)) dump[name] = await db.select().from(table as never);
    const text = JSON.stringify(dump);
    for (const bad of [SECRET_CANARY, DEMO_TOKEN, "SHOULD-NEVER-BE-STORED", "svc-docs", "docs.internal.example"]) expect(text, bad).not.toContain(bad);
    expect(Object.keys(dump).length).toBeGreaterThan(10);
    const plans = await db.select().from(s.migrationPlans);
    for (const p of plans) { const md = planToMarkdown(p.content as any, p.narrative) + planToHtml(p.content as any, p.narrative); expect(md).not.toContain(SECRET_CANARY); }
  });
  it("asset_metadata has no value column", async () => {
    const cols = Object.keys(s.assetMetadata);
    expect(cols.some((c) => /value$/i.test(c) && c !== "valueType" && c !== "valueScope")).toBe(false);
  });
  it("stores connector config encrypted and only the token env var NAME", async () => {
    const input = connectorInput.parse({ name: "Prod", baseUrl: "https://cloud.uipath.com", organization: "acme", tenant: "prod", tokenEnvVar: "UIPATH_ACCESS_TOKEN" });
    const row = await createConnector(db, ctx, input);
    expect(row.encryptedConfig).not.toContain("acme");
    const cfg = decryptJson<Record<string, string>>(row.encryptedConfig);
    expect(cfg.tokenEnvVar).toBe("UIPATH_ACCESS_TOKEN");
    expect(JSON.stringify(cfg)).not.toMatch(/Bearer|eyJ/);
  });
  it("rejects invalid connector input at the boundary", () => {
    expect(connectorInput.safeParse({ name: "x", baseUrl: "ftp://bad", tokenEnvVar: "T" }).success).toBe(false);
    expect(connectorInput.safeParse({ name: "x", baseUrl: "https://a.b", organization: "o", tokenEnvVar: "TOKEN_X" }).success).toBe(false);
    expect(connectorInput.safeParse({ name: "x", baseUrl: "https://a.b", tokenEnvVar: "raw-token-value-eyJabc" }).success).toBe(false);
  });
  it("audit scrubber redacts secret-like keys", async () => {
    const { scrub } = await import("@/lib/audit");
    expect(scrub({ ok: 1, token: "abc", nested: { password: "x", fine: 2 } })).toEqual({ ok: 1, token: "[redacted]", nested: { password: "[redacted]", fine: 2 } });
  });
});
