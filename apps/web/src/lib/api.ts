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

export type EvidenceType = "TECHNICAL" | "BUSINESS" | "RUNTIME" | "INFERRED";

export interface EvidenceItem {
  type: EvidenceType;
  source: string;
  confidence: "KNOWN" | "INFERRED" | "UNKNOWN";
  description: string;
  reference?: string | null;
}

export interface DimensionScore {
  dimension: string;
  label: string;
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidence: EvidenceItem[];
  explanation: string;
}

export type EvolutionState =
  | "DETERMINISTIC_RPA"
  | "AUGMENTED_RPA"
  | "HYBRID_AGENT"
  | "ADVANCED_HYBRID"
  | "HIGH_AUTONOMY";

export type MigrationPattern =
  | "KEEP_DETERMINISTIC_RPA"
  | "RPA_WITH_AI_AUGMENTATION"
  | "DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION"
  | "AGENT_ORCHESTRATED_RPA_TOOLS"
  | "AGENT_WITH_API_TOOLS"
  | "HYBRID_WITH_HUMAN_APPROVAL"
  | "HIGH_AUTONOMY_AGENT";

export type WhyNotReasonType = "BLOCKED" | "UNKNOWN" | "NOT_READY" | "NOT_VALUABLE";

export interface WhyNotReason {
  reason_type: WhyNotReasonType;
  text: string;
}

export interface Recommendation {
  current_state: EvolutionState;
  recommended_state: EvolutionState;
  maximum_safe_state: EvolutionState;
  next_possible_state: EvolutionState;
  recommended_pattern: MigrationPattern;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  why_this: string[];
  why_not_further: WhyNotReason[];
  top_reasons: string[];
  top_blockers: string[];
  missing_evidence: string[];
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
  evidence: EvidenceItem[];
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "ACTIVE" | "RESOLVED" | "ACCEPTED_RISK" | "UNKNOWN" | "POSSIBLY_RESOLVED";
  source: string | null;
  autonomy_cap: EvolutionState | null;
  resolution_condition: string | null;
  owner: string | null;
  created_at: string;
  last_seen_at: string;
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

export type ImpactLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
export type ImpactScope =
  | "INTERNAL_ONLY"
  | "SINGLE_CASE"
  | "MULTIPLE_CASES"
  | "BUSINESS_UNIT"
  | "ENTERPRISE"
  | "EXTERNAL_CUSTOMERS"
  | "UNKNOWN";
export type TriState = "YES" | "NO" | "UNKNOWN";

export interface BusinessContext {
  customer_impact: ImpactLevel;
  financial_impact: ImpactLevel;
  legal_regulatory_impact: ImpactLevel;
  employee_impact: ImpactLevel;
  external_party_impact: ImpactLevel;
  maximum_scope: ImpactScope;
  monetary_exposure: ImpactLevel;
  human_accountability_required: TriState;
  mandatory_approval: TriState;
  irreversible_action: TriState;
  regulated_process: TriState;
  sensitive_data: TriState;
  critical_service: TriState;
  process_owner: string | null;
  business_description: string | null;
  known_policies: string | null;
  known_constraints: string | null;
  notes: string | null;
}

export const EMPTY_BUSINESS_CONTEXT: BusinessContext = {
  customer_impact: "UNKNOWN",
  financial_impact: "UNKNOWN",
  legal_regulatory_impact: "UNKNOWN",
  employee_impact: "UNKNOWN",
  external_party_impact: "UNKNOWN",
  maximum_scope: "UNKNOWN",
  monetary_exposure: "UNKNOWN",
  human_accountability_required: "UNKNOWN",
  mandatory_approval: "UNKNOWN",
  irreversible_action: "UNKNOWN",
  regulated_process: "UNKNOWN",
  sensitive_data: "UNKNOWN",
  critical_service: "UNKNOWN",
  process_owner: null,
  business_description: null,
  known_policies: null,
  known_constraints: null,
  notes: null,
};

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
  business_context?: BusinessContext;
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
  business_context_changes: string[];
  evolution_state_changed: boolean;
  migration_pattern_changed: boolean;
  higher_level_possible: boolean;
  why: string[];
}

// --- Phase 4: Transformation Impact (composes estate what-if simulation
// with Phase 3 target-architecture generation) ---

export type PlatformRole =
  | "REASONING"
  | "AGENT_RUNTIME"
  | "ORCHESTRATION"
  | "BOUNDED_EXECUTION"
  | "HUMAN_APPROVAL"
  | "API_GATEWAY"
  | "DATABASE"
  | "QUEUE"
  | "OBSERVABILITY";

