import { and, eq, inArray } from "drizzle-orm";
import { assess } from "@/assessment/engine";
import type { EstateConnector, EstateIssue, SourceFolder } from "@/connectors/types";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import { resolveClassifier, type ResolvedAi } from "@/ai/config";
import { buildAllFacts, type AiFacts } from "./facts";
import { runExceptionAi } from "./exception-ai";
import { rebuildDependencies } from "./dependencies";
import { runPackageAnalysis } from "./package-analysis";
import type { ProcessFacts } from "@/assessment/types";
import { buildConnector, getConnectorRow } from "./connectors";

export const JOB_WINDOW_DAYS = 90;
const d = (x?: string) => (x ? new Date(x) : null);

export type ImportSummary = { importRunId: string; status: "success" | "partial" | "failed"; counts: Record<string, number>; errors: EstateIssue[] };

export async function runImport(db: Db, ctx: TenantContext, connectorId: string, overrides: { fetch?: typeof fetch; env?: Record<string, string | undefined>; connector?: EstateConnector; ai?: Pick<ResolvedAi, "classifier">; skipPackageAnalysis?: boolean } = {}): Promise<ImportSummary> {
  const row = await getConnectorRow(db, ctx, connectorId);
  if (!row) throw new Error("Connector not found");
  const connector = overrides.connector ?? buildConnector(row, overrides);
  const [run] = await db.insert(s.importRuns).values({ tenantId: ctx.tenantId, connectorId, status: "running" }).returning();
  await audit(db, ctx, "import.started", "import_run", run.id, { connectorId });
  const errors: EstateIssue[] = [];
  const counts: Record<string, number> = { folders: 0, processes: 0, versions: 0, jobs: 0, queues: 0, triggers: 0, machines: 0, assets: 0, dependencies: 0, assessments: 0 };
  const t = ctx.tenantId;

  try {
    const fl = await connector.listFolders();
    errors.push(...fl.issues);
    if (fl.folders.length === 0 && fl.issues.length) throw new Error(fl.issues[0].message);

    const folderRows = new Map<string, typeof s.folders.$inferSelect>();
    for (const f of fl.folders) {
      const [r] = await db.insert(s.folders).values({ tenantId: t, connectorId, sourceId: f.id, name: f.name, path: f.path, parentSourceId: f.parentId ?? null, raw: f.raw as object })
        .onConflictDoUpdate({ target: [s.folders.connectorId, s.folders.sourceId], set: { name: f.name, path: f.path, raw: f.raw as object } }).returning();
      folderRows.set(f.id, r);
    }
    counts.folders = fl.folders.length;

    const mc = await connector.listMachines();
    errors.push(...mc.issues);
    await db.delete(s.machines).where(eq(s.machines.connectorId, connectorId));
    if (mc.machines.length) await db.insert(s.machines).values(mc.machines.map((m) => ({ tenantId: t, connectorId, sourceId: m.id, name: m.name, type: m.type ?? null, runtimes: m.runtimes ?? null, raw: m.raw as object })));
    counts.machines = mc.machines.length;

    const selected = row.selectedFolderIds.length ? new Set(row.selectedFolderIds) : null;
    const targets = fl.folders.filter((f) => !selected || selected.has(f.id));

    for (const folder of targets) {
      const { snapshot, issues } = await connector.fetchFolder(folder as SourceFolder, { jobWindowDays: JOB_WINDOW_DAYS });
      errors.push(...issues);
      const folderRow = folderRows.get(folder.id)!;
      const procRows = new Map<string, typeof s.automationProcesses.$inferSelect>();

      for (const p of snapshot.processes) {
        const [pr] = await db.insert(s.automationProcesses).values({ tenantId: t, connectorId, folderId: folderRow.id, sourceId: p.id, sourceKey: p.key ?? null, name: p.name, packageId: p.packageId, currentVersion: p.version, description: p.description ?? null, status: "active", processType: p.processType ?? null, createdSourceAt: d(p.createdAt), raw: p.raw as object, lastImportRunId: run.id })
          .onConflictDoUpdate({ target: [s.automationProcesses.connectorId, s.automationProcesses.sourceId], set: { name: p.name, packageId: p.packageId, currentVersion: p.version, description: p.description ?? null, raw: p.raw as object, lastImportRunId: run.id, folderId: folderRow.id } }).returning();
        procRows.set(p.name, pr);
        await db.delete(s.processVersions).where(eq(s.processVersions.processId, pr.id));
        if (p.versions.length) await db.insert(s.processVersions).values(p.versions.map((v) => ({ tenantId: t, processId: pr.id, version: v.version, publishedAt: d(v.publishedAt), raw: v as object })));
        await db.delete(s.processDeployments).where(eq(s.processDeployments.processId, pr.id));
        await db.insert(s.processDeployments).values({ tenantId: t, processId: pr.id, folderId: folderRow.id, environmentName: folder.path, raw: { folder: folder.path } });
        counts.processes++; counts.versions += p.versions.length;
      }

      for (const pr of procRows.values()) await db.delete(s.executionJobs).where(eq(s.executionJobs.processId, pr.id));
      for (let i = 0; i < snapshot.jobs.length; i += 500) {
        const chunk = snapshot.jobs.slice(i, i + 500).filter((j) => procRows.has(j.processName));
        if (chunk.length) await db.insert(s.executionJobs).values(chunk.map((j) => ({ tenantId: t, processId: procRows.get(j.processName)!.id, sourceId: j.id, state: j.state, startedAt: d(j.startedAt), endedAt: d(j.endedAt), durationSec: j.startedAt && j.endedAt ? Math.round((Date.parse(j.endedAt) - Date.parse(j.startedAt)) / 1000) : null, source: j.source ?? null, infoMessage: j.info ?? null, machineName: j.machine ?? null, raw: j.raw as object })));
      }
      counts.jobs += snapshot.jobs.length;

      const queueRows = new Map<string, typeof s.queues.$inferSelect>();
      for (const q of snapshot.queues) {
        const [qr] = await db.insert(s.queues).values({ tenantId: t, folderId: folderRow.id, sourceId: q.id, name: q.name, maxRetries: q.maxRetries ?? null, raw: q.raw as object })
          .onConflictDoUpdate({ target: [s.queues.folderId, s.queues.sourceId], set: { name: q.name, maxRetries: q.maxRetries ?? null, raw: q.raw as object } }).returning();
        queueRows.set(q.name, qr);
        if (q.signal) await db.insert(s.queueSignals).values({ tenantId: t, queueId: qr.id, ...q.signal });
      }
      counts.queues += snapshot.queues.length;

      const oldTrig = [...procRows.values()].map((p) => p.id);
      if (oldTrig.length) await db.delete(s.triggers).where(inArray(s.triggers.processId, oldTrig));
      for (const tr of snapshot.triggers) {
        const pr = procRows.get(tr.processName);
        if (!pr) continue;
        await db.insert(s.triggers).values({ tenantId: t, processId: pr.id, sourceId: tr.id, kind: tr.kind, name: tr.name, cron: tr.cron ?? null, enabled: tr.enabled, queueName: tr.queueName ?? null, raw: tr.raw as object });
        counts.triggers++;
        if (tr.queueName && queueRows.has(tr.queueName)) {
          await db.update(s.queues).set({ processId: pr.id }).where(eq(s.queues.id, queueRows.get(tr.queueName)!.id));
        }
      }

      await db.delete(s.assetMetadata).where(and(eq(s.assetMetadata.folderId, folderRow.id), eq(s.assetMetadata.tenantId, t)));
      if (snapshot.assets.length) await db.insert(s.assetMetadata).values(snapshot.assets.map((a) => ({ tenantId: t, folderId: folderRow.id, sourceId: a.id, name: a.name, valueType: a.valueType, valueScope: a.valueScope ?? null, description: a.description ?? null })));
      counts.assets += snapshot.assets.length;
    }

    // Optional package analysis (opt-in): downloads the exact deployed version, analyses it in the sandbox, stores derived facts only.
    if (row.packageAnalysisEnabled && row.packagePermissionConfirmed && !overrides.skipPackageAnalysis) {
      const pr = await runPackageAnalysis(db, ctx, row, connector);
      errors.push(...pr.issues);
      counts.packages_analyzed = pr.stats.analyzed; counts.packages_cached = pr.stats.cached; counts.packages_failed = pr.stats.failed; counts.package_diffs = pr.stats.diffs;
    }
    // Dependencies are rebuilt from scratch each import (with their evidence basis), so repeated imports never accumulate duplicates.
    counts.dependencies = await rebuildDependencies(db, ctx, connectorId);

    // Optional AI evidence layer: label exception texts. Failure here never blocks the import (deterministic rules still run).
    const resolved = overrides.ai ?? resolveClassifier({ isDemo: row.isDemo });
    let aiFacts: AiFacts | null = null;
    if (resolved.classifier) {
      const r = await runExceptionAi(db, ctx, connectorId, resolved.classifier);
      counts.ai_texts = r.stats.texts;
      if (r.issue) errors.push({ entity: "ai_evidence", message: r.issue });
      if (r.byProcess.size) aiFacts = { method: r.method, model: r.model, byProcess: r.byProcess };
    }

    // Assess every imported process in this connector.
    const facts = await buildAllFacts(db, ctx, connectorId, JOB_WINDOW_DAYS, Date.now(), aiFacts);
    for (const f of facts) { await assessAndStore(db, ctx, f, run.id); counts.assessments++; }

    const status = errors.length ? "partial" : "success";
    await db.update(s.importRuns).set({ status, finishedAt: new Date(), counts, errors }).where(eq(s.importRuns.id, run.id));
    await audit(db, ctx, "import.finished", "import_run", run.id, { status, counts, errorCount: errors.length });
    return { importRunId: run.id, status, counts, errors };
  } catch (e) {
    errors.push({ entity: "import", message: (e as Error).message });
    await db.update(s.importRuns).set({ status: "failed", finishedAt: new Date(), counts, errors }).where(eq(s.importRuns.id, run.id));
    await audit(db, ctx, "import.failed", "import_run", run.id, { message: (e as Error).message });
    return { importRunId: run.id, status: "failed", counts, errors };
  }
}

