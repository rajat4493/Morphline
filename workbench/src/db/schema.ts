import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const tenantId = () => uuid("tenant_id").notNull().references(() => tenants.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const tenants = pgTable("tenants", { id: id(), name: text("name").notNull(), createdAt: createdAt() });

/** Connection configuration is stored encrypted (AES-256-GCM). It holds the
 *  Orchestrator URL, organisation/tenant names and the NAME of the env var that
 *  carries the access token. The token itself is never persisted. */
export const connectors = pgTable("connectors", {
  id: id(), tenantId: tenantId(), kind: text("kind").notNull(), name: text("name").notNull(), isDemo: boolean("is_demo").notNull().default(false),
  encryptedConfig: text("encrypted_config").notNull(), selectedFolderIds: jsonb("selected_folder_ids").$type<string[]>().notNull().default([]),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }), lastTestOk: boolean("last_test_ok"), lastTestMessage: text("last_test_message"),
  createdAt: createdAt(),
});

export const importRuns = pgTable("import_runs", {
  id: id(), tenantId: tenantId(), connectorId: uuid("connector_id").notNull().references(() => connectors.id), status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(), finishedAt: timestamp("finished_at", { withTimezone: true }),
  counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}), errors: jsonb("errors").$type<ImportIssue[]>().notNull().default([]),
});
export type ImportIssue = { entity: string; folder?: string; message: string };

export const folders = pgTable("folders", {
  id: id(), tenantId: tenantId(), connectorId: uuid("connector_id").notNull().references(() => connectors.id), sourceId: text("source_id").notNull(),
  name: text("name").notNull(), path: text("path").notNull(), parentSourceId: text("parent_source_id"), raw: jsonb("raw").notNull(),
}, (t) => [uniqueIndex("folders_src").on(t.connectorId, t.sourceId)]);

export const automationProcesses = pgTable("automation_processes", {
  id: id(), tenantId: tenantId(), connectorId: uuid("connector_id").notNull().references(() => connectors.id), folderId: uuid("folder_id").notNull().references(() => folders.id),
  sourceId: text("source_id").notNull(), sourceKey: text("source_key"), name: text("name").notNull(), packageId: text("package_id").notNull(), currentVersion: text("current_version").notNull(),
  description: text("description"), status: text("status").notNull(), processType: text("process_type"), createdSourceAt: timestamp("created_source_at", { withTimezone: true }),
  raw: jsonb("raw").notNull(), firstSeenAt: createdAt(), lastImportRunId: uuid("last_import_run_id"),
}, (t) => [uniqueIndex("proc_src").on(t.connectorId, t.sourceId), index("proc_tenant").on(t.tenantId)]);

export const processVersions = pgTable("process_versions", {
  id: id(), tenantId: tenantId(), processId: uuid("process_id").notNull().references(() => automationProcesses.id, { onDelete: "cascade" }),
  version: text("version").notNull(), publishedAt: timestamp("published_at", { withTimezone: true }), raw: jsonb("raw").notNull(),
});

export const processDeployments = pgTable("process_deployments", {
  id: id(), tenantId: tenantId(), processId: uuid("process_id").notNull().references(() => automationProcesses.id, { onDelete: "cascade" }),
  folderId: uuid("folder_id").notNull().references(() => folders.id), environmentName: text("environment_name"), raw: jsonb("raw").notNull(),
});

export const executionJobs = pgTable("execution_jobs", {
  id: id(), tenantId: tenantId(), processId: uuid("process_id").notNull().references(() => automationProcesses.id, { onDelete: "cascade" }), sourceId: text("source_id").notNull(),
  state: text("state").notNull(), startedAt: timestamp("started_at", { withTimezone: true }), endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSec: integer("duration_sec"), source: text("source"), infoMessage: text("info_message"), machineName: text("machine_name"), raw: jsonb("raw").notNull(),
}, (t) => [index("jobs_proc").on(t.processId, t.startedAt)]);

export const queues = pgTable("queues", {
  id: id(), tenantId: tenantId(), folderId: uuid("folder_id").notNull().references(() => folders.id), sourceId: text("source_id").notNull(), name: text("name").notNull(),
  maxRetries: integer("max_retries"), processId: uuid("process_id").references(() => automationProcesses.id, { onDelete: "set null" }), raw: jsonb("raw").notNull(),
}, (t) => [uniqueIndex("queues_src").on(t.folderId, t.sourceId)]);

/** Aggregated queue-item outcome signals per queue per import (no item payloads are stored). */
export const queueSignals = pgTable("queue_signals", {
  id: id(), tenantId: tenantId(), queueId: uuid("queue_id").notNull().references(() => queues.id, { onDelete: "cascade" }), windowDays: integer("window_days").notNull(),
  total: integer("total").notNull(), successful: integer("successful").notNull(), applicationExceptions: integer("application_exceptions").notNull(),
  businessExceptions: integer("business_exceptions").notNull(), abandoned: integer("abandoned").notNull(), retried: integer("retried").notNull(),
  topErrorReasons: jsonb("top_error_reasons").$type<{ reason: string; count: number }[]>().notNull().default([]), capturedAt: createdAt(),
});

