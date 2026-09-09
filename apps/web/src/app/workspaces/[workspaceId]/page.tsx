"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, Dashboard, DashboardCard, EvolutionState, STATE_LABELS, STATE_ORDER } from "@/lib/api";
import { StateBadge } from "@/components/StateBadge";

const STATE_COLORS: Record<EvolutionState, string> = {
  DETERMINISTIC_RPA: "bg-slate-400",
  AUGMENTED_RPA: "bg-blue-500",
  HYBRID_AGENT: "bg-violet-500",
  ADVANCED_HYBRID: "bg-fuchsia-500",
  HIGH_AUTONOMY: "bg-emerald-500",
};

export default function WorkspaceDashboardPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = Number(params.workspaceId);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDashboard(workspaceId).then(setDashboard).catch((e) => setError(String(e)));
  }, [workspaceId]);

  if (error) return <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-rose-700">{error}</div>;
  if (!dashboard) return <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-subtle">Loading…</div>;

  const total = dashboard.estate.total_processes || 1;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{dashboard.workspace.name}</h1>
          <p className="mt-1 text-sm text-subtle">Automation estate — evolution readiness across all uploaded processes.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/workspaces/${workspaceId}/transformation`}
            className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:border-slate-300"
          >
            Transformation Impact
          </Link>
          <Link
            href={`/workspaces/${workspaceId}/upload`}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90"
          >
            Upload Process
          </Link>
        </div>
      </div>

      <section className="mt-8 rounded-lg border border-line bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Evolution Funnel</h2>
          <span className="text-xs text-subtle">{dashboard.estate.total_processes} total processes</span>
        </div>
        <div className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
          {STATE_ORDER.map((state) => {
            const count = dashboard.estate.by_state[state] ?? 0;
            if (!count) return null;
            return (
              <div
                key={state}
                className={STATE_COLORS[state]}
                style={{ width: `${(count / total) * 100}%` }}
                title={`${STATE_LABELS[state]}: ${count}`}
              />
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          {STATE_ORDER.map((state) => (
            <div key={state} className="flex items-center gap-1.5 text-xs text-subtle">
              <span className={`h-2 w-2 rounded-full ${STATE_COLORS[state]}`} />
              {STATE_LABELS[state]}: <span className="font-medium text-ink">{dashboard.estate.by_state[state] ?? 0}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CardList title="Quick Wins" cards={dashboard.quick_wins} emptyText="No quick wins identified yet." />
        <CardList title="High-Risk Migrations" cards={dashboard.high_risk_migrations} emptyText="No high-risk migrations flagged." />
        <CardList title="Newly Eligible for Evolution" cards={dashboard.newly_eligible} emptyText="No process recently became eligible for a higher state." />
        <CardList title="Requires Architect Review" cards={dashboard.requires_architect_review} emptyText="Nothing needs architect review right now." showReason />
      </div>

      <section className="mt-6 rounded-lg border border-line bg-white p-5">
        <h2 className="text-sm font-semibold text-ink">Top Constraints Across the Estate</h2>
        {dashboard.top_constraints.length === 0 ? (
          <p className="mt-2 text-sm text-subtle">No active constraints — nothing is currently blocking evolution.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {dashboard.top_constraints.map((c) => (
              <li key={c.category} className="flex items-center justify-between text-sm">
                <span className="text-ink">{c.category.replaceAll("_", " ")}</span>
                <span className="text-subtle">{c.count} process(es)</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CardList({
  title,
  cards,
  emptyText,
  showReason,
}: {
  title: string;
  cards: DashboardCard[];
  emptyText: string;
  showReason?: boolean;
}) {
  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {cards.length === 0 ? (
        <p className="mt-2 text-sm text-subtle">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {cards.map((c) => (
            <li key={c.id}>
              <Link
                href={`/automations/${c.id}`}
                className="flex items-center justify-between rounded-md border border-line px-3 py-2.5 hover:bg-canvas transition-colors"
              >
                <div>
                  <div className="text-sm font-medium text-ink">{c.name}</div>
                  {showReason && c.reason && <div className="text-xs text-subtle mt-0.5">{c.reason}</div>}
                </div>
                <StateBadge state={c.recommended_state} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
