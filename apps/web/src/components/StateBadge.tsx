import { EvolutionState, STATE_LABELS } from "@/lib/api";

const STATE_STYLES: Record<EvolutionState, string> = {
  DETERMINISTIC_RPA: "bg-slate-100 text-slate-700 border-slate-300",
  AUGMENTED_RPA: "bg-blue-50 text-blue-700 border-blue-300",
  HYBRID_AGENT: "bg-violet-50 text-violet-700 border-violet-300",
  ADVANCED_HYBRID: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-300",
  HIGH_AUTONOMY: "bg-emerald-50 text-emerald-700 border-emerald-300",
};

export function StateBadge({ state, size = "md" }: { state: EvolutionState; size?: "sm" | "md" }) {
  const sizeClasses = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1";
  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${sizeClasses} ${STATE_STYLES[state]}`}>
      {STATE_LABELS[state]}
    </span>
  );
}

const LEVEL_STYLES: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-600",
  MEDIUM: "bg-amber-50 text-amber-700",
  HIGH: "bg-rose-50 text-rose-700",
};

export function LevelPill({ level, label }: { level: string; label?: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${LEVEL_STYLES[level] ?? "bg-slate-100 text-slate-600"}`}>
      {label ?? level}
    </span>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-600",
  MEDIUM: "bg-amber-50 text-amber-700",
  HIGH: "bg-orange-50 text-orange-700",
  CRITICAL: "bg-rose-100 text-rose-700",
};

export function SeverityPill({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[severity] ?? "bg-slate-100 text-slate-600"}`}>
      {severity}
    </span>
  );
}
