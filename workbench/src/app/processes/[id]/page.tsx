import { Download, FileText, GitCommitHorizontal, Inbox, ListChecks, Network, ShieldCheck, Activity, Package } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionButton } from "@/components/Actions";
import { CopyLink, DecisionPanel, EmptyState, PageHeader, REC_META, StatusBadge, Tabs } from "@/components/ds";
import { folderCrumb, pretty } from "@/components/ds/meta";
import { AssessmentTab, DependenciesTab, EvidenceTab, OperationsTab, PlanTab } from "@/components/process/sections";
import { getContext } from "@/lib/server";
import { processDetail } from "@/services/queries";

export const dynamic = "force-dynamic";

export default async function ProcessPage({ params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) notFound();
  const { db, ctx } = await getContext();
  const d = await processDetail(db, ctx, params.id);
  if (!d) notFound();
  const a = d.assessment;
  const top = [...d.evidence].filter((e) => e.ruleId !== "R03-baseline" && e.weight >= 1).sort((x, y) => y.weight - x.weight).slice(0, 2).map((e) => e.signal.toLowerCase());
  const conclusion = a ? `${REC_META[a.recommendation as keyof typeof REC_META].sentence} ${top.length ? `Strongest signals: ${top.join(" and ")}.` : "No strong signal was found, so this is a weak default."}` : "";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Estate inventory", href: "/processes" }, { label: folderCrumb(d.f.path), href: `/processes?folder=${d.f.id}` }, { label: pretty(d.p.name) }]}
        title={pretty(d.p.name)}
        meta={<><span>{d.f.path}</span><span><Package size={14} aria-hidden />{d.p.packageId} v{d.p.currentVersion}</span><span>Source ID <span className="mono">{d.p.sourceId}</span></span><StatusBadge tone="sage" icon={<ShieldCheck size={13} aria-hidden />}>Read-only</StatusBadge></>}
        actions={<>
          {a && <ActionButton url={`/api/processes/${d.p.id}/plan`} label="Generate migration plan" busy="Generating…" variant="primary" redirectTo="/plans/{planId}" />}
          {d.plans[0] ? <a className="btn secondary" href={`/api/plans/${d.plans[0].id}/export?format=md`}><Download size={16} aria-hidden />Export plan</a> : <button className="btn secondary" disabled title="Generate a plan first"><Download size={16} aria-hidden />Export plan</button>}
          <CopyLink label="Share link" />
        </>}
      />
      {!a ? <EmptyState icon={<ListChecks size={22} />} title="No assessment yet">Run an import from Connectors &amp; imports to assess this process.</EmptyState> : <>
        <DecisionPanel rec={a.recommendation} confidence={a.confidence} opportunity={a.opportunityScore} risk={a.riskScore} evidenceCount={d.evidence.length} conclusion={conclusion} runnerUp={a.runnerUp} redesign={a.redesignReview} aiInferred={d.evidence.some((e) => e.provenance === "ai_inferred")} />
        <Tabs tabs={[
          { id: "assessment", label: "Assessment", icon: <ShieldCheck size={16} aria-hidden />, panel: <AssessmentTab d={d} /> },
          { id: "evidence", label: "Evidence", count: d.evidence.length, icon: <FileText size={16} aria-hidden />, panel: <EvidenceTab d={d} /> },
          { id: "operations", label: "Operations", icon: <Activity size={16} aria-hidden />, panel: <OperationsTab d={d} /> },
          { id: "dependencies", label: "Dependencies", icon: <Network size={16} aria-hidden />, panel: <DependenciesTab d={d} /> },
          { id: "plan", label: "Migration plan", count: d.plans.length || undefined, icon: <GitCommitHorizontal size={16} aria-hidden />, panel: <PlanTab d={d} /> },
        ]} />
      </>}
    </>
  );
}
