import { AlertTriangle, ChevronDown, ChevronRight, CircleHelp, FileText, Info, Inbox } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Recommendation } from "@/assessment/types";
import { Mark, MobileNav, ReadOnlyStatus, SidebarNav } from "./client";
import { REC_META, SOURCE_LABEL, strengthOf } from "./meta";

export { REC_META } from "./meta";
export { Tabs, CopyLink, RevealName } from "./client";

/* ---------- Shell ---------- */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="sidebar" aria-label="Sidebar">
        <Link href="/" className="brand"><span className="brand-mark"><Mark /></span>Morphline</Link>
        <SidebarNav />
        <div className="nav-sep" role="separator" />
        <div className="sidebar-spacer" />
        <ReadOnlyStatus />
        <div className="workspace"><span className="avatar" aria-hidden>D</span><div><b>Demo workspace</b><span>demo-user</span></div></div>
      </aside>
      <div className="content"><MobileNav /><main id="main" className="page">{children}</main></div>
    </div>
  );
}

export function PageHeader({ crumbs, title, meta, actions, small }: { crumbs?: { label: string; href?: string }[]; title: string; meta?: ReactNode; actions?: ReactNode; small?: boolean }) {
  return (
    <header>
      {crumbs && <nav aria-label="Breadcrumb" className="crumbs">{crumbs.map((c, i) => <span key={i} style={{ display: "contents" }}>{i > 0 && <ChevronRight size={14} aria-hidden />}{c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</span>)}</nav>}
      <div className="page-head">
        <div style={{ minWidth: 0 }}><h1 className={`page-title${small ? " sm" : ""}`}>{title}</h1>{meta && <div className="page-meta">{meta}</div>}</div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

/* ---------- Atoms ---------- */
export const StatusBadge = ({ tone = "neutral", icon, children, lg }: { tone?: "neutral" | "blue" | "teal" | "sage" | "amber" | "red" | "outline"; icon?: ReactNode; children: ReactNode; lg?: boolean }) => <span className={`badge ${tone}${lg ? " lg" : ""}`}>{icon}{children}</span>;

export function RecBadge({ rec, lg }: { rec: string; lg?: boolean }) {
  const m = REC_META[rec as Recommendation];
  if (!m) return <StatusBadge>{rec}</StatusBadge>;
  const I = m.icon;
  return <StatusBadge tone={m.tone} lg={lg} icon={<I size={lg ? 15 : 13} aria-hidden />}>{m.label}</StatusBadge>;
}

export function InfoTip({ id, label, children, below, right }: { id: string; label: string; children: ReactNode; below?: boolean; right?: boolean }) {
  return <span className={`tip${below ? " below" : ""}${right ? " right" : ""}`}><button type="button" className="tip-btn" aria-label={`About ${label}`} aria-describedby={id}><CircleHelp size={15} aria-hidden /></button><span role="tooltip" id={id} className="tip-body">{children}</span></span>;
}

export function Metric({ label, value, sub, tip, tipId, tipRight }: { label: string; value: ReactNode; sub?: ReactNode; tip?: ReactNode; tipId?: string; tipRight?: boolean }) {
  return <div className="metric"><div className="metric-label">{label}{tip && tipId && <InfoTip id={tipId} label={label} right={tipRight}>{tip}</InfoTip>}</div><div className="metric-value">{value}</div>{sub && <div className="metric-sub">{sub}</div>}</div>;
}

export function ConfidenceRing({ value }: { value: number }) {
  const r = 44, c = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={`Confidence ${value} out of 100`}>
      <svg width="104" height="104" viewBox="0 0 104 104"><circle cx="52" cy="52" r={r} fill="none" stroke="var(--slate-soft)" strokeWidth="9" /><circle cx="52" cy="52" r={r} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} /></svg>
      <div className="ring-label"><b>{value}%</b><small>confidence</small></div>
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  return <span className="conf" title={`Confidence ${value} of 100 (capped at 85 without package analysis)`}><span className="conf-track" aria-hidden><span className="conf-fill" style={{ width: `${value}%`, display: "block" }} /></span>{value}%</span>;
}

export function Health({ color, label }: { rate?: number; jobs?: number; color: string; label: string }) {
  return <span className="health"><i style={{ background: color }} aria-hidden />{label}</span>;
}

/* ---------- Decision panel ---------- */
export function DecisionPanel(p: { rec: string; confidence: number; opportunity: number; risk: number; evidenceCount: number; conclusion: string; runnerUp?: string | null; redesign?: boolean }) {
  const m = REC_META[p.rec as Recommendation];
  const I = m.icon;
  return (
    <section className={`panel decision tone-${p.rec}`} aria-labelledby="decision-h">
      <ConfidenceRing value={p.confidence} />
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow" id="decision-h"><I size={14} aria-hidden />Evidence-backed assessment <InfoTip id="tip-conf" label="confidence" below>How strongly the imported data supports this recommendation. Capped at 85 because the package&apos;s workflow logic has not been analysed.</InfoTip></div>
        <div className="decision-rec">{m.label}</div>
        <p className="decision-line">{p.conclusion}</p>
        <div className="decision-sub">
          {p.redesign && <StatusBadge tone="amber" icon={<AlertTriangle size={13} aria-hidden />}>Redesign review first</StatusBadge>}
          {p.runnerUp && <span>Runner-up: <RecBadge rec={p.runnerUp} /></span>}
          <a href="#tab-assessment">View rationale</a>
        </div>
      </div>
      <div className="decision-metrics">
        <Metric label="Opportunity" value={p.opportunity} tipRight tipId="tip-opp" tip="Heuristic: strength of AI/judgment signals plus run volume. An ordering aid, not a business-value estimate." />
        <Metric label="Risk" value={p.risk} tipRight tipId="tip-risk" tip="Sum of risk signals found in the data (failure rate, volatile UI, version churn, credential scope). 0–100." />
        <Metric label="Evidence" value={p.evidenceCount} sub="signals" tipRight tipId="tip-ev" tip="Number of rule findings stored for this assessment, including the baseline prior." />
      </div>
    </section>
  );
}

/* ---------- Evidence / risk / coverage ---------- */
export function EvidenceItem({ ev }: { ev: { id: string; ruleId: string; signal: string; observed: string; effect: string; weight: number; sourceEntity: string; sourceRefs: string[] } }) {
  const s = strengthOf(ev);
  return (
    <details className="ev">
      <summary>
        <span className="mono badge outline">{ev.ruleId}</span>
        <span className="ev-signal">{ev.signal}<span className="src"><FileText size={12} aria-hidden />{SOURCE_LABEL[ev.sourceEntity] ?? ev.sourceEntity}</span></span>
        <span className="ev-outcome">{ev.effect}</span>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="strength" role="img" aria-label={`Strength: ${s.label}`} title={`Strength: ${s.label}`}>{[1, 2, 3].map((n) => <i key={n} className={s.level >= n ? "on" : ""} />)}</span>
          <span className="badge neutral">{s.label}</span><ChevronRight className="chev" size={16} aria-hidden />
        </span>
      </summary>
      <div className="ev-detail"><dl>
        <dt>Observed in data</dt><dd>{ev.observed}</dd><dt>Effect</dt><dd>{ev.effect}</dd><dt>Source</dt><dd>{SOURCE_LABEL[ev.sourceEntity] ?? ev.sourceEntity} <span className="mono muted">({ev.sourceEntity})</span></dd>
        <dt>References</dt><dd className="mono">{ev.sourceRefs.join(", ") || "none"}</dd><dt>Stored weight</dt><dd className="mono">{ev.weight}</dd><dt>Rule</dt><dd className="mono">{ev.ruleId}</dd>
      </dl></div>
    </details>
  );
}

export function RiskPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="panel riskpanel"><h3>{icon}{title}</h3>{children}</section>;
}

export function CoverageNotice({ children }: { children?: ReactNode }) {
  return (
    <details className="coverage">
      <summary><Info size={17} aria-hidden /><span>Coverage limitation: workflow package analysis would improve recommendation confidence</span><ChevronDown className="chev" size={16} aria-hidden /></summary>
      <div className="body">
        <p>Orchestrator APIs describe how a process runs (volume, failures, triggers, queues), not what its workflow does. Decision logic, selectors and the assets a package actually uses are not visible, so confidence is capped at 85.</p>
        {children}
      </div>
    </details>
  );
}

/* ---------- Table / empty / skeleton ---------- */
export type Column<T> = { header: string; cell: (r: T) => ReactNode; num?: boolean };
export function DataTable<T>({ caption, rows, columns, rowKey, card }: { caption: string; rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; card: (r: T) => ReactNode }) {
  return (
    <>
      <div className="panel tablewrap desk"><table className="dt"><caption>{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c.header} scope="col" className={c.num ? "num" : undefined}>{c.header}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={rowKey(r)}>{columns.map((c) => <td key={c.header} className={c.num ? "num" : undefined}>{c.cell(r)}</td>)}</tr>)}</tbody></table></div>
      <div className="pcards" aria-label={caption}>{rows.map((r) => <div key={rowKey(r)}>{card(r)}</div>)}</div>
    </>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="panel empty"><span className="empty-ico" aria-hidden>{icon ?? <Inbox size={22} />}</span><h2>{title}</h2>{children && <p>{children}</p>}{action && <div style={{ marginTop: 12 }}>{action}</div>}</div>;
}

export const Skeleton = ({ w = "100%", h = 16, style }: { w?: string | number; h?: number; style?: React.CSSProperties }) => <div className="skel" style={{ width: w, height: h, ...style }} aria-hidden />;
export function PageSkeleton() {
  return <div role="status" aria-label="Loading"><Skeleton w={160} h={14} /><Skeleton w="45%" h={34} style={{ margin: "16px 0 28px" }} /><Skeleton h={150} style={{ borderRadius: 12 }} /><div className="cols-2" style={{ marginTop: 24 }}><Skeleton h={180} style={{ borderRadius: 12 }} /><Skeleton h={180} style={{ borderRadius: 12 }} /></div><span className="sr-only">Loading…</span></div>;
}
