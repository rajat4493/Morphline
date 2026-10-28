import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { TenantContext } from "@/lib/tenant";

const DAY = 86400_000;

export type InventoryRow = {
  id: string; name: string; folder: string; folderId: string; version: string; status: string; recommendation: string; confidence: number; opportunity: number; risk: number; redesign: boolean;
  jobs: number; failureRate: number; lastRun: Date | null; schedule: string; assessedAt: Date;
};

/** Latest assessment per process joined with operational summary. */
export async function inventory(db: Db, ctx: TenantContext): Promise<InventoryRow[]> {
  const t = ctx.tenantId;
  const procs = await db.select({ p: s.automationProcesses, f: s.folders }).from(s.automationProcesses).innerJoin(s.folders, eq(s.automationProcesses.folderId, s.folders.id)).where(eq(s.automationProcesses.tenantId, t));
  if (procs.length === 0) return [];
  const ids = procs.map((x) => x.p.id);
  const [assess, jobs, trigs] = await Promise.all([
    db.select().from(s.assessments).where(inArray(s.assessments.processId, ids)).orderBy(desc(s.assessments.createdAt)),
    db.select({ processId: s.executionJobs.processId, state: s.executionJobs.state, startedAt: s.executionJobs.startedAt }).from(s.executionJobs).where(inArray(s.executionJobs.processId, ids)),
    db.select().from(s.triggers).where(inArray(s.triggers.processId, ids)),
  ]);
  const latest = new Map<string, typeof s.assessments.$inferSelect>();
  for (const a of assess) if (!latest.has(a.processId)) latest.set(a.processId, a);
  return procs.flatMap(({ p, f }) => {
    const a = latest.get(p.id);
    if (!a) return [];
    const j = jobs.filter((x) => x.processId === p.id);
    const last = j.reduce<Date | null>((m, x) => (x.startedAt && (!m || x.startedAt > m) ? x.startedAt : m), null);
    const tr = trigs.filter((x) => x.processId === p.id);
    const schedule = tr.length ? tr.map((x) => `${x.kind === "time" ? x.cron : `queue:${x.queueName}`}${x.enabled ? "" : " (disabled)"}`).join(", ") : "none";
    return [{ id: p.id, name: p.name, folder: f.path, folderId: f.id, version: p.currentVersion, status: p.status, recommendation: a.recommendation, confidence: a.confidence, opportunity: a.opportunityScore, risk: a.riskScore, redesign: a.redesignReview, jobs: j.length, failureRate: j.length ? j.filter((x) => x.state === "Faulted").length / j.length : 0, lastRun: last, schedule, assessedAt: a.createdAt }];
  });
}

export async function recentImports(db: Db, ctx: TenantContext, limit = 5) {
  return db.select({ run: s.importRuns, connector: s.connectors.name }).from(s.importRuns).innerJoin(s.connectors, eq(s.importRuns.connectorId, s.connectors.id)).where(eq(s.importRuns.tenantId, ctx.tenantId)).orderBy(desc(s.importRuns.startedAt)).limit(limit);
}

