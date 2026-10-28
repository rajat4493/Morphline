import type { PackageDiff, PackageGraph } from "./types";

const stable = (g: PackageGraph) => g.workflows.filter((w) => w.parsed && !w.test);
const selSet = (g: PackageGraph) => new Set(stable(g).flatMap((w) => w.selectorFps));

/** Structural difference between two analysed versions. Both must be source_available to be comparable. */
export function diffPackages(from: PackageGraph, to: PackageGraph, fromVersion: string, toVersion: string): PackageDiff {
  const empty = { workflowsAdded: [], workflowsRemoved: [], workflowsChanged: [], workflowsTotal: 0, changeRatio: 0, selectorsAdded: 0, selectorsRemoved: 0, selectorUnion: 0, selectorChurn: 0, dependencyChanges: { added: [], removed: [], changed: [] }, activityDelta: {}, invokesAdded: 0, invokesRemoved: 0, argChanges: 0 };
  const reasons: string[] = [];
  if (from.source.status !== "source_available") reasons.push(`Version ${fromVersion} is ${from.source.status.replace("_", " ")}`);
  if (to.source.status !== "source_available") reasons.push(`Version ${toVersion} is ${to.source.status.replace("_", " ")}`);
  if (reasons.length) return { comparable: false, reasons, fromVersion, toVersion, ...empty };

  const A = new Map(stable(from).map((w) => [w.file.toLowerCase(), w])), B = new Map(stable(to).map((w) => [w.file.toLowerCase(), w]));
  const nm = (m: typeof A, ks: string[]) => ks.map((k) => m.get(k)!.file).sort();
  const added = nm(B, [...B.keys()].filter((k) => !A.has(k))), removed = nm(A, [...A.keys()].filter((k) => !B.has(k))), changed = nm(B, [...B.keys()].filter((k) => A.has(k) && A.get(k)!.hash !== B.get(k)!.hash));
  const union = new Set([...A.keys(), ...B.keys()]).size;
  const sa = selSet(from), sb = selSet(to), su = new Set([...sa, ...sb]);
  const selAdded = [...sb].filter((x) => !sa.has(x)).length, selRemoved = [...sa].filter((x) => !sb.has(x)).length;
  const da = new Map((from.project?.dependencies ?? []).map((d) => [d.id, d.version])), db = new Map((to.project?.dependencies ?? []).map((d) => [d.id, d.version]));
  const dep = { added: [...db].filter(([id]) => !da.has(id)).map(([id, version]) => ({ id, version })), removed: [...da].filter(([id]) => !db.has(id)).map(([id, version]) => ({ id, version })), changed: [...db].filter(([id, v]) => da.has(id) && da.get(id) !== v).map(([id, v]) => ({ id, from: da.get(id)!, to: v })) };
  const delta: Record<string, number> = {};
  for (const k of Object.keys(from.totals?.byCategory ?? {})) { const d = (to.totals?.byCategory as Record<string, number>)[k] - (from.totals?.byCategory as Record<string, number>)[k]; if (d) delta[k] = d; }
  const inv = (g: PackageGraph) => new Set(g.edges.map((e) => `${e.from}>${e.to}`));
  const ia = inv(from), ib = inv(to);
  const argSig = (g: PackageGraph) => new Set(stable(g).flatMap((w) => w.args.map((a) => `${w.file}|${a.name}|${a.dir}`)));
  const aa = argSig(from), ab = argSig(to);
  return {
    comparable: true, reasons: [], fromVersion, toVersion, workflowsAdded: added, workflowsRemoved: removed, workflowsChanged: changed, workflowsTotal: union,
    changeRatio: union ? Math.round(((added.length + removed.length + changed.length) / union) * 1000) / 1000 : 0,
    selectorsAdded: selAdded, selectorsRemoved: selRemoved, selectorUnion: su.size, selectorChurn: su.size ? Math.round(((selAdded + selRemoved) / su.size) * 1000) / 1000 : 0,
    dependencyChanges: dep, activityDelta: delta, invokesAdded: [...ib].filter((x) => !ia.has(x)).length, invokesRemoved: [...ia].filter((x) => !ib.has(x)).length,
    argChanges: [...ab].filter((x) => !aa.has(x)).length + [...aa].filter((x) => !ab.has(x)).length,
  };
}
