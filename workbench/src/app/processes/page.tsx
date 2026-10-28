import Link from "next/link";
import { RECOMMENDATIONS, RECOMMENDATION_LABEL } from "@/assessment/types";
import { applyFilters, parseFilters } from "@/lib/filters";
import { getContext } from "@/lib/server";
import { inventory } from "@/services/queries";
import { ago, Empty, Health, ProcessLink, RecBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Inventory({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { db, ctx } = await getContext();
  const all = await inventory(db, ctx);
  const f = parseFilters(searchParams);
  const rows = applyFilters(all, f).sort((a, b) => a.name.localeCompare(b.name));
  const folders = [...new Map(all.map((r) => [r.folderId, r.folder])).entries()];
  return (
    <>
      <h1>Estate inventory</h1>
      <p className="sub">{rows.length} of {all.length} processes · 90-day operational window</p>
      <form className="card filters" method="get" aria-label="Filters"><div className="row">
        <div><label htmlFor="q">Search</label><input id="q" name="q" type="search" defaultValue={f.q ?? ""} placeholder="Name or folder" /></div>
        <div><label htmlFor="folder">Folder</label><select id="folder" name="folder" defaultValue={f.folder ?? ""}><option value="">All</option>{folders.map(([id, p]) => <option key={id} value={id}>{p}</option>)}</select></div>
        <div><label htmlFor="recommendation">Recommendation</label><select id="recommendation" name="recommendation" defaultValue={f.recommendation ?? ""}><option value="">All</option>{RECOMMENDATIONS.map((r) => <option key={r} value={r}>{RECOMMENDATION_LABEL[r]}</option>)}</select></div>
        <div><label htmlFor="minConfidence">Min confidence</label><input id="minConfidence" name="minConfidence" type="number" min={0} max={100} defaultValue={f.minConfidence ?? ""} style={{ width: 90 }} /></div>
        <div><label htmlFor="redesign"><input id="redesign" type="checkbox" name="redesign" value="1" defaultChecked={f.redesign} /> Redesign review only</label></div>
        <button type="submit">Apply</button><Link className="btn secondary" href="/processes">Reset</Link></div></form>
      {all.length === 0 ? <Empty title="No processes">Import an estate from <Link href="/connectors">Connectors</Link>.</Empty> : rows.length === 0 ? <Empty title="No processes match these filters" /> :
        <div className="card"><table><caption>Automation processes with latest assessment</caption><thead><tr><th>Process</th><th>Folder</th><th>Version</th><th>Health</th><th className="num">Jobs</th><th>Last run</th><th>Schedule</th><th>Recommendation</th><th className="num">Confidence</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td><ProcessLink id={r.id} name={r.name} />{r.redesign && <> <span className="badge b-bad">Redesign review</span></>}</td><td>{r.folder}</td><td>{r.version}</td><td><Health rate={r.failureRate} jobs={r.jobs} /></td><td className="num">{r.jobs}</td><td>{ago(r.lastRun)}</td><td className="mono">{r.schedule}</td><td><RecBadge rec={r.recommendation} /></td><td className="num">{r.confidence}</td></tr>)}</tbody></table></div>}
    </>
  );
}
