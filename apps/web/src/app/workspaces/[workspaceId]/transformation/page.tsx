"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  api,
  ComponentChange,
  EstateArchitectureSummary,
  EvolutionState,
  ROLE_LABELS,
  SharedConstraint,
  TransformationImpact,
  TransformationImpactResult,
} from "@/lib/api";
import { StateBadge, SeverityPill } from "@/components/StateBadge";

function componentCell(before: string | null, after: string | null, beforeManual: boolean, afterManual: boolean) {
  const label = (platform: string | null, manual: boolean) => (manual ? "Manual decision needed" : platform ?? "—");
  return { before: label(before, beforeManual), after: label(after, afterManual) };
}

function ComponentDiffRow({ change }: { change: ComponentChange }) {
  const cells = componentCell(change.before_platform, change.after_platform, change.before_manual_decision, change.after_manual_decision);
  const rowTone = change.removed
    ? "bg-rose-50/60"
    : change.added
      ? "bg-emerald-50/60"
      : change.changed
        ? "bg-amber-50/60"
        : "";
  return (
    <tr className={rowTone}>
      <td className="px-3 py-2 text-xs font-medium text-ink">{ROLE_LABELS[change.role]}</td>
      <td className="px-3 py-2 text-xs text-subtle">{change.removed ? <span className="line-through">{cells.before}</span> : cells.before}</td>
      <td className="px-3 py-2 text-xs">
        {change.added && <span className="mr-1 rounded bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-700">NEW</span>}
        {change.removed ? <span className="text-subtle">removed</span> : <span className={change.changed ? "font-medium text-ink" : "text-subtle"}>{cells.after}</span>}
      </td>
    </tr>
  );
}

function ImpactCard({ impact }: { impact: TransformationImpact }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="text-sm font-semibold text-ink">{impact.automation_name}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-subtle">
            <StateBadge state={impact.current_state as EvolutionState} size="sm" />
            <span>→</span>
            <StateBadge state={impact.simulated_state as EvolutionState} size="sm" />
            {impact.state_changed && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">CHANGES</span>}
            {!impact.state_changed && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">NO STATE CHANGE</span>}
          </div>
        </div>
        <span className="text-xs text-subtle">{open ? "Hide" : "Show"} architecture</span>
      </button>

      {open && (
        <div className="mt-3">
          <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-md border border-line">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-subtle">
                <th className="px-3 py-1.5">Role</th>
                <th className="px-3 py-1.5">Before</th>
                <th className="px-3 py-1.5">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {impact.component_changes.map((c) => (
                <ComponentDiffRow key={c.role} change={c} />
              ))}
            </tbody>
          </table>

          {impact.remaining_blockers.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-semibold text-amber-800">Remaining blockers</div>
              <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
                {impact.remaining_blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlatformUsageTable({ before, after }: { before: EstateArchitectureSummary[]; after: EstateArchitectureSummary[] }) {
  const roles = before.map((b) => b.role).filter((role) => {
    const b = before.find((x) => x.role === role);
    const a = after.find((x) => x.role === role);
    return (b?.total_automations ?? 0) > 0 || (a?.total_automations ?? 0) > 0;
  });
  if (roles.length === 0) return null;

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-sm font-semibold text-ink">Platform usage impact</div>
      <table className="mt-3 w-full text-left text-xs">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-subtle">
            <th className="py-1.5 pr-3">Role</th>
            <th className="py-1.5 pr-3">Before</th>
            <th className="py-1.5 pr-3">After</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {roles.map((role) => {
            const b = before.find((x) => x.role === role)!;
            const a = after.find((x) => x.role === role) ?? { platform_counts: {}, manual_decision_count: 0, total_automations: 0, role };
            return (
              <tr key={role}>
                <td className="py-2 pr-3 font-medium text-ink">{ROLE_LABELS[role]}</td>
                <td className="py-2 pr-3 text-subtle">
                  {Object.entries(b.platform_counts).map(([p, n]) => `${p} (${n})`).join(", ") || "—"}
                  {b.manual_decision_count > 0 && <span className="ml-1 text-amber-600">+{b.manual_decision_count} manual</span>}
                </td>
                <td className="py-2 pr-3 text-ink">
                  {Object.entries(a.platform_counts).map(([p, n]) => `${p} (${n})`).join(", ") || "—"}
                  {a.manual_decision_count > 0 && <span className="ml-1 text-amber-600">+{a.manual_decision_count} manual</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TransformationPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = Number(params.workspaceId);

  const [constraints, setConstraints] = useState<SharedConstraint[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [result, setResult] = useState<TransformationImpactResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  useEffect(() => {
    api.getSharedConstraints(workspaceId).then(setConstraints).catch((e) => setError(String(e)));
  }, [workspaceId]);

  async function viewImpact(constraint: SharedConstraint) {
    setSelectedKey(constraint.key);
    setResult(null);
    setError(null);
    setLoadingKey(constraint.key);
    try {
      const impact = await api.getConstraintTransformationImpact(workspaceId, constraint.key);
      setResult(impact);
    } catch (e) {
      setError(String(e).includes("422") ? "No resolution mechanism is modeled for this constraint category — it's visible as a blocker, but Morphline doesn't yet know how to simulate fixing it." : String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  if (error && !constraints) return <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-rose-700">{error}</div>;
  if (!constraints) return <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-subtle">Loading…</div>;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Transformation Impact</h1>
          <p className="mt-1 text-sm text-subtle">
            Pick a shared blocker across the estate and see exactly which automations it would unlock, how their target
            architecture changes, and what would still block them.
          </p>
        </div>
        <Link href={`/workspaces/${workspaceId}`} className="text-sm text-subtle hover:text-ink">
          ← Back to estate
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-subtle">Shared blockers</div>
          {constraints.length === 0 && <div className="rounded-lg border border-line bg-white p-4 text-sm text-subtle">No shared constraints detected yet.</div>}
          {constraints.map((c) => (
            <button
              key={c.key}
              onClick={() => viewImpact(c)}
              className={`w-full rounded-lg border p-3 text-left transition ${selectedKey === c.key ? "border-ink bg-slate-50" : "border-line bg-white hover:border-slate-300"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink">{c.category.replace(/_/g, " ")}</span>
                <SeverityPill severity={c.severity} />
              </div>
              {c.canonical_dependency && <div className="mt-0.5 text-[11px] text-subtle">{c.canonical_dependency}</div>}
              <div className="mt-1 text-[11px] text-subtle">{c.affected_count} automation(s) affected</div>
              {loadingKey === c.key && <div className="mt-1 text-[11px] text-subtle">Computing impact…</div>}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {!result && !error && (
            <div className="rounded-lg border border-dashed border-line bg-white p-8 text-center text-sm text-subtle">
              Select a shared blocker to see its transformation impact.
            </div>
          )}
          {error && selectedKey && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{error}</div>
          )}
          {result && (
            <>
              <div className="rounded-lg border border-line bg-white p-4">
                <div className="text-sm font-semibold text-ink">{result.scenario_name}</div>
                <div className="mt-1 text-xs text-subtle">
                  {result.unlock_count} of {result.impacts.length} automation(s) move to a higher evolution state under this
                  assumption.
                </div>
                {result.unresolved_factors.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-[11px] text-amber-700">
                    {result.unresolved_factors.slice(0, 5).map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                )}
              </div>

              <PlatformUsageTable before={result.platform_usage_before} after={result.platform_usage_after} />

              {result.impacts.map((impact) => (
                <ImpactCard key={impact.automation_id} impact={impact} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
