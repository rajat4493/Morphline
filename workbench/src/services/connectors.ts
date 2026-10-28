import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { UiPathConnector } from "@/connectors/uipath";
import type { ConnectorConfig, EstateConnector } from "@/connectors/types";
import type { Db } from "@/db/client";
import { connectors } from "@/db/schema";
import { createMockOrchestrator, DEMO_TOKEN } from "@/demo/mock-orchestrator";
import { audit } from "@/lib/audit";
import { decryptJson, encryptJson } from "@/lib/crypto";
import type { TenantContext } from "@/lib/tenant";

export const connectorInput = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().url().refine((u) => /^https?:\/\//.test(u), "Must be http(s)"),
  organization: z.string().trim().max(100).optional(),
  tenant: z.string().trim().max(100).optional(),
  tokenEnvVar: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, "Environment variable name, e.g. UIPATH_ACCESS_TOKEN"),
}).refine((v) => !!v.organization === !!v.tenant, { message: "Provide both organization and tenant (Automation Cloud) or neither (on-prem)", path: ["tenant"] });

const DEMO_CONFIG: ConnectorConfig = { kind: "uipath", baseUrl: "https://demo.orchestrator.invalid", tokenEnvVar: "MORPHLINE_DEMO_TOKEN" };

export async function createConnector(db: Db, ctx: TenantContext, input: z.infer<typeof connectorInput>) {
  const cfg: ConnectorConfig = { kind: "uipath", baseUrl: input.baseUrl, organization: input.organization || undefined, tenant: input.tenant || undefined, tokenEnvVar: input.tokenEnvVar };
  const [row] = await db.insert(connectors).values({ tenantId: ctx.tenantId, kind: "uipath", name: input.name, encryptedConfig: encryptJson(cfg) }).returning();
  await audit(db, ctx, "connector.created", "connector", row.id, { name: input.name, baseUrl: input.baseUrl });
  return row;
}

export async function createDemoConnector(db: Db, ctx: TenantContext) {
  const existing = await db.select().from(connectors).where(and(eq(connectors.tenantId, ctx.tenantId), eq(connectors.isDemo, true))).limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db.insert(connectors).values({ tenantId: ctx.tenantId, kind: "uipath", name: "Demo Orchestrator (simulated)", isDemo: true, encryptedConfig: encryptJson(DEMO_CONFIG) }).returning();
  await audit(db, ctx, "connector.created", "connector", row.id, { demo: true });
  return row;
}

export async function getConnectorRow(db: Db, ctx: TenantContext, id: string) {
  const [row] = await db.select().from(connectors).where(and(eq(connectors.id, id), eq(connectors.tenantId, ctx.tenantId))).limit(1);
  return row ?? null;
}

/** Builds the runtime connector. Demo connectors are wired to the in-process mock; real ones to global fetch. */
export function buildConnector(row: typeof connectors.$inferSelect, overrides: { fetch?: typeof fetch; env?: Record<string, string | undefined> } = {}): EstateConnector {
  const cfg = decryptJson<ConnectorConfig>(row.encryptedConfig);
  if (row.isDemo) return new UiPathConnector(cfg, { fetch: overrides.fetch ?? createMockOrchestrator(), env: { MORPHLINE_DEMO_TOKEN: DEMO_TOKEN } });
  return new UiPathConnector(cfg, overrides);
}

export async function testConnector(db: Db, ctx: TenantContext, id: string, overrides = {}) {
  const row = await getConnectorRow(db, ctx, id);
  if (!row) return null;
  const result = await buildConnector(row, overrides).testConnection();
  await db.update(connectors).set({ lastTestAt: new Date(), lastTestOk: result.ok, lastTestMessage: result.message }).where(eq(connectors.id, id));
  await audit(db, ctx, "connector.tested", "connector", id, { ok: result.ok, message: result.message });
  return result;
}

export async function setSelectedFolders(db: Db, ctx: TenantContext, id: string, folderSourceIds: string[]) {
  await db.update(connectors).set({ selectedFolderIds: folderSourceIds }).where(and(eq(connectors.id, id), eq(connectors.tenantId, ctx.tenantId)));
  await audit(db, ctx, "connector.folders_selected", "connector", id, { count: folderSourceIds.length });
}
