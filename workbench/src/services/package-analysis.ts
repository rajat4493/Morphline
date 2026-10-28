import { and, desc, eq, inArray } from "drizzle-orm";
import { diffPackages } from "@/analysis/diff";
import { runSandboxed } from "@/analysis/sandbox";
import type { PackageGraph } from "@/analysis/types";
import type { EstateConnector, EstateIssue, SourceFolder } from "@/connectors/types";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { audit } from "@/lib/audit";
import { encryptBytes } from "@/lib/crypto";
import type { TenantContext } from "@/lib/tenant";
// the analyzer is plain JS so it can run with zero dependencies inside the sandbox
import { ANALYZER_VERSION, LIMITS } from "../../worker/analyze.mjs";

export const MAX_PACKAGES_PER_IMPORT = 200;
export const MAX_RETAINED_BYTES = 50 * 1024 * 1024;
export type PackageSettings = { enabled: boolean; permissionConfirmed: boolean; retainRaw: boolean };
export const settingsOf = (c: { packageAnalysisEnabled: boolean; packagePermissionConfirmed: boolean; packageRetainRaw: boolean }): PackageSettings => ({ enabled: c.packageAnalysisEnabled, permissionConfirmed: c.packagePermissionConfirmed, retainRaw: c.packageRetainRaw });
/** Packages are downloaded only when the connector is opted in AND the operator has confirmed the token holds Packages.View. */
export const packageAnalysisActive = (st: PackageSettings) => st.enabled && st.permissionConfirmed;

type Proc = typeof s.automationProcesses.$inferSelect;
type Failure = "download_denied" | "not_found" | "too_large" | "download_error" | "analyzer_failed" | "isolation_unavailable";
const TRANSIENT: Failure[] = ["download_denied", "download_error", "analyzer_failed", "isolation_unavailable"]; // retried on the next import

export type PackageRunStats = { analyzed: number; cached: number; failed: number; denied: number; skipped: number; diffs: number };

async function analyzeVersion(db: Db, ctx: TenantContext, connector: EstateConnector, proc: Proc, folder: SourceFolder | undefined, version: string, isDeployed: boolean, settings: PackageSettings, state: { denied: boolean; stats: PackageRunStats; issues: EstateIssue[] }) {
  const existing = (await db.select().from(s.packageAnalyses).where(and(eq(s.packageAnalyses.processId, proc.id), eq(s.packageAnalyses.version, version), eq(s.packageAnalyses.analyzerVersion, ANALYZER_VERSION))))[0];
  if (existing && !TRANSIENT.includes(existing.failure as Failure)) { state.stats.cached++; return existing; }
  const save = async (v: Partial<typeof s.packageAnalyses.$inferInsert> & { sourceStatus: string }, bytes?: Buffer) => {
    const values = { tenantId: ctx.tenantId, processId: proc.id, version, analyzerVersion: ANALYZER_VERSION, isDeployed, ...v };
    const [row] = existing ? await db.update(s.packageAnalyses).set({ ...values, createdAt: new Date() }).where(eq(s.packageAnalyses.id, existing.id)).returning() : await db.insert(s.packageAnalyses).values(values).returning();
    await db.delete(s.packageBlobs).where(eq(s.packageBlobs.analysisId, row.id));
    if (bytes && settings.retainRaw && bytes.length <= MAX_RETAINED_BYTES) await db.insert(s.packageBlobs).values({ tenantId: ctx.tenantId, analysisId: row.id, encrypted: encryptBytes(bytes), sizeBytes: bytes.length });
    return row;
  };
  const fail = async (failure: Failure, detail: string, isolation?: unknown) => { state.stats.failed++; return save({ sourceStatus: "missing", coverage: 0, failure, failureDetail: detail.slice(0, 300), isolation: isolation ?? null }); };

  if (state.denied) { state.stats.skipped++; return fail("download_denied", "Skipped: an earlier download in this run was denied (missing Packages.View)."); }
  if (!connector.downloadPackage) return fail("download_error", "This connector cannot download packages.");
  const dl = await connector.downloadPackage({ packageId: proc.packageId, version, folder, maxBytes: LIMITS.maxPackageBytes });
  if (!dl.ok) {
    if (dl.code === "denied") { state.denied = true; state.stats.denied++; state.issues.push({ entity: "package_download", message: dl.message }); return fail("download_denied", dl.message); }
    if (dl.code === "not_found") return fail("not_found", dl.message);
    if (dl.code === "too_large") return fail("too_large", dl.message);
    return fail("download_error", dl.message);
  }
  const run = await runSandboxed(dl.bytes);
  if (!run.ok) { state.issues.push({ entity: "package_analysis", message: `${proc.name} v${version}: ${run.message}` }); return fail(run.code === "isolation_unavailable" ? "isolation_unavailable" : "analyzer_failed", run.message, run.isolation); }
  let parsed: { ok: boolean; result?: PackageGraph; error?: string };
  try { parsed = JSON.parse(run.stdout.toString("utf8")); } catch { return fail("analyzer_failed", "Analyzer returned invalid output", run.isolation); }
  if (!parsed.ok || !parsed.result) return fail("analyzer_failed", parsed.error ?? "Analyzer reported an error", run.isolation);
  const g = parsed.result;
  const identityMatches = g.identity?.version ? g.identity.version === version && (g.identity.id ?? "").toLowerCase() === proc.packageId.toLowerCase() : null;
  state.stats.analyzed++;
  return save({ sourceStatus: g.source.status, coverage: g.coverage, xamlTotal: g.source.xamlTotal, xamlParsed: g.source.xamlParsed, packageSha256: g.sha256, packageBytes: g.bytes, identityMatches, graph: g, isolation: run.isolation }, dl.bytes);
}

