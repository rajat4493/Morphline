import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/server";
import { analyzeAndReassess } from "@/services/reassess";
import { bad, handle } from "../../../_util";

export const maxDuration = 300;
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const { db, ctx } = await getContext();
    const r = await analyzeAndReassess(db, ctx, z.string().uuid().parse(params.id));
    if (!r.ok) return bad(r.message, r.code === "not_found" ? 404 : 409);
    return NextResponse.json({ ok: true, message: `Analysed: ${r.stats.analyzed} new, ${r.stats.cached} cached, ${r.stats.failed} failed`, issues: r.issues });
  } catch (e) { return handle(e); }
}
