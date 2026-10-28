import { dt, day } from "@/lib/fmt";
import Link from "next/link";
import { RECOMMENDATIONS, RECOMMENDATION_LABEL } from "@/assessment/types";
import { applyFilters, parseFilters } from "@/lib/filters";
import { getContext } from "@/lib/server";
import { inventory, recentImports } from "@/services/queries";
import { ActionButton } from "@/components/Actions";
import { Empty, ProcessLink, RecBadge, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { db, ctx } = await getContext();
  const all = await inventory(db, ctx);
  const f = parseFilters(searchParams);
  const rows = applyFilters(all, f);
  const imports = await recentImports(db, ctx);
  if (all.length === 0) return (<><h1>Overview</h1><p className="sub">Automation estate assessment, built from read-only Orchestrator data.</p>
    <Empty title="No estate imported yet">Create a demo connection to explore with simulated data, or add your own Orchestrator connection.<br /><br /><ActionButton url="/api/connectors" body={{ demo: true }} label="Create demo connection" /> <Link className="btn secondary" href="/connectors">Connectors</Link></Empty></>);
  const folders = [...new Map(all.map((r) => [r.folderId, r.folder])).entries()];
  const counts = Object.fromEntries(RECOMMENDATIONS.map((r) => [r, rows.filter((x) => x.recommendation === r).length]));
  const max = Math.max(1, ...Object.values(counts));
  const risk = [...rows].sort((a, b) => b.risk - a.risk).slice(0, 5);
  const opp = [...rows].filter((r) => r.recommendation !== "retire").sort((a, b) => b.opportunity - a.opportunity).slice(0, 5);
  return (
    <>
      <h1>Overview</h1>
      <p className="sub">Assessment is derived from Orchestrator operational data only. Logic analysis of the packages is not yet available.</p>
      <form className="card filters" method="get" aria-label="Filters"><div className="row">
        <div><label htmlFor="folder">Folder</label><select id="folder" name="folder" defaultValue={f.folder ?? ""}><option value="">All</option>{folders.map(([id, p]) => <option key={id} value={id}>{p}</option>)}</select></div>
        <div><label htmlFor="recommendation">Recommendation</label><select id="recommendation" name="recommendation" defaultValue={f.recommendation ?? ""}><option value="">All</option>{RECOMMENDATIONS.map((r) => <option key={r} value={r}>{RECOMMENDATION_LABEL[r]}</option>)}</select></div>
        <div><label htmlFor="status">Status</label><select id="status" name="status" defaultValue={f.status ?? ""}><option value="">All</option><option value="active">Active</option></select></div>
        <div><label htmlFor="minConfidence">Min confidence</label><input id="minConfidence" name="minConfidence" type="number" min={0} max={100} defaultValue={f.minConfidence ?? ""} style={{ width: 90 }} /></div>
        <button type="submit">Apply</button><Link className="btn secondary" href="/">Reset</Link></div></form>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat n={rows.length} label={rows.length === all.length ? "Processes" : `Processes (of ${all.length})`} />
        <Stat n={rows.filter((r) => r.redesign).length} label="Need redesign / risk review" />
        <Stat n={rows.filter((r) => r.recommendation === "retire").length} label="Retire / consolidate candidates" />
        <Stat n={rows.length ? Math.round(rows.reduce((a, r) => a + r.confidence, 0) / rows.length) : 0} label="Average confidence (max 85)" />
      </div>
      <div className="grid g2">
        <section className="card" aria-labelledby="dist"><h2 id="dist">Recommendation distribution</h2>
          {RECOMMENDATIONS.map((r) => <div className="bar" key={r}><span className="t"><RecBadge rec={r} /></span><span className="f" style={{ width: `${(counts[r] / max) * 55}%` }} aria-hidden /><strong>{counts[r]}</strong></div>)}</section>
        <section className="card" aria-labelledby="imp"><h2 id="imp">Recent imports</h2>
          <table><caption className="sr">Recent import runs</caption><thead><tr><th>When</th><th>Connector</th><th>Status</th><th className="num">Processes</th></tr></thead><tbody>
            {imports.map(({ run, connector }) => <tr key={run.id}><td>{dt(run.startedAt)}</td><td>{connector}</td><td><span className={`badge ${run.status === "success" ? "b-ok" : run.status === "partial" ? "b-warn" : "b-bad"}`}>{run.status}</span></td><td className="num">{run.counts.processes ?? 0}</td></tr>)}</tbody></table>
          <p><Link href="/connectors">Manage imports</Link></p></section>
        <section className="card" aria-labelledby="risk"><h2 id="risk">Top risk</h2>
          <table><thead><tr><th>Process</th><th className="num">Risk</th><th>Recommendation</th></tr></thead><tbody>{risk.map((r) => <tr key={r.id}><td><ProcessLink id={r.id} name={r.name} />{r.redesign && <> <span className="badge b-bad">Redesign review</span></>}</td><td className="num">{r.risk}</td><td><RecBadge rec={r.recommendation} /></td></tr>)}</tbody></table></section>
        <section className="card" aria-labelledby="opp"><h2 id="opp">Top opportunity</h2>
          <table><thead><tr><th>Process</th><th className="num">Opportunity</th><th>Recommendation</th></tr></thead><tbody>{opp.map((r) => <tr key={r.id}><td><ProcessLink id={r.id} name={r.name} /></td><td className="num">{r.opportunity}</td><td><RecBadge rec={r.recommendation} /></td></tr>)}</tbody></table>
          <p className="muted">Opportunity reflects AI/judgment signals plus volume. It is not a business-value estimate.</p></section>
      </div>
    </>
  );
}
