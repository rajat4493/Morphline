import { Boxes, FileCode2, GitCompare, Package as PackageIcon, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { PackageGraph, WorkflowFacts } from "@/analysis/types";
import { ActionButton } from "@/components/Actions";
import { BasisBadge, EmptyState, Metric, StatusBadge } from "@/components/ds";
import { PACKAGE_FAILURE, PACKAGE_STATUS } from "@/components/ds/meta";
import { dt } from "@/lib/fmt";
import type { Detail } from "./sections";

type Iso = { fsPermissionModel?: boolean; networkNamespace?: boolean; emptyEnvironment?: boolean; timeoutMs?: number; maxHeapMb?: number };

function InvokeTree({ g }: { g: PackageGraph }) {
  const byFile = new Map(g.workflows.map((w) => [w.file, w]));
  const seen = new Set<string>();
  const node = (w: WorkflowFacts, depth: number): React.ReactNode => {
    seen.add(w.file);
    const out = g.edges.filter((e) => e.from === w.file);
    return (
      <li key={w.file + depth}>
        <span className="mono">{w.file}</span>{w.test && <> <StatusBadge tone="neutral">test</StatusBadge></>}
        <span className="muted"> · {w.activities} activities{w.selectors?.total ? ` · ${w.selectors.fragile}/${w.selectors.total} fragile selectors` : ""}{w.counts?.branches ? ` · ${w.counts.branches} branches` : ""}</span>
        {out.length > 0 && depth < 8 && <ul className="tree">{out.map((e, i) => {
          if (e.kind === "dynamic") return <li key={i}><span className="muted">dynamic invoke: target chosen at runtime</span> <StatusBadge tone="amber">Inferred</StatusBadge></li>;
          if (!e.resolved || !e.to) return <li key={i}><span className="mono">{e.to}</span> <StatusBadge tone="red">not in package</StatusBadge></li>;
          const t = byFile.get(e.to); if (!t) return null;
          return seen.has(t.file) ? <li key={i}><span className="mono">{t.file}</span> <span className="muted">(shown above)</span></li> : node(t, depth + 1);
        })}</ul>}
      </li>
    );
  };
  const root = g.entry ? byFile.get(g.entry) : undefined;
  return root ? <ul className="tree root">{node(root, 0)}</ul> : <p className="muted" style={{ margin: 0 }}>No entry point could be resolved{g.project?.main ? ` (project.json main: ${g.project.main})` : ""}.</p>;
}

export function PackageTab({ d }: { d: Detail }) {
  const a = d.packageAnalysis, st = d.packageSettings, active = st.enabled && st.permissionConfirmed;
  const action = active
    ? <ActionButton url={`/api/processes/${d.p.id}/package-analysis`} label={a ? "Re-analyse package" : "Analyse package"} busy="Analysing in sandbox…" variant={a ? "secondary" : "primary"} />
    : <Link className="btn secondary" href="/connectors#package-analysis">Enable package analysis</Link>;
  if (!a) return <EmptyState icon={<PackageIcon size={22} />} title="Package not analysed" action={action}>
    {active ? "This process has not been analysed yet." : "Package analysis is off. It is opt-in: it downloads the exact deployed package and analyses it statically in an isolated worker. Enable it per connection in Connectors."}</EmptyState>;

  const g = a.graph as PackageGraph | null, T = g?.totals, meta = PACKAGE_STATUS[a.sourceStatus] ?? PACKAGE_STATUS.missing, iso = (a.isolation ?? {}) as Iso;
  const versionOk = a.version === d.p.currentVersion;
  const tone = a.failure ? "red" : meta.tone;
  return (
    <div className="stack-l">
      <section className="panel panel-pad" aria-labelledby="pk-h">
        <div style={{ display: "flex", gap: 16, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="panel-title" id="pk-h" style={{ marginBottom: 6 }}><PackageIcon size={16} aria-hidden />Package analysis <StatusBadge tone={tone as "sage"}>{a.failure ? PACKAGE_FAILURE[a.failure] ?? "Failed" : meta.label}</StatusBadge></h2>
            <p style={{ margin: "0 0 8px" }}>{a.failure ? a.failureDetail : meta.text}</p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Analysed v{a.version}{versionOk ? " (matches the deployed version)" : ` (deployed version is v${d.p.currentVersion}: stale, ignored by the assessment)`} · {dt(a.createdAt)}{a.packageSha256 && <> · sha256 <span className="mono">{a.packageSha256.slice(0, 12)}</span></>}{a.identityMatches === false && <> · <StatusBadge tone="red">package identity does not match</StatusBadge></>}</p>
          </div>
          <div>{action}</div>
        </div>
        {g && <div className="metrics" style={{ marginTop: 16 }}>
          <Metric label="Workflow files parsed" value={`${a.xamlParsed} / ${a.xamlTotal}`} sub={`${Math.round(a.coverage * 100)}% coverage`} tipId="tip-cov" tip="Share of workflow (XAML) files, excluding tests, that parsed from source. At least 80% is required for the assessment to treat the package as trusted." />
          <Metric label="Activities" value={T?.activities ?? 0} sub={(() => { const n = g.workflows.filter((w) => w.parsed && !w.test).length; return `${n} workflow${n === 1 ? "" : "s"}`; })()} />
          <Metric label="Package size" value={`${Math.round(g.bytes / 1024)} KB`} sub={`${g.entryCount} entries`} />
        </div>}
        {g && g.source.reasons.length > 0 && <ul className="gaps" style={{ marginTop: 12 }}>{g.source.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        {g && (g.embedded.scripts > 0 || g.embedded.executables > 0) && <p className="notice" style={{ marginTop: 12 }}><TriangleAlert size={16} aria-hidden style={{ flex: "none", marginTop: 2 }} /><span>The package embeds {g.embedded.scripts} script(s) and {g.embedded.executables} executable(s). They were listed by name only: never opened, executed or analysed.</span></p>}
        <details className="meta" style={{ marginTop: 12 }}><summary><ShieldCheck size={15} aria-hidden />Analysis sandbox and data handling</summary>
          <dl className="in"><dt>Isolation in effect</dt><dd>Separate process · empty environment · {iso.fsPermissionModel ? "filesystem permission model (reads limited to the analyzer folder, no writes, no child processes)" : <b>filesystem permission model NOT available</b>} · {iso.networkNamespace ? "network namespace (no network interfaces)" : <b>network namespace NOT available (no OS-level network isolation)</b>} · timeout {iso.timeoutMs ? `${iso.timeoutMs / 1000}s` : "n/a"}</dd>
            <dt>What runs</dt><dd>Only the fixed analyzer script. Package content (XAML, DLLs, scripts, executables) is parsed or counted as data and never executed.</dd>
            <dt>What is stored</dt><dd>Derived structural facts only: counts, workflow graph, selector features and fingerprints, bare host names, reference names. Raw selectors, connection strings, paths, email addresses and secret values are never stored.</dd>
            <dt>Raw package</dt><dd>{d.retainedPackage ? `Retained, encrypted at rest (${Math.round(d.retainedPackage.sizeBytes / 1024)} KB)` : "Not retained"}{st.retainRaw ? " (retention is on for this connection)" : ""}</dd></dl></details>
      </section>

      {g && T && a.sourceStatus !== "source_available" && <p className="notice" role="note"><TriangleAlert size={16} aria-hidden style={{ flex: "none", marginTop: 2 }} /><span>No structural facts are shown because no workflow source could be read. Zero counts here would mean &quot;unknown&quot;, not &quot;none&quot;, so they are not displayed.</span></p>}
      {g && T && a.sourceStatus === "source_available" && <>
        <section className="panel panel-pad" aria-labelledby="graph-h"><h2 className="panel-title" id="graph-h"><FileCode2 size={16} aria-hidden />Process logic graph: workflows and invoke relationships</h2>
          <InvokeTree g={g} />
          {g.unreachable.length > 0 && <><h3 style={{ fontSize: 13.5, margin: "16px 0 6px" }}>Not reachable from the entry point (possible dead code)</h3><ul className="gaps">{g.unreachable.map((f) => <li key={f} className="mono">{f}</li>)}</ul></>}
          {g.workflows.some((w) => w.args.length) && <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", color: "var(--accent-ink)" }}>Input/output arguments ({T.args.inbound} in, {T.args.outbound} out)</summary>
            <div className="tablewrap" tabIndex={0} role="region" aria-label="Workflow arguments (scrollable)"><table className="dt" style={{ marginTop: 8 }}><thead><tr><th scope="col">Workflow</th><th scope="col">Argument</th><th scope="col">Direction</th><th scope="col">Type</th></tr></thead><tbody>{g.workflows.flatMap((w) => w.args.map((x) => <tr key={w.file + x.name}><td className="mono">{w.file}</td><td className="mono">{x.name}</td><td>{x.dir}</td><td className="mono">{x.type}</td></tr>))}</tbody></table></div></details>}
        </section>

        <div className="cols-2">
          <section className="panel panel-pad" aria-labelledby="act-h"><h2 className="panel-title" id="act-h">Activities and control flow</h2>
            <div className="qpanel"><dl>
              {([["UI actions", T.byCategory.ui], ["API / HTTP", T.byCategory.api], ["Database", T.byCategory.database], ["File / Excel / PDF", T.byCategory.file], ["Email", T.byCategory.email], ["Queue", T.byCategory.queue], ["Orchestrator assets", T.byCategory.asset], ["Document / OCR", T.byCategory.document], ["Code / script", T.byCategory.code]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl></div>
            <div className="divider" />
            <div className="qpanel"><dl>
              {([["Branches", T.control.branches], ["Loops", T.control.loops], ["Retry scopes", T.control.retries], ["Try / Catch", T.control.tryCatch], ["Continue on error", T.control.continueOnError], ["Business-rule exceptions", T.control.businessRuleExceptions], ["Max nesting", T.control.maxDepth], ["Cyclomatic (extra paths)", T.control.cyclomatic]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl></div>
          </section>
          <section className="panel panel-pad" aria-labelledby="sel-h"><h2 className="panel-title" id="sel-h">UI selectors</h2>
            {T.ui.selectors === 0 ? <p className="muted" style={{ margin: 0 }}>No UI selectors found.</p> : <>
              <p style={{ marginTop: 0 }}><b>{T.ui.fragile}</b> of <b>{T.ui.selectors}</b> selectors are fragile (positional idx, dynamic ids, or no stable attribute). {T.ui.idx} use idx. {T.byCategory.imageBased} image/OCR-based action(s).</p>
              <p className="muted" style={{ margin: "0 0 8px" }}>By technology: {Object.entries(T.ui.byRoot).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
              {T.ui.apps.length > 0 && <p style={{ margin: 0 }}>Target applications: {T.ui.apps.map((x) => <span key={x} className="badge outline mono" style={{ marginRight: 4 }}>{x}</span>)}</p>}</>}
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Raw selector text is not stored; only these derived features and a fingerprint per selector (used for version comparison).</p>
          </section>
          <section className="panel panel-pad" aria-labelledby="int-h"><h2 className="panel-title" id="int-h">Integrations and literals</h2>
            <ul className="gaps"><li>External hosts: {T.integrations.hosts.length ? T.integrations.hosts.map((h) => <span key={h} className="badge outline mono" style={{ marginRight: 4 }}>{h}</span>) : "none found"}</li>
              <li>Database providers: {T.integrations.dbProviders.join(", ") || "none"}</li><li>File types touched: {Object.entries(T.integrations.fileExts).map(([k, v]) => `.${k} ×${v}`).join(", ") || "none"}</li>
              <li>Hard-coded literals (values never stored): {T.integrations.hardcodedSecrets} secret-style, {T.integrations.hardcodedConnectionStrings} connection string, {T.integrations.hardcodedPaths} absolute path, {T.integrations.hardcodedEmails} email address</li></ul>
          </section>
          <section className="panel panel-pad" aria-labelledby="ref-h"><h2 className="panel-title" id="ref-h"><Boxes size={16} aria-hidden />References found in the package</h2>
            <ul className="list">
              {T.references.assets.map((r) => <li key={"a" + r.name}><BasisBadge basis="confirmed_package" /><span>Asset <b>{r.name}</b> <span className="muted">via {r.op} in {r.workflow}</span></span></li>)}
              {T.references.queues.map((r) => <li key={"q" + r.name + r.op}><BasisBadge basis="confirmed_package" /><span>Queue <b>{r.name}</b> <span className="muted">({r.op === "add" ? "adds items" : "reads items"}, {r.workflow})</span></span></li>)}
              {T.references.externalProcesses.map((r) => <li key={"p" + r}><BasisBadge basis="confirmed_package" /><span>Invokes process <b>{r}</b></span></li>)}
              {[...T.references.assetConfigRefs, ...T.references.queueConfigRefs].map((r) => <li key={"c" + r.key + r.op}><BasisBadge basis="inferred" /><span>Name read from <span className="mono">Config(&quot;{r.key}&quot;)</span> at runtime <span className="muted">({r.workflow})</span></span></li>)}
              {T.references.dynamic > 0 && <li><BasisBadge basis="inferred" /><span>{T.references.dynamic} reference(s) built from expressions: not resolvable statically</span></li>}
            </ul>
            {T.references.assets.length + T.references.queues.length + T.references.externalProcesses.length + T.references.assetConfigRefs.length + T.references.queueConfigRefs.length + T.references.dynamic === 0 && <p className="muted" style={{ margin: 0 }}>No asset, queue or process references found.</p>}
          </section>
        </div>

        <section className="panel panel-pad" aria-labelledby="diff-h"><h2 className="panel-title" id="diff-h"><GitCompare size={16} aria-hidden />Version change (volatility evidence)</h2>
          {d.packageDiff?.comparable ? (() => { const x = d.packageDiff!; return <>
            <p style={{ marginTop: 0 }}>v{x.fromVersion} → v{x.toVersion}</p>
            <div className="metrics"><Metric label="Workflows changed" value={`${Math.round(x.changeRatio * 100)}%`} sub={`${x.workflowsChanged.length} changed · ${x.workflowsAdded.length} added · ${x.workflowsRemoved.length} removed`} /><Metric label="Selector churn" value={`${Math.round(x.selectorChurn * 100)}%`} sub={`+${x.selectorsAdded} / −${x.selectorsRemoved}`} /><Metric label="Dependency changes" value={x.dependencyChanges.added.length + x.dependencyChanges.removed.length + x.dependencyChanges.changed.length} sub={x.dependencyChanges.changed.map((c) => `${c.id} ${c.from}→${c.to}`).join("; ") || "none changed"} /></div>
            <ul className="gaps" style={{ marginTop: 12 }}>{[...x.workflowsChanged.map((f) => `Changed: ${f}`), ...x.workflowsAdded.map((f) => `Added: ${f}`), ...x.workflowsRemoved.map((f) => `Removed: ${f}`)].map((l) => <li key={l} className="mono">{l}</li>)}</ul></>; })()
            : <p className="muted" style={{ margin: 0 }}>{d.packageDiff ? `Not comparable: ${d.packageDiff.reasons.join("; ")}.` : (() => { const prev = d.packageHistory.find((h) => !h.isDeployed); return prev ? `The previous version (v${prev.version}) could not be compared: ${PACKAGE_STATUS[prev.status]?.label.toLowerCase() ?? prev.status}${prev.failure ? ` (${PACKAGE_FAILURE[prev.failure]?.toLowerCase() ?? prev.failure})` : ""}.` : "No earlier version is known, so there is nothing to compare."; })()}</p>}
        </section>

        {g.project?.dependencies?.length ? <details className="meta"><summary>Package dependencies from project.json ({g.project.dependencies.length}) · <BasisBadge basis="confirmed_package" /></summary><div style={{ padding: "0 16px 14px" }}><div className="tablewrap" tabIndex={0} role="region" aria-label="Package dependencies (scrollable)"><table className="dt"><thead><tr><th scope="col">Package</th><th scope="col">Version</th></tr></thead><tbody>{g.project.dependencies.map((x) => <tr key={x.id}><td className="mono">{x.id}</td><td className="mono">{x.version}</td></tr>)}</tbody></table></div></div></details> : null}
      </>}
    </div>
  );
}
