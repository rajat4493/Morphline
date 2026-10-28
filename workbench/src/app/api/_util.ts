import { NextResponse } from "next/server";
import { ZodError } from "zod";

export const bad = (message: string, status = 400, extra: object = {}) => NextResponse.json({ error: message, ...extra }, { status });
export function handle(e: unknown) {
  if (e instanceof ZodError) return bad("Invalid request", 422, { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  console.error("api error:", (e as Error).message); // message only: never log request bodies, headers or tokens
  return bad("Internal error", 500);
}
