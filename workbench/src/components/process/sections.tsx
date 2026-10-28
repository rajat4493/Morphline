import { Activity, AlertTriangle, Boxes, CalendarClock, CheckCircle2, CircleDot, ClipboardCheck, Database, FlaskConical, GitCommitHorizontal, Inbox, KeyRound, ListChecks, PencilRuler, Rocket, Search, ShieldAlert, ShieldCheck, Workflow } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ActionButton } from "@/components/Actions";
import { CoverageNotice, EmptyState, EvidenceItem, Metric, RevealName, RiskPanel, StatusBadge } from "@/components/ds";
import { SOURCE_LABEL, strengthOf } from "@/components/ds/meta";
import { CATEGORY_INFO, type ExceptionCategory } from "@/ai/taxonomy";
import { redact } from "@/ai/redact";
import { day, dt } from "@/lib/fmt";
import type { PlanContent } from "@/plan/generate";
import type { processDetail } from "@/services/queries";

export type Detail = NonNullable<Awaited<ReturnType<typeof processDetail>>>;
const SRC_ICON: Record<string, ReactNode> = {
  queue_signals: <Inbox size={18} aria-hidden />, execution_jobs: <Activity size={18} aria-hidden />, triggers: <CalendarClock size={18} aria-hidden />,
  process_versions: <GitCommitHorizontal size={18} aria-hidden />, asset_metadata: <KeyRound size={18} aria-hidden />, automation_processes: <Boxes size={18} aria-hidden />,
};
const HIGH_FLAGS = new Set(["HIGH_FAILURE_RATE", "VOLATILE_UI"]);

/* ---------------- Assessment ---------------- */
export function AssessmentTab({ d }: { d: Detail }) {
  const a = d.assessment!;
  const drivers = [...d.evidence].filter((e) => e.ruleId !== "R03-baseline" && e.weight >= 1).sort((x, y) => y.weight - x.weight).slice(0, 3);
  const gaps = a.missingInformation.slice(1); // first entry is the coverage limitation, shown in the callout
  return (
    <div className="stack-l">
      <CoverageNotice><p className="muted" style={{ color: "#5c3a0c" }}>Next step: upload the project package/XAML (planned) to analyse decision points, selectors and integrations.</p></CoverageNotice>
      <div className="cols">
        <section aria-labelledby="why-h" className="stack">
          <h2 className="panel-title" id="why-h" style={{ marginBottom: 0 }}>Why this recommendation</h2>
          {drivers.length === 0 ? <div className="insight"><span className="insight-ico"><CircleDot size={18} aria-hidden /></span><div><h4>No strong signals</h4><p>{a.rationale[0]}</p></div></div> :
            drivers.map((e) => { const s = strengthOf(e); return (
              <article className="insight" key={e.id}>
                <span className="insight-ico">{SRC_ICON[e.sourceEntity] ?? <CircleDot size={18} aria-hidden />}</span>
                <div><h4>{e.signal}<StatusBadge tone="blue">{s.label}</StatusBadge>{e.provenance === "ai_inferred" && <StatusBadge tone="amber">AI-inferred</StatusBadge>}</h4><p>{e.observed}.</p><p style={{ color: "var(--text-3)" }}>{e.effect}</p><span className="src">Source: {SOURCE_LABEL[e.sourceEntity] ?? e.sourceEntity} · {e.ruleId}</span></div>
              </article>); })}
          {a.redesignReview && <article className="insight"><span className="insight-ico" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}><AlertTriangle size={18} aria-hidden /></span><div><h4>Stabilise before migrating</h4><p>Risk signals indicate a redesign or risk review should come first. The recommendation shows the direction once the process is stable; it is not an instruction to add AI.</p></div></article>}
          <section className="panel panel-pad" aria-labelledby="next-h"><h3 className="panel-title" id="next-h"><Search size={16} aria-hidden />Suggested next discovery step</h3><p style={{ margin: 0 }}>{a.nextStep}</p></section>
        </section>
        <div className="stack">
          <RiskPanel title="Risk flags" icon={<ShieldAlert size={16} aria-hidden />}>
            {a.riskFlags.length === 0 ? <p className="muted" style={{ margin: 0 }}><CheckCircle2 size={14} className="icon" aria-hidden /> None raised from the imported data.</p> :
              a.riskFlags.map((f) => { const [code, ...rest] = f.split(": "); return <div key={f} className={`flag${HIGH_FLAGS.has(code) ? " high" : ""}`}><AlertTriangle size={16} aria-hidden style={{ marginTop: 2, flex: "none" }} /><div>{rest.join(": ")}<code>{code}</code></div></div>; })}
          </RiskPanel>
          <RiskPanel title="Information gaps" icon={<Search size={16} aria-hidden />}>
            <ul className="gaps">{gaps.slice(0, 3).map((g) => <li key={g}>{g}</li>)}</ul>
            {gaps.length > 3 && <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer", color: "var(--accent-ink)" }}>{gaps.length - 3} more</summary><ul className="gaps" style={{ marginTop: 6 }}>{gaps.slice(3).map((g) => <li key={g}>{g}</li>)}</ul></details>}
          </RiskPanel>
        </div>
      </div>
      <details className="meta">
        <summary><Database size={15} aria-hidden />Assessment metadata (for audit)</summary>
        <dl className="in">
          <dt>Rule set</dt><dd className="mono">{a.ruleVersion}</dd><dt>Input hash</dt><dd className="mono">{a.inputHash}</dd><dt>Assessed</dt><dd>{dt(a.createdAt)}</dd>
          <dt>Method</dt><dd>Deterministic rules over imported data. No AI model classified this process.</dd><dt>Package logic analysis</dt><dd>{a.logicAnalysis}</dd>
          <dt>Source name</dt><dd className="mono">{d.p.name}</dd><dt>Package</dt><dd className="mono">{d.p.packageId} v{d.p.currentVersion}</dd><dt>Source ID</dt><dd className="mono">{d.p.sourceId}</dd>
          <dt>Score by option</dt><dd className="mono">{Object.entries(a.scores).map(([k, v]) => `${k} ${v}`).join(" · ")}</dd>
        </dl>
      </details>
    </div>
  );
}

