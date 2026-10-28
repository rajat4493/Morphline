import { Filter, LayoutList, Search, TriangleAlert, Workflow, Gauge, GitFork } from "lucide-react";
import Link from "next/link";
import { RECOMMENDATIONS } from "@/assessment/types";
import { ConfidenceBar, DataTable, EmptyState, Health, Metric, PageHeader, RecBadge, REC_META } from "@/components/ds";
import { healthOf, HIGH_RISK_SCORE, pretty, folderCrumb } from "@/components/ds/meta";
import { dt } from "@/lib/fmt";
import { applyFilters, parseFilters } from "@/lib/filters";
import { getContext } from "@/lib/server";
import { JOB_WINDOW_DAYS } from "@/services/import";
import { inventory, type InventoryRow } from "@/services/queries";

export const dynamic = "force-dynamic";
const sinceDays = (d: Date | null) => (d ? `${Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400_000))}d ago` : "no runs in window");

function ProcessCell({ r }: { r: InventoryRow }) {
  const I = REC_META[r.recommendation as keyof typeof REC_META]?.icon;
  return (
    <div className="pcell">
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>{I && <I size={16} aria-hidden className="icon" style={{ color: "var(--text-3)" }} />}<Link className="rowlink" href={`/processes/${r.id}`} title={r.name}>{pretty(r.name)}</Link></span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><RecBadge rec={r.recommendation} />{r.redesign && <span className="badge amber"><TriangleAlert size={12} aria-hidden />Redesign review</span>}</span>
      <span className="muted mono" style={{ fontSize: 12 }}>v{r.version} · last run {sinceDays(r.lastRun)} · {r.schedule}</span>
    </div>
  );
}