export const triggers = pgTable("triggers", {
  id: id(), tenantId: tenantId(), processId: uuid("process_id").notNull().references(() => automationProcesses.id, { onDelete: "cascade" }), sourceId: text("source_id").notNull(),
  kind: text("kind").notNull(), name: text("name").notNull(), cron: text("cron"), enabled: boolean("enabled").notNull(), queueName: text("queue_name"), raw: jsonb("raw").notNull(),
});

export const machines = pgTable("machines", {
  id: id(), tenantId: tenantId(), connectorId: uuid("connector_id").notNull().references(() => connectors.id), sourceId: text("source_id").notNull(), name: text("name").notNull(),
  type: text("type"), runtimes: integer("runtimes"), raw: jsonb("raw").notNull(),
});

/** Metadata ONLY. There is deliberately no value column. */
export const assetMetadata = pgTable("asset_metadata", {
  id: id(), tenantId: tenantId(), folderId: uuid("folder_id").notNull().references(() => folders.id), sourceId: text("source_id").notNull(), name: text("name").notNull(),
  valueType: text("value_type").notNull(), valueScope: text("value_scope"), description: text("description"),
});

export const dependencies = pgTable("dependencies", {
  id: id(), tenantId: tenantId(), processId: uuid("process_id").notNull().references(() => automationProcesses.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), name: text("name").notNull(), detail: text("detail"), origin: text("origin").notNull(),
});

export const assessments = pgTable("assessments", {
  id: id(), tenantId: tenantId(), processId: uuid("process_id").notNull().references(() => automationProcesses.id, { onDelete: "cascade" }), importRunId: uuid("import_run_id"),
  ruleVersion: text("rule_version").notNull(), recommendation: text("recommendation").notNull(), confidence: integer("confidence").notNull(), opportunityScore: integer("opportunity_score").notNull(),
  riskScore: integer("risk_score").notNull(), rationale: jsonb("rationale").$type<string[]>().notNull(), riskFlags: jsonb("risk_flags").$type<string[]>().notNull(),
  missingInformation: jsonb("missing_information").$type<string[]>().notNull(), nextStep: text("next_step").notNull(), logicAnalysis: text("logic_analysis").notNull().default("unavailable"), redesignReview: boolean("redesign_review").notNull().default(false), runnerUp: text("runner_up"),
  inputHash: text("input_hash").notNull(), scores: jsonb("scores").$type<Record<string, number>>().notNull(), createdAt: createdAt(),
}, (t) => [index("assess_proc").on(t.processId, t.createdAt)]);

export const assessmentEvidence = pgTable("assessment_evidence", {
  id: id(), tenantId: tenantId(), assessmentId: uuid("assessment_id").notNull().references(() => assessments.id, { onDelete: "cascade" }), ruleId: text("rule_id").notNull(),
  signal: text("signal").notNull(), observed: text("observed").notNull(), effect: text("effect").notNull(), weight: doublePrecision("weight").notNull(),
  sourceEntity: text("source_entity").notNull(), sourceRefs: jsonb("source_refs").$type<string[]>().notNull().default([]),
  /** "deterministic" = computed by rules from imported data; "ai_inferred" = depends on model-labelled text (lower trust). */
  provenance: text("provenance").notNull().default("deterministic"), detail: jsonb("detail").$type<unknown>(),
});

/** Cache of exception-text labels. Stores the REDACTED text that was classified, never the raw original. */
export const exceptionClassifications = pgTable("exception_classifications", {
  id: id(), tenantId: tenantId(), textHash: text("text_hash").notNull(), textRedacted: text("text_redacted").notNull(), label: text("label").notNull(), confidence: integer("confidence").notNull(),
  method: text("method").notNull(), model: text("model").notNull(), promptVersion: text("prompt_version").notNull(), rationale: text("rationale").notNull().default(""), createdAt: createdAt(),
}, (t) => [uniqueIndex("exc_cls_key").on(t.tenantId, t.textHash, t.method, t.model, t.promptVersion)]);

export const migrationPlans = pgTable("migration_plans", {
  id: id(), tenantId: tenantId(), processId: uuid("process_id").notNull().references(() => automationProcesses.id, { onDelete: "cascade" }),
  assessmentId: uuid("assessment_id").notNull().references(() => assessments.id), content: jsonb("content").notNull(), narrative: text("narrative"),
  narrativeIsAiDraft: boolean("narrative_is_ai_draft").notNull().default(false), createdAt: createdAt(),
});

export const auditEvents = pgTable("audit_events", {
  id: id(), tenantId: tenantId(), actor: text("actor").notNull(), action: text("action").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id"),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}), at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
