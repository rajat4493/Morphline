import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { assetMetadata, automationProcesses, executionJobs, folders, processVersions, queueSignals, queues, triggers } from "@/db/schema";
import type { ProcessFacts } from "@/assessment/types";
import type { TenantContext } from "@/lib/tenant";

const DAY = 86400_000;
const UI_FAULT = /(selector|element not found|ui timeout|screen)/i;
const ESCALATION = /(escalat|human|manual review)/i;
const CREDENTIAL_TYPES = new Set(["credential", "secret", "windowscredential"]);

type Bundle = Awaited<ReturnType<typeof loadBundle>>;

async function loadBundle(db: Db, ctx: TenantContext, connectorId: string, processIds?: string[]) {
  const t = ctx.tenantId;
  const procs = await db.select().from(automationProcesses).where(and(eq(automationProcesses.tenantId, t), eq(automationProcesses.connectorId, connectorId)));
  const ids = procs.map((p) => p.id);
  const one = <T,>(rows: T[]) => rows;
  const [fs, jobs, vers, trigs, qs, sigs] = ids.length === 0 ? [[], [], [], [], [], []] as never[][] : await Promise.all([
    db.select().from(folders).where(eq(folders.connectorId, connectorId)),
    db.select().from(executionJobs).where(inArray(executionJobs.processId, ids)),
    db.select().from(processVersions).where(inArray(processVersions.processId, ids)),
    db.select().from(triggers).where(inArray(triggers.processId, ids)),
    db.select().from(queues).where(eq(queues.tenantId, t)),
    db.select().from(queueSignals).where(eq(queueSignals.tenantId, t)),
  ]);
  const assets = ids.length === 0 ? [] : await db.select().from(assetMetadata).where(eq(assetMetadata.tenantId, t));
  return { procs: one(procs), folders: fs as (typeof folders.$inferSelect)[], jobs: jobs as (typeof executionJobs.$inferSelect)[], vers: vers as (typeof processVersions.$inferSelect)[], trigs: trigs as (typeof triggers.$inferSelect)[], qs: qs as (typeof queues.$inferSelect)[], sigs: sigs as (typeof queueSignals.$inferSelect)[], assets, processIds };
}

function statsFor(b: Bundle, processId: string, now: number, windowDays: number) {
  const jobs = b.jobs.filter((j) => j.processId === processId);
  const faulted = jobs.filter((j) => j.state === "Faulted");
  const starts = jobs.map((j) => j.startedAt?.getTime() ?? 0).filter(Boolean);
  const errCounts = new Map<string, number>();
  for (const j of faulted) if (j.infoMessage) errCounts.set(j.infoMessage, (errCounts.get(j.infoMessage) ?? 0) + 1);
  const durs = jobs.map((j) => j.durationSec).filter((d): d is number => d != null);
  return {
    windowDays, total: jobs.length, successful: jobs.filter((j) => j.state === "Successful").length, faulted: faulted.length,
    failureRate: jobs.length ? faulted.length / jobs.length : 0, perDay: jobs.length / windowDays,
    daysSinceLastRun: starts.length ? Math.floor((now - Math.max(...starts)) / DAY) : null,
    avgDurationSec: durs.length ? Math.round(durs.reduce((a, d) => a + d, 0) / durs.length) : null,
    escalated: jobs.filter((j) => j.infoMessage && ESCALATION.test(j.infoMessage)).length,
    topErrors: [...errCounts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([text, count]) => ({ text, count })),
    uiFaults: faulted.filter((j) => j.infoMessage && UI_FAULT.test(j.infoMessage)).length,
  };
}

export async function buildAllFacts(db: Db, ctx: TenantContext, connectorId: string, windowDays = 90, now = Date.now()): Promise<ProcessFacts[]> {
  const b = await loadBundle(db, ctx, connectorId);
  const stats = new Map(b.procs.map((p) => [p.id, statsFor(b, p.id, now, windowDays)]));
  return b.procs.map((p): ProcessFacts => {
    const folder = b.folders.find((f) => f.id === p.folderId);
    const versions = b.vers.filter((v) => v.processId === p.id);
    const published = versions.map((v) => v.publishedAt?.getTime()).filter((x): x is number => !!x);
    const myTriggers = b.trigs.filter((t) => t.processId === p.id);
    const qName = myTriggers.find((t) => t.kind === "queue")?.queueName;
    const q = qName ? b.qs.find((x) => x.name === qName && x.folderId === p.folderId) : undefined;
    const sig = q ? b.sigs.filter((s) => s.queueId === q.id).sort((a, c) => c.capturedAt.getTime() - a.capturedAt.getTime())[0] : undefined;
    const folderAssets = b.assets.filter((a) => a.folderId === p.folderId);
    const siblings = b.procs.filter((o) => o.id !== p.id && o.folderId === p.folderId);
    return {
      processId: p.id, name: p.name, packageId: p.packageId, description: p.description ?? "", version: p.currentVersion, folderPath: folder?.path ?? "?",
      versionCount: versions.length, versionsLast180d: published.filter((x) => now - x <= 180 * DAY).length, daysSinceLastPublish: published.length ? Math.floor((now - Math.max(...published)) / DAY) : null,
      jobs: stats.get(p.id)!,
      triggers: myTriggers.map((t) => ({ kind: t.kind, cron: t.cron, enabled: t.enabled, queueName: t.queueName })),
      queue: sig && q ? { name: q.name, total: sig.total, successRate: sig.total ? sig.successful / sig.total : 0, businessExceptionRate: sig.total ? sig.businessExceptions / sig.total : 0, applicationExceptionRate: sig.total ? sig.applicationExceptions / sig.total : 0, abandonedRate: sig.total ? sig.abandoned / sig.total : 0, retriedRate: sig.total ? sig.retried / sig.total : 0, topReasons: sig.topErrorReasons } : null,
      folderAssets: { total: folderAssets.length, credentialLike: folderAssets.filter((a) => CREDENTIAL_TYPES.has(a.valueType.toLowerCase())).length },
      duplicatesOf: b.procs.filter((o) => o.id !== p.id && o.packageId === p.packageId).map((o) => ({ processName: o.name, jobs: stats.get(o.id)!.total, version: o.currentVersion })),
      stableSiblingTools: siblings.map((o) => ({ name: o.name, s: stats.get(o.id)! })).filter((x) => x.s.total >= 30 && x.s.failureRate <= 0.1).map((x) => ({ name: x.name, failureRate: x.s.failureRate, jobs: x.s.total })),
    };
  });
}