/* ---------------- Evidence ---------------- */
export function EvidenceTab({ d }: { d: Detail }) {
  const sorted = [...d.evidence].sort((x, y) => y.weight - x.weight);
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>Each row is a rule finding. Rows marked AI-inferred depend on model-labelled exception text and carry lower trust. Open a row for the exact observed values, references and source texts.</p>
      {sorted.length === 0 ? <EmptyState icon={<ListChecks size={22} />} title="No evidence recorded">Run an import to produce an assessment.</EmptyState> : sorted.map((e) => <EvidenceItem key={e.id} ev={e} />)}
    </div>
  );
}

/* ---------------- Operations ---------------- */
function WeeklyChart({ trend }: { trend: Detail["trend"] }) {
  const W = 13, byWeek = new Map(trend.map((t) => [t.weeksAgo, t]));
  const pts = Array.from({ length: W }, (_, i) => { const t = byWeek.get(W - 1 - i); return { weeksAgo: W - 1 - i, total: t?.total ?? 0, failed: t?.failed ?? 0 }; });
  const maxTotal = Math.max(1, ...pts.map((p) => p.total)), maxRate = Math.max(0.1, ...pts.map((p) => (p.total ? p.failed / p.total : 0)));
  const w = 640, h = 180, l = 40, r = 12, t = 12, b = 26, iw = w - l - r, ih = h - t - b, step = iw / W;
  const x = (i: number) => l + step * i + step / 2, yRate = (v: number) => t + ih - (v / maxRate) * ih;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yRate(p.total ? p.failed / p.total : 0).toFixed(1)}`).join(" ");
  const summary = `Weekly failure rate over 13 weeks, peak ${(Math.max(...pts.map((p) => (p.total ? p.failed / p.total : 0))) * 100).toFixed(0)} percent.`;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={summary}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={l} x2={w - r} y1={t + ih * (1 - f)} y2={t + ih * (1 - f)} stroke="#e5e7eb" /><text x={l - 6} y={t + ih * (1 - f) + 4} textAnchor="end">{Math.round(maxRate * f * 100)}%</text></g>)}
        {pts.map((p, i) => <rect key={i} x={x(i) - step * 0.3} width={step * 0.6} y={t + ih - (p.total / maxTotal) * ih * 0.45} height={(p.total / maxTotal) * ih * 0.45} fill="#dfe6f6" rx="2" />)}
        <path d={line} fill="none" stroke="#c9453f" strokeWidth="2.2" strokeLinejoin="round" />
        {pts.map((p, i) => <circle key={i} cx={x(i)} cy={yRate(p.total ? p.failed / p.total : 0)} r="3" fill="#fff" stroke="#c9453f" strokeWidth="1.8" />)}
        {[0, 6, 12].map((i) => <text key={i} x={x(i)} y={h - 6} textAnchor="middle">{pts[i].weeksAgo === 0 ? "this week" : `${pts[i].weeksAgo}w ago`}</text>)}
      </svg>
      <div className="legend"><span><i style={{ background: "#c9453f" }} />Weekly failure rate</span><span><i style={{ background: "#dfe6f6", height: 8 }} />Weekly executions (max {maxTotal})</span></div>
      <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer", color: "var(--accent-ink)" }}>View weekly data</summary>
        <table className="dt" style={{ marginTop: 8 }}><thead><tr><th scope="col">Week</th><th scope="col" className="num">Executions</th><th scope="col" className="num">Failed</th></tr></thead><tbody>{[...pts].reverse().map((p) => <tr key={p.weeksAgo}><td>{p.weeksAgo === 0 ? "This week" : `${p.weeksAgo} weeks ago`}</td><td className="num">{p.total}</td><td className="num">{p.failed}</td></tr>)}</tbody></table></details>
    </figure>
  );
}

export function OperationsTab({ d }: { d: Detail }) {
  const failed = d.trend.reduce((x, w) => x + w.failed, 0);
  const rate = d.jobCount ? failed / d.jobCount : 0;
  const q = d.queues.find((x) => x.sig)?.sig;
  const aiLabels = new Map<string, string>(((d.evidence.find((e) => e.ruleId === "R15-ai-exception-mix")?.detail as { text: string; label: string }[] | undefined) ?? []).map((i) => [i.text, i.label]));
  return (
    <div className="stack-l">
      <section className="panel panel-pad" aria-label="Operational key figures"><div className="metrics">
        <Metric label="Executions" value={d.jobCount.toLocaleString("en-US")} sub="90-day window" />
        <Metric label="Failure rate" value={d.jobCount ? `${(rate * 100).toFixed(0)}%` : "n/a"} sub={`${failed} failed executions`} tipId="tip-fr" tip="Faulted jobs divided by all jobs in the 90-day import window." />
        {q ? <><Metric label="Business exceptions" value={q.businessExceptions} sub={`of ${q.total} queue items`} tipId="tip-be" tip="Queue items that ended in a business exception: cases the rules could not handle." /><Metric label="Application exceptions" value={q.applicationExceptions} sub="system-side failures" /></> : <><Metric label="Triggers" value={d.triggers.length} sub={d.triggers.length ? "configured" : "none found"} /><Metric label="Queue signals" value="n/a" sub="no queue linked" /></>}
      </div></section>
      <div className="cols">
        <section className="panel panel-pad" aria-labelledby="trend-h"><h2 className="panel-title" id="trend-h">Failure trend, last 90 days</h2>{d.jobCount === 0 ? <p className="muted">No executions in the 90-day import window.</p> : <WeeklyChart trend={d.trend} />}</section>
        <section className="panel panel-pad" aria-labelledby="fail-h"><h2 className="panel-title" id="fail-h">Recent failures</h2>
          {d.recentFailures.length === 0 ? <p className="muted" style={{ margin: 0 }}><CheckCircle2 size={14} className="icon" aria-hidden /> No failures in the window.</p> : <><ol className="timeline">{d.recentFailures.map((j, i) => <li key={i}><time dateTime={j.startedAt?.toISOString()}>{day(j.startedAt)}</time>{j.info || "No error message recorded"}</li>)}</ol>{failed > d.recentFailures.length && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Showing latest {d.recentFailures.length} of {failed}.</p>}</>}</section>
      </div>
      <div className="cols-2">
        <section className="panel panel-pad" aria-labelledby="trg-h"><h2 className="panel-title" id="trg-h"><CalendarClock size={16} aria-hidden />Triggers</h2>
          {d.triggers.length === 0 ? <p className="muted" style={{ margin: 0 }}>No triggers found. How this process starts is unknown.</p> : <ul className="list">{d.triggers.map((t) => <li key={t.id}><span>{t.kind === "time" ? <><span className="mono">{t.cron}</span> <span className="muted">time schedule</span></> : <>Queue trigger on <b>{t.queueName}</b></>}</span><StatusBadge tone={t.enabled ? "sage" : "amber"}>{t.enabled ? "Enabled" : "Disabled"}</StatusBadge></li>)}</ul>}</section>
        <section className="panel panel-pad qpanel" aria-labelledby="q-h"><h2 className="panel-title" id="q-h"><Inbox size={16} aria-hidden />Queue</h2>
          {d.queues.length === 0 ? <p className="muted" style={{ margin: 0 }}>No queue is linked to this process.</p> : d.queues.map(({ q: qu, sig }) => (
            <div key={qu.id}><p style={{ marginTop: 0 }}><b>{qu.name}</b></p>{!sig ? <p className="muted">Queue-item signals unavailable (check permissions).</p> : <>
              <dl><div><dt>Items</dt><dd>{sig.total}</dd></div><div><dt>Successful</dt><dd>{sig.successful}</dd></div><div><dt>Business exceptions</dt><dd>{sig.businessExceptions}</dd></div><div><dt>Application exceptions</dt><dd>{sig.applicationExceptions}</dd></div><div><dt>Abandoned</dt><dd>{sig.abandoned}</dd></div><div><dt>Retried</dt><dd>{sig.retried}</dd></div></dl>
              {sig.topErrorReasons.length > 0 && <><h3 style={{ fontSize: 13.5, margin: "16px 0 8px" }}>Top exception reasons</h3><div className="bars">{sig.topErrorReasons.map((r) => <div className="bar-row" key={r.reason}><div>{r.reason}{aiLabels.has(redact(r.reason)) && <> <StatusBadge tone="amber">AI: {CATEGORY_INFO[aiLabels.get(redact(r.reason)) as ExceptionCategory]?.label ?? aiLabels.get(redact(r.reason))}</StatusBadge></>}<div className="bar-track"><div className="bar-fill" style={{ width: `${(r.count / sig.topErrorReasons[0].count) * 100}%` }} /></div></div><b className="num">{r.count}</b></div>)}</div></>}</>}</div>))}</section>
      </div>
    </div>
  );
}

/* ---------------- Dependencies ---------------- */
const CRED = new Set(["credential", "secret", "windowscredential"]);
export function DependenciesTab({ d }: { d: Detail }) {
  const queues = d.dependencies.filter((x) => x.kind === "queue");
  const shared = d.dependencies.filter((x) => x.origin === "shared_package");
  return (
    <div className="stack-l">
      <p className="muted" style={{ margin: 0 }}>Relationships visible from Orchestrator data. <b>Confirmed</b> links come from triggers, queues or shared packages. <b>Unconfirmed</b> items are folder-scoped metadata: the API does not say whether this process uses them.</p>
      <div className="dep-graph">
        <div className="dep-col"><div className="dep-node root"><span className="dep-ico"><Workflow size={18} aria-hidden /></span><div><b>{d.p.name.replace(/_/g, " ")}</b><span className="muted">{d.f.path}</span></div></div></div>
        <div className="dep-link" aria-hidden><svg width="48" height="24" viewBox="0 0 48 24"><path d="M0 12h42m-8-7 8 7-8 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        <div className="dep-col">
          <h3 className="eyebrow"><ShieldCheck size={14} aria-hidden />Confirmed from API data</h3>
          {d.triggers.map((t) => <div className="dep-node" key={t.id}><span className="dep-ico"><CalendarClock size={18} aria-hidden /></span><div><b>{t.kind === "time" ? `Schedule ${t.cron}` : `Queue trigger: ${t.queueName}`}</b><span className="muted">{t.enabled ? "Enabled" : "Disabled"} trigger</span></div></div>)}
          {queues.map((q) => <div className="dep-node" key={q.id}><span className="dep-ico"><Inbox size={18} aria-hidden /></span><div><b>Queue {q.name}</b><span className="muted">{q.detail}</span></div></div>)}
          {shared.map((s) => <div className="dep-node" key={s.id}><span className="dep-ico"><Boxes size={18} aria-hidden /></span><div><b>{s.name.replace(/_/g, " ")}</b><span className="muted">{s.detail} (duplicate deployment)</span></div></div>)}
          {d.triggers.length + queues.length + shared.length === 0 && <p className="muted" style={{ margin: 0 }}>No confirmed dependencies found.</p>}
          <h3 className="eyebrow" style={{ marginTop: 8 }}><KeyRound size={14} aria-hidden />Folder-scoped metadata · association unconfirmed</h3>
          {d.assets.length === 0 ? <p className="muted" style={{ margin: 0 }}>No assets in this folder.</p> : d.assets.map((a) => { const cred = CRED.has(a.valueType.toLowerCase()); return (
            <div className="dep-node unconfirmed" key={a.id}><span className="dep-ico"><KeyRound size={18} aria-hidden /></span><div>{cred ? <RevealName name={a.name} /> : <b>{a.name}</b>}<span className="muted" style={{ display: "block" }}>{a.valueType}{a.valueScope ? ` · ${a.valueScope}` : ""} {cred && <StatusBadge tone="amber">Credential</StatusBadge>}</span></div></div>); })}
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Asset values are never retrieved or stored. Credential-type names are masked until revealed.</p>
        </div>
      </div>
      <details className="meta"><summary>Package versions ({d.versions.length})</summary><div style={{ padding: "0 16px 14px" }}><ul className="gaps">{d.versions.map((v) => <li key={v.id}>{v.version} · published {day(v.publishedAt)}</li>)}</ul></div></details>
    </div>
  );
}

/* ---------------- Migration plan ---------------- */
const STAGE_ICON: [RegExp, ReactNode][] = [[/discover|confirm|baseline/i, <Search size={18} key="s" aria-hidden />], [/design|redesign/i, <PencilRuler size={18} key="p" aria-hidden />], [/pilot|shadow|disable/i, <FlaskConical size={18} key="f" aria-hidden />], [/rollout|roll out|operate|remove|expand/i, <Rocket size={18} key="r" aria-hidden />]];
export function StageTimeline({ plan }: { plan: PlanContent }) {
  return <ol className="stages">{plan.backlog.map((b) => <li className="stage" key={b.phase}><span className="stage-ico">{STAGE_ICON.find(([re]) => re.test(b.phase))?.[1] ?? <CircleDot size={18} aria-hidden />}</span><div className="stage-body"><h4>{b.phase}</h4><p className="stage-goal">{b.goal}</p><ul className="gaps">{b.items.map((i) => <li key={i}>{i}</li>)}</ul></div></li>)}</ol>;
}
export function GuardrailPanels({ plan }: { plan: PlanContent }) {
  return (
    <div className="cols-2">
      <section className="panel panel-pad"><h3 className="panel-title"><ShieldCheck size={16} aria-hidden />Guardrails</h3><ul className="gaps">{[...plan.policies, ...plan.identityAndRbac, ...plan.approvalPoints].map((x) => <li key={x}>{x}</li>)}</ul></section>
      <section className="panel panel-pad"><h3 className="panel-title"><ClipboardCheck size={16} aria-hidden />Acceptance criteria</h3><ul className="gaps">{plan.validationCriteria.map((x) => <li key={x}>{x}</li>)}</ul></section>
    </div>
  );
}

export function PlanTab({ d }: { d: Detail }) {
  const latest = d.plans[0];
  if (!latest) return <EmptyState icon={<ListChecks size={22} />} title="No migration plan yet" action={<ActionButton url={`/api/processes/${d.p.id}/plan`} label="Generate migration plan" busy="Generating…" variant="primary" redirectTo="/plans/{planId}" />}>A plan is generated from this assessment&apos;s stored evidence. It is draft material for human review.</EmptyState>;
  const plan = latest.content as PlanContent;
  return (
    <div className="stack-l">
      <section className="panel panel-pad" style={{ display: "flex", gap: 16, justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
        <div><div className="eyebrow">Latest plan</div><p style={{ margin: "4px 0 0" }}><b>Version {d.plans.length}</b> · generated {dt(latest.createdAt)} · {plan.ruleVersion}</p>
          <p style={{ margin: "6px 0 0", display: "flex", gap: 8, flexWrap: "wrap" }}><StatusBadge tone="neutral">Draft for review</StatusBadge>{latest.narrativeIsAiDraft && <StatusBadge tone="amber">Includes AI-generated draft summary</StatusBadge>}<StatusBadge tone="outline">{plan.targetPattern.name}</StatusBadge></p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link className="btn secondary" href={`/plans/${latest.id}`}>Open full plan</Link><ActionButton url={`/api/processes/${d.p.id}/plan`} label="Generate a new plan" busy="Generating…" variant="secondary" redirectTo="/plans/{planId}" /></div>
      </section>
      <section aria-labelledby="stg-h"><h2 className="panel-title" id="stg-h">Implementation stages</h2><StageTimeline plan={plan} /></section>
      <GuardrailPanels plan={plan} />
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Guardrails and acceptance criteria apply to the plan as a whole; the current plan model does not define them per stage.</p>
    </div>
  );
}
