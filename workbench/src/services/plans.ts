import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import { generatePlan, type PlanContent } from "@/plan/generate";
import { nullNarrator, type Narrator } from "@/plan/narrator";
import { buildAllFacts } from "./facts";
import type { Recommendation } from "@/assessment/types";

export async function createPlan(db: Db, ctx: TenantContext, processId: string, narrator: Narrator = nullNarrator) {
  const [proc] = await db.select().from(s.automationProcesses).where(and(eq(s.automationProcesses.id, processId), eq(s.automationProcesses.tenantId, ctx.tenantId))).limit(1);
  if (!proc) return null;
  const [a] = await db.select().from(s.assessments).where(eq(s.assessments.processId, processId)).orderBy(desc(s.assessments.createdAt)).limit(1);
  if (!a) throw new Error("Process has no assessment yet; run an import first");
  const evidence = await db.select().from(s.assessmentEvidence).where(eq(s.assessmentEvidence.assessmentId, a.id));
  const facts = (await buildAllFacts(db, ctx, proc.connectorId)).find((f) => f.processId === processId)!;
  const content = generatePlan(facts, { assessmentId: a.id, ruleVersion: a.ruleVersion, recommendation: a.recommendation as Recommendation, runnerUp: a.runnerUp, confidence: a.confidence, redesignReview: a.redesignReview, riskFlags: a.riskFlags, missingInformation: a.missingInformation, logicAnalysis: a.logicAnalysis as "unavailable" | "partial" | "available", evidence });
  let narrative: string | null = null;
  try { narrative = await narrator.draft(content); } catch { narrative = null; }
  const [row] = await db.insert(s.migrationPlans).values({ tenantId: ctx.tenantId, processId, assessmentId: a.id, content: content as object, narrative, narrativeIsAiDraft: narrative !== null }).returning();
  await audit(db, ctx, "plan.generated", "migration_plan", row.id, { processId, assessmentId: a.id, ruleVersion: a.ruleVersion, narrator: narrative ? narrator.name : "none" });
  return row;
}

export async function getPlan(db: Db, ctx: TenantContext, planId: string) {
  const [row] = await db.select().from(s.migrationPlans).where(and(eq(s.migrationPlans.id, planId), eq(s.migrationPlans.tenantId, ctx.tenantId))).limit(1);
  return row ? { ...row, content: row.content as PlanContent } : null;
}