/** Runs the deterministic rules on one process's facts and persists the assessment, its evidence and an audit event. */
export async function assessAndStore(db: Db, ctx: TenantContext, f: ProcessFacts, importRunId: string | null) {
  const t = ctx.tenantId, r = assess(f);
  const [a] = await db.insert(s.assessments).values({ tenantId: t, processId: f.processId, importRunId, ruleVersion: r.ruleVersion, recommendation: r.recommendation, confidence: r.confidence, opportunityScore: r.opportunityScore, riskScore: r.riskScore, rationale: r.rationale, riskFlags: r.riskFlags, missingInformation: r.missingInformation, nextStep: r.nextStep, logicAnalysis: r.logicAnalysis, redesignReview: r.redesignReview, runnerUp: r.runnerUp, inputHash: r.inputHash, eligibility: r.eligibility, packageAnalysisId: r.packageAnalysisId, scores: r.scores }).returning();
  if (r.findings.length) await db.insert(s.assessmentEvidence).values(r.findings.map((e) => ({ tenantId: t, assessmentId: a.id, ruleId: e.ruleId, signal: e.signal, observed: e.observed, effect: e.effect, weight: Object.values(e.votes).reduce((x, y) => x + (y ?? 0), 0) + (e.risk?.weight ?? 0) / 100, sourceEntity: e.sourceEntity, sourceRefs: e.sourceRefs, provenance: e.provenance ?? "deterministic", detail: e.detail ?? null })));
  await audit(db, ctx, "assessment.created", "assessment", a.id, { processId: f.processId, recommendation: r.recommendation, confidence: r.confidence, ruleVersion: r.ruleVersion, inputHash: r.inputHash, logicAnalysis: r.logicAnalysis, packageAnalysisId: r.packageAnalysisId });
  return a;
}
