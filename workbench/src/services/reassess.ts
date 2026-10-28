import { and, eq } from "drizzle-orm";
import { resolveClassifier, type ResolvedAi } from "@/ai/config";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { TenantContext } from "@/lib/tenant";
import { buildConnector, getConnectorRow } from "./connectors";
import { rebuildDependencies } from "./dependencies";
import { runExceptionAi } from "./exception-ai";
import { buildAllFacts, type AiFacts } from "./facts";
import { JOB_WINDOW_DAYS, assessAndStore } from "./import";
import { packageAnalysisActive, runPackageAnalysis, settingsOf } from "./package-analysis";

/** On-demand: analyse one process's deployed package (opt-in connectors only), rebuild its dependencies and store a fresh assessment. */
export async function analyzeAndReassess(db: Db, ctx: TenantContext, processId: string, overrides: { fetch?: typeof fetch; ai?: Pick<ResolvedAi, "classifier"> } = {}) {
  const [proc] = await db.select().from(s.automationProcesses).where(and(eq(s.automationProcesses.id, processId), eq(s.automationProcesses.tenantId, ctx.tenantId)));
  if (!proc) return { ok: false as const, code: "not_found" as const, message: "Process not found" };
  const row = await getConnectorRow(db, ctx, proc.connectorId);
  if (!row) return { ok: false as const, code: "not_found" as const, message: "Connector not found" };
  if (!packageAnalysisActive(settingsOf(row))) return { ok: false as const, code: "disabled" as const, message: "Package analysis is not enabled for this connector. Enable it and confirm the Packages.View permission in Connectors." };
  const run = await runPackageAnalysis(db, ctx, row, buildConnector(row, { fetch: overrides.fetch }), { processIds: [processId] });
  await rebuildDependencies(db, ctx, row.id);
  const resolved = overrides.ai ?? resolveClassifier({ isDemo: row.isDemo });
  let aiFacts: AiFacts | null = null;
  if (resolved.classifier) { const r = await runExceptionAi(db, ctx, row.id, resolved.classifier); if (r.byProcess.size) aiFacts = { method: r.method, model: r.model, byProcess: r.byProcess }; }
  const facts = (await buildAllFacts(db, ctx, row.id, JOB_WINDOW_DAYS, Date.now(), aiFacts)).find((f) => f.processId === processId)!;
  const a = await assessAndStore(db, ctx, facts, null);
  return { ok: true as const, assessmentId: a.id, stats: run.stats, issues: run.issues };
}
