import type { InventoryRow } from "@/services/queries";

export type Filters = { q?: string; folder?: string; recommendation?: string; status?: string; minConfidence?: number; redesign?: boolean };
export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) || undefined;
  const min = Number(one("minConfidence"));
  return { q: one("q"), folder: one("folder"), recommendation: one("recommendation"), status: one("status"), minConfidence: Number.isFinite(min) && min > 0 ? min : undefined, redesign: one("redesign") === "1" };
}
export function applyFilters(rows: InventoryRow[], f: Filters) {
  return rows.filter((r) => (!f.q || `${r.name} ${r.folder}`.toLowerCase().includes(f.q.toLowerCase())) && (!f.folder || r.folderId === f.folder) && (!f.recommendation || r.recommendation === f.recommendation) && (!f.status || r.status === f.status) && (!f.minConfidence || r.confidence >= f.minConfidence) && (!f.redesign || r.redesign));
}
