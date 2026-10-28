import { and, eq, inArray } from "drizzle-orm";
import type { PackageGraph } from "@/analysis/types";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { TenantContext } from "@/lib/tenant";

export type Basis = "confirmed_package" | "confirmed_orchestrator" | "folder_scoped" | "inferred";
export const BASIS_LABEL: Record<Basis, string> = { confirmed_package: "Confirmed in package", confirmed_orchestrator: "Confirmed in Orchestrator configuration", folder_scoped: "Folder-scoped metadata (association unconfirmed)", inferred: "Inferred" };

type Row = typeof s.dependencies.$inferInsert;

/** Rebuilds every dependency row for a connector's processes from scratch, so repeated imports never accumulate duplicates.
 *  Basis rules:
 *   confirmed_package      a literal reference found in the analysed package of the DEPLOYED version (project.json dependencies, literal asset/queue/process names)
 *   confirmed_orchestrator configured in Orchestrator itself (queue triggers) or a deployment fact (shared package)
 *   folder_scoped          an asset that merely exists in the process's folder; nothing says the process uses it
 *   inferred               derived by joining facts or from names resolved only at runtime (Config keys, producer -> consumer via a queue) */
export async function rebuildDependencies(db: Db, ctx: TenantContext, connectorId: string) {
  const t = ctx.tenantId;
  const procs = await db.select().from(s.automationProcesses).where(and(eq(s.automationProcesses.connectorId, connectorId), eq(s.automationProcesses.tenantId, t)));
  if (!procs.length) return 0;
  const ids = procs.map((p) => p.id);
  await db.delete(s.dependencies).where(inArray(s.dependencies.processId, ids));
  const [trigs, assets, analyses] = await Promise.all([
    db.select().from(s.triggers).where(inArray(s.triggers.processId, ids)), db.select().from(s.assetMetadata).where(eq(s.assetMetadata.tenantId, t)),
    db.select().from(s.packageAnalyses).where(inArray(s.packageAnalyses.processId, ids)),
  ]);
  const graphOf = new Map<string, PackageGraph>();
  for (const p of procs) { const a = analyses.filter((x) => x.processId === p.id && x.isDeployed && x.version === p.currentVersion && x.sourceStatus === "source_available").sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0]; if (a?.graph) graphOf.set(p.id, a.graph as PackageGraph); }
  const rows: Row[] = [];
  const add = (p: typeof procs[number], kind: string, name: string, detail: string, origin: string, basis: Basis) => rows.push({ tenantId: t, processId: p.id, kind, name, detail, origin, basis });

  for (const p of procs) {
    for (const tr of trigs.filter((x) => x.processId === p.id && x.kind === "queue" && x.queueName)) add(p, "queue", tr.queueName!, `Started by queue trigger ${tr.name}`, "queue_trigger", "confirmed_orchestrator");
    for (const o of procs) if (o.id !== p.id && o.packageId === p.packageId) add(p, "process", o.name, `Shares package ${p.packageId}`, "shared_package", "confirmed_orchestrator");

    const g = graphOf.get(p.id), T = g?.totals;
    const folderAssets = assets.filter((a) => a.folderId === p.folderId);
    const litAssets = new Map((T?.references.assets ?? []).map((a) => [a.name.toLowerCase(), a]));
    const trusted = !!g && g.coverage >= 0.8 && T!.references.dynamic === 0 && T!.references.assetConfigRefs.length === 0;
    for (const a of folderAssets) {
      const ref = litAssets.get(a.name.toLowerCase());
      if (ref) add(p, "asset", a.name, `Read by ${ref.op} in ${ref.workflow}; asset exists in this folder`, "package_reference", "confirmed_package");
      else add(p, "asset", a.name, `${a.valueType} asset in folder scope. ${trusted ? "Not referenced by literal name in the analysed package." : "Usage by this process is not determinable from the API."}`, "folder_asset", "folder_scoped");
    }
    if (T) {
      const inFolder = new Set(folderAssets.map((a) => a.name.toLowerCase()));
      for (const a of T.references.assets) if (!inFolder.has(a.name.toLowerCase())) add(p, "asset", a.name, `Read by ${a.op} in ${a.workflow}; not found in the imported folder's asset metadata (may be in another folder)`, "package_reference", "confirmed_package");
      for (const c of T.references.assetConfigRefs) add(p, "config", c.key, `Asset name is read from Config("${c.key}") at runtime in ${c.workflow}; the value is not in the analysed facts`, "config_reference", "inferred");
      for (const c of T.references.queueConfigRefs) add(p, "config", c.key, `Queue name is read from Config("${c.key}") at runtime in ${c.workflow}; the value is not in the analysed facts`, "config_reference", "inferred");
      for (const q of T.references.queues) add(p, "queue", q.name, `Package ${q.op === "add" ? "adds items to" : "reads items from"} this queue in ${q.workflow}`, "package_reference", "confirmed_package");
      for (const name of T.references.externalProcesses) { const hit = procs.find((o) => o.name === name); add(p, "process", name, hit ? `Package invokes this process (present in this estate)` : `Package invokes this process (not found in this estate)`, "package_reference", "confirmed_package"); }
      for (const d of g!.project?.dependencies ?? []) add(p, "package", d.id, `project.json dependency ${d.version}`, "package_reference", "confirmed_package");
      // producer -> consumer: joins this package's literal queue writes with another process's queue trigger
      for (const q of T.references.queues.filter((x) => x.op === "add")) for (const c of procs.filter((o) => o.id !== p.id && o.folderId === p.folderId && trigs.some((x) => x.processId === o.id && x.kind === "queue" && x.queueName === q.name)))
        add(p, "process", c.name, `Adds items to queue "${q.name}" which ${c.name} consumes through a queue trigger (joined from two facts; no direct call)`, "queue_handoff", "inferred");
    }
  }
  for (let i = 0; i < rows.length; i += 200) await db.insert(s.dependencies).values(rows.slice(i, i + 200));
  return rows.length;
}
