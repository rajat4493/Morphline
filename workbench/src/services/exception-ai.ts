import { and, eq, inArray } from "drizzle-orm";
import { PROMPT_VERSION, keywordClassifier, textHash, type ExceptionClassifier } from "@/ai/classifier";
import type { ExceptionCategory } from "@/ai/taxonomy";
import { redact } from "@/ai/redact";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { ExceptionAiItem } from "@/assessment/types";

const TOP = 5;
export type AiRunResult = { method: string; model: string; byProcess: Map<string, ExceptionAiItem[]>; stats: { texts: number; cached: number; sent: number; failed: number }; issue?: string };

/** Collects each process's top exception texts (queue reasons + faulted-job messages), redacts them, labels them via the
 *  classifier (cached by text hash + model + prompt version), and returns per-process labelled items. Never throws:
 *  a model failure yields an issue string and no AI evidence, so the assessment falls back to deterministic rules. */
export async function runExceptionAi(db: Db, ctx: TenantContext, connectorId: string, classifier: ExceptionClassifier): Promise<AiRunResult> {
  const t = ctx.tenantId;
  const procs = await db.select().from(s.automationProcesses).where(and(eq(s.automationProcesses.connectorId, connectorId), eq(s.automationProcesses.tenantId, t)));
  const ids = procs.map((p) => p.id);
  const empty: AiRunResult = { method: classifier.method, model: classifier.model, byProcess: new Map(), stats: { texts: 0, cached: 0, sent: 0, failed: 0 } };
  if (!ids.length) return empty;

  const [trigs, qs, sigs, jobs] = await Promise.all([
    db.select().from(s.triggers).where(inArray(s.triggers.processId, ids)), db.select().from(s.queues).where(eq(s.queues.tenantId, t)), db.select().from(s.queueSignals).where(eq(s.queueSignals.tenantId, t)),
    db.select({ processId: s.executionJobs.processId, info: s.executionJobs.infoMessage }).from(s.executionJobs).where(and(inArray(s.executionJobs.processId, ids), eq(s.executionJobs.state, "Faulted"))),
  ]);

  const raw = new Map<string, Map<string, { text: string; count: number; source: "queue" | "job" }>>();
  const add = (pid: string, original: string, count: number, source: "queue" | "job") => {
    const text = redact(original); if (!text) return;
    const m = raw.get(pid) ?? new Map(); const key = `${source}:${text}`;
    m.set(key, { text, count: (m.get(key)?.count ?? 0) + count, source }); raw.set(pid, m);
  };
  for (const p of procs) {
    const qName = trigs.find((x) => x.processId === p.id && x.kind === "queue")?.queueName;
    const q = qName ? qs.find((x) => x.name === qName && x.folderId === p.folderId) : undefined;
    const sig = q ? sigs.filter((x) => x.queueId === q.id).sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0] : undefined;
    for (const r of sig?.topErrorReasons.slice(0, TOP) ?? []) add(p.id, r.reason, r.count, "queue");
    const counts = new Map<string, number>();
    for (const j of jobs.filter((x) => x.processId === p.id && x.info)) counts.set(j.info!, (counts.get(j.info!) ?? 0) + 1);
    for (const [info, c] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, TOP)) add(p.id, info, c, "job");
  }

  const texts = [...new Set([...raw.values()].flatMap((m) => [...m.values()].map((v) => v.text)))];
  const result: AiRunResult = { ...empty, stats: { texts: texts.length, cached: 0, sent: 0, failed: 0 } };
  if (!texts.length) return result;

  const hashes = texts.map(textHash);
  const cacheKey = and(eq(s.exceptionClassifications.tenantId, t), eq(s.exceptionClassifications.method, classifier.method), eq(s.exceptionClassifications.model, classifier.model), eq(s.exceptionClassifications.promptVersion, PROMPT_VERSION));
  const cachedRows = await db.select().from(s.exceptionClassifications).where(and(cacheKey, inArray(s.exceptionClassifications.textHash, hashes)));
  const labels = new Map(cachedRows.map((r) => [r.textHash, { label: r.label as ExceptionCategory, confidence: r.confidence, rationale: r.rationale }]));
  result.stats.cached = labels.size;

  const missing = texts.filter((x) => !labels.has(textHash(x)));
  if (missing.length) {
    try {
      result.stats.sent = missing.length;
      const got = await classifier.classify(missing);
      for (const c of got) {
        labels.set(textHash(c.text), { label: c.label, confidence: c.confidence, rationale: c.rationale });
        await db.insert(s.exceptionClassifications).values({ tenantId: t, textHash: textHash(c.text), textRedacted: c.text, label: c.label, confidence: c.confidence, method: classifier.method, model: classifier.model, promptVersion: PROMPT_VERSION, rationale: c.rationale }).onConflictDoNothing();
      }
      result.stats.failed = missing.length - got.length;
    } catch (e) { result.issue = `AI evidence unavailable: ${(e as Error).message}`; result.stats.failed = missing.length; }
  }

  const kw = new Map((await keywordClassifier.classify(texts)).map((c) => [c.text, c.label]));
  for (const [pid, m] of raw) {
    const items: ExceptionAiItem[] = [];
    for (const v of m.values()) { const l = labels.get(textHash(v.text)); if (l) items.push({ text: v.text, count: v.count, source: v.source, label: l.label, confidence: l.confidence, rationale: l.rationale, keywordLabel: kw.get(v.text) ?? "other_unclear" }); }
    if (items.length) result.byProcess.set(pid, items);
  }
  await audit(db, ctx, "ai_evidence.classified", "connector", connectorId, { model: classifier.model, promptVersion: PROMPT_VERSION, ...result.stats, issue: result.issue ?? null });
  return result;
}
