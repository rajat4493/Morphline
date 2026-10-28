import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getContext } from "@/lib/server";
import { AI_DRAFT_NOTICE } from "@/plan/export";
import { getPlan } from "@/services/plans";
import { auditTrailFor } from "@/services/queries";

export const dynamic = "force-dynamic";
const L = ({ xs }: { xs: string[] }) => <ul className="plain">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>;

export default async function PlanPage({ params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) notFound();
  const { db, ctx } = await getContext();
  const plan = await getPlan(db, ctx, params.id);
  if (!plan) notFound();
  const c = plan.content;
  const audit = await auditTrailFor(db, ctx, [plan.id, plan.assessmentId]);
  return (
    <>
      <p><Link href={`/processes/${plan.processId}`}>← {c.processName}</Link></p>
      <h1>Migration plan: {c.processName}</h1>
      <p className="sub">{c.recommendationLabel} · confidence {c.confidence}/100 · rules {c.ruleVersion} · generated {new Date(c.generatedAt).toLocaleString()}</p>
      <p><a className="btn" href={`/api/plans/${plan.id}/export?format=md`}>Export Markdown</a> <a className="btn secondary" href={`/api/plans/${plan.id}/export?format=html`}>Export HTML</a></p>
      <div className="notice" role="note"><strong>Logic analysis unavailable.</strong> Based on operational data only; decision logic inside the package has not been analysed.</div>
      {plan.narrative && <section className="card" style={{ marginBottom: 16 }}><h2>Summary (draft)</h2><p className="draft">{AI_DRAFT_NOTICE}</p><p>{plan.narrative}</p></section>}
      <div className="grid g2">
        <section className="card"><h2>Target pattern</h2><p><strong>{c.targetPattern.name}.</strong> {c.targetPattern.description}</p><h3>Retained RPA elements</h3><L xs={c.retainedRpaElements} /></section>
        <section className="card"><h2>Candidate integrations / tools</h2>{c.candidateIntegrations.length ? <L xs={c.candidateIntegrations.map((i) => `${i.name} (${i.kind}): ${i.basis}`)} /> : <p className="muted">None identified from the API data.</p>}</section>
        <section className="card"><h2>Policies and guardrails</h2><L xs={c.policies} /></section>
        <section className="card"><h2>Identity and RBAC</h2><L xs={c.identityAndRbac} /></section>
        <section className="card"><h2>Human approval and escalation</h2><L xs={c.approvalPoints} /></section>
        <section className="card"><h2>Test and validation criteria</h2><L xs={c.validationCriteria} /></section>
      </div>
      <section className="card" style={{ marginTop: 16 }}><h2>Phased implementation backlog</h2>{c.backlog.map((b) => <div key={b.phase}><h3>{b.phase}: {b.goal}</h3><L xs={b.items} /></div>)}</section>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <section className="card"><h2>Assumptions</h2><L xs={c.assumptions} /></section>
        <section className="card"><h2>Unknowns</h2><L xs={c.unknowns} /></section>
      </div>
      <section className="card" style={{ marginTop: 16 }}><h2>Evidence trail</h2><L xs={c.evidence.map((e) => `${e.signal} [${e.ruleId}]: ${e.observed}`)} />
        <h3>Audit record</h3><table><thead><tr><th>When</th><th>Action</th><th>Actor</th></tr></thead><tbody>{audit.map((e) => <tr key={e.id}><td>{e.at.toLocaleString()}</td><td>{e.action}</td><td>{e.actor}</td></tr>)}</tbody></table></section>
    </>
  );
}
