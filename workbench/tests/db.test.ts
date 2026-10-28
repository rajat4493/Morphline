import { describe, expect, it } from "vitest";
import { createEmbeddedDb } from "@/db/client";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { resolveTenant } from "@/lib/tenant";

describe("foundation", () => {
  it("migrates embedded postgres and resolves a tenant idempotently", async () => {
    const db = await createEmbeddedDb();
    const a = await resolveTenant(db);
    const b = await resolveTenant(db);
    expect(a.tenantId).toBe(b.tenantId);
  });
  it("round-trips encrypted config and does not leak plaintext", () => {
    const blob = encryptJson({ baseUrl: "https://orch.example", tokenEnvVar: "UIPATH_TOKEN" });
    expect(blob).not.toContain("orch.example");
    expect(decryptJson<{ baseUrl: string }>(blob).baseUrl).toBe("https://orch.example");
  });
});
