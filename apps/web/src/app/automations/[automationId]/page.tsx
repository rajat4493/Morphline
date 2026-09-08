"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  api,
  Assessment,
  AutomationOverview,
  BusinessContext,
  Constraint,
  DimensionScore,
  EMPTY_BUSINESS_CONTEXT,
  EvidenceItem,
  EvolutionEvent,
  FlowGraph as FlowGraphData,
  WhyNotReason,
  WhyNotReasonType,
} from "@/lib/api";
import { StateBadge, LevelPill, SeverityPill } from "@/components/StateBadge";
import { EvolutionLadder } from "@/components/EvolutionLadder";
import { FlowGraph } from "@/components/FlowGraph";
import { BusinessContextForm } from "@/components/BusinessContextForm";

const TABS = [
  "Overview",
  "Process Flow",
  "Evolution Assessment",
  "Why / Why Not",
  "Business Context",
  "Dependencies",
  "Constraints",
  "Evolution History",
  "Evidence",
] as const;
type Tab = (typeof TABS)[number];

export default function AutomationDetailPage() {
  const params = useParams<{ automationId: string }>();
  const automationId = Number(params.automationId);

  const [tab, setTab] = useState<Tab>("Overview");
  const [overview, setOverview] = useState<AutomationOverview | null>(null);
  const [flow, setFlow] = useState<FlowGraphData | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [constraints, setConstraints] = useState<Constraint[] | null>(null);
  const [history, setHistory] = useState<EvolutionEvent[] | null>(null);
  const [businessContext, setBusinessContext] = useState<BusinessContext>(EMPTY_BUSINESS_CONTEXT);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refreshAfterReassessment(newAssessment: Assessment | null, biz: BusinessContext) {
    setBusinessContext(biz);
    if (newAssessment) {
      setAssessment(newAssessment);
      api.getConstraints(automationId).then(setConstraints).catch(() => {});
      api.getHistory(automationId).then(setHistory).catch(() => {});
    }
  }

  useEffect(() => {
    api.getOverview(automationId).then((o) => {
      setOverview(o);
      if (o.business_context) setBusinessContext(o.business_context);
    }).catch((e) => setError(String(e)));
    api.getFlow(automationId).then(setFlow).catch(() => {});
    api.getLatestAssessment(automationId).then(setAssessment).catch(() => {});
    api.getConstraints(automationId).then(setConstraints).catch(() => {});
    api.getHistory(automationId).then(setHistory).catch(() => {});
  }, [automationId]);

  const selectedNodeData = useMemo(
    () => flow?.nodes.find((n) => n.id === selectedNode)?.data ?? null,
    [flow, selectedNode]
  );

  if (error) return <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-rose-700">{error}</div>;
  if (!overview) return <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-subtle">Loading…</div>;

  const rec = assessment?.recommendation ?? overview.assessment?.recommendation ?? null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{overview.name}</h1>
          {overview.summary && <p className="mt-1.5 max-w-3xl text-sm text-subtle">{overview.summary}</p>}
        </div>
        {rec && (
          <a
            href={api.migrationPackUrl(automationId)}
            className="shrink-0 rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-canvas"
          >
            Download Migration Pack
          </a>
        )}
      </div>

      <div className="mt-6 flex gap-1 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? "border-accent text-accent" : "border-transparent text-subtle hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "Overview" && rec && (
          <div className="space-y-6">
            <EvolutionLadder rec={rec} />

            {assessment?.dimensions && (
              <CurrentVsOpportunity dimensions={assessment.dimensions} />
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ReasonsCard title="Top Reasons" items={rec.top_reasons} tone="positive" />
              <ReasonsCard title="Top Blockers" items={rec.top_blockers} tone="negative" />
            </div>

            {rec.missing_evidence.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-semibold text-amber-800">Missing Enterprise Context</div>
                <p className="mt-1 text-xs text-amber-800">
                  Absence of evidence is not evidence of safety — these gaps can cap the maximum safe state until confirmed.
                </p>
                <ul className="mt-2 list-disc pl-5 text-sm text-amber-800 space-y-1">
                  {rec.missing_evidence.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {overview.parser_warnings && overview.parser_warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-semibold text-amber-800">Parser Warnings</div>
                <ul className="mt-2 list-disc pl-5 text-sm text-amber-800 space-y-1">
                  {overview.parser_warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === "Process Flow" && flow && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <FlowGraph data={flow} onSelectNode={setSelectedNode} />
            </div>
            <div className="rounded-lg border border-line bg-white p-4">
              <h3 className="text-sm font-semibold text-ink">Step Detail</h3>
              {!selectedNodeData ? (
                <p className="mt-2 text-sm text-subtle">Click a node in the flow to see what it does, its evidence, and its risks.</p>
              ) : (
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <div className="text-xs uppercase text-subtle">Activity</div>
                    <div className="font-medium text-ink">{selectedNodeData.label}</div>
                    <div className="text-xs text-subtle">{selectedNodeData.activityType}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-subtle">Confidence</div>
                    <LevelPill level={selectedNodeData.confidence} />
                  </div>
                  {selectedNodeData.selector && (
                    <div>
                      <div className="text-xs uppercase text-subtle">Selector</div>
                      <div className="mt-1 rounded bg-slate-50 p-2 font-mono text-[11px] break-all">{selectedNodeData.selector}</div>
                    </div>
                  )}
                  {selectedNodeData.invokedWorkflow && (
                    <div>
                      <div className="text-xs uppercase text-subtle">Invokes</div>
                      <div className="text-ink">{selectedNodeData.invokedWorkflow}</div>
                    </div>
                  )}
                  {selectedNodeData.risks.length > 0 && (
                    <div>
                      <div className="text-xs uppercase text-subtle">Risks</div>
                      <ul className="mt-1 list-disc pl-4 text-rose-700">
                        {selectedNodeData.risks.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selectedNodeData.evidence.length > 0 && (
                    <div>
                      <div className="text-xs uppercase text-subtle">Evidence</div>
                      <ul className="mt-1 list-disc pl-4 text-subtle">
                        {selectedNodeData.evidence.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "Evolution Assessment" && assessment?.dimensions && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assessment.dimensions.map((d) => (
              <DimensionCard key={d.dimension} d={d} />
            ))}
          </div>
        )}

        {tab === "Why / Why Not" && rec && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-lg border border-line bg-white p-5">
              <h3 className="text-sm font-semibold text-ink">Why {`${rec.recommended_state}`.replaceAll("_", " ")}?</h3>
              <ul className="mt-3 space-y-2 text-sm text-ink">
                {rec.why_this.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-emerald-600">✓</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-line bg-white p-5">
              <h3 className="text-sm font-semibold text-ink">Why Not Further?</h3>
              {rec.why_not_further.length === 0 ? (
                <p className="mt-3 text-sm text-subtle">No active blockers found.</p>
              ) : (
                <ul className="mt-3 space-y-2.5 text-sm text-ink">
                  {rec.why_not_further.map((r, i) => (
                    <li key={i} className="flex gap-2 items-start">
                      <WhyNotBadge reasonType={r.reason_type} />
                      <span>{r.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === "Business Context" && (
          <BusinessContextForm automationId={automationId} initial={businessContext} onSaved={refreshAfterReassessment} />
        )}

        {tab === "Dependencies" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-lg border border-line bg-white p-5">
              <h3 className="text-sm font-semibold text-ink">External Systems</h3>
              {(overview.systems ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-subtle">No external systems detected.</p>
              ) : (
                <ul className="mt-3 space-y-3 text-sm">
                  {overview.systems!.map((s, i) => (
                    <li key={i}>
                      <div className="font-medium text-ink">{s.name}</div>
                      <div className="text-xs text-subtle">{s.interaction_mode.replaceAll("_", " ")}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-line bg-white p-5">
              <h3 className="text-sm font-semibold text-ink">Packages &amp; Invoked Workflows</h3>
              {(overview.dependencies ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-subtle">No dependencies detected.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {overview.dependencies!.map((d, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="text-ink">
                        {d.name}
                        {d.version && <span className="text-subtle"> @{d.version}</span>}
                      </span>
                      <LevelPill level={d.confidence === "KNOWN" ? "LOW" : d.confidence === "INFERRED" ? "MEDIUM" : "HIGH"} label={d.confidence} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {(overview.queues?.length || overview.assets?.length) ? (
              <div className="rounded-lg border border-line bg-white p-5 md:col-span-2">
                <h3 className="text-sm font-semibold text-ink">Queues &amp; Assets</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {overview.queues?.map((q, i) => (
                    <span key={`q-${i}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-ink">Queue: {q.name}</span>
                  ))}
                  {overview.assets?.map((a, i) => (
                    <span key={`a-${i}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-ink">Asset: {a.name}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {tab === "Constraints" && constraints && (
          <div className="rounded-lg border border-line bg-white divide-y divide-line">
            {constraints.length === 0 && <div className="p-5 text-sm text-subtle">No constraints recorded yet.</div>}
            {constraints.map((c) => (
              <div key={c.id} className="p-5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink">{c.category.replaceAll("_", " ")}</span>
                  <SeverityPill severity={c.severity} />
                  <StatusPill status={c.status} />
                  {c.autonomy_cap && <span className="text-[11px] text-subtle">caps at {c.autonomy_cap.replaceAll("_", " ")}</span>}
                </div>
                <p className="mt-1.5 text-sm text-subtle">{c.description}</p>
                {c.evidence.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-subtle space-y-0.5">
                    {c.evidence.map((e, i) => (
                      <li key={i}>[{e.type}] {e.description}</li>
                    ))}
                  </ul>
                )}
                {c.resolution_condition && (
                  <p className="mt-2 text-xs text-ink"><span className="font-medium">Resolves when:</span> {c.resolution_condition}</p>
                )}
                {c.owner && <p className="mt-1 text-xs text-subtle">Owner: {c.owner}</p>}
                {(c.status === "RESOLVED" || c.status === "POSSIBLY_RESOLVED") && c.resolution_notes && (
                  <p className={`mt-2 text-xs ${c.status === "RESOLVED" ? "text-emerald-700" : "text-amber-700"}`}>
                    {c.status === "RESOLVED" ? "Resolved" : "Possibly resolved — confirm"}: {c.resolution_notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "Evolution History" && history && (
          <div className="relative border-l border-line pl-6 space-y-6">
            {history.length === 0 && <div className="text-sm text-subtle">No history yet.</div>}
            {history.map((e) => (
              <div key={e.id} className="relative">
                <span className="absolute -left-[29px] top-1 h-2.5 w-2.5 rounded-full bg-accent" />
                <div className="text-xs text-subtle">{new Date(e.occurred_at).toLocaleString()}</div>
                <div className="text-xs font-semibold text-ink uppercase tracking-wide mt-0.5">{e.event_type.replaceAll("_", " ")}</div>
                <p className="mt-1 text-sm text-ink">{e.description}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "Evidence" && assessment?.dimensions && (
          <div className="rounded-lg border border-line bg-white divide-y divide-line">
            {assessment.dimensions.map((d) => (
              <div key={d.dimension} className="p-5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{d.label}</span>
                  <LevelPill level={d.level} />
                  <span className="text-[11px] text-subtle">confidence: {d.confidence}</span>
                </div>
                {d.evidence.length === 0 ? (
                  <p className="mt-1.5 text-sm text-amber-700 font-medium">INSUFFICIENT EVIDENCE</p>
                ) : (
                  <EvidenceByType evidence={d.evidence} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReasonsCard({ title, items, tone }: { title: string; items: string[]; tone: "positive" | "negative" }) {
  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-ink">
        {items.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className={tone === "positive" ? "text-emerald-600" : "text-rose-600"}>{tone === "positive" ? "✓" : "✕"}</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DimensionCard({ d }: { d: DimensionScore }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">{d.label}</span>
        <LevelPill level={d.level} />
      </div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
        <div
          className={`h-1.5 rounded-full ${d.level === "HIGH" ? "bg-rose-500" : d.level === "MEDIUM" ? "bg-amber-500" : "bg-slate-400"}`}
          style={{ width: `${d.score}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-subtle">{d.explanation}</p>
      <div className="mt-2 text-[11px] text-subtle">Confidence: {d.confidence}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-rose-50 text-rose-700",
    RESOLVED: "bg-emerald-50 text-emerald-700",
    ACCEPTED_RISK: "bg-amber-50 text-amber-700",
    UNKNOWN: "bg-slate-100 text-slate-600",
    POSSIBLY_RESOLVED: "bg-amber-50 text-amber-700",
  };
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${styles[status] ?? "bg-slate-100 text-slate-600"}`}>{status.replaceAll("_", " ")}</span>;
}

const WHY_NOT_STYLES: Record<WhyNotReasonType, { label: string; className: string }> = {
  BLOCKED: { label: "BLOCKED", className: "bg-rose-100 text-rose-700" },
  UNKNOWN: { label: "UNKNOWN", className: "bg-slate-200 text-slate-700" },
  NOT_READY: { label: "NOT READY", className: "bg-amber-100 text-amber-700" },
  NOT_VALUABLE: { label: "NOT VALUABLE", className: "bg-blue-100 text-blue-700" },
};

function WhyNotBadge({ reasonType }: { reasonType: WhyNotReasonType }) {
  const s = WHY_NOT_STYLES[reasonType];
  return <span className={`shrink-0 mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${s.className}`}>{s.label}</span>;
}

const EVIDENCE_TYPE_ORDER = ["BUSINESS", "TECHNICAL", "RUNTIME", "INFERRED"] as const;
const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  BUSINESS: "Business",
  TECHNICAL: "Technical",
  RUNTIME: "Runtime",
  INFERRED: "Inferred",
};

function EvidenceByType({ evidence }: { evidence: EvidenceItem[] }) {
  const grouped: Record<string, EvidenceItem[]> = {};
  for (const e of evidence) {
    (grouped[e.type] ??= []).push(e);
  }
  return (
    <div className="mt-2 space-y-2">
      {EVIDENCE_TYPE_ORDER.filter((t) => grouped[t]?.length).map((t) => (
        <div key={t}>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-subtle">{EVIDENCE_TYPE_LABELS[t]}</div>
          <ul className="mt-0.5 space-y-0.5">
            {grouped[t].map((e, i) => (
              <li key={i} className="text-sm text-ink flex gap-1.5">
                <span className={e.confidence === "UNKNOWN" ? "text-amber-600" : "text-emerald-600"}>{e.confidence === "UNKNOWN" ? "?" : "✓"}</span>
                <span>{e.description}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CurrentVsOpportunity({ dimensions }: { dimensions: DimensionScore[] }) {
  const current = dimensions.find((d) => d.dimension === "current_ai_usage");
  const opportunity = dimensions.find((d) => d.dimension === "reasoning_opportunity");
  if (!current || !opportunity) return null;
  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <h3 className="text-sm font-semibold text-ink">Current Implementation vs. Reasoning Opportunity</h3>
      <p className="mt-1 text-xs text-subtle">
        These are deliberately separate. A process can score HIGH on opportunity with zero AI activities today — and a
        process already using AI can still score LOW on opportunity if that AI isn&apos;t solving a genuine ambiguity problem.
      </p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-md border border-line p-3">
          <div className="text-xs uppercase text-subtle">Current AI / Reasoning Usage (descriptive only)</div>
          <div className="mt-1 flex items-center gap-2">
            <LevelPill level={current.level} />
            <span className="text-xs text-subtle">what it does today</span>
          </div>
        </div>
        <div className="rounded-md border border-accent/40 bg-blue-50/30 p-3">
          <div className="text-xs uppercase text-subtle">Reasoning Opportunity (drives recommendation)</div>
          <div className="mt-1 flex items-center gap-2">
            <LevelPill level={opportunity.level} />
            <span className="text-xs text-subtle">confidence: {opportunity.confidence}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
