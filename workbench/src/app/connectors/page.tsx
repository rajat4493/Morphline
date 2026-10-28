import { desc, eq } from "drizzle-orm";
import { CheckCircle2, PlugZap, Play, XCircle, ShieldCheck } from "lucide-react";
import { Box, Sparkles } from "lucide-react";
import { resolveClassifier } from "@/ai/config";
import { ActionButton, ConnectorForm, FolderPicker, PackageSettingsForm } from "@/components/Actions";
import { probeIsolation } from "@/analysis/sandbox";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ds";
import * as s from "@/db/schema";
import { dt } from "@/lib/fmt";
import { getContext } from "@/lib/server";
import { connectorFolders, connectorList } from "@/services/queries";

export const dynamic = "force-dynamic";

export default async function Connectors() {
  const iso = probeIsolation(), requireIso = process.env.MORPHLINE_ANALYZER_REQUIRE_ISOLATION === "1";
  const { db, ctx } = await getContext();
  const list = await connectorList(db, ctx);
  const runs = await db.select().from(s.importRuns).where(eq(s.importRuns.tenantId, ctx.tenantId)).orderBy(desc(s.importRuns.startedAt)).limit(15);
  const names = new Map(list.map((c) => [c.id, c.name]));
  const folderMap = new Map(await Promise.all(list.map(async (c) => [c.id, await connectorFolders(db, c.id)] as const)));
  return (
    <>
      <PageHeader title="Connectors & imports" meta={<><span><ShieldCheck size={14} aria-hidden />Read-only (GET only)</span><span>Config encrypted · tokens read from server env vars, never stored</span></>} />
      <div className="stack-l">
        {list.length === 0 && <EmptyState icon={<PlugZap size={22} />} title="No connections yet" action={<ActionButton url="/api/connectors" body={{ demo: true }} label="Create demo connection" variant="primary" />}>Create a simulated demo connection, or add a real Orchestrator below.</EmptyState>}
        {list.map((c) => {
          const folders = folderMap.get(c.id) ?? [];
          return (
            <section className="panel panel-pad" key={c.id} aria-labelledby={`c-${c.id}`}>
              <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap", alignItems: "flex-start" }}>
                <div><h2 className="panel-title" id={`c-${c.id}`} style={{ marginBottom: 4 }}>{c.name} {c.isDemo && <StatusBadge tone="amber">Simulated data</StatusBadge>}</h2>
                  <p className="muted" style={{ margin: 0 }}>{c.lastTestAt ? <>Last test {dt(c.lastTestAt)}: {c.lastTestOk ? <StatusBadge tone="sage" icon={<CheckCircle2 size={13} aria-hidden />}>OK</StatusBadge> : <StatusBadge tone="red" icon={<XCircle size={13} aria-hidden />}>Failed</StatusBadge>} {c.lastTestMessage}</> : "Not tested yet."}</p></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><ActionButton url={`/api/connectors/${c.id}/test`} label="Test connection" busy="Testing…" variant="secondary" /><ActionButton url={`/api/connectors/${c.id}/import`} label="Run import" busy="Importing…" variant="primary" icon={<Play size={15} aria-hidden />} /></div>
              </div>
              <div className="divider" />
              <PackageSettingsForm connectorId={c.id} initial={{ enabled: c.packageAnalysisEnabled, permissionConfirmed: c.packagePermissionConfirmed, retainRaw: c.packageRetainRaw }} />
              <div className="divider" />
              {folders.length > 0 ? <FolderPicker connectorId={c.id} folders={folders} selected={c.selected} /> : <p className="muted" style={{ margin: 0 }}>Folders appear here after the first import (an import with no selection covers every folder visible to the token).</p>}
            </section>
          );
        })}
        <section className="panel panel-pad" aria-labelledby="ai-h"><h2 className="panel-title" id="ai-h"><Sparkles size={16} aria-hidden />AI evidence (exception labelling)</h2>
          <p style={{ marginTop: 0 }}>Optional and off by default. When on, a model labels the text of top exception messages into a fixed set of categories. Labels appear as <b>AI-inferred, lower-trust evidence</b> with every source text shown. They never decide a recommendation, never raise confidence or opportunity, and a failure falls back to deterministic rules.</p>
          <ul className="gaps"><li>Real connectors: {resolveClassifier({ isDemo: false }).status}</li><li>Demo connector: {resolveClassifier({ isDemo: true }).status}</li></ul>
          <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>Data leaving the server when on: redacted exception texts only (emails, numbers, IDs, URLs, paths and token-like strings removed, 200 characters max), batched and cached. Configure with <span className="mono">MORPHLINE_AI_EVIDENCE=off|on|demo</span>. Redaction is best-effort; confirm it meets your data-handling policy before enabling.</p></section>
        <section className="panel panel-pad" id="package-analysis" aria-labelledby="pkg-h"><h2 className="panel-title" id="pkg-h"><Box size={16} aria-hidden />Package analysis sandbox</h2>
          <p style={{ marginTop: 0 }}>When enabled per connection, Morphline downloads the <b>exact deployed package version</b> (read-only <span className="mono">DownloadPackage</span>, needs Packages.View) and analyses it with a fixed static analyzer in an isolated worker. Package code, DLLs, XAML, scripts and embedded files are <b>never executed</b>. Only derived structural facts are stored by default.</p>
          <ul className="gaps"><li>Filesystem permission model (reads limited to the analyzer, no writes, no child processes): <b>{iso.permission ? "available" : "NOT available on this host"}</b></li>
            <li>Network namespace (the worker has no network interfaces): <b>{iso.netns ? "available" : "NOT available on this host"}</b></li>
            <li>Refuse to analyse without both layers (<span className="mono">MORPHLINE_ANALYZER_REQUIRE_ISOLATION=1</span>): <b>{requireIso ? "on" : "off"}</b></li></ul>
          {(!iso.permission || !iso.netns) && !requireIso && <p className="notice" style={{ marginBottom: 0 }}>This host cannot provide every isolation layer. For production, set MORPHLINE_ANALYZER_REQUIRE_ISOLATION=1 or run the analyzer in a container with no network.</p>}
        </section>
        <ConnectorForm />
        <section className="panel panel-pad" aria-labelledby="hist"><h2 className="panel-title" id="hist">Import history</h2>
          {runs.length === 0 ? <p className="muted" style={{ margin: 0 }}>No imports yet.</p> : <div className="tablewrap" tabIndex={0} role="region" aria-label="Import history (scrollable)"><table className="dt"><thead><tr><th scope="col">Started</th><th scope="col">Connector</th><th scope="col">Status</th><th scope="col">Counts</th><th scope="col">Issues</th></tr></thead><tbody>
            {runs.map((r) => <tr key={r.id}><td>{dt(r.startedAt)}</td><td>{names.get(r.connectorId)}</td><td><StatusBadge tone={r.status === "success" ? "sage" : r.status === "partial" ? "amber" : "red"}>{r.status}</StatusBadge></td>
              <td className="mono">{Object.entries(r.counts).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ")}</td>
              <td>{r.errors.length === 0 ? "none" : <details><summary>{r.errors.length} issue(s)</summary><ul className="gaps">{r.errors.map((e, i) => <li key={i}><span className="mono">{e.entity}</span>{e.folder && ` (${e.folder})`}: {e.message}</li>)}</ul></details>}</td></tr>)}</tbody></table></div>}</section>
      </div>
    </>
  );
}