/** Download + analyse the deployed version of each process (and the previous version for diffing). Never throws: failures become rows and issues. */
export async function runPackageAnalysis(db: Db, ctx: TenantContext, connectorRow: typeof s.connectors.$inferSelect, connector: EstateConnector, opts: { processIds?: string[]; diffPrevious?: boolean } = {}) {
  const stats: PackageRunStats = { analyzed: 0, cached: 0, failed: 0, denied: 0, skipped: 0, diffs: 0 }, issues: EstateIssue[] = [];
  const settings = settingsOf(connectorRow);
  if (!packageAnalysisActive(settings)) return { stats, issues, ran: false };
  const procs = (await db.select().from(s.automationProcesses).where(and(eq(s.automationProcesses.connectorId, connectorRow.id), eq(s.automationProcesses.tenantId, ctx.tenantId)))).filter((p) => !opts.processIds || opts.processIds.includes(p.id)).slice(0, MAX_PACKAGES_PER_IMPORT);
  const folders = await db.select().from(s.folders).where(eq(s.folders.connectorId, connectorRow.id));
  const versions = procs.length ? await db.select().from(s.processVersions).where(inArray(s.processVersions.processId, procs.map((p) => p.id))) : [];
  const state = { denied: false, stats, issues };
  for (const p of procs) {
    const f = folders.find((x) => x.id === p.folderId); const folder: SourceFolder | undefined = f ? { id: f.sourceId, name: f.name, path: f.path, raw: null } : undefined;
    const cur = await analyzeVersion(db, ctx, connector, p, folder, p.currentVersion, true, settings, state);
    if (opts.diffPrevious === false || cur.sourceStatus !== "source_available") continue;
    const mine = versions.filter((v) => v.processId === p.id), curPub = mine.find((v) => v.version === p.currentVersion)?.publishedAt?.getTime() ?? Infinity;
    const prev = mine.filter((v) => v.version !== p.currentVersion && (v.publishedAt?.getTime() ?? 0) < curPub).sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))[0];
    if (!prev) continue;
    const before = await analyzeVersion(db, ctx, connector, p, folder, prev.version, false, settings, state);
    if (before.sourceStatus !== "source_available" || !before.graph || !cur.graph) continue;
    const summary = diffPackages(before.graph as PackageGraph, cur.graph as PackageGraph, prev.version, p.currentVersion);
    await db.insert(s.packageDiffs).values({ tenantId: ctx.tenantId, processId: p.id, fromAnalysisId: before.id, toAnalysisId: cur.id, fromVersion: prev.version, toVersion: p.currentVersion, summary }).onConflictDoUpdate({ target: [s.packageDiffs.fromAnalysisId, s.packageDiffs.toAnalysisId], set: { summary } });
    stats.diffs++;
  }
  await audit(db, ctx, "package_analysis.run", "connector", connectorRow.id, { ...stats, retainRaw: settings.retainRaw, analyzerVersion: ANALYZER_VERSION });
  return { stats, issues, ran: true };
}

export type PackageSettingsInput = { enabled: boolean; permissionConfirmed: boolean; retainRaw: boolean };
export async function updatePackageSettings(db: Db, ctx: TenantContext, connectorId: string, input: PackageSettingsInput) {
  const enabled = input.enabled && input.permissionConfirmed;
  const prev = (await db.select().from(s.connectors).where(and(eq(s.connectors.id, connectorId), eq(s.connectors.tenantId, ctx.tenantId))))[0];
  if (!prev) return null;
  const [row] = await db.update(s.connectors).set({ packageAnalysisEnabled: enabled, packagePermissionConfirmed: input.permissionConfirmed, packageRetainRaw: enabled && input.retainRaw }).where(eq(s.connectors.id, connectorId)).returning();
  let purged = 0;
  if (!row.packageRetainRaw) { // turning retention off removes what was retained
    const analyses = await db.select({ id: s.packageAnalyses.id }).from(s.packageAnalyses).innerJoin(s.automationProcesses, eq(s.packageAnalyses.processId, s.automationProcesses.id)).where(eq(s.automationProcesses.connectorId, connectorId));
    if (analyses.length) purged = (await db.delete(s.packageBlobs).where(inArray(s.packageBlobs.analysisId, analyses.map((a) => a.id))).returning({ id: s.packageBlobs.id })).length;
  }
  await audit(db, ctx, "package_analysis.settings_changed", "connector", connectorId, { enabled: row.packageAnalysisEnabled, permissionConfirmed: row.packagePermissionConfirmed, retainRaw: row.packageRetainRaw, retainedPackagesPurged: purged });
  return row;
}