export default async function Inventory({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { db, ctx } = await getContext();
  const all = await inventory(db, ctx);
  const f = parseFilters(searchParams);
  const rows = applyFilters(all, f).sort((a, b) => a.name.localeCompare(b.name));
  const folders = [...new Map(all.map((r) => [r.folderId, r.folder])).entries()];
  const agentic = all.filter((r) => r.recommendation === "hybrid" || r.recommendation === "governed_agentic").length;
  const advancedActive = !!(f.minConfidence || f.redesign || f.status);

  return (
    <>
      <PageHeader title="Estate inventory" meta={<><span><LayoutList size={14} aria-hidden />{rows.length === all.length ? `${all.length} processes` : `${rows.length} of ${all.length} processes`}</span><span>{JOB_WINDOW_DAYS}-day operational window</span></>} />

      {all.length > 0 && (
        <section aria-label="Estate summary" className="metrics" style={{ marginBottom: 24 }}>
          <div className="panel kpi"><Metric label="Total processes" value={all.length} /></div>
          <div className="panel kpi"><Metric label="Agentic candidates" value={agentic} sub="Hybrid or policy-constrained" tipId="tip-agentic" tip="Processes whose best-supported recommendation is Hybrid or Policy-constrained agentic. Candidates, not commitments." /></div>
          <Link href="/processes?redesign=1" className="panel kpi clickable"><Metric label="Redesign review" value={all.filter((r) => r.redesign).length} sub="Stabilise before migrating" /></Link>
          <div className="panel kpi"><Metric label="High operational risk" value={all.filter((r) => r.risk >= HIGH_RISK_SCORE).length} sub={`Risk score ≥ ${HIGH_RISK_SCORE}`} tipRight tipId="tip-hr" tip="Count of processes whose risk score (failure rate, volatile UI, version churn, credential scope) is 40 or higher." /></div>
        </section>
      )}

      <form method="get" className="panel toolbar" role="search" aria-label="Filter processes" style={{ marginBottom: 16, flexDirection: "column", alignItems: "stretch" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 240px" }}><label htmlFor="q">Search</label><div style={{ position: "relative" }}><Search size={16} aria-hidden style={{ position: "absolute", left: 10, top: 10, color: "var(--text-3)" }} /><input className="input search" style={{ paddingLeft: 32, width: "100%" }} id="q" name="q" type="search" defaultValue={f.q ?? ""} placeholder="Process or folder" /></div></div>
          <div className="field"><label htmlFor="folder">Folder</label><select className="select" id="folder" name="folder" defaultValue={f.folder ?? ""}><option value="">All folders</option>{folders.map(([id, p]) => <option key={id} value={id}>{folderCrumb(p)}</option>)}</select></div>
          <div className="field"><label htmlFor="recommendation">Recommendation</label><select className="select" id="recommendation" name="recommendation" defaultValue={f.recommendation ?? ""}><option value="">All</option>{RECOMMENDATIONS.map((r) => <option key={r} value={r}>{REC_META[r].label}</option>)}</select></div>
          <button type="submit" className="btn">Apply</button>
          <Link className="btn ghost" href="/processes">Reset</Link>
        </div>
        <details open={advancedActive}>
          <summary style={{ cursor: "pointer", color: "var(--text-2)", fontWeight: 550, display: "inline-flex", gap: 6, alignItems: "center" }}><Filter size={14} aria-hidden />More filters{advancedActive && <span className="badge blue">active</span>}</summary>
          <div className="adv">
            <div className="field"><label htmlFor="minConfidence">Minimum confidence</label><input className="input" id="minConfidence" name="minConfidence" type="number" min={0} max={100} defaultValue={f.minConfidence ?? ""} style={{ width: 120 }} /></div>
            <div className="field"><label htmlFor="status">Status</label><select className="select" id="status" name="status" defaultValue={f.status ?? ""}><option value="">All</option><option value="active">Active</option></select></div>
            <label className="chk"><input type="checkbox" name="redesign" value="1" defaultChecked={f.redesign} /> Redesign review only</label>
          </div>
        </details>
      </form>

      {all.length === 0 ? <EmptyState icon={<Workflow size={22} />} title="No processes yet" action={<Link className="btn primary" href="/connectors">Go to connectors</Link>}>Import an estate to see its inventory and assessments.</EmptyState>
        : rows.length === 0 ? <EmptyState icon={<Search size={22} />} title="No processes match these filters" action={<Link className="btn secondary" href="/processes">Reset filters</Link>}>Try removing a filter or widening the search.</EmptyState>
        : <DataTable caption={`Automation processes with their latest assessment (${rows.length})`} rows={rows} rowKey={(r) => r.id}
          columns={[
            { header: "Process", cell: (r) => <ProcessCell r={r} /> },
            { header: "Folder", cell: (r) => <span title={r.folder}>{folderCrumb(r.folder)}</span> },
            { header: "Health", cell: (r) => { const h = healthOf(r.failureRate, r.jobs); return <Health rate={r.failureRate} jobs={r.jobs} color={h.color} label={h.label} />; } },
            { header: "Executions", num: true, cell: (r) => r.jobs.toLocaleString("en-US") },
            { header: "Failure rate", num: true, cell: (r) => (r.jobs ? `${(r.failureRate * 100).toFixed(1)}%` : "n/a") },
            { header: "Confidence", cell: (r) => <ConfidenceBar value={r.confidence} /> },
            { header: "Last assessed", cell: (r) => <span className="muted">{dt(r.assessedAt)}</span> },
          ]}
          card={(r) => { const h = healthOf(r.failureRate, r.jobs); return (
            <article className="pcard"><ProcessCell r={r} />
              <dl><div><dt>Folder</dt><dd>{folderCrumb(r.folder)}</dd></div><div><dt>Health</dt><dd><Health rate={r.failureRate} jobs={r.jobs} color={h.color} label={h.label} /></dd></div>
                <div><dt>Executions</dt><dd>{r.jobs.toLocaleString("en-US")}</dd></div><div><dt>Failure rate</dt><dd>{r.jobs ? `${(r.failureRate * 100).toFixed(1)}%` : "n/a"}</dd></div>
                <div><dt>Confidence</dt><dd><ConfidenceBar value={r.confidence} /></dd></div><div><dt>Last assessed</dt><dd>{dt(r.assessedAt)}</dd></div></dl></article>); }} />}
    </>
  );
}
