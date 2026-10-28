import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { tenants } from "@/db/schema";

export type TenantContext = { tenantId: string; actor: string };

/** Single-tenant demo resolver. Every query in the app takes a TenantContext and
 *  filters on tenant_id; swapping this for a session/JWT lookup is the only
 *  change needed for multi-tenancy. */
export async function resolveTenant(db: Db): Promise<TenantContext> {
  const name = "Demo Tenant";
  const [existing] = await db.select().from(tenants).where(eq(tenants.name, name)).limit(1);
  const row = existing ?? (await db.insert(tenants).values({ name }).returning())[0];
  return { tenantId: row.id, actor: "demo-user" };
}
