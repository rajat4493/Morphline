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
  queue_signals: "Queue signals", execution_jobs: "Execution history", triggers: "Triggers", process_versions: "Package versions", asset_metadata: "Asset metadata", automation_processes: "Process catalogue", package_analyses: "Package analysis",
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

/** Evidence basis of a relationship. Kept in sync with services/dependencies.ts. */
export type BasisKey = "confirmed_package" | "confirmed_orchestrator" | "folder_scoped" | "inferred";
export const BASIS_META: Record<BasisKey, { label: string; short: string; tone: "sage" | "blue" | "outline" | "amber"; help: string }> = {
  confirmed_package: { label: "Confirmed in package", short: "Confirmed (package)", tone: "sage", help: "A literal reference found in the analysed package of the deployed version." },
  confirmed_orchestrator: { label: "Confirmed in Orchestrator configuration", short: "Confirmed (Orchestrator)", tone: "blue", help: "Configured in Orchestrator itself, for example a queue trigger, or a deployment fact." },
  folder_scoped: { label: "Folder-scoped metadata (association unconfirmed)", short: "Folder-scoped", tone: "outline", help: "Exists in the process's folder. Nothing confirms this process uses it." },
  inferred: { label: "Inferred", short: "Inferred", tone: "amber", help: "Derived by joining facts, or a name resolved only at runtime (for example through Config). Not directly confirmed." },
};
export const PACKAGE_STATUS: Record<string, { label: string; tone: "sage" | "amber" | "red" | "neutral"; text: string }> = {
  source_available: { label: "Source available", tone: "sage", text: "Workflow source (XAML) was found and parsed statically. Nothing was run." },
  compiled_only: { label: "Compiled only", tone: "amber", text: "Only compiled assemblies were found, so the workflow logic cannot be read statically. Request the source project (XAML)." },
  unreadable: { label: "Encrypted or unreadable", tone: "amber", text: "The package is encrypted, corrupt or its workflow files could not be parsed. Workflow logic is unknown." },
  missing: { label: "Missing", tone: "red", text: "No package could be analysed for this version." },
};
export const PACKAGE_FAILURE: Record<string, string> = {
  download_denied: "Download denied: the token lacks Packages.View", not_found: "Not found on the package feed", too_large: "Over the size limit", download_error: "Download failed", analyzer_failed: "Analyzer failed", isolation_unavailable: "Sandbox isolation unavailable",
};
