import { beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { createEmbeddedDb, type Db } from "@/db/client";
import * as s from "@/db/schema";
import { createDemoConnector } from "@/services/connectors";
import { runImport } from "@/services/import";
import { resolveTenant, type TenantContext } from "@/lib/tenant";

let db: Db, ctx: TenantContext, summary: Awaited<ReturnType<typeof runImport>>;
beforeAll(async () => {
  db = await createEmbeddedDb(); ctx = await resolveTenant(db);
  const c = await createDemoConnector(db, ctx);
  summary = await runImport(db, ctx, c.id);
});

describe("demo import through the real connector", () => {
  it("imports the estate cleanly", () => {
    expect(summary.errors).toEqual([]);
    expect(summary.status).toBe("success");
    expect(summary.counts.folders).toBe(5);
    expect(summary.counts.processes).toBe(9);
    expect(summary.counts.assessments).toBe(9);
    expect(summary.counts.jobs).toBeGreaterThan(1000);
  });
  it("gives every process an explainable assessment with rule version and evidence", async () => {
    const rows = await db.select().from(s.assessments);
    expect(rows).toHaveLength(9);
    for (const a of rows) {
      expect(a.ruleVersion).toMatch(/^rules-/);
      expect(a.logicAnalysis).toBe("unavailable");
      const ev = await db.select().from(s.assessmentEvidence).where(eq(s.assessmentEvidence.assessmentId, a.id));
      expect(ev.length).toBeGreaterThan(0);
      expect(a.missingInformation.length).toBeGreaterThan(0);
    }
  });
  it("maps the five seeded scenarios to the intended recommendations", async () => {
    const rows = await db.select({ name: s.automationProcesses.name, rec: s.assessments.recommendation, redesign: s.assessments.redesignReview, runnerUp: s.assessments.runnerUp }).from(s.assessments).innerJoin(s.automationProcesses, eq(s.assessments.processId, s.automationProcesses.id));
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.Invoice_Portal_Download.rec).toBe("deterministic");
    expect(by.Invoice_Data_Extraction.rec).toBe("ai_augmented");
    expect(by.ServiceDesk_Ticket_Triage.rec).toBe("hybrid");
    expect(by.ServiceDesk_Ticket_Triage.runnerUp).toBe("governed_agentic");
    expect(by.Claims_Legacy_Mainframe_Update.redesign).toBe(true);
    expect(by.Weekly_Sales_Report_Copy.rec).toBe("retire");
    expect(by.Weekly_Sales_Report.rec).toBe("deterministic");
  });
  it("writes audit events for the import and every assessment", async () => {
    const ev = await db.select().from(s.auditEvents).orderBy(desc(s.auditEvents.at));
    expect(ev.filter((e) => e.action === "assessment.created")).toHaveLength(9);
    expect(ev.some((e) => e.action === "import.finished")).toBe(true);
  });
});

describe("re-import", () => {
  it("is idempotent for entities and keeps the latest assessment per process consistent", async () => {
    const before = { procs: (await db.select().from(s.automationProcesses)).length, queues: (await db.select().from(s.queues)).length, trig: (await db.select().from(s.triggers)).length, assets: (await db.select().from(s.assetMetadata)).length };
    const c = await createDemoConnector(db, ctx);
    const again = await runImport(db, ctx, c.id);
    expect(again.status).toBe("success");
    expect({ procs: (await db.select().from(s.automationProcesses)).length, queues: (await db.select().from(s.queues)).length, trig: (await db.select().from(s.triggers)).length, assets: (await db.select().from(s.assetMetadata)).length }).toEqual(before);
    const { inventory } = await import("@/services/queries");
    const inv = await inventory(db, ctx);
    expect(inv).toHaveLength(9);
    expect(inv.find((r) => r.name === "ServiceDesk_Ticket_Triage")!.recommendation).toBe("hybrid"); // queue signals still resolve after re-import
    expect((await db.select().from(s.assessments)).length).toBe(18); // history is kept, not overwritten
  });
});
