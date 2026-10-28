import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM envelope for connector configuration. Key material comes from
 *  MORPHLINE_MASTER_KEY (any string; hashed to 32 bytes). */
function key(): Buffer {
  const k = process.env.MORPHLINE_MASTER_KEY;
  if (!k) {
    if (process.env.NODE_ENV === "production") throw new Error("MORPHLINE_MASTER_KEY must be set in production");
    return createHash("sha256").update("morphline-insecure-dev-key").digest();
  }
  return createHash("sha256").update(k).digest();
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decryptJson<T>(blob: string): T {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1") throw new Error("Unsupported config envelope version");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8")) as T;
}

/** Byte-oriented variant used only for optionally retained raw packages. Same key, same AES-256-GCM. */
export function encryptBytes(data: Buffer): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return ["v1b", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}
export function decryptBytes(blob: string): Buffer {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1b") throw new Error("Unsupported blob envelope version");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]);
}
