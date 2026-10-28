import { dt, day } from "@/lib/fmt";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getContext } from "@/lib/server";
import { processDetail } from "@/services/queries";
import { ActionButton } from "@/components/Actions";
import { Health, RecBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProcessPage({ params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) notFound();
  const { db, ctx } = await getContext();
  const d = await processDetail(db, ctx, params.id);
  if (!d) notFound();
  const a = d.assessment;
  const fr = d.jobCount ? d.trend.reduce((x, w) => x + w.failed, 0) / d.jobCount : 0;
  const maxW = Math.max(1, ...d.trend.map((w) => w.total));
  return (
    <>
      <p><Link href="/processes">← Estate inventory</Link></p>
      <h1>{d.p.name}</h1>
      <p className="sub">{d.f.path} · package {d.p.packageId} v{d.p.currentVersion} · source id <span className="mono">{d.p.sourceId}</span></p>
      <div className="notice" role="note"><strong>Logic analysis unavailable.</strong> This assessment uses Orchestrator telemetry only. It cannot see the workflow logic, selectors, or which assets the package actually uses.</div>

      {!a ? <div className="card empty">No assessment yet. Run an import.</div> : <>
      <section className="card" aria-labelledby="rec"><h2 id="rec">Recommendation</h2>
        <p><RecBadge rec={a.recommendation} /> {a.redesignReview && <span className="badge b-bad">Redesign / risk review first</span>} · confidence <strong>{a.confidence}/100</strong> · opportunity {a.opportunityScore} · risk {a.riskScore}{a.runnerUp && <> · runner-up <RecBadge rec={a.runnerUp} /></>}</p>
        <p className="muted">Rule set <span className="mono">{a.ruleVersion}</span> · input hash <span className="mono">{a.inputHash}</span> · assessed {dt(a.createdAt)}. Deterministic rules; no AI model classified this process.</p>
        <h3>Why</h3><ul className="plain">{a.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <h3>Suggested next discovery step</h3><p>{a.nextStep}</p>
        <div className="grid g2"><div><h3>Risk flags</h3>{a.riskFlags.length ? <ul className="plain">{a.riskFlags.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="muted">None raised.</p>}</div>
          <div><h3>Information gaps</h3><ul className="plain">{a.missingInformation.map((r) => <li key={r}>{r}</li>)}</ul></div></div>
      </section>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="ev"><h2 id="ev">Evidence ({d.evidence.length})</h2>
        <table><thead><tr><th>Rule</th><th>Signal</th><th>Observed in imported data</th><th>Effect</th><th>Source</th></tr></thead><tbody>
          {d.evidence.map((e) => <tr key={e.id}><td className="mono">{e.ruleId}</td><td>{e.signal}</td><td>{e.observed}</td><td>{e.effect}</td><td className="mono">{e.sourceEntity}</td></tr>)}</tbody></table>
        <p className="muted">Scores by option: {Object.entries(a.scores).map(([k, v]) => `${k} ${v}`).join(" · ")}</p></section>
      </>}

      <div className="grid g2" style={{ marginTop: 16 }}>
        <section className="card" aria-labelledby="runs"><h2 id="runs">Runs and failure trend</h2>
          {d.jobCount === 0 ? <p className="muted">No executions in the 90-day import window.</p> : <>
            <p><Health rate={fr} jobs={d.jobCount} /> {d.jobCount} jobs in window</p>
            <div className="spark" role="img" aria-label={`Weekly job counts, oldest to newest; failures in red. ${d.trend.map((w) => `${w.weeksAgo}w ago: ${w.total} runs, ${w.failed} failed`).join("; ")}`}>
              {[...d.trend].reverse().map((w) => <i key={w.weeksAgo} className={w.failed / Math.max(1, w.total) > 0.25 ? "f" : ""} style={{ height: `${(w.total / maxW) * 100}%` }} title={`${w.weeksAgo}w ago: ${w.total} runs, ${w.failed} failed`} />)}</div>
            <h3>Recent failures</h3>{d.recentFailures.length ? <ul className="plain">{d.recentFailures.map((j, i) => <li key={i}>{day(j.startedAt)} · {j.info || "(no message)"}</li>)}</ul> : <p className="muted">None.</p>}</>}</section>
        <section className="card" aria-labelledby="trg"><h2 id="trg">Triggers & queues</h2>
          {d.triggers.length === 0 ? <p className="muted">No triggers found. How this process starts is unknown.</p> : <ul className="plain">{d.triggers.map((t) => <li key={t.id}>{t.kind === "time" ? <span className="mono">{t.cron}</span> : <>Queue trigger on <strong>{t.queueName}</strong></>} {t.enabled ? <span className="badge b-ok">enabled</span> : <span className="badge b-warn">disabled</span>}</li>)}</ul>}
          {d.queues.map(({ q, sig }) => <div key={q.id}><h3>Queue {q.name}</h3>{sig ? <div>{sig.total} items · {sig.successful} successful · <strong>{sig.businessExceptions}</strong> business exceptions · {sig.applicationExceptions} application exceptions · {sig.abandoned} abandoned{sig.topErrorReasons.length > 0 && <ul className="plain">{sig.topErrorReasons.map((r) => <li key={r.reason}>{r.reason} ({r.count})</li>)}</ul>}</div> : <p className="muted">Queue-item signals unavailable.</p>}</div>)}</section>
        <section className="card" aria-labelledby="dep"><h2 id="dep">Dependencies visible from the API</h2>
          {d.dependencies.length === 0 ? <p className="muted">None found.</p> : <table><thead><tr><th>Kind</th><th>Name</th><th>Basis</th></tr></thead><tbody>{d.dependencies.map((x) => <tr key={x.id}><td>{x.kind}</td><td>{x.name}</td><td>{x.detail}</td></tr>)}</tbody></table>}
          <p className="muted">Asset entries are folder-scope metadata (name/type only). Values are never retrieved.</p></section>
        <section className="card" aria-labelledby="ver"><h2 id="ver">Package versions</h2>
          <ul className="plain">{d.versions.map((v) => <li key={v.id}>{v.version} · published {day(v.publishedAt)}</li>)}</ul></section>
      </div>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="plan"><h2 id="plan">Migration plan</h2>
        {d.plans.length > 0 && <ul className="plain">{d.plans.map((p) => <li key={p.id}><Link href={`/plans/${p.id}`}>Plan generated {dt(p.createdAt)}</Link>{p.narrativeIsAiDraft && <> <span className="badge b-warn">includes AI draft</span></>}</li>)}</ul>}
        {a && <ActionButton url={`/api/processes/${d.p.id}/plan`} label={d.plans.length ? "Generate a new plan" : "Generate migration plan"} busy="Generating…" redirectTo="/plans/{planId}" />}</section>
    </>
  );
}
