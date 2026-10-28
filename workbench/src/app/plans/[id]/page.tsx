import { Download, FileCode2 } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CoverageNotice, PageHeader, StatusBadge } from "@/components/ds";
import { pretty } from "@/components/ds/meta";
import { GuardrailPanels, StageTimeline } from "@/components/process/sections";
import { dt } from "@/lib/fmt";
import { getContext } from "@/lib/server";
import { AI_DRAFT_NOTICE } from "@/plan/export";
import { getPlan } from "@/services/plans";
import { auditTrailFor } from "@/services/queries";

export const dynamic = "force-dynamic";
const L = ({ xs }: { xs: string[] }) => <ul className="gaps">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>;

export default async function PlanPage({ params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) notFound();
  const { db, ctx } = await getContext();
  const plan = await getPlan(db, ctx, params.id);
  if (!plan) notFound();
  const c = plan.content;
  const audit = await auditTrailFor(db, ctx, [plan.id, plan.assessmentId]);
  return (
    <>
      <PageHeader small crumbs={[{ label: "Estate inventory", href: "/processes" }, { label: pretty(c.processName), href: `/processes/${plan.processId}#tab-plan` }, { label: "Migration plan" }]}
        title={`Migration plan: ${pretty(c.processName)}`}
        meta={<><StatusBadge tone="blue">{c.recommendationLabel}</StatusBadge><span>Confidence {c.confidence}/100</span><span>{c.ruleVersion}</span><span>Generated {dt(new Date(c.generatedAt))}</span><StatusBadge tone="neutral">Draft for review</StatusBadge></>}
        actions={<><a className="btn secondary" href={`/api/plans/${plan.id}/export?format=md`}><Download size={16} aria-hidden />Markdown</a><a className="btn secondary" href={`/api/plans/${plan.id}/export?format=html`}><FileCode2 size={16} aria-hidden />HTML</a></>} />
      <div className="stack-l">
        <CoverageNotice level={c.logicAnalysis} note={c.unknowns[0]} />
        {plan.narrative && <section className="panel panel-pad"><h2 className="panel-title">Summary (draft)</h2><p className="draft">{AI_DRAFT_NOTICE}</p><p style={{ marginBottom: 0 }}>{plan.narrative}</p></section>}
        <div className="cols-2">
          <section className="panel panel-pad"><h2 className="panel-title">Target pattern</h2><p style={{ marginTop: 0 }}><b>{c.targetPattern.name}.</b> {c.targetPattern.description}</p><h3 className="panel-title" style={{ fontSize: 13.5 }}>Retained RPA elements</h3><L xs={c.retainedRpaElements} /></section>
          <section className="panel panel-pad"><h2 className="panel-title">Candidate integrations / tools</h2>{c.candidateIntegrations.length ? <L xs={c.candidateIntegrations.map((i) => `${i.name} (${i.kind}): ${i.basis}`)} /> : <p className="muted" style={{ margin: 0 }}>None identified from the API data.</p>}</section>
        </div>
        <section aria-labelledby="stg"><h2 className="panel-title" id="stg">Phased implementation backlog</h2><StageTimeline plan={c} /></section>
        <GuardrailPanels plan={c} />
        <div className="cols-2">
          <section className="panel panel-pad"><h2 className="panel-title">Human approval and escalation</h2><L xs={c.approvalPoints} /></section>
          <section className="panel panel-pad"><h2 className="panel-title">Identity and RBAC</h2><L xs={c.identityAndRbac} /></section>
          <section className="panel panel-pad"><h2 className="panel-title">Assumptions</h2><L xs={c.assumptions} /></section>
          <section className="panel panel-pad"><h2 className="panel-title">Unknowns</h2><L xs={c.unknowns} /></section>
        </div>
        <details className="meta"><summary>Evidence trail and audit record</summary><div style={{ padding: "0 16px 16px" }}><L xs={c.evidence.map((e) => `${e.signal} [${e.ruleId}]: ${e.observed}`)} />
          <table className="dt" style={{ marginTop: 12 }}><thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Actor</th></tr></thead><tbody>{audit.map((e) => <tr key={e.id}><td>{dt(e.at)}</td><td>{e.action}</td><td>{e.actor}</td></tr>)}</tbody></table></div></details>
      </div>
    </>
  );
}
