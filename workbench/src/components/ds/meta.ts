import { Archive, GitFork, ListChecks, ScanText, ShieldCheck, type LucideIcon } from "lucide-react";
import type { Recommendation } from "@/assessment/types";

/** Presentation-only mappings. Nothing here changes data or rules. */
export const REC_META: Record<Recommendation, { label: string; icon: LucideIcon; tone: "neutral" | "blue" | "teal" | "sage"; sentence: string }> = {
  deterministic: { label: "Deterministic", icon: ListChecks, tone: "neutral", sentence: "Fixed rules remain the right fit; the focus is reliability, not adding AI." },
  ai_augmented: { label: "AI-augmented", icon: ScanText, tone: "blue", sentence: "A deterministic flow with a bounded AI capability fits best." },
  hybrid: { label: "Hybrid", icon: GitFork, tone: "teal", sentence: "A bounded AI decision with RPA/API execution fits best." },
  governed_agentic: { label: "Policy-constrained agentic", icon: ShieldCheck, tone: "sage", sentence: "Tool-choosing behaviour is plausible, but only inside explicit policy and approval limits." },
  retire: { label: "Retire / consolidate", icon: Archive, tone: "neutral", sentence: "Little evidence of ongoing value; confirm with the owner before decommissioning." },
};

export const pretty = (name: string) => name.replace(/_/g, " ");
export const folderCrumb = (path: string) => path.replace(/^Shared\//, "");

export const SOURCE_LABEL: Record<string, string> = {
  queue_signals: "Queue signals", execution_jobs: "Execution history", triggers: "Triggers", process_versions: "Package versions", asset_metadata: "Asset metadata", automation_processes: "Process catalogue",
};

/** Strength is derived from the stored finding weight (votes + risk/100); the baseline prior is labelled as such. */
export function strengthOf(ev: { ruleId: string; weight: number }): { label: string; level: 0 | 1 | 2 | 3 } {
  if (ev.ruleId === "R03-baseline") return { label: "Baseline", level: 0 };
  if (ev.ruleId === "R15-ai-exception-mix" && ev.weight === 0) return { label: "Context", level: 0 };
  if (ev.weight < 1) return { label: "Risk signal", level: 1 };
  if (ev.weight >= 3) return { label: "Strong", level: 3 };
  return { label: "Moderate", level: 2 };
}

export const healthOf = (rate: number, jobs: number) =>
  jobs === 0 ? { label: "No runs", color: "var(--amber-line)" } : rate >= 0.25 ? { label: "Failing", color: "#c9453f" } : rate >= 0.08 ? { label: "Degraded", color: "#d99a2b" } : { label: "Healthy", color: "#2f8f6b" };

/** UI-only threshold for the "high operational risk" summary chip. */
export const HIGH_RISK_SCORE = 40;