export async function processDetail(db: Db, ctx: TenantContext, id: string) {
  const [row] = await db.select({ p: s.automationProcesses, f: s.folders }).from(s.automationProcesses).innerJoin(s.folders, eq(s.automationProcesses.folderId, s.folders.id)).where(and(eq(s.automationProcesses.id, id), eq(s.automationProcesses.tenantId, ctx.tenantId))).limit(1);
  if (!row) return null;
  const [assessment] = await db.select().from(s.assessments).where(eq(s.assessments.processId, id)).orderBy(desc(s.assessments.createdAt)).limit(1);
  const [evidence, versions, jobs, trigs, deps, plans, assets] = await Promise.all([
    assessment ? db.select().from(s.assessmentEvidence).where(eq(s.assessmentEvidence.assessmentId, assessment.id)) : Promise.resolve([]),
    db.select().from(s.processVersions).where(eq(s.processVersions.processId, id)).orderBy(desc(s.processVersions.publishedAt)),
    db.select({ state: s.executionJobs.state, startedAt: s.executionJobs.startedAt, info: s.executionJobs.infoMessage, dur: s.executionJobs.durationSec }).from(s.executionJobs).where(eq(s.executionJobs.processId, id)),
    db.select().from(s.triggers).where(eq(s.triggers.processId, id)),
    db.select().from(s.dependencies).where(eq(s.dependencies.processId, id)),
    db.select().from(s.migrationPlans).where(eq(s.migrationPlans.processId, id)).orderBy(desc(s.migrationPlans.createdAt)),
    db.select().from(s.assetMetadata).where(eq(s.assetMetadata.folderId, row.p.folderId)),
  ]);
  const queueNames = trigs.map((t) => t.queueName).filter((q): q is string => !!q);
  const queues = queueNames.length ? await db.select({ q: s.queues, sig: s.queueSignals }).from(s.queues).leftJoin(s.queueSignals, eq(s.queueSignals.queueId, s.queues.id)).where(and(eq(s.queues.folderId, row.p.folderId), inArray(s.queues.name, queueNames))) : [];
  const [conn] = await db.select().from(s.connectors).where(eq(s.connectors.id, row.p.connectorId));
  const analyses = await db.select().from(s.packageAnalyses).where(eq(s.packageAnalyses.processId, id)).orderBy(desc(s.packageAnalyses.createdAt));
  const deployedAnalysis = analyses.find((a) => a.isDeployed) ?? null;
  const [diffRow] = deployedAnalysis ? await db.select().from(s.packageDiffs).where(eq(s.packageDiffs.toAnalysisId, deployedAnalysis.id)).orderBy(desc(s.packageDiffs.createdAt)).limit(1) : [];
  const [blob] = deployedAnalysis ? await db.select({ id: s.packageBlobs.id, sizeBytes: s.packageBlobs.sizeBytes }).from(s.packageBlobs).where(eq(s.packageBlobs.analysisId, deployedAnalysis.id)) : [];
  // weekly buckets of runs / failures for the trend
  const weeks = new Map<number, { total: number; failed: number }>();
  const now = Date.now();
  for (const j of jobs) { if (!j.startedAt) continue; const w = Math.floor((now - j.startedAt.getTime()) / (7 * DAY)); const b = weeks.get(w) ?? { total: 0, failed: 0 }; b.total++; if (j.state === "Faulted") b.failed++; weeks.set(w, b); }
  const trend = [...weeks].sort((a, b) => b[0] - a[0]).map(([w, v]) => ({ weeksAgo: w, ...v }));
  return { ...row, assessment: assessment ?? null, evidence, versions, trend, jobCount: jobs.length, packageAnalysis: deployedAnalysis, packageHistory: analyses.map((a) => ({ id: a.id, version: a.version, isDeployed: a.isDeployed, status: a.sourceStatus, failure: a.failure, createdAt: a.createdAt })), packageDiff: (diffRow?.summary ?? null) as import("@/analysis/types").PackageDiff | null, retainedPackage: blob ?? null, packageSettings: { enabled: conn?.packageAnalysisEnabled ?? false, permissionConfirmed: conn?.packagePermissionConfirmed ?? false, retainRaw: conn?.packageRetainRaw ?? false }, recentFailures: jobs.filter((j) => j.state === "Faulted").sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0)).slice(0, 8), triggers: trigs, dependencies: deps, queues, plans, assets };
}

export async function connectorList(db: Db, ctx: TenantContext) {
  return db.select({ id: s.connectors.id, name: s.connectors.name, isDemo: s.connectors.isDemo, lastTestAt: s.connectors.lastTestAt, lastTestOk: s.connectors.lastTestOk, lastTestMessage: s.connectors.lastTestMessage, selected: s.connectors.selectedFolderIds, packageAnalysisEnabled: s.connectors.packageAnalysisEnabled, packagePermissionConfirmed: s.connectors.packagePermissionConfirmed, packageRetainRaw: s.connectors.packageRetainRaw }).from(s.connectors).where(eq(s.connectors.tenantId, ctx.tenantId));
}

export async function connectorFolders(db: Db, connectorId: string) {
  return db.select({ id: s.folders.id, sourceId: s.folders.sourceId, path: s.folders.path }).from(s.folders).where(eq(s.folders.connectorId, connectorId));
}

export async function auditTrailFor(db: Db, ctx: TenantContext, entityIds: string[], limit = 20) {
  if (!entityIds.length) return [];
  return db.select().from(s.auditEvents).where(and(eq(s.auditEvents.tenantId, ctx.tenantId), inArray(s.auditEvents.entityId, entityIds))).orderBy(desc(s.auditEvents.at)).limit(limit);
}
export { sql };

/** Estate-level package-analysis coverage for the overview. "trusted" mirrors the assessment gate (source, version match, identity, >=80% parsed). */
export async function packageCoverageSummary(db: Db, ctx: TenantContext) {
  const procs = await db.select({ id: s.automationProcesses.id, version: s.automationProcesses.currentVersion }).from(s.automationProcesses).where(eq(s.automationProcesses.tenantId, ctx.tenantId));
  if (!procs.length) return { total: 0, attempted: 0, trusted: 0, byStatus: {} as Record<string, number> };
  const rows = await db.select().from(s.packageAnalyses).where(inArray(s.packageAnalyses.processId, procs.map((p) => p.id)));
  const byStatus: Record<string, number> = {}; let trusted = 0, attempted = 0;
  for (const p of procs) {
    const a = rows.filter((r) => r.processId === p.id && r.isDeployed).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
    if (!a) continue; attempted++; const k = a.failure ?? a.sourceStatus; byStatus[k] = (byStatus[k] ?? 0) + 1;
    if (a.sourceStatus === "source_available" && a.version === p.version && a.identityMatches !== false && a.coverage >= 0.8) trusted++;
  }
  return { total: procs.length, attempted, trusted, byStatus };
}
