import type { Db } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { TenantContext } from "./tenant";

const SECRET_KEYS = /token|secret|password|authorization|credential|value/i;

/** Recursively drop anything that looks like a secret before it reaches the audit log. */
export function scrub(detail: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : v && typeof v === "object" && !Array.isArray(v) ? scrub(v as Record<string, unknown>) : v]));
}

export async function audit(db: Db, ctx: TenantContext, action: string, entityType: string, entityId: string | null, detail: Record<string, unknown> = {}) {
  await db.insert(auditEvents).values({ tenantId: ctx.tenantId, actor: ctx.actor, action, entityType, entityId, detail: scrub(detail) });
}
