import { Database, Inbox, PlugZap } from "lucide-react";
import Link from "next/link";
import { RECOMMENDATIONS } from "@/assessment/types";
import { ActionButton } from "@/components/Actions";
import { EmptyState, Metric, PageHeader, RecBadge, REC_META, StatusBadge } from "@/components/ds";
import { pretty, folderCrumb } from "@/components/ds/meta";
import { dt } from "@/lib/fmt";
import { applyFilters, parseFilters } from "@/lib/filters";
import { getContext } from "@/lib/server";
import { inventory, packageCoverageSummary, recentImports } from "@/services/queries";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { db, ctx } = await getContext();
  const all = await inventory(db, ctx);
  if (all.length === 0) return (<><PageHeader title="Overview" meta="Evidence-backed assessment of your automation estate" />
    <EmptyState icon={<Database size={22} />} title="No estate imported yet" action={<span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}><ActionButton url="/api/connectors" body={{ demo: true }} label="Create demo connection" variant="primary" /><Link className="btn secondary" href="/connectors"><PlugZap size={16} aria-hidden />Connectors</Link></span>}>Create a demo connection to explore with simulated data, or add your own Orchestrator connection. Everything is read-only.</EmptyState></>);

  const f = parseFilters(searchParams);
  const rows = applyFilters(all, f);
  const imports = await recentImports(db, ctx);
  const pkg = await packageCoverageSummary(db, ctx);
  const folders = [...new Map(all.map((r) => [r.folderId, r.folder])).entries()];
  const counts = Object.fromEntries(RECOMMENDATIONS.map((r) => [r, rows.filter((x) => x.recommendation === r).length]));
  const max = Math.max(1, ...Object.values(counts));
  const risk = [...rows].sort((a, b) => b.risk - a.risk).slice(0, 5);
  const opp = [...rows].filter((r) => r.recommendation !== "retire").sort((a, b) => b.opportunity - a.opportunity).slice(0, 5);

  return (
    <>
      <PageHeader title="Overview" meta={<span>Evidence-backed assessment from read-only Orchestrator data · {all.length} processes</span>} />
      <form method="get" className="panel toolbar" role="search" aria-label="Filter overview" style={{ marginBottom: 24 }}>
        <div className="field"><label htmlFor="folder">Folder</label><select className="select" id="folder" name="folder" defaultValue={f.folder ?? ""}><option value="">All folders</option>{folders.map(([id, p]) => <option key={id} value={id}>{folderCrumb(p)}</option>)}</select></div>
        <div className="field"><label htmlFor="recommendation">Recommendation</label><select className="select" id="recommendation" name="recommendation" defaultValue={f.recommendation ?? ""}><option value="">All</option>{RECOMMENDATIONS.map((r) => <option key={r} value={r}>{REC_META[r].label}</option>)}</select></div>
        <div className="field"><label htmlFor="status">Status</label><select className="select" id="status" name="status" defaultValue={f.status ?? ""}><option value="">All</option><option value="active">Active</option></select></div>
        <div className="field"><label htmlFor="minConfidence">Min confidence</label><input className="input" id="minConfidence" name="minConfidence" type="number" min={0} max={100} defaultValue={f.minConfidence ?? ""} style={{ width: 110 }} /></div>
        <button type="submit" className="btn">Apply</button><Link className="btn ghost" href="/">Reset</Link>
      </form>

      <section className="metrics" aria-label="Key figures" style={{ marginBottom: 24 }}>
        <div className="panel kpi"><Metric label={rows.length === all.length ? "Processes" : `Processes (of ${all.length})`} value={rows.length} /></div>
        <div className="panel kpi"><Metric label="Redesign review" value={rows.filter((r) => r.redesign).length} sub="Stabilise before migrating" /></div>
        <div className="panel kpi"><Metric label="Retire / consolidate" value={rows.filter((r) => r.recommendation === "retire").length} sub="Candidates to confirm" /></div>
        <div className="panel kpi"><Metric label="Packages analysed" value={`${pkg.trusted} of ${pkg.total}`} sub={pkg.attempted === 0 ? "Opt-in, off" : `${pkg.attempted} attempted · trusted = 80%+ source parsed`} tipId="tip-pkg" tip="Processes whose deployed package was analysed from readable source (at least 80% of workflow files parsed). Trusted analysis raises the confidence cap to 90 and makes policy-constrained agentic eligible." /></div>
        <div className="panel kpi"><Metric label="Average confidence" value={rows.length ? Math.round(rows.reduce((a, r) => a + r.confidence, 0) / rows.length) : 0} sub="Capped at 85 without package analysis" tipRight tipId="tip-avg" tip="Mean confidence across the filtered processes. Package analysis is not available yet, so no result can exceed 85." /></div>
      </section>

      <div className="cols-2">
        <section className="panel panel-pad" aria-labelledby="dist"><h2 className="panel-title" id="dist">Recommendation distribution</h2>
          <div className="dist">{RECOMMENDATIONS.map((r) => <div className="dist-row" key={r}><RecBadge rec={r} /><div className="dist-track" aria-hidden><div className="dist-fill" style={{ width: `${(counts[r] / max) * 100}%` }} /></div><b className="num">{counts[r]}</b></div>)}</div></section>
        <section className="panel panel-pad" aria-labelledby="imp"><h2 className="panel-title" id="imp">Recent imports</h2>
          {imports.length === 0 ? <p className="muted">No imports yet.</p> : <ul className="row-list">{imports.map(({ run, connector }) => <li key={run.id}><span><b>{connector}</b><br /><span className="muted">{dt(run.startedAt)} · {run.counts.processes ?? 0} processes</span></span><StatusBadge tone={run.status === "success" ? "sage" : run.status === "partial" ? "amber" : "red"}>{run.status}</StatusBadge></li>)}</ul>}
          <p style={{ marginBottom: 0 }}><Link href="/connectors">Manage imports</Link></p></section>
        <section className="panel panel-pad" aria-labelledby="risk"><h2 className="panel-title" id="risk">Top risk</h2>
          <ul className="row-list">{risk.map((r) => <li key={r.id}><span><Link href={`/processes/${r.id}`}>{pretty(r.name)}</Link><br /><RecBadge rec={r.recommendation} /></span><span className="num"><b>{r.risk}</b><br /><span className="muted" style={{ fontSize: 12 }}>risk</span></span></li>)}</ul></section>
        <section className="panel panel-pad" aria-labelledby="opp"><h2 className="panel-title" id="opp">Top opportunity</h2>
          <ul className="row-list">{opp.map((r) => <li key={r.id}><span><Link href={`/processes/${r.id}`}>{pretty(r.name)}</Link><br /><RecBadge rec={r.recommendation} /></span><span className="num"><b>{r.opportunity}</b><br /><span className="muted" style={{ fontSize: 12 }}>opportunity</span></span></li>)}</ul>
          <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>Reflects AI/judgment signals plus volume. Not a business-value estimate.</p></section>
      </div>
    </>
  );
}
