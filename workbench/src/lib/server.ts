import { getDb } from "@/db/client";
import { resolveTenant } from "./tenant";

export async function getContext() {
  const db = await getDb();
  return { db, ctx: await resolveTenant(db) };
}