export const ROLE_LABELS: Record<PlatformRole, string> = {
  REASONING: "Reasoning",
  AGENT_RUNTIME: "Agent Runtime",
  ORCHESTRATION: "Orchestration",
  BOUNDED_EXECUTION: "Bounded Execution",
  HUMAN_APPROVAL: "Human Approval",
  API_GATEWAY: "API Gateway",
  DATABASE: "Database",
  QUEUE: "Queue",
  OBSERVABILITY: "Observability",
};

export interface SharedConstraint {
  key: string;
  category: string;
  canonical_dependency: string | null;
  affected_automation_ids: number[];
  affected_automation_names: string[];
  affected_count: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  sample_evidence: EvidenceItem[];
}

export interface TargetArchitectureComponent {
  role: PlatformRole;
  platform: string | null;
  justification: string | null;
  rejected_alternatives: { platform: string; reason: string }[];
  manual_decision_required: boolean;
  candidates: string[];
}

export interface MigrationStep {
  order: number;
  title: string;
  description: string;
  status: "ALREADY_TRUE" | "REQUIRED";
}

export interface Guardrail {
  type: string;
  reason: string;
}

export interface TargetArchitecturePlan {
  automation_id: number | null;
  automation_name: string;
  current_summary: string;
  recommended_state: string;
  recommended_pattern: string;
  components: TargetArchitectureComponent[];
  migration_sequence: MigrationStep[];
  guardrails: Guardrail[];
  confidence: "LOW" | "MEDIUM" | "HIGH";
  unresolved_factors: string[];
}

export interface ComponentChange {
  role: PlatformRole;
  before_platform: string | null;
  after_platform: string | null;
  before_manual_decision: boolean;
  after_manual_decision: boolean;
  added: boolean;
  removed: boolean;
  changed: boolean;
}

export interface TransformationImpact {
  automation_id: number;
  automation_name: string;
  current_architecture: TargetArchitecturePlan;
  simulated_architecture: TargetArchitecturePlan;
  component_changes: ComponentChange[];
  current_state: string;
  simulated_state: string;
  state_changed: boolean;
  remaining_blockers: string[];
}

export interface EstateArchitectureSummary {
  role: PlatformRole;
  platform_counts: Record<string, number>;
  manual_decision_count: number;
  total_automations: number;
}

export interface TransformationImpactResult {
  scenario_name: string;
  impacts: TransformationImpact[];
  platform_usage_before: EstateArchitectureSummary[];
  platform_usage_after: EstateArchitectureSummary[];
  unlock_count: number;
  unresolved_factors: string[];
}

export interface PlatformProfile {
  id: number;
  name: string;
  role: PlatformRole;
  notes: string | null;
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
  getBusinessContext: (automationId: number) => request<BusinessContext>(`/automations/${automationId}/business-context`),
  updateBusinessContext: (automationId: number, biz: BusinessContext) =>
    request<{ business_context: BusinessContext; assessment: Assessment | null }>(
      `/automations/${automationId}/business-context`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(biz) }
    ),
  getSharedConstraints: (workspaceId: number) => request<SharedConstraint[]>(`/workspaces/${workspaceId}/estate/shared-constraints`),
  getTargetArchitecture: (automationId: number) => request<TargetArchitecturePlan>(`/automations/${automationId}/target-architecture`),
  getArchitectureSummary: (workspaceId: number) => request<EstateArchitectureSummary[]>(`/workspaces/${workspaceId}/estate/architecture-summary`),
  getPlatformCatalog: (workspaceId: number) => request<PlatformProfile[]>(`/workspaces/${workspaceId}/platform-catalog`),
  getConstraintTransformationImpact: (workspaceId: number, constraintKey: string) =>
    request<TransformationImpactResult>(`/workspaces/${workspaceId}/estate/shared-constraints/transformation-impact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ constraint_key: constraintKey }),
    }),
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

export const PATTERN_LABELS: Record<MigrationPattern, string> = {
  KEEP_DETERMINISTIC_RPA: "Keep Deterministic RPA",
  RPA_WITH_AI_AUGMENTATION: "RPA with AI Augmentation",
  DETERMINISTIC_WORKFLOW_WITH_AGENT_DECISION: "Deterministic Workflow with Agent Decision",
  AGENT_ORCHESTRATED_RPA_TOOLS: "Agent-Orchestrated RPA Tools",
  AGENT_WITH_API_TOOLS: "Agent with API Tools",
  HYBRID_WITH_HUMAN_APPROVAL: "Hybrid with Human Approval",
  HIGH_AUTONOMY_AGENT: "High-Autonomy Agent",
};
