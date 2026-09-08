const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface Workspace {
  id: number;
  name: string;
  created_at: string;
  automation_count?: number;
  automations?: { id: number; name: string; is_sample: boolean; version_count: number }[];
}

export interface DimensionScore {
  dimension: string;
  label: string;
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidence: string[];
  explanation: string;
}

export type EvolutionState =
  | "DETERMINISTIC_RPA"
  | "AUGMENTED_RPA"
  | "HYBRID_AGENT"
  | "ADVANCED_HYBRID"
  | "HIGH_AUTONOMY";

export interface Recommendation {
  current_state: EvolutionState;
  recommended_state: EvolutionState;
  maximum_safe_state: EvolutionState;
  next_possible_state: EvolutionState;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  why_this: string[];
  why_not_further: string[];
  top_reasons: string[];
  top_blockers: string[];
}

export interface Assessment {
  id: number;
  process_version_id: number;
  summary_score: number;
  created_at: string;
  recommendation: Recommendation | null;
  dimensions?: DimensionScore[];
}

export interface Constraint {
  id: number;
  category: string;
  description: string;
  evidence: string[];
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "ACTIVE" | "RESOLVED" | "ACCEPTED_RISK" | "UNKNOWN";
  created_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
}

export interface EvolutionEvent {
  id: number;
  event_type: string;
  description: string;
  occurred_at: string;
  process_version_id: number | null;
  assessment_id: number | null;
}

export interface Dependency {
  kind: string;
  name: string;
  version: string | null;
  confidence: "KNOWN" | "INFERRED" | "UNKNOWN";
  evidence: { source: string; detail: string; confidence: string }[];
}

export interface SystemRef {
  name: string;
  interaction_mode: string;
  evidence: { source: string; detail: string; confidence: string }[];
}

export interface AutomationOverview {
  id: number;
  name: string;
  is_sample?: boolean;
  status?: string;
  latest_version?: { id: number; version_number: number; uploaded_filename: string; created_at: string };
  summary?: string;
  assessment?: Assessment | null;
  parser_warnings?: string[];
  dependencies?: Dependency[];
  systems?: SystemRef[];
  queues?: { name: string }[];
  assets?: { name: string; kind: string | null }[];
}

export interface FlowGraph {
  nodes: {
    id: string;
    type: string;
    data: {
      label: string;
      activityType: string;
      category: string;
      color: string;
      confidence: string;
      workflow: string;
      isContainer: boolean;
      risks: string[];
      notes: string | null;
      evidence: string[];
      selector: string | null;
      invokedWorkflow: string | null;
      api: Record<string, unknown> | null;
    };
    position: { x: number; y: number };
  }[];
  edges: { id: string; source: string; target: string; type: string }[];
}

export interface DashboardCard {
  id: number;
  name: string;
  current_state: EvolutionState;
  recommended_state: EvolutionState;
  maximum_safe_state: EvolutionState;
  confidence: string;
  active_constraint_count: number;
  reason?: string;
}

export interface Dashboard {
  workspace: { id: number; name: string };
  estate: {
    total_processes: number;
    by_state: Record<EvolutionState, number>;
  };
  top_constraints: { category: string; count: number }[];
  quick_wins: DashboardCard[];
  high_risk_migrations: DashboardCard[];
  newly_eligible: DashboardCard[];
  requires_architect_review: DashboardCard[];
}

export interface ReassessmentDiff {
  what_changed: string[];
  what_resolved: string[];
  new_risks: string[];
  higher_level_possible: boolean;
  why: string[];
}

export const api = {
  listWorkspaces: () => request<Workspace[]>("/workspaces"),
  createWorkspace: (name: string) =>
    request<Workspace>("/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  getWorkspace: (id: number) => request<Workspace>(`/workspaces/${id}`),
  getDashboard: (workspaceId: number) => request<Dashboard>(`/workspaces/${workspaceId}/dashboard`),
  upload: (workspaceId: number, file: File, opts: { automationId?: number; automationName?: string }) => {
    const form = new FormData();
    form.append("file", file);
    if (opts.automationId) form.append("automation_id", String(opts.automationId));
    if (opts.automationName) form.append("automation_name", opts.automationName);
    return request<{ automation_id: number; process_version_id: number; assessment: Assessment }>(
      `/workspaces/${workspaceId}/uploads`,
      { method: "POST", body: form }
    );
  },
  getOverview: (automationId: number) => request<AutomationOverview>(`/automations/${automationId}`),
  getFlow: (automationId: number) => request<FlowGraph>(`/automations/${automationId}/flow`),
  listAssessments: (automationId: number) => request<Assessment[]>(`/automations/${automationId}/assessments`),
  getLatestAssessment: (automationId: number) => request<Assessment>(`/automations/${automationId}/assessments/latest`),
  getConstraints: (automationId: number) => request<Constraint[]>(`/automations/${automationId}/constraints`),
  getHistory: (automationId: number) => request<EvolutionEvent[]>(`/automations/${automationId}/history`),
  getReassessmentDiff: (automationId: number) => request<ReassessmentDiff>(`/automations/${automationId}/reassessment-diff`),
  migrationPackUrl: (automationId: number) => `${API_BASE}/automations/${automationId}/migration-pack`,
};

export const STATE_LABELS: Record<EvolutionState, string> = {
  DETERMINISTIC_RPA: "Deterministic RPA",
  AUGMENTED_RPA: "Augmented RPA",
  HYBRID_AGENT: "Hybrid Agent",
  ADVANCED_HYBRID: "Advanced Hybrid",
  HIGH_AUTONOMY: "High Autonomy",
};

export const STATE_ORDER: EvolutionState[] = [
  "DETERMINISTIC_RPA",
  "AUGMENTED_RPA",
  "HYBRID_AGENT",
  "ADVANCED_HYBRID",
  "HIGH_AUTONOMY",
];
